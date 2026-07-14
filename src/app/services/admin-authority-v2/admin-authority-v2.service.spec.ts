/**
 * Cross-repo binding test for the TS port of admin_authority_v2_driver.
 *
 * The fixture file (``admin-authority-v2.fixtures.json``) is generated
 * by the Python helpers in ``solslot_protocol/scripts/dump_v2_fixtures.py``
 * and pinned by ``tests/test_v2_fixtures.py``.  Each section of the
 * fixture corresponds to a TS helper and asserts hex-byte equivalence.
 *
 * **If a test here fails:**
 *   1. The TS implementation in ``admin-authority-v2.service.ts`` drifted
 *      from the Python source of truth.  Diff the offending case's
 *      input + output and find the divergence.
 *   2. OR the Python source changed and the fixture wasn't regenerated.
 *      Re-run ``python solslot_protocol/scripts/dump_v2_fixtures.py``
 *      and re-test.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ChiaWasmService } from '../chia-wasm.service';
import {
  AdminAuthorityV2Service,
  AdminRecord,
  PendingOp,
  bytesToHexPrefixed,
} from './admin-authority-v2.service';
import fixturesJson from './admin-authority-v2.fixtures.json';

// Type narrowing for the fixture shape so TypeScript can guard the
// indexing in tests below.
interface FixtureCase<TInput, TExpected = string> {
  label: string;
  input: TInput;
  expected: TExpected;
}

interface AdminInputFixture {
  admin_idx: number;
  leaves: string[];
  m_within: number;
}

interface PendingOpInputFixture {
  admin_idx: number;
  op_kind: number;
  target_hash: string;
  activates_at: number;
}

interface InnerPuzzleInputFixture {
  mips_root_hash: string;
  admins_hash: string;
  pending_ops_hash?: string;
  authority_version?: number;
  max_admins?: number;
  max_keys_per_admin?: number;
  cooldown_blocks?: number;
  recovery_timeout_blocks?: number;
  sgt_governance_puzzle_hash?: string;
}

interface RosterUpdateBindingInputFixture {
  current_mips_root_hash: string;
  current_admins_hash: string;
  current_pending_ops_hash: string;
  current_authority_version: number;
  new_admins_hash: string;
  new_mips_root_hash: string;
  new_authority_version: number;
}

interface SingletonFullInputFixture {
  launcher_id: string;
  inner_puzzle_hash: string;
}

interface LaunchInputFixture {
  parent_coin_id: string;
  eve_inner_puzzle_hash: string;
  eve_amount: number;
}

interface LaunchExpectedFixture {
  launcher_id: string;
  eve_full_puzzle_hash: string;
  launcher_announcement_message: string;
  launcher_announcement_id: string;
}

interface FixtureFile {
  constants: {
    mod_hash: string;
    empty_list_hash: string;
    default_max_admins: number;
    default_max_keys_per_admin: number;
    default_cooldown_blocks: number;
    default_recovery_timeout_blocks: number;
    default_sgt_governance_puzzle_hash: string;
    singleton_mod_hash: string;
    singleton_launcher_hash: string;
  };
  state_hash: FixtureCase<{
    mips_root_hash: string;
    admins_hash: string;
    pending_ops_hash: string;
    authority_version: number;
  }>[];
  admins_hash: FixtureCase<AdminInputFixture[]>[];
  pending_ops_hash: FixtureCase<PendingOpInputFixture[]>[];
  inner_puzzle_hash: FixtureCase<InnerPuzzleInputFixture>[];
  roster_update_binding_hash: FixtureCase<RosterUpdateBindingInputFixture>[];
  singleton_full_puzzle_hash: FixtureCase<SingletonFullInputFixture>[];
  launch_outputs: FixtureCase<LaunchInputFixture, LaunchExpectedFixture>[];
}

const fixtures = fixturesJson as FixtureFile;
const PRECHECK_H1 = '0x' + '11'.repeat(32);
const PRECHECK_H2 = '0x' + '22'.repeat(32);
const PRECHECK_H3 = '0x' + '33'.repeat(32);
const PRECHECK_H4 = '0x' + '44'.repeat(32);

describe('AdminAuthorityV2Service', () => {
  let service: AdminAuthorityV2Service;

  beforeAll(async () => {
    // Mirror ``main.ts:initializeChiaWasm()``'s production bootstrap
    // pattern: deep-import the JS glue (NOT the package index, which
    // does ``import * as wasm from './..._bg.wasm'`` and breaks
    // Angular's Zone.js-aware esbuild config), fetch the .wasm
    // binary from the test server's static assets (Karma serves
    // ``angular.json``'s ``test.assets`` glob at ``/assets/...``),
    // hand-instantiate, and stash the result on ``window.ChiaSDK``
    // where ChiaWasmService's ``probeReady()`` will pick it up.
    //
    // This avoids the ESM-WASM import path that would require
    // zoneless Angular and lets the spec run under the standard
    // Zone.js-based test harness.
    //
    // We guard on existing ``window.ChiaSDK`` so the wasm is only
    // instantiated once across the karma session — running
    // ``__wbg_set_wasm`` twice (once per spec) corrupts memory because
    // the bg.js module is a singleton across imports.
    if ((window as unknown as { ChiaSDK?: unknown }).ChiaSDK) {
      return;
    }

    // @ts-ignore — deep-import path; types come from chia_wallet_sdk_wasm.d.ts.
    const wasmExports = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
    const response = await fetch('/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm');
    if (!response.ok) {
      throw new Error(
        `WASM asset fetch failed: ${response.status} ${response.statusText}.\n` +
          'Karma must serve src/assets/chia_wasm at /assets/chia_wasm — ' +
          'check angular.json:test.assets.',
      );
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
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const wasmService = TestBed.inject(ChiaWasmService);
    // Force the wasm service to re-probe now that the test setup
    // has populated window.ChiaSDK.
    wasmService.probeReady();
    service = TestBed.inject(AdminAuthorityV2Service);
  });

  // ───────────────────────────────────────────────────────────────────
  // Constants
  // ───────────────────────────────────────────────────────────────────
  describe('constants', () => {
    it('mod hash matches the on-chain SELF_MOD_HASH', () => {
      const got = bytesToHexPrefixed(service.modHash());
      expect(got).withContext('admin_authority_v2_inner.clsp mod hash').toBe(
        fixtures.constants.mod_hash,
      );
    });

    it('EMPTY_LIST_HASH constant matches the Python EMPTY_LIST_HASH', () => {
      expect(AdminAuthorityV2Service.EMPTY_LIST_HASH).toBe(
        fixtures.constants.empty_list_hash,
      );
    });

    it('default policy values match the Python defaults', () => {
      const D = AdminAuthorityV2Service.DEFAULTS;
      // Compare via String() — TypeScript narrows the ``as const`` bigint
      // literals to specific literal types (e.g. ``25n``) which Jasmine's
      // ``toBe`` then refuses to compare with the dynamic ``BigInt(...)``
      // value.  Stringifying lets us assert numeric equivalence without
      // fighting the type system.
      expect(String(D.maxAdmins)).toBe(String(fixtures.constants.default_max_admins));
      expect(String(D.maxKeysPerAdmin)).toBe(
        String(fixtures.constants.default_max_keys_per_admin),
      );
      expect(String(D.cooldownBlocks)).toBe(
        String(fixtures.constants.default_cooldown_blocks),
      );
      expect(String(D.recoveryTimeoutBlocks)).toBe(
        String(fixtures.constants.default_recovery_timeout_blocks),
      );
      expect(D.sgtGovernancePuzzleHash).toBe(
        fixtures.constants.default_sgt_governance_puzzle_hash,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // computeStateHash
  // ───────────────────────────────────────────────────────────────────
  describe('computeStateHash', () => {
    fixtures.state_hash.forEach((c) => {
      it(`matches Python for case "${c.label}"`, () => {
        const got = bytesToHexPrefixed(
          service.computeStateHash({
            mipsRootHash: c.input.mips_root_hash,
            adminsHash: c.input.admins_hash,
            pendingOpsHash: c.input.pending_ops_hash,
            authorityVersion: c.input.authority_version,
          }),
        );
        expect(got).withContext(`state_hash[${c.label}]`).toBe(c.expected);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // computeAdminsHash
  // ───────────────────────────────────────────────────────────────────
  describe('computeAdminsHash', () => {
    fixtures.admins_hash.forEach((c) => {
      it(`matches Python for case "${c.label}"`, () => {
        const admins: AdminRecord[] = c.input.map((a) => ({
          adminIdx: a.admin_idx,
          leaves: a.leaves,
          mWithin: a.m_within,
        }));
        const got = bytesToHexPrefixed(service.computeAdminsHash(admins));
        expect(got).withContext(`admins_hash[${c.label}]`).toBe(c.expected);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // computePendingOpsHash
  // ───────────────────────────────────────────────────────────────────
  describe('computePendingOpsHash', () => {
    fixtures.pending_ops_hash.forEach((c) => {
      it(`matches Python for case "${c.label}"`, () => {
        const ops: PendingOp[] = c.input.map((op) => ({
          adminIdx: op.admin_idx,
          opKind: op.op_kind,
          targetHash: op.target_hash,
          activatesAt: op.activates_at,
        }));
        const got = bytesToHexPrefixed(service.computePendingOpsHash(ops));
        expect(got).withContext(`pending_ops_hash[${c.label}]`).toBe(c.expected);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // makeInnerPuzzleHash
  // ───────────────────────────────────────────────────────────────────
  describe('makeInnerPuzzleHash', () => {
    fixtures.inner_puzzle_hash.forEach((c) => {
      it(`matches Python for case "${c.label}"`, () => {
        const got = bytesToHexPrefixed(
          service.makeInnerPuzzleHash({
            mipsRootHash: c.input.mips_root_hash,
            adminsHash: c.input.admins_hash,
            pendingOpsHash: c.input.pending_ops_hash,
            authorityVersion: c.input.authority_version,
            maxAdmins: c.input.max_admins,
            maxKeysPerAdmin: c.input.max_keys_per_admin,
            cooldownBlocks: c.input.cooldown_blocks,
            recoveryTimeoutBlocks: c.input.recovery_timeout_blocks,
            sgtGovernancePuzzleHash: c.input.sgt_governance_puzzle_hash,
          }),
        );
        expect(got).withContext(`inner_puzzle_hash[${c.label}]`).toBe(c.expected);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // computeRosterUpdateBindingHash
  // ───────────────────────────────────────────────────────────────────
  describe('computeRosterUpdateBindingHash', () => {
    fixtures.roster_update_binding_hash.forEach((c) => {
      it(`matches Python for case "${c.label}"`, () => {
        const got = bytesToHexPrefixed(
          service.computeRosterUpdateBindingHash({
            currentMipsRootHash: c.input.current_mips_root_hash,
            currentAdminsHash: c.input.current_admins_hash,
            currentPendingOpsHash: c.input.current_pending_ops_hash,
            currentAuthorityVersion: c.input.current_authority_version,
            newAdminsHash: c.input.new_admins_hash,
            newMipsRootHash: c.input.new_mips_root_hash,
            newAuthorityVersion: c.input.new_authority_version,
          }),
        );
        expect(got)
          .withContext(`roster_update_binding_hash[${c.label}]`)
          .toBe(c.expected);
      });
    });
  });

  describe('validateUnsignedRosterSpendPackage', () => {
    it('passes a locally consistent unsigned package', () => {
      const pkg = validUnsignedRosterSpendPackage(service);

      const result = service.validateUnsignedRosterSpendPackage(pkg);

      expect(result.ok).toBeTrue();
      expect(result.status).toBe('passes local checks');
      expect(result.failures).toEqual([]);
    });

    it('rejects the wrong package kind', () => {
      const pkg = validUnsignedRosterSpendPackage(service);
      pkg['kind'] = 'backend_prepared_roster_update';

      const result = service.validateUnsignedRosterSpendPackage(pkg);

      expect(result.ok).toBeFalse();
      expect(result.failures).toContain('kind must equal admin_authority_v2_roster_update_unsigned_package');
    });

    it('rejects a stale roster update binding hash', () => {
      const pkg = validUnsignedRosterSpendPackage(service);
      (pkg['update'] as Record<string, unknown>)['roster_update_binding_hash'] = PRECHECK_H4;

      const result = service.validateUnsignedRosterSpendPackage(pkg);

      expect(result.ok).toBeFalse();
      expect(result.failures).toContain('update.roster_update_binding_hash must match computed roster update binding hash');
    });

    it('rejects a mutated new admins hash', () => {
      const pkg = validUnsignedRosterSpendPackage(service);
      (pkg['update'] as Record<string, unknown>)['new_admins_hash'] = PRECHECK_H4;

      const result = service.validateUnsignedRosterSpendPackage(pkg);

      expect(result.ok).toBeFalse();
      expect(result.failures).toContain('update.new_admins_hash must match computed admin records hash');
    });

    it('rejects pending ops hash drift', () => {
      const pkg = validUnsignedRosterSpendPackage(service);
      (pkg['update'] as Record<string, unknown>)['new_pending_ops_hash'] = PRECHECK_H1;

      const result = service.validateUnsignedRosterSpendPackage(pkg);

      expect(result.ok).toBeFalse();
      expect(result.failures).toContain('current.pending_ops_hash must equal update.new_pending_ops_hash');
    });

    it('ignores optional API attachments for package validity', () => {
      const pkg = validUnsignedRosterSpendPackage(service);
      (pkg['optional_attachments'] as Record<string, unknown>)['api_cross_check'] = {
        submission_status: 'validated_preview_only_roster_spend_not_submitted',
      };
      (pkg['optional_attachments'] as Record<string, unknown>)['api_live_singleton_lookup'] = {
        lookup_status: 'found_unique_unspent_candidate',
      };

      const result = service.validateUnsignedRosterSpendPackage(pkg);

      expect(result.ok).toBeTrue();
      expect(result.failures).toEqual([]);
    });

    it('rejects credential and signature fields anywhere in the package', () => {
      const pkg = validUnsignedRosterSpendPackage(service);
      (pkg['optional_attachments'] as Record<string, unknown>)['api_cross_check'] = {
        jwt: 'header.payload.signature',
        signature: '0x' + 'ab'.repeat(65),
        nonce: PRECHECK_H1,
      };

      const result = service.validateUnsignedRosterSpendPackage(pkg);

      expect(result.ok).toBeFalse();
      expect(result.failures.join('\n')).toContain('jwt must not contain credentials or signatures');
      expect(result.failures.join('\n')).toContain('signature must not contain credentials or signatures');
      expect(result.failures.join('\n')).toContain('nonce must not contain credentials or signatures');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Singleton constants
  // ───────────────────────────────────────────────────────────────────
  describe('singleton constants', () => {
    it('SINGLETON_MOD_HASH matches the canonical Chia value', () => {
      expect(AdminAuthorityV2Service.SINGLETON_MOD_HASH).toBe(
        fixtures.constants.singleton_mod_hash,
      );
    });

    it('SINGLETON_LAUNCHER_HASH matches the canonical Chia value', () => {
      expect(AdminAuthorityV2Service.SINGLETON_LAUNCHER_HASH).toBe(
        fixtures.constants.singleton_launcher_hash,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // singletonFullPuzzleHash
  // ───────────────────────────────────────────────────────────────────
  describe('singletonFullPuzzleHash', () => {
    fixtures.singleton_full_puzzle_hash.forEach((c) => {
      it(`matches puzzle_for_singleton for case "${c.label}"`, () => {
        const got = bytesToHexPrefixed(
          service.singletonFullPuzzleHash(
            c.input.launcher_id,
            c.input.inner_puzzle_hash,
          ),
        );
        expect(got)
          .withContext(`singleton_full_puzzle_hash[${c.label}]`)
          .toBe(c.expected);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // buildLauncherCoinSpend (D-2.6)
  // ───────────────────────────────────────────────────────────────────
  describe('buildLauncherCoinSpend', () => {
    const PARENT = '0x' + 'aa'.repeat(32);
    const EVE_FULL_PH = '0x' + 'cd'.repeat(32);

    it('shapes the CoinSpend with the launcher hash + 1 mojo', () => {
      const spend = service.buildLauncherCoinSpend({
        parentCoinId: PARENT,
        eveFullPuzzleHash: EVE_FULL_PH,
      });
      expect(spend.coin.parentCoinInfo).toBe(PARENT);
      expect(spend.coin.puzzleHash).toBe(
        AdminAuthorityV2Service.SINGLETON_LAUNCHER_HASH,
      );
      expect(spend.coin.amount).toBe(1n);
      // Puzzle reveal is the standard chia singleton_launcher bytecode;
      // a non-trivial-length hex string is enough to catch empty/wrong
      // results without pinning the exact bytecode (which lives in
      // chia-wallet-sdk-wasm and may change across SDK releases).
      expect(spend.puzzleReveal.startsWith('0x')).toBe(true);
      expect(spend.puzzleReveal.length).toBeGreaterThan(10);
      expect(service.computeSerializedProgramTreeHash(spend.puzzleReveal)).toBe(
        AdminAuthorityV2Service.SINGLETON_LAUNCHER_HASH,
      );
      expect(spend.solution.startsWith('0x')).toBe(true);
    });

    it('produces deterministic output for same inputs', () => {
      const a = service.buildLauncherCoinSpend({
        parentCoinId: PARENT,
        eveFullPuzzleHash: EVE_FULL_PH,
      });
      const b = service.buildLauncherCoinSpend({
        parentCoinId: PARENT,
        eveFullPuzzleHash: EVE_FULL_PH,
      });
      expect(a).toEqual(b);
    });

    it('different eve_full_puzzle_hash → different solution (same puzzle reveal)', () => {
      const a = service.buildLauncherCoinSpend({
        parentCoinId: PARENT,
        eveFullPuzzleHash: '0x' + '11'.repeat(32),
      });
      const b = service.buildLauncherCoinSpend({
        parentCoinId: PARENT,
        eveFullPuzzleHash: '0x' + '22'.repeat(32),
      });
      // Puzzle reveal is the standard launcher — same for both.
      expect(a.puzzleReveal).toBe(b.puzzleReveal);
      // Solution carries the eve full puzzle hash, so it differs.
      expect(a.solution).not.toBe(b.solution);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // computeLaunchOutputs
  // ───────────────────────────────────────────────────────────────────
  describe('computeLaunchOutputs', () => {
    fixtures.launch_outputs.forEach((c) => {
      it(`matches Python for case "${c.label}"`, () => {
        const got = service.computeLaunchOutputs({
          parentCoinId: c.input.parent_coin_id,
          eveInnerPuzzleHash: c.input.eve_inner_puzzle_hash,
          eveAmount: c.input.eve_amount,
        });
        // Each output field is independently asserted so a single
        // divergence (e.g. wrong launcher coinId computation) surfaces
        // a precise failure message.
        expect(got.launcherId)
          .withContext(`launch_outputs[${c.label}].launcherId`)
          .toBe(c.expected.launcher_id);
        expect(got.eveFullPuzzleHash)
          .withContext(`launch_outputs[${c.label}].eveFullPuzzleHash`)
          .toBe(c.expected.eve_full_puzzle_hash);
        expect(got.launcherAnnouncementMessage)
          .withContext(`launch_outputs[${c.label}].launcherAnnouncementMessage`)
          .toBe(c.expected.launcher_announcement_message);
        expect(got.launcherAnnouncementId)
          .withContext(`launch_outputs[${c.label}].launcherAnnouncementId`)
          .toBe(c.expected.launcher_announcement_id);

        // Sanity checks on coin shapes (not in fixture but derivable).
        expect(got.launcherCoin.parentCoinInfo).toBe(c.input.parent_coin_id);
        expect(got.launcherCoin.puzzleHash).toBe(
          AdminAuthorityV2Service.SINGLETON_LAUNCHER_HASH,
        );
        expect(got.launcherCoin.amount).toBe(1n);
        expect(got.eveCoin.parentCoinInfo).toBe(got.launcherId);
        expect(got.eveCoin.puzzleHash).toBe(got.eveFullPuzzleHash);
        expect(got.eveCoin.amount).toBe(BigInt(c.input.eve_amount));
        expect(got.eveInnerPuzzleHash).toBe(c.input.eve_inner_puzzle_hash);
      });
    });
  });
});

function validUnsignedRosterSpendPackage(service: AdminAuthorityV2Service): Record<string, unknown> {
  const currentRecord = {
    admin_idx: 0,
    m_within: 1,
    leaves: [{ leaf_hash: PRECHECK_H1 }],
  };
  const newRecord = {
    admin_idx: 1,
    m_within: 1,
    leaves: [{ leaf_hash: PRECHECK_H2 }],
  };
  const currentAdminRecords: AdminRecord[] = [{ adminIdx: 0, leaves: [PRECHECK_H1], mWithin: 1 }];
  const updatedAdminRecords: AdminRecord[] = [
    currentAdminRecords[0],
    { adminIdx: 1, leaves: [PRECHECK_H2], mWithin: 1 },
  ];
  const pendingOpsHash = AdminAuthorityV2Service.EMPTY_LIST_HASH;
  const currentAdminsHash = bytesToHexPrefixed(service.computeAdminsHash(currentAdminRecords));
  const newAdminsHash = bytesToHexPrefixed(service.computeAdminsHash(updatedAdminRecords));
  const currentStateHash = bytesToHexPrefixed(
    service.computeStateHash({
      mipsRootHash: PRECHECK_H2,
      adminsHash: currentAdminsHash,
      pendingOpsHash,
      authorityVersion: 1,
    }),
  );
  const newStateHash = bytesToHexPrefixed(
    service.computeStateHash({
      mipsRootHash: PRECHECK_H3,
      adminsHash: newAdminsHash,
      pendingOpsHash,
      authorityVersion: 2,
    }),
  );
  const rosterUpdateBindingHash = bytesToHexPrefixed(
    service.computeRosterUpdateBindingHash({
      currentMipsRootHash: PRECHECK_H2,
      currentAdminsHash,
      currentPendingOpsHash: pendingOpsHash,
      currentAuthorityVersion: 1,
      newAdminsHash,
      newMipsRootHash: PRECHECK_H3,
      newAuthorityVersion: 2,
    }),
  );
  return {
    version: 1,
    kind: 'admin_authority_v2_roster_update_unsigned_package',
    network: 'testnet11',
    package_status: 'unsigned_package_only',
    signing_status: 'not_signed',
    broadcast_status: 'not_built_not_submitted',
    backend_dependency: 'optional_admin_cross_check_only',
    launcher_id: PRECHECK_H4,
    activation_status: 'candidate_not_active_until_admin_roster_update_confirms',
    spend_intent: {
      kind: 'admin_authority_v2_roster_update',
      spend_tag: 7,
      spend_name: 'ADMIN_ROSTER_UPDATE',
      launcher_id: PRECHECK_H4,
      current_state_hash: currentStateHash,
      new_state_hash: newStateHash,
      roster_update_binding_hash: rosterUpdateBindingHash,
      binding_hash_source: 'local_admin_authority_v2_service',
      validation_scope: 'local_unsigned_package_no_broadcast',
    },
    current: {
      authority_version: 1,
      mips_root_hash: PRECHECK_H2,
      admins_hash: currentAdminsHash,
      state_hash: currentStateHash,
      pending_ops_hash: pendingOpsHash,
      admin_records: [currentRecord],
    },
    update: {
      new_authority_version: 2,
      new_admin_record: newRecord,
      new_threshold: 2,
      new_mips_member_hashes: [PRECHECK_H1, PRECHECK_H2],
      new_mips_root_hash: PRECHECK_H3,
      new_admins_hash: newAdminsHash,
      new_pending_ops_hash: pendingOpsHash,
      new_state_hash: newStateHash,
      roster_update_binding_hash: rosterUpdateBindingHash,
      updated_admin_records: [currentRecord, newRecord],
    },
    live_singleton: {
      source: 'operator_wallet_or_coinset_client',
      required_amount: 1,
      selected_coin: null,
    },
    required_local_signer_inputs: [
      'current MIPS puzzle reveal matching current.mips_root_hash',
    ],
    optional_attachments: {
      api_cross_check_status: 'not checked',
      api_cross_check: null,
      api_live_singleton_lookup: null,
    },
  };
}
