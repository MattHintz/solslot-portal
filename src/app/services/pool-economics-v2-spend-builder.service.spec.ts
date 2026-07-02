import { TestBed } from '@angular/core/testing';
import { sha256 } from 'ethers';

import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import { ChiaWasmService } from './chia-wasm.service';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import fixturesJson from './pool-economics-v2.fixtures.json';
import {
  type CollectionNavEvidenceInput,
  type PoolEconomicStateInput,
  PoolEconomicsV2Service,
} from './pool-economics-v2.service';
import {
  POOL_SPEND_V2_RESERVE_ACQUISITION,
  POOL_SPEND_V2_SPECIFIC_DEED_SWAP,
  POOL_SPEND_V2_TRUE_REDEMPTION,
  PoolEconomicsV2SpendBuilderService,
} from './pool-economics-v2-spend-builder.service';

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
  pool_action_message: string;
  inner_solution_hex: string;
  pool_full_solution_hex: string;
  pool_coin_spend: FixtureCoinSpend;
}

interface FixtureSection {
  inputs: Record<string, string | number>;
  expected: FixtureExpected;
}

interface FixtureFile {
  constants: {
    pool_spend_v2_specific_deed_swap: number;
    pool_spend_v2_true_redemption: number;
    pool_spend_v2_reserve_acquisition: number;
  };
  common: {
    state: FixtureState;
    pool_launcher_id: string;
    pool_coin_id: string;
    pool_coin: FixtureCoin;
    pool_lineage_proof: FixtureLineageProof;
    pool_inner_puzzle_hex: string;
    pool_inner_puzzle_hash: string;
    pool_full_puzzle_hash: string;
    pool_amount: number;
    deed_id: string;
    p2_vault_puzzle_hash: string;
    buyer_vault_launcher_id: string;
    launcher_puzzle_hash: string;
    property_id_canon: string;
    collection_id_canon: string;
    token_coin_id: string;
    nav_evidence: FixtureEvidence;
    acquisition_nav_evidence: FixtureEvidence;
  };
  specific_deed_swap: FixtureSection;
  true_redemption: FixtureSection;
  reserve_acquisition: FixtureSection;
}

interface FixtureCoin {
  parent_coin_info: string;
  puzzle_hash: string;
  amount: number;
  coin_id: string;
}

interface FixtureLineageProof {
  parent_name: string;
  inner_puzzle_hash: string;
  amount: number;
}

interface FixtureCoinSpend {
  coin: FixtureCoin;
  puzzle_reveal: string;
  solution: string;
}

const fixture = fixturesJson as FixtureFile;

describe('PoolEconomicsV2SpendBuilderService', () => {
  let service: PoolEconomicsV2SpendBuilderService;
  let economics: PoolEconomicsV2Service;
  let wasm: ChiaWasmService;

  beforeAll(async () => {
    if ((window as unknown as { ChiaSDK?: unknown }).ChiaSDK) {
      return;
    }
    const wasmExports = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
    const response = await fetch('/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm');
    if (!response.ok) {
      throw new Error(`WASM asset fetch failed: ${response.status} ${response.statusText}`);
    }
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, {
      './chia_wallet_sdk_wasm_bg.js': wasmExports as unknown as WebAssembly.ModuleImports,
    });
    const setWasm = (wasmExports as unknown as { __wbg_set_wasm?: (w: WebAssembly.Exports) => void })
      .__wbg_set_wasm;
    if (typeof setWasm !== 'function') {
      throw new Error('chia_wallet_sdk_wasm_bg.js missing __wbg_set_wasm');
    }
    setWasm(result.instance.exports);
    (window as unknown as { ChiaSDK: unknown }).ChiaSDK = wasmExports;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    wasm = TestBed.inject(ChiaWasmService);
    wasm.probeReady();
    economics = TestBed.inject(PoolEconomicsV2Service);
    service = TestBed.inject(PoolEconomicsV2SpendBuilderService);
  });

  it('pins Pool V2 spend case constants against the Python fixture', () => {
    expect(POOL_SPEND_V2_SPECIFIC_DEED_SWAP).toBe(
      fixture.constants.pool_spend_v2_specific_deed_swap,
    );
    expect(POOL_SPEND_V2_TRUE_REDEMPTION).toBe(
      fixture.constants.pool_spend_v2_true_redemption,
    );
    expect(POOL_SPEND_V2_RESERVE_ACQUISITION).toBe(
      fixture.constants.pool_spend_v2_reserve_acquisition,
    );
  });

  it('derives the p2-vault puzzle hash used by deed exits', () => {
    expect(
      service.p2VaultPuzzleHash(
        fixture.common.buyer_vault_launcher_id,
        fixture.common.launcher_puzzle_hash,
      ),
    ).toBe(fixture.common.p2_vault_puzzle_hash);
  });

  it('serializes the specific deed swap inner solution byte-for-byte with Python', () => {
    const build = service.buildSpecificDeedSwapInnerSolution({
      ...contextFromFixture(),
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      buyerVaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.specific_deed_swap, 'share_ppm'),
      navEvidence: navEvidenceFromFixture(fixture.common.nav_evidence),
      treasuryReservePuzhash: inputString(fixture.specific_deed_swap, 'treasury_reserve_puzhash'),
      protocolTreasuryPuzhash: inputString(fixture.specific_deed_swap, 'protocol_treasury_puzhash'),
      governanceRewardsPuzhash: inputString(fixture.specific_deed_swap, 'governance_rewards_puzhash'),
      governanceRewardsRoot: inputString(fixture.specific_deed_swap, 'governance_rewards_root'),
    });

    const expected = fixture.specific_deed_swap.expected;
    expect(build.spendCase).toBe(POOL_SPEND_V2_SPECIFIC_DEED_SWAP);
    expect(build.p2VaultPuzzleHash).toBe(fixture.common.p2_vault_puzzle_hash);
    expect(build.spec.actionTag).toBe(expected.action_tag);
    expect(build.spec.poolActionMessage).toBe(expected.pool_action_message);
    expect(build.innerSolutionHex).toBe(expected.inner_solution_hex);
  });

  it('builds the specific deed swap pool singleton CoinSpend byte-for-byte with Python', () => {
    const build = service.buildSpecificDeedSwapCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      buyerVaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.specific_deed_swap, 'share_ppm'),
      navEvidence: navEvidenceFromFixture(fixture.common.nav_evidence),
      treasuryReservePuzhash: inputString(fixture.specific_deed_swap, 'treasury_reserve_puzhash'),
      protocolTreasuryPuzhash: inputString(fixture.specific_deed_swap, 'protocol_treasury_puzhash'),
      governanceRewardsPuzhash: inputString(fixture.specific_deed_swap, 'governance_rewards_puzhash'),
      governanceRewardsRoot: inputString(fixture.specific_deed_swap, 'governance_rewards_root'),
    });

    const expected = fixture.specific_deed_swap.expected;
    expect(build.poolCoinId).toBe(fixture.common.pool_coin_id);
    expect(build.poolInnerPuzzleHash).toBe(fixture.common.pool_inner_puzzle_hash);
    expect(build.poolFullPuzzleHash).toBe(fixture.common.pool_full_puzzle_hash);
    expect(build.poolFullSolutionHex).toBe(expected.pool_full_solution_hex);
    expectCoinSpend(build.coinSpend, expected.pool_coin_spend);
    expect(build.unsignedSpendBundle.aggregatedSignature).toBeNull();
    expect(build.unsignedSpendBundle.coinSpends).toEqual([build.coinSpend]);
  });

  it('serializes the true redemption inner solution byte-for-byte with Python', () => {
    const build = service.buildTrueRedemptionInnerSolution({
      ...contextFromFixture(),
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      vaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence: navEvidenceFromFixture(fixture.common.nav_evidence),
      tokenCoinId: fixture.common.token_coin_id,
    });

    const expected = fixture.true_redemption.expected;
    expect(build.spendCase).toBe(POOL_SPEND_V2_TRUE_REDEMPTION);
    expect(build.p2VaultPuzzleHash).toBe(fixture.common.p2_vault_puzzle_hash);
    expect(build.spec.actionTag).toBe(expected.action_tag);
    expect(build.spec.poolActionMessage).toBe(expected.pool_action_message);
    expect(build.innerSolutionHex).toBe(expected.inner_solution_hex);
  });

  it('builds the true redemption pool singleton CoinSpend byte-for-byte with Python', () => {
    const build = service.buildTrueRedemptionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      vaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence: navEvidenceFromFixture(fixture.common.nav_evidence),
      tokenCoinId: fixture.common.token_coin_id,
    });

    const expected = fixture.true_redemption.expected;
    expect(build.poolCoinId).toBe(fixture.common.pool_coin_id);
    expect(build.poolFullSolutionHex).toBe(expected.pool_full_solution_hex);
    expectCoinSpend(build.coinSpend, expected.pool_coin_spend);
  });

  it('serializes the reserve acquisition inner solution byte-for-byte with Python', () => {
    const build = service.buildReserveAcquisitionInnerSolution({
      ...contextFromFixture(),
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      propertyIdCanon: fixture.common.property_id_canon,
      parValueMojos: inputNumber(fixture.reserve_acquisition, 'par_value_mojos'),
      assetClass: inputNumber(fixture.reserve_acquisition, 'asset_class'),
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.reserve_acquisition, 'share_ppm'),
      navEvidence: navEvidenceFromFixture(fixture.common.acquisition_nav_evidence),
      sellerPuzhash: inputString(fixture.reserve_acquisition, 'seller_puzhash'),
      sellerTokenPrice: inputNumber(fixture.reserve_acquisition, 'seller_token_price'),
      mintTokenCoinId: fixture.common.token_coin_id,
    });

    const expected = fixture.reserve_acquisition.expected;
    expect(build.spendCase).toBe(POOL_SPEND_V2_RESERVE_ACQUISITION);
    expect(build.spec.actionTag).toBe(expected.action_tag);
    expect(build.spec.poolActionMessage).toBe(expected.pool_action_message);
    expect(build.innerSolutionHex).toBe(expected.inner_solution_hex);
  });

  it('builds the reserve acquisition pool singleton CoinSpend byte-for-byte with Python', () => {
    const build = service.buildReserveAcquisitionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      propertyIdCanon: fixture.common.property_id_canon,
      parValueMojos: inputNumber(fixture.reserve_acquisition, 'par_value_mojos'),
      assetClass: inputNumber(fixture.reserve_acquisition, 'asset_class'),
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.reserve_acquisition, 'share_ppm'),
      navEvidence: navEvidenceFromFixture(fixture.common.acquisition_nav_evidence),
      sellerPuzhash: inputString(fixture.reserve_acquisition, 'seller_puzhash'),
      sellerTokenPrice: inputNumber(fixture.reserve_acquisition, 'seller_token_price'),
      mintTokenCoinId: fixture.common.token_coin_id,
    });

    const expected = fixture.reserve_acquisition.expected;
    expect(build.poolCoinId).toBe(fixture.common.pool_coin_id);
    expect(build.poolFullSolutionHex).toBe(expected.pool_full_solution_hex);
    expectCoinSpend(build.coinSpend, expected.pool_coin_spend);
  });

  it('rejects stale pool coin puzzle hashes before emitting a CoinSpend', () => {
    expect(() =>
      service.buildPoolSingletonCoinSpend({
        ...spendContextFromFixture({
          poolCoin: {
            ...poolCoinFromFixture(fixture.common.pool_coin),
            puzzleHash: '0x' + '00'.repeat(32),
          },
        }),
        innerSolutionHex: fixture.specific_deed_swap.expected.inner_solution_hex,
      }),
    ).toThrowError(/does not match coin puzzle hash/);
  });

  it('composes a specific deed swap unsigned bundle with NAV, deed, and CAT settlement witnesses', () => {
    const seeds = witnessSeeds(wasm);
    const navEvidence = navEvidenceFromFixture(fixture.common.nav_evidence);
    navEvidence.registryPuzzleHash = seeds.nav.puzzleHash;
    const poolBuild = service.buildSpecificDeedSwapCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      buyerVaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.specific_deed_swap, 'share_ppm'),
      navEvidence,
      treasuryReservePuzhash: inputString(fixture.specific_deed_swap, 'treasury_reserve_puzhash'),
      protocolTreasuryPuzhash: inputString(fixture.specific_deed_swap, 'protocol_treasury_puzhash'),
      governanceRewardsPuzhash: inputString(fixture.specific_deed_swap, 'governance_rewards_puzhash'),
      governanceRewardsRoot: inputString(fixture.specific_deed_swap, 'governance_rewards_root'),
    });
    const tokenSettlementMessage = economics.tokenSettlementPaymentMessage(
      poolBuild.poolCoinId,
      poolBuild.spec.tokenOutputs,
    );

    const result = service.composePoolV2UnsignedBundle({
      poolSpend: poolBuild,
      deedId: seeds.deed.coinId,
      navEvidence,
      witnesses: {
        navEvidenceSpend: witnessSpend(wasm, seeds.nav, [
          createPuzzleAnnouncement(wasm, poolBuild.spec.requiredNavEvidenceMessage),
        ]),
        deedSpend: witnessSpend(wasm, seeds.deed, [
          createCoinAnnouncement(wasm, poolBuild.spec.deedMessage),
        ]),
        tokenSettlementPuzzleHash: seeds.tokenSettlement.puzzleHash,
        tokenSettlementSpend: witnessSpend(wasm, seeds.tokenSettlement, [
          createPuzzleAnnouncement(wasm, tokenSettlementMessage),
        ]),
      },
    });

    expect(result.unsignedSpendBundle.aggregatedSignature).toBeNull();
    expect(result.coinSpends.length).toBe(4);
    expect(result.coinSpends[0]).toBe(poolBuild.coinSpend);
    expect(result.requiredAnnouncements.map((a) => a.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_settlement',
    ]);
    expect(result.witnessSummary.map((w) => w.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_settlement',
    ]);
  });

  it('describes Pool V2 token witness requirements without supplied witness spends', () => {
    const seeds = witnessSeeds(wasm);
    const navEvidence = navEvidenceFromFixture(fixture.common.nav_evidence);
    navEvidence.registryPuzzleHash = seeds.nav.puzzleHash;
    const poolBuild = service.buildSpecificDeedSwapCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      buyerVaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.specific_deed_swap, 'share_ppm'),
      navEvidence,
      treasuryReservePuzhash: inputString(fixture.specific_deed_swap, 'treasury_reserve_puzhash'),
      protocolTreasuryPuzhash: inputString(fixture.specific_deed_swap, 'protocol_treasury_puzhash'),
      governanceRewardsPuzhash: inputString(fixture.specific_deed_swap, 'governance_rewards_puzhash'),
      governanceRewardsRoot: inputString(fixture.specific_deed_swap, 'governance_rewards_root'),
    });

    const requirements = service.describePoolV2RequiredAnnouncements({
      poolSpend: poolBuild,
      deedId: seeds.deed.coinId,
      navEvidence,
      tokenSettlementPuzzleHash: seeds.tokenSettlement.puzzleHash,
    });

    expect(requirements.map((r) => r.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_settlement',
    ]);
    expect(requirements[2]).toEqual(
      jasmine.objectContaining({
        kind: 'puzzle_create',
        sourceId: seeds.tokenSettlement.puzzleHash,
        message: economics.tokenSettlementPaymentMessage(
          poolBuild.poolCoinId,
          poolBuild.spec.tokenOutputs,
        ),
      }),
    );
  });

  it('rejects specific deed swaps that omit the bounded CAT settlement witness', () => {
    const seeds = witnessSeeds(wasm);
    const navEvidence = navEvidenceFromFixture(fixture.common.nav_evidence);
    navEvidence.registryPuzzleHash = seeds.nav.puzzleHash;
    const poolBuild = service.buildSpecificDeedSwapCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      buyerVaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.specific_deed_swap, 'share_ppm'),
      navEvidence,
      treasuryReservePuzhash: inputString(fixture.specific_deed_swap, 'treasury_reserve_puzhash'),
      protocolTreasuryPuzhash: inputString(fixture.specific_deed_swap, 'protocol_treasury_puzhash'),
      governanceRewardsPuzhash: inputString(fixture.specific_deed_swap, 'governance_rewards_puzhash'),
      governanceRewardsRoot: inputString(fixture.specific_deed_swap, 'governance_rewards_root'),
    });

    expect(() =>
      service.composePoolV2UnsignedBundle({
        poolSpend: poolBuild,
        deedId: seeds.deed.coinId,
        navEvidence,
        witnesses: {
          navEvidenceSpend: witnessSpend(wasm, seeds.nav, [
            createPuzzleAnnouncement(wasm, poolBuild.spec.requiredNavEvidenceMessage),
          ]),
          deedSpend: witnessSpend(wasm, seeds.deed, [
            createCoinAnnouncement(wasm, poolBuild.spec.deedMessage),
          ]),
          tokenSettlementPuzzleHash: seeds.tokenSettlement.puzzleHash,
        },
      }),
    ).toThrowError(/tokenSettlementSpend is required/);
  });

  it('composes a true redemption unsigned bundle with a pool-token melt witness', () => {
    const seeds = witnessSeeds(wasm);
    const navEvidence = navEvidenceFromFixture(fixture.common.nav_evidence);
    navEvidence.registryPuzzleHash = seeds.nav.puzzleHash;
    const poolBuild = service.buildTrueRedemptionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      vaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence,
      tokenCoinId: seeds.tokenAuthorization.coinId,
    });
    const auth = poolBuild.spec.tokenAuthorizations[0];

    const result = service.composePoolV2UnsignedBundle({
      poolSpend: poolBuild,
      deedId: seeds.deed.coinId,
      navEvidence,
      witnesses: {
        navEvidenceSpend: witnessSpend(wasm, seeds.nav, [
          createPuzzleAnnouncement(wasm, poolBuild.spec.requiredNavEvidenceMessage),
        ]),
        deedSpend: witnessSpend(wasm, seeds.deed, [
          createCoinAnnouncement(wasm, poolBuild.spec.deedMessage),
        ]),
        tokenAuthorizationSpends: [
          witnessSpend(wasm, seeds.tokenAuthorization, [
            assertPuzzleAnnouncement(wasm, announcementId(poolBuild.poolFullPuzzleHash, auth.announcementMessage)),
          ]),
        ],
      },
    });

    expect(result.coinSpends.length).toBe(4);
    expect(result.requiredAnnouncements.map((a) => a.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_authorization',
    ]);
    expect(result.requiredAnnouncements[2].announcementId).toBe(
      announcementId(poolBuild.poolFullPuzzleHash, auth.announcementMessage),
    );
  });

  it('composes a reserve acquisition bundle with reserve payment and fresh-mint witnesses', () => {
    const seeds = witnessSeeds(wasm);
    const navEvidence = navEvidenceFromFixture(fixture.common.acquisition_nav_evidence);
    navEvidence.registryPuzzleHash = seeds.nav.puzzleHash;
    const poolBuild = service.buildReserveAcquisitionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      propertyIdCanon: fixture.common.property_id_canon,
      parValueMojos: inputNumber(fixture.reserve_acquisition, 'par_value_mojos'),
      assetClass: inputNumber(fixture.reserve_acquisition, 'asset_class'),
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.reserve_acquisition, 'share_ppm'),
      navEvidence,
      sellerPuzhash: inputString(fixture.reserve_acquisition, 'seller_puzhash'),
      sellerTokenPrice: inputNumber(fixture.reserve_acquisition, 'seller_token_price'),
      mintTokenCoinId: seeds.tokenAuthorization.coinId,
    });
    const tokenSettlementMessage = economics.tokenSettlementPaymentMessage(
      poolBuild.poolCoinId,
      poolBuild.spec.tokenOutputs,
    );
    const auth = poolBuild.spec.tokenAuthorizations[0];

    const result = service.composePoolV2UnsignedBundle({
      poolSpend: poolBuild,
      deedId: seeds.deed.coinId,
      navEvidence,
      witnesses: {
        navEvidenceSpend: witnessSpend(wasm, seeds.nav, [
          createPuzzleAnnouncement(wasm, poolBuild.spec.requiredNavEvidenceMessage),
        ]),
        deedSpend: witnessSpend(wasm, seeds.deed, [
          createCoinAnnouncement(wasm, poolBuild.spec.deedMessage),
        ]),
        tokenSettlementPuzzleHash: seeds.tokenSettlement.puzzleHash,
        tokenSettlementSpend: witnessSpend(wasm, seeds.tokenSettlement, [
          createPuzzleAnnouncement(wasm, tokenSettlementMessage),
        ]),
        tokenAuthorizationSpends: [
          witnessSpend(wasm, seeds.tokenAuthorization, [
            assertPuzzleAnnouncement(wasm, announcementId(poolBuild.poolFullPuzzleHash, auth.announcementMessage)),
          ]),
        ],
      },
    });

    expect(result.coinSpends.length).toBe(5);
    expect(result.requiredAnnouncements.map((a) => a.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_settlement',
      'token_authorization',
    ]);
  });

  it('rejects witnesses that replay but emit the wrong announcement', () => {
    const seeds = witnessSeeds(wasm);
    const navEvidence = navEvidenceFromFixture(fixture.common.nav_evidence);
    navEvidence.registryPuzzleHash = seeds.nav.puzzleHash;
    const poolBuild = service.buildTrueRedemptionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      vaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence,
      tokenCoinId: seeds.tokenAuthorization.coinId,
    });
    const auth = poolBuild.spec.tokenAuthorizations[0];

    expect(() =>
      service.composePoolV2UnsignedBundle({
        poolSpend: poolBuild,
        deedId: seeds.deed.coinId,
        navEvidence,
        witnesses: {
          navEvidenceSpend: witnessSpend(wasm, seeds.nav, [
            createPuzzleAnnouncement(wasm, '0x' + '00'.repeat(33)),
          ]),
          deedSpend: witnessSpend(wasm, seeds.deed, [
            createCoinAnnouncement(wasm, poolBuild.spec.deedMessage),
          ]),
          tokenAuthorizationSpends: [
            witnessSpend(wasm, seeds.tokenAuthorization, [
              assertPuzzleAnnouncement(wasm, announcementId(poolBuild.poolFullPuzzleHash, auth.announcementMessage)),
            ]),
          ],
        },
      }),
    ).toThrowError(/missing nav_evidence witness/);
  });

  it('rejects reserve acquisitions with fresh-mint shortfall but no mint token coin', () => {
    expect(() =>
      service.buildReserveAcquisitionInnerSolution({
        ...contextFromFixture(),
        state: stateFromFixture(),
        deedId: fixture.common.deed_id,
        propertyIdCanon: fixture.common.property_id_canon,
        parValueMojos: inputNumber(fixture.reserve_acquisition, 'par_value_mojos'),
        assetClass: inputNumber(fixture.reserve_acquisition, 'asset_class'),
        collectionIdCanon: fixture.common.collection_id_canon,
        sharePpm: inputNumber(fixture.reserve_acquisition, 'share_ppm'),
        navEvidence: navEvidenceFromFixture(fixture.common.acquisition_nav_evidence),
        sellerPuzhash: inputString(fixture.reserve_acquisition, 'seller_puzhash'),
        sellerTokenPrice: inputNumber(fixture.reserve_acquisition, 'seller_token_price'),
      }),
    ).toThrowError(/mintTokenCoinId is required/);
  });
});

function contextFromFixture() {
  return {
    poolCoinId: fixture.common.pool_coin_id,
    poolInnerPuzzleHash: fixture.common.pool_inner_puzzle_hash,
    poolAmount: fixture.common.pool_amount,
  };
}

function spendContextFromFixture(overrides: Partial<ReturnType<typeof spendContextBase>> = {}) {
  return { ...spendContextBase(), ...overrides };
}

function spendContextBase() {
  return {
    poolLauncherId: fixture.common.pool_launcher_id,
    poolCoin: poolCoinFromFixture(fixture.common.pool_coin),
    poolInnerPuzzleHex: fixture.common.pool_inner_puzzle_hex,
    lineageProof: {
      parentName: fixture.common.pool_lineage_proof.parent_name,
      innerPuzzleHash: fixture.common.pool_lineage_proof.inner_puzzle_hash,
      amount: fixture.common.pool_lineage_proof.amount,
    },
  };
}

function poolCoinFromFixture(coin: FixtureCoin) {
  return {
    parentCoinInfo: coin.parent_coin_info,
    puzzleHash: coin.puzzle_hash,
    amount: coin.amount,
    coinId: coin.coin_id,
  };
}

function stateFromFixture(): PoolEconomicStateInput {
  const state = fixture.common.state;
  return {
    totalNavLockedMojos: state.total_nav_locked_mojos,
    deedCount: state.deed_count,
    totalPoolTokenSupply: state.total_pool_token_supply,
    treasuryReserveTokens: state.treasury_reserve_tokens,
  };
}

function navEvidenceFromFixture(evidence: FixtureEvidence): CollectionNavEvidenceInput {
  return {
    registryCoinId: evidence.registry_coin_id,
    registryPuzzleHash: evidence.registry_puzzle_hash,
    collectionIdCanon: evidence.collection_id_canon,
    navValueMojos: evidence.nav_value_mojos,
    collectionNavRoot: evidence.collection_nav_root,
    registryVersion: evidence.registry_version,
  };
}

function inputString(section: FixtureSection, key: string): string {
  const value = section.inputs[key];
  if (typeof value !== 'string') {
    throw new Error(`fixture input ${key} must be a string`);
  }
  return value;
}

function inputNumber(section: FixtureSection, key: string): number {
  const value = section.inputs[key];
  if (typeof value !== 'number') {
    throw new Error(`fixture input ${key} must be a number`);
  }
  return value;
}

function expectCoinSpend(
  actual: {
    coin: { parentCoinInfo: string; puzzleHash: string; amount: number | bigint };
    puzzleReveal: string;
    solution: string;
  },
  expected: FixtureCoinSpend,
): void {
  expect(actual.coin.parentCoinInfo).toBe(expected.coin.parent_coin_info);
  expect(actual.coin.puzzleHash).toBe(expected.coin.puzzle_hash);
  expect(actual.coin.amount).toBe(BigInt(expected.coin.amount));
  expect(actual.puzzleReveal).toBe(expected.puzzle_reveal);
  expect(actual.solution).toBe(expected.solution);
}

interface WitnessSeed {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: bigint;
  coinId: string;
}

function witnessSeeds(wasm: ChiaWasmService): {
  nav: WitnessSeed;
  deed: WitnessSeed;
  tokenSettlement: WitnessSeed;
  tokenAuthorization: WitnessSeed;
} {
  return {
    nav: witnessSeed(wasm, 0xa1),
    deed: witnessSeed(wasm, 0xd1),
    tokenSettlement: witnessSeed(wasm, 0xf1),
    tokenAuthorization: witnessSeed(wasm, 0xe1),
  };
}

function witnessSeed(wasm: ChiaWasmService, byte: number): WitnessSeed {
  const sdk = wasm.sdk() as WitnessSdkShape;
  const clvm = new sdk.Clvm();
  const puzzle = clvm.int(1n);
  const parent = new Uint8Array(32).fill(byte);
  const puzzleHash = puzzle.treeHash();
  const amount = 1n;
  const coin = new sdk.Coin(parent, puzzleHash, amount);
  return {
    parentCoinInfo: bytesToHex(parent),
    puzzleHash: bytesToHex(puzzleHash),
    amount,
    coinId: bytesToHex(coin.coinId()),
  };
}

function witnessSpend(
  wasm: ChiaWasmService,
  seed: WitnessSeed,
  conditions: WitnessCondition[],
): UnsignedCoinSpend {
  const sdk = wasm.sdk() as WitnessSdkShape;
  const clvm = new sdk.Clvm();
  const puzzle = clvm.int(1n);
  const conditionPrograms = conditions.map((condition) =>
    clvm.list([
      clvm.int(BigInt(condition.opcode)),
      clvm.atom(hexToBytes(condition.message)),
    ]),
  );
  return {
    coin: {
      parentCoinInfo: seed.parentCoinInfo,
      puzzleHash: seed.puzzleHash,
      amount: seed.amount,
    },
    puzzleReveal: bytesToHex(puzzle.serialize()),
    solution: bytesToHex(clvm.list(conditionPrograms).serialize()),
  };
}

function createPuzzleAnnouncement(_wasm: ChiaWasmService, message: string): WitnessCondition {
  return condition(62, message);
}

function createCoinAnnouncement(_wasm: ChiaWasmService, message: string): WitnessCondition {
  return condition(60, message);
}

function assertPuzzleAnnouncement(_wasm: ChiaWasmService, announcementId: string): WitnessCondition {
  return condition(63, announcementId);
}

function condition(opcode: number, message: string): WitnessCondition {
  return { opcode, message };
}

function announcementId(sourceId: string, message: string): string {
  return sha256(concatBytes([hexToBytes(sourceId), hexToBytes(message)]));
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

interface WitnessProgram {
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
}

interface WitnessCondition {
  opcode: number;
  message: string;
}

interface WitnessSdkShape {
  Clvm: new () => {
    int(value: bigint): WitnessProgram;
    atom(value: Uint8Array): WitnessProgram;
    list(values: WitnessProgram[]): WitnessProgram;
  };
  Coin: new (
    parentCoinInfo: Uint8Array,
    puzzleHash: Uint8Array,
    amount: bigint,
  ) => { coinId(): Uint8Array };
}
