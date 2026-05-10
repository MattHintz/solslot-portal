import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  AdminGenesisService,
  GenesisDeployResponse,
  GenesisDeploymentStatus,
} from '../../../services/admin-genesis.service';
import { AdminBootstrapService } from '../../../services/admin-bootstrap.service';
import { GenesisComponent } from './genesis.component';

describe('GenesisComponent', () => {
  let fixture: ComponentFixture<GenesisComponent>;
  let component: GenesisComponent;
  let genesis: jasmine.SpyObj<AdminGenesisService>;
  let bootstrap: jasmine.SpyObj<AdminBootstrapService>;

  beforeEach(async () => {
    genesis = jasmine.createSpyObj<AdminGenesisService>('AdminGenesisService', [
      'getDeployment',
      'dryRunProtocolDeploy',
      'deployProtocol',
    ]);
    bootstrap = jasmine.createSpyObj<AdminBootstrapService>('AdminBootstrapService', [
      'getBootstrapStatus',
      'startBootstrapSession',
    ]);

    await TestBed.configureTestingModule({
      imports: [GenesisComponent],
      providers: [
        provideRouter([]),
        { provide: AdminGenesisService, useValue: genesis },
        { provide: AdminBootstrapService, useValue: bootstrap },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GenesisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('states that base genesis does not create the first admin', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Genesis ceremony boundary');
    expect(text).toContain('genesis is not complete until first-admin authority is created and finalized');
    expect(text).toContain('one-shot token does not become protocol admin');
    expect(text).toContain('admin_authority_v2');
    expect(text).toContain('bind the selected wallet as admin slot 0');
  });

  it('keeps the manifest next step inside the same genesis ceremony', () => {
    component.deployResult.set({
      spend_bundle_id: null,
      pushed: false,
      manifest: { pool_launcher_id: '0x' + '11'.repeat(32) },
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Continue genesis: create first admin authority');
  });

  it('checks bootstrap status without sending the raw token', async () => {
    bootstrap.getBootstrapStatus.and.resolveTo({
      locked: false,
      authenticated: true,
      expires_at: 1234,
    });
    component.tokenInput.set(' genesis-token ');

    await component.checkBootstrapStatus();
    fixture.detectChanges();

    expect(bootstrap.getBootstrapStatus).toHaveBeenCalledOnceWith();
    expect(bootstrap.startBootstrapSession).not.toHaveBeenCalled();
    expect(component.bootstrapStatus()).toEqual({
      locked: false,
      authenticated: true,
      expires_at: 1234,
    });
    expect(fixture.nativeElement.textContent as string).toContain('Bootstrap session active');
  });

  it('starts bootstrap session with the in-memory token only', async () => {
    bootstrap.startBootstrapSession.and.resolveTo({ unlocked: true, expires_at: 5678 });
    component.tokenInput.set(' genesis-token ');

    await component.startBootstrapSession();
    fixture.detectChanges();

    expect(bootstrap.startBootstrapSession).toHaveBeenCalledOnceWith(' genesis-token ');
    expect(component.bootstrapStatus()).toEqual({
      locked: false,
      authenticated: true,
      expires_at: 5678,
    });
    expect(fixture.nativeElement.textContent as string).toContain('Bootstrap session active');
  });

  it('shows locked bootstrap state and blocks the first-admin next step', () => {
    component.bootstrapStatus.set({ locked: true, authenticated: false });
    component.deployResult.set({
      spend_bundle_id: null,
      pushed: false,
      manifest: { pool_launcher_id: '0x' + '11'.repeat(32) },
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Bootstrap finalized');
    expect(text).toContain('Bootstrapper locked after successful recordation');
    expect(text).toContain('admin_records.json');
    expect(text).toContain('portal_runtime_config.json');
    expect(text).toContain('bootstrap_manifest.json');
    expect(text).toContain('temporary bootstrap path is complete');
    expect(text).toContain('Permanent admin login');
    expect(text).toContain('Open Admin desk');
    expect(text).toContain('First-admin ceremony finalized');
    expect(text).toContain('Continue with permanent admin login');
    expect(text).not.toContain('Continue genesis: create first admin authority');
  });

  it('does not start a bootstrap session after finalization is known', async () => {
    component.bootstrapStatus.set({ locked: true, authenticated: false });
    component.tokenInput.set('genesis-token');
    fixture.detectChanges();

    await component.startBootstrapSession();

    expect(bootstrap.startBootstrapSession).not.toHaveBeenCalled();
    expect(component.bootstrapStatus()).toEqual({ locked: true, authenticated: false });
  });

  it('does not persist bootstrap status or post-finalize state in browser storage', async () => {
    const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: true, authenticated: false });

    await component.checkBootstrapStatus();
    fixture.detectChanges();

    expect(component.bootstrapLocked()).toBeTrue();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('checks the current deployment with the pasted token', async () => {
    const status: GenesisDeploymentStatus = { deployed: false, manifest: null };
    genesis.getDeployment.and.resolveTo(status);
    component.tokenInput.set(' genesis-token ');

    await component.checkDeployment();

    expect(genesis.getDeployment).toHaveBeenCalledOnceWith(' genesis-token ');
    expect(component.status()).toEqual(status);
    expect(component.deployResult()).toBeNull();
    expect(component.error()).toBeNull();
  });

  it('dry-runs genesis with parameter and optional coin inputs', async () => {
    const result: GenesisDeployResponse = {
      spend_bundle_id: null,
      pushed: false,
      manifest: { pool_launcher_id: '0x' + '11'.repeat(32) },
    };
    genesis.dryRunProtocolDeploy.and.resolveTo(result);
    component.tokenInput.set('genesis-token');
    component.quorumBpsInput.set(6000);
    component.feePerSpendInput.set(2);
    component.poolCoinIdInput.set(' 0x' + '22'.repeat(32) + ' ');

    await component.dryRun();

    expect(genesis.dryRunProtocolDeploy).toHaveBeenCalledOnceWith(
      'genesis-token',
      jasmine.objectContaining({
        quorum_bps: 6000,
        fee_per_spend: 2,
        pool_coin_id: '0x' + '22'.repeat(32),
      }),
    );
    expect(component.deployResult()).toEqual(result);
    expect(component.manifestJson()).toContain('pool_launcher_id');
  });

  it('does not deploy when the browser confirmation is canceled', async () => {
    spyOn(window, 'confirm').and.returnValue(false);
    component.tokenInput.set('genesis-token');

    await component.deploy();

    expect(genesis.deployProtocol).not.toHaveBeenCalled();
  });

  it('deploys genesis after browser confirmation', async () => {
    const result: GenesisDeployResponse = {
      spend_bundle_id: '0x' + 'aa'.repeat(32),
      pushed: true,
      manifest: { tracker_launcher_id: '0x' + '33'.repeat(32) },
    };
    spyOn(window, 'confirm').and.returnValue(true);
    genesis.deployProtocol.and.resolveTo(result);
    component.tokenInput.set('genesis-token');

    await component.deploy();

    expect(genesis.deployProtocol).toHaveBeenCalledOnceWith(
      'genesis-token',
      jasmine.objectContaining({
        quorum_bps: 5000,
        fee_per_spend: 0,
      }),
    );
    const request = genesis.deployProtocol.calls.mostRecent().args[1];
    expect(request).toBeDefined();
    expect(request?.dry_run).toBeUndefined();
    expect(component.deployResult()).toEqual(result);
    expect(component.error()).toBeNull();
  });
});
