import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AdminAuthorityV2Service } from '../../../services/admin-authority-v2/admin-authority-v2.service';
import { AdminBootstrapService } from '../../../services/admin-bootstrap.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import { ChiaWasmService } from '../../../services/chia-wasm.service';
import { Eip712LeafHashService } from '../../../services/eip712-leaf-hash.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { WalletCoinPickerService } from '../../../services/wallet-coin-picker.service';
import { LaunchAuthorityV2Component } from './launch-authority-v2.component';

describe('LaunchAuthorityV2Component bootstrap access UX', () => {
  let fixture: ComponentFixture<LaunchAuthorityV2Component>;
  let session: jasmine.SpyObj<Pick<AdminSessionService, 'isAuthenticated'>>;
  let bootstrap: jasmine.SpyObj<Pick<AdminBootstrapService, 'getBootstrapStatus'>>;

  beforeEach(async () => {
    session = jasmine.createSpyObj('AdminSessionService', ['isAuthenticated']);
    bootstrap = jasmine.createSpyObj('AdminBootstrapService', ['getBootstrapStatus']);

    await TestBed.configureTestingModule({
      imports: [LaunchAuthorityV2Component],
      providers: [
        provideRouter([]),
        { provide: AdminSessionService, useValue: session },
        { provide: AdminBootstrapService, useValue: bootstrap },
        { provide: ChiaWasmService, useValue: { ready: () => true } },
        {
          provide: ChiaWalletService,
          useValue: {
            isConnected: () => false,
            hasGoby: () => false,
            hasSage: () => false,
            connectionKind: () => null,
            pubkey: () => null,
          },
        },
        {
          provide: AdminAuthorityV2Service,
          useValue: {
            computeAdminsHash: () => new Uint8Array(32),
            computeStateHash: () => new Uint8Array(32),
            computeLaunchOutputs: () => null,
          },
        },
        { provide: EvmWalletService, useValue: {} },
        { provide: Eip712LeafHashService, useValue: {} },
        { provide: WalletCoinPickerService, useValue: {} },
      ],
    }).compileComponents();
  });

  async function create(): Promise<LaunchAuthorityV2Component> {
    fixture = TestBed.createComponent(LaunchAuthorityV2Component);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('shows permanent admin navigation without checking bootstrap status', async () => {
    session.isAuthenticated.and.returnValue(true);

    const component = await create();
    const text = fixture.nativeElement.textContent as string;

    expect(component.launchAccessMode()).toBe('permanent-admin');
    expect(bootstrap.getBootstrapStatus).not.toHaveBeenCalled();
    expect(text).toContain('← Admin desk');
    expect(text).not.toContain('Temporary bootstrap access');
  });

  it('shows temporary bootstrap warning for unlocked bootstrap access', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({
      locked: false,
      authenticated: true,
      expires_at: 1234,
    });

    const component = await create();
    const text = fixture.nativeElement.textContent as string;

    expect(component.launchAccessMode()).toBe('bootstrap');
    expect(bootstrap.getBootstrapStatus).toHaveBeenCalledOnceWith();
    expect(text).toContain('← Genesis bootstrap');
    expect(text).toContain('Temporary bootstrap access');
    expect(text).toContain('not permanent admin authority');
    expect(text).toContain('does not open the normal Admin Desk');
    expect(text).toContain('Bootstrap session expires at 1234');
  });

  it('shows locked bootstrap prompt when bootstrapper is locked', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: true, authenticated: false });

    const component = await create();
    const text = fixture.nativeElement.textContent as string;

    expect(component.launchAccessMode()).toBe('locked');
    expect(text).toContain('Bootstrap access unavailable');
    expect(text).toContain('The bootstrapper is locked');
  });

  it('shows missing bootstrap prompt when no bootstrap session is active', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: false, authenticated: false });

    const component = await create();
    const text = fixture.nativeElement.textContent as string;

    expect(component.launchAccessMode()).toBe('missing');
    expect(text).toContain('Bootstrap session unavailable');
    expect(text).toContain('Return to genesis to start or refresh the bootstrap session');
  });

  it('does not persist bootstrap credentials while checking access mode', async () => {
    const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: false, authenticated: true });

    await create();

    expect(setItem).not.toHaveBeenCalled();
  });
});
