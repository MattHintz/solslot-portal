import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AdminLaunchService } from '../../../services/admin-launch.service';

import { AdminRecoveryBackupCryptoService } from '../../../services/admin-recovery-backup-crypto.service';
import { AdminRecoveryDriveService } from '../../../services/admin-recovery-drive.service';
import { AdminRecoveryKitService } from '../../../services/admin-recovery-kit.service';
import { AdminSecurityService, AdminSecurityStatus } from '../../../services/admin-security.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { SolslotProtocolArtifactService } from '../../../services/solslot-protocol-artifact.service';
import { AdminAuthorityComponent } from './admin-authority.component';

describe('AdminAuthorityComponent', () => {
  let fixture: ComponentFixture<AdminAuthorityComponent>;
  let security: { status: jasmine.Spy; prepareRecoveryDrill: jasmine.Spy };
  let launch: { workspace: jasmine.Spy; resumeChallenge: jasmine.Spy; resumeLogin: jasmine.Spy };
  let wallet: { address: ReturnType<typeof signal<string | null>>; connectInjected: jasmine.Spy; connectWalletConnect: jasmine.Spy; signLaunchAction: jasmine.Spy };
  let route: { snapshot: { data: { launchSecurity: boolean } } };

  beforeEach(async () => {
    security = {
      status: jasmine.createSpy('status').and.resolveTo(status()),
      prepareRecoveryDrill: jasmine.createSpy('prepareRecoveryDrill'),
    };
    launch = {
      workspace: jasmine.createSpy('workspace').and.resolveTo(workspace()),
      resumeChallenge: jasmine.createSpy('resumeChallenge').and.resolveTo({
        nonce: 'sign-in-nonce', typedData: {},
        ceremonyBinding: { ceremonyId: status().actor.ceremonyId, evmChainId: 8453 },
      }),
      resumeLogin: jasmine.createSpy('resumeLogin').and.resolveTo(workspace().session),
    };
    wallet = {
      address: signal<string | null>(null),
      connectInjected: jasmine.createSpy('connectInjected').and.resolveTo(status().actor.wallet),
      connectWalletConnect: jasmine.createSpy('connectWalletConnect').and.resolveTo(status().actor.wallet),
      signLaunchAction: jasmine.createSpy('signLaunchAction').and.resolveTo('signed-login'),
    };
    route = { snapshot: { data: { launchSecurity: false } } };
    const session = {
      isAuthenticated: signal(true),
    };
    await TestBed.configureTestingModule({
      imports: [AdminAuthorityComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: AdminLaunchService, useValue: launch },
        { provide: AdminSecurityService, useValue: security },
        {
          provide: AdminRecoveryKitService,
          useValue: { clear: jasmine.createSpy('clear') },
        },
        { provide: AdminRecoveryBackupCryptoService, useValue: {} },
        { provide: AdminRecoveryDriveService, useValue: {} },
        {
          provide: EvmWalletService,
          useValue: wallet,
        },
        { provide: AdminSessionService, useValue: session },
        {
          provide: SolslotProtocolArtifactService,
          useValue: { artifact: null },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminAuthorityComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('explains the fixed owner-plus-one rule and recovery readiness', () => {
    const text = pageText();
    expect(text).toContain('Security & Access');
    expect(text).toContain('Owner plus either coadministrator');
    expect(text).toContain('Cannot be changed by recovery');
    expect(text).toContain('3 of 3 ready');
  });

  it('teaches the no-backdoor and clear-signing safety rules', () => {
    const text = pageText();
    expect(text).toContain('Solslot support will never ask for the 24 words');
    expect(text).toContain('Reject unknown Chia effects or EVM calls');
    expect(text).toContain('Total loss');
  });

  it('offers guided daily-wallet rotation instead of a disabled control', () => {
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((candidate) => candidate.textContent?.includes('Rotate wallet'));
    expect(button).toBeTruthy();
    expect(button?.disabled).toBeFalse();
  });

  it('checks the launch session first when an expired cookie has disappeared', async () => {
    launch.workspace.and.rejectWith(expired());
    security.status.calls.reset();
    await openLaunchPage();
    expect(security.status).not.toHaveBeenCalled();
    expect(pageText()).toContain('Sign in to continue');
    expect(pageText()).not.toContain('Admin desk is disabled');
    expect(pageText()).not.toContain('Try again');
  });

  it('preserves an unfinished kit when the session expires during its drill', async () => {
    await openLaunchPage();
    const component = fixture.componentInstance;
    component.setupStage.set('verify');
    component.recoveryPhrase.set('synthetic recovery draft for this test only');
    component.remoteProofText = 'synthetic second-device result';
    launch.workspace.and.rejectWith(expired());
    await component.prepareRecoveryDrill(status());
    expect(component.launchSignInRequired()).toBeTrue();
    expect(component.setupStage()).toBe('verify');
    expect(component.recoveryPhrase()).toBe('synthetic recovery draft for this test only');
    expect(component.remoteProofText).toBe('synthetic second-device result');
    expect(security.prepareRecoveryDrill).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(pageText()).toContain('Keep this page open');
  });

  for (const mode of ['injected', 'walletconnect'] as const) {
    it(`reconnects with ${mode} without regenerating a kit or replaying the interrupted action`, async () => {
      await openLaunchPage();
      const component = fixture.componentInstance;
      component.setupStage.set('verify');
      component.recoveryPhrase.set('synthetic unfinished kit');
      component.launchSignInRequired.set(true);
      await component.reconnectLaunch(mode);
      expect(launch.resumeLogin).toHaveBeenCalledWith(status().actor.wallet, 'sign-in-nonce', 'signed-login');
      expect(component.launchSignInRequired()).toBeFalse();
      expect(component.setupStage()).toBe('verify');
      expect(component.recoveryPhrase()).toBe('synthetic unfinished kit');
      expect(security.prepareRecoveryDrill).not.toHaveBeenCalled();
      expect(component.status()?.myRecoveryKit?.revision).toBe(1);
    });
  }

  it('does not sign in a different administrator over an unfinished setup', async () => {
    await openLaunchPage();
    wallet.connectInjected.and.resolveTo('0x2222222222222222222222222222222222222222');
    fixture.componentInstance.launchSignInRequired.set(true);
    await fixture.componentInstance.reconnectLaunch('injected');
    expect(launch.resumeChallenge).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('same administrator wallet');
    expect(fixture.componentInstance.launchSignInRequired()).toBeTrue();
  });

  it('rejects a sign-in challenge from a different ceremony before signing', async () => {
    await openLaunchPage();
    launch.resumeChallenge.and.resolveTo({ nonce: 'other', typedData: {}, ceremonyBinding: { ceremonyId: 'other' } });
    await fixture.componentInstance.reconnectLaunch('injected');
    expect(wallet.signLaunchAction).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('different launch');
  });

  it('leaves sign-in available if the user declines the wallet prompt', async () => {
    await openLaunchPage();
    fixture.componentInstance.launchSignInRequired.set(true);
    wallet.signLaunchAction.and.rejectWith(new Error('Wallet request declined'));
    await fixture.componentInstance.reconnectLaunch('injected');
    expect(launch.resumeLogin).not.toHaveBeenCalled();
    expect(fixture.componentInstance.launchSignInRequired()).toBeTrue();
    expect(fixture.componentInstance.busy()).toBeFalse();
    expect(fixture.componentInstance.error()).toBe('Wallet request declined');
  });

  it('detects cookie expiry between the workspace check and the security request', async () => {
    await openLaunchPage();
    security.status.and.rejectWith(new HttpErrorResponse({status: 503, error: {detail: 'Admin desk is disabled (no chain-verified admin records).'}}));
    let checks = 0;
    launch.workspace.and.callFake(() => ++checks === 1 ? Promise.resolve(workspace()) : Promise.reject(expired()));
    await fixture.componentInstance.reload();
    expect(checks).toBe(2);
    expect(fixture.componentInstance.launchSignInRequired()).toBeTrue();
    expect(fixture.componentInstance.error()).toBeNull();
  });

  it('does not disguise an unavailable backend as an expired session', async () => {
    await openLaunchPage();
    launch.workspace.and.rejectWith(new HttpErrorResponse({status: 503, error: {detail: 'Temporarily unavailable'}}));
    await fixture.componentInstance.reload();
    expect(fixture.componentInstance.launchSignInRequired()).toBeFalse();
    expect(fixture.componentInstance.error()).toBe('Temporarily unavailable');
  });

  it('blocks an operation if another tab changes the signed-in administrator', async () => {
    await openLaunchPage();
    launch.workspace.and.resolveTo({...workspace(), session: {...workspace().session, slot: 2}});
    await fixture.componentInstance.prepareRecoveryDrill(status());
    expect(security.prepareRecoveryDrill).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('administrator changed');
  });

  it('leaves normal post-genesis administration on its existing authentication path', async () => {
    security.status.and.rejectWith(expired());
    await fixture.componentInstance.reload();
    expect(launch.workspace).not.toHaveBeenCalled();
    expect(fixture.componentInstance.launchSignInRequired()).toBeFalse();
    expect(fixture.componentInstance.error()).toBe('Administrator session expired.');
  });

  async function openLaunchPage(): Promise<void> {
    fixture.destroy();
    route.snapshot.data.launchSecurity = true;
    fixture = TestBed.createComponent(AdminAuthorityComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function expired(): HttpErrorResponse {
    return new HttpErrorResponse({status: 401, error: {detail: 'Administrator session expired.'}});
  }

  function workspace() {
    return {session: {slot: 1, wallet: status().actor.wallet}, launch: {ceremonyId: status().actor.ceremonyId}};
  }

  function pageText(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }
});

function status(): AdminSecurityStatus {
  const recoveryKits = ([0, 1, 2] as const).map((slot) => ({
    ceremonyId: `0x${'11'.repeat(32)}`,
    slot,
    revision: 1,
    evmGuardian: `0x${String(slot + 1).repeat(40)}`,
    recoveryBlsPubkey: `0x${String(slot + 1).repeat(96)}`,
    recoveryBlsCommitment: `0x${String(slot + 1).repeat(64)}`,
    drillChallengeHash: `0x${String(slot + 1).repeat(64)}`,
    drillVerifiedAt: 1_800_000_000,
    offlineCopyConfirmed: true,
    secondDeviceConfirmed: true,
    backupStatus: 'NOT_CONFIGURED' as const,
    backupRevision: null,
    backupCiphertextHash: null,
    backupVerifiedAt: null,
    updatedAt: 1_800_000_000,
  }));
  return {
    schemaVersion: 1,
    actor: {
      ceremonyId: `0x${'11'.repeat(32)}`,
      slot: 0,
      role: 'Owner',
      wallet: '0x1111111111111111111111111111111111111111',
    },
    authorityRule: 'owner_plus_one',
    authority: null,
    authorityNotice: 'Created during genesis.',
    recoveryKits,
    recoveryReady: true,
    myRecoveryKit: recoveryKits[0],
    pendingRecoveryKit: null,
    activeRecovery: null,
    operationsFrozen: false,
    recoveryPolicy: {
      routineDelaySeconds: 86400,
      lostKeyDelaySeconds: 604800,
      oldKeyVeto: true,
      replacementAcceptanceRequired: true,
      totalLossBypass: false,
    },
  };
}
