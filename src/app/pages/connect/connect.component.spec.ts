import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { ChiaWalletService } from '../../services/chia-wallet.service';
import { EvmWalletService } from '../../services/evm-wallet.service';
import { LastWalletKind, WalletUxStateService } from '../../services/wallet-ux-state.service';
import { ConnectComponent } from './connect.component';

class MockChiaWalletService {
  private readonly _sageWalletConnectUri = signal<string | null>(null);
  readonly sageWalletConnectUri = this._sageWalletConnectUri.asReadonly();

  hasGoby = jasmine.createSpy('hasGoby').and.returnValue(false);
  hasSage = jasmine.createSpy('hasSage').and.returnValue(false);
  hasSageWalletConnect = jasmine.createSpy('hasSageWalletConnect').and.returnValue(true);
  connectGoby = jasmine.createSpy('connectGoby').and.resolveTo(`0x${'11'.repeat(48)}`);
  connectSage = jasmine.createSpy('connectSage').and.resolveTo(`0x${'22'.repeat(48)}`);
  connectSageWalletConnect = jasmine
    .createSpy('connectSageWalletConnect')
    .and.resolveTo(`0x${'33'.repeat(48)}`);
  disconnect = jasmine.createSpy('disconnect');

  setSageWalletConnectUri(uri: string | null): void {
    this._sageWalletConnectUri.set(uri);
  }
}

class MockEvmWalletService {
  hasInjectedProvider = jasmine.createSpy('hasInjectedProvider').and.returnValue(false);
  connectInjected = jasmine.createSpy('connectInjected').and.resolveTo('0x1234');
  connectWalletConnect = jasmine.createSpy('connectWalletConnect').and.resolveTo('0x5678');
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

  beforeEach(async () => {
    chia = new MockChiaWalletService();
    walletUx = new MockWalletUxStateService();
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [ConnectComponent],
      providers: [
        { provide: ChiaWalletService, useValue: chia },
        { provide: EvmWalletService, useClass: MockEvmWalletService },
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

  it('renders the Sage WalletConnect pairing link while approval is pending', () => {
    chia.setSageWalletConnectUri('wc:populis-test-pairing');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Sage WalletConnect is waiting.');
    expect(text).toContain('Copy pairing link');
    expect(text).toContain('wc:populis-test-pairing');
  });

  it('cancels a pending Chia pairing without disconnecting other services', () => {
    component.busy.set(true);

    component.cancelChiaPairing();

    expect(chia.disconnect).toHaveBeenCalledOnceWith();
    expect(component.busy()).toBeFalse();
    expect(component.status()).toBe('');
  });
});
