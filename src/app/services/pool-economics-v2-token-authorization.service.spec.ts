import { TestBed } from '@angular/core/testing';
import { sha256 } from 'ethers';

import { ChiaWasmService } from './chia-wasm.service';
import fixturesJson from './pool-economics-v2.fixtures.json';
import {
  type CollectionNavEvidenceInput,
  type PoolEconomicStateInput,
  TOKEN_MELT,
  TOKEN_MINT,
} from './pool-economics-v2.service';
import { PoolEconomicsV2SpendBuilderService } from './pool-economics-v2-spend-builder.service';
import { PoolEconomicsV2TokenAuthorizationService } from './pool-economics-v2-token-authorization.service';
import { bytesToHex, coinId, hexToBytes } from '../utils/chia-hash';

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

interface FixtureFile {
  common: {
    state: FixtureState;
    pool_launcher_id: string;
    pool_coin: FixtureCoin;
    pool_lineage_proof: FixtureLineageProof;
    pool_inner_puzzle_hex: string;
    deed_id: string;
    buyer_vault_launcher_id: string;
    launcher_puzzle_hash: string;
    property_id_canon: string;
    collection_id_canon: string;
    token_coin_id: string;
    nav_evidence: FixtureEvidence;
    acquisition_nav_evidence: FixtureEvidence;
  };
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

const fixture = fixturesJson as FixtureFile;

describe('PoolEconomicsV2TokenAuthorizationService', () => {
  let service: PoolEconomicsV2TokenAuthorizationService;
  let spendBuilder: PoolEconomicsV2SpendBuilderService;
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
    service = TestBed.inject(PoolEconomicsV2TokenAuthorizationService);
    spendBuilder = TestBed.inject(PoolEconomicsV2SpendBuilderService);
  });

  it('builds and replays exact pool-token melt TAIL material for true redemption', () => {
    const navEvidence = navEvidenceFromFixture(fixture.common.nav_evidence);
    const poolSpend = spendBuilder.buildTrueRedemptionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      vaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence,
      tokenCoinId: fixture.common.token_coin_id,
    });
    const auth = poolSpend.spec.tokenAuthorizations[0];
    const requirement = spendBuilder.describePoolV2RequiredAnnouncements({
      poolSpend,
      deedId: fixture.common.deed_id,
      navEvidence,
    }).find((r) => r.role === 'token_authorization');

    const material = service.buildForAuthorization({
      pool: spendContextFromFixture(),
      tokenCoinId: auth.tokenCoinId,
      mintOrMelt: TOKEN_MELT,
      amount: auth.amount,
    });

    if (!requirement?.announcementId) {
      throw new Error('expected token authorization requirement');
    }
    const requiredAnnouncementId = requirement.announcementId;
    expect(material.poolFullPuzzleHash).toBe(poolSpend.poolFullPuzzleHash);
    expect(material.poolInnerPuzzleHash).toBe(poolSpend.poolInnerPuzzleHash);
    expect(material.poolCoinId).toBe(poolSpend.poolCoinId);
    expect(material.tokenCoinId).toBe(auth.tokenCoinId);
    expect(material.announcementMessage).toBe(auth.announcementMessage);
    expect(material.expectedPuzzleAnnouncementId).toBe(requiredAnnouncementId);
    expect(material.assertedPuzzleAnnouncementIds).toContain(requiredAnnouncementId);
    expect(material.assertedCoinIds).toContain(auth.tokenCoinId);
    expect(material.tailPuzzleReveal).toMatch(/^0x[0-9a-f]+$/);
    expect(material.tailSolution).toMatch(/^0x[0-9a-f]+$/);
  });

  it('builds and replays exact pool-token mint TAIL material for reserve shortfall', () => {
    const navEvidence = navEvidenceFromFixture(fixture.common.acquisition_nav_evidence);
    const poolSpend = spendBuilder.buildReserveAcquisitionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      propertyIdCanon: fixture.common.property_id_canon,
      parValueMojos: inputNumber(fixture.reserve_acquisition, 'par_value_mojos'),
      assetClass: inputNumber(fixture.reserve_acquisition, 'asset_class'),
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.reserve_acquisition, 'share_ppm'),
      navEvidence,
      sellerPuzhash: inputString(fixture.reserve_acquisition, 'seller_puzhash'),
      sellerTokenPrice: inputNumber(fixture.reserve_acquisition, 'seller_token_price'),
      mintTokenCoinId: fixture.common.token_coin_id,
    });
    const auth = poolSpend.spec.tokenAuthorizations[0];
    const requirement = spendBuilder.describePoolV2RequiredAnnouncements({
      poolSpend,
      deedId: fixture.common.deed_id,
      navEvidence,
      tokenSettlementPuzzleHash: inputString(fixture.reserve_acquisition, 'seller_puzhash'),
    }).find((r) => r.role === 'token_authorization');

    const material = service.buildForAuthorization({
      pool: spendContextFromFixture(),
      tokenCoinId: auth.tokenCoinId,
      mintOrMelt: TOKEN_MINT,
      amount: auth.amount,
    });

    if (!requirement?.announcementId) {
      throw new Error('expected token authorization requirement');
    }
    const requiredAnnouncementId = requirement.announcementId;
    expect(material.mintOrMelt).toBe(TOKEN_MINT);
    expect(material.announcementMessage).toBe(auth.announcementMessage);
    expect(material.expectedPuzzleAnnouncementId).toBe(requiredAnnouncementId);
    expect(material.assertedPuzzleAnnouncementIds).toContain(requiredAnnouncementId);
    expect(material.assertedCoinIds).toContain(auth.tokenCoinId);
  });

  it('builds a full CAT2 melt authorization spend for the token witness slot', () => {
    const navEvidence = navEvidenceFromFixture(fixture.common.nav_evidence);
    const preliminaryPoolSpend = spendBuilder.buildTrueRedemptionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      vaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence,
      tokenCoinId: fixture.common.token_coin_id,
    });
    const authAmount = preliminaryPoolSpend.spec.tokenAuthorizations[0].amount;
    const tokenCoinAmount = authAmount + 7n;
    const tokenPuzzleHash = service.poolTokenAcsPuzzleHash(fixture.common.pool_launcher_id);
    const tokenCoin = {
      parentCoinInfo: b32('e1'),
      puzzleHash: tokenPuzzleHash,
      amount: tokenCoinAmount,
    };
    const tokenCoinId = coinId(tokenCoin.parentCoinInfo, tokenCoin.puzzleHash, tokenCoin.amount);
    const poolSpend = spendBuilder.buildTrueRedemptionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: fixture.common.deed_id,
      vaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence,
      tokenCoinId,
    });
    const auth = poolSpend.spec.tokenAuthorizations[0];

    const catSpend = service.buildP2ConditionsAuthorizationCoinSpend({
      pool: spendContextFromFixture(),
      tokenCoin,
      mintOrMelt: TOKEN_MELT,
      amount: auth.amount,
    });

    expect(catSpend.tokenCoinId).toBe(tokenCoinId);
    expect(catSpend.extraDelta).toBe(-auth.amount);
    expect(catSpend.childTokenAmount).toBe(7n);
    expect(catSpend.material.expectedPuzzleAnnouncementId).toBe(
      announcementId(poolSpend.poolFullPuzzleHash, auth.announcementMessage),
    );
    expect(catSpend.material.assertedPuzzleAnnouncementIds).toContain(
      catSpend.material.expectedPuzzleAnnouncementId,
    );
    expect(catSpend.material.assertedCoinIds).toContain(tokenCoinId);
    expect(catSpend.coinSpend.coin.parentCoinInfo).toBe(tokenCoin.parentCoinInfo);
    expect(catSpend.coinSpend.coin.puzzleHash).toBe(tokenCoin.puzzleHash);
    expect(catSpend.coinSpend.coin.amount).toBe(tokenCoin.amount);
    expect(catSpend.coinSpend.puzzleReveal).toMatch(/^0x[0-9a-f]+$/);
    expect(catSpend.coinSpend.solution).toMatch(/^0x[0-9a-f]+$/);
  });

  it('composes true redemption with the real CAT2 melt authorization witness', () => {
    const navSeed = witnessSeed(wasm, 0xa1);
    const deedSeed = witnessSeed(wasm, 0xd1);
    const navEvidence = {
      ...navEvidenceFromFixture(fixture.common.nav_evidence),
      registryCoinId: navSeed.coinId,
      registryPuzzleHash: navSeed.puzzleHash,
    };
    const preliminaryPoolSpend = spendBuilder.buildTrueRedemptionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: deedSeed.coinId,
      vaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence,
      tokenCoinId: b32('e3'),
    });
    const authAmount = preliminaryPoolSpend.spec.tokenAuthorizations[0].amount;
    const tokenCoin = {
      parentCoinInfo: b32('e1'),
      puzzleHash: service.poolTokenAcsPuzzleHash(fixture.common.pool_launcher_id),
      amount: authAmount + 7n,
    };
    const tokenCoinId = coinId(tokenCoin.parentCoinInfo, tokenCoin.puzzleHash, tokenCoin.amount);
    const poolSpend = spendBuilder.buildTrueRedemptionCoinSpend({
      ...spendContextFromFixture(),
      state: stateFromFixture(),
      deedId: deedSeed.coinId,
      vaultLauncherId: fixture.common.buyer_vault_launcher_id,
      launcherPuzzleHash: fixture.common.launcher_puzzle_hash,
      collectionIdCanon: fixture.common.collection_id_canon,
      sharePpm: inputNumber(fixture.true_redemption, 'share_ppm'),
      navEvidence,
      tokenCoinId,
    });
    const auth = poolSpend.spec.tokenAuthorizations[0];
    const tokenAuthorizationSpend = service.buildP2ConditionsAuthorizationCoinSpend({
      pool: spendContextFromFixture(),
      tokenCoin,
      mintOrMelt: TOKEN_MELT,
      amount: auth.amount,
    });

    const composed = spendBuilder.composePoolV2UnsignedBundle({
      poolSpend,
      deedId: deedSeed.coinId,
      navEvidence,
      witnesses: {
        navEvidenceSpend: witnessSpend(wasm, navSeed, [
          { opcode: 62, message: poolSpend.spec.requiredNavEvidenceMessage },
        ]),
        deedSpend: witnessSpend(wasm, deedSeed, [
          { opcode: 60, message: poolSpend.spec.deedMessage },
        ]),
        tokenAuthorizationSpends: [tokenAuthorizationSpend.coinSpend],
      },
    });

    expect(composed.coinSpends.length).toBe(4);
    expect(composed.witnessSummary.map((w) => w.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_authorization',
    ]);
    expect(composed.witnessSummary[2].coinId).toBe(tokenCoinId);
    expect(composed.unsignedSpendBundle.aggregatedSignature).toBeNull();
  });

  it('builds a p2-conditions CAT mint authorization spend with the increased child amount', () => {
    const mintAmount = 50n;
    const startingAmount = 100n;
    const tokenCoin = {
      parentCoinInfo: b32('e2'),
      puzzleHash: service.poolTokenAcsPuzzleHash(fixture.common.pool_launcher_id),
      amount: startingAmount,
    };

    const catSpend = service.buildP2ConditionsAuthorizationCoinSpend({
      pool: spendContextFromFixture(),
      tokenCoin,
      mintOrMelt: TOKEN_MINT,
      amount: mintAmount,
    });

    expect(catSpend.extraDelta).toBe(mintAmount);
    expect(catSpend.childTokenAmount).toBe(startingAmount + mintAmount);
    expect(catSpend.coinSpend.puzzleReveal).toMatch(/^0x[0-9a-f]+$/);
    expect(catSpend.coinSpend.solution).toMatch(/^0x[0-9a-f]+$/);
  });
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

function b32(byte: string): string {
  return `0x${byte.repeat(32)}`;
}

function witnessSeed(wasm: ChiaWasmService, byte: number): WitnessSeed {
  const sdk = wasm.sdk() as SdkShape;
  const clvm = new sdk.Clvm();
  const puzzle = clvm.int(1n);
  const parent = new Uint8Array(32).fill(byte);
  const puzzleHash = puzzle.treeHash();
  const coin = new sdk.Coin(parent, puzzleHash, 1n);
  return {
    parentCoinInfo: bytesToHex(parent),
    puzzleHash: bytesToHex(puzzleHash),
    amount: 1n,
    coinId: bytesToHex(coin.coinId()),
    puzzleReveal: bytesToHex(puzzle.serialize()),
  };
}

function witnessSpend(
  wasm: ChiaWasmService,
  seed: WitnessSeed,
  conditions: ReadonlyArray<WitnessCondition>,
) {
  const sdk = wasm.sdk() as SdkShape;
  const clvm = new sdk.Clvm();
  return {
    coin: {
      parentCoinInfo: seed.parentCoinInfo,
      puzzleHash: seed.puzzleHash,
      amount: seed.amount,
    },
    puzzleReveal: seed.puzzleReveal,
    solution: bytesToHex(
      clvm
        .list(
          conditions.map((condition) =>
            clvm.list([
              clvm.int(BigInt(condition.opcode)),
              clvm.atom(hexToBytes(condition.message)),
            ]),
          ),
        )
        .serialize(),
    ),
  };
}

function announcementId(sourceId: string, message: string): string {
  const source = hexToBytes(sourceId);
  const payload = hexToBytes(message);
  const out = new Uint8Array(source.length + payload.length);
  out.set(source, 0);
  out.set(payload, source.length);
  return sha256(out);
}

interface WitnessSeed {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: bigint;
  coinId: string;
  puzzleReveal: string;
}

interface WitnessCondition {
  opcode: number;
  message: string;
}

interface SdkShape {
  Clvm: new () => ClvmShape;
  Coin: new (parentCoinInfo: Uint8Array, puzzleHash: Uint8Array, amount: bigint) => CoinShape;
}

interface ClvmShape {
  int(value: bigint): ProgramShape;
  atom(bytes: Uint8Array): ProgramShape;
  list(items: ReadonlyArray<ProgramShape>): ProgramShape;
}

interface ProgramShape {
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
}

interface CoinShape {
  coinId(): Uint8Array;
}
