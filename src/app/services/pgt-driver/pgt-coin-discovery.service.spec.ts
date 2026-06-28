import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { ChiaWasmService } from '../chia-wasm.service';
import { CoinRecord, CoinsetService } from '../coinset.service';
import {
  DiscoveryResult,
  PgtCoinDiscoveryService,
} from './pgt-coin-discovery.service';

const VOTER_INNER_PH =
  '0x00000000000000000000000000000000000000000000000000000000000000dd';
const GENESIS_COIN_ID =
  '0x00000000000000000000000000000000000000000000000000000000000000aa';
const TRACKER_LAUNCHER_ID =
  '0x00000000000000000000000000000000000000000000000000000000000000bb';

function makeRecord(amount: number, parentSuffix: string, spent = 0): CoinRecord {
  return {
    coin: {
      parent_coin_info: '0x' + parentSuffix.padStart(64, '0'),
      puzzle_hash: '0x' + 'aa'.repeat(32),
      amount,
    },
    confirmed_block_index: 100,
    spent_block_index: spent,
    coinbase: false,
    timestamp: 0,
  };
}

describe('PgtCoinDiscoveryService', () => {
  let service: PgtCoinDiscoveryService;
  let coinset: jasmine.SpyObj<CoinsetService>;

  beforeAll(async () => {
    if ((window as unknown as { ChiaSDK?: unknown }).ChiaSDK) {
      return;
    }
    // @ts-ignore — deep-import; types come from chia_wallet_sdk_wasm.d.ts.
    const wasmExports = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
    const response = await fetch('/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm');
    if (!response.ok) {
      throw new Error(
        `WASM asset fetch failed: ${response.status} ${response.statusText}.`,
      );
    }
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, {
      './chia_wallet_sdk_wasm_bg.js': wasmExports as unknown as WebAssembly.ModuleImports,
    });
    const setWasm = (wasmExports as unknown as { __wbg_set_wasm?: (w: WebAssembly.Exports) => void }).__wbg_set_wasm;
    if (typeof setWasm !== 'function') {
      throw new Error('chia_wallet_sdk_wasm_bg.js missing __wbg_set_wasm');
    }
    setWasm(result.instance.exports);
    (window as unknown as { ChiaSDK: unknown }).ChiaSDK = wasmExports;
  });

  beforeEach(() => {
    coinset = jasmine.createSpyObj<CoinsetService>('CoinsetService', [
      'getCoinRecordsByPuzzleHash',
    ]);
    TestBed.configureTestingModule({
      providers: [
        { provide: CoinsetService, useValue: coinset },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    TestBed.inject(ChiaWasmService).probeReady();
    service = TestBed.inject(PgtCoinDiscoveryService);
  });

  afterEach(() => {
    const http = TestBed.inject(HttpTestingController);
    http.verify();
  });

  it("surfaces 'pgt-not-deployed' when TAIL genesis coin id missing", async () => {
    const res = await service.discover({
      voterInnerPuzzleHash: VOTER_INNER_PH,
      pgtTailGenesisCoinId: '',
    });
    expect(res.kind).toBe('pgt-not-deployed');
    expect(coinset.getCoinRecordsByPuzzleHash).not.toHaveBeenCalled();
  });

  it("surfaces 'governance-not-deployed' when launcher id missing", async () => {
    const res = await service.discover({
      voterInnerPuzzleHash: VOTER_INNER_PH,
      pgtTailGenesisCoinId: GENESIS_COIN_ID,
      trackerLauncherId: '',
    });
    expect(res.kind).toBe('governance-not-deployed');
    expect(coinset.getCoinRecordsByPuzzleHash).not.toHaveBeenCalled();
  });

  it("surfaces 'no-coins' when coinset returns empty list", async () => {
    coinset.getCoinRecordsByPuzzleHash.and.resolveTo([]);
    const res = await service.discover({
      voterInnerPuzzleHash: VOTER_INNER_PH,
      pgtTailGenesisCoinId: GENESIS_COIN_ID,
      trackerLauncherId: TRACKER_LAUNCHER_ID,
    });
    expect(res.kind).toBe('no-coins');
    if (res.kind === 'no-coins') {
      expect(res.catPgtFreePuzzleHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
    expect(coinset.getCoinRecordsByPuzzleHash).toHaveBeenCalledTimes(1);
  });

  it("surfaces 'no-coins' when all returned coins are spent", async () => {
    coinset.getCoinRecordsByPuzzleHash.and.resolveTo([
      makeRecord(100, '11', /*spent*/ 500),
      makeRecord(200, '22', /*spent*/ 510),
    ]);
    const res = await service.discover({
      voterInnerPuzzleHash: VOTER_INNER_PH,
      pgtTailGenesisCoinId: GENESIS_COIN_ID,
      trackerLauncherId: TRACKER_LAUNCHER_ID,
    });
    expect(res.kind).toBe('no-coins');
  });

  it("surfaces 'found' with coins sorted by amount descending", async () => {
    coinset.getCoinRecordsByPuzzleHash.and.resolveTo([
      makeRecord(100, '11'),
      makeRecord(500, '22'),
      makeRecord(300, '33'),
    ]);
    const res = await service.discover({
      voterInnerPuzzleHash: VOTER_INNER_PH,
      pgtTailGenesisCoinId: GENESIS_COIN_ID,
      trackerLauncherId: TRACKER_LAUNCHER_ID,
    });
    expect(res.kind).toBe('found');
    if (res.kind === 'found') {
      expect(res.coins.length).toBe(3);
      expect(res.coins[0].amount).toBe(500);
      expect(res.coins[1].amount).toBe(300);
      expect(res.coins[2].amount).toBe(100);
      expect(res.totalMojos).toBe(BigInt(900));
    }
  });

  it("filters out spent coins from 'found' result", async () => {
    coinset.getCoinRecordsByPuzzleHash.and.resolveTo([
      makeRecord(100, '11'),
      makeRecord(500, '22', /*spent*/ 600),
      makeRecord(300, '33'),
    ]);
    const res = await service.discover({
      voterInnerPuzzleHash: VOTER_INNER_PH,
      pgtTailGenesisCoinId: GENESIS_COIN_ID,
      trackerLauncherId: TRACKER_LAUNCHER_ID,
    });
    expect(res.kind).toBe('found');
    if (res.kind === 'found') {
      expect(res.coins.length).toBe(2);
      expect(res.coins.map((c) => c.amount)).toEqual([300, 100]);
      expect(res.totalMojos).toBe(BigInt(400));
    }
  });

  it('queries coinset with the derived CAT-pgt-free puzzle hash', async () => {
    coinset.getCoinRecordsByPuzzleHash.and.resolveTo([]);
    await service.discover({
      voterInnerPuzzleHash: VOTER_INNER_PH,
      pgtTailGenesisCoinId: GENESIS_COIN_ID,
      trackerLauncherId: TRACKER_LAUNCHER_ID,
    });
    const [arg0, arg1] = coinset.getCoinRecordsByPuzzleHash.calls.mostRecent().args;
    expect(arg0).toMatch(/^0x[0-9a-f]{64}$/);
    expect(arg1).toBe(false);
  });

  describe('catPgtFreePuzzleHashHex', () => {
    it('returns null when config is incomplete', () => {
      expect(
        service.catPgtFreePuzzleHashHex({
          voterInnerPuzzleHash: VOTER_INNER_PH,
          pgtTailGenesisCoinId: '',
          trackerLauncherId: TRACKER_LAUNCHER_ID,
        }),
      ).toBeNull();
      expect(
        service.catPgtFreePuzzleHashHex({
          voterInnerPuzzleHash: VOTER_INNER_PH,
          pgtTailGenesisCoinId: GENESIS_COIN_ID,
          trackerLauncherId: '',
        }),
      ).toBeNull();
    });

    it('returns a deterministic 32-byte hex when configured', () => {
      const ph = service.catPgtFreePuzzleHashHex({
        voterInnerPuzzleHash: VOTER_INNER_PH,
        pgtTailGenesisCoinId: GENESIS_COIN_ID,
        trackerLauncherId: TRACKER_LAUNCHER_ID,
      });
      expect(ph).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});
