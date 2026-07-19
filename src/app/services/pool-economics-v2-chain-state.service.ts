import { Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';
import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import {
  ChiaSingletonReaderService,
  ReplayedSpend,
  SingletonLineage,
} from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import type { PoolSingletonSpendContext } from './pool-economics-v2-spend-builder.service';

export const POOL_SPEND_DEPOSIT = 1;
export const POOL_SPEND_REDEEM = 2;
export const POOL_SPEND_SETTLEMENT = 3;
export const POOL_SPEND_GOVERNANCE = 4;
export const POOL_SPEND_GENERATE_OFFER = 5;
export const POOL_SPEND_V2_SPECIFIC_DEED_SWAP = 6;
export const POOL_SPEND_V2_TRUE_REDEMPTION = 7;
export const POOL_SPEND_V2_RESERVE_ACQUISITION = 8;

const SHARE_PPM_DENOMINATOR = 1_000_000n;

@Injectable({ providedIn: 'root' })
export class PoolEconomicsV2ChainStateService {
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly wasm = inject(ChiaWasmService);

  async readCurrentState(
    poolLauncherId = environment.solslotProtocol.poolLauncherId,
  ): Promise<PoolV2ChainStateEvidence> {
    const launcherId = normalize32(poolLauncherId);
    if (!launcherId) {
      return { kind: 'not-configured', error: 'Pool launcher id is not configured.' };
    }
    if (!this.wasm.ready()) {
      return { kind: 'read-failed', error: 'Chia WASM is not ready.' };
    }

    let lineage: SingletonLineage | null;
    try {
      lineage = await this.singleton.walkLineage(launcherId);
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
    if (!lineage) {
      return { kind: 'not-launched', launcherId };
    }

    const live = lineage.nodes[lineage.nodes.length - 1] ?? null;
    if (!live || live.isLauncher) {
      return {
        kind: 'not-launched',
        launcherId,
        launcherCoinId: lineage.launcherCoinId,
      };
    }

    let replay: ReplayedSpend | null;
    try {
      replay = await this.singleton.replayLatestSpend(lineage);
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
    if (!replay || replay.node.isLauncher) {
      return {
        kind: 'not-spent',
        launcherId,
        liveCoinId: live.coinId,
        livePuzzleHash: live.puzzleHash,
        confirmedBlockIndex: live.confirmedBlockIndex,
        lineageDepth: lineage.nodes.length - 1,
      };
    }

    try {
      const decoded = decodePoolEconomicStateTransition(
        this.clvm(),
        {
          puzzleReveal: replay.puzzleAndSolution.puzzleReveal,
          solution: replay.puzzleAndSolution.solution,
          expectedCurrentPuzzleHash: live.puzzleHash,
        },
      );
      return {
        kind: 'confirmed',
        launcherId,
        liveCoinId: live.coinId,
        livePuzzleHash: live.puzzleHash,
        confirmedBlockIndex: live.confirmedBlockIndex,
        lineageDepth: lineage.nodes.length - 1,
        latestSpendCoinId: replay.node.coinId,
        latestSpentBlockIndex: replay.node.spentBlockIndex,
        spendCase: decoded.spendCase,
        spendCaseLabel: spendCaseLabel(decoded.spendCase),
        previousState: decoded.previousState,
        state: decoded.state,
        rebuiltFullPuzzleHash: decoded.rebuiltFullPuzzleHash,
        poolContext: {
          poolLauncherId: launcherId,
          poolCoin: {
            parentCoinInfo: live.parentCoinId,
            puzzleHash: live.puzzleHash,
            amount: live.amount,
            coinId: live.coinId,
          },
          poolInnerPuzzleHex: decoded.rebuiltInnerPuzzleHex,
          lineageProof: {
            parentName: replay.node.parentCoinId,
            innerPuzzleHash: decoded.previousInnerPuzzleHash,
            amount: replay.node.amount,
          },
        },
      };
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
  }

  private clvm(): ClvmShape {
    const sdk = this.wasm.sdk() as { Clvm?: new () => ClvmShape };
    if (!sdk.Clvm) {
      throw new Error('Chia WASM Clvm export is unavailable.');
    }
    return new sdk.Clvm();
  }
}

export type PoolV2ChainStateEvidence =
  | { kind: 'not-configured'; error: string }
  | { kind: 'not-launched'; launcherId: string; launcherCoinId?: string }
  | {
      kind: 'not-spent';
      launcherId: string;
      liveCoinId: string;
      livePuzzleHash: string;
      confirmedBlockIndex: number;
      lineageDepth: number;
    }
  | { kind: 'read-failed'; error: string }
  | {
      kind: 'confirmed';
      launcherId: string;
      liveCoinId: string;
      livePuzzleHash: string;
      confirmedBlockIndex: number;
      lineageDepth: number;
      latestSpendCoinId: string;
      latestSpentBlockIndex: number | null;
      spendCase: number;
      spendCaseLabel: string;
      previousState: PoolV2DecodedEconomicState;
      state: PoolV2DecodedEconomicState;
      rebuiltFullPuzzleHash: string;
      poolContext: PoolSingletonSpendContext;
    };

export interface PoolV2DecodedEconomicState {
  poolStatus: bigint;
  totalNavLockedMojos: bigint;
  deedCount: bigint;
  totalPoolTokenSupply: bigint;
  treasuryReserveTokens: bigint;
}

export interface PoolStateTransitionDecodeArgs {
  puzzleReveal: string;
  solution: string;
  expectedCurrentPuzzleHash?: string | null;
}

export interface PoolStateTransitionDecodeResult {
  spendCase: number;
  previousState: PoolV2DecodedEconomicState;
  state: PoolV2DecodedEconomicState;
  previousInnerPuzzleHash: string;
  rebuiltInnerPuzzleHash: string;
  rebuiltInnerPuzzleHex: string;
  rebuiltFullPuzzleHash: string;
}

export function decodePoolEconomicStateTransition(
  clvm: ClvmShape,
  args: PoolStateTransitionDecodeArgs,
): PoolStateTransitionDecodeResult {
  const full = clvm.deserialize(hexToBytes(normalizeHex(args.puzzleReveal)));
  const fullUncurried = full.uncurry();
  const fullArgs = fullUncurried ? curriedArgs(fullUncurried, 'pool singleton puzzle') : null;
  if (!fullUncurried || !fullArgs || fullArgs.length !== 2) {
    throw new Error('Pool spend puzzle reveal is not a curried singleton.');
  }

  const oldInner = fullArgs[1];
  const oldInnerUncurried = oldInner.uncurry();
  const oldInnerArgs = oldInnerUncurried ? curriedArgs(oldInnerUncurried, 'pool inner puzzle') : null;
  if (!oldInnerUncurried || !oldInnerArgs || oldInnerArgs.length !== 24) {
    throw new Error(
      `Pool V3 inner puzzle expects 24 curried args, got ${oldInnerArgs?.length ?? 0}.`,
    );
  }

  const previousState = stateFromCurriedArgs(oldInnerArgs);
  const solution = clvm.deserialize(hexToBytes(normalizeHex(args.solution)));
  const outer = requireList(solution, 'pool singleton outer solution');
  if (outer.length !== 3) {
    throw new Error(`Pool singleton outer solution expects 3 items, got ${outer.length}.`);
  }
  const innerSolution = requireList(outer[2], 'pool inner solution');
  if (innerSolution.length !== 5) {
    throw new Error(`Pool inner solution expects 5 items, got ${innerSolution.length}.`);
  }
  const spendCase = numberFromInt(innerSolution[3], 'spend_case');
  const params = requireList(innerSolution[4], 'pool spend params');
  const state = applyPoolSpendTransition({
    previousState,
    fpScale: requireInt(oldInnerArgs[18], 'FP_SCALE'),
    spendCase,
    params,
  });

  const currentInner = oldInnerUncurried.program.curry([
    ...oldInnerArgs.slice(0, 19),
    clvm.int(state.poolStatus),
    clvm.int(state.totalNavLockedMojos),
    clvm.int(state.deedCount),
    clvm.int(state.totalPoolTokenSupply),
    clvm.int(state.treasuryReserveTokens),
  ]);
  const currentFull = fullUncurried.program.curry([fullArgs[0], currentInner]);
  const rebuiltFullPuzzleHash = bytesToHex(currentFull.treeHash());
  const expectedCurrentPuzzleHash = args.expectedCurrentPuzzleHash
    ? normalizeHex(args.expectedCurrentPuzzleHash)
    : null;
  if (expectedCurrentPuzzleHash && rebuiltFullPuzzleHash !== expectedCurrentPuzzleHash) {
    throw new Error(
      `Rebuilt pool full puzzle hash ${rebuiltFullPuzzleHash} does not match live coin ` +
        `${expectedCurrentPuzzleHash}.`,
    );
  }

  return {
    spendCase,
    previousState,
    state,
    previousInnerPuzzleHash: bytesToHex(oldInner.treeHash()),
    rebuiltInnerPuzzleHash: bytesToHex(currentInner.treeHash()),
    rebuiltInnerPuzzleHex: bytesToHex(currentInner.serialize()),
    rebuiltFullPuzzleHash,
  };
}

function applyPoolSpendTransition(args: {
  previousState: PoolV2DecodedEconomicState;
  fpScale: bigint;
  spendCase: number;
  params: ProgramShape[];
}): PoolV2DecodedEconomicState {
  const s = args.previousState;
  switch (args.spendCase) {
    case POOL_SPEND_DEPOSIT: {
      requireParamCount(args.params, 9, 'POOL_SPEND_DEPOSIT');
      const deedParValue = requireInt(args.params[2], 'deed_par_value');
      const minted = fixedParTokenAmount(deedParValue, args.fpScale);
      return {
        poolStatus: s.poolStatus,
        totalNavLockedMojos: s.totalNavLockedMojos + deedParValue,
        deedCount: s.deedCount + 1n,
        totalPoolTokenSupply: s.totalPoolTokenSupply + minted,
        treasuryReserveTokens: s.treasuryReserveTokens,
      };
    }
    case POOL_SPEND_REDEEM:
      throw new Error('POOL_SPEND_REDEEM is disabled in Pool V3.');
    case POOL_SPEND_SETTLEMENT:
      return {
        poolStatus: 1n,
        totalNavLockedMojos: 0n,
        deedCount: 0n,
        totalPoolTokenSupply: s.totalPoolTokenSupply,
        treasuryReserveTokens: s.treasuryReserveTokens,
      };
    case POOL_SPEND_GOVERNANCE:
      requireParamCount(args.params, 2, 'POOL_SPEND_GOVERNANCE');
      return { ...s, poolStatus: requireInt(args.params[0], 'new_status') };
    case POOL_SPEND_GENERATE_OFFER:
      throw new Error('POOL_SPEND_GENERATE_OFFER is disabled in Pool V3.');
    case POOL_SPEND_V2_SPECIFIC_DEED_SWAP: {
      requireParamCount(args.params, 24, 'POOL_SPEND_V2_SPECIFIC_DEED_SWAP');
      const deedNav = computeDeedNav(
        requireInt(args.params[7], 'collection_nav_mojos'),
        requireInt(args.params[6], 'share_ppm'),
      );
      const principal = principalTokensForNav(deedNav, s);
      return {
        poolStatus: s.poolStatus,
        totalNavLockedMojos: s.totalNavLockedMojos - deedNav,
        deedCount: s.deedCount - 1n,
        totalPoolTokenSupply: s.totalPoolTokenSupply,
        treasuryReserveTokens: s.treasuryReserveTokens + principal,
      };
    }
    case POOL_SPEND_V2_TRUE_REDEMPTION: {
      requireParamCount(args.params, 15, 'POOL_SPEND_V2_TRUE_REDEMPTION');
      const deedNav = computeDeedNav(
        requireInt(args.params[7], 'collection_nav_mojos'),
        requireInt(args.params[6], 'share_ppm'),
      );
      const principal = principalTokensForNav(deedNav, s);
      return {
        poolStatus: s.poolStatus,
        totalNavLockedMojos: s.totalNavLockedMojos - deedNav,
        deedCount: s.deedCount - 1n,
        totalPoolTokenSupply: s.totalPoolTokenSupply - principal,
        treasuryReserveTokens: s.treasuryReserveTokens,
      };
    }
    case POOL_SPEND_V2_RESERVE_ACQUISITION: {
      requireParamCount(args.params, 15, 'POOL_SPEND_V2_RESERVE_ACQUISITION');
      const deedNav = computeDeedNav(
        requireInt(args.params[7], 'collection_nav_mojos'),
        requireInt(args.params[6], 'share_ppm'),
      );
      const sellerTokenPrice = requireInt(args.params[13], 'seller_token_price');
      const reservePaid = minBigint(s.treasuryReserveTokens, sellerTokenPrice);
      const freshMint = sellerTokenPrice - reservePaid;
      return {
        poolStatus: s.poolStatus,
        totalNavLockedMojos: s.totalNavLockedMojos + deedNav,
        deedCount: s.deedCount + 1n,
        totalPoolTokenSupply: s.totalPoolTokenSupply + freshMint,
        treasuryReserveTokens: s.treasuryReserveTokens - reservePaid,
      };
    }
    default:
      throw new Error(`Unsupported pool spend case ${args.spendCase}.`);
  }
}

function stateFromCurriedArgs(args: ProgramShape[]): PoolV2DecodedEconomicState {
  return {
    poolStatus: requireInt(args[19], 'POOL_STATUS'),
    totalNavLockedMojos: requireInt(args[20], 'TOTAL_VALUE_LOCKED'),
    deedCount: requireInt(args[21], 'DEED_COUNT'),
    totalPoolTokenSupply: requireInt(args[22], 'TOTAL_POOL_TOKEN_SUPPLY'),
    treasuryReserveTokens: requireInt(args[23], 'TREASURY_RESERVE_TOKENS'),
  };
}

function spendCaseLabel(spendCase: number): string {
  switch (spendCase) {
    case POOL_SPEND_DEPOSIT:
      return 'DEPOSIT';
    case POOL_SPEND_REDEEM:
      return 'REDEEM';
    case POOL_SPEND_SETTLEMENT:
      return 'SETTLEMENT';
    case POOL_SPEND_GOVERNANCE:
      return 'GOVERNANCE';
    case POOL_SPEND_GENERATE_OFFER:
      return 'GENERATE_OFFER';
    case POOL_SPEND_V2_SPECIFIC_DEED_SWAP:
      return 'V2_SPECIFIC_DEED_SWAP';
    case POOL_SPEND_V2_TRUE_REDEMPTION:
      return 'V2_TRUE_REDEMPTION';
    case POOL_SPEND_V2_RESERVE_ACQUISITION:
      return 'V2_RESERVE_ACQUISITION';
    default:
      return `UNKNOWN_${spendCase}`;
  }
}

interface ProgramShape {
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
  curry(args: ProgramShape[]): ProgramShape;
  uncurry(): UncurriedProgramShape | null | undefined;
  toList(): ProgramShape[] | null | undefined;
  toAtom(): Uint8Array | null | undefined;
  toInt(): bigint;
}

interface UncurriedProgramShape {
  program: ProgramShape;
  args: ProgramShape[] | ProgramShape;
}

export interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
}

function curriedArgs(
  uncurried: UncurriedProgramShape,
  label: string,
): ProgramShape[] {
  if (Array.isArray(uncurried.args)) {
    return uncurried.args;
  }
  const list = uncurried.args.toList();
  if (!list) throw new Error(`${label} curry args must be a CLVM list.`);
  return list;
}

function requireList(node: ProgramShape, label: string): ProgramShape[] {
  const list = node.toList();
  if (!list) throw new Error(`${label} must be a CLVM list.`);
  return list;
}

function requireInt(node: ProgramShape, label: string): bigint {
  try {
    return node.toInt();
  } catch {
    throw new Error(`${label} must be a CLVM integer.`);
  }
}

function numberFromInt(node: ProgramShape, label: string): number {
  const value = requireInt(node, label);
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside JavaScript safe integer range.`);
  }
  return Number(value);
}

function requireParamCount(params: ProgramShape[], expected: number, label: string): void {
  if (params.length !== expected) {
    throw new Error(`${label} expects ${expected} params, got ${params.length}.`);
  }
}

function fixedParTokenAmount(deedParValue: bigint, fpScale: bigint): bigint {
  return (deedParValue * fpScale) / 1000n;
}

function computeDeedNav(collectionNavMojos: bigint, sharePpm: bigint): bigint {
  return ceilDiv(collectionNavMojos * sharePpm, SHARE_PPM_DENOMINATOR);
}

function principalTokensForNav(deedNav: bigint, state: PoolV2DecodedEconomicState): bigint {
  const circulating = state.totalPoolTokenSupply - state.treasuryReserveTokens;
  return ceilDiv(deedNav * circulating, state.totalNavLockedMojos);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  if (numerator < 0n) throw new Error('numerator must be non-negative');
  return (numerator + denominator - 1n) / denominator;
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function normalize32(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = normalizeHex(value);
  return /^0x[0-9a-f]{64}$/.test(hex) ? hex : null;
}

function normalizeHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X')
    ? value.toLowerCase()
    : `0x${value.toLowerCase()}`;
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
