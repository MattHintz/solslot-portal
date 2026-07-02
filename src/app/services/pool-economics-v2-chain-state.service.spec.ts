import { TestBed } from '@angular/core/testing';

import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import {
  ClvmShape,
  PoolEconomicsV2ChainStateService,
  decodePoolEconomicStateTransition,
} from './pool-economics-v2-chain-state.service';
import fixturesJson from './pool-economics-v2.fixtures.json';

interface FixtureState {
  total_nav_locked_mojos: number;
  deed_count: number;
  total_pool_token_supply: number;
  treasury_reserve_tokens: number;
}

interface FixtureFile {
  common: {
    state: FixtureState;
    pool_coin_id: string;
    pool_coin: {
      parent_coin_info: string;
      puzzle_hash: string;
      amount: number;
    };
    pool_launcher_id: string;
  };
  specific_deed_swap: FixtureSection;
  true_redemption: FixtureSection;
  reserve_acquisition: FixtureSection;
}

interface FixtureSection {
  expected: {
    next_state: FixtureState;
    pool_coin_spend: {
      coin: {
        parent_coin_info: string;
        puzzle_hash: string;
        amount: number;
        coin_id: string;
      };
      puzzle_reveal: string;
      solution: string;
    };
  };
}

const fixture = fixturesJson as FixtureFile;

describe('PoolEconomicsV2ChainStateService', () => {
  let wasm: ChiaWasmService;

  beforeAll(async () => {
    await initialiseChiaSdk();
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    wasm = TestBed.inject(ChiaWasmService);
    await waitForChiaSdk(wasm);
  });

  for (const [label, section] of [
    ['specific deed swap', fixture.specific_deed_swap],
    ['true redemption', fixture.true_redemption],
    ['reserve acquisition', fixture.reserve_acquisition],
  ] as const) {
    it(`reconstructs current pool state after ${label}`, () => {
      const decoded = decodePoolEconomicStateTransition(clvm(), {
        puzzleReveal: section.expected.pool_coin_spend.puzzle_reveal,
        solution: section.expected.pool_coin_spend.solution,
      });

      expectDecodedState(decoded.previousState).toEqualFixture(fixture.common.state);
      expectDecodedState(decoded.state).toEqualFixture(section.expected.next_state);
      expect(decoded.previousInnerPuzzleHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(decoded.rebuiltInnerPuzzleHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(decoded.rebuiltInnerPuzzleHex).toMatch(/^0x[0-9a-f]+$/);
      expect(decoded.rebuiltFullPuzzleHash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  }

  it('rejects a rebuilt child puzzle hash that does not match the live coin', () => {
    const decoded = decodePoolEconomicStateTransition(clvm(), {
      puzzleReveal: fixture.specific_deed_swap.expected.pool_coin_spend.puzzle_reveal,
      solution: fixture.specific_deed_swap.expected.pool_coin_spend.solution,
    });

    expect(() =>
      decodePoolEconomicStateTransition(clvm(), {
        puzzleReveal: fixture.specific_deed_swap.expected.pool_coin_spend.puzzle_reveal,
        solution: fixture.specific_deed_swap.expected.pool_coin_spend.solution,
        expectedCurrentPuzzleHash: mutateLastNibble(decoded.rebuiltFullPuzzleHash),
      }),
    ).toThrowError(/does not match live coin/);
  });

  it('walks the pool singleton and returns confirmed live state', async () => {
    const decoded = decodePoolEconomicStateTransition(clvm(), {
      puzzleReveal: fixture.true_redemption.expected.pool_coin_spend.puzzle_reveal,
      solution: fixture.true_redemption.expected.pool_coin_spend.solution,
    });
    const singleton = jasmine.createSpyObj<
      Pick<ChiaSingletonReaderService, 'walkLineage' | 'replayLatestSpend'>
    >('ChiaSingletonReaderService', ['walkLineage', 'replayLatestSpend']);
    singleton.walkLineage.and.resolveTo(lineage(decoded.rebuiltFullPuzzleHash));
    singleton.replayLatestSpend.and.resolveTo({
      node: lineage(decoded.rebuiltFullPuzzleHash).nodes[1],
      puzzleAndSolution: {
        coin: {
          parent_coin_info: fixture.common.pool_coin.parent_coin_info,
          puzzle_hash: fixture.common.pool_coin.puzzle_hash,
          amount: fixture.common.pool_coin.amount,
        },
        puzzleReveal: fixture.true_redemption.expected.pool_coin_spend.puzzle_reveal,
        solution: fixture.true_redemption.expected.pool_coin_spend.solution,
      },
      conditions: {
        createPuzzleAnnouncements: [],
        createCoins: [],
        costMojos: 0n,
      },
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        PoolEconomicsV2ChainStateService,
        { provide: ChiaSingletonReaderService, useValue: singleton },
        { provide: ChiaWasmService, useValue: readyWasmStub() },
      ],
    });
    const service = TestBed.inject(PoolEconomicsV2ChainStateService);

    const evidence = await service.readCurrentState(fixture.common.pool_launcher_id);

    expect(evidence.kind).toBe('confirmed');
    if (evidence.kind !== 'confirmed') {
      throw new Error(`unexpected evidence ${evidence.kind}`);
    }
    expect(evidence.spendCaseLabel).toBe('V2_TRUE_REDEMPTION');
    expectDecodedState(evidence.previousState).toEqualFixture(fixture.common.state);
    expectDecodedState(evidence.state).toEqualFixture(fixture.true_redemption.expected.next_state);
    expect(evidence.rebuiltFullPuzzleHash).toBe(decoded.rebuiltFullPuzzleHash);
    expect(evidence.poolContext).toEqual({
      poolLauncherId: fixture.common.pool_launcher_id,
      poolCoin: {
        parentCoinInfo: fixture.common.pool_coin_id,
        puzzleHash: decoded.rebuiltFullPuzzleHash,
        amount: fixture.common.pool_coin.amount,
        coinId: b32('99'),
      },
      poolInnerPuzzleHex: decoded.rebuiltInnerPuzzleHex,
      lineageProof: {
        parentName: b32('10'),
        innerPuzzleHash: decoded.previousInnerPuzzleHash,
        amount: fixture.common.pool_coin.amount,
      },
    });
  });

  function clvm(): ClvmShape {
    return new (chiaSdk().Clvm)();
  }
});

function readyWasmStub(): Pick<ChiaWasmService, 'ready' | 'sdk'> {
  return {
    ready: () => true,
    sdk: () => chiaSdk(),
  } as unknown as Pick<ChiaWasmService, 'ready' | 'sdk'>;
}

function chiaSdk(): { Clvm: new () => ClvmShape } {
  const sdk = (window as typeof window & { ChiaSDK?: { Clvm?: new () => ClvmShape } })
    .ChiaSDK;
  if (!sdk?.Clvm) {
    throw new Error('Clvm unavailable');
  }
  return { Clvm: sdk.Clvm };
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

async function waitForChiaSdk(wasm: ChiaWasmService): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    wasm.probeReady();
    if ((window as typeof window & { ChiaSDK?: { Clvm?: new () => ClvmShape } }).ChiaSDK?.Clvm) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Chia WASM Clvm export did not initialise in test.');
}

function lineage(currentPuzzleHash: string): SingletonLineage {
  return {
    launcherId: fixture.common.pool_launcher_id,
    launcherCoinId: b32('10'),
    launcher: {
      coin: {
        parent_coin_info: b32('09'),
        puzzle_hash: b32('08'),
        amount: 1,
      },
      confirmed_block_index: 1,
      spent_block_index: 2,
      coinbase: false,
      timestamp: 1,
    },
    nodes: [
      {
        coinId: b32('10'),
        parentCoinId: b32('09'),
        puzzleHash: b32('08'),
        amount: 1,
        confirmedBlockIndex: 1,
        spentBlockIndex: 2,
        isLauncher: true,
      },
      {
        coinId: fixture.common.pool_coin_id,
        parentCoinId: b32('10'),
        puzzleHash: fixture.common.pool_coin.puzzle_hash,
        amount: fixture.common.pool_coin.amount,
        confirmedBlockIndex: 2,
        spentBlockIndex: 3,
        isLauncher: false,
      },
      {
        coinId: b32('99'),
        parentCoinId: fixture.common.pool_coin_id,
        puzzleHash: currentPuzzleHash,
        amount: fixture.common.pool_coin.amount,
        confirmedBlockIndex: 3,
        spentBlockIndex: null,
        isLauncher: false,
      },
    ],
  };
}

function expectDecodedState(state: {
  poolStatus: bigint;
  totalNavLockedMojos: bigint;
  deedCount: bigint;
  totalPoolTokenSupply: bigint;
  treasuryReserveTokens: bigint;
}) {
  return {
    toEqualFixture(expected: FixtureState): void {
      expect(state.poolStatus).toBe(1n);
      expect(state.totalNavLockedMojos).toBe(BigInt(expected.total_nav_locked_mojos));
      expect(state.deedCount).toBe(BigInt(expected.deed_count));
      expect(state.totalPoolTokenSupply).toBe(BigInt(expected.total_pool_token_supply));
      expect(state.treasuryReserveTokens).toBe(BigInt(expected.treasury_reserve_tokens));
    },
  };
}

function mutateLastNibble(hex: string): string {
  return `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;
}

function b32(byte: string): string {
  return `0x${byte.repeat(32)}`;
}
