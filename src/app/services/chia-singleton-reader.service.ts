import { Injectable, inject } from '@angular/core';
import { CoinsetService, CoinRecord, PuzzleAndSolution } from './coinset.service';
import { ChiaWasmService } from './chia-wasm.service';
import { coinId as computeCoinIdFromBytes, hexToBytes } from '../utils/chia-hash';

/**
 * Generic on-chain reader for any Populis singleton (A.x or vault).
 *
 * Two operations matter:
 *
 *   1. {@link walkLineage} — given a launcher coin id, follow
 *      `parent_id` links forward through every spent ancestor until
 *      the (single) currently-unspent state coin is reached.  Returns
 *      a typed {@link SingletonLineage} for downstream consumers.
 *
 *   2. {@link readLatestProtocolStateHash} — locate the most recent
 *      spent ancestor in a lineage, fetch its puzzle reveal + solution
 *      from coinset.org, run the puzzle in chia-wallet-sdk-wasm to
 *      recover its emitted conditions, and pull the
 *      `CREATE_PUZZLE_ANNOUNCEMENT` body whose first byte is the
 *      Populis protocol prefix (`0x50`).  For every A.x trust-root
 *      puzzle that announcement body equals `PROTOCOL_PREFIX ||
 *      state_hash` — so the suffix is the canonical state hash that
 *      off-chain consumers (the API at /protocol, this portal) must
 *      independently verify.
 *
 * This is the foundation for the Trust Roots admin page (Phase 3) and
 * for every "verify on chain" badge we'll surface elsewhere.  It does
 * NOT decode the curried inner-puzzle state itself — that's a Phase
 * 2.5 enhancement, gated on the per-A.x driver TS ports landing.
 */
@Injectable({ providedIn: 'root' })
export class ChiaSingletonReaderService {
  private readonly coinset = inject(CoinsetService);
  private readonly chiaWasm = inject(ChiaWasmService);

  /** Populis-specific announcement namespace byte (the "P" prefix). */
  static readonly PROTOCOL_PREFIX = 0x50;

  /** Bound on lineage walk depth — singletons in production won't have this many spends. */
  static readonly MAX_DEPTH = 10_000;

  /** Maximum CLVM cost we'll allow a replayed spend to consume.  Matches the value the chia full node uses. */
  static readonly MAX_REPLAY_COST = 11_000_000_000n;

  /**
   * Walk the singleton lineage from `launcherId` forward to the
   * currently-unspent state coin.
   *
   * Algorithm (mirrors `VaultDiscoveryService.walkSingletonChain` but
   * generalised):
   *
   *   1. Fetch the launcher coin record.  If it doesn't exist on chain,
   *      return null (the launcher hasn't confirmed yet).
   *   2. From the launcher, follow `get_coin_records_by_parent_ids`
   *      forward.  Each spend creates exactly one child (singletons
   *      conserve), so the walk is linear.
   *   3. Stop at the first unspent child — that's the live state coin.
   *
   * @returns the lineage, or null if the launcher itself doesn't exist
   *   on chain yet, or if the launcher exists but has not been spent
   *   (i.e. no eve singleton yet).
   */
  async walkLineage(launcherId: string): Promise<SingletonLineage | null> {
    const launcher = await this.coinset.getCoinRecordByName(launcherId);
    if (!launcher) return null;

    const launcherCoinId = computeCoinIdFromBytes(
      launcher.coin.parent_coin_info,
      launcher.coin.puzzle_hash,
      launcher.coin.amount,
    );

    if (!launcher.spent_block_index || launcher.spent_block_index === 0) {
      // Launcher confirmed but not yet spent — eve hasn't been created.
      return {
        launcherId: normalizeHex(launcherId),
        launcherCoinId,
        launcher,
        nodes: [
          {
            coinId: launcherCoinId,
            parentCoinId: normalizeHex(launcher.coin.parent_coin_info),
            puzzleHash: normalizeHex(launcher.coin.puzzle_hash),
            amount: launcher.coin.amount,
            confirmedBlockIndex: launcher.confirmed_block_index,
            spentBlockIndex: null,
            isLauncher: true,
          },
        ],
      };
    }

    const nodes: SingletonLineageNode[] = [
      {
        coinId: launcherCoinId,
        parentCoinId: normalizeHex(launcher.coin.parent_coin_info),
        puzzleHash: normalizeHex(launcher.coin.puzzle_hash),
        amount: launcher.coin.amount,
        confirmedBlockIndex: launcher.confirmed_block_index,
        spentBlockIndex: launcher.spent_block_index,
        isLauncher: true,
      },
    ];

    let currentParentId = launcherCoinId;
    let depth = 0;
    while (depth < ChiaSingletonReaderService.MAX_DEPTH) {
      const children = await this.coinset.getCoinRecordsByParentIds(
        [currentParentId],
        /* includeSpent */ true,
      );
      if (children.length === 0) {
        // No child yet — parent was spent but the result is still in mempool.
        return { launcherId: normalizeHex(launcherId), launcherCoinId, launcher, nodes };
      }

      // Singleton invariant: exactly one child.  If for some reason there
      // are multiple, take the most recent confirmed one (defensive — a
      // misconfigured launch could in principle emit several CREATE_COINs
      // but no Populis puzzle does this).
      children.sort((a, b) => b.confirmed_block_index - a.confirmed_block_index);
      const child = children[0];
      const childId = computeCoinIdFromBytes(
        child.coin.parent_coin_info,
        child.coin.puzzle_hash,
        child.coin.amount,
      );
      const isUnspent =
        !child.spent_block_index || child.spent_block_index === 0;
      nodes.push({
        coinId: childId,
        parentCoinId: normalizeHex(child.coin.parent_coin_info),
        puzzleHash: normalizeHex(child.coin.puzzle_hash),
        amount: child.coin.amount,
        confirmedBlockIndex: child.confirmed_block_index,
        spentBlockIndex: isUnspent ? null : child.spent_block_index,
        isLauncher: false,
      });
      if (isUnspent) {
        return { launcherId: normalizeHex(launcherId), launcherCoinId, launcher, nodes };
      }
      currentParentId = childId;
      depth++;
    }
    throw new Error(
      `walkLineage exceeded MAX_DEPTH (${ChiaSingletonReaderService.MAX_DEPTH}) ` +
        `walking from launcher ${launcherId} — pathological lineage or chain corruption`,
    );
  }

  /**
   * Find the most recently spent ancestor in a lineage and replay its
   * spend in WASM to recover the emitted condition list.
   *
   * "Most recently spent" = the second-to-last node (the unspent leaf
   * is the current state coin; its parent is the spend we want).  For
   * a launcher that's been spent exactly once (eve only), that's the
   * launcher itself; for a launcher with N transitions we want the
   * Nth child.
   *
   * Returns null when:
   *   - the launcher has not been spent yet (no transitions to replay),
   *   - the spend record is unavailable on coinset.org (rare, cache miss),
   *   - WASM is not ready (caller should gate on `chiaWasm.ready()`).
   */
  async replayLatestSpend(
    lineage: SingletonLineage,
  ): Promise<ReplayedSpend | null> {
    if (!this.chiaWasm.ready()) return null;

    const spentNodes = lineage.nodes.filter((n) => n.spentBlockIndex !== null);
    if (spentNodes.length === 0) {
      // Launcher unspent — nothing to replay.
      return null;
    }

    const latest = spentNodes[spentNodes.length - 1];
    const ps = await this.coinset.getPuzzleAndSolution(
      latest.coinId,
      latest.spentBlockIndex!,
    );
    if (!ps) return null;

    const conditions = this.runPuzzle(ps);
    return { node: latest, puzzleAndSolution: ps, conditions };
  }

  /**
   * Convenience: replay the latest spend and return the
   * `CREATE_PUZZLE_ANNOUNCEMENT` body whose leading byte is
   * {@link PROTOCOL_PREFIX} (0x50).  For every A.x trust-root puzzle,
   * this body's structure is `PROTOCOL_PREFIX || state_hash`, so the
   * tail (without the prefix byte) is the canonical state hash that
   * off-chain consumers should verify against.
   *
   * Returns null when no Populis-prefixed announcement exists in the
   * spend, or when prerequisites aren't met (WASM not ready, lineage
   * has no spends yet, etc.).
   */
  async readLatestProtocolStateHash(
    lineage: SingletonLineage,
  ): Promise<Uint8Array | null> {
    const replay = await this.replayLatestSpend(lineage);
    if (!replay) return null;
    for (const body of replay.conditions.createPuzzleAnnouncements) {
      if (body.length >= 1 && body[0] === ChiaSingletonReaderService.PROTOCOL_PREFIX) {
        return body.slice(1);
      }
    }
    return null;
  }

  /**
   * Run a puzzle reveal against its solution in WASM and decode the
   * outgoing condition list into a typed shape.
   *
   * Pulled out so unit tests can call it with a synthetic
   * {@link PuzzleAndSolution} without going to chain.
   */
  private runPuzzle(ps: PuzzleAndSolution): DecodedConditions {
    const sdk = this.chiaWasm.sdk() as ChiaSdkClvmShape;
    const ClvmCls = sdk.Clvm;
    if (!ClvmCls) {
      throw new Error(
        'ChiaSingletonReaderService: chia-wallet-sdk-wasm does not expose Clvm. ' +
          'Bundle / package mismatch.',
      );
    }
    const clvm = new ClvmCls();
    const puzzleBytes = hexToBytes(ps.puzzleReveal);
    const solutionBytes = hexToBytes(ps.solution);
    const puzzle = clvm.deserialize(puzzleBytes);
    const solution = clvm.deserialize(solutionBytes);
    const output = puzzle.run(
      solution,
      ChiaSingletonReaderService.MAX_REPLAY_COST,
      /* mempoolMode */ false,
    );
    const conditions = output.value.toList() ?? [];

    const createPuzzleAnnouncements: Uint8Array[] = [];
    const createCoins: { puzzleHash: Uint8Array; amount: bigint }[] = [];
    for (const cond of conditions) {
      const ann = cond.parseCreatePuzzleAnnouncement?.();
      if (ann) {
        createPuzzleAnnouncements.push(ann.message);
        continue;
      }
      // Best-effort CREATE_COIN extraction.  Not every condition has a
      // dedicated parser exposed; fall back to opcode peek.
      const opcodeNode = cond.first?.();
      const opcodeAtom = opcodeNode?.toAtom?.();
      if (
        opcodeAtom &&
        opcodeAtom.length === 1 &&
        opcodeAtom[0] === 51 /* CREATE_COIN */
      ) {
        const rest = cond.rest?.();
        const phNode = rest?.first?.();
        const ph = phNode?.toAtom?.();
        const amtNode = rest?.rest?.().first?.();
        const amt = amtNode?.toInt?.();
        if (ph && typeof amt === 'bigint') {
          createCoins.push({ puzzleHash: ph, amount: amt });
        }
      }
    }
    return { createPuzzleAnnouncements, createCoins, costMojos: output.cost };
  }
}

// ─── Public types ─────────────────────────────────────────────────────────

export interface SingletonLineageNode {
  coinId: string;
  parentCoinId: string;
  puzzleHash: string;
  amount: number;
  confirmedBlockIndex: number;
  /** null if unspent (i.e. this node is the live state coin). */
  spentBlockIndex: number | null;
  isLauncher: boolean;
}

export interface SingletonLineage {
  launcherId: string;
  launcherCoinId: string;
  launcher: CoinRecord;
  /**
   * Full chain from launcher → ... → current.  The last entry is the
   * unspent state coin (or the launcher itself if it hasn't been spent).
   */
  nodes: SingletonLineageNode[];
}

export interface DecodedConditions {
  createPuzzleAnnouncements: Uint8Array[];
  createCoins: { puzzleHash: Uint8Array; amount: bigint }[];
  costMojos: bigint;
}

export interface ReplayedSpend {
  node: SingletonLineageNode;
  puzzleAndSolution: PuzzleAndSolution;
  conditions: DecodedConditions;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Narrow type for the SDK exports we actually use here.  The full SDK
 * surface is huge and varies between versions; we only need the
 * subset that lets us deserialize + run a CLVM puzzle and parse the
 * outgoing condition list.
 */
interface ChiaSdkClvmShape {
  Clvm?: new () => {
    deserialize(bytes: Uint8Array): {
      run(
        solution: any,
        maxCost: bigint,
        mempoolMode: boolean,
      ): { value: any; cost: bigint };
    };
  };
}

function normalizeHex(s: string): string {
  return s.startsWith('0x') ? s.toLowerCase() : '0x' + s.toLowerCase();
}
