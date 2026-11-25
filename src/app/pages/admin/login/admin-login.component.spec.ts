import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { AdminLoginComponent } from './admin-login.component';
import { AdminSessionService } from '../../../services/admin-session.service';
import { AdminBackendAuthService } from '../../../services/admin-backend-auth.service';
import { JourneyTelemetryService } from '../../../services/journey-telemetry.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';

describe('Administrator browser wallet selection', () => {
  let fixture: ComponentFixture<AdminLoginComponent>;
  const account = '0x' + '12'.repeat(20);
  const metamask = { request: jasmine.createSpy('MetaMask') };
  const other = { request: jasmine.createSpy('Other') };
  const ethereum = Object.getOwnPropertyDescriptor(window, 'ethereum');
  const announce = (provider: unknown, name: string) => window.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', { detail: { provider, info: {name} } })
  );
  const respond = () => { announce(other, 'Other wallet'); announce(metamask, 'MetaMask'); };
  function button(name: string): HTMLButtonElement {
    return Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button'))
      .find(el => el.textContent?.includes(name))!;
  }
  function expectReady() {
    fixture.detectChanges();
    expect(button('Continue securely')).toBeDefined();
    expect(TestBed.inject(EvmWalletService).address()?.toLowerCase()).toBe(account);
  }
  beforeEach(() => {
    other.request.calls.reset();
    metamask.request.calls.reset();
    other.request.and.returnValue(new Promise(() => {}));
    metamask.request.and.resolveTo([account]);
    Object.defineProperty(window, 'ethereum', { configurable: true, get: () => other });
    window.addEventListener('eip6963:requestProvider', respond);
    TestBed.configureTestingModule({ imports: [AdminLoginComponent], providers: [
      provideRouter([]),
      {provide: AdminSessionService, useValue: {isAuthenticated: () => false}},
      {provide: AdminBackendAuthService, useValue: {}},
      {provide: JourneyTelemetryService, useValue: {noteAssetFailure: () => {}}},
    ] });
    fixture = TestBed.createComponent(AdminLoginComponent);
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.destroy();
    window.removeEventListener('eip6963:requestProvider', respond);
    if (ethereum) Object.defineProperty(window, 'ethereum', ethereum);
    else Reflect.deleteProperty(window, 'ethereum');
  });

  it('returns an already signed-in administrator to the original committee review', () => {
    const route = TestBed.inject(ActivatedRoute);
    const session = TestBed.inject(AdminSessionService);
    const router = TestBed.inject(Router);
    const destination = '/committee#consent-title';
    route.snapshot.queryParams = {returnTo: destination};
    spyOn(session, 'isAuthenticated').and.returnValue(true);
    const navigate = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    const returned = TestBed.createComponent(AdminLoginComponent);
    expect(navigate).toHaveBeenCalledOnceWith(destination);
    returned.destroy();
  });

  it('uses the selected extension when another provider owns the read-only default', async () => {
    announce(metamask, 'MetaMask');
    announce({request: () => Promise.resolve([])}, 'Late wallet');
    fixture.detectChanges();
    expect(button('Late wallet')).toBeDefined();
    expect(fixture.componentInstance.browserWallets().length).toBe(3);
    button('MetaMask').click();
    await fixture.whenStable();
    expectReady();
    expect(metamask.request).toHaveBeenCalledOnceWith({method: 'eth_requestAccounts'});
    expect(other.request).not.toHaveBeenCalled();
  });

  it('ignores a late reply after the buyer picks another extension', fakeAsync(() => {
    let reply!: (accounts: string[]) => void;
    other.request.and.returnValue(new Promise(resolve => { reply = resolve; }));
    button('Other wallet').click();
    fixture.detectChanges();
    button('Choose another wallet').click();
    fixture.detectChanges();
    button('MetaMask').click();
    flushMicrotasks();
    reply(['0x' + '34'.repeat(20)]);
    flushMicrotasks();
    expectReady();
  }));

  it('restores the picker after a silent request and clears its waiting message', fakeAsync(() => {
    button('Other wallet').click();
    tick(45_001);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('did not respond');
    expect(fixture.nativeElement.querySelector('[role=status]')).toBeNull();
    expect(button('MetaMask').disabled).toBeFalse();
  }));

  it('identifies a disconnected provider without blaming administrator enrollment', async () => {
    metamask.request.and.rejectWith({code: 4900});
    button('MetaMask').click();
    await fixture.whenStable();
    fixture.detectChanges();
    const alert = fixture.nativeElement.querySelector('[role=alert]').textContent;
    expect(alert).toContain('MetaMask disconnected');
    expect(alert).not.toContain('enrolled');
  });
});
