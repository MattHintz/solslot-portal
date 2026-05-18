import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ChiaWasmService } from '../chia-wasm.service';
import {
  AdminRosterMipsExecutionCoinSpendRequest,
  AdminRosterMipsExecutionCoinSpendService,
  BoundedMipsExecutionReport,
} from './admin-roster-mips-execution-coin-spend.service';
import fixtureJson from './admin-roster-mips-execution-coin-spend.fixture.json';

interface FixtureFile {
  case: string;
  request: AdminRosterMipsExecutionCoinSpendRequest;
  expected: {
    coin_spend: {
      coin: {
        parentCoinInfo: string;
        puzzleHash: string;
        amount: number;
      };
      puzzleReveal: string;
      solution: string;
    };
    bounded_mips_execution_report: Pick<
      BoundedMipsExecutionReport,
      'cost' | 'opcodes' | 'create_puzzle_announcements' | 'create_coins' | 'agg_sig_me_conditions' | 'asserted_my_amount'
    >;
    review: {
      singleton_coin_id: string;
      current_singleton_full_puzzle_hash: string;
      next_singleton_full_puzzle_hash: string;
      new_state_hash: string;
      roster_update_binding_hash: string;
    };
  };
}

const fixture = fixtureJson as FixtureFile;

describe('AdminRosterMipsExecutionCoinSpendService protocol fixture', () => {
  let service: AdminRosterMipsExecutionCoinSpendService;

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
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const wasmService = TestBed.inject(ChiaWasmService);
    wasmService.probeReady();
    service = TestBed.inject(AdminRosterMipsExecutionCoinSpendService);
  });

  it('matches the Python driver fixture for a local unsigned roster-update CoinSpend candidate', () => {
    const result = service.build(fixture.request);

    expect(result.ok).withContext(result.failures.join('\n')).toBeTrue();
    expect(result.failures).toEqual([]);
    const candidate = result.candidate;
    expect(candidate).not.toBeNull();
    if (!candidate) return;

    expect(candidate.result).toBe('unsigned_coin_spend_candidate_only_no_signatures');
    expect(candidate.unsigned_admin_authority_v2_coin_spend).toEqual(fixture.expected.coin_spend);
    expect(candidate.unsigned_spend_bundle_candidate).toEqual({
      coin_spends: [fixture.expected.coin_spend],
      signing_status: 'unsigned_no_signature_material',
      broadcast_status: 'not_broadcast',
    });
    expect(candidate.bounded_mips_execution_report.cost).toBe(
      fixture.expected.bounded_mips_execution_report.cost,
    );
    expect(candidate.bounded_mips_execution_report.opcodes).toEqual(
      fixture.expected.bounded_mips_execution_report.opcodes,
    );
    expect(candidate.bounded_mips_execution_report.create_puzzle_announcements).toEqual(
      fixture.expected.bounded_mips_execution_report.create_puzzle_announcements,
    );
    expect(candidate.bounded_mips_execution_report.create_coins).toEqual(
      fixture.expected.bounded_mips_execution_report.create_coins,
    );
    expect(candidate.bounded_mips_execution_report.agg_sig_me_conditions).toEqual(
      fixture.expected.bounded_mips_execution_report.agg_sig_me_conditions,
    );
    expect(candidate.bounded_mips_execution_report.asserted_my_amount).toEqual(
      fixture.expected.bounded_mips_execution_report.asserted_my_amount,
    );
    expect(candidate.deterministic_pre_signing_review).toEqual({
      ...fixture.expected.review,
      mips_execution_cost: fixture.expected.bounded_mips_execution_report.cost,
    });
    expect(candidate.boundary_guards).toContain('wallet_signature_not_collected');
    expect(candidate.boundary_guards).toContain('transaction_not_signed');
    expect(candidate.boundary_guards).toContain('transaction_not_broadcast');
    expect(JSON.stringify(candidate)).not.toContain('aggregatedSignature');
  });
});
