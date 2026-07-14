/**
 * One-click vault upgrade orchestrator (vault upgrade Brick 6c).
 *
 * Composes the two pure spend builders — the new-vault launch (Brick 6a,
 * {@link VaultLaunchSpendService}) and the deed-migrate co-spend (Brick 6b,
 * {@link VaultMigrateSpendService}) — into the bundles a wallet signs and
 * coinset.org broadcasts, and reads the chain state those bundles need.
 *
 * **Upgrade shape** (``research/SOLSLOT_VAULT_UPGRADE_DESIGN.md``):
 *   1. Launch a NEW vault singleton at the registry's canonical descriptor,
 *      reusing the user's identity (one independent bundle).
 *   2. Migrate each deed from the OLD vault to the new one.  Each migration
 *      spends the OLD vault coin once (it recreates itself), so deeds move
 *      **one per vault spend** — the migrations are sequential, not batched.
 *   3. Freely-transferable assets (XCH / pool-share CATs) move with ordinary
 *      sends (handled by the UI layer, Brick 6d).
 *
 * **Migrate eligibility.** The ``m`` spend case only exists in the current
 * canonical vault code, so only a vault already at that code (i.e. OUTDATED
 * purely by params) can migrate its deeds.  A vault outdated by *code* (minted
 * before ``m``) cannot migrate — it must abandon the old launcher and move
 * only freely-transferable assets.  {@link loadUpgradeContext} reports this as
 * ``canMigrateDeeds``.
 *
 * This service performs **no** wallet calls and never broadcasts; it returns
 * unsigned coin spends + the owner ``AGG_SIG_ME`` signing requests so the UI
 * (Brick 6d) drives funding, signing, pushing, and per-deed confirmation.
 */
import { Injectable, inject } from '@angular/core';

import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinRecord, CoinsetService } from './coinset.service';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import { coinId as computeCoinId, bytesToHex, hexToBytes } from '../utils/chia-hash';
import {
  CanonicalVaultParams,
  SINGLETON_LAUNCHER_HASH,
  VaultIdentity,
  VaultLaunchOutputs,
  VaultLaunchSpendService,
} from './vault-launch-spend.service';
import {
  SingletonLineageProof,
  VaultMigrateSpendService,
} from './vault-migrate-spend.service';
import { RegistryState } from './vault-version-detection';
import { VaultVersionRegistryService } from './vault-version-registry.service';

/** A coin's three identifying fields. */
export interface CoinFields {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: number | bigint;
}

/** A deed discovered at a vault, resolved enough to build its migrate spend. */
export interface DiscoveredDeed {
  /** The deed singleton's launcher id, 0x-hex. */
  deedLauncherId: string;
  /** The deed's current (unspent) state coin. */
  deedCoin: CoinFields;
  /** Lineage proof for the deed's current coin. */
  deedLineageProof: SingletonLineageProof;
}

/** Everything read from chain needed to plan a vault's upgrade. */
export interface UpgradeContext {
  vaultLauncherId: string;
  /** The vault's current (unspent) state coin. */
  currentVaultCoin: CoinFields;
  /** Lineage proof for the current vault coin. */
  vaultLineageProof: SingletonLineageProof;
  /** Identity recovered from the on-chain vault (preserved across upgrade). */
  identity: VaultIdentity;
  /** Params the OLD vault is currently curried with. */
  oldParams: CanonicalVaultParams;
  /** The OLD vault's code mod hash + params hash. */
  oldVaultInnerModHash: string;
  oldCanonicalParamsHash: string;
  /** The on-chain registry's canonical descriptor (null if unavailable). */
  registry: RegistryState | null;
  /** True when the registry advertises a different descriptor than this vault. */
  isOutdated: boolean;
  /** True when the OLD vault's code carries the ``m`` case (can migrate deeds). */
  canMigrateDeeds: boolean;
  /** The OLD vault's ``p2_vault`` puzzle hash (where its deeds live). */
  p2VaultPuzzleHash: string;
}

/** The new-vault launch half of an upgrade (unsigned). */
export interface LaunchPlan {
  newVaultLauncherId: string;
  launchOutputs: VaultLaunchOutputs;
  /** The permissionless launcher coin spend (combine with the wallet-signed
   *  funding spend that creates the launcher coin). */
  launcherCoinSpend: UnsignedCoinSpend;
}

/** An owner ``AGG_SIG_ME`` the wallet must produce for a vault ``m`` spend. */
export interface OwnerSigningRequest {
  /** ``sha256tree(SPEND_MIGRATE deed_launcher_id new_p2_vault_ph my_id)``. */
  signingTree: string;
  /** The vault coin being spent (the AGG_SIG_ME is bound to its id). */
  vaultCoinId: string;
}

/** One deed migration (vault ``m`` + deed ``p2_vault``), unsigned. */
export interface DeedMigratePlan {
  deedLauncherId: string;
  /** ``[vaultMigrateSpend, deedSpend]`` — both go in one bundle. */
  coinSpends: UnsignedCoinSpend[];
  /** The owner signature the bundle needs (the deed spend needs none). */
  ownerSigningRequest: OwnerSigningRequest;
  /** Where the deed lands: the NEW vault's ``p2_vault`` puzzle hash. */
  newP2VaultPuzzleHash: string;
}

@Injectable({ providedIn: 'root' })
export class VaultUpgradeService {
  private readonly launch = inject(VaultLaunchSpendService);
  private readonly migrate = inject(VaultMigrateSpendService);
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly registryReader = inject(VaultVersionRegistryService);
  private readonly coinset = inject(CoinsetService);
  private readonly wasm = inject(ChiaWasmService);

  /** Bound on how far back we walk a deed's lineage to find its launcher. */
  static readonly MAX_DEED_LINEAGE_DEPTH = 10_000;

  // ── Chain reads ──────────────────────────────────────────────────────

  /**
   * Read everything needed to plan a vault's upgrade: its current state coin,
   * identity/params (parsed from the most recent spent ancestor's reveal),
   * the registry descriptor, and the outdated / migrate-eligibility flags.
   *
   * Returns ``null`` when the vault is not on chain yet or still at its eve
   * coin (nothing to parse / upgrade).
   */
  async loadUpgradeContext(vaultLauncherId: string): Promise<UpgradeContext | null> {
    if (!this.wasm.ready()) {
      return null;
    }
    const lineage = await this.singleton.walkLineage(vaultLauncherId);
    if (!lineage) {
      return null;
    }
    const current = lineage.nodes[lineage.nodes.length - 1];
    if (!current || current.isLauncher) {
      // Eve not created yet — no state coin to upgrade.
      return null;
    }
    const parent = this.spentParent(lineage);
    if (!parent) {
      return null;
    }
    const parentSpend = await this.coinset.getPuzzleAndSolution(
      parent.coinId,
      parent.spentBlockIndex as number,
    );
    if (!parentSpend) {
      return null;
    }
    const clvm = this.clvm();
    const parsed = this.launch.parseVault(clvm, hexToBytes(parentSpend.puzzleReveal));

    const vaultLineageProof = await this.lineageProofForCurrentCoin(lineage);
    const registry = await this.registryReader.getCurrentState();
    const p2VaultPuzzleHash = this.migrate.newP2VaultPuzzleHash(vaultLauncherId);

    const currentModHash = this.launch.vaultInnerPuzzleHash(
      vaultLauncherId,
      parsed.identity,
      parsed.params,
    );
    // The OLD vault can migrate iff its code is the current canonical code
    // (which carries the ``m`` case).  We detect that by checking the local
    // current-code reconstruction matches the vault's own code mod hash.
    const canMigrateDeeds = registry
      ? eqHex(parsed.vaultInnerModHash, registry.vaultInnerModHash)
      : false;

    const isOutdated = registry
      ? !eqHex(parsed.vaultInnerModHash, registry.vaultInnerModHash) ||
        !eqHex(parsed.canonicalParamsHash, registry.canonicalParamsHash)
      : false;

    return {
      vaultLauncherId: normalizeHex(vaultLauncherId),
      currentVaultCoin: {
        parentCoinInfo: current.parentCoinId,
        puzzleHash: current.puzzleHash,
        amount: current.amount,
      },
      vaultLineageProof,
      identity: parsed.identity,
      oldParams: parsed.params,
      oldVaultInnerModHash: parsed.vaultInnerModHash,
      oldCanonicalParamsHash: parsed.canonicalParamsHash,
      registry,
      isOutdated,
      // Migrate needs the OLD vault to expose ``m`` — i.e. its code equals the
      // registry's published (current) code.  ``currentModHash`` is computed
      // for the puzzle-hash check that 6b enforces at spend-build time.
      canMigrateDeeds: canMigrateDeeds && eqHex(currentModHash, parsed.vaultInnerModHash),
      p2VaultPuzzleHash,
    };
  }

  /**
   * Enumerate the deeds currently held at a vault.
   *
   * Deeds are NFT singletons whose ``p2_vault`` inner ``CREATE_COIN``s them
   * with the vault's ``p2_vault`` puzzle hash as the memo/hint, so a single
   * ``get_coin_records_by_hint`` finds every deed at the vault.  For each we
   * walk back to the launcher (to recover the deed's launcher id) and build
   * the lineage proof its migrate spend needs.
   */
  async discoverDeedsAtVault(vaultLauncherId: string): Promise<DiscoveredDeed[]> {
    const p2VaultPuzzleHash = this.migrate.newP2VaultPuzzleHash(vaultLauncherId);
    const p2InnerPuzzleHash = p2VaultPuzzleHash;
    const records = await this.coinset.getCoinRecordsByHint(p2VaultPuzzleHash, false);
    const deeds: DiscoveredDeed[] = [];
    for (const record of records) {
      if (record.spent_block_index && record.spent_block_index !== 0) {
        continue;
      }
      const resolved = await this.resolveDeed(record, p2InnerPuzzleHash);
      if (resolved) {
        deeds.push(resolved);
      }
    }
    return deeds;
  }

  // ── Pure bundle composition ──────────────────────────────────────────

  /**
   * Build the new-vault launch coin spend (the permissionless launcher spend).
   * The caller funds the launcher coin separately (a wallet-signed spend that
   * ``CREATE_COIN``s ``(SINGLETON_LAUNCHER_HASH, 1)`` whose id is
   * ``fundingCoinId``) and combines it with ``launcherCoinSpend``.
   *
   * ``params`` must be the CANONICAL params (so the launched vault matches the
   * registry); this is enforced via {@link VaultLaunchSpendService.assertMatchesRegistry}.
   */
  buildLaunchPlan(args: {
    fundingCoinId: string;
    identity: VaultIdentity;
    params: CanonicalVaultParams;
    registryVaultInnerModHash: string;
    registryCanonicalParamsHash: string;
  }): LaunchPlan {
    this.launch.assertMatchesRegistry({
      params: args.params,
      registryVaultInnerModHash: args.registryVaultInnerModHash,
      registryCanonicalParamsHash: args.registryCanonicalParamsHash,
    });
    const launchOutputs = this.launch.computeLaunchOutputs({
      parentCoinId: args.fundingCoinId,
      identity: args.identity,
      params: args.params,
    });
    const launcherCoinSpend = this.launch.buildLauncherCoinSpend({
      parentCoinId: args.fundingCoinId,
      eveFullPuzzleHash: launchOutputs.vaultFullPuzzleHash,
    });
    return {
      newVaultLauncherId: launchOutputs.launcherId,
      launchOutputs,
      launcherCoinSpend,
    };
  }

  /**
   * Compose one deed's migration: the OLD vault ``m`` spend + the co-spent
   * deed ``p2_vault`` spend, plus the owner ``AGG_SIG_ME`` the bundle needs.
   *
   * ``identity`` / ``oldParams`` reconstruct the OLD vault (which must be at
   * current code); ``currentVaultCoin`` / ``vaultLineageProof`` are the OLD
   * vault's live state coin (changes after each migration — re-read between
   * deeds).
   */
  buildDeedMigratePlan(args: {
    oldVaultLauncherId: string;
    currentVaultCoin: CoinFields;
    vaultLineageProof: SingletonLineageProof;
    identity: VaultIdentity;
    oldParams: CanonicalVaultParams;
    deed: DiscoveredDeed;
    newVaultLauncherId: string;
    currentTimestamp: number;
  }): DeedMigratePlan {
    const oldVaultInnerPuzzleHash = this.launch.vaultInnerPuzzleHash(
      args.oldVaultLauncherId,
      args.identity,
      args.oldParams,
    );
    const vaultSpend = this.migrate.buildVaultMigrateCoinSpend({
      oldVaultLauncherId: args.oldVaultLauncherId,
      vaultCoin: args.currentVaultCoin,
      identity: args.identity,
      params: args.oldParams,
      deedLauncherId: args.deed.deedLauncherId,
      newVaultLauncherId: args.newVaultLauncherId,
      currentTimestamp: args.currentTimestamp,
      lineageProof: args.vaultLineageProof,
    });
    const deedSpend = this.migrate.buildDeedMigrateCoinSpend({
      oldVaultLauncherId: args.oldVaultLauncherId,
      oldVaultInnerPuzzleHash,
      vaultCoinId: vaultSpend.vaultCoinId,
      deedLauncherId: args.deed.deedLauncherId,
      deedCoin: args.deed.deedCoin,
      newVaultLauncherId: args.newVaultLauncherId,
      deedLineageProof: args.deed.deedLineageProof,
    });
    return {
      deedLauncherId: args.deed.deedLauncherId,
      coinSpends: [vaultSpend.coinSpend, deedSpend.coinSpend],
      ownerSigningRequest: {
        signingTree: vaultSpend.signingTree,
        vaultCoinId: vaultSpend.vaultCoinId,
      },
      newP2VaultPuzzleHash: vaultSpend.newP2VaultPuzzleHash,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** The most recently spent ancestor (= parent of the current state coin). */
  private spentParent(lineage: SingletonLineage): SingletonLineage['nodes'][number] | null {
    const spent = lineage.nodes.filter((n) => n.spentBlockIndex !== null);
    if (spent.length === 0) {
      return null;
    }
    return spent[spent.length - 1];
  }

  /** Lineage proof for the current (unspent) singleton state coin. */
  private async lineageProofForCurrentCoin(
    lineage: SingletonLineage,
  ): Promise<SingletonLineageProof> {
    const currentIndex = lineage.nodes.length - 1;
    const parent = lineage.nodes[currentIndex - 1];
    if (!parent) {
      throw new Error('vault upgrade: missing parent for current vault coin');
    }
    if (parent.isLauncher) {
      return {
        parentParentCoinInfo: normalizeHex(lineage.launcher.coin.parent_coin_info),
        parentInnerPuzzleHash: null,
        parentAmount: lineage.launcher.coin.amount,
      };
    }
    if (parent.spentBlockIndex === null) {
      throw new Error('vault upgrade: parent spend height is unavailable');
    }
    const parentSpend = await this.coinset.getPuzzleAndSolution(
      parent.coinId,
      parent.spentBlockIndex,
    );
    if (!parentSpend) {
      throw new Error('vault upgrade: parent puzzle reveal is unavailable');
    }
    return {
      parentParentCoinInfo: parent.parentCoinId,
      parentInnerPuzzleHash: bytesToHex(
        this.extractSingletonInnerPuzzleHash(parentSpend.puzzleReveal),
      ),
      parentAmount: parent.amount,
    };
  }

  /**
   * Resolve a deed coin record into a {@link DiscoveredDeed}: walk back to the
   * launcher (to recover the deed's launcher id) and build the current coin's
   * lineage proof.  Returns ``null`` if the launcher can't be located.
   */
  private async resolveDeed(
    record: CoinRecord,
    p2InnerPuzzleHash: string,
  ): Promise<DiscoveredDeed | null> {
    const deedCoin: CoinFields = {
      parentCoinInfo: normalizeHex(record.coin.parent_coin_info),
      puzzleHash: normalizeHex(record.coin.puzzle_hash),
      amount: record.coin.amount,
    };
    const directParent = await this.coinset.getCoinRecordByName(record.coin.parent_coin_info);
    if (!directParent) {
      return null;
    }
    const launcherIdHex = await this.findDeedLauncherId(directParent);
    if (!launcherIdHex) {
      return null;
    }
    const deedLineageProof = sameHex(directParent.coin.puzzle_hash, SINGLETON_LAUNCHER_HASH)
      ? {
          parentParentCoinInfo: normalizeHex(directParent.coin.parent_coin_info),
          parentInnerPuzzleHash: null,
          parentAmount: directParent.coin.amount,
        }
      : {
          parentParentCoinInfo: normalizeHex(directParent.coin.parent_coin_info),
          parentInnerPuzzleHash: p2InnerPuzzleHash,
          parentAmount: directParent.coin.amount,
        };
    return { deedLauncherId: launcherIdHex, deedCoin, deedLineageProof };
  }

  /** Walk a deed's ancestry back to the launcher coin; its id is the deed's
   *  launcher id. */
  private async findDeedLauncherId(start: CoinRecord): Promise<string | null> {
    let node: CoinRecord | null = start;
    let depth = 0;
    while (node && depth < VaultUpgradeService.MAX_DEED_LINEAGE_DEPTH) {
      if (sameHex(node.coin.puzzle_hash, SINGLETON_LAUNCHER_HASH)) {
        return computeCoinId(
          node.coin.parent_coin_info,
          node.coin.puzzle_hash,
          node.coin.amount,
        );
      }
      node = await this.coinset.getCoinRecordByName(node.coin.parent_coin_info);
      depth++;
    }
    return null;
  }

  private extractSingletonInnerPuzzleHash(puzzleReveal: string): Uint8Array {
    const clvm = this.clvm();
    const puzzle = clvm.deserialize(hexToBytes(puzzleReveal));
    const uncurried = puzzle.uncurry();
    if (!uncurried) {
      throw new Error('vault upgrade: parent singleton puzzle is not curried');
    }
    const args = uncurried.args;
    if (!args || args.length !== 2) {
      throw new Error('vault upgrade: parent singleton puzzle has unexpected curry args');
    }
    return args[1].treeHash();
  }

  private clvm(): ClvmShape {
    const sdk = this.wasm.sdk() as { Clvm?: new () => ClvmShape };
    if (!sdk?.Clvm) {
      throw new Error('vault upgrade: chia-wallet-sdk-wasm Clvm export unavailable');
    }
    return new sdk.Clvm();
  }
}

// Structurally matches the WASM SDK Clvm/Program surface used by the launch +
// migrate services so a ``clvm`` instance from here can be passed to
// ``VaultLaunchSpendService.parseVault``.
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

function normalizeHex(value: string): string {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`invalid hex string: ${value}`);
  }
  return `0x${hex.toLowerCase()}`;
}

function eqHex(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}

function sameHex(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}
