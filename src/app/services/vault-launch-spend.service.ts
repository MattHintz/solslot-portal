/**
 * Client-side NEW-vault launch spend builder (vault upgrade Brick 6a).
 *
 * The on-chain half of a vault version upgrade
 * (``research/SOLSLOT_VAULT_UPGRADE_DESIGN.md``) is:
 *   1. launch a NEW vault singleton at the registry's canonical descriptor
 *      (current code + canonical params), reusing the user's identity;
 *   2. migrate each deed from the old vault to the new one (Brick 6b);
 *   3. move freely-transferable assets (Brick 6c).
 *
 * This service owns step 1's *pure* spend construction: parse the user's
 * existing vault to recover its identity, curry the canonical vault inner
 * puzzle at a new launcher id, and produce the launcher coin spend + every
 * deterministic launch output (launcher id, eve coin, announcement).  No
 * chain reads, wallet calls, or signatures happen here — the orchestrator
 * (Brick 6c) funds the launcher, gathers signatures, combines with the
 * migrate spends, and pushes.
 *
 * Mirrors the proven launcher pattern in
 * ``admin-authority-v2.service.ts`` (``computeLaunchOutputs`` /
 * ``buildLauncherCoinSpend``) and the vault currying in
 * ``zkpassport-vault-enrollment-spend.service.ts``.  The curried-arg order
 * and the full-puzzle wrapper are the cross-repo contract with
 * ``solslot_puzzles/vault_driver.py::puzzle_for_vault_full``; the
 * ``vault-launch-spend.service.spec.ts`` fixture pins it against Python.
 */
import { Injectable, inject } from '@angular/core';
import { sha256 } from 'ethers';

import { ChiaWasmService } from './chia-wasm.service';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import {
  AUTH_TYPE_BLS,
  AUTH_TYPE_SECP256K1,
  AUTH_TYPE_SECP256R1,
  bytesToHex,
  hexToBytes,
} from '../utils/chia-hash';
import { VAULT_CURRENT_INNER_PUZZLE_HEX } from './vault-current-inner.puzzle-hex';
import { computeCanonicalParamsHash } from './vault-version-detection';

/** Tree hash of ``singleton_top_layer_v1_1.clsp``. */
export const SINGLETON_MOD_HASH =
  '0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
/** Tree hash of ``singleton_launcher.clsp``. */
export const SINGLETON_LAUNCHER_HASH =
  '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';

/** A vault singleton carries 1 mojo (must be odd) by convention. */
const SINGLETON_AMOUNT = 1n;

/**
 * The user identity curried into a vault inner puzzle.  Preserved verbatim
 * across an upgrade so the new vault is controlled by the same owner and
 * keeps the same enrollment (identity-attest root).
 */
export interface VaultIdentity {
  /** Raw owner pubkey (48-byte BLS / 33-byte k1 / 65-byte r1), 0x-hex. */
  ownerPubkey: string;
  /** AUTH_TYPE_BLS / AUTH_TYPE_SECP256R1 / AUTH_TYPE_SECP256K1. */
  authType: number;
  /** 32-byte Merkle root of authorised member keys, 0x-hex. */
  membersMerkleRoot: string;
  /** 32-byte zkPassport identity-attest root, 0x-hex. */
  identityAttestRoot: string;
}

/**
 * The protocol-level (shared) vault params.  For an upgrade these come from
 * the canonical configuration (env + the validator-derived bridge policy
 * hash) and are cross-checked against the on-chain registry's
 * ``canonicalParamsHash`` before any spend is built.
 */
export interface CanonicalVaultParams {
  /** Pool singleton mod hash, 0x-hex (= SINGLETON_MOD_HASH). */
  poolSingletonModHash: string;
  /** Pool singleton launcher id, 0x-hex. */
  poolLauncherId: string;
  /** Pool singleton launcher puzzle hash, 0x-hex (= SINGLETON_LAUNCHER_HASH). */
  poolSingletonLauncherPuzzleHash: string;
  /** zkPassport bridge policy hash, 0x-hex. */
  zkpassportBridgePolicyHash: string;
}

/** A coin's three identifying fields, 0x-hex + bigint amount. */
export interface CoinFields {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: bigint;
}

/** Everything the orchestrator needs to fund + spend a fresh vault launch. */
export interface VaultLaunchOutputs {
  /** The new vault's permanent launcher id (= launcher coin id), 0x-hex. */
  launcherId: string;
  /** The launcher coin (child of the funding coin), 1 mojo. */
  launcherCoin: CoinFields;
  /** Tree hash of the eve vault inner puzzle, 0x-hex. */
  vaultInnerPuzzleHash: string;
  /** Tree hash of the eve vault full (singleton-wrapped) puzzle, 0x-hex. */
  vaultFullPuzzleHash: string;
  /** The eve vault coin (child of the launcher), 1 mojo. */
  eveCoin: CoinFields;
  /** sha256tree of the launcher solution (the launcher's announcement msg). */
  launcherAnnouncementMessage: string;
  /** sha256(launcher_coin_id || announcement_message). */
  launcherAnnouncementId: string;
}

/** Parsed identity + params recovered from an existing vault puzzle reveal. */
export interface ParsedVault {
  identity: VaultIdentity;
  params: CanonicalVaultParams;
  /** Tree hash of the uncurried vault inner mod (the vault CODE), 0x-hex. */
  vaultInnerModHash: string;
  /** sha256tree of the canonical params, 0x-hex. */
  canonicalParamsHash: string;
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
  uncurry(): { program: ProgramShape; args: ProgramShape[] } | undefined;
  toAtom(): Uint8Array;
  toInt(): bigint;
}

interface SdkShape {
  Clvm: new () => ClvmShape;
  Coin: new (
    parentCoinInfo: Uint8Array,
    puzzleHash: Uint8Array,
    amount: bigint,
  ) => { parentCoinInfo: Uint8Array; puzzleHash: Uint8Array; amount: bigint; coinId(): Uint8Array };
  Constants?: {
    singletonLauncher?: () => Uint8Array;
    singletonTopLayer?: () => Uint8Array;
    singletonTopLayerV11?: () => Uint8Array;
  };
}

@Injectable({ providedIn: 'root' })
export class VaultLaunchSpendService {
  private readonly wasm = inject(ChiaWasmService);

  /**
   * Recover a vault's identity + params from its full puzzle reveal.
   *
   * The vault inner puzzle is curried (see
   * ``zkpassport-vault-enrollment-spend.service.ts``):
   *   0 SINGLETON_STRUCT  1 OWNER_PUBKEY  2 AUTH_TYPE
   *   3 MEMBERS_MERKLE_ROOT  4 IDENTITY_ATTEST_ROOT
   *   5 ZKPASSPORT_BRIDGE_POLICY_HASH  6 POOL_SINGLETON_MOD_HASH
   *   7 POOL_SINGLETON_LAUNCHER_ID  8 POOL_SINGLETON_LAUNCHER_PUZZLE_HASH
   */
  parseVault(clvm: ClvmShape, puzzleReveal: Uint8Array): ParsedVault {
    const full = clvm.deserialize(puzzleReveal);
    const fullUncurried = full.uncurry();
    if (!fullUncurried) {
      throw new Error('vault launch: vault puzzle reveal is not curried');
    }
    // The WASM SDK's ``uncurry()`` returns a CurriedProgram whose ``args`` is
    // already a ``Program[]`` (not a Program needing ``toList()``).
    const fullArgs = fullUncurried.args;
    if (!fullArgs || fullArgs.length !== 2) {
      throw new Error('vault launch: vault reveal lacks singleton wrapper args');
    }
    const inner = fullArgs[1];
    const innerUncurried = inner.uncurry();
    if (!innerUncurried) {
      throw new Error('vault launch: vault inner puzzle is not curried');
    }
    const args = innerUncurried.args;
    if (!args || args.length !== 9) {
      throw new Error(
        `vault launch: vault inner expects 9 curried args, got ${args?.length ?? 0}`,
      );
    }

    const ownerPubkey = bytesToHex(args[1].toAtom());
    const authType = Number(args[2].toInt());
    const membersMerkleRoot = bytesToHex(args[3].toAtom());
    const identityAttestRoot = bytesToHex(args[4].toAtom());
    const zkpassportBridgePolicyHash = bytesToHex(args[5].toAtom());
    const poolSingletonModHash = bytesToHex(args[6].toAtom());
    const poolLauncherId = bytesToHex(args[7].toAtom());
    const poolSingletonLauncherPuzzleHash = bytesToHex(args[8].toAtom());

    const params: CanonicalVaultParams = {
      poolSingletonModHash,
      poolLauncherId,
      poolSingletonLauncherPuzzleHash,
      zkpassportBridgePolicyHash,
    };

    return {
      identity: {
        ownerPubkey,
        authType,
        membersMerkleRoot,
        identityAttestRoot,
      },
      params,
      vaultInnerModHash: bytesToHex(innerUncurried.program.treeHash()),
      canonicalParamsHash: computeCanonicalParamsHash(
        poolSingletonModHash,
        poolLauncherId,
        poolSingletonLauncherPuzzleHash,
        zkpassportBridgePolicyHash,
      ),
    };
  }

  /**
   * Build the curried eve vault inner puzzle for a new launcher id.
   *
   * The arg order is the cross-repo contract with
   * ``puzzle_for_vault_inner`` in ``vault_driver.py``.
   */
  buildVaultInnerPuzzle(
    clvm: ClvmShape,
    launcherId: string,
    identity: VaultIdentity,
    params: CanonicalVaultParams,
  ): ProgramShape {
    const ownerPubkey = this.ownerPubkeyBytes(identity.ownerPubkey, identity.authType);
    const singletonStruct = this.singletonStruct(clvm, bytes32(launcherId, 'launcherId'));
    const vaultMod = clvm.deserialize(hexToBytes(VAULT_CURRENT_INNER_PUZZLE_HEX));
    return vaultMod.curry([
      singletonStruct,
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

  /** Tree hash of the eve vault inner puzzle, 0x-hex. */
  vaultInnerPuzzleHash(
    launcherId: string,
    identity: VaultIdentity,
    params: CanonicalVaultParams,
  ): string {
    const clvm = this.clvm();
    return bytesToHex(this.buildVaultInnerPuzzle(clvm, launcherId, identity, params).treeHash());
  }

  /** Tree hash of the eve vault full (singleton-wrapped) puzzle, 0x-hex. */
  vaultFullPuzzleHash(
    launcherId: string,
    identity: VaultIdentity,
    params: CanonicalVaultParams,
  ): string {
    const clvm = this.clvm();
    const inner = this.buildVaultInnerPuzzle(clvm, launcherId, identity, params);
    const struct = this.singletonStruct(clvm, bytes32(launcherId, 'launcherId'));
    return bytesToHex(this.singletonFullPuzzle(clvm, struct, inner).treeHash());
  }

  /**
   * Compute every deterministic output of a vault launch from the funding
   * coin id + the new vault's identity/params.  Pure: no chain or wallet.
   */
  computeLaunchOutputs(args: {
    parentCoinId: string;
    identity: VaultIdentity;
    params: CanonicalVaultParams;
  }): VaultLaunchOutputs {
    const sdk = this.sdk();
    const clvm = this.clvm();

    const parentCoinIdBytes = bytes32(args.parentCoinId, 'parentCoinId');
    const launcherCoin = new sdk.Coin(
      parentCoinIdBytes,
      hexToBytes(SINGLETON_LAUNCHER_HASH),
      SINGLETON_AMOUNT,
    );
    const launcherIdBytes = launcherCoin.coinId();
    const launcherId = bytesToHex(launcherIdBytes);

    const innerPuzzle = this.buildVaultInnerPuzzle(clvm, launcherId, args.identity, args.params);
    const struct = this.singletonStruct(clvm, launcherIdBytes);
    const fullPuzzle = this.singletonFullPuzzle(clvm, struct, innerPuzzle);
    const vaultInnerPuzzleHash = innerPuzzle.treeHash();
    const vaultFullPuzzleHash = fullPuzzle.treeHash();

    const eveCoin = new sdk.Coin(launcherIdBytes, vaultFullPuzzleHash, SINGLETON_AMOUNT);

    // Launcher solution: (eve_full_ph eve_amount key_value_list).
    const launcherSolution = clvm.list([
      clvm.atom(vaultFullPuzzleHash),
      clvm.int(SINGLETON_AMOUNT),
      clvm.nil(),
    ]);
    const launcherAnnouncementMessage = launcherSolution.treeHash();
    const announcementInput = new Uint8Array(
      launcherIdBytes.length + launcherAnnouncementMessage.length,
    );
    announcementInput.set(launcherIdBytes, 0);
    announcementInput.set(launcherAnnouncementMessage, launcherIdBytes.length);

    return {
      launcherId,
      launcherCoin: {
        parentCoinInfo: bytesToHex(launcherCoin.parentCoinInfo),
        puzzleHash: bytesToHex(launcherCoin.puzzleHash),
        amount: launcherCoin.amount,
      },
      vaultInnerPuzzleHash: bytesToHex(vaultInnerPuzzleHash),
      vaultFullPuzzleHash: bytesToHex(vaultFullPuzzleHash),
      eveCoin: {
        parentCoinInfo: bytesToHex(eveCoin.parentCoinInfo),
        puzzleHash: bytesToHex(eveCoin.puzzleHash),
        amount: eveCoin.amount,
      },
      launcherAnnouncementMessage: bytesToHex(launcherAnnouncementMessage),
      launcherAnnouncementId: sha256(announcementInput),
    };
  }

  /**
   * Construct the permissionless launcher coin spend that creates the eve
   * vault coin.  The funding coin (which creates the launcher) is signed by
   * the wallet separately; this is the second half of the bundle.
   */
  buildLauncherCoinSpend(args: {
    parentCoinId: string;
    eveFullPuzzleHash: string;
  }): UnsignedCoinSpend {
    const sdk = this.sdk();
    const launcherBytes = sdk.Constants?.singletonLauncher?.();
    if (!launcherBytes) {
      throw new Error(
        'vault launch: chia-wallet-sdk-wasm Constants.singletonLauncher unavailable',
      );
    }
    const clvm = this.clvm();
    const launcherSolution = clvm.list([
      clvm.atom(bytes32(args.eveFullPuzzleHash, 'eveFullPuzzleHash')),
      clvm.int(SINGLETON_AMOUNT),
      clvm.nil(),
    ]);
    return {
      coin: {
        parentCoinInfo: normalizeHex(args.parentCoinId),
        puzzleHash: SINGLETON_LAUNCHER_HASH,
        amount: SINGLETON_AMOUNT,
      },
      puzzleReveal: bytesToHex(clvm.deserialize(launcherBytes).serialize()),
      solution: bytesToHex(launcherSolution.serialize()),
    };
  }

  /**
   * Assert the canonical identity recovered/derived for the new vault
   * matches the on-chain registry's published descriptor.  This is the
   * safety gate that prevents launching a vault whose code or params drift
   * from what the registry advertises.
   *
   * @throws if the local vault mod hash or canonical params hash differ from
   *   the registry's published values.
   */
  assertMatchesRegistry(args: {
    params: CanonicalVaultParams;
    registryVaultInnerModHash: string;
    registryCanonicalParamsHash: string;
  }): void {
    const localModHash = bytesToHex(
      this.clvm().deserialize(hexToBytes(VAULT_CURRENT_INNER_PUZZLE_HEX)).treeHash(),
    );
    if (!sameHex(localModHash, args.registryVaultInnerModHash)) {
      throw new Error(
        'vault launch: local vault code mod hash does not match the on-chain ' +
          `registry (local ${localModHash}, registry ${normalizeHex(args.registryVaultInnerModHash)}). ` +
          'Refusing to launch a vault at non-canonical code.',
      );
    }
    const localParamsHash = computeCanonicalParamsHash(
      args.params.poolSingletonModHash,
      args.params.poolLauncherId,
      args.params.poolSingletonLauncherPuzzleHash,
      args.params.zkpassportBridgePolicyHash,
    );
    if (!sameHex(localParamsHash, args.registryCanonicalParamsHash)) {
      throw new Error(
        'vault launch: derived canonical params hash does not match the ' +
          `on-chain registry (local ${localParamsHash}, registry ${normalizeHex(args.registryCanonicalParamsHash)}). ` +
          'Refusing to launch a vault at non-canonical params.',
      );
    }
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
      throw new Error('vault launch: singleton top-layer bytecode unavailable in WASM SDK');
    }
    return clvm.deserialize(topLayer).curry([singletonStruct, innerPuzzle]);
  }

  private ownerPubkeyBytes(pubkey: string, authType: number): Uint8Array {
    const bytes = hexToBytes(pubkey);
    if (authType === AUTH_TYPE_BLS && bytes.length === 48) return bytes;
    if (authType === AUTH_TYPE_SECP256K1 && bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3)) {
      return bytes;
    }
    if (authType === AUTH_TYPE_SECP256R1 && bytes.length === 65 && bytes[0] === 4) return bytes;
    throw new Error('vault launch: owner pubkey does not match auth type');
  }

  private sdk(): SdkShape {
    const sdk = this.wasm.sdk() as SdkShape;
    if (!sdk?.Clvm || !sdk?.Coin) {
      throw new Error('vault launch: chia-wallet-sdk-wasm Clvm/Coin exports unavailable');
    }
    return sdk;
  }

  private clvm(): ClvmShape {
    const Clvm = this.sdk().Clvm;
    return new Clvm();
  }
}

function bytes32(input: string, name: string): Uint8Array {
  const bytes = hexToBytes(input);
  if (bytes.length !== 32) {
    throw new Error(`${name} must be 32 bytes, got ${bytes.length}`);
  }
  return bytes;
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
