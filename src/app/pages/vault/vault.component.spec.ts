import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { VaultState } from '../../services/populis-api.service';
import { SessionService } from '../../services/session.service';
import {
  ZkPassportEvmAttestationPollerService,
  ZkPassportEvmPollResult,
} from '../../services/zkpassport-evm-attestation-poller.service';
import { ZkPassportVaultEnrollmentSpendService } from '../../services/zkpassport-vault-enrollment-spend.service';
import { ZkPassportVaultEnrollmentAuthorizeService } from '../../services/zkpassport-vault-enrollment-authorize.service';
import { ZkPassportVaultEnrollmentCommitService } from '../../services/zkpassport-vault-enrollment-commit.service';
import { VaultVersionStatusService } from '../../services/vault-version-status.service';
import { VaultUpgradeRunnerService } from '../../services/vault-upgrade-runner.service';
import { VaultComponent } from './vault.component';

const VAULT_LAUNCHER_ID = '0x' + '11'.repeat(32);
const VAULT_COIN_ID = '0x' + 'aa'.repeat(32);
const NEXT_VAULT_COIN_ID = '0x' + '99'.repeat(32);
const NEXT_VAULT_PUZZLE_HASH = '0x' + '98'.repeat(32);
const MOCK_ENROLLMENT_PACKAGE = {
  status: 'unsigned' as const,
  backendSigning: false as const,
  spendCase: '0x7a' as const,
  authType: 3,
  vaultLauncherId: VAULT_LAUNCHER_ID,
  vaultCoin: {
    parentCoinInfo: '0x' + '11'.repeat(32),
    puzzleHash: '0x' + 'bb'.repeat(32),
    amount: 1,
    coinId: VAULT_COIN_ID,
  },
  bridgeCoin: {
    parentCoinInfo: '0x' + '66'.repeat(32),
    puzzleHash: '0x' + '55'.repeat(32),
    amount: 1,
    coinId: '0x' + '77'.repeat(32),
  },
  bridgePolicyHash: '0x' + '55'.repeat(32),
  vaultInnerPuzzleHash: '0x' + '88'.repeat(32),
  vaultFullPuzzleHash: '0x' + 'bb'.repeat(32),
  expectedNextVaultInnerPuzzleHash: '0x' + '97'.repeat(32),
  expectedNextVaultFullPuzzleHash: NEXT_VAULT_PUZZLE_HASH,
  expectedNextVaultCoin: {
    parentCoinInfo: VAULT_COIN_ID,
    puzzleHash: NEXT_VAULT_PUZZLE_HASH,
    amount: 1,
    coinId: NEXT_VAULT_COIN_ID,
  },
  lineageProof: {
    parentParentCoinInfo: '0x' + '11'.repeat(32),
    parentInnerPuzzleHash: null,
    parentAmount: 1,
  },
  signerIndices: [0, 2],
  validatorSignatures: [],
  vaultSignatureData: '0x',
  coinSpends: [],
  unsignedSpendBundle: { coinSpends: [], aggregatedSignature: null },
};

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

function foundResult(): ZkPassportEvmPollResult {
  const bridgeMessage = '0x8de348f6526b3bcc752ca1b524f3288c91ddbeb0f9d3451390ffbb0609565a71';
  const validatorMessage = '0xe4d2cc41e0f242efbba2b832a54cabab2495bccf100a341cef64b27f4eb67c76';
  return {
    kind: 'found',
    checkedAtMs: 1,
    event: {
      sender: '0x0e61d3bb1148bdd802f747caea112333d156626a',
      vaultLauncherId: VAULT_LAUNCHER_ID,
      scopedNullifier: '0x' + '22'.repeat(32),
      nullifierType: 1,
      serviceScopeHash: '0x' + '33'.repeat(32),
      serviceSubscopeHash: '0x' + '44'.repeat(32),
      proofTimestamp: 1_779_120_000,
      attestationLeafHash: '0x41950d187f655ae494bcdea426d643d3a21734ae9d3311c34477eb836867fcf7',
      attestationRoot: '0x41950d187f655ae494bcdea426d643d3a21734ae9d3311c34477eb836867fcf7',
      bridgeParentId: '0x' + '66'.repeat(32),
      bridgeAmount: 1,
      bridgeCoinId: '0x' + '77'.repeat(32),
      bridgeMessage,
      bridgePolicyHash: '0x' + '55'.repeat(32),
      policyVersion: 1,
    },
    enrollment: {
      vaultLauncherId: VAULT_LAUNCHER_ID,
      vaultSubscope: `vault:${VAULT_LAUNCHER_ID}`,
      scopedNullifier: '0x' + '22'.repeat(32),
      nullifierType: 1,
      serviceScopeHash: '0x' + '33'.repeat(32),
      serviceSubscopeHash: '0x' + '44'.repeat(32),
      proofTimestamp: 1_779_120_000,
      attestationLeafHash: '0x41950d187f655ae494bcdea426d643d3a21734ae9d3311c34477eb836867fcf7',
      newIdentityAttestRoot: '0x41950d187f655ae494bcdea426d643d3a21734ae9d3311c34477eb836867fcf7',
      attestationProof: { bitpath: 0, siblings: [] },
      bridgePolicyHash: '0x' + '55'.repeat(32),
      bridgeParentId: '0x' + '66'.repeat(32),
      bridgeAmount: 1,
      bridgeCoinId: '0x' + '77'.repeat(32),
      bridgeMessage,
      bridgeAnnouncementPayload: `0x50${bridgeMessage.slice(2)}`,
      validatorMessage,
    },
    bridgeSpendPackage: {
      status: 'threshold_ready',
      backendSigning: false,
      requiredSignatures: 2,
      signerIndices: [0, 2],
      validatorMessage,
      signatures: [],
      bridgeCoin: {
        parentId: '0x' + '66'.repeat(32),
        puzzleHash: '0x' + '55'.repeat(32),
        amount: 1,
        coinId: '0x' + '77'.repeat(32),
      },
    },
  };
}

describe('VaultComponent zkPassport enrollment preview', () => {
  let fixture: ComponentFixture<VaultComponent>;
  let component: VaultComponent;
  let sessionMock: Pick<SessionService, 'session' | 'vault' | 'refreshVault' | 'setVaultLauncherId'>;
  let evmPollerMock: jasmine.SpyObj<ZkPassportEvmAttestationPollerService>;
  let upgradeRunnerMock: jasmine.SpyObj<VaultUpgradeRunnerService>;
  let enrollmentSpendMock: jasmine.SpyObj<ZkPassportVaultEnrollmentSpendService>;
  let enrollmentAuthorizeMock: jasmine.SpyObj<ZkPassportVaultEnrollmentAuthorizeService>;
  let enrollmentCommitMock: jasmine.SpyObj<ZkPassportVaultEnrollmentCommitService>;
  let vaultVersionStatusMock: jasmine.SpyObj<VaultVersionStatusService>;

  beforeEach(async () => {
    localStorage.clear();
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
      setVaultLauncherId: jasmine.createSpy('setVaultLauncherId'),
    } as unknown as Pick<SessionService, 'session' | 'vault' | 'refreshVault' | 'setVaultLauncherId'>;
    evmPollerMock = jasmine.createSpyObj<ZkPassportEvmAttestationPollerService>(
      'ZkPassportEvmAttestationPollerService',
      ['pollOnce', 'proofLaunchUrl'],
    );
    evmPollerMock.proofLaunchUrl.and.returnValue(null);
    enrollmentSpendMock = jasmine.createSpyObj<ZkPassportVaultEnrollmentSpendService>(
      'ZkPassportVaultEnrollmentSpendService',
      ['buildFromChain'],
    );
    enrollmentSpendMock.buildFromChain.and.resolveTo(MOCK_ENROLLMENT_PACKAGE);
    enrollmentAuthorizeMock = jasmine.createSpyObj<ZkPassportVaultEnrollmentAuthorizeService>(
      'ZkPassportVaultEnrollmentAuthorizeService',
      ['authorizeFromChain'],
    );
    enrollmentAuthorizeMock.authorizeFromChain.and.resolveTo({
      packageState: MOCK_ENROLLMENT_PACKAGE,
      signedSpendBundle: {
        coinSpends: [],
        aggregatedSignature: '0x' + 'ee'.repeat(96),
      },
    });
    enrollmentCommitMock = jasmine.createSpyObj<ZkPassportVaultEnrollmentCommitService>(
      'ZkPassportVaultEnrollmentCommitService',
      ['commitAuthorizedEnrollment'],
    );
    enrollmentCommitMock.commitAuthorizedEnrollment.and.resolveTo({
      packageState: MOCK_ENROLLMENT_PACKAGE,
      signedSpendBundle: {
        coinSpends: [],
        aggregatedSignature: '0x' + 'ee'.repeat(96),
      },
      pushResponse: { success: true, status: 'SUCCESS' },
      confirmedVaultCoinId: NEXT_VAULT_COIN_ID,
      confirmedBlockIndex: 124,
    });
    vaultVersionStatusMock = jasmine.createSpyObj<VaultVersionStatusService>(
      'VaultVersionStatusService',
      ['checkVault'],
    );
    vaultVersionStatusMock.checkVault.and.resolveTo({ kind: 'current', registryVersion: 1 });
    upgradeRunnerMock = jasmine.createSpyObj<VaultUpgradeRunnerService>(
      'VaultUpgradeRunnerService',
      ['runUpgrade'],
    );

    await TestBed.configureTestingModule({
      imports: [VaultComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: sessionMock },
        { provide: ZkPassportEvmAttestationPollerService, useValue: evmPollerMock },
        { provide: ZkPassportVaultEnrollmentSpendService, useValue: enrollmentSpendMock },
        { provide: ZkPassportVaultEnrollmentAuthorizeService, useValue: enrollmentAuthorizeMock },
        { provide: ZkPassportVaultEnrollmentCommitService, useValue: enrollmentCommitMock },
        { provide: VaultVersionStatusService, useValue: vaultVersionStatusMock },
        { provide: VaultUpgradeRunnerService, useValue: upgradeRunnerMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('renders the event-driven enrollment card without manual bridge fields', () => {
    expect(fixture.nativeElement.textContent).toContain('zkPassport enrollment');
    expect(fixture.nativeElement.textContent).toContain(`vault:${VAULT_LAUNCHER_ID}`);
    expect(fixture.nativeElement.textContent).not.toContain('Scoped nullifier');
    expect(fixture.nativeElement.textContent).not.toContain('Bridge parent id');
  });

  it('shows pending while waiting for the EVM attestation event', async () => {
    evmPollerMock.pollOnce.and.resolveTo({ kind: 'pending', checkedAtMs: 1 });
    await component.checkZkPassportAttestation();
    fixture.detectChanges();
    expect(component.enrollmentStatus()).toBe('attestation_pending');
    expect(fixture.nativeElement.textContent).toContain('Waiting for the EVM');
  });

  it('does not poll when the zkPassport proof URL is not configured', async () => {
    await component.startZkPassportEnrollment();
    fixture.detectChanges();

    expect(component.enrollmentStatus()).toBe('idle');
    expect(component.enrollmentError()).toContain('verification URL is not configured');
    expect(evmPollerMock.pollOnce).not.toHaveBeenCalled();
  });

  it('builds canonical enrollment preview data from a polled EVM event', async () => {
    evmPollerMock.pollOnce.and.resolveTo(foundResult());
    await component.checkZkPassportAttestation();
    const preview = component.enrollmentPreview();
    expect(preview).not.toBeNull();
    expect(component.enrollmentStatus()).toBe('preview_ready');
    expect(component.enrollmentError()).toBeNull();
    expect(preview?.spendCase).toBe('0x7a');
    expect(preview?.vaultLauncherId).toBe(VAULT_LAUNCHER_ID);
    expect(preview?.vaultCoinId).toBe(VAULT_COIN_ID);
    expect(preview?.newIdentityAttestRoot).toBe(preview?.attestationLeafHash);
    expect(preview?.bridgeAnnouncementPayload).toBe(`0x50${preview?.bridgeMessage.slice(2)}`);
    expect(preview?.assertedCoinAnnouncement).toMatch(/^0x[0-9a-f]{64}$/);
    expect(preview?.bridgeSpendPackage.backendSigning).toBeFalse();
    expect(preview?.bridgeSpendPackage.status).toBe('threshold_ready');
    expect(preview?.unsignedEnrollmentSpendPackage?.status).toBe('unsigned');
    expect(enrollmentSpendMock.buildFromChain).toHaveBeenCalled();
    expect(component.enrollmentPreviewJson()).toContain('validatorMessage');
  });

  it('surfaces malformed EVM events clearly', async () => {
    evmPollerMock.pollOnce.and.resolveTo({
      kind: 'malformed',
      checkedAtMs: 1,
      reason: 'event bridge message does not match commitments',
    });
    await component.checkZkPassportAttestation();
    expect(component.enrollmentStatus()).toBe('malformed');
    expect(component.enrollmentPreview()).toBeNull();
    expect(component.enrollmentError()).toContain('bridge message');
  });

  it('surfaces attestation polling timeout', async () => {
    evmPollerMock.pollOnce.and.resolveTo({
      kind: 'timeout',
      checkedAtMs: 10_000,
      elapsedMs: 10_000,
    });
    await component.checkZkPassportAttestation();
    expect(component.enrollmentStatus()).toBe('timeout');
    expect(component.enrollmentError()).toContain('Timed out');
  });

  it('authorizes a ready enrollment package through the explicit auth service', async () => {
    evmPollerMock.pollOnce.and.resolveTo(foundResult());
    await component.checkZkPassportAttestation();
    await component.authorizeZkPassportEnrollment();
    expect(enrollmentAuthorizeMock.authorizeFromChain).toHaveBeenCalledWith(jasmine.objectContaining({
      vaultLauncherId: VAULT_LAUNCHER_ID,
      vaultCoinId: VAULT_COIN_ID,
      scopedNullifier: '0x' + '22'.repeat(32),
      nullifierType: 1,
      serviceScopeHash: '0x' + '33'.repeat(32),
      serviceSubscopeHash: '0x' + '44'.repeat(32),
      proofTimestamp: 1_779_120_000,
    }));
    expect(component.enrollmentStatus()).toBe('authorized');
    expect(component.enrollmentAuthorizationResult()?.signedSpendBundle.aggregatedSignature).toBe('0x' + 'ee'.repeat(96));
  });

  it('submits an authorized enrollment bundle and persists the proof after confirmation', async () => {
    evmPollerMock.pollOnce.and.resolveTo(foundResult());
    await component.checkZkPassportAttestation();
    await component.authorizeZkPassportEnrollment();
    await component.commitZkPassportEnrollment();
    expect(enrollmentCommitMock.commitAuthorizedEnrollment).toHaveBeenCalledOnceWith(
      component.enrollmentAuthorizationResult()!,
    );
    expect(component.enrollmentStatus()).toBe('confirmed');
    expect(component.enrollmentCommitResult()?.confirmedVaultCoinId).toBe(NEXT_VAULT_COIN_ID);
    const stored = JSON.parse(
      localStorage.getItem('populis_zkpassport_proofs_v1') ?? '{}',
    ) as Record<string, unknown>;
    expect(stored[VAULT_LAUNCHER_ID]).toBeTruthy();
  });

  it('rejects checking before the current vault coin is known', async () => {
    sessionMock.vault.set(vaultState(null));
    await component.checkZkPassportAttestation();
    expect(component.enrollmentPreview()).toBeNull();
    expect(component.enrollmentError()).toContain('current coin id');
    expect(evmPollerMock.pollOnce).not.toHaveBeenCalled();
  });

  it('clears preview, proof URL, and error state', async () => {
    evmPollerMock.pollOnce.and.resolveTo(foundResult());
    await component.checkZkPassportAttestation();
    component.zkPassportProofUrl.set('https://zkpassport.example');
    component.clearEnrollmentPreview();
    expect(component.enrollmentPreview()).toBeNull();
    expect(component.zkPassportProofUrl()).toBeNull();
    expect(component.enrollmentError()).toBeNull();
    expect(component.enrollmentStatus()).toBe('idle');
  });

  it('checks the vault version against the registry on refresh', async () => {
    await component.manualRefresh();
    expect(vaultVersionStatusMock.checkVault).toHaveBeenCalledWith(VAULT_LAUNCHER_ID);
  });

  it('renders the "up to date" indicator when the vault is current', async () => {
    vaultVersionStatusMock.checkVault.and.resolveTo({ kind: 'current', registryVersion: 4 });
    await component.manualRefresh();
    fixture.detectChanges();
    expect(component.versionStatus()).toEqual({ kind: 'current', registryVersion: 4 });
    expect(fixture.nativeElement.textContent).toContain('up to date');
    expect(fixture.nativeElement.textContent).not.toContain('Upgrade available');
  });

  it('renders the "Upgrade available" banner with the params-repair reason', async () => {
    vaultVersionStatusMock.checkVault.and.resolveTo({
      kind: 'outdated',
      reason: 'params',
      registryVersion: 5,
    });
    await component.manualRefresh();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Upgrade available');
    expect(fixture.nativeElement.textContent).toContain('repairs protocol parameters');
    expect(fixture.nativeElement.textContent).toContain('5');
  });

  it('renders the code-change upgrade reason for outdated vault code', async () => {
    vaultVersionStatusMock.checkVault.and.resolveTo({
      kind: 'outdated',
      reason: 'code',
      registryVersion: 6,
    });
    await component.manualRefresh();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Upgrade available');
    expect(fixture.nativeElement.textContent).toContain('includes a code change');
  });

  it('keeps the banner hidden when the registry is unavailable', async () => {
    vaultVersionStatusMock.checkVault.and.resolveTo(null);
    await component.manualRefresh();
    fixture.detectChanges();
    expect(component.versionStatus()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Upgrade available');
    expect(fixture.nativeElement.textContent).not.toContain('up to date');
  });

  it('enables the Upgrade vault button when the vault is outdated', async () => {
    vaultVersionStatusMock.checkVault.and.resolveTo({ kind: 'outdated', reason: 'params', registryVersion: 5 });
    await component.manualRefresh();
    fixture.detectChanges();
    const button: HTMLButtonElement | null = fixture.nativeElement.querySelector('button.btn--primary');
    expect(button?.textContent).toContain('Upgrade vault');
    expect(button?.disabled).toBeFalse();
  });

  it('runs the one-click upgrade, streams progress, and re-points the session', async () => {
    vaultVersionStatusMock.checkVault.and.resolveTo({ kind: 'outdated', reason: 'params', registryVersion: 5 });
    await component.manualRefresh();
    fixture.detectChanges();

    const newLauncher = '0x' + '99'.repeat(32);
    const seenPhases: string[] = [];
    upgradeRunnerMock.runUpgrade.and.callFake(async (_id, onProgress) => {
      onProgress?.({ phase: 'launching', message: 'Funding and signing the new vault launch…' });
      seenPhases.push('launching');
      onProgress?.({ phase: 'migrating_deed', message: 'Migrating deed 1 of 1…', deedIndex: 1, deedTotal: 1 });
      seenPhases.push('migrating_deed');
      onProgress?.({ phase: 'done', message: 'Upgrade complete. 1 deed(s) migrated.', newVaultLauncherId: newLauncher });
      seenPhases.push('done');
      return {
        newVaultLauncherId: newLauncher,
        launchPushResponse: { success: true, status: 'SUCCESS' },
        migratedDeeds: [{ deedLauncherId: '0x' + 'd1'.repeat(32), pushResponse: { success: true, status: 'SUCCESS' } }],
        deedsUnmigratable: false,
      };
    });

    await component.upgradeVault();
    fixture.detectChanges();

    expect(upgradeRunnerMock.runUpgrade).toHaveBeenCalledWith(VAULT_LAUNCHER_ID, jasmine.any(Function));
    expect(seenPhases).toEqual(['launching', 'migrating_deed', 'done']);
    expect(component.upgrading()).toBeFalse();
    expect(component.upgradeResult()?.newVaultLauncherId).toBe(newLauncher);
    expect(sessionMock.setVaultLauncherId).toHaveBeenCalledWith(newLauncher);
    expect(fixture.nativeElement.textContent).toContain('New vault launched');
    expect(fixture.nativeElement.textContent).toContain('1 deed(s) migrated');
  });

  it('shows the freely-transferable note when deeds are unmigratable', async () => {
    vaultVersionStatusMock.checkVault.and.resolveTo({ kind: 'outdated', reason: 'code', registryVersion: 6 });
    await component.manualRefresh();
    const newLauncher = '0x' + '99'.repeat(32);
    upgradeRunnerMock.runUpgrade.and.resolveTo({
      newVaultLauncherId: newLauncher,
      launchPushResponse: { success: true, status: 'SUCCESS' },
      migratedDeeds: [],
      deedsUnmigratable: true,
    });
    await component.upgradeVault();
    fixture.detectChanges();
    expect(component.upgradeResult()?.deedsUnmigratable).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('predates the migrate upgrade');
  });

  it('surfaces upgrade errors without re-pointing the session', async () => {
    vaultVersionStatusMock.checkVault.and.resolveTo({ kind: 'outdated', reason: 'params', registryVersion: 5 });
    await component.manualRefresh();
    upgradeRunnerMock.runUpgrade.and.rejectWith(new Error('wallet rejected the funding spend'));
    await component.upgradeVault();
    fixture.detectChanges();
    expect(component.upgradeError()).toContain('wallet rejected the funding spend');
    expect(component.upgradeResult()).toBeNull();
    expect(component.upgrading()).toBeFalse();
    expect(sessionMock.setVaultLauncherId).not.toHaveBeenCalled();
  });
});
