import { Injectable } from '@angular/core';

import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import { type ClvmTreeValue, treeHashList, treeHashPair, treeHashValue } from '../utils/clvm-tree-hash';

export const SHARE_PPM_DENOMINATOR = 1_000_000n;
export const FEE_BPS_DENOMINATOR = 10_000n;
export const DEFAULT_SWAP_FEE_BPS = 100n;
export const DEFAULT_PROTOCOL_FEE_BPS = 30n;
export const DEFAULT_GOVERNANCE_FEE_BPS = 70n;
export const MAX_POOL_V2_TOKEN_OUTPUTS = 3;
export const PROTOCOL_PREFIX_HEX = '0x53';
export const TOKEN_MINT = 1;
export const TOKEN_MELT = -1;
export const DEED_SPEND_POOL_DEPOSIT = 0x64;
export const DEED_SPEND_POOL_REDEEM = 0x72;
export const NAV_EVIDENCE_TAG = 0x4e415645;
export const POOL_V2_SPECIFIC_DEED_SWAP_TAG = 0x53574150;
export const POOL_V2_TRUE_REDEMPTION_TAG = 0x5244454d;
export const POOL_V2_RESERVE_ACQUISITION_TAG = 0x41435152;

export type BigintLike = bigint | number | string;

export interface PoolEconomicStateInput {
  totalNavLockedMojos: BigintLike;
  deedCount: BigintLike;
  totalPoolTokenSupply: BigintLike;
  treasuryReserveTokens: BigintLike;
}

export interface PoolEconomicState {
  totalNavLockedMojos: bigint;
  deedCount: bigint;
  totalPoolTokenSupply: bigint;
  treasuryReserveTokens: bigint;
}

export interface FeeSplit {
  totalFeeTokens: bigint;
  protocolTreasuryTokens: bigint;
  governanceRewardsTokens: bigint;
}

export interface SpecificDeedSwapQuote {
  deedNavMojos: bigint;
  circulatingSupplyBefore: bigint;
  principalTokens: bigint;
  fee: FeeSplit;
  buyerPaysTokens: bigint;
  totalNavLockedAfter: bigint;
  deedCountAfter: bigint;
  totalSupplyAfter: bigint;
  treasuryReserveTokensAfter: bigint;
  circulatingSupplyAfter: bigint;
}

export interface TrueRedemptionQuote {
  deedNavMojos: bigint;
  circulatingSupplyBefore: bigint;
  principalTokens: bigint;
  totalNavLockedAfter: bigint;
  deedCountAfter: bigint;
  totalSupplyAfter: bigint;
  treasuryReserveTokensAfter: bigint;
  circulatingSupplyAfter: bigint;
}

export interface ReserveAcquisitionQuote {
  deedNavMojos: bigint;
  sellerReceivesReserveTokens: bigint;
  freshMintShortfallTokens: bigint;
  totalSupplyAfter: bigint;
  treasuryReserveTokensAfter: bigint;
  totalNavLockedAfter: bigint;
  deedCountAfter: bigint;
}

export interface CollectionNavEvidenceInput {
  registryCoinId: string;
  registryPuzzleHash: string;
  collectionIdCanon: string;
  navValueMojos: BigintLike;
  collectionNavRoot: string;
  registryVersion: BigintLike;
}

export interface PoolV2TokenOutputInput {
  puzzleHash: string;
  amount: BigintLike;
  role: string;
  memos?: string[];
}

export interface PoolV2TokenOutput {
  puzzleHash: string;
  amount: bigint;
  role: string;
  memos: string[];
}

export interface PoolV2TokenAuthorization {
  mintOrMelt: number;
  tokenCoinId: string;
  amount: bigint;
  announcementMessage: string;
}

export interface PoolV2ActionSpec<
  Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
> {
  actionTag: number;
  quote: Quote;
  nextState: PoolEconomicState;
  navEvidenceMessage: string;
  requiredNavEvidenceMessage: string;
  deedCommitment: string;
  poolActionMessage: string;
  deedMessage: string;
  tokenOutputs: PoolV2TokenOutput[];
  tokenAuthorizations: PoolV2TokenAuthorization[];
}

@Injectable({ providedIn: 'root' })
export class PoolEconomicsV2Service {
  normaliseState(input: PoolEconomicStateInput): PoolEconomicState {
    const state: PoolEconomicState = {
      totalNavLockedMojos: toBigInt(input.totalNavLockedMojos),
      deedCount: toBigInt(input.deedCount),
      totalPoolTokenSupply: toBigInt(input.totalPoolTokenSupply),
      treasuryReserveTokens: toBigInt(input.treasuryReserveTokens),
    };
    assertNonNegative('totalNavLockedMojos', state.totalNavLockedMojos);
    assertNonNegative('deedCount', state.deedCount);
    assertNonNegative('totalPoolTokenSupply', state.totalPoolTokenSupply);
    assertNonNegative('treasuryReserveTokens', state.treasuryReserveTokens);
    if (state.treasuryReserveTokens > state.totalPoolTokenSupply) {
      throw new Error('treasuryReserveTokens cannot exceed totalPoolTokenSupply');
    }
    return state;
  }

  circulatingSupply(input: PoolEconomicStateInput): bigint {
    const state = this.normaliseState(input);
    return state.totalPoolTokenSupply - state.treasuryReserveTokens;
  }

  deedNavMojos(collectionNavMojos: BigintLike, sharePpm: BigintLike): bigint {
    const nav = toBigInt(collectionNavMojos);
    const share = toBigInt(sharePpm);
    if (nav <= 0n) throw new Error('collectionNavMojos must be positive');
    if (share < 1n || share > SHARE_PPM_DENOMINATOR) {
      throw new Error('sharePpm must be in 1..1000000');
    }
    return ceilDiv(nav * share, SHARE_PPM_DENOMINATOR);
  }

  principalTokensForNav(deedNavMojos: BigintLike, input: PoolEconomicStateInput): bigint {
    const deedNav = toBigInt(deedNavMojos);
    const state = this.normaliseState(input);
    const circulating = state.totalPoolTokenSupply - state.treasuryReserveTokens;
    if (deedNav <= 0n) throw new Error('deedNavMojos must be positive');
    if (state.totalNavLockedMojos <= 0n) {
      throw new Error('totalNavLockedMojos must be positive');
    }
    if (circulating <= 0n) throw new Error('circulating supply must be positive');
    if (deedNav > state.totalNavLockedMojos) {
      throw new Error('deedNavMojos cannot exceed totalNavLockedMojos');
    }
    return ceilDiv(deedNav * circulating, state.totalNavLockedMojos);
  }

  feeSplitForPrincipal(
    principalTokens: BigintLike,
    swapFeeBps: BigintLike = DEFAULT_SWAP_FEE_BPS,
    protocolFeeBps: BigintLike = DEFAULT_PROTOCOL_FEE_BPS,
  ): FeeSplit {
    const principal = toBigInt(principalTokens);
    const swapBps = toBigInt(swapFeeBps);
    const protocolBps = toBigInt(protocolFeeBps);
    if (principal <= 0n) throw new Error('principalTokens must be positive');
    if (swapBps < 0n || protocolBps < 0n || protocolBps > swapBps) {
      throw new Error('fee bps must satisfy 0 <= protocol <= swap');
    }
    const totalFeeTokens = ceilDiv(principal * swapBps, FEE_BPS_DENOMINATOR);
    const protocolTreasuryTokens = ceilDiv(principal * protocolBps, FEE_BPS_DENOMINATOR);
    return {
      totalFeeTokens,
      protocolTreasuryTokens,
      governanceRewardsTokens: totalFeeTokens - protocolTreasuryTokens,
    };
  }

  quoteSpecificDeedSwap(args: {
    collectionNavMojos: BigintLike;
    sharePpm: BigintLike;
    state: PoolEconomicStateInput;
  }): SpecificDeedSwapQuote {
    const state = this.normaliseState(args.state);
    const deedNav = this.deedNavMojos(args.collectionNavMojos, args.sharePpm);
    const circulatingBefore = state.totalPoolTokenSupply - state.treasuryReserveTokens;
    const principal = this.principalTokensForNav(deedNav, state);
    const fee = this.feeSplitForPrincipal(principal);
    const treasuryReserveTokensAfter = state.treasuryReserveTokens + principal;
    if (state.deedCount <= 0n) throw new Error('deedCount must be positive');
    return {
      deedNavMojos: deedNav,
      circulatingSupplyBefore: circulatingBefore,
      principalTokens: principal,
      fee,
      buyerPaysTokens: principal + fee.totalFeeTokens,
      totalNavLockedAfter: state.totalNavLockedMojos - deedNav,
      deedCountAfter: state.deedCount - 1n,
      totalSupplyAfter: state.totalPoolTokenSupply,
      treasuryReserveTokensAfter,
      circulatingSupplyAfter: state.totalPoolTokenSupply - treasuryReserveTokensAfter,
    };
  }

  quoteTrueRedemption(args: {
    collectionNavMojos: BigintLike;
    sharePpm: BigintLike;
    state: PoolEconomicStateInput;
  }): TrueRedemptionQuote {
    const state = this.normaliseState(args.state);
    const deedNav = this.deedNavMojos(args.collectionNavMojos, args.sharePpm);
    const circulatingBefore = state.totalPoolTokenSupply - state.treasuryReserveTokens;
    const principal = this.principalTokensForNav(deedNav, state);
    if (state.deedCount <= 0n) throw new Error('deedCount must be positive');
    if (principal > state.totalPoolTokenSupply) {
      throw new Error('principalTokens cannot exceed totalPoolTokenSupply');
    }
    const totalSupplyAfter = state.totalPoolTokenSupply - principal;
    return {
      deedNavMojos: deedNav,
      circulatingSupplyBefore: circulatingBefore,
      principalTokens: principal,
      totalNavLockedAfter: state.totalNavLockedMojos - deedNav,
      deedCountAfter: state.deedCount - 1n,
      totalSupplyAfter,
      treasuryReserveTokensAfter: state.treasuryReserveTokens,
      circulatingSupplyAfter: totalSupplyAfter - state.treasuryReserveTokens,
    };
  }

  quoteReserveAcquisition(args: {
    collectionNavMojos: BigintLike;
    sharePpm: BigintLike;
    sellerTokenPrice: BigintLike;
    state: PoolEconomicStateInput;
  }): ReserveAcquisitionQuote {
    const state = this.normaliseState(args.state);
    const deedNav = this.deedNavMojos(args.collectionNavMojos, args.sharePpm);
    const paymentTokens = toBigInt(args.sellerTokenPrice);
    if (paymentTokens <= 0n) throw new Error('sellerTokenPrice must be positive');
    const reservePayment =
      state.treasuryReserveTokens < paymentTokens
        ? state.treasuryReserveTokens
        : paymentTokens;
    const freshMintShortfallTokens = paymentTokens - reservePayment;
    return {
      deedNavMojos: deedNav,
      sellerReceivesReserveTokens: reservePayment,
      freshMintShortfallTokens,
      totalSupplyAfter: state.totalPoolTokenSupply + freshMintShortfallTokens,
      treasuryReserveTokensAfter: state.treasuryReserveTokens - reservePayment,
      totalNavLockedAfter: state.totalNavLockedMojos + deedNav,
      deedCountAfter: state.deedCount + 1n,
    };
  }

  collectionNavEvidenceMessage(evidence: CollectionNavEvidenceInput): string {
    const normal = this.normaliseNavEvidence(evidence);
    return bytesToHex(
      treeHashList([
        NAV_EVIDENCE_TAG,
        normal.collectionIdCanonBytes,
        normal.navValueMojos,
        normal.collectionNavRootBytes,
        normal.registryVersion,
      ]),
    );
  }

  collectionNavEvidenceAnnouncement(evidence: CollectionNavEvidenceInput): string {
    return prefixMessage(this.collectionNavEvidenceMessage(evidence));
  }

  deedMetadataCommitment(args: {
    deedLauncherId: string;
    parValueMojos: BigintLike;
    assetClass: BigintLike;
    propertyIdCanon: string;
    collectionIdCanon: string;
    sharePpm: BigintLike;
  }): string {
    const parValueMojos = toBigInt(args.parValueMojos);
    const assetClass = toBigInt(args.assetClass);
    if (parValueMojos <= 0n) throw new Error('parValueMojos must be positive');
    if (assetClass < 0n) throw new Error('assetClass must be non-negative');
    return bytesToHex(
      treeHashList([
        bytes32(args.deedLauncherId, 'deedLauncherId'),
        parValueMojos,
        assetClass,
        bytes32(args.propertyIdCanon, 'propertyIdCanon'),
        bytes32(args.collectionIdCanon, 'collectionIdCanon'),
        this.normaliseSharePpm(args.sharePpm),
      ]),
    );
  }

  deedPoolRedeemMessage(args: {
    deedCommitment: string;
    p2VaultPuzzleHash: string;
  }): string {
    return prefixedTreeMessage([
      DEED_SPEND_POOL_REDEEM,
      bytes32(args.deedCommitment, 'deedCommitment'),
      bytes32(args.p2VaultPuzzleHash, 'p2VaultPuzzleHash'),
    ]);
  }

  deedPoolDepositMessage(args: {
    deedId: string;
    deedLauncherId: string;
    parValueMojos: BigintLike;
    assetClass: BigintLike;
    propertyIdCanon: string;
    collectionIdCanon: string;
    sharePpm: BigintLike;
  }): string {
    const parValueMojos = toBigInt(args.parValueMojos);
    const assetClass = toBigInt(args.assetClass);
    if (parValueMojos <= 0n) throw new Error('parValueMojos must be positive');
    if (assetClass <= 0n) throw new Error('assetClass must be positive');
    const commitment = this.deedMetadataCommitment(args);
    return prefixedTreeMessage([
      DEED_SPEND_POOL_DEPOSIT,
      bytes32(args.deedId, 'deedId'),
      bytes32(commitment, 'deedCommitment'),
      parValueMojos,
      assetClass,
      bytes32(args.propertyIdCanon, 'propertyIdCanon'),
      bytes32(args.collectionIdCanon, 'collectionIdCanon'),
      this.normaliseSharePpm(args.sharePpm),
    ]);
  }

  tokenAuthorizationMessage(args: {
    mintOrMelt: number;
    tokenCoinId: string;
    amount: BigintLike;
  }): string {
    if (args.mintOrMelt !== TOKEN_MINT && args.mintOrMelt !== TOKEN_MELT) {
      throw new Error('mintOrMelt must be TOKEN_MINT or TOKEN_MELT');
    }
    const amount = toBigInt(args.amount);
    if (amount <= 0n) throw new Error('amount must be positive');
    return prefixedTreeMessage([
      args.mintOrMelt,
      bytes32(args.tokenCoinId, 'tokenCoinId'),
      amount,
    ]);
  }

  tokenSettlementPaymentMessage(poolCoinId: string, outputs: PoolV2TokenOutputInput[]): string {
    const normalOutputs = this.normaliseTokenOutputs(outputs);
    if (normalOutputs.length === 0) throw new Error('outputs must not be empty');
    if (normalOutputs.length > MAX_POOL_V2_TOKEN_OUTPUTS) {
      throw new Error(`outputs cannot exceed ${MAX_POOL_V2_TOKEN_OUTPUTS}`);
    }
    const payments: ClvmTreeValue[] = normalOutputs.map((output) => [
      bytes32(output.puzzleHash, 'tokenOutput.puzzleHash'),
      output.amount,
      output.memos.map((memo) => bytes32(memo, 'tokenOutput.memo')),
    ]);
    return bytesToHex(
      treeHashPair(
        treeHashValue(bytes32(poolCoinId, 'poolCoinId')),
        treeHashList(payments),
      ),
    );
  }

  buildSpecificDeedSwapSpec(args: {
    state: PoolEconomicStateInput;
    deedId: string;
    deedLauncherId: string;
    parValueMojos: BigintLike;
    assetClass: BigintLike;
    propertyIdCanon: string;
    p2VaultPuzzleHash: string;
    collectionIdCanon: string;
    sharePpm: BigintLike;
    navEvidence: CollectionNavEvidenceInput;
    treasuryReservePuzhash: string;
    protocolTreasuryPuzhash: string;
    governanceRewardsPuzhash: string;
    governanceRewardsRoot: string;
  }): PoolV2ActionSpec<SpecificDeedSwapQuote> {
    this.assertEvidenceCollection(args.navEvidence, args.collectionIdCanon);
    const evidence = this.normaliseNavEvidence(args.navEvidence);
    const quote = this.quoteSpecificDeedSwap({
      state: args.state,
      collectionNavMojos: evidence.navValueMojos,
      sharePpm: args.sharePpm,
    });
    const deedId = bytes32(args.deedId, 'deedId');
    const deedCommitment = this.deedMetadataCommitment(args);
    const p2Vault = bytes32(args.p2VaultPuzzleHash, 'p2VaultPuzzleHash');
    const collection = bytes32(args.collectionIdCanon, 'collectionIdCanon');
    const reserve = bytes32(args.treasuryReservePuzhash, 'treasuryReservePuzhash');
    const protocol = bytes32(args.protocolTreasuryPuzhash, 'protocolTreasuryPuzhash');
    const rewards = bytes32(args.governanceRewardsPuzhash, 'governanceRewardsPuzhash');
    const rewardsRoot = bytes32(args.governanceRewardsRoot, 'governanceRewardsRoot');
    const sharePpm = this.normaliseSharePpm(args.sharePpm);
    const tokenOutputs = this.normaliseTokenOutputs([
      {
        puzzleHash: args.treasuryReservePuzhash,
        amount: quote.principalTokens,
        role: 'treasury_reserve_principal',
        memos: [args.treasuryReservePuzhash],
      },
      {
        puzzleHash: args.protocolTreasuryPuzhash,
        amount: quote.fee.protocolTreasuryTokens,
        role: 'protocol_treasury_fee',
        memos: [args.protocolTreasuryPuzhash],
      },
      {
        puzzleHash: args.governanceRewardsPuzhash,
        amount: quote.fee.governanceRewardsTokens,
        role: 'sgt_rewards_fee',
        memos: [args.governanceRewardsPuzhash, args.governanceRewardsRoot],
      },
    ]);
    return {
      actionTag: POOL_V2_SPECIFIC_DEED_SWAP_TAG,
      quote,
      nextState: this.stateAfterSwap(quote),
      navEvidenceMessage: this.collectionNavEvidenceMessage(args.navEvidence),
      requiredNavEvidenceMessage: this.collectionNavEvidenceAnnouncement(args.navEvidence),
      deedCommitment,
      poolActionMessage: prefixedTreeMessage([
        POOL_V2_SPECIFIC_DEED_SWAP_TAG,
        deedId,
        bytes32(deedCommitment, 'deedCommitment'),
        p2Vault,
        collection,
        sharePpm,
        evidence.navValueMojos,
        evidence.collectionNavRootBytes,
        evidence.registryVersion,
        evidence.registryCoinIdBytes,
        evidence.registryPuzzleHashBytes,
        quote.deedNavMojos,
        quote.principalTokens,
        quote.fee.protocolTreasuryTokens,
        quote.fee.governanceRewardsTokens,
        reserve,
        protocol,
        rewards,
        rewardsRoot,
      ]),
      deedMessage: this.deedPoolRedeemMessage({
        deedCommitment,
        p2VaultPuzzleHash: args.p2VaultPuzzleHash,
      }),
      tokenOutputs,
      tokenAuthorizations: [],
    };
  }

  buildTrueRedemptionSpec(args: {
    state: PoolEconomicStateInput;
    deedId: string;
    deedLauncherId: string;
    parValueMojos: BigintLike;
    assetClass: BigintLike;
    propertyIdCanon: string;
    p2VaultPuzzleHash: string;
    collectionIdCanon: string;
    sharePpm: BigintLike;
    navEvidence: CollectionNavEvidenceInput;
    tokenCoinId: string;
  }): PoolV2ActionSpec<TrueRedemptionQuote> {
    this.assertEvidenceCollection(args.navEvidence, args.collectionIdCanon);
    const evidence = this.normaliseNavEvidence(args.navEvidence);
    const quote = this.quoteTrueRedemption({
      state: args.state,
      collectionNavMojos: evidence.navValueMojos,
      sharePpm: args.sharePpm,
    });
    const sharePpm = this.normaliseSharePpm(args.sharePpm);
    const deedCommitment = this.deedMetadataCommitment(args);
    const auth: PoolV2TokenAuthorization = {
      mintOrMelt: TOKEN_MELT,
      tokenCoinId: normalizeHex(args.tokenCoinId),
      amount: quote.principalTokens,
      announcementMessage: this.tokenAuthorizationMessage({
        mintOrMelt: TOKEN_MELT,
        tokenCoinId: args.tokenCoinId,
        amount: quote.principalTokens,
      }),
    };
    return {
      actionTag: POOL_V2_TRUE_REDEMPTION_TAG,
      quote,
      nextState: this.stateAfterRedemption(quote),
      navEvidenceMessage: this.collectionNavEvidenceMessage(args.navEvidence),
      requiredNavEvidenceMessage: this.collectionNavEvidenceAnnouncement(args.navEvidence),
      deedCommitment,
      poolActionMessage: prefixedTreeMessage([
        POOL_V2_TRUE_REDEMPTION_TAG,
        bytes32(args.deedId, 'deedId'),
        bytes32(deedCommitment, 'deedCommitment'),
        bytes32(args.p2VaultPuzzleHash, 'p2VaultPuzzleHash'),
        bytes32(args.collectionIdCanon, 'collectionIdCanon'),
        sharePpm,
        evidence.navValueMojos,
        evidence.collectionNavRootBytes,
        evidence.registryVersion,
        evidence.registryCoinIdBytes,
        evidence.registryPuzzleHashBytes,
        quote.deedNavMojos,
        quote.principalTokens,
        bytes32(args.tokenCoinId, 'tokenCoinId'),
      ]),
      deedMessage: this.deedPoolRedeemMessage({
        deedCommitment,
        p2VaultPuzzleHash: args.p2VaultPuzzleHash,
      }),
      tokenOutputs: [],
      tokenAuthorizations: [auth],
    };
  }

  buildReserveAcquisitionSpec(args: {
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
  }): PoolV2ActionSpec<ReserveAcquisitionQuote> {
    this.assertEvidenceCollection(args.navEvidence, args.collectionIdCanon);
    const evidence = this.normaliseNavEvidence(args.navEvidence);
    const quote = this.quoteReserveAcquisition({
      state: args.state,
      collectionNavMojos: evidence.navValueMojos,
      sharePpm: args.sharePpm,
      sellerTokenPrice: args.sellerTokenPrice,
    });
    if (quote.freshMintShortfallTokens > 0n && !args.mintTokenCoinId) {
      throw new Error('mintTokenCoinId is required when reserve has a fresh mint shortfall');
    }
    const sharePpm = this.normaliseSharePpm(args.sharePpm);
    const deedCommitment = this.deedMetadataCommitment(args);
    const mintTokenCoinId = quote.freshMintShortfallTokens > 0n && args.mintTokenCoinId
      ? bytes32(args.mintTokenCoinId, 'mintTokenCoinId')
      : null;
    const tokenOutputs =
      quote.sellerReceivesReserveTokens > 0n
        ? this.normaliseTokenOutputs([
            {
              puzzleHash: args.sellerPuzhash,
              amount: quote.sellerReceivesReserveTokens,
              role: 'seller_reserve_payment',
              memos: [args.sellerPuzhash],
            },
          ])
        : [];
    const tokenAuthorizations: PoolV2TokenAuthorization[] =
      quote.freshMintShortfallTokens > 0n && args.mintTokenCoinId
        ? [
            {
              mintOrMelt: TOKEN_MINT,
              tokenCoinId: normalizeHex(args.mintTokenCoinId),
              amount: quote.freshMintShortfallTokens,
              announcementMessage: this.tokenAuthorizationMessage({
                mintOrMelt: TOKEN_MINT,
                tokenCoinId: args.mintTokenCoinId,
                amount: quote.freshMintShortfallTokens,
              }),
            },
          ]
        : [];
    return {
      actionTag: POOL_V2_RESERVE_ACQUISITION_TAG,
      quote,
      nextState: this.stateAfterAcquisition(quote),
      navEvidenceMessage: this.collectionNavEvidenceMessage(args.navEvidence),
      requiredNavEvidenceMessage: this.collectionNavEvidenceAnnouncement(args.navEvidence),
      deedCommitment,
      poolActionMessage: prefixedTreeMessage([
        POOL_V2_RESERVE_ACQUISITION_TAG,
        bytes32(args.deedId, 'deedId'),
        bytes32(deedCommitment, 'deedCommitment'),
        bytes32(args.propertyIdCanon, 'propertyIdCanon'),
        toBigInt(args.parValueMojos),
        toBigInt(args.assetClass),
        bytes32(args.collectionIdCanon, 'collectionIdCanon'),
        sharePpm,
        evidence.navValueMojos,
        evidence.collectionNavRootBytes,
        evidence.registryVersion,
        evidence.registryCoinIdBytes,
        evidence.registryPuzzleHashBytes,
        quote.deedNavMojos,
        toBigInt(args.sellerTokenPrice),
        quote.sellerReceivesReserveTokens,
        quote.freshMintShortfallTokens,
        bytes32(args.sellerPuzhash, 'sellerPuzhash'),
        mintTokenCoinId,
      ]),
      deedMessage: this.deedPoolDepositMessage({
        deedId: args.deedId,
        deedLauncherId: args.deedLauncherId,
        parValueMojos: args.parValueMojos,
        assetClass: args.assetClass,
        propertyIdCanon: args.propertyIdCanon,
        collectionIdCanon: args.collectionIdCanon,
        sharePpm,
      }),
      tokenOutputs,
      tokenAuthorizations,
    };
  }

  private normaliseSharePpm(value: BigintLike): bigint {
    const share = toBigInt(value);
    if (share < 1n || share > SHARE_PPM_DENOMINATOR) {
      throw new Error('sharePpm must be in 1..1000000');
    }
    return share;
  }

  private normaliseNavEvidence(evidence: CollectionNavEvidenceInput): NormalisedNavEvidence {
    const navValueMojos = toBigInt(evidence.navValueMojos);
    const registryVersion = toBigInt(evidence.registryVersion);
    if (navValueMojos <= 0n) throw new Error('navValueMojos must be positive');
    assertNonNegative('registryVersion', registryVersion);
    return {
      registryCoinId: normalizeHex(evidence.registryCoinId),
      registryCoinIdBytes: bytes32(evidence.registryCoinId, 'registryCoinId'),
      registryPuzzleHash: normalizeHex(evidence.registryPuzzleHash),
      registryPuzzleHashBytes: bytes32(evidence.registryPuzzleHash, 'registryPuzzleHash'),
      collectionIdCanon: normalizeHex(evidence.collectionIdCanon),
      collectionIdCanonBytes: bytes32(evidence.collectionIdCanon, 'collectionIdCanon'),
      navValueMojos,
      collectionNavRoot: normalizeHex(evidence.collectionNavRoot),
      collectionNavRootBytes: bytes32(evidence.collectionNavRoot, 'collectionNavRoot'),
      registryVersion,
    };
  }

  private assertEvidenceCollection(evidence: CollectionNavEvidenceInput, collectionIdCanon: string): void {
    if (normalizeHex(evidence.collectionIdCanon) !== normalizeHex(collectionIdCanon)) {
      throw new Error('NAV evidence collectionIdCanon mismatch');
    }
  }

  private normaliseTokenOutputs(outputs: PoolV2TokenOutputInput[]): PoolV2TokenOutput[] {
    return outputs.map((output) => {
      const amount = toBigInt(output.amount);
      if (amount <= 0n) throw new Error('token output amount must be positive');
      const puzzleHash = normalizeHex(output.puzzleHash);
      const memos = output.memos && output.memos.length > 0
        ? output.memos.map(normalizeHex)
        : [puzzleHash];
      memos.forEach((memo) => bytes32(memo, 'tokenOutput.memo'));
      bytes32(puzzleHash, 'tokenOutput.puzzleHash');
      return { puzzleHash, amount, role: output.role, memos };
    });
  }

  private stateAfterSwap(quote: SpecificDeedSwapQuote): PoolEconomicState {
    return {
      totalNavLockedMojos: quote.totalNavLockedAfter,
      deedCount: quote.deedCountAfter,
      totalPoolTokenSupply: quote.totalSupplyAfter,
      treasuryReserveTokens: quote.treasuryReserveTokensAfter,
    };
  }

  private stateAfterRedemption(quote: TrueRedemptionQuote): PoolEconomicState {
    return {
      totalNavLockedMojos: quote.totalNavLockedAfter,
      deedCount: quote.deedCountAfter,
      totalPoolTokenSupply: quote.totalSupplyAfter,
      treasuryReserveTokens: quote.treasuryReserveTokensAfter,
    };
  }

  private stateAfterAcquisition(quote: ReserveAcquisitionQuote): PoolEconomicState {
    return {
      totalNavLockedMojos: quote.totalNavLockedAfter,
      deedCount: quote.deedCountAfter,
      totalPoolTokenSupply: quote.totalSupplyAfter,
      treasuryReserveTokens: quote.treasuryReserveTokensAfter,
    };
  }
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  if (numerator < 0n) throw new Error('numerator must be non-negative');
  return (numerator + denominator - 1n) / denominator;
}

function toBigInt(value: BigintLike): bigint {
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

function assertNonNegative(field: string, value: bigint): void {
  if (value < 0n) throw new Error(`${field} must be non-negative`);
}

interface NormalisedNavEvidence {
  registryCoinId: string;
  registryCoinIdBytes: Uint8Array;
  registryPuzzleHash: string;
  registryPuzzleHashBytes: Uint8Array;
  collectionIdCanon: string;
  collectionIdCanonBytes: Uint8Array;
  navValueMojos: bigint;
  collectionNavRoot: string;
  collectionNavRootBytes: Uint8Array;
  registryVersion: bigint;
}

function prefixedTreeMessage(items: ReadonlyArray<ClvmTreeValue>): string {
  return prefixMessage(bytesToHex(treeHashList(items)));
}

function prefixMessage(messageHex: string): string {
  return bytesToHex(concatBytes([hexToBytes(PROTOCOL_PREFIX_HEX), bytes32(messageHex, 'message')]));
}

function bytes32(hex: string, field: string): Uint8Array {
  const bytes = hexToBytes(normalizeHex(hex));
  if (bytes.length !== 32) {
    throw new Error(`${field} must be 32 bytes`);
  }
  return bytes;
}

function normalizeHex(hex: string): string {
  const prefixed = hex.startsWith('0x') ? hex : `0x${hex}`;
  const body = prefixed.slice(2);
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) {
    throw new Error(`invalid hex: ${hex}`);
  }
  return `0x${body.toLowerCase()}`;
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
