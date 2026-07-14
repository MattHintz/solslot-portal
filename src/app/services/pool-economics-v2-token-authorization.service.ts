import { Injectable, inject } from '@angular/core';
import { sha256 } from 'ethers';

import { bytesToHex, coinId, hexToBytes } from '../utils/chia-hash';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CAT_MOD_PUZZLE_HEX } from './sgt-driver/cat-mod.puzzle-hex';
import { SgtDriverService } from './sgt-driver/sgt-driver.service';
import { POOL_TOKEN_TAIL_PUZZLE_HEX } from './pool-token-tail.puzzle-hex';
import {
  PoolEconomicsV2Service,
  TOKEN_MELT,
  TOKEN_MINT,
  type BigintLike,
} from './pool-economics-v2.service';
import {
  POOL_V2_WITNESS_REPLAY_COST,
  SINGLETON_LAUNCHER_HASH,
  SINGLETON_MOD_HASH,
  type PoolCoinInput,
  type PoolSingletonSpendContext,
} from './pool-economics-v2-spend-builder.service';

export interface PoolV2TokenAuthorizationMaterial {
  tailPuzzleHash: string;
  tailPuzzleReveal: string;
  tailSolution: string;
  poolFullPuzzleHash: string;
  poolInnerPuzzleHash: string;
  poolCoinId: string;
  tokenCoinId: string;
  mintOrMelt: typeof TOKEN_MINT | typeof TOKEN_MELT;
  amount: bigint;
  announcementMessage: string;
  expectedPuzzleAnnouncementId: string;
  assertedPuzzleAnnouncementIds: string[];
  assertedCoinIds: string[];
}

export interface PoolV2TokenCatCoinInput {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: BigintLike;
  coinId?: string | null;
}

export interface PoolV2TokenCatLineageProof {
  parentName?: string | null;
  innerPuzzleHash?: string | null;
  amount?: BigintLike | null;
}

export interface PoolV2TokenAuthorizationSpendBuild {
  material: PoolV2TokenAuthorizationMaterial;
  coinSpend: UnsignedCoinSpend;
  tokenInnerPuzzleHash: string;
  tokenFullPuzzleHash: string;
  tokenCoinId: string;
  childTokenAmount: bigint;
  extraDelta: bigint;
}

@Injectable({ providedIn: 'root' })
export class PoolEconomicsV2TokenAuthorizationService {
  private readonly wasm = inject(ChiaWasmService);
  private readonly economics = inject(PoolEconomicsV2Service);

  buildForAuthorization(args: {
    pool: PoolSingletonSpendContext;
    tokenCoinId: string;
    mintOrMelt: typeof TOKEN_MINT | typeof TOKEN_MELT;
    amount: BigintLike;
  }): PoolV2TokenAuthorizationMaterial {
    const mintOrMelt = this.normaliseMintOrMelt(args.mintOrMelt);
    const amount = bigint(args.amount);
    if (amount <= 0n) {
      throw new Error('pool-token-tail: amount must be positive');
    }
    const tokenCoinId = normalizeHex(args.tokenCoinId);
    atom32(tokenCoinId, 'tokenCoinId');

    const clvm = this.clvm();
    const innerPuzzle = clvm.deserialize(hexToBytes(normalizeHex(args.pool.poolInnerPuzzleHex)));
    const poolInnerPuzzleHash = bytesToHex(innerPuzzle.treeHash());
    const poolCoin = normalisePoolCoin(args.pool.poolCoin);
    const poolCoinId = this.poolCoinId(poolCoin);
    if (poolCoin.coinId && poolCoin.coinId !== poolCoinId) {
      throw new Error(
        `pool-token-tail: pool coin id ${poolCoin.coinId} does not match coin fields ${poolCoinId}`,
      );
    }

    const singletonStruct = this.singletonStruct(clvm, args.pool.poolLauncherId);
    const poolFullPuzzle = this.singletonFullPuzzle(clvm, singletonStruct, innerPuzzle);
    const poolFullPuzzleHash = bytesToHex(poolFullPuzzle.treeHash());
    if (poolFullPuzzleHash !== poolCoin.puzzleHash) {
      throw new Error(
        `pool-token-tail: built pool full puzzle hash ${poolFullPuzzleHash} does not match ` +
          `coin puzzle hash ${poolCoin.puzzleHash}`,
      );
    }

    const tail = this.poolTokenTail(clvm, args.pool.poolLauncherId);
    const tailSolution = clvm.list([
      clvm.atom(atom32(poolFullPuzzleHash, 'poolFullPuzzleHash')),
      clvm.atom(atom32(poolInnerPuzzleHash, 'poolInnerPuzzleHash')),
      clvm.atom(atom32(poolCoinId, 'poolCoinId')),
      clvm.atom(atom32(tokenCoinId, 'tokenCoinId')),
      clvm.int(BigInt(mintOrMelt)),
      clvm.int(amount),
    ]);
    const announcementMessage = this.economics.tokenAuthorizationMessage({
      mintOrMelt,
      tokenCoinId,
      amount,
    });
    const expectedPuzzleAnnouncementId = announcementId(poolFullPuzzleHash, announcementMessage);
    const decoded = this.replayTail(tail, tailSolution);
    if (!decoded.assertedPuzzleAnnouncementIds.includes(expectedPuzzleAnnouncementId)) {
      throw new Error(
        `pool-token-tail: TAIL did not assert expected pool announcement ` +
          `${expectedPuzzleAnnouncementId}`,
      );
    }
    if (!decoded.assertedCoinIds.includes(tokenCoinId)) {
      throw new Error(`pool-token-tail: TAIL did not assert token coin id ${tokenCoinId}`);
    }

    return {
      tailPuzzleHash: bytesToHex(tail.treeHash()),
      tailPuzzleReveal: bytesToHex(tail.serialize()),
      tailSolution: bytesToHex(tailSolution.serialize()),
      poolFullPuzzleHash,
      poolInnerPuzzleHash,
      poolCoinId,
      tokenCoinId,
      mintOrMelt,
      amount,
      announcementMessage,
      expectedPuzzleAnnouncementId,
      assertedPuzzleAnnouncementIds: decoded.assertedPuzzleAnnouncementIds,
      assertedCoinIds: decoded.assertedCoinIds,
    };
  }

  /**
   * Build a full CAT2 coin spend that carries the pool-token TAIL mint/melt
   * authorization.  The caller supplies the current token inner puzzle and
   * solution; this method wraps them in the CAT outer and verifies that the
   * inner conditions contain the expected CAT TAIL magic spend.
   */
  buildTokenAuthorizationCoinSpend(args: {
    pool: PoolSingletonSpendContext;
    tokenCoin: PoolV2TokenCatCoinInput;
    tokenLineageProof?: PoolV2TokenCatLineageProof | null;
    tokenInnerPuzzleHex: string;
    tokenInnerSolutionHex: string;
    mintOrMelt: typeof TOKEN_MINT | typeof TOKEN_MELT;
    amount: BigintLike;
  }): PoolV2TokenAuthorizationSpendBuild {
    const mintOrMelt = this.normaliseMintOrMelt(args.mintOrMelt);
    const amount = bigint(args.amount);
    if (amount <= 0n) {
      throw new Error('pool-token-cat: amount must be positive');
    }

    const clvm = this.clvm();
    const tokenCoin = normaliseTokenCoin(args.tokenCoin);
    const tokenCoinId = this.tokenCoinId(tokenCoin);
    if (tokenCoin.coinId && tokenCoin.coinId !== tokenCoinId) {
      throw new Error(
        `pool-token-cat: token coin id ${tokenCoin.coinId} does not match coin fields ` +
          tokenCoinId,
      );
    }

    const material = this.buildForAuthorization({
      pool: args.pool,
      tokenCoinId,
      mintOrMelt,
      amount,
    });
    const tokenInnerPuzzle = clvm.deserialize(hexToBytes(normalizeHex(args.tokenInnerPuzzleHex)));
    const tokenInnerSolution = clvm.deserialize(hexToBytes(normalizeHex(args.tokenInnerSolutionHex)));
    const tokenInnerPuzzleHash = bytesToHex(tokenInnerPuzzle.treeHash());
    const tokenFullPuzzle = this.curriedCatMod(clvm, {
      tailHash: hexToBytes(material.tailPuzzleHash),
      innerPuzzle: tokenInnerPuzzle,
    });
    const tokenFullPuzzleHash = bytesToHex(tokenFullPuzzle.treeHash());
    if (tokenFullPuzzleHash !== tokenCoin.puzzleHash) {
      throw new Error(
        `pool-token-cat: built CAT puzzle hash ${tokenFullPuzzleHash} does not match ` +
          `token coin puzzle hash ${tokenCoin.puzzleHash}`,
      );
    }

    const extraDelta = this.extraDeltaFor(mintOrMelt, amount);
    const childTokenAmount = tokenCoin.amount + extraDelta;
    if (childTokenAmount < 0n) {
      throw new Error('pool-token-cat: melt amount exceeds token coin amount');
    }
    this.verifyTokenInnerConditions({
      innerPuzzle: tokenInnerPuzzle,
      innerSolution: tokenInnerSolution,
      tokenCoinAmount: tokenCoin.amount,
      childTokenAmount,
      extraDelta,
      material,
    });

    const parent = hexToBytes(tokenCoin.parentCoinInfo);
    const fullPuzzleHash = hexToBytes(tokenFullPuzzleHash);
    const myInfo = clvm.list([
      clvm.atom(parent),
      clvm.atom(fullPuzzleHash),
      clvm.int(tokenCoin.amount),
    ]);
    const nextInfo = clvm.list([
      clvm.atom(parent),
      clvm.atom(hexToBytes(tokenInnerPuzzleHash)),
      clvm.int(tokenCoin.amount),
    ]);
    const outerSolution = clvm.list([
      tokenInnerSolution,
      this.encodeLineageProof(clvm, args.tokenLineageProof ?? null),
      clvm.atom(hexToBytes(tokenCoinId)),
      myInfo,
      nextInfo,
      clvm.int(0n),
      clvm.int(extraDelta),
    ]);

    return {
      material,
      coinSpend: {
        coin: {
          parentCoinInfo: tokenCoin.parentCoinInfo,
          puzzleHash: tokenCoin.puzzleHash,
          amount: tokenCoin.amount,
        },
        puzzleReveal: bytesToHex(tokenFullPuzzle.serialize()),
        solution: bytesToHex(outerSolution.serialize()),
      },
      tokenInnerPuzzleHash,
      tokenFullPuzzleHash,
      tokenCoinId,
      childTokenAmount,
      extraDelta,
    };
  }

  /**
   * Convenience builder for alpha/test custody CAT coins whose current inner
   * puzzle is ACS / p2-conditions.  Real wallet-owned token coins should use
   * {@link buildTokenAuthorizationCoinSpend} with the wallet's inner puzzle
   * and signed inner solution.
   */
  buildP2ConditionsAuthorizationCoinSpend(args: {
    pool: PoolSingletonSpendContext;
    tokenCoin: PoolV2TokenCatCoinInput;
    tokenLineageProof?: PoolV2TokenCatLineageProof | null;
    mintOrMelt: typeof TOKEN_MINT | typeof TOKEN_MELT;
    amount: BigintLike;
    childPuzzleHash?: string | null;
  }): PoolV2TokenAuthorizationSpendBuild {
    const mintOrMelt = this.normaliseMintOrMelt(args.mintOrMelt);
    const amount = bigint(args.amount);
    const clvm = this.clvm();
    const tokenCoin = normaliseTokenCoin(args.tokenCoin);
    const tokenCoinId = this.tokenCoinId(tokenCoin);
    const material = this.buildForAuthorization({
      pool: args.pool,
      tokenCoinId,
      mintOrMelt,
      amount,
    });
    const acsPuzzle = this.p2ConditionsPuzzle(clvm);
    const acsPuzzleHash = bytesToHex(acsPuzzle.treeHash());
    const extraDelta = this.extraDeltaFor(mintOrMelt, amount);
    const childTokenAmount = tokenCoin.amount + extraDelta;
    if (childTokenAmount < 0n) {
      throw new Error('pool-token-cat: melt amount exceeds token coin amount');
    }

    const conditions: ProgramShape[] = [];
    if (childTokenAmount > 0n) {
      const childPuzzleHash = normalizeHex(args.childPuzzleHash || acsPuzzleHash);
      conditions.push(clvm.list([
        clvm.int(BigInt(CREATE_COIN)),
        clvm.atom(atom32(childPuzzleHash, 'childPuzzleHash')),
        clvm.int(childTokenAmount),
      ]));
    }
    conditions.push(clvm.list([
      clvm.int(BigInt(CREATE_COIN)),
      clvm.int(0n),
      clvm.int(CAT_TAIL_MAGIC_AMOUNT),
      clvm.deserialize(hexToBytes(material.tailPuzzleReveal)),
      clvm.deserialize(hexToBytes(material.tailSolution)),
    ]));

    return this.buildTokenAuthorizationCoinSpend({
      pool: args.pool,
      tokenCoin: {
        parentCoinInfo: tokenCoin.parentCoinInfo,
        puzzleHash: tokenCoin.puzzleHash,
        amount: tokenCoin.amount,
        coinId: tokenCoin.coinId,
      },
      tokenLineageProof: args.tokenLineageProof,
      tokenInnerPuzzleHex: bytesToHex(acsPuzzle.serialize()),
      tokenInnerSolutionHex: bytesToHex(clvm.list(conditions).serialize()),
      mintOrMelt,
      amount,
    });
  }

  poolTokenAcsPuzzleHash(poolLauncherId: string): string {
    const clvm = this.clvm();
    return bytesToHex(this.curriedCatMod(clvm, {
      tailHash: this.poolTokenTail(clvm, poolLauncherId).treeHash(),
      innerPuzzle: this.p2ConditionsPuzzle(clvm),
    }).treeHash());
  }

  poolTokenCatPuzzleHash(args: { poolLauncherId: string; tokenInnerPuzzleHex: string }): string {
    const clvm = this.clvm();
    return bytesToHex(this.curriedCatMod(clvm, {
      tailHash: this.poolTokenTail(clvm, args.poolLauncherId).treeHash(),
      innerPuzzle: clvm.deserialize(hexToBytes(normalizeHex(args.tokenInnerPuzzleHex))),
    }).treeHash());
  }

  private poolTokenTail(clvm: ClvmShape, poolLauncherId: string): ProgramShape {
    return clvm.deserialize(hexToBytes(POOL_TOKEN_TAIL_PUZZLE_HEX)).curry([
      clvm.atom(atom32(SINGLETON_MOD_HASH, 'singletonModHash')),
      clvm.atom(atom32(poolLauncherId, 'poolLauncherId')),
      clvm.atom(atom32(SINGLETON_LAUNCHER_HASH, 'singletonLauncherHash')),
    ]);
  }

  private curriedCatMod(
    clvm: ClvmShape,
    args: { tailHash: Uint8Array; innerPuzzle: ProgramShape },
  ): ProgramShape {
    return clvm.deserialize(hexToBytes(CAT_MOD_PUZZLE_HEX)).curry([
      clvm.atom(hexToBytes(SgtDriverService.CAT_MOD_HASH)),
      clvm.atom(args.tailHash),
      args.innerPuzzle,
    ]);
  }

  private p2ConditionsPuzzle(clvm: ClvmShape): ProgramShape {
    return clvm.int(1n);
  }

  private singletonStruct(clvm: ClvmShape, poolLauncherId: string): ProgramShape {
    return clvm.pair(
      clvm.atom(atom32(SINGLETON_MOD_HASH, 'singletonModHash')),
      clvm.pair(
        clvm.atom(atom32(poolLauncherId, 'poolLauncherId')),
        clvm.atom(atom32(SINGLETON_LAUNCHER_HASH, 'singletonLauncherHash')),
      ),
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
      throw new Error('pool-token-tail: singleton top layer unavailable in WASM SDK');
    }
    return clvm.deserialize(topLayer).curry([singletonStruct, innerPuzzle]);
  }

  private replayTail(tail: ProgramShape, solution: ProgramShape): DecodedTailConditions {
    const output = tail.run?.(solution, POOL_V2_WITNESS_REPLAY_COST, false);
    if (!output) {
      throw new Error('pool-token-tail: chia-wallet-sdk-wasm Program.run unavailable');
    }
    return decodeTailConditions(output.value);
  }

  private verifyTokenInnerConditions(args: {
    innerPuzzle: ProgramShape;
    innerSolution: ProgramShape;
    tokenCoinAmount: bigint;
    childTokenAmount: bigint;
    extraDelta: bigint;
    material: PoolV2TokenAuthorizationMaterial;
  }): void {
    const output = args.innerPuzzle.run?.(args.innerSolution, POOL_V2_WITNESS_REPLAY_COST, false);
    if (!output) {
      throw new Error('pool-token-cat: chia-wallet-sdk-wasm Program.run unavailable');
    }
    const createCoins = decodeCreateCoinConditions(output.value);
    const hasTailMagic = createCoins.some((condition) =>
      condition.amount === CAT_TAIL_MAGIC_AMOUNT &&
      condition.extraArgs.length >= 2 &&
      bytesToHex(condition.extraArgs[0].serialize()) === args.material.tailPuzzleReveal &&
      bytesToHex(condition.extraArgs[1].serialize()) === args.material.tailSolution
    );
    if (!hasTailMagic) {
      throw new Error('pool-token-cat: inner solution does not include expected TAIL magic spend');
    }
    let positiveOutputTotal = 0n;
    for (const condition of createCoins) {
      if (condition.amount === CAT_TAIL_MAGIC_AMOUNT) continue;
      if (condition.amount < 0n) {
        throw new Error('pool-token-cat: token inner solution contains a negative CREATE_COIN');
      }
      positiveOutputTotal += condition.amount;
    }
    const catAccountingInput = -args.extraDelta + positiveOutputTotal;
    if (catAccountingInput !== args.tokenCoinAmount) {
      throw new Error(
        `pool-token-cat: CAT accounting mismatch; expected input ${args.tokenCoinAmount}, ` +
          `got ${catAccountingInput}`,
      );
    }
    if (positiveOutputTotal !== args.childTokenAmount) {
      throw new Error(
        `pool-token-cat: child token amount ${positiveOutputTotal} does not match expected ` +
          args.childTokenAmount,
      );
    }
  }

  private poolCoinId(coin: NormalisedPoolCoin): string {
    return normalizeHex(coinId(coin.parentCoinInfo, coin.puzzleHash, coin.amount));
  }

  private tokenCoinId(coin: NormalisedTokenCoin): string {
    return normalizeHex(coinId(coin.parentCoinInfo, coin.puzzleHash, coin.amount));
  }

  private encodeLineageProof(
    clvm: ClvmShape,
    proof: PoolV2TokenCatLineageProof | null | undefined,
  ): ProgramShape {
    if (!proof || (!proof.parentName && !proof.innerPuzzleHash && (proof.amount === undefined || proof.amount === null))) {
      return clvm.nil();
    }
    const parentName = proof.parentName ? normalizeHex(proof.parentName) : null;
    const innerPuzzleHash = proof.innerPuzzleHash ? normalizeHex(proof.innerPuzzleHash) : null;
    const amount =
      proof.amount === undefined || proof.amount === null ? null : bigint(proof.amount);
    if (parentName && !innerPuzzleHash && amount === null) {
      return clvm.list([clvm.atom(atom32(parentName, 'lineageProof.parentName'))]);
    }
    if (!parentName || !innerPuzzleHash || amount === null) {
      throw new Error(
        'pool-token-cat: token lineage proof must be empty, parent-only, or fully populated',
      );
    }
    return clvm.list([
      clvm.atom(atom32(parentName, 'lineageProof.parentName')),
      clvm.atom(atom32(innerPuzzleHash, 'lineageProof.innerPuzzleHash')),
      clvm.int(amount),
    ]);
  }

  private extraDeltaFor(mintOrMelt: typeof TOKEN_MINT | typeof TOKEN_MELT, amount: bigint): bigint {
    return mintOrMelt === TOKEN_MINT ? amount : -amount;
  }

  private normaliseMintOrMelt(value: number): typeof TOKEN_MINT | typeof TOKEN_MELT {
    if (value !== TOKEN_MINT && value !== TOKEN_MELT) {
      throw new Error('pool-token-tail: mintOrMelt must be TOKEN_MINT or TOKEN_MELT');
    }
    return value;
  }

  private clvm(): ClvmShape {
    const Clvm = this.sdk().Clvm;
    return new Clvm();
  }

  private sdk(): SdkShape {
    const sdk = this.wasm.sdk() as SdkShape | undefined;
    if (!sdk?.Clvm) {
      throw new Error('pool-token-tail: chia-wallet-sdk-wasm Clvm export unavailable');
    }
    return sdk;
  }
}

interface DecodedTailConditions {
  assertedPuzzleAnnouncementIds: string[];
  assertedCoinIds: string[];
}

const ASSERT_PUZZLE_ANNOUNCEMENT = 63;
const CREATE_COIN = 51;
const ASSERT_MY_COIN_ID = 70;
const CAT_TAIL_MAGIC_AMOUNT = -113n;

function decodeTailConditions(value: ProgramShape): DecodedTailConditions {
  const decoded: DecodedTailConditions = {
    assertedPuzzleAnnouncementIds: [],
    assertedCoinIds: [],
  };
  for (const condition of value.toList?.() ?? []) {
    const parts = condition.toList?.() ?? [];
    const opcode = atomAsNumber(parts[0]);
    const payload = parts[1]?.toAtom?.();
    if (!payload) continue;
    if (opcode === ASSERT_PUZZLE_ANNOUNCEMENT) {
      decoded.assertedPuzzleAnnouncementIds.push(bytesToHex(payload));
    } else if (opcode === ASSERT_MY_COIN_ID) {
      decoded.assertedCoinIds.push(bytesToHex(payload));
    }
  }
  return decoded;
}

interface DecodedCreateCoinCondition {
  amount: bigint;
  extraArgs: ProgramShape[];
}

function decodeCreateCoinConditions(value: ProgramShape): DecodedCreateCoinCondition[] {
  const out: DecodedCreateCoinCondition[] = [];
  for (const condition of value.toList?.() ?? []) {
    const parts = condition.toList?.() ?? [];
    if (atomAsNumber(parts[0]) !== CREATE_COIN) continue;
    const amount = parts[2]?.toInt?.();
    if (typeof amount !== 'bigint') {
      throw new Error('pool-token-cat: CREATE_COIN amount is not an integer');
    }
    out.push({
      amount,
      extraArgs: parts.slice(3),
    });
  }
  return out;
}

function announcementId(sourceId: string, message: string): string {
  return normalizeHex(sha256(concatBytes([
    hexToBytes(normalizeHex(sourceId)),
    hexToBytes(normalizeHex(message)),
  ])));
}

function atomAsNumber(program: ProgramShape | undefined): number | null {
  const value = program?.toInt?.();
  if (typeof value !== 'bigint') return null;
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

interface NormalisedPoolCoin {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: bigint;
  coinId: string | null;
}

interface NormalisedTokenCoin {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: bigint;
  coinId: string | null;
}

function normalisePoolCoin(coin: PoolCoinInput): NormalisedPoolCoin {
  const amount = bigint(coin.amount);
  if (amount <= 0n) {
    throw new Error('pool-token-tail: pool coin amount must be positive');
  }
  return {
    parentCoinInfo: normalizeHex(coin.parentCoinInfo),
    puzzleHash: normalizeHex(coin.puzzleHash),
    amount,
    coinId: coin.coinId ? normalizeHex(coin.coinId) : null,
  };
}

function normaliseTokenCoin(coin: PoolV2TokenCatCoinInput): NormalisedTokenCoin {
  const amount = bigint(coin.amount);
  if (amount < 0n) {
    throw new Error('pool-token-cat: token coin amount cannot be negative');
  }
  return {
    parentCoinInfo: normalizeHex(coin.parentCoinInfo),
    puzzleHash: normalizeHex(coin.puzzleHash),
    amount,
    coinId: coin.coinId ? normalizeHex(coin.coinId) : null,
  };
}

function atom32(hex: string, field: string): Uint8Array {
  const bytes = hexToBytes(normalizeHex(hex));
  if (bytes.length !== 32) {
    throw new Error(`${field} must be 32 bytes`);
  }
  return bytes;
}

function bigint(value: BigintLike): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error('numeric value must be an integer');
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error('numeric string must be an integer');
  }
  return BigInt(trimmed);
}

function normalizeHex(hex: string): string {
  const prefixed = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (prefixed.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(prefixed)) {
    throw new Error(`invalid hex: ${hex}`);
  }
  return `0x${prefixed.toLowerCase()}`;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

interface ProgramShape {
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
  curry(args: ProgramShape[]): ProgramShape;
  run?(
    solution: ProgramShape,
    maxCost: bigint,
    mempoolMode: boolean,
  ): { value: ProgramShape; cost: bigint };
  toList?: () => ProgramShape[] | undefined;
  toAtom?: () => Uint8Array;
  toInt?: () => bigint;
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  atom(value: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
  list(value: ProgramShape[]): ProgramShape;
  nil(): ProgramShape;
  pair(first: ProgramShape, rest: ProgramShape): ProgramShape;
}

interface SdkShape {
  Clvm: new () => ClvmShape;
  Constants?: {
    singletonTopLayer?: () => Uint8Array;
    singletonTopLayerV11?: () => Uint8Array;
  };
}
