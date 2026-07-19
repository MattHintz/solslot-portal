import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService } from './coinset.service';
import { OfferDetail } from './offer-domain';
import { ACCEPT_OFFER_PROTOCOL_VECTOR } from './accept-offer-vector.fixture';
import {
  VaultAcceptOfferBuilderInput,
  VaultAcceptOfferSpendService,
} from './vault-accept-offer-spend.service';
import {
  clearVerifiedProtocolCoordinates,
  installVerifiedProtocolCoordinates,
} from './protocol-coordinate-guard';

const vector = ACCEPT_OFFER_PROTOCOL_VECTOR.inputs;
const expected = ACCEPT_OFFER_PROTOCOL_VECTOR.expected;
const VAULT_FULL_PUZZLE_HASH = '0xa2bb2ea372753afd6ca14fa41b5ad7026734e592bc5e8767a78121d9294c0d15';
const PACKAGE_VAULT_COIN_ID = '0xf9e8f5040908a65fca38bc57e44cdc38755fee161276e8b4875217a7d99614ac';
const PACKAGE_INNER_SOLUTION =
  '0xffa0f9e8f5040908a65fca38bc57e44cdc38755fee161276e8b4875217a7d99614acffa0a4a914044fb51307a52a3abcbbecaaa1cf5679d044f066ea931a61669c5549ecff01ff61ffffa0ddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddff830186a0ffa0ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccffa04444444444444444444444444444444444444444444444444444444444444444ffff8080ff8467748580ff808080';
const PACKAGE_INNER_TREE_HASH = '0x4861cc140d2bbdf773f2b7327e4617ee1ec0aa65335ae631a8180a007c0452da';
const PACKAGE_FULL_SOLUTION =
  '0xffffa02222222222222222222222222222222222222222222222222222222222222222ff0180ff01ffffa0f9e8f5040908a65fca38bc57e44cdc38755fee161276e8b4875217a7d99614acffa0a4a914044fb51307a52a3abcbbecaaa1cf5679d044f066ea931a61669c5549ecff01ff61ffffa0ddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddff830186a0ffa0ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccffa04444444444444444444444444444444444444444444444444444444444444444ffff8080ff8467748580ff80808080';
const BRIDGE_POLICY_HASH = '0x' + '66'.repeat(32);

const originalProtocol = { ...environment.solslotProtocol } as Record<string, unknown>;

const proofParams = {
  identityAttestRoot: vector.identityAttestRoot,
  attestationLeafHash: vector.attestationLeafHash,
  attestationProof: vector.attestationProof,
};

describe('VaultAcceptOfferSpendService', () => {
  let service: VaultAcceptOfferSpendService;

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
    Object.assign(environment.solslotProtocol as Record<string, unknown>, {
      poolLauncherId: vector.poolLauncherId,
      poolInnerPuzzleHash: vector.poolInnerPuzzleHash,
      bridgePolicyHash: BRIDGE_POLICY_HASH,
    });
    installProtocolCoordinates();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const wasmService = TestBed.inject(ChiaWasmService);
    wasmService.probeReady();
    service = TestBed.inject(VaultAcceptOfferSpendService);
  });

  afterEach(() => {
    clearVerifiedProtocolCoordinates();
    restoreProtocolEnvironment();
  });

  it('matches the protocol accept-offer inner solution vector', () => {
    const result = service.buildInnerSolution({
      vaultCoinId: vector.vaultCoinId,
      vaultInnerPuzzleHash: vector.vaultInnerPuzzleHash,
      vaultAmount: vector.vaultAmount,
      deedLauncherId: vector.deedLauncherId,
      tokenAmount: vector.tokenAmount,
      poolInnerPuzzleHash: vector.poolInnerPuzzleHash,
      attestationLeafHash: vector.attestationLeafHash,
      attestationProof: vector.attestationProof,
      currentTimestamp: vector.currentTimestamp,
      signatureData: vector.signatureData,
    });

    expect(result.serializedSolution).toBe(expected.serializedSolution);
    expect(result.solutionTreeHash).toBe(expected.solutionTreeHash);
  });

  it('builds an unsigned accept-offer spend package without backend signing', () => {
    const packageState = service.buildResolved(resolvedRequest());

    expect(packageState.status).toBe('unsigned');
    expect(packageState.backendSigning).toBeFalse();
    expect(packageState.spendCase).toBe('0x61');
    expect(packageState.unsignedSpendBundle.aggregatedSignature).toBeNull();
    expect(packageState.vaultCoin.coinId).toBe(PACKAGE_VAULT_COIN_ID);
    expect(packageState.vaultInnerPuzzleHash).toBe(vector.vaultInnerPuzzleHash);
    expect(packageState.vaultFullPuzzleHash).toBe(VAULT_FULL_PUZZLE_HASH);
    expect(packageState.acceptOfferInnerSolution).toBe(PACKAGE_INNER_SOLUTION);
    expect(packageState.acceptOfferInnerSolutionTreeHash).toBe(PACKAGE_INNER_TREE_HASH);
    expect(packageState.coinSpends.length).toBe(1);
    expect(packageState.coinSpends[0].coin).toEqual({
      parentCoinInfo: vector.vaultLauncherId,
      puzzleHash: VAULT_FULL_PUZZLE_HASH,
      amount: vector.vaultAmount,
    });
    expect(packageState.coinSpends[0].solution).toBe(PACKAGE_FULL_SOLUTION);
    expect(packageState.unsignedSpendBundle.coinSpends).toBe(packageState.coinSpends);
  });

  it('rejects malformed vault coin and offer artifact inputs before signing', () => {
    expect(() =>
      service.buildResolved(
        resolvedRequest({
          vaultCoin: { ...resolvedRequest().vaultCoin, coinId: '0x' + '12'.repeat(32) },
        }),
      ),
    ).toThrowError(/vault coin id/);

    expect(() =>
      service.buildResolved(
        resolvedRequest({
          offer: offer({ artifact: null }),
        }),
      ),
    ).toThrowError(/offer artifact/);

    installProtocolCoordinates({ poolInnerPuzzleHash: '0x' + '00'.repeat(32) });
    expect(() =>
      service.buildResolved(
        resolvedRequest({
          poolInnerPuzzleHash: '0x' + '00'.repeat(32),
        }),
      ),
    ).toThrowError(/poolInnerPuzzleHash must not be zero/);
  });

  it('rejects request-scoped pool launcher overrides when the protocol pin is configured', () => {
    expect(() =>
      service.buildResolved(
        resolvedRequest({
          poolLauncherId: '0x' + '12'.repeat(32),
        }),
      ),
    ).toThrowError(/pool launcher id builder input does not match pinned protocol coordinate/);
  });

  it('rejects request-scoped pool inner puzzle hash overrides when the protocol pin is configured', () => {
    installProtocolCoordinates({ poolInnerPuzzleHash: '0x' + '13'.repeat(32) });

    expect(() => service.buildResolved(resolvedRequest())).toThrowError(
      /pool inner puzzle hash builder input does not match pinned protocol coordinate/,
    );
  });

  it('rejects request-scoped bridge policy hash overrides when the protocol pin is configured', () => {
    installProtocolCoordinates({ bridgePolicyHash: '0x' + '14'.repeat(32) });

    expect(() => service.buildResolved(resolvedRequest())).toThrowError(
      /bridge policy hash builder input does not match pinned protocol coordinate/,
    );
  });

  it('rejects zero bridge policy hash before signing', () => {
    installProtocolCoordinates({ bridgePolicyHash: '0x' + '00'.repeat(32) });

    expect(() =>
      service.buildResolved(
        resolvedRequest({
          bridgePolicyHash: '0x' + '00'.repeat(32),
        }),
      ),
    ).toThrowError(/bridgePolicyHash must be pinned/);
  });

  it('rejects a current vault coin that no longer matches the previewed coin id', async () => {
    const singletonMock = jasmine.createSpyObj<ChiaSingletonReaderService>(
      'ChiaSingletonReaderService',
      ['walkLineage'],
    );
    singletonMock.walkLineage.and.resolveTo(lineage('0x' + 'ab'.repeat(32)));
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
    const chainService = TestBed.inject(VaultAcceptOfferSpendService);

    await expectAsync(chainService.buildFromChain(chainRequest())).toBeRejectedWithError(/current vault coin changed/);
    expect(coinsetMock.getPuzzleAndSolution).not.toHaveBeenCalled();
  });
});

function resolvedRequest(
  overrides: Partial<VaultAcceptOfferBuilderInput> = {},
): VaultAcceptOfferBuilderInput {
  return {
    vaultLauncherId: vector.vaultLauncherId,
    ownerPubkey: vector.ownerPubkey,
    authType: vector.authType,
    membersMerkleRoot: vector.membersMerkleRoot,
    poolLauncherId: vector.poolLauncherId,
    bridgePolicyHash: BRIDGE_POLICY_HASH,
    vaultCoin: {
      parentCoinInfo: vector.vaultLauncherId,
      puzzleHash: VAULT_FULL_PUZZLE_HASH,
      amount: vector.vaultAmount,
      coinId: PACKAGE_VAULT_COIN_ID,
    },
    lineageProof: {
      parentParentCoinInfo: '0x' + '22'.repeat(32),
      parentInnerPuzzleHash: null,
      parentAmount: 1,
    },
    offer: offer(),
    poolInnerPuzzleHash: vector.poolInnerPuzzleHash,
    currentTimestamp: vector.currentTimestamp,
    signatureData: vector.signatureData,
    ...proofParams,
    ...overrides,
  };
}

function chainRequest() {
  const { vaultCoin, lineageProof, ...rest } = resolvedRequest();
  void vaultCoin;
  void lineageProof;
  return {
    ...rest,
    vaultCoinId: PACKAGE_VAULT_COIN_ID,
  };
}

function offer(overrides: Partial<OfferDetail> = {}): OfferDetail {
  return {
    id: 'offer-vector',
    title: 'Vector offer',
    deedLauncherId: vector.deedLauncherId,
    state: 'OP:OFFER_READY',
    terms: {
      deedLauncherId: vector.deedLauncherId,
      tokenAmount: vector.tokenAmount,
      priceMojos: 1,
      acceptedAsset: 'xch',
      expiresAt: null,
    },
    artifact: {
      artifactId: 'artifact-vector',
      deedLauncherId: vector.deedLauncherId,
      artifactHash: null,
      rawOffer: null,
    },
    gatingPolicy: {
      requiresZkPassport: true,
    },
    ...overrides,
  };
}

function lineage(currentCoinId: string): SingletonLineage {
  return {
    launcherId: vector.vaultLauncherId,
    launcherCoinId: vector.vaultLauncherId,
    launcher: {
      coin: {
        parent_coin_info: '0x' + '22'.repeat(32),
        puzzle_hash: '0x' + '33'.repeat(32),
        amount: 1,
      },
      coinbase: false,
      confirmed_block_index: 1,
      spent_block_index: 2,
      timestamp: 1,
    },
    nodes: [
      {
        coinId: vector.vaultLauncherId,
        parentCoinId: '0x' + '22'.repeat(32),
        puzzleHash: '0x' + '33'.repeat(32),
        amount: 1,
        confirmedBlockIndex: 1,
        spentBlockIndex: 2,
        isLauncher: true,
      },
      {
        coinId: currentCoinId,
        parentCoinId: vector.vaultLauncherId,
        puzzleHash: VAULT_FULL_PUZZLE_HASH,
        amount: vector.vaultAmount,
        confirmedBlockIndex: 2,
        spentBlockIndex: null,
        isLauncher: false,
      },
    ],
  };
}

function restoreProtocolEnvironment(): void {
  const protocol = environment.solslotProtocol as Record<string, unknown>;
  for (const key of Object.keys(protocol)) {
    if (!(key in originalProtocol)) {
      delete protocol[key];
    }
  }
  Object.assign(protocol, originalProtocol);
}

function installProtocolCoordinates(
  overrides: Partial<{
    poolLauncherId: string;
    poolInnerPuzzleHash: string;
    bridgePolicyHash: string;
  }> = {},
): void {
  installVerifiedProtocolCoordinates({
    poolLauncherId: vector.poolLauncherId,
    poolInnerPuzzleHash: vector.poolInnerPuzzleHash,
    bridgePolicyHash: BRIDGE_POLICY_HASH,
    ...overrides,
  });
}
