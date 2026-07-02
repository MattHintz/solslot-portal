import { Injectable, inject } from '@angular/core';

import { bytesToHex, coinId, hexToBytes } from '../utils/chia-hash';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import {
  ChiaSingletonReaderService,
  ReplayedSpend,
  SingletonLineage,
  SingletonLineageNode,
} from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { P2_VAULT_CURRENT_PUZZLE_HEX } from './p2-vault-current.puzzle-hex';
import {
  BigintLike,
  DEED_SPEND_POOL_DEPOSIT,
  DEED_SPEND_POOL_REDEEM,
  PoolEconomicsV2Service,
} from './pool-economics-v2.service';
import {
  PoolSingletonSpendContext,
  PoolEconomicsV2SpendBuilderService,
  SINGLETON_MOD_HASH,
  SINGLETON_LAUNCHER_HASH,
} from './pool-economics-v2-spend-builder.service';

@Injectable({ providedIn: 'root' })
export class PoolEconomicsV2DeedWitnessService {
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly wasm = inject(ChiaWasmService);
  private readonly economics = inject(PoolEconomicsV2Service);
  private readonly spendBuilder = inject(PoolEconomicsV2SpendBuilderService);

  async buildRedeemWitness(
    args: BuildPoolV2DeedRedeemWitnessArgs,
  ): Promise<PoolV2DeedWitnessEvidence> {
    const deedLauncherId = normalize32(args.deedLauncherId);
    const vaultLauncherId = normalize32(args.vaultLauncherId);
    const launcherPuzzleHash = normalize32(args.launcherPuzzleHash || SINGLETON_LAUNCHER_HASH);
    const collectionIdCanon = normalize32(args.collectionIdCanon);
    if (!deedLauncherId) {
      return { kind: 'read-failed', error: 'deedLauncherId must be a 32-byte hex string.' };
    }
    if (!vaultLauncherId) {
      return { kind: 'read-failed', error: 'vaultLauncherId must be a 32-byte hex string.' };
    }
    if (!launcherPuzzleHash) {
      return { kind: 'read-failed', error: 'launcherPuzzleHash must be a 32-byte hex string.' };
    }
    if (!collectionIdCanon) {
      return { kind: 'read-failed', error: 'collectionIdCanon must be a 32-byte hex string.' };
    }
    if (!this.wasm.ready()) {
      return { kind: 'read-failed', error: 'Chia WASM is not ready.' };
    }

    let lineage: SingletonLineage | null;
    try {
      lineage = await this.singleton.walkLineage(deedLauncherId);
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
    if (!lineage) {
      return { kind: 'not-launched', deedLauncherId };
    }

    const live = lineage.nodes[lineage.nodes.length - 1] ?? null;
    if (!live || live.isLauncher) {
      return { kind: 'not-launched', deedLauncherId, launcherCoinId: lineage.launcherCoinId };
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
        deedLauncherId,
        liveCoinId: live.coinId,
        livePuzzleHash: live.puzzleHash,
        confirmedBlockIndex: live.confirmedBlockIndex,
        lineageDepth: lineage.nodes.length - 1,
      };
    }

    try {
      return this.buildConfirmedRedeemWitness({
        ...args,
        deedLauncherId,
        vaultLauncherId,
        launcherPuzzleHash,
        collectionIdCanon,
        live,
        replay,
        lineageDepth: lineage.nodes.length - 1,
      });
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
  }

  async buildDepositWitness(
    args: BuildPoolV2DeedDepositWitnessArgs,
  ): Promise<PoolV2DeedWitnessEvidence> {
    const deedLauncherId = normalize32(args.deedLauncherId);
    const launcherPuzzleHash = normalize32(args.launcherPuzzleHash || SINGLETON_LAUNCHER_HASH);
    const collectionIdCanon = normalize32(args.collectionIdCanon);
    const propertyIdCanon = normalize32(args.propertyIdCanon);
    if (!deedLauncherId) {
      return { kind: 'read-failed', error: 'deedLauncherId must be a 32-byte hex string.' };
    }
    if (!launcherPuzzleHash) {
      return { kind: 'read-failed', error: 'launcherPuzzleHash must be a 32-byte hex string.' };
    }
    if (!collectionIdCanon) {
      return { kind: 'read-failed', error: 'collectionIdCanon must be a 32-byte hex string.' };
    }
    if (!propertyIdCanon) {
      return { kind: 'read-failed', error: 'propertyIdCanon must be a 32-byte hex string.' };
    }
    if (!this.wasm.ready()) {
      return { kind: 'read-failed', error: 'Chia WASM is not ready.' };
    }

    let lineage: SingletonLineage | null;
    try {
      lineage = await this.singleton.walkLineage(deedLauncherId);
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
    if (!lineage) {
      return { kind: 'not-launched', deedLauncherId };
    }

    const live = lineage.nodes[lineage.nodes.length - 1] ?? null;
    if (!live || live.isLauncher) {
      return { kind: 'not-launched', deedLauncherId, launcherCoinId: lineage.launcherCoinId };
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
        deedLauncherId,
        liveCoinId: live.coinId,
        livePuzzleHash: live.puzzleHash,
        confirmedBlockIndex: live.confirmedBlockIndex,
        lineageDepth: lineage.nodes.length - 1,
      };
    }

    try {
      return this.buildConfirmedDepositWitness({
        ...args,
        deedLauncherId,
        launcherPuzzleHash,
        collectionIdCanon,
        propertyIdCanon,
        live,
        replay,
        lineageDepth: lineage.nodes.length - 1,
      });
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
  }

  private buildConfirmedRedeemWitness(
    args: RequiredNormalizedRedeemWitnessArgs,
  ): PoolV2DeedWitnessEvidence {
    const clvm = this.clvm();
    const deedInner = clvm.deserialize(hexToBytes(normalizeHex(args.deedInnerPuzzleHex)));
    const decoded = decodeSmartDeedInner(deedInner);
    const requestedSharePpm = bigint(args.sharePpm);
    if (!sameHex(decoded.launcherId, args.deedLauncherId)) {
      return {
        kind: 'mismatch',
        reason: 'launcher-id',
        expected: args.deedLauncherId,
        actual: decoded.launcherId,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }
    if (!sameHex(decoded.collectionIdCanon, args.collectionIdCanon)) {
      return {
        kind: 'mismatch',
        reason: 'collection-id',
        expected: args.collectionIdCanon,
        actual: decoded.collectionIdCanon,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }
    if (decoded.sharePpm !== requestedSharePpm) {
      return {
        kind: 'mismatch',
        reason: 'share-ppm',
        expected: requestedSharePpm.toString(),
        actual: decoded.sharePpm.toString(),
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }
    if (!sameHex(decoded.poolSingletonModHash, SINGLETON_MOD_HASH)) {
      return {
        kind: 'mismatch',
        reason: 'pool-singleton-mod-hash',
        expected: normalizeHex(SINGLETON_MOD_HASH),
        actual: decoded.poolSingletonModHash,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }
    const expectedP2VaultModHash = bytesToHex(
      clvm.deserialize(hexToBytes(P2_VAULT_CURRENT_PUZZLE_HEX)).treeHash(),
    );
    if (!sameHex(decoded.p2VaultModHash, expectedP2VaultModHash)) {
      return {
        kind: 'mismatch',
        reason: 'p2-vault-mod-hash',
        expected: expectedP2VaultModHash,
        actual: decoded.p2VaultModHash,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }

    const fullPuzzle = singletonFullPuzzle(this.sdk(), clvm, decoded.singletonStruct, deedInner);
    const fullPuzzleHash = bytesToHex(fullPuzzle.treeHash());
    if (!sameHex(fullPuzzleHash, args.live.puzzleHash)) {
      return {
        kind: 'mismatch',
        reason: 'live-puzzle-hash',
        expected: args.live.puzzleHash,
        actual: fullPuzzleHash,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }

    const expectedCoinId = coinId(args.live.parentCoinId, args.live.puzzleHash, BigInt(args.live.amount));
    if (!sameHex(expectedCoinId, args.live.coinId)) {
      return {
        kind: 'mismatch',
        reason: 'live-coin-id',
        expected: args.live.coinId,
        actual: expectedCoinId,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }

    const previousInnerPuzzleHash = previousSingletonInnerPuzzleHash(clvm, args.replay);
    const poolInnerPuzzleHash = bytesToHex(
      clvm.deserialize(hexToBytes(normalizeHex(args.pool.poolInnerPuzzleHex))).treeHash(),
    );
    const amount = BigInt(args.live.amount);
    const deedInnerPuzzleHash = bytesToHex(deedInner.treeHash());
    const p2VaultPuzzleHash = this.spendBuilder.p2VaultPuzzleHash(
      args.vaultLauncherId,
      args.launcherPuzzleHash,
    );
    const deedMessage = this.economics.deedPoolRedeemMessage({
      deedId: args.live.coinId,
      p2VaultPuzzleHash,
      collectionIdCanon: args.collectionIdCanon,
      sharePpm: args.sharePpm,
    });
    const innerSolution = clvm.list([
      clvm.atom(hexToBytes(args.live.coinId)),
      clvm.atom(hexToBytes(deedInnerPuzzleHash)),
      clvm.int(amount),
      clvm.int(BigInt(DEED_SPEND_POOL_REDEEM)),
      clvm.list([
        clvm.atom(hexToBytes(args.pool.poolLauncherId)),
        clvm.atom(hexToBytes(poolInnerPuzzleHash)),
        clvm.atom(hexToBytes(args.launcherPuzzleHash)),
        clvm.atom(hexToBytes(args.vaultLauncherId)),
      ]),
    ]);
    const fullSolution = clvm.list([
      encodeLineageProof(clvm, {
        parentName: args.replay.node.parentCoinId,
        innerPuzzleHash: previousInnerPuzzleHash,
        amount: args.replay.node.amount,
      }),
      clvm.int(amount),
      innerSolution,
    ]);
    const deedSpend: UnsignedCoinSpend = {
      coin: {
        parentCoinInfo: args.live.parentCoinId,
        puzzleHash: args.live.puzzleHash,
        amount,
      },
      puzzleReveal: bytesToHex(fullPuzzle.serialize()),
      solution: bytesToHex(fullSolution.serialize()),
    };
    return {
      kind: 'confirmed-redeem',
      deedLauncherId: args.deedLauncherId,
      deedCoinId: args.live.coinId,
      deedPuzzleHash: args.live.puzzleHash,
      deedInnerPuzzleHash,
      previousInnerPuzzleHash,
      p2VaultPuzzleHash,
      vaultLauncherId: args.vaultLauncherId,
      launcherPuzzleHash: args.launcherPuzzleHash,
      collectionIdCanon: args.collectionIdCanon,
      sharePpm: requestedSharePpm,
      deedMessage,
      deedSpend,
      confirmedBlockIndex: args.live.confirmedBlockIndex,
      lineageDepth: args.lineageDepth,
      latestSpendCoinId: args.replay.node.coinId,
      latestSpentBlockIndex: args.replay.node.spentBlockIndex,
    };
  }

  private buildConfirmedDepositWitness(
    args: RequiredNormalizedDepositWitnessArgs,
  ): PoolV2DeedWitnessEvidence {
    const clvm = this.clvm();
    const deedInner = clvm.deserialize(hexToBytes(normalizeHex(args.deedInnerPuzzleHex)));
    const decoded = decodeSmartDeedInner(deedInner);
    const requestedSharePpm = bigint(args.sharePpm);
    const requestedParValueMojos = bigint(args.parValueMojos);
    const requestedAssetClass = bigint(args.assetClass);
    if (!sameHex(decoded.launcherId, args.deedLauncherId)) {
      return {
        kind: 'mismatch',
        reason: 'launcher-id',
        expected: args.deedLauncherId,
        actual: decoded.launcherId,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }
    if (!sameHex(decoded.propertyIdCanon, args.propertyIdCanon)) {
      return {
        kind: 'mismatch',
        reason: 'property-id',
        expected: args.propertyIdCanon,
        actual: decoded.propertyIdCanon,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }
    if (!sameHex(decoded.collectionIdCanon, args.collectionIdCanon)) {
      return {
        kind: 'mismatch',
        reason: 'collection-id',
        expected: args.collectionIdCanon,
        actual: decoded.collectionIdCanon,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }
    if (decoded.parValueMojos !== requestedParValueMojos) {
      return {
        kind: 'mismatch',
        reason: 'par-value',
        expected: requestedParValueMojos.toString(),
        actual: decoded.parValueMojos.toString(),
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }
    if (decoded.assetClass !== requestedAssetClass) {
      return {
        kind: 'mismatch',
        reason: 'asset-class',
        expected: requestedAssetClass.toString(),
        actual: decoded.assetClass.toString(),
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }
    if (decoded.sharePpm !== requestedSharePpm) {
      return {
        kind: 'mismatch',
        reason: 'share-ppm',
        expected: requestedSharePpm.toString(),
        actual: decoded.sharePpm.toString(),
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }
    if (!sameHex(decoded.poolSingletonModHash, SINGLETON_MOD_HASH)) {
      return {
        kind: 'mismatch',
        reason: 'pool-singleton-mod-hash',
        expected: normalizeHex(SINGLETON_MOD_HASH),
        actual: decoded.poolSingletonModHash,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }

    const fullPuzzle = singletonFullPuzzle(this.sdk(), clvm, decoded.singletonStruct, deedInner);
    const fullPuzzleHash = bytesToHex(fullPuzzle.treeHash());
    if (!sameHex(fullPuzzleHash, args.live.puzzleHash)) {
      return {
        kind: 'mismatch',
        reason: 'live-puzzle-hash',
        expected: args.live.puzzleHash,
        actual: fullPuzzleHash,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }

    const expectedCoinId = coinId(args.live.parentCoinId, args.live.puzzleHash, BigInt(args.live.amount));
    if (!sameHex(expectedCoinId, args.live.coinId)) {
      return {
        kind: 'mismatch',
        reason: 'live-coin-id',
        expected: args.live.coinId,
        actual: expectedCoinId,
        liveCoinId: args.live.coinId,
        livePuzzleHash: args.live.puzzleHash,
      };
    }

    const previousInnerPuzzleHash = previousSingletonInnerPuzzleHash(clvm, args.replay);
    const poolInnerPuzzleHash = bytesToHex(
      clvm.deserialize(hexToBytes(normalizeHex(args.pool.poolInnerPuzzleHex))).treeHash(),
    );
    const amount = BigInt(args.live.amount);
    const deedInnerPuzzleHash = bytesToHex(deedInner.treeHash());
    const deedMessage = this.economics.deedPoolDepositMessage({
      deedId: args.live.coinId,
      parValueMojos: requestedParValueMojos,
      assetClass: requestedAssetClass,
      propertyIdCanon: args.propertyIdCanon,
      collectionIdCanon: args.collectionIdCanon,
      sharePpm: requestedSharePpm,
    });
    const innerSolution = clvm.list([
      clvm.atom(hexToBytes(args.live.coinId)),
      clvm.atom(hexToBytes(deedInnerPuzzleHash)),
      clvm.int(amount),
      clvm.int(BigInt(DEED_SPEND_POOL_DEPOSIT)),
      clvm.list([
        clvm.atom(hexToBytes(args.pool.poolLauncherId)),
        clvm.atom(hexToBytes(poolInnerPuzzleHash)),
        clvm.atom(hexToBytes(args.launcherPuzzleHash)),
      ]),
    ]);
    const fullSolution = clvm.list([
      encodeLineageProof(clvm, {
        parentName: args.replay.node.parentCoinId,
        innerPuzzleHash: previousInnerPuzzleHash,
        amount: args.replay.node.amount,
      }),
      clvm.int(amount),
      innerSolution,
    ]);
    const deedSpend: UnsignedCoinSpend = {
      coin: {
        parentCoinInfo: args.live.parentCoinId,
        puzzleHash: args.live.puzzleHash,
        amount,
      },
      puzzleReveal: bytesToHex(fullPuzzle.serialize()),
      solution: bytesToHex(fullSolution.serialize()),
    };
    return {
      kind: 'confirmed-deposit',
      deedLauncherId: args.deedLauncherId,
      deedCoinId: args.live.coinId,
      deedPuzzleHash: args.live.puzzleHash,
      deedInnerPuzzleHash,
      previousInnerPuzzleHash,
      launcherPuzzleHash: args.launcherPuzzleHash,
      propertyIdCanon: args.propertyIdCanon,
      parValueMojos: requestedParValueMojos,
      assetClass: requestedAssetClass,
      collectionIdCanon: args.collectionIdCanon,
      sharePpm: requestedSharePpm,
      deedMessage,
      deedSpend,
      confirmedBlockIndex: args.live.confirmedBlockIndex,
      lineageDepth: args.lineageDepth,
      latestSpendCoinId: args.replay.node.coinId,
      latestSpentBlockIndex: args.replay.node.spentBlockIndex,
    };
  }

  private clvm(): ClvmShape {
    const Clvm = this.sdk().Clvm;
    return new Clvm();
  }

  private sdk(): SdkShape {
    const sdk = this.wasm.sdk() as SdkShape | undefined;
    if (!sdk?.Clvm) {
      throw new Error('pool-v2-deed-witness: chia-wallet-sdk-wasm Clvm export unavailable');
    }
    return sdk;
  }
}

export interface BuildPoolV2DeedRedeemWitnessArgs {
  deedLauncherId: string;
  deedInnerPuzzleHex: string;
  pool: PoolSingletonSpendContext;
  vaultLauncherId: string;
  launcherPuzzleHash?: string | null;
  collectionIdCanon: string;
  sharePpm: BigintLike;
}

export interface BuildPoolV2DeedDepositWitnessArgs {
  deedLauncherId: string;
  deedInnerPuzzleHex: string;
  pool: PoolSingletonSpendContext;
  launcherPuzzleHash?: string | null;
  propertyIdCanon: string;
  parValueMojos: BigintLike;
  assetClass: BigintLike;
  collectionIdCanon: string;
  sharePpm: BigintLike;
}

export type PoolV2DeedWitnessEvidence =
  | {
      kind: 'confirmed-redeem';
      deedLauncherId: string;
      deedCoinId: string;
      deedPuzzleHash: string;
      deedInnerPuzzleHash: string;
      previousInnerPuzzleHash: string;
      p2VaultPuzzleHash: string;
      vaultLauncherId: string;
      launcherPuzzleHash: string;
      collectionIdCanon: string;
      sharePpm: bigint;
      deedMessage: string;
      deedSpend: UnsignedCoinSpend;
      confirmedBlockIndex: number;
      lineageDepth: number;
      latestSpendCoinId: string;
      latestSpentBlockIndex: number | null;
    }
  | {
      kind: 'confirmed-deposit';
      deedLauncherId: string;
      deedCoinId: string;
      deedPuzzleHash: string;
      deedInnerPuzzleHash: string;
      previousInnerPuzzleHash: string;
      launcherPuzzleHash: string;
      propertyIdCanon: string;
      parValueMojos: bigint;
      assetClass: bigint;
      collectionIdCanon: string;
      sharePpm: bigint;
      deedMessage: string;
      deedSpend: UnsignedCoinSpend;
      confirmedBlockIndex: number;
      lineageDepth: number;
      latestSpendCoinId: string;
      latestSpentBlockIndex: number | null;
    }
  | {
      kind: 'mismatch';
      reason:
        | 'launcher-id'
        | 'property-id'
        | 'collection-id'
        | 'par-value'
        | 'asset-class'
        | 'share-ppm'
        | 'pool-singleton-mod-hash'
        | 'p2-vault-mod-hash'
        | 'live-puzzle-hash'
        | 'live-coin-id';
      expected: string;
      actual: string;
      liveCoinId: string;
      livePuzzleHash: string;
    }
  | {
      kind: 'not-spent';
      deedLauncherId: string;
      liveCoinId: string;
      livePuzzleHash: string;
      confirmedBlockIndex: number;
      lineageDepth: number;
    }
  | { kind: 'not-launched'; deedLauncherId: string; launcherCoinId?: string }
  | { kind: 'read-failed'; error: string };

interface RequiredNormalizedRedeemWitnessArgs extends BuildPoolV2DeedRedeemWitnessArgs {
  deedLauncherId: string;
  vaultLauncherId: string;
  launcherPuzzleHash: string;
  collectionIdCanon: string;
  live: SingletonLineageNode;
  replay: ReplayedSpend;
  lineageDepth: number;
}

interface RequiredNormalizedDepositWitnessArgs extends BuildPoolV2DeedDepositWitnessArgs {
  deedLauncherId: string;
  launcherPuzzleHash: string;
  propertyIdCanon: string;
  collectionIdCanon: string;
  live: SingletonLineageNode;
  replay: ReplayedSpend;
  lineageDepth: number;
}

interface DecodedSmartDeedInner {
  singletonStruct: ProgramShape;
  launcherId: string;
  parValueMojos: bigint;
  assetClass: bigint;
  propertyIdCanon: string;
  collectionIdCanon: string;
  sharePpm: bigint;
  poolSingletonModHash: string;
  p2VaultModHash: string;
}

interface ProgramShape {
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
  curry(args: ProgramShape[]): ProgramShape;
  uncurry(): UncurriedProgramShape | null | undefined;
  toList(): ProgramShape[] | null | undefined;
  toAtom(): Uint8Array | null | undefined;
  toInt(): bigint;
  first(): ProgramShape;
  rest(): ProgramShape;
}

interface UncurriedProgramShape {
  program: ProgramShape;
  args: ProgramShape[] | ProgramShape;
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  atom(value: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
  list(value: ProgramShape[]): ProgramShape;
}

interface SdkShape {
  Clvm: new () => ClvmShape;
  Constants?: {
    singletonTopLayer?: () => Uint8Array;
    singletonTopLayerV11?: () => Uint8Array;
  };
}

function decodeSmartDeedInner(inner: ProgramShape): DecodedSmartDeedInner {
  const uncurried = inner.uncurry();
  const args = uncurried ? curriedArgs(uncurried, 'smart deed inner puzzle') : null;
  if (!uncurried || !args || args.length !== 13) {
    throw new Error(`smart deed inner puzzle expects 13 curried args, got ${args?.length ?? 0}.`);
  }
  const struct = args[0];
  return {
    singletonStruct: struct,
    launcherId: bytesToHex(bytes32Atom(struct.rest().first(), 'SINGLETON_STRUCT.launcher_id')),
    parValueMojos: requireInt(args[2], 'PAR_VALUE'),
    assetClass: requireInt(args[3], 'ASSET_CLASS'),
    propertyIdCanon: bytesToHex(bytes32Atom(args[4], 'PROPERTY_ID')),
    collectionIdCanon: bytesToHex(bytes32Atom(args[5], 'COLLECTION_ID_CANON')),
    sharePpm: requireInt(args[6], 'SHARE_PPM'),
    poolSingletonModHash: bytesToHex(bytes32Atom(args[10], 'POOL_SINGLETON_MOD_HASH')),
    p2VaultModHash: bytesToHex(bytes32Atom(args[12], 'P2_VAULT_MOD_HASH')),
  };
}

function previousSingletonInnerPuzzleHash(clvm: ClvmShape, replay: ReplayedSpend): string {
  const full = clvm.deserialize(hexToBytes(normalizeHex(replay.puzzleAndSolution.puzzleReveal)));
  const uncurried = full.uncurry();
  const args = uncurried ? curriedArgs(uncurried, 'previous deed singleton puzzle') : null;
  if (!uncurried || !args || args.length !== 2) {
    throw new Error('Latest deed spend puzzle reveal is not a curried singleton.');
  }
  return bytesToHex(args[1].treeHash());
}

function singletonFullPuzzle(
  sdk: SdkShape,
  clvm: ClvmShape,
  singletonStruct: ProgramShape,
  innerPuzzle: ProgramShape,
): ProgramShape {
  const topLayer = sdk.Constants?.singletonTopLayerV11?.() ?? sdk.Constants?.singletonTopLayer?.();
  if (!topLayer) {
    throw new Error('pool-v2-deed-witness: singleton top layer unavailable in WASM SDK');
  }
  return clvm.deserialize(topLayer).curry([singletonStruct, innerPuzzle]);
}

function encodeLineageProof(
  clvm: ClvmShape,
  proof: { parentName: string; innerPuzzleHash: string; amount: number | bigint },
): ProgramShape {
  return clvm.list([
    clvm.atom(hexToBytes(normalize32Required(proof.parentName, 'lineage.parentName'))),
    clvm.atom(hexToBytes(normalize32Required(proof.innerPuzzleHash, 'lineage.innerPuzzleHash'))),
    clvm.int(BigInt(proof.amount)),
  ]);
}

function curriedArgs(uncurried: UncurriedProgramShape, label: string): ProgramShape[] {
  if (Array.isArray(uncurried.args)) return uncurried.args;
  const args = uncurried.args.toList();
  if (!args) {
    throw new Error(`${label} curried args must be a CLVM list.`);
  }
  return args;
}

function bytes32Atom(node: ProgramShape, label: string): Uint8Array {
  const atom = node.toAtom();
  if (!atom) throw new Error(`${label} must be a CLVM atom.`);
  if (atom.length !== 32) {
    throw new Error(`${label} must be 32 bytes, got ${atom.length}.`);
  }
  return atom;
}

function requireInt(node: ProgramShape, label: string): bigint {
  try {
    return node.toInt();
  } catch {
    throw new Error(`${label} must be a CLVM integer.`);
  }
}

function normalize32(value: string | null | undefined): string | null {
  if (!value) return null;
  const normal = normalizeHex(value);
  return /^0x[0-9a-f]{64}$/.test(normal) ? normal : null;
}

function normalize32Required(value: string, label: string): string {
  const normal = normalize32(value);
  if (!normal) throw new Error(`${label} must be a 32-byte hex string.`);
  return normal;
}

function normalizeHex(hex: string): string {
  const body = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) {
    throw new Error(`invalid hex: ${hex}`);
  }
  return `0x${body.toLowerCase()}`;
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

function sameHex(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
