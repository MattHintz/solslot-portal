import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';

import { ChiaWalletService } from '../../../services/chia-wallet.service';
import { ChiaWasmService } from '../../../services/chia-wasm.service';
import {
  AdminProtocolConfigService,
  ProtocolConfigFinalizeResponse,
} from '../../../services/admin-protocol-config.service';
import { ProtocolInfo } from '../../../services/populis-api.service';
import {
  ProtocolConfigLaunchResult,
  ProtocolConfigLaunchService,
} from '../../../services/protocol-config/protocol-config-launch.service';
import { LaunchProtocolConfigComponent } from './launch-protocol-config.component';

describe('LaunchProtocolConfigComponent', () => {
  let fixture: ComponentFixture<LaunchProtocolConfigComponent>;
  let http: jasmine.SpyObj<{ get: (url: string) => Observable<ProtocolInfo> }>;
  let wallet: jasmine.SpyObj<ChiaWalletService>;
  let launch: jasmine.SpyObj<ProtocolConfigLaunchService>;
  let adminProtocolConfig: jasmine.SpyObj<AdminProtocolConfigService>;
  const walletConnected = signal(false);
  const walletPubkey = signal<string | null>(null);
  const walletConnectionKind = signal<'goby' | 'sage' | 'sage-walletconnect' | null>(null);
  const sageWalletConnectUri = signal<string | null>(null);

  beforeEach(async () => {
    http = jasmine.createSpyObj('HttpClient', ['get']);
    http.get.and.returnValue(of(protocolWithoutA3()));
    wallet = jasmine.createSpyObj<ChiaWalletService>('ChiaWalletService', [
      'hasGoby',
      'hasSage',
      'connectGoby',
      'connectSage',
      'connectSageWalletConnect',
    ], {
      isConnected: walletConnected.asReadonly(),
      pubkey: walletPubkey.asReadonly(),
      connectionKind: walletConnectionKind.asReadonly(),
      sageWalletConnectUri: sageWalletConnectUri.asReadonly(),
    });
    wallet.hasGoby.and.returnValue(true);
    wallet.hasSage.and.returnValue(true);
    wallet.connectGoby.and.callFake(async () => {
      walletConnected.set(true);
      walletPubkey.set(`0x${'33'.repeat(48)}`);
      walletConnectionKind.set('goby');
      return `0x${'33'.repeat(48)}`;
    });
    launch = jasmine.createSpyObj<ProtocolConfigLaunchService>('ProtocolConfigLaunchService', [
      'preview',
      'submit',
    ]);
    launch.preview.and.returnValue({
      protocolConfigModHash: `0x${'44'.repeat(32)}`,
      contentHash: `0x${'55'.repeat(32)}`,
      eveInnerPuzzleHash: `0x${'66'.repeat(32)}`,
      inputs: {
        poolLauncherId: `0x${'11'.repeat(32)}`,
        governanceLauncherId: `0x${'22'.repeat(32)}`,
        network: 'testnet11',
        networkId: `0x${'77'.repeat(32)}`,
        configVersion: 1,
        governancePubkey: `0x${'33'.repeat(48)}`,
      },
    });
    launch.submit.and.resolveTo(submittedResult());
    adminProtocolConfig = jasmine.createSpyObj<AdminProtocolConfigService>(
      'AdminProtocolConfigService',
      ['finalizeProtocolConfig'],
    );
    adminProtocolConfig.finalizeProtocolConfig.and.resolveTo(finalizeResult());

    await TestBed.configureTestingModule({
      imports: [LaunchProtocolConfigComponent],
      providers: [
        provideRouter([]),
        { provide: HttpClient, useValue: http },
        { provide: ChiaWalletService, useValue: wallet },
        { provide: ChiaWasmService, useValue: { ready: signal(true).asReadonly() } },
        { provide: ProtocolConfigLaunchService, useValue: launch },
        { provide: AdminProtocolConfigService, useValue: adminProtocolConfig },
      ],
    }).compileComponents();

    walletConnected.set(false);
    walletPubkey.set(null);
    walletConnectionKind.set(null);
    sageWalletConnectUri.set(null);
    fixture = TestBed.createComponent(LaunchProtocolConfigComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('prefills A.3 inputs from /protocol and explains the launch flow', () => {
    const component = fixture.componentInstance;
    component.governancePubkeyInput.set(`0x${'33'.repeat(48)}`);
    fixture.detectChanges();
    const text = normalizeText(fixture.nativeElement.textContent as string);

    expect(http.get).toHaveBeenCalled();
    expect(component.poolLauncherIdInput()).toBe(`0x${'11'.repeat(32)}`);
    expect(component.governanceLauncherIdInput()).toBe(`0x${'22'.repeat(32)}`);
    expect(component.networkInput()).toBe('testnet11');
    expect(component.configVersionInput()).toBe(1);
    expect(text).toContain('Launch protocol config');
    expect(text).toContain('Before you launch');
    expect(text).toContain('Connect the Chia wallet that will fund the one-mojo singleton launcher.');
    expect(text).toContain('Content hash');
    expect(text).toContain('Launch A.3 on chain');
  });

  it('uses the connected Chia wallet pubkey as governance key and submits after confirmation', async () => {
    const component = fixture.componentInstance;

    await component.connectChia('goby');
    component.useConnectedGovernanceKey();
    component.operatorConfirmed.set(true);
    fixture.detectChanges();

    expect(component.governancePubkeyInput()).toBe(`0x${'33'.repeat(48)}`);
    expect(component.canSubmit()).toBeTrue();

    await component.submitLaunch();
    fixture.detectChanges();
    const text = normalizeText(fixture.nativeElement.textContent as string);

    expect(launch.submit).toHaveBeenCalledOnceWith({
      poolLauncherId: `0x${'11'.repeat(32)}`,
      governanceLauncherId: `0x${'22'.repeat(32)}`,
      network: 'testnet11',
      configVersion: 1,
      governancePubkey: `0x${'33'.repeat(48)}`,
    });
    expect(text).toContain('A.3 launch submitted');
    expect(text).toContain(`POPULIS_PROTOCOL_CONFIG_LAUNCHER_ID=0x${'aa'.repeat(32)}`);
    expect(text).toContain('Finalize API configuration');
  });

  it('finalizes the API A.3 env after a successful launch', async () => {
    const component = fixture.componentInstance;

    await component.connectChia('goby');
    component.useConnectedGovernanceKey();
    component.operatorConfirmed.set(true);
    await component.submitLaunch();
    component.finalizeAdminTokenInput.set('operator-token');

    expect(component.canFinalizeApiConfig()).toBeTrue();
    await component.finalizeApiConfig();
    fixture.detectChanges();

    expect(adminProtocolConfig.finalizeProtocolConfig).toHaveBeenCalledOnceWith(
      'operator-token',
      `0x${'aa'.repeat(32)}`,
    );
    expect(component.finalizedConfig()?.protocol_config_launcher_id).toBe(`0x${'aa'.repeat(32)}`);
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(normalizeText(fixture.nativeElement.textContent as string)).toContain(
      'API finalize complete',
    );
  });

  it('shows the Sage WalletConnect pairing URI while approval is pending', () => {
    sageWalletConnectUri.set('wc:populis-test-pairing');
    fixture.detectChanges();

    const text = normalizeText(fixture.nativeElement.textContent as string);

    expect(text).toContain('Sage WalletConnect is waiting.');
    expect(text).toContain('Copy pairing URI');
    expect(text).toContain('Cancel');
    expect(text).toContain('wc:populis-test-pairing');
  });

  it('cancels a pending Sage WalletConnect pairing from the A.3 wizard', () => {
    wallet.disconnect = jasmine.createSpy('disconnect');
    fixture.componentInstance.connectingChia.set('sage-walletconnect');

    fixture.componentInstance.cancelSagePairing();

    expect(wallet.disconnect).toHaveBeenCalledOnceWith();
    expect(fixture.componentInstance.connectingChia()).toBeNull();
  });
});

function protocolWithoutA3(): ProtocolInfo {
  return {
    network: 'testnet11',
    pool_launcher_id: `0x${'11'.repeat(32)}`,
    governance_launcher_id: `0x${'22'.repeat(32)}`,
    vault_inner_mod_hash: `0x${'99'.repeat(32)}`,
    eip712_domain: { name: 'Populis', version: '1', chainId: 11 },
    eip712_typehash_string: 'VaultRegistration(address wallet)',
    faucet_address: null,
    faucet_balance_mojos: null,
    deployed: false,
    deployment_manifest: null,
    protocol_config_hash: `0x${'55'.repeat(32)}`,
    protocol_config_launcher_id: null,
    protocol_config_version: 1,
    property_registry_launcher_id: null,
    property_registry_mod_hash: null,
    mint_proposal_mod_hash: null,
  };
}

function submittedResult(): ProtocolConfigLaunchResult {
  return {
    preview: {
      protocolConfigModHash: `0x${'44'.repeat(32)}`,
      contentHash: `0x${'55'.repeat(32)}`,
      eveInnerPuzzleHash: `0x${'66'.repeat(32)}`,
      inputs: {
        poolLauncherId: `0x${'11'.repeat(32)}`,
        governanceLauncherId: `0x${'22'.repeat(32)}`,
        network: 'testnet11',
        networkId: `0x${'77'.repeat(32)}`,
        configVersion: 1,
        governancePubkey: `0x${'33'.repeat(48)}`,
      },
    },
    launcherId: `0x${'aa'.repeat(32)}`,
    launchOutputs: {
      launcherId: `0x${'aa'.repeat(32)}`,
      launcherCoin: {
        parentCoinInfo: `0x${'bb'.repeat(32)}`,
        puzzleHash: `0x${'cc'.repeat(32)}`,
        amount: 1n,
      },
      eveInnerPuzzleHash: `0x${'66'.repeat(32)}`,
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
    fullSpendBundle: { coinSpends: [], aggregatedSignature: `0x${'88'.repeat(96)}` },
  };
}

function finalizeResult(): ProtocolConfigFinalizeResponse {
  return {
    updated: true,
    env_file_path: '.env',
    previous_protocol_config_launcher_id: null,
    protocol_config_launcher_id: `0x${'aa'.repeat(32)}`,
    protocol_config_hash: `0x${'55'.repeat(32)}`,
    protocol_config_version: 1,
    network: 'testnet11',
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
