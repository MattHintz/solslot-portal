import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { VaultState } from '../../services/populis-api.service';
import { SessionService } from '../../services/session.service';
import { VaultComponent } from './vault.component';

const VAULT_LAUNCHER_ID = '0x' + '11'.repeat(32);
const VAULT_COIN_ID = '0x' + 'aa'.repeat(32);

function vaultState(currentCoinId: string | null = VAULT_COIN_ID): VaultState {
  return {
    vault_launcher_id: VAULT_LAUNCHER_ID,
    vault_full_puzhash: '0x' + 'bb'.repeat(32),
    p2_vault_puzhash: '0x' + 'cc'.repeat(32),
    auth_type: 'evm',
    owner_address: '0x0e61d3bb1148bdd802f747caea112333d156626a',
    owner_pubkey: '0x02' + 'dd'.repeat(32),
    confirmed: true,
    confirmed_block_index: 123,
    current_coin_id: currentCoinId,
    balance: { xch_mojos: 1, deeds: [] },
  };
}

describe('VaultComponent zkPassport enrollment preview', () => {
  let fixture: ComponentFixture<VaultComponent>;
  let component: VaultComponent;
  let sessionMock: Pick<SessionService, 'session' | 'vault' | 'refreshVault'>;

  beforeEach(async () => {
    sessionMock = {
      session: signal({
        authType: 'evm',
        address: '0x0e61d3bb1148bdd802f747caea112333d156626a',
        vaultLauncherId: VAULT_LAUNCHER_ID,
        compressedPubkey: '0x02' + 'dd'.repeat(32),
        createdAt: 1,
      }),
      vault: signal(vaultState()),
      refreshVault: async () => vaultState(),
    } as unknown as Pick<SessionService, 'session' | 'vault' | 'refreshVault'>;

    await TestBed.configureTestingModule({
      imports: [VaultComponent],
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: sessionMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    component.enroll = {
      scopedNullifier: '0x' + '22'.repeat(32),
      nullifierType: 1,
      serviceScopeHash: '0x' + '33'.repeat(32),
      serviceSubscopeHash: '0x' + '44'.repeat(32),
      proofTimestamp: 1_779_120_000,
      bridgePolicyHash: '0x' + '55'.repeat(32),
      bridgeParentId: '0x' + '66'.repeat(32),
      bridgeAmount: 1,
    };
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('renders the enrollment preview card for an active vault', () => {
    expect(fixture.nativeElement.textContent).toContain('zkPassport enrollment');
    expect(fixture.nativeElement.textContent).toContain(`vault:${VAULT_LAUNCHER_ID}`);
  });

  it('builds canonical enrollment preview data from verifier and bridge inputs', () => {
    component.buildEnrollmentPreview();
    const preview = component.enrollmentPreview();
    expect(preview).not.toBeNull();
    expect(component.enrollmentStatus()).toBe('preview_ready');
    expect(component.enrollmentError()).toBeNull();
    expect(preview?.spendCase).toBe('0x7a');
    expect(preview?.vaultLauncherId).toBe(VAULT_LAUNCHER_ID);
    expect(preview?.vaultCoinId).toBe(VAULT_COIN_ID);
    expect(preview?.attestationLeafHash).toBe(
      '0x41950d187f655ae494bcdea426d643d3a21734ae9d3311c34477eb836867fcf7',
    );
    expect(preview?.newIdentityAttestRoot).toBe(preview?.attestationLeafHash);
    expect(preview?.bridgeMessage).toBe(
      '0x8de348f6526b3bcc752ca1b524f3288c91ddbeb0f9d3451390ffbb0609565a71',
    );
    expect(preview?.bridgeAnnouncementPayload).toBe(`0x50${preview?.bridgeMessage.slice(2)}`);
    expect(preview?.assertedCoinAnnouncement).toMatch(/^0x[0-9a-f]{64}$/);
    expect(component.enrollmentPreviewJson()).toContain('assertedCoinAnnouncement');
  });

  it('marks a ready preview as submit pending without broadcasting', () => {
    component.buildEnrollmentPreview();
    component.markEnrollmentSubmitPending();
    expect(component.enrollmentStatus()).toBe('submit_pending');
    const stored = JSON.parse(
      localStorage.getItem('populis_zkpassport_proofs_v1') ?? '{}',
    ) as Record<string, unknown>;
    expect(stored[VAULT_LAUNCHER_ID]).toBeTruthy();
  });

  it('rejects preview building before the current vault coin is known', () => {
    sessionMock.vault.set(vaultState(null));
    component.buildEnrollmentPreview();
    expect(component.enrollmentPreview()).toBeNull();
    expect(component.enrollmentError()).toContain('current coin id');
  });

  it('clears preview and error state', () => {
    component.buildEnrollmentPreview();
    component.clearEnrollmentPreview();
    expect(component.enrollmentPreview()).toBeNull();
    expect(component.enrollmentError()).toBeNull();
    expect(component.enrollmentStatus()).toBe('idle');
  });
});
