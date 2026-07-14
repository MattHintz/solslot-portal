import { TestBed } from '@angular/core/testing';

import {
  DEFAULT_GOVERNANCE_FEE_BPS,
  DEFAULT_PROTOCOL_FEE_BPS,
  DEFAULT_SWAP_FEE_BPS,
  DEED_SPEND_POOL_DEPOSIT,
  DEED_SPEND_POOL_REDEEM,
  FEE_BPS_DENOMINATOR,
  MAX_POOL_V2_TOKEN_OUTPUTS,
  NAV_EVIDENCE_TAG,
  POOL_V2_RESERVE_ACQUISITION_TAG,
  POOL_V2_SPECIFIC_DEED_SWAP_TAG,
  POOL_V2_TRUE_REDEMPTION_TAG,
  PoolEconomicsV2Service,
  PROTOCOL_PREFIX_HEX,
  SHARE_PPM_DENOMINATOR,
  TOKEN_MELT,
  TOKEN_MINT,
} from './pool-economics-v2.service';
import fixturesJson from './pool-economics-v2.fixtures.json';

interface FixtureState {
  total_nav_locked_mojos: number;
  deed_count: number;
  total_pool_token_supply: number;
  treasury_reserve_tokens: number;
}

interface FixtureEvidence {
  registry_coin_id: string;
  registry_puzzle_hash: string;
  collection_id_canon: string;
  nav_value_mojos: number;
  collection_nav_root: string;
  registry_version: number;
}

interface FixtureExpected {
  action_tag: number;
  quote: Record<string, any>;
  next_state: FixtureState;
  nav_evidence_message: string;
  required_nav_evidence_message: string;
  pool_action_message: string;
  deed_message: string;
  token_outputs: Array<{ puzzle_hash: string; amount: number; role: string; memos: string[] }>;
  token_authorizations: Array<{
    mint_or_melt: number;
    token_coin_id: string;
    amount: number;
    announcement_message: string;
  }>;
  token_settlement_payment_message?: string;
}

interface FixtureConstants {
  share_ppm_denominator: number;
  fee_bps_denominator: number;
  default_swap_fee_bps: number;
  default_protocol_fee_bps: number;
  default_governance_fee_bps: number;
  max_pool_v2_token_outputs: number;
  protocol_prefix: string;
  token_mint: number;
  token_melt: number;
  deed_spend_pool_deposit: number;
  deed_spend_pool_redeem: number;
  pool_spend_v2_specific_deed_swap: number;
  pool_spend_v2_true_redemption: number;
  pool_spend_v2_reserve_acquisition: number;
  nav_evidence_tag: number;
  pool_v2_specific_deed_swap_tag: number;
  pool_v2_true_redemption_tag: number;
  pool_v2_reserve_acquisition_tag: number;
}

interface FixtureFile {
  constants: FixtureConstants;
  common: {
    state: FixtureState;
  pool_coin_id: string;
  deed_id: string;
  deed_launcher_id: string;
    p2_vault_puzzle_hash: string;
    property_id_canon: string;
    collection_id_canon: string;
    token_coin_id: string;
    nav_evidence: FixtureEvidence;
    acquisition_nav_evidence: FixtureEvidence;
  };
  specific_deed_swap: {
    inputs: Record<string, any>;
    expected: FixtureExpected;
  };
  true_redemption: {
    inputs: Record<string, any>;
    expected: FixtureExpected;
  };
  reserve_acquisition: {
    inputs: Record<string, any>;
    expected: FixtureExpected;
  };
}

const fixture = fixturesJson as FixtureFile;
const DEED_METADATA = {
  deedLauncherId: fixture.common.deed_launcher_id,
  parValueMojos: fixture.reserve_acquisition.inputs['par_value_mojos'],
  assetClass: fixture.reserve_acquisition.inputs['asset_class'],
  propertyIdCanon: fixture.common.property_id_canon,
};

describe('PoolEconomicsV2Service', () => {
  let service: PoolEconomicsV2Service;

  const state = {
    totalNavLockedMojos: 10_000n,
    deedCount: 10n,
    totalPoolTokenSupply: 1_000n,
    treasuryReserveTokens: 200n,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PoolEconomicsV2Service);
  });

  it('computes deed NAV from collection NAV and share ppm with ceiling rounding', () => {
    expect(service.deedNavMojos(1_000_001n, 333_333n)).toBe(333_334n);
  });

  it('prices specific deed swaps pro-rata against circulating supply', () => {
    const quote = service.quoteSpecificDeedSwap({
      collectionNavMojos: 2_500n,
      sharePpm: 1_000_000n,
      state,
    });

    expect(quote.deedNavMojos).toBe(2_500n);
    expect(quote.circulatingSupplyBefore).toBe(800n);
    expect(quote.principalTokens).toBe(200n);
    expect(quote.buyerPaysTokens).toBe(202n);
    expect(quote.fee.protocolTreasuryTokens).toBe(1n);
    expect(quote.fee.governanceRewardsTokens).toBe(1n);
    expect(quote.totalNavLockedAfter).toBe(7_500n);
    expect(quote.deedCountAfter).toBe(9n);
    expect(quote.totalSupplyAfter).toBe(1_000n);
    expect(quote.treasuryReserveTokensAfter).toBe(400n);
    expect(quote.circulatingSupplyAfter).toBe(600n);
  });

  it('quotes true redemption as supply burn without reserve increase', () => {
    const quote = service.quoteTrueRedemption({
      collectionNavMojos: 2_500n,
      sharePpm: 1_000_000n,
      state,
    });

    expect(quote.principalTokens).toBe(200n);
    expect(quote.totalNavLockedAfter).toBe(7_500n);
    expect(quote.deedCountAfter).toBe(9n);
    expect(quote.totalSupplyAfter).toBe(800n);
    expect(quote.treasuryReserveTokensAfter).toBe(200n);
    expect(quote.circulatingSupplyAfter).toBe(600n);
  });

  it('uses treasury reserve before fresh minting for acquisitions', () => {
    const quote = service.quoteReserveAcquisition({
      collectionNavMojos: 4_000n,
      sharePpm: 500_000n,
      sellerTokenPrice: 250n,
      state,
    });

    expect(quote.deedNavMojos).toBe(2_000n);
    expect(quote.sellerReceivesReserveTokens).toBe(200n);
    expect(quote.freshMintShortfallTokens).toBe(50n);
    expect(quote.totalSupplyAfter).toBe(1_050n);
    expect(quote.treasuryReserveTokensAfter).toBe(0n);
    expect(quote.totalNavLockedAfter).toBe(12_000n);
    expect(quote.deedCountAfter).toBe(11n);
  });

  it('rejects empty pool pricing state', () => {
    expect(() =>
      service.principalTokensForNav(1n, {
        totalNavLockedMojos: 0n,
        deedCount: 0n,
        totalPoolTokenSupply: 0n,
        treasuryReserveTokens: 0n,
      }),
    ).toThrowError(/totalNavLockedMojos/);
  });

  it('pins Pool V2 constants against the Python fixture', () => {
    expect(SHARE_PPM_DENOMINATOR).toBe(BigInt(fixture.constants.share_ppm_denominator));
    expect(FEE_BPS_DENOMINATOR).toBe(BigInt(fixture.constants.fee_bps_denominator));
    expect(DEFAULT_SWAP_FEE_BPS).toBe(BigInt(fixture.constants.default_swap_fee_bps));
    expect(DEFAULT_PROTOCOL_FEE_BPS).toBe(BigInt(fixture.constants.default_protocol_fee_bps));
    expect(DEFAULT_GOVERNANCE_FEE_BPS).toBe(BigInt(fixture.constants.default_governance_fee_bps));
    expect(MAX_POOL_V2_TOKEN_OUTPUTS).toBe(fixture.constants.max_pool_v2_token_outputs);
    expect(PROTOCOL_PREFIX_HEX).toBe(fixture.constants.protocol_prefix);
    expect(TOKEN_MINT).toBe(fixture.constants.token_mint);
    expect(TOKEN_MELT).toBe(fixture.constants.token_melt);
    expect(DEED_SPEND_POOL_DEPOSIT).toBe(fixture.constants.deed_spend_pool_deposit);
    expect(DEED_SPEND_POOL_REDEEM).toBe(fixture.constants.deed_spend_pool_redeem);
    expect(NAV_EVIDENCE_TAG).toBe(fixture.constants.nav_evidence_tag);
    expect(POOL_V2_SPECIFIC_DEED_SWAP_TAG).toBe(fixture.constants.pool_v2_specific_deed_swap_tag);
    expect(POOL_V2_TRUE_REDEMPTION_TAG).toBe(fixture.constants.pool_v2_true_redemption_tag);
    expect(POOL_V2_RESERVE_ACQUISITION_TAG).toBe(fixture.constants.pool_v2_reserve_acquisition_tag);
  });

  it('builds the specific deed swap action spec byte-for-byte with Python', () => {
    const spec = service.buildSpecificDeedSwapSpec({
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      ...DEED_METADATA,
      p2VaultPuzzleHash: fixture.common.p2_vault_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: fixture.specific_deed_swap.inputs['share_ppm'],
      navEvidence: navEvidenceFromFixture(fixture.common.nav_evidence),
      treasuryReservePuzhash: fixture.specific_deed_swap.inputs['treasury_reserve_puzhash'],
      protocolTreasuryPuzhash: fixture.specific_deed_swap.inputs['protocol_treasury_puzhash'],
      governanceRewardsPuzhash: fixture.specific_deed_swap.inputs['governance_rewards_puzhash'],
      governanceRewardsRoot: fixture.specific_deed_swap.inputs['governance_rewards_root'],
    });

    const expected = fixture.specific_deed_swap.expected;
    expect(spec.actionTag).toBe(expected.action_tag);
    expect(spec.navEvidenceMessage).toBe(expected.nav_evidence_message);
    expect(spec.requiredNavEvidenceMessage).toBe(expected.required_nav_evidence_message);
    expect(spec.poolActionMessage).toBe(expected.pool_action_message);
    expect(spec.deedMessage).toBe(expected.deed_message);
    expectState(spec.nextState, expected.next_state);
    expect(spec.quote.principalTokens).toBe(BigInt(expected.quote['principal_tokens']));
    expect(spec.quote.fee.protocolTreasuryTokens).toBe(BigInt(expected.quote['fee_split'].protocol_fee_tokens));
    expect(spec.quote.fee.governanceRewardsTokens).toBe(BigInt(expected.quote['fee_split'].governance_fee_tokens));
    expectOutputs(spec.tokenOutputs, expected.token_outputs);
    expect(spec.tokenAuthorizations).toEqual([]);
    expect(expected.token_settlement_payment_message).toBeDefined();
    expect(service.tokenSettlementPaymentMessage(fixture.common.pool_coin_id, spec.tokenOutputs))
      .toBe(expected.token_settlement_payment_message as string);
  });

  it('builds the true redemption action spec with a melt authorization', () => {
    const spec = service.buildTrueRedemptionSpec({
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      ...DEED_METADATA,
      p2VaultPuzzleHash: fixture.common.p2_vault_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: fixture.true_redemption.inputs['share_ppm'],
      navEvidence: navEvidenceFromFixture(fixture.common.nav_evidence),
      tokenCoinId: fixture.common.token_coin_id,
    });

    const expected = fixture.true_redemption.expected;
    expect(spec.actionTag).toBe(expected.action_tag);
    expect(spec.poolActionMessage).toBe(expected.pool_action_message);
    expect(spec.deedMessage).toBe(expected.deed_message);
    expectState(spec.nextState, expected.next_state);
    expect(spec.tokenOutputs).toEqual([]);
    expectAuthorizations(spec.tokenAuthorizations, expected.token_authorizations);
  });

  it('builds the reserve acquisition action spec with reserve-first payment and mint shortfall', () => {
    const spec = service.buildReserveAcquisitionSpec({
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      ...DEED_METADATA,
      propertyIdCanon: fixture.common.property_id_canon,
      parValueMojos: fixture.reserve_acquisition.inputs['par_value_mojos'],
      assetClass: fixture.reserve_acquisition.inputs['asset_class'],
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: fixture.reserve_acquisition.inputs['share_ppm'],
      navEvidence: navEvidenceFromFixture(fixture.common.acquisition_nav_evidence),
      sellerPuzhash: fixture.reserve_acquisition.inputs['seller_puzhash'],
      sellerTokenPrice: fixture.reserve_acquisition.inputs['seller_token_price'],
      mintTokenCoinId: fixture.common.token_coin_id,
    });

    const expected = fixture.reserve_acquisition.expected;
    expect(spec.actionTag).toBe(expected.action_tag);
    expect(spec.poolActionMessage).toBe(expected.pool_action_message);
    expect(spec.deedMessage).toBe(expected.deed_message);
    expectState(spec.nextState, expected.next_state);
    expectOutputs(spec.tokenOutputs, expected.token_outputs);
    expectAuthorizations(spec.tokenAuthorizations, expected.token_authorizations);
  });

  it('rejects unbounded token settlement fanout', () => {
    const outputs = Array.from({ length: MAX_POOL_V2_TOKEN_OUTPUTS + 1 }, (_, i) => ({
      puzzleHash: '0x' + (0xf0 + i).toString(16).padStart(2, '0').repeat(32),
      amount: 1,
      role: `out-${i}`,
    }));
    expect(() =>
      service.tokenSettlementPaymentMessage(fixture.common.pool_coin_id, outputs),
    ).toThrowError(/outputs cannot exceed/);
  });
});

function stateFromFixture() {
  const state = fixture.common.state;
  return {
    totalNavLockedMojos: state.total_nav_locked_mojos,
    deedCount: state.deed_count,
    totalPoolTokenSupply: state.total_pool_token_supply,
    treasuryReserveTokens: state.treasury_reserve_tokens,
  };
}

function navEvidenceFromFixture(evidence: FixtureEvidence) {
  return {
    registryCoinId: evidence.registry_coin_id,
    registryPuzzleHash: evidence.registry_puzzle_hash,
    collectionIdCanon: evidence.collection_id_canon,
    navValueMojos: evidence.nav_value_mojos,
    collectionNavRoot: evidence.collection_nav_root,
    registryVersion: evidence.registry_version,
  };
}

function expectState(actual: {
  totalNavLockedMojos: bigint;
  deedCount: bigint;
  totalPoolTokenSupply: bigint;
  treasuryReserveTokens: bigint;
}, expected: FixtureState): void {
  expect(actual.totalNavLockedMojos).toBe(BigInt(expected.total_nav_locked_mojos));
  expect(actual.deedCount).toBe(BigInt(expected.deed_count));
  expect(actual.totalPoolTokenSupply).toBe(BigInt(expected.total_pool_token_supply));
  expect(actual.treasuryReserveTokens).toBe(BigInt(expected.treasury_reserve_tokens));
}

function expectOutputs(
  actual: Array<{ puzzleHash: string; amount: bigint; role: string; memos: string[] }>,
  expected: FixtureExpected['token_outputs'],
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].puzzleHash).toBe(expected[i].puzzle_hash);
    expect(actual[i].amount).toBe(BigInt(expected[i].amount));
    expect(actual[i].role).toBe(expected[i].role);
    expect(actual[i].memos).toEqual(expected[i].memos);
  }
}

function expectAuthorizations(
  actual: Array<{ mintOrMelt: number; tokenCoinId: string; amount: bigint; announcementMessage: string }>,
  expected: FixtureExpected['token_authorizations'],
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].mintOrMelt).toBe(expected[i].mint_or_melt);
    expect(actual[i].tokenCoinId).toBe(expected[i].token_coin_id);
    expect(actual[i].amount).toBe(BigInt(expected[i].amount));
    expect(actual[i].announcementMessage).toBe(expected[i].announcement_message);
  }
}
