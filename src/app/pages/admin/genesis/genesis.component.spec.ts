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

  it('presents genesis as the pre-software story mode', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Populis · Story mode · Act I');
    expect(text).toContain('Let there be genesis.');
    expect(text).toContain('This software is in ceremony mode');
    expect(text).toContain('rest of Populis opens');
    expect(text).toContain('Ceremony boundary');
    expect(text).toContain('one-shot token only unlocks Genesis');
    expect(text).toContain('admin_authority_v2');
    expect(text).toContain('admin slot 0');
    expect(text).toContain('Chapter 1');
    expect(text).toContain('Chapter 4');
  });

  it('keeps the first-admin next step gated by deployed base and active genesis session', () => {
    component.deployResult.set({
      spend_bundle_id: null,
      pushed: true,
      manifest: { pool_launcher_id: '0x' + '11'.repeat(32) },
    });
    component.bootstrapStatus.set({
      locked: false,
      authenticated: true,
      expires_at: 1234,
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Continue Act II: bind admin slot 0');
  });

  it('does not send the operator to first-admin authority after dry-run only', () => {
    component.deployResult.set({
      spend_bundle_id: null,
      pushed: false,
      manifest: { pool_launcher_id: '0x' + '11'.repeat(32) },
    });
    component.bootstrapStatus.set({
      locked: false,
      authenticated: true,
      expires_at: 1234,
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Dry-run manifest computed');
    expect(text).not.toContain('Continue Act II: bind admin slot 0');
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
    expect(fixture.nativeElement.textContent as string).toContain('Genesis session active');
    expect(component.actionMessage()).toContain('Genesis session active');
  });

  it('starts bootstrap session with the in-memory token only and verifies the cookie', async () => {
    bootstrap.startBootstrapSession.and.resolveTo({ unlocked: true, expires_at: 5678 });
    bootstrap.getBootstrapStatus.and.resolveTo({
      locked: false,
      authenticated: true,
      expires_at: 5678,
    });
    component.tokenInput.set(' genesis-token ');

    await component.startBootstrapSession();
    fixture.detectChanges();

    expect(bootstrap.startBootstrapSession).toHaveBeenCalledOnceWith(' genesis-token ');
    expect(bootstrap.getBootstrapStatus).toHaveBeenCalledOnceWith();
    expect(component.bootstrapStatus()).toEqual({
      locked: false,
      authenticated: true,
      expires_at: 5678,
    });
    expect(fixture.nativeElement.textContent as string).toContain('Genesis session active');
    expect(component.bootstrapCookieWarning()).toBeNull();
  });

  it('warns when the bootstrap token is accepted but the cookie is not retained', async () => {
    bootstrap.startBootstrapSession.and.resolveTo({ unlocked: true, expires_at: 5678 });
    bootstrap.getBootstrapStatus.and.resolveTo({
      locked: false,
      authenticated: false,
      expires_at: null,
    });
    component.tokenInput.set(' genesis-token ');

    await component.startBootstrapSession();
    fixture.detectChanges();

    expect(component.bootstrapStatus()).toEqual({
      locked: false,
      authenticated: false,
      expires_at: null,
    });
    expect(component.bootstrapCookieWarning()).toContain('token was accepted');
    expect(fixture.nativeElement.textContent as string).toContain('Open http://127.0.0.1:4200 directly');
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
    expect(text).toContain('Genesis sealed.');
    expect(text).toContain('Bootstrapper locked after successful recordation');
    expect(text).toContain('admin_records.json');
    expect(text).toContain('portal_runtime_config.json');
    expect(text).toContain('bootstrap_manifest.json');
    expect(text).toContain('recorded admin slot 0 wallet');
    expect(text).toContain('Permanent admin login');
    expect(text).toContain('Open Admin desk');
    expect(text).toContain('First-admin ceremony finalized');
    expect(text).toContain('Continue with permanent admin login');
    expect(text).not.toContain('Continue Act II: bind admin slot 0');
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
    expect(component.actionMessage()).toContain('No base manifest exists yet');
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
    expect(component.actionMessage()).toContain('Dry-run complete');
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
    expect(component.actionMessage()).toContain('Base protocol deployed');
  });
});
