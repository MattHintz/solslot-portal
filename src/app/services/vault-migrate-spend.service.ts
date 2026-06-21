/**
 * Client-side deed-migrate co-spend builder (vault upgrade Brick 6b).
 *
 * The on-chain second half of a one-click vault upgrade
 * (``research/POPULIS_VAULT_UPGRADE_DESIGN.md``): re-bind each deed (an NFT
 * singleton whose inner puzzle is ``p2_vault`` curried to the OLD vault's
 * launcher) to the freshly-launched NEW vault.  This is done by co-spending
 * two coins in one bundle:
 *
 *   1. the OLD vault with the ``m`` (migrate) spend case — it emits
 *      ``CREATE_PUZZLE_ANNOUNCEMENT(PREFIX || sha256tree(my_id deed_launcher_id
 *      new_p2_vault_ph))``, recreates itself unchanged, and requires an
 *      ``AGG_SIG_ME`` the owner signs over
 *      ``sha256tree(SPEND_MIGRATE deed_launcher_id new_p2_vault_ph my_id)``
 *      (so a relayer cannot redirect the deed);
 *   2. the deed's ``p2_vault`` inner — it asserts that announcement and
 *      ``CREATE_COIN``s the deed to ``new_p2_vault_ph`` (the deed keeps its
 *      launcher id; only its controlling vault changes).
 *
 * Migrate is BLS-only and only works on vaults whose code carries the ``m``
 * case (the current canonical vault code).  The curry orders + serialized
 * solutions are pinned cross-repo against ``vault_driver.py`` +
 * ``tests/test_vault.py::TestVaultBLSMigrate`` via
 * ``vault-migrate.fixtures.json``.
 */
import { Injectable, inject } from '@angular/core';

import { ChiaWasmService } from './chia-wasm.service';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import {
  AUTH_TYPE_BLS,
  AUTH_TYPE_SECP256K1,
  AUTH_TYPE_SECP256R1,
  bytesToHex,
  coinId,
  hexToBytes,
} from '../utils/chia-hash';
import { VAULT_CURRENT_INNER_PUZZLE_HEX } from './vault-current-inner.puzzle-hex';
import { P2_VAULT_CURRENT_PUZZLE_HEX } from './p2-vault-current.puzzle-hex';
import {
  CanonicalVaultParams,
  SINGLETON_LAUNCHER_HASH,
  SINGLETON_MOD_HASH,
  VaultIdentity,
} from './vault-launch-spend.service';

/** ``b'm'`` — the vault migrate spend case opcode. */
export const SPEND_MIGRATE = 0x6d;

/** A lineage proof for a singleton's parent coin (v1.1 form). */
export interface SingletonLineageProof {
  /** The parent coin's parent id (grandparent), 0x-hex. */
  parentParentCoinInfo: string;
  /** The parent coin's inner puzzle hash, 0x-hex.  ``null`` for the eve case
   *  (parent is the launcher). */
  parentInnerPuzzleHash: string | null;
  /** The parent coin's amount. */
  parentAmount: number | bigint;
}

/** A coin's three identifying fields. */
export interface CoinInput {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: number | bigint;
}

/** Result of building the OLD-vault ``m`` spend. */
export interface VaultMigrateSpend {
  coinSpend: UnsignedCoinSpend;
  /** Coin id of the spent vault, 0x-hex (= ``my_id`` in the puzzle). */
  vaultCoinId: string;
  /** The migration destination ``p2_vault`` puzzle hash, 0x-hex. */
  newP2VaultPuzzleHash: string;
  /** Inner of the ``AGG_SIG_ME`` message the BLS owner must sign, 0x-hex. */
  signingTree: string;
}

/** Result of building the deed ``p2_vault`` spend. */
export interface DeedMigrateSpend {
  coinSpend: UnsignedCoinSpend;
  /** Coin id of the spent deed, 0x-hex. */
  deedCoinId: string;
  /** The deed's own (curried) ``p2_vault`` inner puzzle hash, 0x-hex. */
  p2VaultInnerPuzzleHash: string;
  /** The migration destination ``p2_vault`` puzzle hash, 0x-hex. */
  newP2VaultPuzzleHash: string;
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  atom(bytes: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
  list(values: ProgramShape[]): ProgramShape;
  pair(first: ProgramShape, rest: ProgramShape): ProgramShape;
  nil(): ProgramShape;
}

interface ProgramShape {
  curry(args: ProgramShape[]): ProgramShape;
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
}

interface SdkShape {
  Clvm: new () => ClvmShape;
  Constants?: {
    singletonTopLayer?: () => Uint8Array;
    singletonTopLayerV11?: () => Uint8Array;
  };
}

@Injectable({ providedIn: 'root' })
export class VaultMigrateSpendService {
  private readonly wasm = inject(ChiaWasmService);

  /**
   * The ``p2_vault`` puzzle hash for deeds controlled by a given vault.
   * Curried with (SINGLETON_MOD_HASH, vault_launcher_id, SINGLETON_LAUNCHER_HASH).
   */
  newP2VaultPuzzleHash(vaultLauncherId: string): string {
    const clvm = this.clvm();
    return bytesToHex(this.p2VaultInnerPuzzle(clvm, vaultLauncherId).treeHash());
  }

  /**
   * Inner of the ``AGG_SIG_ME`` message a BLS owner signs for a migrate spend:
   * ``sha256tree(SPEND_MIGRATE deed_launcher_id new_p2_vault_puzzlehash my_id)``.
   * The network appends the coin id + genesis challenge to form the full
   * message; this is the puzzle's contribution.
   */
  migrateBlsSigningTree(
    deedLauncherId: string,
    newP2VaultPuzzleHash: string,
    vaultCoinId: string,
  ): string {
    const clvm = this.clvm();
    const tree = clvm.list([
      clvm.int(BigInt(SPEND_MIGRATE)),
      clvm.atom(bytes32(deedLauncherId, 'deedLauncherId')),
      clvm.atom(bytes32(newP2VaultPuzzleHash, 'newP2VaultPuzzleHash')),
      clvm.atom(bytes32(vaultCoinId, 'vaultCoinId')),
    ]);
    return bytesToHex(tree.treeHash());
  }

  /**
   * Build the OLD vault's ``m`` CoinSpend.  The vault recreates itself
   * unchanged and emits the announcement the deed's ``p2_vault`` asserts.
   *
   * ``signatureData`` is BLS-unused (the wallet signs the resulting bundle's
   * ``AGG_SIG_ME``); it exists only for the deferred secp path.
   */
  buildVaultMigrateCoinSpend(args: {
    oldVaultLauncherId: string;
    vaultCoin: CoinInput;
    identity: VaultIdentity;
    params: CanonicalVaultParams;
    deedLauncherId: string;
    newVaultLauncherId: string;
    currentTimestamp: number;
    lineageProof: SingletonLineageProof;
    signatureData?: string;
  }): VaultMigrateSpend {
    const clvm = this.clvm();
    const amount = toAmount(args.vaultCoin.amount, 'vaultCoin.amount');

    const innerPuzzle = this.vaultInnerPuzzle(
      clvm,
      args.oldVaultLauncherId,
      args.identity,
      args.params,
    );
    const innerPuzzleHash = innerPuzzle.treeHash();
    const struct = this.singletonStruct(clvm, bytes32(args.oldVaultLauncherId, 'oldVaultLauncherId'));
    const fullPuzzle = this.singletonFullPuzzle(clvm, struct, innerPuzzle);
    const fullPuzzleHash = bytesToHex(fullPuzzle.treeHash());
    if (!sameHex(fullPuzzleHash, args.vaultCoin.puzzleHash)) {
      throw new Error(
        'vault migrate: reconstructed vault full puzzle hash does not match the ' +
          `vault coin (rebuilt ${fullPuzzleHash}, coin ${normalizeHex(args.vaultCoin.puzzleHash)}). ` +
          'The vault may be at non-canonical code (migrate requires current vault code).',
      );
    }

    const vaultCoinId = coinId(
      args.vaultCoin.parentCoinInfo,
      args.vaultCoin.puzzleHash,
      amount,
    );
    const newP2VaultPuzzleHash = bytesToHex(
      this.p2VaultInnerPuzzle(clvm, args.newVaultLauncherId).treeHash(),
    );

    const migratePayload = clvm.list([
      clvm.atom(bytes32(args.deedLauncherId, 'deedLauncherId')),
      clvm.atom(bytes32(newP2VaultPuzzleHash, 'newP2VaultPuzzleHash')),
      clvm.int(BigInt(assertNonNegativeInteger(args.currentTimestamp, 'currentTimestamp'))),
      args.signatureData ? clvm.atom(hexToBytes(args.signatureData)) : clvm.nil(),
    ]);
    const innerSolution = clvm.list([
      clvm.atom(hexToBytes(vaultCoinId)),
      clvm.atom(innerPuzzleHash),
      clvm.int(amount),
      clvm.int(BigInt(SPEND_MIGRATE)),
      migratePayload,
    ]);
    const fullSolution = this.singletonSolution(clvm, args.lineageProof, amount, innerSolution);

    return {
      coinSpend: {
        coin: {
          parentCoinInfo: normalizeHex(args.vaultCoin.parentCoinInfo),
          puzzleHash: normalizeHex(args.vaultCoin.puzzleHash),
          amount,
        },
        puzzleReveal: bytesToHex(fullPuzzle.serialize()),
        solution: bytesToHex(fullSolution.serialize()),
      },
      vaultCoinId,
      newP2VaultPuzzleHash,
      signingTree: this.migrateBlsSigningTree(
        args.deedLauncherId,
        newP2VaultPuzzleHash,
        vaultCoinId,
      ),
    };
  }

  /**
   * Build the co-spent deed ``p2_vault`` CoinSpend.  Asserts the vault's
   * migrate announcement and sends the deed to the new vault's ``p2_vault``.
   */
  buildDeedMigrateCoinSpend(args: {
    oldVaultLauncherId: string;
    oldVaultInnerPuzzleHash: string;
    vaultCoinId: string;
    deedLauncherId: string;
    deedCoin: CoinInput;
    newVaultLauncherId: string;
    deedLineageProof: SingletonLineageProof;
  }): DeedMigrateSpend {
    const clvm = this.clvm();
    const amount = toAmount(args.deedCoin.amount, 'deedCoin.amount');

    const p2Inner = this.p2VaultInnerPuzzle(clvm, args.oldVaultLauncherId);
    const p2InnerHash = p2Inner.treeHash();
    const struct = this.singletonStruct(clvm, bytes32(args.deedLauncherId, 'deedLauncherId'));
    const deedFull = this.singletonFullPuzzle(clvm, struct, p2Inner);
    const deedFullHash = bytesToHex(deedFull.treeHash());
    if (!sameHex(deedFullHash, args.deedCoin.puzzleHash)) {
      throw new Error(
        'vault migrate: reconstructed deed full puzzle hash does not match the ' +
          `deed coin (rebuilt ${deedFullHash}, coin ${normalizeHex(args.deedCoin.puzzleHash)}). ` +
          'The deed is not a p2_vault deed bound to this vault.',
      );
    }

    const newP2VaultPuzzleHash = bytesToHex(
      this.p2VaultInnerPuzzle(clvm, args.newVaultLauncherId).treeHash(),
    );
    const deedCoinId = coinId(
      args.deedCoin.parentCoinInfo,
      args.deedCoin.puzzleHash,
      amount,
    );

    // p2_vault inner solution (the 6 non-curried args):
    //   singleton_inner_puzzle_hash, singleton_coin_id, my_launcher_id,
    //   my_singleton_inner_puzzle_hash, my_amount, next_puzzlehash
    const innerSolution = clvm.list([
      clvm.atom(bytes32(args.oldVaultInnerPuzzleHash, 'oldVaultInnerPuzzleHash')),
      clvm.atom(bytes32(args.vaultCoinId, 'vaultCoinId')),
      clvm.atom(bytes32(args.deedLauncherId, 'deedLauncherId')),
      clvm.atom(p2InnerHash),
      clvm.int(amount),
      clvm.atom(bytes32(newP2VaultPuzzleHash, 'newP2VaultPuzzleHash')),
    ]);
    const fullSolution = this.singletonSolution(clvm, args.deedLineageProof, amount, innerSolution);

    return {
      coinSpend: {
        coin: {
          parentCoinInfo: normalizeHex(args.deedCoin.parentCoinInfo),
          puzzleHash: normalizeHex(args.deedCoin.puzzleHash),
          amount,
        },
        puzzleReveal: bytesToHex(deedFull.serialize()),
        solution: bytesToHex(fullSolution.serialize()),
      },
      deedCoinId,
      p2VaultInnerPuzzleHash: bytesToHex(p2InnerHash),
      newP2VaultPuzzleHash,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private p2VaultInnerPuzzle(clvm: ClvmShape, vaultLauncherId: string): ProgramShape {
    const mod = clvm.deserialize(hexToBytes(P2_VAULT_CURRENT_PUZZLE_HEX));
    return mod.curry([
      clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
      clvm.atom(bytes32(vaultLauncherId, 'vaultLauncherId')),
      clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH)),
    ]);
  }

  /** Curry the current canonical vault inner puzzle (same order as Brick 6a). */
  private vaultInnerPuzzle(
    clvm: ClvmShape,
    launcherId: string,
    identity: VaultIdentity,
    params: CanonicalVaultParams,
  ): ProgramShape {
    const ownerPubkey = ownerPubkeyBytes(identity.ownerPubkey, identity.authType);
    const struct = this.singletonStruct(clvm, bytes32(launcherId, 'launcherId'));
    const mod = clvm.deserialize(hexToBytes(VAULT_CURRENT_INNER_PUZZLE_HEX));
    return mod.curry([
      struct,
      clvm.atom(ownerPubkey),
      clvm.int(BigInt(identity.authType)),
      clvm.atom(bytes32(identity.membersMerkleRoot, 'membersMerkleRoot')),
      clvm.atom(bytes32(identity.identityAttestRoot, 'identityAttestRoot')),
      clvm.atom(bytes32(params.zkpassportBridgePolicyHash, 'zkpassportBridgePolicyHash')),
      clvm.atom(bytes32(params.poolSingletonModHash, 'poolSingletonModHash')),
      clvm.atom(bytes32(params.poolLauncherId, 'poolLauncherId')),
      clvm.atom(bytes32(params.poolSingletonLauncherPuzzleHash, 'poolSingletonLauncherPuzzleHash')),
    ]);
  }

  private singletonStruct(clvm: ClvmShape, launcherId: Uint8Array): ProgramShape {
    return clvm.pair(
      clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
      clvm.pair(clvm.atom(launcherId), clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH))),
    );
  }

  private singletonFullPuzzle(
    clvm: ClvmShape,
    singletonStruct: ProgramShape,
    innerPuzzle: ProgramShape,
  ): ProgramShape {
    const constants = this.sdk().Constants;
    const topLayer = constants?.singletonTopLayerV11?.() ?? constants?.singletonTopLayer?.();
    if (!topLayer) {
      throw new Error('vault migrate: singleton top-layer bytecode unavailable in WASM SDK');
    }
    return clvm.deserialize(topLayer).curry([singletonStruct, innerPuzzle]);
  }

  /** Mirror of chia ``solution_for_singleton``: ``[lineage, amount, inner]``. */
  private singletonSolution(
    clvm: ClvmShape,
    lineageProof: SingletonLineageProof,
    amount: bigint,
    innerSolution: ProgramShape,
  ): ProgramShape {
    const parentAmount = toAmount(lineageProof.parentAmount, 'lineageProof.parentAmount');
    const lineage = lineageProof.parentInnerPuzzleHash
      ? clvm.list([
          clvm.atom(bytes32(lineageProof.parentParentCoinInfo, 'lineage.parentParentCoinInfo')),
          clvm.atom(bytes32(lineageProof.parentInnerPuzzleHash, 'lineage.parentInnerPuzzleHash')),
          clvm.int(parentAmount),
        ])
      : clvm.list([
          clvm.atom(bytes32(lineageProof.parentParentCoinInfo, 'lineage.parentParentCoinInfo')),
          clvm.int(parentAmount),
        ]);
    return clvm.list([lineage, clvm.int(amount), innerSolution]);
  }

  private sdk(): SdkShape {
    const sdk = this.wasm.sdk() as SdkShape;
    if (!sdk?.Clvm) {
      throw new Error('vault migrate: chia-wallet-sdk-wasm Clvm export unavailable');
    }
    return sdk;
  }

  private clvm(): ClvmShape {
    const Clvm = this.sdk().Clvm;
    return new Clvm();
  }
}

function ownerPubkeyBytes(pubkey: string, authType: number): Uint8Array {
  const bytes = hexToBytes(pubkey);
  if (authType === AUTH_TYPE_BLS && bytes.length === 48) return bytes;
  if (authType === AUTH_TYPE_SECP256K1 && bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3)) {
    return bytes;
  }
  if (authType === AUTH_TYPE_SECP256R1 && bytes.length === 65 && bytes[0] === 4) return bytes;
  throw new Error('vault migrate: owner pubkey does not match auth type');
}

function bytes32(input: string, name: string): Uint8Array {
  const bytes = hexToBytes(input);
  if (bytes.length !== 32) {
    throw new Error(`${name} must be 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

function toAmount(value: number | bigint, name: string): bigint {
  const big = typeof value === 'bigint' ? value : BigInt(assertNonNegativeInteger(value, name));
  if (big <= 0n) {
    throw new Error(`${name} must be greater than zero`);
  }
  return big;
}

function assertNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeHex(value: string): string {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`invalid hex string: ${value}`);
  }
  return `0x${hex.toLowerCase()}`;
}

function sameHex(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}
