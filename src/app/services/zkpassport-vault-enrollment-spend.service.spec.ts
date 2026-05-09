import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService } from './coinset.service';
import {
  ZkPassportVaultEnrollmentSpendService,
  ZkPassportVaultEnrollmentSpendPackage,
} from './zkpassport-vault-enrollment-spend.service';
import fixturesJson from './zkpassport-vault-enrollment.fixture.json';

interface FixtureFile {
  inputs: {
    validatorPubkeys: string[];
    threshold: number;
    signerIndices: number[];
    launcherParentId: string;
    vaultLauncherId: string;
    ownerPubkey: string;
    authType: number;
    membersMerkleRoot: string;
    poolLauncherId: string;
    bridgeParentId: string;
    bridgeAmount: number;
    newIdentityAttestRoot: string;
    attestationLeafHash: string;
    scopedNullifier: string;
    nullifierType: number;
    serviceScopeHash: string;
    serviceSubscopeHash: string;
    proofTimestamp: number;
    currentTimestamp: number;
  };
  expected: {
    bridgePolicyHash: string;
    bridgeCoinId: string;
    vaultInnerPuzzleHash: string;
    vaultFullPuzzleHash: string;
    vaultCoinId: string;
    bridgePuzzleReveal: string;
    bridgeSolution: string;
    vaultPuzzleReveal: string;
    vaultSolution: string;
    coinSpends: Array<{
      coin: {
        parentCoinInfo: string;
        puzzleHash: string;
        amount: number;
        coinId: string;
      };
      puzzleReveal: string;
      solution: string;
    }>;
    bundleCoinSpendOrder: string[];
  };
}

const fixtures = fixturesJson as FixtureFile;

describe('ZkPassportVaultEnrollmentSpendService', () => {
  let service: ZkPassportVaultEnrollmentSpendService;

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
    service = TestBed.inject(ZkPassportVaultEnrollmentSpendService);
  });

  it('matches the protocol driver fixture for unsigned bridge and vault enrollment spends', () => {
    const packageState = buildFixturePackage(service);
    expect(packageState.bridgePolicyHash).toBe(fixtures.expected.bridgePolicyHash);
    expect(packageState.bridgeCoin.coinId).toBe(fixtures.expected.bridgeCoinId);
    expect(packageState.vaultCoin.coinId).toBe(fixtures.expected.vaultCoinId);
    expect(packageState.vaultInnerPuzzleHash).toBe(fixtures.expected.vaultInnerPuzzleHash);
    expect(packageState.vaultFullPuzzleHash).toBe(fixtures.expected.vaultFullPuzzleHash);
    expect(packageState.expectedNextVaultCoin.parentCoinInfo).toBe(fixtures.expected.vaultCoinId);
    expect(packageState.expectedNextVaultCoin.puzzleHash).toBe(packageState.expectedNextVaultFullPuzzleHash);
    expect(packageState.expectedNextVaultCoin.coinId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(packageState.coinSpends[0].coin).toEqual({
      parentCoinInfo: fixtures.expected.coinSpends[0].coin.parentCoinInfo,
      puzzleHash: fixtures.expected.coinSpends[0].coin.puzzleHash,
      amount: fixtures.expected.coinSpends[0].coin.amount,
    });
    expect(packageState.coinSpends[0].puzzleReveal).toBe(fixtures.expected.bridgePuzzleReveal);
    expect(packageState.coinSpends[0].solution).toBe(fixtures.expected.bridgeSolution);
    expect(packageState.coinSpends[1].coin).toEqual({
      parentCoinInfo: fixtures.expected.coinSpends[1].coin.parentCoinInfo,
      puzzleHash: fixtures.expected.coinSpends[1].coin.puzzleHash,
      amount: fixtures.expected.coinSpends[1].coin.amount,
    });
    expect(packageState.coinSpends[1].puzzleReveal).toBe(fixtures.expected.vaultPuzzleReveal);
    expect(packageState.coinSpends[1].solution).toBe(fixtures.expected.vaultSolution);
    expect(packageState.coinSpends.map((spend) => spend.coin.parentCoinInfo === fixtures.inputs.bridgeParentId ? packageState.bridgeCoin.coinId : packageState.vaultCoin.coinId)).toEqual(fixtures.expected.bundleCoinSpendOrder);
    expect(packageState.unsignedSpendBundle.aggregatedSignature).toBeNull();
  });

  it('derives the current vault coin and eve lineage proof from singleton lineage', async () => {
    const lineage = fixtureLineage();
    const singletonMock = jasmine.createSpyObj<ChiaSingletonReaderService>(
      'ChiaSingletonReaderService',
      ['walkLineage'],
    );
    singletonMock.walkLineage.and.resolveTo(lineage);
    const coinsetMock = jasmine.createSpyObj<CoinsetService>('CoinsetService', ['getPuzzleAndSolution']);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ChiaSingletonReaderService, useValue: singletonMock },
        { provide: CoinsetService, useValue: coinsetMock },
      ],
    });
    const wasmService = TestBed.inject(ChiaWasmService);
    wasmService.probeReady();
    const chainService = TestBed.inject(ZkPassportVaultEnrollmentSpendService);
    const packageState = await chainService.buildFromChain(baseArgs());

    expect(singletonMock.walkLineage).toHaveBeenCalledWith(fixtures.inputs.vaultLauncherId);
    expect(coinsetMock.getPuzzleAndSolution).not.toHaveBeenCalled();
    expect(packageState.vaultCoin.coinId).toBe(fixtures.expected.vaultCoinId);
    expect(packageState.lineageProof).toEqual({
      parentParentCoinInfo: fixtures.inputs.launcherParentId,
      parentInnerPuzzleHash: null,
      parentAmount: 1,
    });
  });

  it('rejects a current vault coin that no longer matches the previewed coin id', async () => {
    const singletonMock = jasmine.createSpyObj<ChiaSingletonReaderService>(
      'ChiaSingletonReaderService',
      ['walkLineage'],
    );
    singletonMock.walkLineage.and.resolveTo(fixtureLineage('0x' + 'ab'.repeat(32)));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ChiaSingletonReaderService, useValue: singletonMock },
      ],
    });
    const wasmService = TestBed.inject(ChiaWasmService);
    wasmService.probeReady();
    const chainService = TestBed.inject(ZkPassportVaultEnrollmentSpendService);
    await expectAsync(chainService.buildFromChain(baseArgs())).toBeRejectedWithError(/current vault coin changed/);
  });
});

function buildFixturePackage(
  service: ZkPassportVaultEnrollmentSpendService,
): ZkPassportVaultEnrollmentSpendPackage {
  return service.buildResolved({
    ...baseArgs(),
    vaultCoin: fixtures.expected.coinSpends[1].coin,
    lineageProof: {
      parentParentCoinInfo: fixtures.inputs.launcherParentId,
      parentInnerPuzzleHash: null,
      parentAmount: 1,
    },
  });
}

function baseArgs() {
  return {
    vaultLauncherId: fixtures.inputs.vaultLauncherId,
    vaultCoinId: fixtures.expected.vaultCoinId,
    ownerPubkey: fixtures.inputs.ownerPubkey,
    authType: fixtures.inputs.authType,
    membersMerkleRoot: fixtures.inputs.membersMerkleRoot,
    poolLauncherId: fixtures.inputs.poolLauncherId,
    bridgePolicyHash: fixtures.expected.bridgePolicyHash,
    bridgeParentId: fixtures.inputs.bridgeParentId,
    bridgeAmount: fixtures.inputs.bridgeAmount,
    newIdentityAttestRoot: fixtures.inputs.newIdentityAttestRoot,
    attestationLeafHash: fixtures.inputs.attestationLeafHash,
    scopedNullifier: fixtures.inputs.scopedNullifier,
    nullifierType: fixtures.inputs.nullifierType,
    serviceScopeHash: fixtures.inputs.serviceScopeHash,
    serviceSubscopeHash: fixtures.inputs.serviceSubscopeHash,
    proofTimestamp: fixtures.inputs.proofTimestamp,
    currentTimestamp: fixtures.inputs.currentTimestamp,
    validatorPubkeys: fixtures.inputs.validatorPubkeys,
    validatorThreshold: fixtures.inputs.threshold,
    signerIndices: fixtures.inputs.signerIndices,
  };
}

function fixtureLineage(currentCoinId = fixtures.expected.vaultCoinId): SingletonLineage {
  return {
    launcherId: fixtures.inputs.vaultLauncherId,
    launcherCoinId: fixtures.inputs.vaultLauncherId,
    launcher: {
      coin: {
        parent_coin_info: fixtures.inputs.launcherParentId,
        puzzle_hash: '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9',
        amount: 1,
      },
      confirmed_block_index: 1,
      spent_block_index: 2,
      coinbase: false,
      timestamp: 1,
    },
    nodes: [
      {
        coinId: fixtures.inputs.vaultLauncherId,
        parentCoinId: fixtures.inputs.launcherParentId,
        puzzleHash: '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9',
        amount: 1,
        confirmedBlockIndex: 1,
        spentBlockIndex: 2,
        isLauncher: true,
      },
      {
        coinId: currentCoinId,
        parentCoinId: fixtures.inputs.vaultLauncherId,
        puzzleHash: fixtures.expected.vaultFullPuzzleHash,
        amount: 1,
        confirmedBlockIndex: 2,
        spentBlockIndex: null,
        isLauncher: false,
      },
    ],
  };
}
