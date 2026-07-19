import { Injectable, inject } from '@angular/core';

import {
  CoinsetService,
  type PushTxResponse,
  type PushTxSpendBundle,
} from './coinset.service';
import {
  type CollectionNavEvidenceInput,
  type PoolEconomicStateInput,
  type ReserveAcquisitionQuote,
  type SpecificDeedSwapQuote,
  type TrueRedemptionQuote,
  type BigintLike,
} from './pool-economics-v2.service';
import {
  type PoolSingletonSpendContext,
  type PoolV2BundleWitnesses,
  type PoolV2CoinSpendBuild,
  type PoolV2ComposedBundleBuild,
  POOL_SPEND_V2_RESERVE_ACQUISITION,
  POOL_SPEND_V2_SPECIFIC_DEED_SWAP,
  POOL_SPEND_V2_TRUE_REDEMPTION,
  PoolEconomicsV2SpendBuilderService,
} from './pool-economics-v2-spend-builder.service';

export const POOL_V2_EMPTY_AGGREGATE_SIGNATURE = '0x' + 'c0' + '00'.repeat(95);

interface PoolV2ExecutionBaseArgs {
  pool: PoolSingletonSpendContext;
  state: PoolEconomicStateInput;
  deedId: string;
  deedLauncherId: string;
  propertyIdCanon: string;
  parValueMojos: BigintLike;
  assetClass: BigintLike;
  collectionIdCanon: string;
  sharePpm: BigintLike;
  navEvidence: CollectionNavEvidenceInput;
  witnesses: PoolV2BundleWitnesses;
}

export interface SpecificDeedSwapExecutionArgs extends PoolV2ExecutionBaseArgs {
  buyerVaultLauncherId: string;
  launcherPuzzleHash?: string;
  buyerVaultCoinId: string;
  buyerOwnerPubkey: string;
  buyerAuthType: BigintLike;
  buyerMembersMerkleRoot: string;
  buyerIdentityAttestRoot: string;
  buyerBridgePolicyHash: string;
  treasuryReservePuzhash: string;
  protocolTreasuryPuzhash: string;
  governanceRewardsPuzhash: string;
  governanceRewardsRoot: string;
}

export interface TrueRedemptionExecutionArgs extends PoolV2ExecutionBaseArgs {
  vaultLauncherId: string;
  launcherPuzzleHash?: string;
  tokenCoinId: string;
}

export interface ReserveAcquisitionExecutionArgs extends PoolV2ExecutionBaseArgs {
  sellerPuzhash: string;
  sellerTokenPrice: BigintLike;
  mintTokenCoinId?: string | null;
}

export type PoolV2ExecutionKind =
  | 'specific-deed-swap'
  | 'true-redemption'
  | 'reserve-acquisition';

export interface PoolV2ExecutionBundle<
  Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
> extends PoolV2ComposedBundleBuild<Quote> {
  kind: PoolV2ExecutionKind;
  label: string;
  spendCase: number;
  actionTag: number;
  signaturelessSpendBundle: PushTxSpendBundle;
}

/**
 * Real Pool Economic V2 execution boundary.
 *
 * This service takes live pool/deed/NAV/token witness spends, composes the
 * same verified bundle as the dry-run path, and exposes a deliberately named
 * signatureless submission step.  It does not call the faucet or mint helper
 * APIs: callers must provide the spend witnesses, and coinset remains the
 * only broadcast endpoint.
 */
@Injectable({ providedIn: 'root' })
export class PoolEconomicsV2ExecutionRunnerService {
  private readonly builder = inject(PoolEconomicsV2SpendBuilderService);
  private readonly coinset = inject(CoinsetService);

  composeSpecificDeedSwap(
    args: SpecificDeedSwapExecutionArgs,
  ): PoolV2ExecutionBundle<SpecificDeedSwapQuote> {
    const poolSpend = this.builder.buildSpecificDeedSwapCoinSpend({
      ...args.pool,
      state: args.state,
      deedId: args.deedId,
      deedLauncherId: args.deedLauncherId,
      propertyIdCanon: args.propertyIdCanon,
      parValueMojos: args.parValueMojos,
      assetClass: args.assetClass,
      buyerVaultLauncherId: args.buyerVaultLauncherId,
      launcherPuzzleHash: args.launcherPuzzleHash,
      buyerVaultCoinId: args.buyerVaultCoinId,
      buyerOwnerPubkey: args.buyerOwnerPubkey,
      buyerAuthType: args.buyerAuthType,
      buyerMembersMerkleRoot: args.buyerMembersMerkleRoot,
      buyerIdentityAttestRoot: args.buyerIdentityAttestRoot,
      buyerBridgePolicyHash: args.buyerBridgePolicyHash,
      collectionIdCanon: args.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence: args.navEvidence,
      treasuryReservePuzhash: args.treasuryReservePuzhash,
      protocolTreasuryPuzhash: args.protocolTreasuryPuzhash,
      governanceRewardsPuzhash: args.governanceRewardsPuzhash,
      governanceRewardsRoot: args.governanceRewardsRoot,
    });
    return this.bundle({
      kind: 'specific-deed-swap',
      label: 'Specific deed swap',
      spendCase: POOL_SPEND_V2_SPECIFIC_DEED_SWAP,
      poolSpend,
      deedId: args.deedId,
      navEvidence: args.navEvidence,
      witnesses: args.witnesses,
    });
  }

  composeTrueRedemption(
    args: TrueRedemptionExecutionArgs,
  ): PoolV2ExecutionBundle<TrueRedemptionQuote> {
    const poolSpend = this.builder.buildTrueRedemptionCoinSpend({
      ...args.pool,
      state: args.state,
      deedId: args.deedId,
      deedLauncherId: args.deedLauncherId,
      propertyIdCanon: args.propertyIdCanon,
      parValueMojos: args.parValueMojos,
      assetClass: args.assetClass,
      vaultLauncherId: args.vaultLauncherId,
      launcherPuzzleHash: args.launcherPuzzleHash,
      collectionIdCanon: args.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence: args.navEvidence,
      tokenCoinId: args.tokenCoinId,
    });
    return this.bundle({
      kind: 'true-redemption',
      label: 'True redemption',
      spendCase: POOL_SPEND_V2_TRUE_REDEMPTION,
      poolSpend,
      deedId: args.deedId,
      navEvidence: args.navEvidence,
      witnesses: args.witnesses,
    });
  }

  composeReserveAcquisition(
    args: ReserveAcquisitionExecutionArgs,
  ): PoolV2ExecutionBundle<ReserveAcquisitionQuote> {
    const poolSpend = this.builder.buildReserveAcquisitionCoinSpend({
      ...args.pool,
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
    return this.bundle({
      kind: 'reserve-acquisition',
      label: 'Reserve acquisition',
      spendCase: POOL_SPEND_V2_RESERVE_ACQUISITION,
      poolSpend,
      deedId: args.deedId,
      navEvidence: args.navEvidence,
      witnesses: args.witnesses,
    });
  }

  async submitSignaturelessBundle(
    bundle: PoolV2ExecutionBundle<
      SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote
    >,
  ): Promise<PushTxResponse> {
    return this.coinset.pushTransaction(bundle.signaturelessSpendBundle);
  }

  private bundle<
    Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
  >(args: {
    kind: PoolV2ExecutionKind;
    label: string;
    spendCase: number;
    poolSpend: PoolV2CoinSpendBuild<Quote>;
    deedId: string;
    navEvidence: CollectionNavEvidenceInput;
    witnesses: PoolV2BundleWitnesses;
  }): PoolV2ExecutionBundle<Quote> {
    const composed = this.builder.composePoolV2UnsignedBundle({
      poolSpend: args.poolSpend,
      deedId: args.deedId,
      navEvidence: args.navEvidence,
      witnesses: args.witnesses,
    });
    return {
      ...composed,
      kind: args.kind,
      label: args.label,
      spendCase: args.spendCase,
      actionTag: args.poolSpend.actionTag,
      signaturelessSpendBundle: {
        coinSpends: composed.coinSpends,
        aggregatedSignature: POOL_V2_EMPTY_AGGREGATE_SIGNATURE,
      },
    };
  }
}
