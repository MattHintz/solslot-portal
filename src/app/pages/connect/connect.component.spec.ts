import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { ChiaWalletService } from '../../services/chia-wallet.service';
import { EvmWalletService } from '../../services/evm-wallet.service';
import { GoogleDriveVaultService } from '../../services/google-drive-vault.service';
import { VaultBackupCryptoService } from '../../services/vault-backup-crypto.service';
import { LastWalletKind, WalletUxStateService } from '../../services/wallet-ux-state.service';
import { environment } from '../../../environments/environment';
import { ConnectComponent } from './connect.component';

class MockChiaWalletService {
  private readonly _sageWalletConnectUri = signal<string | null>(null);
  private readonly _restoringSageWalletConnect = signal(false);
  readonly sageWalletConnectUri = this._sageWalletConnectUri.asReadonly();
  readonly restoringSageWalletConnect = this._restoringSageWalletConnect.asReadonly();

  hasGoby = jasmine.createSpy('hasGoby').and.returnValue(false);
  hasSage = jasmine.createSpy('hasSage').and.returnValue(false);
  hasSageWalletConnect = jasmine.createSpy('hasSageWalletConnect').and.returnValue(true);
  connectGoby = jasmine.createSpy('connectGoby').and.resolveTo(`0x${'11'.repeat(48)}`);
  connectSage = jasmine.createSpy('connectSage').and.resolveTo(`0x${'22'.repeat(48)}`);
  connectSageWalletConnect = jasmine
    .createSpy('connectSageWalletConnect')
    .and.resolveTo(`0x${'33'.repeat(48)}`);
  connectGoogle = jasmine
    .createSpy('connectGoogle')
    .and.returnValue(`0x${'44'.repeat(48)}`);
  disconnect = jasmine.createSpy('disconnect');

  setSageWalletConnectUri(uri: string | null): void {
    this._sageWalletConnectUri.set(uri);
  }

  setRestoringSageWalletConnect(restoring: boolean): void {
    this._restoringSageWalletConnect.set(restoring);
  }
}

class MockEvmWalletService {
  hasInjectedProvider = jasmine.createSpy('hasInjectedProvider').and.returnValue(false);
  connectInjected = jasmine.createSpy('connectInjected').and.resolveTo('0x1234');
  connectWalletConnect = jasmine.createSpy('connectWalletConnect').and.resolveTo('0x5678');
}

class MockGoogleDriveVaultService {
  loadBackup = jasmine.createSpy('loadBackup').and.resolveTo(null);
  createBackup = jasmine.createSpy('createBackup').and.resolveTo();
  replaceBackup = jasmine.createSpy('replaceBackup').and.resolveTo();
  disconnect = jasmine.createSpy('disconnect').and.resolveTo();
}

class MockVaultBackupCryptoService {
  readonly phrase = Array.from({ length: 24 }, (_, index) => `word${index + 1}`).join(' ');
  generateMnemonic = jasmine.createSpy('generateMnemonic').and.callFake(() => this.phrase);
  encrypt = jasmine.createSpy('encrypt').and.callFake(async (args: { publicKey: string }) => ({
    format: 'solslot-google-vault',
    version: 1,
    protocol: 'solslot-v2',
    network: 'testnet11',
    publicKey: args.publicKey,
    launcherId: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    derivation: { scheme: 'chia-all-unhardened', path: [12381, 8444, 2, 0], syntheticKeyVersion: 1 },
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 'salt' },
    cipher: { name: 'AES-GCM', iv: 'iv' },
    ciphertext: 'ciphertext',
  }));
  decrypt = jasmine.createSpy('decrypt');
}

class MockWalletUxStateService {
  private readonly _lastWalletKind = signal<LastWalletKind | null>(null);
  readonly lastWalletKind = this._lastWalletKind.asReadonly();
  setLastWalletKind = jasmine
    .createSpy('setLastWalletKind')
    .and.callFake((kind: LastWalletKind) => this._lastWalletKind.set(kind));
}

describe('ConnectComponent', () => {
  let fixture: ComponentFixture<ConnectComponent>;
  let component: ConnectComponent;
  let chia: MockChiaWalletService;
  let walletUx: MockWalletUxStateService;
  let router: jasmine.SpyObj<Router>;
  let originalGoogleVaultEnabled: boolean;

  beforeEach(async () => {
    originalGoogleVaultEnabled = environment.googleVaultEnabled;
    environment.googleVaultEnabled = true;
    chia = new MockChiaWalletService();
    walletUx = new MockWalletUxStateService();
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [ConnectComponent],
      providers: [
        { provide: ChiaWalletService, useValue: chia },
        { provide: EvmWalletService, useClass: MockEvmWalletService },
        { provide: GoogleDriveVaultService, useClass: MockGoogleDriveVaultService },
        { provide: VaultBackupCryptoService, useClass: MockVaultBackupCryptoService },
        { provide: WalletUxStateService, useValue: walletUx },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    environment.googleVaultEnabled = originalGoogleVaultEnabled;
  });

  it('falls back to Sage WalletConnect when no Chia extension is present', async () => {
    await component.connectChia();

    expect(chia.connectGoby).not.toHaveBeenCalled();
    expect(chia.connectSage).not.toHaveBeenCalled();
    expect(chia.connectSageWalletConnect).toHaveBeenCalledOnceWith();
    expect(walletUx.setLastWalletKind).toHaveBeenCalledOnceWith('chia');
    expect(router.navigate).toHaveBeenCalledOnceWith(['/create-vault'], {
      queryParams: { via: 'chia' },
    });
  });

  it('preserves an offer return target while routing into vault creation', async () => {
    component.returnTo.set('/offers/testnet-deed-001');

    await component.connectEvm();

    expect(walletUx.setLastWalletKind).toHaveBeenCalledOnceWith('evm');
    expect(router.navigate).toHaveBeenCalledOnceWith(['/create-vault'], {
      queryParams: {
        via: 'evm',
        returnTo: '/offers/testnet-deed-001',
      },
    });
  });

  it('surfaces the last-used wallet preference as a non-authoritative hint', async () => {
    expect(component.walletLabel('evm', 'Recommended')).toBe('Recommended');

    await component.connectChia();
    fixture.detectChanges();

    expect(component.walletLabel('chia', 'Advanced')).toBe('Last used');
  });

  it('creates, backs up, and routes a first-time Google BLS vault', async () => {
    await component.connectGoogle();

    expect(component.googleMode()).toBe('create');
    expect(component.mnemonicWords()).toHaveSize(24);
    component.confirmationWords = component.confirmationIndices.map(
      (index) => component.mnemonicWords()[index],
    );
    component.password = 'correct horse battery staple';
    component.confirmPassword = component.password;
    component.googleVaultRiskAcknowledged = true;
    const mnemonic = component.mnemonic();

    await component.createGoogleVault();

    expect(chia.connectGoogle).toHaveBeenCalledOnceWith(mnemonic);
    expect(walletUx.setLastWalletKind).toHaveBeenCalledWith('google');
    expect(router.navigate).toHaveBeenCalledWith(['/create-vault'], {
      queryParams: { via: 'google' },
    });
  });

  it('renders the Sage WalletConnect pairing link while approval is pending', () => {
    chia.setSageWalletConnectUri('wc:solslot-test-pairing');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Sage WalletConnect is waiting.');
    expect(text).toContain('Copy pairing link');
    expect(text).toContain('wc:solslot-test-pairing');
  });

  it('shows silent Sage WalletConnect restore progress before pairing', () => {
    component.busy.set(true);
    chia.setRestoringSageWalletConnect(true);
    chia.setSageWalletConnectUri(null);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Checking existing Sage session...');
    expect(text).not.toContain('Sage WalletConnect is waiting.');
  });

  it('cancels a pending Chia pairing without disconnecting other services', () => {
    component.busy.set(true);

    component.cancelChiaPairing();

    expect(chia.disconnect).toHaveBeenCalledOnceWith();
    expect(component.busy()).toBeFalse();
    expect(component.status()).toBe('');
  });
});
