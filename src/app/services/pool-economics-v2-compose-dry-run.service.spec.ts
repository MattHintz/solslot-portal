import { TestBed } from '@angular/core/testing';

import { ChiaWasmService } from './chia-wasm.service';
import {
  PoolEconomicsV2ComposeDryRunService,
  type PoolV2ComposeDryRunArgs,
} from './pool-economics-v2-compose-dry-run.service';
import {
  POOL_SPEND_V2_RESERVE_ACQUISITION,
  POOL_SPEND_V2_SPECIFIC_DEED_SWAP,
  POOL_SPEND_V2_TRUE_REDEMPTION,
} from './pool-economics-v2-spend-builder.service';

describe('PoolEconomicsV2ComposeDryRunService', () => {
  let service: PoolEconomicsV2ComposeDryRunService;
  let wasm: ChiaWasmService;

  beforeAll(async () => {
    await initialiseChiaSdk();
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    wasm = TestBed.inject(ChiaWasmService);
    wasm.probeReady();
    service = TestBed.inject(PoolEconomicsV2ComposeDryRunService);
  });

  it('composes a specific deed swap with placeholder NAV, deed, and token settlement witnesses', () => {
    const result = service.specificDeedSwap(baseArgs());

    expect(result.spendCase).toBe(POOL_SPEND_V2_SPECIFIC_DEED_SWAP);
    expect(result.coinSpendCount).toBe(4);
    expect(result.witnessCoinSpendCount).toBe(3);
    expect(result.aggregatedSignature).toBeNull();
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

  it('composes a true redemption with a placeholder token melt authorization witness', () => {
    const result = service.trueRedemption(baseArgs());

    expect(result.spendCase).toBe(POOL_SPEND_V2_TRUE_REDEMPTION);
    expect(result.coinSpendCount).toBe(4);
    expect(result.witnessCoinSpendCount).toBe(3);
    expect(result.requiredAnnouncements.map((a) => a.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_authorization',
    ]);
  });

  it('composes a reserve acquisition at the witness ceiling', () => {
    const result = service.reserveAcquisition(baseArgs());

    expect(result.spendCase).toBe(POOL_SPEND_V2_RESERVE_ACQUISITION);
    expect(result.coinSpendCount).toBe(5);
    expect(result.witnessCoinSpendCount).toBe(4);
    expect(result.witnessCoinSpendCount).toBe(result.maxWitnessCoinSpends);
    expect(result.requiredAnnouncements.map((a) => a.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_settlement',
      'token_authorization',
    ]);
  });
});

function baseArgs(): PoolV2ComposeDryRunArgs {
  return {
    state: {
      totalNavLockedMojos: 1_000_000_000n,
      deedCount: 4n,
      totalPoolTokenSupply: 1_000_000_000n,
      treasuryReserveTokens: 200_000_000n,
    },
    collectionNavMojos: 1_000_000_000n,
    sharePpm: 250_000n,
    sellerTokenPrice: 300_000_000n,
  };
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
