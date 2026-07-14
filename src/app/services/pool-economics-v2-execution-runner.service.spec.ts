import { TestBed } from '@angular/core/testing';
import { sha256 } from 'ethers';

import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import { ChiaWasmService } from './chia-wasm.service';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import { CoinsetService } from './coinset.service';
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
} from './pool-economics-v2-spend-builder.service';
import {
  POOL_V2_EMPTY_AGGREGATE_SIGNATURE,
  PoolEconomicsV2ExecutionRunnerService,
} from './pool-economics-v2-execution-runner.service';

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

interface FixtureSection {
  inputs: Record<string, string | number>;
}

interface FixtureCoin {
  parent_coin_info: string;
  puzzle_hash: string;
  amount: number;
  coin_id: string;
}

interface FixtureCoinSpend {
  coin: FixtureCoin;
  puzzle_reveal: string;
  solution: string;
}

interface FixtureFile {
  common: {
    state: FixtureState;
    pool_launcher_id: string;
    pool_coin_id: string;
    pool_coin: FixtureCoin;
    pool_lineage_proof: {
      parent_name: string;
      inner_puzzle_hash: string;
      amount: number;
    };
    pool_inner_puzzle_hex: string;
    deed_launcher_id: string;
    buyer_vault_launcher_id: string;
    launcher_puzzle_hash: string;
    p2_vault_puzzle_hash: string;
    property_id_canon: string;
    collection_id_canon: string;
    nav_evidence: FixtureEvidence;
    nav_evidence_coin_spend: FixtureCoinSpend;
    acquisition_nav_evidence: FixtureEvidence;
    acquisition_nav_evidence_coin_spend: FixtureCoinSpend;
  };
  specific_deed_swap: FixtureSection;
  true_redemption: FixtureSection;
  reserve_acquisition: FixtureSection;
}

const fixture = fixturesJson as FixtureFile;
const DEED_METADATA = {
  deedLauncherId: fixture.common.deed_launcher_id,
  parValueMojos: fixture.reserve_acquisition.inputs['par_value_mojos'],
  assetClass: fixture.reserve_acquisition.inputs['asset_class'],
  propertyIdCanon: fixture.common.property_id_canon,
};

describe('PoolEconomicsV2ExecutionRunnerService', () => {
  let service: PoolEconomicsV2ExecutionRunnerService;
  let economics: PoolEconomicsV2Service;
  let wasm: ChiaWasmService;
  let coinset: jasmine.SpyObj<Pick<CoinsetService, 'pushTransaction'>>;

  beforeAll(async () => {
    await initialiseChiaSdk();
  });

  beforeEach(() => {
    coinset = jasmine.createSpyObj('CoinsetService', ['pushTransaction']);
    coinset.pushTransaction.and.resolveTo({ success: true, status: 'SUCCESS' });
    TestBed.configureTestingModule({
      providers: [{ provide: CoinsetService, useValue: coinset }],
    });
    wasm = TestBed.inject(ChiaWasmService);
    wasm.probeReady();
    economics = TestBed.inject(PoolEconomicsV2Service);
    service = TestBed.inject(PoolEconomicsV2ExecutionRunnerService);
  });

  it('composes a specific deed swap execution bundle without broadcasting', () => {
    const seeds = witnessSeeds(wasm);
    const navEvidence = navEvidenceFromFixture(fixture.common.nav_evidence, seeds.nav);
    const spec = economics.buildSpecificDeedSwapSpec({
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      ...DEED_METADATA,
      p2VaultPuzzleHash: fixture.common.p2_vault_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.specific_deed_swap, 'share_ppm'),
      navEvidence,
      treasuryReservePuzhash: inputString(fixture.specific_deed_swap, 'treasury_reserve_puzhash'),
      protocolTreasuryPuzhash: inputString(fixture.specific_deed_swap, 'protocol_treasury_puzhash'),
      governanceRewardsPuzhash: inputString(fixture.specific_deed_swap, 'governance_rewards_puzhash'),
      governanceRewardsRoot: inputString(fixture.specific_deed_swap, 'governance_rewards_root'),
    });
    const result = service.composeSpecificDeedSwap({
      pool: spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      ...DEED_METADATA,
      buyerVaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.specific_deed_swap, 'share_ppm'),
      navEvidence,
      treasuryReservePuzhash: inputString(fixture.specific_deed_swap, 'treasury_reserve_puzhash'),
      protocolTreasuryPuzhash: inputString(fixture.specific_deed_swap, 'protocol_treasury_puzhash'),
      governanceRewardsPuzhash: inputString(fixture.specific_deed_swap, 'governance_rewards_puzhash'),
      governanceRewardsRoot: inputString(fixture.specific_deed_swap, 'governance_rewards_root'),
      witnesses: {
        navEvidenceSpend: coinSpendFromFixture(fixture.common.nav_evidence_coin_spend),
        deedSpend: witnessSpend(wasm, seeds.deed, [condition(60, spec.deedMessage)]),
        tokenSettlementPuzzleHash: seeds.tokenSettlement.puzzleHash,
        tokenSettlementSpend: witnessSpend(wasm, seeds.tokenSettlement, [
          condition(
            62,
            economics.tokenSettlementPaymentMessage(fixture.common.pool_coin_id, spec.tokenOutputs),
          ),
        ]),
      },
    });

    expect(result.kind).toBe('specific-deed-swap');
    expect(result.spendCase).toBe(POOL_SPEND_V2_SPECIFIC_DEED_SWAP);
    expect(result.unsignedSpendBundle.aggregatedSignature).toBeNull();
    expect(result.signaturelessSpendBundle.aggregatedSignature).toBe(
      POOL_V2_EMPTY_AGGREGATE_SIGNATURE,
    );
    expect(result.signaturelessSpendBundle.coinSpends.length).toBe(4);
    expect(result.requiredAnnouncements.map((a) => a.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_settlement',
    ]);
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('submits a composed signatureless bundle through coinset only on explicit submit', async () => {
    const result = service.composeTrueRedemption(trueRedemptionArgs(witnessSeeds(wasm)));

    await expectAsync(service.submitSignaturelessBundle(result)).toBeResolvedTo({
      success: true,
      status: 'SUCCESS',
    });

    expect(coinset.pushTransaction).toHaveBeenCalledOnceWith(result.signaturelessSpendBundle);
  });

  it('rejects true redemption execution intake without the token melt authorization witness', () => {
    const seeds = witnessSeeds(wasm);
    const args = trueRedemptionArgs(seeds);

    expect(() =>
      service.composeTrueRedemption({
        ...args,
        witnesses: {
          navEvidenceSpend: args.witnesses.navEvidenceSpend,
          deedSpend: args.witnesses.deedSpend,
        },
      }),
    ).toThrowError(/expected 1 token authorization spend/);
  });

  it('composes reserve acquisition at the Pool V2 witness ceiling', () => {
    const result = service.composeReserveAcquisition(reserveAcquisitionArgs(witnessSeeds(wasm)));

    expect(result.spendCase).toBe(POOL_SPEND_V2_RESERVE_ACQUISITION);
    expect(result.coinSpends.length).toBe(5);
    expect(result.witnessSummary.map((w) => w.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_settlement',
      'token_authorization',
    ]);
  });

  function trueRedemptionArgs(seeds: ReturnType<typeof witnessSeeds>) {
    const navEvidence = navEvidenceFromFixture(fixture.common.nav_evidence, seeds.nav);
    const spec = economics.buildTrueRedemptionSpec({
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      ...DEED_METADATA,
      p2VaultPuzzleHash: fixture.common.p2_vault_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence,
      tokenCoinId: seeds.tokenAuthorization.coinId,
    });
    const auth = spec.tokenAuthorizations[0];
    return {
      pool: spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      ...DEED_METADATA,
      vaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence,
      tokenCoinId: seeds.tokenAuthorization.coinId,
      witnesses: {
        navEvidenceSpend: coinSpendFromFixture(fixture.common.nav_evidence_coin_spend),
        deedSpend: witnessSpend(wasm, seeds.deed, [condition(60, spec.deedMessage)]),
        tokenAuthorizationSpends: [
          witnessSpend(wasm, seeds.tokenAuthorization, [
            condition(63, announcementId(fixture.common.pool_coin.puzzle_hash, auth.announcementMessage)),
          ]),
        ],
      },
    };
  }

  function reserveAcquisitionArgs(seeds: ReturnType<typeof witnessSeeds>) {
    const navEvidence = navEvidenceFromFixture(fixture.common.acquisition_nav_evidence, seeds.nav);
    const spec = economics.buildReserveAcquisitionSpec({
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      ...DEED_METADATA,
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
    const auth = spec.tokenAuthorizations[0];
    return {
      pool: spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: seeds.deed.coinId,
      ...DEED_METADATA,
      propertyIdCanon: fixture.common.property_id_canon,
      parValueMojos: inputNumber(fixture.reserve_acquisition, 'par_value_mojos'),
      assetClass: inputNumber(fixture.reserve_acquisition, 'asset_class'),
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.reserve_acquisition, 'share_ppm'),
      navEvidence,
      sellerPuzhash: inputString(fixture.reserve_acquisition, 'seller_puzhash'),
      sellerTokenPrice: inputNumber(fixture.reserve_acquisition, 'seller_token_price'),
      mintTokenCoinId: seeds.tokenAuthorization.coinId,
      witnesses: {
        navEvidenceSpend: coinSpendFromFixture(
          fixture.common.acquisition_nav_evidence_coin_spend,
        ),
        deedSpend: witnessSpend(wasm, seeds.deed, [condition(60, spec.deedMessage)]),
        tokenSettlementPuzzleHash: seeds.tokenSettlement.puzzleHash,
        tokenSettlementSpend: witnessSpend(wasm, seeds.tokenSettlement, [
          condition(
            62,
            economics.tokenSettlementPaymentMessage(fixture.common.pool_coin_id, spec.tokenOutputs),
          ),
        ]),
        tokenAuthorizationSpends: [
          witnessSpend(wasm, seeds.tokenAuthorization, [
            condition(63, announcementId(fixture.common.pool_coin.puzzle_hash, auth.announcementMessage)),
          ]),
        ],
      },
    };
  }
});

function spendContextFromFixture() {
  return {
    poolLauncherId: fixture.common.pool_launcher_id,
    poolCoin: {
      parentCoinInfo: fixture.common.pool_coin.parent_coin_info,
      puzzleHash: fixture.common.pool_coin.puzzle_hash,
      amount: fixture.common.pool_coin.amount,
      coinId: fixture.common.pool_coin.coin_id,
    },
    poolInnerPuzzleHex: fixture.common.pool_inner_puzzle_hex,
    lineageProof: {
      parentName: fixture.common.pool_lineage_proof.parent_name,
      innerPuzzleHash: fixture.common.pool_lineage_proof.inner_puzzle_hash,
      amount: fixture.common.pool_lineage_proof.amount,
    },
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

function navEvidenceFromFixture(
  evidence: FixtureEvidence,
  _navSeed: WitnessSeed,
): CollectionNavEvidenceInput {
  return {
    registryCoinId: evidence.registry_coin_id,
    registryPuzzleHash: evidence.registry_puzzle_hash,
    collectionIdCanon: evidence.collection_id_canon,
    navValueMojos: evidence.nav_value_mojos,
    collectionNavRoot: evidence.collection_nav_root,
    registryVersion: evidence.registry_version,
  };
}

function coinSpendFromFixture(spend: FixtureCoinSpend): UnsignedCoinSpend {
  return {
    coin: {
      parentCoinInfo: spend.coin.parent_coin_info,
      puzzleHash: spend.coin.puzzle_hash,
      amount: BigInt(spend.coin.amount),
    },
    puzzleReveal: spend.puzzle_reveal,
    solution: spend.solution,
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
  return {
    coin: {
      parentCoinInfo: seed.parentCoinInfo,
      puzzleHash: seed.puzzleHash,
      amount: seed.amount,
    },
    puzzleReveal: bytesToHex(puzzle.serialize()),
    solution: bytesToHex(
      clvm
        .list(
          conditions.map((c) =>
            clvm.list([clvm.int(BigInt(c.opcode)), clvm.atom(hexToBytes(c.message))]),
          ),
        )
        .serialize(),
    ),
  };
}

interface WitnessCondition {
  opcode: number;
  message: string;
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

async function initialiseChiaSdk(): Promise<void> {
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
}
