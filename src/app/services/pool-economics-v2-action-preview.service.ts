import { Injectable, inject } from '@angular/core';

import {
  type CollectionNavEvidenceInput,
  type PoolEconomicStateInput,
  type PoolV2ActionSpec,
  PoolEconomicsV2Service,
  type ReserveAcquisitionQuote,
  type SpecificDeedSwapQuote,
  type TrueRedemptionQuote,
} from './pool-economics-v2.service';
import {
  POOL_SPEND_V2_RESERVE_ACQUISITION,
  POOL_SPEND_V2_SPECIFIC_DEED_SWAP,
  POOL_SPEND_V2_TRUE_REDEMPTION,
  POOL_V2_MAX_UNSIGNED_BUNDLE_COIN_SPENDS,
  POOL_V2_MAX_WITNESS_COIN_SPENDS,
} from './pool-economics-v2-spend-builder.service';

export interface PoolV2ActionPreviewArgs {
  state: PoolEconomicStateInput;
  collectionNavMojos: bigint;
  sharePpm: bigint;
  sellerTokenPrice: bigint;
}

export type PoolV2ActionPreviewKind =
  | 'specific-deed-swap'
  | 'true-redemption'
  | 'reserve-acquisition';

export type PoolV2PreviewAnnouncementRole =
  | 'nav_evidence'
  | 'deed'
  | 'token_settlement'
  | 'token_authorization';

export type PoolV2PreviewAnnouncementKind =
  | 'puzzle_create'
  | 'coin_create'
  | 'puzzle_assert';

export interface PoolV2PreviewAnnouncement {
  role: PoolV2PreviewAnnouncementRole;
  kind: PoolV2PreviewAnnouncementKind;
  sourceId: string;
  message: string;
}

export interface PoolV2ActionPreview {
  kind: PoolV2ActionPreviewKind;
  label: string;
  spendCase: number;
  actionTag: number;
  poolActionMessage: string;
  requiredNavEvidenceMessage: string;
  deedMessage: string;
  tokenSettlementPaymentMessage: string | null;
  tokenOutputCount: number;
  tokenAuthorizationCount: number;
  requiredAnnouncements: PoolV2PreviewAnnouncement[];
  requiredWitnessCoinSpends: number;
  maxWitnessCoinSpends: number;
  unsignedBundleCoinSpendLimit: number;
}

const PREVIEW_IDS = {
  poolCoinId: b32('10'),
  deedId: b32('11'),
  deedLauncherId: b32('1f'),
  p2VaultPuzzleHash: b32('12'),
  collectionIdCanon: b32('13'),
  registryCoinId: b32('14'),
  registryPuzzleHash: b32('15'),
  collectionNavRoot: b32('16'),
  treasuryReservePuzhash: b32('17'),
  protocolTreasuryPuzhash: b32('18'),
  governanceRewardsPuzhash: b32('19'),
  governanceRewardsRoot: b32('1a'),
  tokenCoinId: b32('1b'),
  propertyIdCanon: b32('1c'),
  sellerPuzhash: b32('1d'),
  tokenSettlementPuzzleHash: b32('1e'),
};

@Injectable({ providedIn: 'root' })
export class PoolEconomicsV2ActionPreviewService {
  private readonly economics = inject(PoolEconomicsV2Service);

  specificDeedSwap(args: PoolV2ActionPreviewArgs): PoolV2ActionPreview {
    const navEvidence = this.navEvidence(args);
    const spec = this.economics.buildSpecificDeedSwapSpec({
      state: args.state,
      deedId: PREVIEW_IDS.deedId,
      deedLauncherId: PREVIEW_IDS.deedLauncherId,
      parValueMojos: args.collectionNavMojos,
      assetClass: 1n,
      propertyIdCanon: PREVIEW_IDS.propertyIdCanon,
      p2VaultPuzzleHash: PREVIEW_IDS.p2VaultPuzzleHash,
      collectionIdCanon: PREVIEW_IDS.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence,
      treasuryReservePuzhash: PREVIEW_IDS.treasuryReservePuzhash,
      protocolTreasuryPuzhash: PREVIEW_IDS.protocolTreasuryPuzhash,
      governanceRewardsPuzhash: PREVIEW_IDS.governanceRewardsPuzhash,
      governanceRewardsRoot: PREVIEW_IDS.governanceRewardsRoot,
    });
    return this.previewFromSpec({
      kind: 'specific-deed-swap',
      label: 'Specific deed swap',
      spendCase: POOL_SPEND_V2_SPECIFIC_DEED_SWAP,
      spec,
      navEvidence,
    });
  }

  trueRedemption(args: PoolV2ActionPreviewArgs): PoolV2ActionPreview {
    const navEvidence = this.navEvidence(args);
    const spec = this.economics.buildTrueRedemptionSpec({
      state: args.state,
      deedId: PREVIEW_IDS.deedId,
      deedLauncherId: PREVIEW_IDS.deedLauncherId,
      parValueMojos: args.collectionNavMojos,
      assetClass: 1n,
      propertyIdCanon: PREVIEW_IDS.propertyIdCanon,
      p2VaultPuzzleHash: PREVIEW_IDS.p2VaultPuzzleHash,
      collectionIdCanon: PREVIEW_IDS.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence,
      tokenCoinId: PREVIEW_IDS.tokenCoinId,
    });
    return this.previewFromSpec({
      kind: 'true-redemption',
      label: 'True redemption',
      spendCase: POOL_SPEND_V2_TRUE_REDEMPTION,
      spec,
      navEvidence,
    });
  }

  reserveAcquisition(args: PoolV2ActionPreviewArgs): PoolV2ActionPreview {
    const navEvidence = this.navEvidence(args);
    const spec = this.economics.buildReserveAcquisitionSpec({
      state: args.state,
      deedId: PREVIEW_IDS.deedId,
      deedLauncherId: PREVIEW_IDS.deedLauncherId,
      propertyIdCanon: PREVIEW_IDS.propertyIdCanon,
      parValueMojos: args.collectionNavMojos,
      assetClass: 1n,
      collectionIdCanon: PREVIEW_IDS.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence,
      sellerPuzhash: PREVIEW_IDS.sellerPuzhash,
      sellerTokenPrice: args.sellerTokenPrice,
      mintTokenCoinId: PREVIEW_IDS.tokenCoinId,
    });
    return this.previewFromSpec({
      kind: 'reserve-acquisition',
      label: 'Reserve acquisition',
      spendCase: POOL_SPEND_V2_RESERVE_ACQUISITION,
      spec,
      navEvidence,
    });
  }

  private previewFromSpec<
    Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
  >(args: {
    kind: PoolV2ActionPreviewKind;
    label: string;
    spendCase: number;
    spec: PoolV2ActionSpec<Quote>;
    navEvidence: CollectionNavEvidenceInput;
  }): PoolV2ActionPreview {
    const tokenSettlementPaymentMessage =
      args.spec.tokenOutputs.length > 0
        ? this.economics.tokenSettlementPaymentMessage(
            PREVIEW_IDS.poolCoinId,
            args.spec.tokenOutputs,
          )
        : null;
    const requiredAnnouncements: PoolV2PreviewAnnouncement[] = [
      {
        role: 'nav_evidence',
        kind: 'puzzle_create',
        sourceId: args.navEvidence.registryPuzzleHash,
        message: args.spec.requiredNavEvidenceMessage,
      },
      {
        role: 'deed',
        kind: 'coin_create',
        sourceId: PREVIEW_IDS.deedId,
        message: args.spec.deedMessage,
      },
    ];
    if (tokenSettlementPaymentMessage) {
      requiredAnnouncements.push({
        role: 'token_settlement',
        kind: 'puzzle_create',
        sourceId: PREVIEW_IDS.tokenSettlementPuzzleHash,
        message: tokenSettlementPaymentMessage,
      });
    }
    for (const authorization of args.spec.tokenAuthorizations) {
      requiredAnnouncements.push({
        role: 'token_authorization',
        kind: 'puzzle_assert',
        sourceId: authorization.tokenCoinId,
        message: authorization.announcementMessage,
      });
    }

    return {
      kind: args.kind,
      label: args.label,
      spendCase: args.spendCase,
      actionTag: args.spec.actionTag,
      poolActionMessage: args.spec.poolActionMessage,
      requiredNavEvidenceMessage: args.spec.requiredNavEvidenceMessage,
      deedMessage: args.spec.deedMessage,
      tokenSettlementPaymentMessage,
      tokenOutputCount: args.spec.tokenOutputs.length,
      tokenAuthorizationCount: args.spec.tokenAuthorizations.length,
      requiredAnnouncements,
      requiredWitnessCoinSpends: requiredAnnouncements.length,
      maxWitnessCoinSpends: POOL_V2_MAX_WITNESS_COIN_SPENDS,
      unsignedBundleCoinSpendLimit: POOL_V2_MAX_UNSIGNED_BUNDLE_COIN_SPENDS,
    };
  }

  private navEvidence(args: PoolV2ActionPreviewArgs): CollectionNavEvidenceInput {
    return {
      registryCoinId: PREVIEW_IDS.registryCoinId,
      registryPuzzleHash: PREVIEW_IDS.registryPuzzleHash,
      collectionIdCanon: PREVIEW_IDS.collectionIdCanon,
      navValueMojos: args.collectionNavMojos,
      collectionNavRoot: PREVIEW_IDS.collectionNavRoot,
      registryVersion: 1n,
    };
  }
}

function b32(byte: string): string {
  return `0x${byte.repeat(32)}`;
}
