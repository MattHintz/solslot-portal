import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ChiaWalletService } from '../chia-wallet.service';
import { ChiaWasmService } from '../chia-wasm.service';
import { CommitteeApiService } from '../committee-api.service';
import {
  GovernanceTrackerReaderService,
  OpenStateVoteInputs,
} from '../governance-tracker-reader.service';
import { CommitteeVoteRunnerService } from './committee-vote-runner.service';
import { PgtCoinDiscoveryService } from './pgt-coin-discovery.service';
import { PgtDriverService } from './pgt-driver.service';
import { PgtVoteSpendBuilderService } from './pgt-vote-spend-builder.service';
import { environment } from '../../../environments/environment';

const VOTER_PH = '0x' + 'dd'.repeat(32);
const PROPOSAL = '0x' + 'ee'.repeat(32);
const TRACKER_LAUNCHER = '0x' + 'bb'.repeat(32);

function openInputs(): OpenStateVoteInputs {
  return {
    trackerCoin: {
      parentCoinInfo: '0x' + '11'.repeat(32),
      puzzleHash: '0x' + '22'.repeat(32),
      amount: 1,
    },
    trackerInnerPuzzleHex: '0xff80',
    lineageProof: {
      parentName: '0x' + '33'.repeat(32),
      innerPuzzleHash: '0x' + '44'.repeat(32),
      amount: 1,
    },
    proposalHash: PROPOSAL,
    deadlineSeconds: BigInt(2_000_000_000),
  };
}

function makeMockedRunner(overrides: {
  pubkey?: string | null;
  voteInputs?: OpenStateVoteInputs | null;
  discoverKind?: 'found' | 'no-coins' | 'pgt-not-deployed' | 'governance-not-deployed';
  coins?: Array<{ parentCoinInfo: string; puzzleHash: string; amount: number; confirmedBlockIndex: number }>;
  signSpendBundleImpl?: jasmine.Spy;
  castVoteImpl?: jasmine.Spy;
  buildPgtLockImpl?: jasmine.Spy;
  buildTrackerVoteImpl?: jasmine.Spy;
}): {
  service: CommitteeVoteRunnerService;
  wallet: ChiaWalletService;
  tracker: GovernanceTrackerReaderService;
  discovery: PgtCoinDiscoveryService;
  builder: PgtVoteSpendBuilderService;
  api: CommitteeApiService;
} {
  const wallet = {
    pubkey: () => overrides.pubkey ?? null,
    signSpendBundle:
      overrides.signSpendBundleImpl ??
      jasmine.createSpy('signSpendBundle').and.resolveTo({
        coinSpends: [],
        aggregatedSignature: '0x' + 'a0'.repeat(96),
      }),
  } as unknown as ChiaWalletService;

  const wasm = {
    sdk: () => ({
      Clvm: class {
        createCoin() {
          return {};
        }
        delegatedSpend() {
          return {
            puzzle: { serialize: () => new Uint8Array([0x01]) },
            solution: { serialize: () => new Uint8Array([0x80]) },
          };
        }
        standardSpend() {
          return {
            puzzle: { serialize: () => new Uint8Array([0x01]) },
            solution: { serialize: () => new Uint8Array([0x80]) },
          };
        }
      },
      Coin: class {},
      PublicKey: { fromBytes: () => ({}) },
      standardPuzzleHash: () => new Uint8Array(32).fill(0xdd),
    }),
  } as unknown as ChiaWasmService;

  const tracker = {
    getOpenStateVoteInputs: jasmine
      .createSpy('getOpenStateVoteInputs')
      .and.resolveTo(
        'voteInputs' in overrides ? overrides.voteInputs : openInputs(),
      ),
  } as unknown as GovernanceTrackerReaderService;

  const discoveryResult =
    overrides.discoverKind === 'pgt-not-deployed'
      ? { kind: 'pgt-not-deployed' as const }
      : overrides.discoverKind === 'governance-not-deployed'
        ? { kind: 'governance-not-deployed' as const }
        : overrides.discoverKind === 'no-coins'
          ? { kind: 'no-coins' as const, catPgtFreePuzzleHash: '0x' + 'ff'.repeat(32) }
          : {
              kind: 'found' as const,
              catPgtFreePuzzleHash: '0x' + 'ff'.repeat(32),
              coins: overrides.coins ?? [
                {
                  parentCoinInfo: '0x' + '55'.repeat(32),
                  puzzleHash: '0x' + 'ff'.repeat(32),
                  amount: 1000,
                  confirmedBlockIndex: 1,
                },
              ],
              totalMojos: BigInt(1000),
            };

  const discovery = {
    discover: jasmine.createSpy('discover').and.resolveTo(discoveryResult),
  } as unknown as PgtCoinDiscoveryService;

  const builder = {
    buildPgtLockCoinSpend:
      overrides.buildPgtLockImpl ??
      jasmine.createSpy('buildPgtLockCoinSpend').and.returnValue({
        coin: {
          parentCoinInfo: '0x' + '55'.repeat(32),
          puzzleHash: '0x' + 'ff'.repeat(32),
          amount: 1000,
        },
        puzzleReveal: '0xff01',
        solution: '0xff80',
      }),
    buildTrackerVoteCoinSpend:
      overrides.buildTrackerVoteImpl ??
      jasmine.createSpy('buildTrackerVoteCoinSpend').and.returnValue({
        coin: openInputs().trackerCoin,
        puzzleReveal: '0xff01',
        solution: '0xff80',
      }),
  } as unknown as PgtVoteSpendBuilderService;

  const api = {
    castVote:
      overrides.castVoteImpl ??
      jasmine.createSpy('castVote').and.resolveTo({
        pushed: true,
        status: 'SUCCESS',
        spendBundleId: '0x' + 'bb'.repeat(32),
      }),
  } as unknown as CommitteeApiService;

  // PgtDriverService's tree-hash helpers depend on real WASM treeHashAtom
  // exports.  The runner only uses three of them (trackerStructHash,
  // pgtLockedInnerHash, pgtTailHash) as orchestration glue — stub them
  // to return arbitrary 32-byte arrays so the spec stays focused on
  // orchestration.  Hash correctness is asserted by the PgtDriverService
  // spec instead.
  const pgt = {
    trackerStructHash: jasmine
      .createSpy('trackerStructHash')
      .and.returnValue(new Uint8Array(32).fill(0x10)),
    pgtLockedInnerHash: jasmine
      .createSpy('pgtLockedInnerHash')
      .and.returnValue(new Uint8Array(32).fill(0x20)),
    pgtTailHash: jasmine
      .createSpy('pgtTailHash')
      .and.returnValue(new Uint8Array(32).fill(0x30)),
  } as unknown as PgtDriverService;

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ChiaWalletService, useValue: wallet },
      { provide: ChiaWasmService, useValue: wasm },
      { provide: GovernanceTrackerReaderService, useValue: tracker },
      { provide: PgtCoinDiscoveryService, useValue: discovery },
      { provide: PgtDriverService, useValue: pgt },
      { provide: PgtVoteSpendBuilderService, useValue: builder },
      { provide: CommitteeApiService, useValue: api },
    ],
  });

  const service = TestBed.inject(CommitteeVoteRunnerService);
  return { service, wallet, tracker, discovery, builder, api };
}

describe('CommitteeVoteRunnerService', () => {
  let originalPgtTailGenesisCoinId: string;

  beforeEach(() => {
    originalPgtTailGenesisCoinId =
      environment.populisProtocol.pgtTailGenesisCoinId;
    (
      environment.populisProtocol as { pgtTailGenesisCoinId: string }
    ).pgtTailGenesisCoinId = '0x' + 'a0'.repeat(32);
  });

  afterEach(() => {
    (
      environment.populisProtocol as { pgtTailGenesisCoinId: string }
    ).pgtTailGenesisCoinId = originalPgtTailGenesisCoinId;
  });

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
    if (typeof setWasm === 'function') setWasm(result.instance.exports);
    (window as unknown as { ChiaSDK: unknown }).ChiaSDK = wasmExports;
  });

  it("rejects non-positive vote amount", async () => {
    const { service } = makeMockedRunner({ pubkey: '0x' + 'a0'.repeat(48) });
    const res = await service.castVote({ additionalVoteAmount: BigInt(0) });
    expect(res.kind).toBe('invalid-input');
  });

  it("returns 'wallet-not-connected' when no pubkey", async () => {
    const { service } = makeMockedRunner({ pubkey: null });
    const res = await service.castVote({ additionalVoteAmount: BigInt(100) });
    expect(res.kind).toBe('wallet-not-connected');
  });

  it("returns 'tracker-not-open' when tracker is not OPEN", async () => {
    const { service } = makeMockedRunner({
      pubkey: '0x' + 'a0'.repeat(48),
      voteInputs: null,
    });
    const res = await service.castVote({ additionalVoteAmount: BigInt(100) });
    expect(res.kind).toBe('tracker-not-open');
  });

  it("returns 'no-pgt-coins' when discovery surfaces no-coins", async () => {
    const { service } = makeMockedRunner({
      pubkey: '0x' + 'a0'.repeat(48),
      discoverKind: 'no-coins',
    });
    const res = await service.castVote({ additionalVoteAmount: BigInt(100) });
    expect(res.kind).toBe('no-pgt-coins');
  });

  it("returns 'no-coin-matches-vote-amount' when no coin equals vote amount", async () => {
    const { service } = makeMockedRunner({
      pubkey: '0x' + 'a0'.repeat(48),
      coins: [
        {
          parentCoinInfo: '0x' + '55'.repeat(32),
          puzzleHash: '0x' + 'ff'.repeat(32),
          amount: 999,
          confirmedBlockIndex: 1,
        },
      ],
    });
    const res = await service.castVote({ additionalVoteAmount: BigInt(1000) });
    expect(res.kind).toBe('no-coin-matches-vote-amount');
    if (res.kind === 'no-coin-matches-vote-amount') {
      expect(res.availableAmounts).toEqual([999]);
      expect(res.requestedAmount).toBe(BigInt(1000));
    }
  });

  it('happy path: signs the bundle and POSTs to the committee API', async () => {
    const apiSpy = jasmine.createSpy('castVote').and.resolveTo({
      pushed: true,
      status: 'SUCCESS',
      spendBundleId: '0x' + 'bb'.repeat(32),
    });
    const signSpy = jasmine.createSpy('signSpendBundle').and.resolveTo({
      coinSpends: [
        {
          coin: {
            parentCoinInfo: '0x' + '55'.repeat(32),
            puzzleHash: '0x' + 'ff'.repeat(32),
            amount: 1000,
          },
          puzzleReveal: '0xff01',
          solution: '0xff80',
        },
      ],
      aggregatedSignature: '0x' + 'a0'.repeat(96),
    });
    const { service } = makeMockedRunner({
      pubkey: '0x' + 'a0'.repeat(48),
      signSpendBundleImpl: signSpy,
      castVoteImpl: apiSpy,
    });
    const res = await service.castVote({ additionalVoteAmount: BigInt(1000) });
    expect(res.kind).toBe('submitted');
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(apiSpy).toHaveBeenCalledTimes(1);
    if (res.kind === 'submitted') {
      expect(res.apiResponse.pushed).toBe(true);
      expect(res.pickedCoin.amount).toBe(1000);
    }
    // The API call must have passed the proposalHash for logging.
    const [bundleArg, proposalArg] = apiSpy.calls.mostRecent().args;
    expect(proposalArg).toBe(PROPOSAL);
    expect(bundleArg.coin_spends.length).toBe(1);
    expect(bundleArg.aggregated_signature).toBe('0x' + 'a0'.repeat(96));
  });

  it('passes the largest matching coin to the spend builder', async () => {
    const buildSpy = jasmine.createSpy('buildPgtLockCoinSpend').and.returnValue({
      coin: { parentCoinInfo: '0x' + '55'.repeat(32), puzzleHash: '0x' + 'ff'.repeat(32), amount: 1000 },
      puzzleReveal: '0xff01',
      solution: '0xff80',
    });
    const { service } = makeMockedRunner({
      pubkey: '0x' + 'a0'.repeat(48),
      coins: [
        { parentCoinInfo: '0x' + '55'.repeat(32), puzzleHash: '0x' + 'ff'.repeat(32), amount: 500, confirmedBlockIndex: 1 },
        { parentCoinInfo: '0x' + '66'.repeat(32), puzzleHash: '0x' + 'ff'.repeat(32), amount: 1000, confirmedBlockIndex: 2 },
      ],
      buildPgtLockImpl: buildSpy,
    });
    await service.castVote({ additionalVoteAmount: BigInt(1000) });
    expect(buildSpy).toHaveBeenCalledTimes(1);
    const passed = buildSpy.calls.mostRecent().args[0];
    expect(passed.pgtCoin.amount).toBe(1000);
  });

  it("surfaces 'spend-builder-failed' when builder throws", async () => {
    const failing = jasmine.createSpy('buildPgtLockCoinSpend').and.throwError(
      new Error('does not match coin\'s claimed puzzle hash'),
    );
    const { service } = makeMockedRunner({
      pubkey: '0x' + 'a0'.repeat(48),
      buildPgtLockImpl: failing,
    });
    const res = await service.castVote({ additionalVoteAmount: BigInt(1000) });
    expect(res.kind).toBe('spend-builder-failed');
    if (res.kind === 'spend-builder-failed') {
      expect(res.error).toMatch(/does not match/);
    }
  });
});
