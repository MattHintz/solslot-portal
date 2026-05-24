import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ChiaWasmService } from '../chia-wasm.service';
import { AdminAuthorityV2Service } from '../admin-authority-v2/admin-authority-v2.service';
import { ProtocolConfigLaunchService } from './protocol-config-launch.service';

describe('ProtocolConfigLaunchService', () => {
  let service: ProtocolConfigLaunchService;
  let singletonLaunch: jasmine.SpyObj<AdminAuthorityV2Service>;

  beforeAll(async () => {
    if (!(window as any).ChiaSDK) {
      // @ts-ignore — deep-import path; types come from chia_wallet_sdk_wasm.d.ts.
      const wasm = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
      const response = await fetch('/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm');
      const bytes = await response.arrayBuffer();
      const result = await WebAssembly.instantiate(bytes, {
        './chia_wallet_sdk_wasm_bg.js': wasm as unknown as WebAssembly.ModuleImports,
      });
      const setWasm = (wasm as unknown as { __wbg_set_wasm?: (w: WebAssembly.Exports) => void })
        .__wbg_set_wasm;
      if (typeof setWasm !== 'function') {
        throw new Error('chia_wallet_sdk_wasm_bg.js missing __wbg_set_wasm');
      }
      setWasm(result.instance.exports);
      (window as any).ChiaSDK = wasm;
    }
  });

  beforeEach(() => {
    singletonLaunch = jasmine.createSpyObj<AdminAuthorityV2Service>('AdminAuthorityV2Service', [
      'submitLaunch',
    ]);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ChiaWasmService,
        ProtocolConfigLaunchService,
        { provide: AdminAuthorityV2Service, useValue: singletonLaunch },
      ],
    });
    service = TestBed.inject(ProtocolConfigLaunchService);
    TestBed.inject(ChiaWasmService).probeReady();
  });

  it('computes deterministic A.3 content and inner puzzle hashes from launch inputs', () => {
    const preview = service.preview(validInputs());

    expect(preview.inputs.poolLauncherId).toBe(`0x${'11'.repeat(32)}`);
    expect(preview.inputs.governanceLauncherId).toBe(`0x${'22'.repeat(32)}`);
    expect(preview.inputs.network).toBe('testnet11');
    expect(preview.inputs.networkId).toBe(ProtocolConfigLaunchService.NETWORK_ID_TESTNET11);
    expect(preview.inputs.configVersion).toBe(1);
    expect(preview.protocolConfigModHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(preview.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(preview.eveInnerPuzzleHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('submits the A.3 singleton launch through the shared singleton launch path', async () => {
    singletonLaunch.submitLaunch.and.resolveTo({
      launcherId: `0x${'aa'.repeat(32)}`,
      launchOutputs: {
        launcherId: `0x${'aa'.repeat(32)}`,
        launcherCoin: {
          parentCoinInfo: `0x${'bb'.repeat(32)}`,
          puzzleHash: AdminAuthorityV2Service.SINGLETON_LAUNCHER_HASH,
          amount: 1n,
        },
        eveInnerPuzzleHash: `0x${'cc'.repeat(32)}`,
        eveFullPuzzleHash: `0x${'dd'.repeat(32)}`,
        eveCoin: {
          parentCoinInfo: `0x${'aa'.repeat(32)}`,
          puzzleHash: `0x${'dd'.repeat(32)}`,
          amount: 1n,
        },
        launcherAnnouncementMessage: `0x${'ee'.repeat(32)}`,
        launcherAnnouncementId: `0x${'ff'.repeat(32)}`,
      },
      pushResponse: { success: true, status: 'SUCCESS' },
      fullSpendBundle: { coinSpends: [], aggregatedSignature: `0x${'99'.repeat(96)}` },
    });

    const result = await service.submit(validInputs());

    expect(singletonLaunch.submitLaunch).toHaveBeenCalledOnceWith({
      eveInnerPuzzleHash: result.preview.eveInnerPuzzleHash,
      eveAmount: AdminAuthorityV2Service.DEFAULT_EVE_AMOUNT,
    });
    expect(result.launcherId).toBe(`0x${'aa'.repeat(32)}`);
    expect(result.preview.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  function validInputs() {
    return {
      poolLauncherId: `0x${'11'.repeat(32)}`,
      governanceLauncherId: `0x${'22'.repeat(32)}`,
      network: 'testnet11' as const,
      configVersion: 1,
      governancePubkey: `0x${'33'.repeat(48)}`,
    };
  }
});
