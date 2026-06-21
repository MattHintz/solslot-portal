/**
 * Tests for the one-click upgrade orchestrator (Brick 6c).
 *
 * The pure composition methods (``buildLaunchPlan`` / ``buildDeedMigratePlan``)
 * are verified against the SAME cross-repo fixtures the 6a + 6b services are
 * pinned to — so a regression in composition (wrong spend order, dropped
 * signing request, swapped params) surfaces as a byte mismatch.  Deed
 * discovery is exercised with a mocked coinset.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService, CoinRecord } from './coinset.service';
import { coinId as computeCoinId } from '../utils/chia-hash';
import { SINGLETON_LAUNCHER_HASH } from './vault-launch-spend.service';
import { VaultMigrateSpendService } from './vault-migrate-spend.service';
import { VaultUpgradeService } from './vault-upgrade.service';
import launchFixturesJson from './vault-launch.fixtures.json';
import migrateFixturesJson from './vault-migrate.fixtures.json';

const launchFixtures = launchFixturesJson as any;
const migrateFixtures = migrateFixturesJson as any;

function makeCoinRecord(
  parent: string,
  puzzleHash: string,
  amount: number,
  spent = 0,
): CoinRecord {
  return {
    coin: { parent_coin_info: parent, puzzle_hash: puzzleHash, amount },
    confirmed_block_index: 100,
    spent_block_index: spent,
    coinbase: false,
    timestamp: 1000,
  };
}

describe('VaultUpgradeService', () => {
  let service: VaultUpgradeService;
  let migrate: VaultMigrateSpendService;
  let wasmService: ChiaWasmService;
  let coinset: jasmine.SpyObj<CoinsetService>;

  beforeAll(async () => {
    if ((window as unknown as { ChiaSDK?: unknown }).ChiaSDK) {
      return;
    }
    // @ts-ignore — deep-import path; types from chia_wallet_sdk_wasm.d.ts.
    const wasmExports = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
    const response = await fetch('/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm');
    if (!response.ok) {
      throw new Error(`WASM asset fetch failed: ${response.status} ${response.statusText}.`);
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
    coinset = jasmine.createSpyObj<CoinsetService>('CoinsetService', [
      'getCoinRecordsByHint',
      'getCoinRecordByName',
      'getPuzzleAndSolution',
    ]);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CoinsetService, useValue: coinset },
      ],
    });
    wasmService = TestBed.inject(ChiaWasmService);
    wasmService.probeReady();
    service = TestBed.inject(VaultUpgradeService);
    migrate = TestBed.inject(VaultMigrateSpendService);
  });

  // ── buildLaunchPlan (reuses 6a fixture) ──────────────────────────────
  describe('buildLaunchPlan', () => {
    it('composes the launcher spend matching the 6a launch outputs', () => {
      const c = launchFixtures.launch_outputs[0];
      const plan = service.buildLaunchPlan({
        fundingCoinId: c.input.parent_coin_id,
        identity: launchFixtures.identity,
        params: launchFixtures.params,
        registryVaultInnerModHash: launchFixtures.constants.vault_inner_mod_hash,
        registryCanonicalParamsHash: launchFixtures.constants.canonical_params_hash,
      });
      expect(plan.newVaultLauncherId).toBe(c.expected.launcherId);
      expect(plan.launchOutputs.vaultFullPuzzleHash).toBe(c.expected.vaultFullPuzzleHash);
      expect(plan.launcherCoinSpend.coin.parentCoinInfo).toBe(c.input.parent_coin_id);
      expect(plan.launcherCoinSpend.coin.puzzleHash).toBe(SINGLETON_LAUNCHER_HASH);
      expect(plan.launcherCoinSpend.coin.amount).toBe(1n);
    });

    it('refuses to launch when params do not match the registry', () => {
      const c = launchFixtures.launch_outputs[0];
      expect(() =>
        service.buildLaunchPlan({
          fundingCoinId: c.input.parent_coin_id,
          identity: launchFixtures.identity,
          params: launchFixtures.params,
          registryVaultInnerModHash: launchFixtures.constants.vault_inner_mod_hash,
          registryCanonicalParamsHash: '0x' + '77'.repeat(32),
        }),
      ).toThrowError(/canonical params hash does not match/);
    });
  });

  // ── buildDeedMigratePlan (reuses 6b fixture, byte-exact) ─────────────
  describe('buildDeedMigratePlan', () => {
    it('composes the vault m + deed p2_vault spends matching the 6b fixture', () => {
      const v = migrateFixtures.vault_migrate_spend[0];
      const d = migrateFixtures.deed_migrate_spend[0];
      const sig = migrateFixtures.migrate_signing_tree[0];

      const plan = service.buildDeedMigratePlan({
        oldVaultLauncherId: v.input.old_vault_launcher_id,
        currentVaultCoin: v.input.vault_coin,
        vaultLineageProof: {
          parentParentCoinInfo: v.input.lineage_proof.parentParentCoinInfo,
          parentInnerPuzzleHash: v.input.lineage_proof.parentInnerPuzzleHash,
          parentAmount: v.input.lineage_proof.parentAmount,
        },
        identity: migrateFixtures.identity,
        oldParams: migrateFixtures.params,
        deed: {
          deedLauncherId: d.input.deed_launcher_id,
          deedCoin: d.input.deed_coin,
          deedLineageProof: {
            parentParentCoinInfo: d.input.deed_lineage_proof.parentParentCoinInfo,
            parentInnerPuzzleHash: d.input.deed_lineage_proof.parentInnerPuzzleHash,
            parentAmount: d.input.deed_lineage_proof.parentAmount,
          },
        },
        newVaultLauncherId: v.input.new_vault_launcher_id,
        currentTimestamp: v.input.current_timestamp,
      });

      expect(plan.coinSpends.length).toBe(2);
      // [0] = vault 'm' spend; [1] = deed p2_vault spend.
      expect(plan.coinSpends[0].puzzleReveal).toBe(v.expected.puzzleReveal);
      expect(plan.coinSpends[0].solution).toBe(v.expected.solution);
      expect(plan.coinSpends[1].puzzleReveal).toBe(d.expected.puzzleReveal);
      expect(plan.coinSpends[1].solution).toBe(d.expected.solution);
      expect(plan.ownerSigningRequest.signingTree).toBe(sig.expected);
      expect(plan.ownerSigningRequest.vaultCoinId).toBe(v.expected.vaultCoinId);
      expect(plan.newP2VaultPuzzleHash).toBe(v.expected.newP2VaultPuzzleHash);
    });
  });

  // ── discoverDeedsAtVault (mocked coinset) ────────────────────────────
  describe('discoverDeedsAtVault', () => {
    const vaultLauncherId = '0x' + '12'.repeat(32);

    it('finds an eve deed hinted at the vault p2_vault and resolves its launcher', async () => {
      const p2VaultPh = migrate.newP2VaultPuzzleHash(vaultLauncherId);
      // The deed's launcher coin (puzzle hash = SINGLETON_LAUNCHER_HASH).
      const launcherParent = '0x' + 'a1'.repeat(32);
      const launcherRecord = makeCoinRecord(launcherParent, SINGLETON_LAUNCHER_HASH, 1, 50);
      const deedLauncherId = computeCoinId(launcherParent, SINGLETON_LAUNCHER_HASH, 1);
      // The deed's current coin: parent is the launcher (eve deed).
      const deedPuzzleHash = '0x' + 'cd'.repeat(32);
      const deedRecord = makeCoinRecord(deedLauncherId, deedPuzzleHash, 1, 0);

      coinset.getCoinRecordsByHint.and.resolveTo([deedRecord]);
      coinset.getCoinRecordByName.and.callFake(async (name: string) =>
        name.toLowerCase() === deedLauncherId.toLowerCase() ? launcherRecord : null,
      );

      const deeds = await service.discoverDeedsAtVault(vaultLauncherId);
      expect(coinset.getCoinRecordsByHint).toHaveBeenCalledWith(p2VaultPh, false);
      expect(deeds.length).toBe(1);
      expect(deeds[0].deedLauncherId).toBe(deedLauncherId);
      expect(deeds[0].deedCoin.puzzleHash).toBe(deedPuzzleHash);
      // Eve deed: parent is the launcher → 2-element lineage (null inner ph).
      expect(deeds[0].deedLineageProof.parentInnerPuzzleHash).toBeNull();
      expect(deeds[0].deedLineageProof.parentParentCoinInfo).toBe(launcherParent);
    });

    it('skips spent deed coins', async () => {
      const spentDeed = makeCoinRecord('0x' + 'ee'.repeat(32), '0x' + 'cd'.repeat(32), 1, 77);
      coinset.getCoinRecordsByHint.and.resolveTo([spentDeed]);
      const deeds = await service.discoverDeedsAtVault(vaultLauncherId);
      expect(deeds.length).toBe(0);
      expect(coinset.getCoinRecordByName).not.toHaveBeenCalled();
    });
  });
});
