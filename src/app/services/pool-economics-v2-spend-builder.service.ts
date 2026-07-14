import { Injectable, inject } from '@angular/core';
import { sha256 } from 'ethers';

import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import { P2_VAULT_CURRENT_PUZZLE_HEX } from './p2-vault-current.puzzle-hex';
import {
  type CollectionNavEvidenceInput,
  type PoolEconomicStateInput,
  type PoolV2ActionSpec,
  PoolEconomicsV2Service,
  POOL_V2_RESERVE_ACQUISITION_TAG,
  POOL_V2_SPECIFIC_DEED_SWAP_TAG,
  POOL_V2_TRUE_REDEMPTION_TAG,
  type ReserveAcquisitionQuote,
  type SpecificDeedSwapQuote,
  type TrueRedemptionQuote,
  type BigintLike,
} from './pool-economics-v2.service';
import { ChiaWasmService } from './chia-wasm.service';

export const POOL_SPEND_V2_SPECIFIC_DEED_SWAP = 6;
export const POOL_SPEND_V2_TRUE_REDEMPTION = 7;
export const POOL_SPEND_V2_RESERVE_ACQUISITION = 8;
export const POOL_V2_MAX_WITNESS_COIN_SPENDS = 4;
export const POOL_V2_MAX_UNSIGNED_BUNDLE_COIN_SPENDS = 1 + POOL_V2_MAX_WITNESS_COIN_SPENDS;
export const POOL_V2_WITNESS_REPLAY_COST = 11_000_000n;

export const SINGLETON_MOD_HASH =
  '0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
export const SINGLETON_LAUNCHER_HASH =
  '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';

export interface PoolInnerSolutionContext {
  poolCoinId: string;
  poolInnerPuzzleHash: string;
  poolAmount: BigintLike;
}

export interface PoolCoinInput {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: BigintLike;
  coinId?: string | null;
}

export interface PoolSingletonLineageProof {
  parentName?: string | null;
  innerPuzzleHash?: string | null;
  amount?: BigintLike | null;
}

export interface PoolSingletonSpendContext {
  poolLauncherId: string;
  poolCoin: PoolCoinInput;
  poolInnerPuzzleHex: string;
  lineageProof: PoolSingletonLineageProof;
}

export interface PoolV2InnerSolutionBuild<
  Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote
> {
  spendCase: number;
  actionTag: number;
  innerSolutionHex: string;
  spec: PoolV2ActionSpec<Quote>;
  p2VaultPuzzleHash?: string;
}

export interface PoolSingletonCoinSpendBuild {
  poolCoinId: string;
  poolInnerPuzzleHash: string;
  poolFullPuzzleHash: string;
  poolPuzzleReveal: string;
  poolFullSolutionHex: string;
  coinSpend: UnsignedCoinSpend;
  unsignedSpendBundle: {
    coinSpends: ReadonlyArray<UnsignedCoinSpend>;
    aggregatedSignature: null;
  };
}

export type PoolV2CoinSpendBuild<
  Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote
> = PoolV2InnerSolutionBuild<Quote> & PoolSingletonCoinSpendBuild;

export interface SpecificDeedSwapInnerSolutionArgs extends PoolInnerSolutionContext {
  state: PoolEconomicStateInput;
  deedId: string;
  deedLauncherId: string;
  parValueMojos: BigintLike;
  assetClass: BigintLike;
  propertyIdCanon: string;
  buyerVaultLauncherId: string;
  launcherPuzzleHash?: string;
  collectionIdCanon: string;
  sharePpm: BigintLike;
  navEvidence: CollectionNavEvidenceInput;
  treasuryReservePuzhash: string;
  protocolTreasuryPuzhash: string;
  governanceRewardsPuzhash: string;
  governanceRewardsRoot: string;
}

export interface TrueRedemptionInnerSolutionArgs extends PoolInnerSolutionContext {
  state: PoolEconomicStateInput;
  deedId: string;
  deedLauncherId: string;
  parValueMojos: BigintLike;
  assetClass: BigintLike;
  propertyIdCanon: string;
  vaultLauncherId: string;
  launcherPuzzleHash?: string;
  collectionIdCanon: string;
  sharePpm: BigintLike;
  navEvidence: CollectionNavEvidenceInput;
  tokenCoinId: string;
}

export interface ReserveAcquisitionInnerSolutionArgs extends PoolInnerSolutionContext {
  state: PoolEconomicStateInput;
  deedId: string;
  deedLauncherId: string;
  propertyIdCanon: string;
  parValueMojos: BigintLike;
  assetClass: BigintLike;
  collectionIdCanon: string;
  sharePpm: BigintLike;
  navEvidence: CollectionNavEvidenceInput;
  sellerPuzhash: string;
  sellerTokenPrice: BigintLike;
  mintTokenCoinId?: string | null;
}

export type SpecificDeedSwapCoinSpendArgs =
  PoolSingletonSpendContext & Omit<SpecificDeedSwapInnerSolutionArgs, keyof PoolInnerSolutionContext>;
export type TrueRedemptionCoinSpendArgs =
  PoolSingletonSpendContext & Omit<TrueRedemptionInnerSolutionArgs, keyof PoolInnerSolutionContext>;
export type ReserveAcquisitionCoinSpendArgs =
  PoolSingletonSpendContext & Omit<ReserveAcquisitionInnerSolutionArgs, keyof PoolInnerSolutionContext>;

export type PoolV2RequiredAnnouncementRole =
  | 'nav_evidence'
  | 'deed'
  | 'token_settlement'
  | 'token_authorization';

export type PoolV2AnnouncementKind =
  | 'puzzle_create'
  | 'coin_create'
  | 'puzzle_assert';

export interface PoolV2RequiredAnnouncement {
  role: PoolV2RequiredAnnouncementRole;
  kind: PoolV2AnnouncementKind;
  message: string;
  sourceId: string;
  announcementId?: string;
}

export interface PoolV2BundleWitnesses {
  navEvidenceSpend: UnsignedCoinSpend;
  deedSpend: UnsignedCoinSpend;
  tokenSettlementSpend?: UnsignedCoinSpend | null;
  /** Puzzle hash that must emit the CAT settlement payment announcement. */
  tokenSettlementPuzzleHash?: string | null;
  tokenAuthorizationSpends?: ReadonlyArray<UnsignedCoinSpend> | null;
}

export interface PoolV2ComposeBundleArgs<
  Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
> {
  poolSpend: PoolV2CoinSpendBuild<Quote>;
  deedId: string;
  navEvidence: CollectionNavEvidenceInput;
  witnesses: PoolV2BundleWitnesses;
}

export interface PoolV2WitnessReplaySummary {
  role: PoolV2RequiredAnnouncementRole;
  coinId: string;
  puzzleHash: string;
  cost: bigint;
}

export interface PoolV2ComposedBundleBuild<
  Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
> {
  poolSpend: PoolV2CoinSpendBuild<Quote>;
  requiredAnnouncements: PoolV2RequiredAnnouncement[];
  witnessSummary: PoolV2WitnessReplaySummary[];
  coinSpends: ReadonlyArray<UnsignedCoinSpend>;
  unsignedSpendBundle: {
    coinSpends: ReadonlyArray<UnsignedCoinSpend>;
    aggregatedSignature: null;
  };
}

@Injectable({ providedIn: 'root' })
export class PoolEconomicsV2SpendBuilderService {
  private readonly wasm = inject(ChiaWasmService);
  private readonly economics = inject(PoolEconomicsV2Service);

  p2VaultPuzzleHash(
    vaultLauncherId: string,
    launcherPuzzleHash = SINGLETON_LAUNCHER_HASH,
  ): string {
    const clvm = this.clvm();
    const mod = clvm.deserialize(hexToBytes(P2_VAULT_CURRENT_PUZZLE_HEX));
    return bytesToHex(
      mod
        .curry([
          clvm.atom(atom32(SINGLETON_MOD_HASH, 'singletonModHash')),
          clvm.atom(atom32(vaultLauncherId, 'vaultLauncherId')),
          clvm.atom(atom32(launcherPuzzleHash, 'launcherPuzzleHash')),
        ])
        .treeHash(),
    );
  }

  buildSpecificDeedSwapCoinSpend(
    args: SpecificDeedSwapCoinSpendArgs,
  ): PoolV2CoinSpendBuild<SpecificDeedSwapQuote> {
    const innerContext = this.innerContextForSpend(args);
    const inner = this.buildSpecificDeedSwapInnerSolution({ ...args, ...innerContext });
    return { ...inner, ...this.buildPoolSingletonCoinSpend({ ...args, innerSolutionHex: inner.innerSolutionHex }) };
  }

  buildTrueRedemptionCoinSpend(
    args: TrueRedemptionCoinSpendArgs,
  ): PoolV2CoinSpendBuild<TrueRedemptionQuote> {
    const innerContext = this.innerContextForSpend(args);
    const inner = this.buildTrueRedemptionInnerSolution({ ...args, ...innerContext });
    return { ...inner, ...this.buildPoolSingletonCoinSpend({ ...args, innerSolutionHex: inner.innerSolutionHex }) };
  }

  buildReserveAcquisitionCoinSpend(
    args: ReserveAcquisitionCoinSpendArgs,
  ): PoolV2CoinSpendBuild<ReserveAcquisitionQuote> {
    const innerContext = this.innerContextForSpend(args);
    const inner = this.buildReserveAcquisitionInnerSolution({ ...args, ...innerContext });
    return { ...inner, ...this.buildPoolSingletonCoinSpend({ ...args, innerSolutionHex: inner.innerSolutionHex }) };
  }

  composePoolV2UnsignedBundle<
    Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
  >(args: PoolV2ComposeBundleArgs<Quote>): PoolV2ComposedBundleBuild<Quote> {
    const required = this.poolV2RequiredAnnouncements({
      poolSpend: args.poolSpend,
      deedId: args.deedId,
      navEvidence: args.navEvidence,
      tokenSettlementPuzzleHash: args.witnesses.tokenSettlementPuzzleHash,
    });
    const witnessSpends = this.collectWitnessSpends(args.poolSpend, args.witnesses);
    if (witnessSpends.length > POOL_V2_MAX_WITNESS_COIN_SPENDS) {
      throw new Error(
        `pool-v2-spend-builder: witness spend count ${witnessSpends.length} exceeds ` +
          `${POOL_V2_MAX_WITNESS_COIN_SPENDS}`,
      );
    }
    const coinSpends = [args.poolSpend.coinSpend, ...witnessSpends.map((w) => w.spend)];
    if (coinSpends.length > POOL_V2_MAX_UNSIGNED_BUNDLE_COIN_SPENDS) {
      throw new Error(
        `pool-v2-spend-builder: unsigned bundle coin spend count ${coinSpends.length} exceeds ` +
          `${POOL_V2_MAX_UNSIGNED_BUNDLE_COIN_SPENDS}`,
      );
    }
    const witnessSummary = this.verifyPoolV2Witnesses(required, witnessSpends);
    this.verifyPoolSpendEmitsActionAnnouncements(args.poolSpend);
    this.assertNoDuplicateCoinSpends(coinSpends);
    return {
      poolSpend: args.poolSpend,
      requiredAnnouncements: required,
      witnessSummary,
      coinSpends,
      unsignedSpendBundle: {
        coinSpends,
        aggregatedSignature: null,
      },
    };
  }

  describePoolV2RequiredAnnouncements<
    Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
  >(args: {
    poolSpend: PoolV2CoinSpendBuild<Quote>;
    deedId: string;
    navEvidence: CollectionNavEvidenceInput;
    tokenSettlementPuzzleHash?: string | null;
  }): PoolV2RequiredAnnouncement[] {
    return this.poolV2RequiredAnnouncements(args);
  }

  buildSpecificDeedSwapInnerSolution(
    args: SpecificDeedSwapInnerSolutionArgs,
  ): PoolV2InnerSolutionBuild<SpecificDeedSwapQuote> {
    const launcherPuzzleHash = args.launcherPuzzleHash ?? SINGLETON_LAUNCHER_HASH;
    const p2VaultPuzzleHash = this.p2VaultPuzzleHash(
      args.buyerVaultLauncherId,
      launcherPuzzleHash,
    );
    const spec = this.economics.buildSpecificDeedSwapSpec({
      state: args.state,
      deedId: args.deedId,
      deedLauncherId: args.deedLauncherId,
      parValueMojos: args.parValueMojos,
      assetClass: args.assetClass,
      propertyIdCanon: args.propertyIdCanon,
      p2VaultPuzzleHash,
      collectionIdCanon: args.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence: args.navEvidence,
      treasuryReservePuzhash: args.treasuryReservePuzhash,
      protocolTreasuryPuzhash: args.protocolTreasuryPuzhash,
      governanceRewardsPuzhash: args.governanceRewardsPuzhash,
      governanceRewardsRoot: args.governanceRewardsRoot,
    });
    return {
      spendCase: POOL_SPEND_V2_SPECIFIC_DEED_SWAP,
      actionTag: POOL_V2_SPECIFIC_DEED_SWAP_TAG,
      innerSolutionHex: this.innerSolutionHex(args, POOL_SPEND_V2_SPECIFIC_DEED_SWAP, [
        atom32(args.deedId, 'deedId'),
        atom32(args.deedLauncherId, 'deedLauncherId'),
        bigint(args.parValueMojos),
        bigint(args.assetClass),
        atom32(args.propertyIdCanon, 'propertyIdCanon'),
        atom32(args.collectionIdCanon, 'collectionIdCanon'),
        bigint(args.sharePpm),
        bigint(args.navEvidence.navValueMojos),
        atom32(args.navEvidence.collectionNavRoot, 'collectionNavRoot'),
        bigint(args.navEvidence.registryVersion),
        atom32(args.navEvidence.registryCoinId, 'registryCoinId'),
        atom32(args.navEvidence.registryPuzzleHash, 'registryPuzzleHash'),
        atom32(args.buyerVaultLauncherId, 'buyerVaultLauncherId'),
        atom32(launcherPuzzleHash, 'launcherPuzzleHash'),
        atom32(args.treasuryReservePuzhash, 'treasuryReservePuzhash'),
        atom32(args.protocolTreasuryPuzhash, 'protocolTreasuryPuzhash'),
        atom32(args.governanceRewardsPuzhash, 'governanceRewardsPuzhash'),
        atom32(args.governanceRewardsRoot, 'governanceRewardsRoot'),
      ]),
      spec,
      p2VaultPuzzleHash,
    };
  }

  buildTrueRedemptionInnerSolution(
    args: TrueRedemptionInnerSolutionArgs,
  ): PoolV2InnerSolutionBuild<TrueRedemptionQuote> {
    const launcherPuzzleHash = args.launcherPuzzleHash ?? SINGLETON_LAUNCHER_HASH;
    const p2VaultPuzzleHash = this.p2VaultPuzzleHash(
      args.vaultLauncherId,
      launcherPuzzleHash,
    );
    const spec = this.economics.buildTrueRedemptionSpec({
      state: args.state,
      deedId: args.deedId,
      deedLauncherId: args.deedLauncherId,
      parValueMojos: args.parValueMojos,
      assetClass: args.assetClass,
      propertyIdCanon: args.propertyIdCanon,
      p2VaultPuzzleHash,
      collectionIdCanon: args.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence: args.navEvidence,
      tokenCoinId: args.tokenCoinId,
    });
    return {
      spendCase: POOL_SPEND_V2_TRUE_REDEMPTION,
      actionTag: POOL_V2_TRUE_REDEMPTION_TAG,
      innerSolutionHex: this.innerSolutionHex(args, POOL_SPEND_V2_TRUE_REDEMPTION, [
        atom32(args.deedId, 'deedId'),
        atom32(args.deedLauncherId, 'deedLauncherId'),
        bigint(args.parValueMojos),
        bigint(args.assetClass),
        atom32(args.propertyIdCanon, 'propertyIdCanon'),
        atom32(args.collectionIdCanon, 'collectionIdCanon'),
        bigint(args.sharePpm),
        bigint(args.navEvidence.navValueMojos),
        atom32(args.navEvidence.collectionNavRoot, 'collectionNavRoot'),
        bigint(args.navEvidence.registryVersion),
        atom32(args.navEvidence.registryCoinId, 'registryCoinId'),
        atom32(args.navEvidence.registryPuzzleHash, 'registryPuzzleHash'),
        atom32(args.vaultLauncherId, 'vaultLauncherId'),
        atom32(launcherPuzzleHash, 'launcherPuzzleHash'),
        atom32(args.tokenCoinId, 'tokenCoinId'),
      ]),
      spec,
      p2VaultPuzzleHash,
    };
  }

  buildReserveAcquisitionInnerSolution(
    args: ReserveAcquisitionInnerSolutionArgs,
  ): PoolV2InnerSolutionBuild<ReserveAcquisitionQuote> {
    const spec = this.economics.buildReserveAcquisitionSpec({
      state: args.state,
      deedId: args.deedId,
      deedLauncherId: args.deedLauncherId,
      propertyIdCanon: args.propertyIdCanon,
      parValueMojos: args.parValueMojos,
      assetClass: args.assetClass,
      collectionIdCanon: args.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence: args.navEvidence,
      sellerPuzhash: args.sellerPuzhash,
      sellerTokenPrice: args.sellerTokenPrice,
      mintTokenCoinId: args.mintTokenCoinId,
    });
    return {
      spendCase: POOL_SPEND_V2_RESERVE_ACQUISITION,
      actionTag: POOL_V2_RESERVE_ACQUISITION_TAG,
      innerSolutionHex: this.innerSolutionHex(args, POOL_SPEND_V2_RESERVE_ACQUISITION, [
        atom32(args.deedId, 'deedId'),
        atom32(args.deedLauncherId, 'deedLauncherId'),
        atom32(args.propertyIdCanon, 'propertyIdCanon'),
        bigint(args.parValueMojos),
        bigint(args.assetClass),
        atom32(args.collectionIdCanon, 'collectionIdCanon'),
        bigint(args.sharePpm),
        bigint(args.navEvidence.navValueMojos),
        atom32(args.navEvidence.collectionNavRoot, 'collectionNavRoot'),
        bigint(args.navEvidence.registryVersion),
        atom32(args.navEvidence.registryCoinId, 'registryCoinId'),
        atom32(args.navEvidence.registryPuzzleHash, 'registryPuzzleHash'),
        atom32(args.sellerPuzhash, 'sellerPuzhash'),
        bigint(args.sellerTokenPrice),
        spec.quote.freshMintShortfallTokens > 0n && args.mintTokenCoinId
          ? atom32(args.mintTokenCoinId, 'mintTokenCoinId')
          : null,
      ]),
      spec,
    };
  }

  buildPoolSingletonCoinSpend(args: PoolSingletonSpendContext & {
    innerSolutionHex: string;
  }): PoolSingletonCoinSpendBuild {
    const sdk = this.sdk();
    const clvm = new sdk.Clvm();
    const Coin = sdk.Coin;
    const poolCoin = this.normalizePoolCoin(args.poolCoin);
    const innerPuzzle = clvm.deserialize(hexToBytes(normalizeHex(args.poolInnerPuzzleHex)));
    const innerPuzzleHash = innerPuzzle.treeHash();
    const singletonStruct = this.singletonStruct(clvm, atom32(args.poolLauncherId, 'poolLauncherId'));
    const fullPuzzle = this.singletonFullPuzzle(clvm, singletonStruct, innerPuzzle);
    const fullPuzzleHash = fullPuzzle.treeHash();
    const claimedPuzzleHash = atom32(poolCoin.puzzleHash, 'poolCoin.puzzleHash');
    if (!bytesEqual(fullPuzzleHash, claimedPuzzleHash)) {
      throw new Error(
        `pool-v2-spend-builder: built pool full puzzle hash ${bytesToHex(fullPuzzleHash)} ` +
          `does not match coin puzzle hash ${bytesToHex(claimedPuzzleHash)}`,
      );
    }
    const coin = new Coin(
      atom32(poolCoin.parentCoinInfo, 'poolCoin.parentCoinInfo'),
      claimedPuzzleHash,
      bigint(poolCoin.amount),
    );
    const poolCoinId = bytesToHex(coin.coinId());
    if (poolCoin.coinId && poolCoin.coinId !== poolCoinId) {
      throw new Error(
        `pool-v2-spend-builder: pool coin id ${poolCoin.coinId} does not match ` +
          `coin fields ${poolCoinId}`,
      );
    }
    const innerSolution = clvm.deserialize(hexToBytes(normalizeHex(args.innerSolutionHex)));
    const fullSolution = clvm.list([
      this.encodeLineageProof(clvm, args.lineageProof),
      clvm.int(bigint(poolCoin.amount)),
      innerSolution,
    ]);
    const coinSpend: UnsignedCoinSpend = {
      coin: {
        parentCoinInfo: poolCoin.parentCoinInfo,
        puzzleHash: poolCoin.puzzleHash,
        amount: bigint(poolCoin.amount),
      },
      puzzleReveal: bytesToHex(fullPuzzle.serialize()),
      solution: bytesToHex(fullSolution.serialize()),
    };
    return {
      poolCoinId,
      poolInnerPuzzleHash: bytesToHex(innerPuzzleHash),
      poolFullPuzzleHash: bytesToHex(fullPuzzleHash),
      poolPuzzleReveal: coinSpend.puzzleReveal,
      poolFullSolutionHex: coinSpend.solution,
      coinSpend,
      unsignedSpendBundle: {
        coinSpends: [coinSpend],
        aggregatedSignature: null,
      },
    };
  }

  private poolV2RequiredAnnouncements<
    Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
  >(args: {
    poolSpend: PoolV2CoinSpendBuild<Quote>;
    deedId: string;
    navEvidence: CollectionNavEvidenceInput;
    tokenSettlementPuzzleHash?: string | null;
  }): PoolV2RequiredAnnouncement[] {
    const pool = args.poolSpend;
    const required: PoolV2RequiredAnnouncement[] = [
      {
        role: 'nav_evidence',
        kind: 'puzzle_create',
        sourceId: normalizeHex(args.navEvidence.registryPuzzleHash),
        message: normalizeHex(pool.spec.requiredNavEvidenceMessage),
      },
      {
        role: 'deed',
        kind: 'coin_create',
        sourceId: normalizeHex(args.deedId),
        message: normalizeHex(pool.spec.deedMessage),
      },
    ];
    if (pool.spec.tokenOutputs.length > 0) {
      const tokenSettlementPuzzleHash = args.tokenSettlementPuzzleHash;
      if (!tokenSettlementPuzzleHash) {
        throw new Error(
          'pool-v2-spend-builder: tokenSettlementPuzzleHash is required when token outputs are present',
        );
      }
      required.push({
        role: 'token_settlement',
        kind: 'puzzle_create',
        sourceId: normalizeHex(tokenSettlementPuzzleHash),
        message: this.economics.tokenSettlementPaymentMessage(pool.poolCoinId, pool.spec.tokenOutputs),
      });
    }
    for (const auth of pool.spec.tokenAuthorizations) {
      const message = normalizeHex(auth.announcementMessage);
      required.push({
        role: 'token_authorization',
        kind: 'puzzle_assert',
        sourceId: normalizeHex(auth.tokenCoinId),
        message,
        announcementId: announcementId(pool.poolFullPuzzleHash, message),
      });
    }
    return required;
  }

  private collectWitnessSpends<
    Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
  >(
    pool: PoolV2CoinSpendBuild<Quote>,
    witnesses: PoolV2BundleWitnesses,
  ): Array<{ role: PoolV2RequiredAnnouncementRole; spend: UnsignedCoinSpend }> {
    const tokenAuthorizationSpends = witnesses.tokenAuthorizationSpends ?? [];
    if (tokenAuthorizationSpends.length !== pool.spec.tokenAuthorizations.length) {
      throw new Error(
        `pool-v2-spend-builder: expected ${pool.spec.tokenAuthorizations.length} token authorization ` +
          `spend(s), got ${tokenAuthorizationSpends.length}`,
      );
    }
    const spends: Array<{ role: PoolV2RequiredAnnouncementRole; spend: UnsignedCoinSpend }> = [
      { role: 'nav_evidence', spend: witnesses.navEvidenceSpend },
      { role: 'deed', spend: witnesses.deedSpend },
    ];
    if (pool.spec.tokenOutputs.length > 0) {
      if (!witnesses.tokenSettlementSpend) {
        throw new Error(
          'pool-v2-spend-builder: tokenSettlementSpend is required when token outputs are present',
        );
      }
      spends.push({ role: 'token_settlement', spend: witnesses.tokenSettlementSpend });
    } else if (witnesses.tokenSettlementSpend) {
      throw new Error(
        'pool-v2-spend-builder: tokenSettlementSpend supplied for action with no token outputs',
      );
    }
    for (const spend of tokenAuthorizationSpends) {
      spends.push({ role: 'token_authorization', spend });
    }
    return spends;
  }

  private verifyPoolV2Witnesses(
    required: PoolV2RequiredAnnouncement[],
    witnesses: Array<{ role: PoolV2RequiredAnnouncementRole; spend: UnsignedCoinSpend }>,
  ): PoolV2WitnessReplaySummary[] {
    const available = witnesses.map((witness) => ({
      role: witness.role,
      spend: witness.spend,
      decoded: this.replayCoinSpend(witness.spend),
      coinId: this.coinIdForSpend(witness.spend),
      puzzleHash: normalizeHex(witness.spend.coin.puzzleHash),
    }));
    const summary: PoolV2WitnessReplaySummary[] = [];
    for (const requirement of required) {
      const match = available.find((candidate) => {
        if (candidate.role !== requirement.role) return false;
        if (requirement.kind === 'puzzle_assert') {
          return (
            candidate.coinId === requirement.sourceId &&
            requirement.announcementId !== undefined &&
            candidate.decoded.assertPuzzleAnnouncements.includes(requirement.announcementId)
          );
        }
        if (requirement.kind === 'coin_create') {
          return (
            candidate.coinId === requirement.sourceId &&
            candidate.decoded.createCoinAnnouncements.includes(requirement.message)
          );
        }
        return (
          candidate.puzzleHash === requirement.sourceId &&
          candidate.decoded.createPuzzleAnnouncements.includes(requirement.message)
        );
      });
      if (!match) {
        throw new Error(
          `pool-v2-spend-builder: missing ${requirement.role} witness for ` +
            `${requirement.kind} ${requirement.message}`,
        );
      }
      summary.push({
        role: requirement.role,
        coinId: match.coinId,
        puzzleHash: match.puzzleHash,
        cost: match.decoded.cost,
      });
    }
    return summary;
  }

  private verifyPoolSpendEmitsActionAnnouncements<
    Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
  >(pool: PoolV2CoinSpendBuild<Quote>): void {
    const decoded = this.replayCoinSpend(pool.coinSpend);
    const action = normalizeHex(pool.spec.poolActionMessage);
    if (!decoded.createPuzzleAnnouncements.includes(action)) {
      throw new Error('pool-v2-spend-builder: pool spend does not emit its V2 action announcement');
    }
    for (const auth of pool.spec.tokenAuthorizations) {
      if (!decoded.createPuzzleAnnouncements.includes(normalizeHex(auth.announcementMessage))) {
        throw new Error('pool-v2-spend-builder: pool spend does not emit token authorization announcement');
      }
    }
  }

  private replayCoinSpend(spend: UnsignedCoinSpend): DecodedSpendConditions {
    const sdk = this.sdk();
    const clvm = new sdk.Clvm();
    const puzzle = clvm.deserialize(hexToBytes(normalizeHex(spend.puzzleReveal)));
    const puzzleHash = bytesToHex(puzzle.treeHash());
    if (puzzleHash !== normalizeHex(spend.coin.puzzleHash)) {
      throw new Error(
        `pool-v2-spend-builder: witness puzzle reveal hash ${puzzleHash} does not match ` +
          `coin puzzle hash ${normalizeHex(spend.coin.puzzleHash)}`,
      );
    }
    const solution = clvm.deserialize(hexToBytes(normalizeHex(spend.solution)));
    const output = puzzle.run?.(solution, POOL_V2_WITNESS_REPLAY_COST, false);
    if (!output) {
      throw new Error('pool-v2-spend-builder: chia-wallet-sdk-wasm Program.run unavailable');
    }
    return decodeSpendConditions(output.value, output.cost);
  }

  private coinIdForSpend(spend: UnsignedCoinSpend): string {
    const sdk = this.sdk();
    const coin = this.normalizePoolCoin(spend.coin);
    return coinIdFromFields(sdk, coin);
  }

  private assertNoDuplicateCoinSpends(spends: ReadonlyArray<UnsignedCoinSpend>): void {
    const seen = new Set<string>();
    for (const spend of spends) {
      const id = this.coinIdForSpend(spend);
      if (seen.has(id)) {
        throw new Error(`pool-v2-spend-builder: duplicate coin spend ${id}`);
      }
      seen.add(id);
    }
  }

  private innerContextForSpend(args: PoolSingletonSpendContext): PoolInnerSolutionContext {
    const clvm = this.clvm();
    const innerPuzzle = clvm.deserialize(hexToBytes(normalizeHex(args.poolInnerPuzzleHex)));
    const coin = this.normalizePoolCoin(args.poolCoin);
    return {
      poolCoinId: coin.coinId ?? coinIdFromFields(this.sdk(), coin),
      poolInnerPuzzleHash: bytesToHex(innerPuzzle.treeHash()),
      poolAmount: coin.amount,
    };
  }

  private innerSolutionHex(
    context: PoolInnerSolutionContext,
    spendCase: number,
    params: PoolSolutionValue[],
  ): string {
    const clvm = this.clvm();
    const solution = clvm.list([
      clvm.atom(atom32(context.poolCoinId, 'poolCoinId')),
      clvm.atom(atom32(context.poolInnerPuzzleHash, 'poolInnerPuzzleHash')),
      clvm.int(bigint(context.poolAmount)),
      clvm.int(BigInt(spendCase)),
      clvm.list(params.map((param) => this.programForValue(clvm, param))),
    ]);
    return bytesToHex(solution.serialize());
  }

  private programForValue(clvm: ClvmShape, value: PoolSolutionValue): ProgramShape {
    if (value === null) {
      return clvm.nil();
    }
    if (typeof value === 'bigint') {
      return clvm.int(value);
    }
    return clvm.atom(value);
  }

  private clvm(): ClvmShape {
    const Clvm = this.sdk().Clvm;
    return new Clvm();
  }

  private sdk(): SdkShape {
    const sdk = this.wasm.sdk() as SdkShape | undefined;
    if (!sdk?.Clvm || !sdk?.Coin) {
      throw new Error('pool-v2-spend-builder: chia-wallet-sdk-wasm Clvm/Coin exports unavailable');
    }
    return sdk;
  }

  private singletonStruct(clvm: ClvmShape, launcherId: Uint8Array): ProgramShape {
    return clvm.pair(
      clvm.atom(atom32(SINGLETON_MOD_HASH, 'singletonModHash')),
      clvm.pair(
        clvm.atom(launcherId),
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
      throw new Error('pool-v2-spend-builder: singleton top layer unavailable in WASM SDK');
    }
    return clvm.deserialize(topLayer).curry([singletonStruct, innerPuzzle]);
  }

  private encodeLineageProof(clvm: ClvmShape, proof: PoolSingletonLineageProof): ProgramShape {
    const parentName = proof.parentName ? normalizeHex(proof.parentName) : null;
    const innerPuzzleHash = proof.innerPuzzleHash ? normalizeHex(proof.innerPuzzleHash) : null;
    const amount = proof.amount === undefined || proof.amount === null ? null : bigint(proof.amount);
    if (!parentName && !innerPuzzleHash && amount === null) {
      return clvm.nil();
    }
    if (parentName && !innerPuzzleHash && amount === null) {
      return clvm.list([clvm.atom(atom32(parentName, 'lineageProof.parentName'))]);
    }
    if (!parentName || !innerPuzzleHash || amount === null) {
      throw new Error(
        'pool-v2-spend-builder: lineage proof must be empty, eve-only, or fully populated',
      );
    }
    return clvm.list([
      clvm.atom(atom32(parentName, 'lineageProof.parentName')),
      clvm.atom(atom32(innerPuzzleHash, 'lineageProof.innerPuzzleHash')),
      clvm.int(amount),
    ]);
  }

  private normalizePoolCoin(coin: PoolCoinInput): Required<PoolCoinInput> {
    const amount = bigint(coin.amount);
    if (amount <= 0n) {
      throw new Error('pool-v2-spend-builder: pool coin amount must be positive');
    }
    return {
      parentCoinInfo: normalizeHex(coin.parentCoinInfo),
      puzzleHash: normalizeHex(coin.puzzleHash),
      amount,
      coinId: coin.coinId ? normalizeHex(coin.coinId) : null,
    };
  }
}

type PoolSolutionValue = Uint8Array | bigint | null;

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
  parseCreatePuzzleAnnouncement?: () => { message: Uint8Array } | undefined;
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  atom(value: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
  list(value: ProgramShape[]): ProgramShape;
  pair(first: ProgramShape, rest: ProgramShape): ProgramShape;
  nil(): ProgramShape;
}

interface SdkShape {
  Clvm: new () => ClvmShape;
  Coin: new (
    parentCoinInfo: Uint8Array,
    puzzleHash: Uint8Array,
    amount: bigint,
  ) => { coinId(): Uint8Array };
  Constants?: {
    singletonTopLayer?: () => Uint8Array;
    singletonTopLayerV11?: () => Uint8Array;
  };
}

function coinIdFromFields(sdk: SdkShape, coin: Required<PoolCoinInput>): string {
  const constructed = new sdk.Coin(
    atom32(coin.parentCoinInfo, 'poolCoin.parentCoinInfo'),
    atom32(coin.puzzleHash, 'poolCoin.puzzleHash'),
    bigint(coin.amount),
  );
  return bytesToHex(constructed.coinId());
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface DecodedSpendConditions {
  createCoinAnnouncements: string[];
  createPuzzleAnnouncements: string[];
  assertPuzzleAnnouncements: string[];
  cost: bigint;
}

const CREATE_COIN_ANNOUNCEMENT = 60;
const CREATE_PUZZLE_ANNOUNCEMENT = 62;
const ASSERT_PUZZLE_ANNOUNCEMENT = 63;

function decodeSpendConditions(value: ProgramShape, cost: bigint): DecodedSpendConditions {
  const decoded: DecodedSpendConditions = {
    createCoinAnnouncements: [],
    createPuzzleAnnouncements: [],
    assertPuzzleAnnouncements: [],
    cost,
  };
  for (const condition of value.toList?.() ?? []) {
    const parsedAnnouncement = condition.parseCreatePuzzleAnnouncement?.();
    if (parsedAnnouncement) {
      decoded.createPuzzleAnnouncements.push(bytesToHex(parsedAnnouncement.message));
      continue;
    }
    const parts = condition.toList?.() ?? [];
    const opcode = atomAsNumber(parts[0]);
    const message = parts[1]?.toAtom?.();
    if (!message) continue;
    if (opcode === CREATE_COIN_ANNOUNCEMENT) {
      decoded.createCoinAnnouncements.push(bytesToHex(message));
    } else if (opcode === CREATE_PUZZLE_ANNOUNCEMENT) {
      decoded.createPuzzleAnnouncements.push(bytesToHex(message));
    } else if (opcode === ASSERT_PUZZLE_ANNOUNCEMENT) {
      decoded.assertPuzzleAnnouncements.push(bytesToHex(message));
    }
  }
  return decoded;
}

function atomAsNumber(program: ProgramShape | undefined): number | null {
  const value = program?.toInt?.();
  if (typeof value !== 'bigint') return null;
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function announcementId(sourceId: string, message: string): string {
  return normalizeHex(sha256(concatBytes([
    hexToBytes(normalizeHex(sourceId)),
    hexToBytes(normalizeHex(message)),
  ])));
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
