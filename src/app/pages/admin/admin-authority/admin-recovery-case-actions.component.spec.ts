import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  AdminRecoveryCase,
  AdminSecurityService,
  AdminSecurityStatus,
  ChiaActionPackage,
  EvmRecoveryAction,
} from '../../../services/admin-security.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { AdminRecoveryCaseActionsComponent } from './admin-recovery-case-actions.component';

describe('AdminRecoveryCaseActionsComponent', () => {
  let fixture: ComponentFixture<AdminRecoveryCaseActionsComponent>;
  let component: AdminRecoveryCaseActionsComponent;
  let security: {
    getChiaPackage: jasmine.Spy;
    observeEvm: jasmine.Spy;
  };

  beforeEach(async () => {
    security = {
      getChiaPackage: jasmine
        .createSpy('getChiaPackage')
        .and.resolveTo(chiaPackage()),
      observeEvm: jasmine.createSpy('observeEvm').and.resolveTo(recovery()),
    };
    await TestBed.configureTestingModule({
      imports: [AdminRecoveryCaseActionsComponent],
      providers: [
        provideRouter([]),
        { provide: AdminSecurityService, useValue: security },
        {
          provide: EvmWalletService,
          useValue: {},
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminRecoveryCaseActionsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('current', status());
    fixture.componentRef.setInput('recovery', recovery());
    fixture.detectChanges();
  });

  it('derives task lists from every refreshed case input', () => {
    expect(component.positiveEvmActions().map((action) => action.actionId)).toEqual([
      'authority-approval',
    ]);
    expect(component.cancellationEvmActions()).toEqual([]);

    fixture.componentRef.setInput(
      'recovery',
      recovery({
        actions: [action('old-key-veto')],
      }),
    );
    fixture.detectChanges();

    expect(component.positiveEvmActions()).toEqual([]);
    expect(component.cancellationEvmActions().map((value) => value.actionId)).toEqual([
      'old-key-veto',
    ]);
  });

  it('resumes a persisted Base Sepolia confirmation check', async () => {
    const transactionHash = `0x${'ab'.repeat(32)}`;
    fixture.componentRef.setInput(
      'recovery',
      recovery({
        evmSubmissions: [
          {
            actionId: 'authority-approval',
            transactionHash,
            state: 'PENDING',
            submittedBy: status().actor.wallet,
            submittedAt: 1_800_000_000,
            updatedAt: 1_800_000_000,
          },
        ],
      }),
    );
    fixture.detectChanges();

    expect(pageText()).toContain('Check confirmation');
    await component.observeEvm({
      actionId: 'authority-approval',
      transactionHash,
    });

    expect(security.observeEvm).toHaveBeenCalledOnceWith(
      'case-authority-v3',
      transactionHash,
    );
  });

  it('keeps the recorded Chia coadministrator when the page resumes', async () => {
    fixture.componentRef.setInput(
      'recovery',
      recovery({
        chiaSignatures: [
          {
            phase: 'PREPARE',
            actionId: `0x${'91'.repeat(32)}`,
            signerKind: 'EIP712_DAILY',
            signerSlot: 2,
            signerPublicKey: `0x${'92'.repeat(48)}`,
            messageHash: `0x${'93'.repeat(32)}`,
            submittedAt: 1_800_000_000,
          },
        ],
      }),
    );
    fixture.detectChanges();
    component.coadminSlot = 1;

    await component.reviewChiaPhase('PREPARE');

    expect(security.getChiaPackage).toHaveBeenCalledOnceWith(
      'case-authority-v3',
      {
        phase: 'PREPARE',
        coadminSlot: 2,
      },
    );
  });

  function pageText(): string {
    return (
      (fixture.nativeElement as HTMLElement).textContent
        ?.replace(/\s+/g, ' ')
        .trim() ?? ''
    );
  }

  it('explains unavailable Chia recovery signing without offering a failing export', () => {
    const chia = chiaPackage();
    chia.actions = [{
      actionId: `0x${'94'.repeat(32)}`,
      phase: 'PREPARE',
      signerKind: 'BLS_RECOVERY',
      signerSlot: 0,
      signerPublicKey: `0x${'41'.repeat(48)}`,
      messageHash: `0x${'95'.repeat(32)}`,
      title: 'Authorize the recovery lock',
      summary: 'Use the registered recovery key.',
      network: 'Testnet11',
      financialEffect: 'No funds move.',
      coinId: null,
      delegatedPuzzleHash: null,
      typedData: null,
      blsPairs: [],
      signed: false,
    }];
    component.chiaPackage.set(chia);
    fixture.detectChanges();

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    expect(buttons.some((button) => button.textContent?.includes('Use recovery kit'))).toBeFalse();
    expect(pageText()).toContain('Chia recovery signing is unavailable');
    expect(pageText()).toContain('Keep your recovery phrase offline');

    chia.actions[0].signed = true;
    component.chiaPackage.set({ ...chia });
    fixture.detectChanges();
    expect(pageText()).toContain('Signature recorded');
  });
});

function action(actionId: string): EvmRecoveryAction {
  return {
    actionId,
    title: 'Approve this wallet replacement',
    network: 'Base Sepolia',
    financialEffect: 'No funds move.',
    to: '0x2222222222222222222222222222222222222222',
    value: '0x0',
    data: '0x12345678',
    signer: '0x3333333333333333333333333333333333333333',
    execution: 'SAFE',
  };
}

function recovery(
  overrides: Partial<AdminRecoveryCase> = {},
): AdminRecoveryCase {
  return {
    caseId: 'case-authority-v3',
    ceremonyId: `0x${'11'.repeat(32)}`,
    slot: 0,
    kind: 'ROUTINE',
    state: 'AWAITING_APPROVALS',
    intentHash: `0x${'12'.repeat(32)}`,
    intent: {
      schemaVersion: 1,
      slot: 0,
      kind: 'ROUTINE',
      oldDailyEvmKey: '0x1111111111111111111111111111111111111111',
      newDailyEvmKey: '0x2222222222222222222222222222222222222222',
      oldDailyChiaKey: `0x${'31'.repeat(33)}`,
      newDailyChiaKey: `0x${'32'.repeat(33)}`,
      oldRecoveryGuardian: '0x3333333333333333333333333333333333333333',
      newRecoveryGuardian: '0x3333333333333333333333333333333333333333',
      oldRecoveryBlsKey: `0x${'41'.repeat(48)}`,
      newRecoveryBlsKey: `0x${'41'.repeat(48)}`,
      identityLauncherIds: [
        `0x${'51'.repeat(32)}`,
        `0x${'52'.repeat(32)}`,
        `0x${'53'.repeat(32)}`,
      ],
      identitySafes: [
        '0x4444444444444444444444444444444444444444',
        '0x5555555555555555555555555555555555555555',
        '0x6666666666666666666666666666666666666666',
      ],
      authorityLauncherId: `0x${'61'.repeat(32)}`,
      coadminSafe: '0x7777777777777777777777777777777777777777',
      rootSafe: '0x8888888888888888888888888888888888888888',
      chiaNetwork: 'testnet11',
      evmChainId: 84532,
      sourceManifestHash: `0x${'71'.repeat(32)}`,
      nonce: 1,
      expiresAt: 1_900_000_000,
      recoveryKeyRevision: 1,
    },
    executeAfter: 1_900_000_000,
    expiresAt: 1_900_100_000,
    preparedBy: '0x1111111111111111111111111111111111111111',
    chiaTransactionId: null,
    evmTransactionHash: null,
    chiaReceiptHash: null,
    evmReceiptHash: null,
    failureReason: null,
    approvals: [],
    receipts: [],
    chiaSignatures: [],
    evmSubmissions: [],
    createdAt: 1_800_000_000,
    updatedAt: 1_800_000_000,
    approvalsComplete: false,
    delayComplete: false,
    actions: [action('authority-approval')],
    policy: {
      operationsFrozen: true,
      crossChainConvergenceRequired: true,
      oldKeyVetoUntilExecution: true,
      totalLossBypass: false,
    },
    ...overrides,
  };
}

function status(): AdminSecurityStatus {
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
    authorityNotice: null,
    recoveryKits: [],
    recoveryReady: false,
    myRecoveryKit: null,
    pendingRecoveryKit: null,
    activeRecovery: null,
    operationsFrozen: true,
    recoveryPolicy: {
      routineDelaySeconds: 86_400,
      lostKeyDelaySeconds: 604_800,
      oldKeyVeto: true,
      replacementAcceptanceRequired: true,
      totalLossBypass: false,
    },
  };
}

function chiaPackage(): ChiaActionPackage {
  return {
    schemaVersion: 1,
    caseId: 'case-authority-v3',
    intentHash: `0x${'12'.repeat(32)}`,
    phase: 'PREPARE',
    network: 'testnet11',
    authorityCoinId: `0x${'81'.repeat(32)}`,
    authorityVersion: 1,
    coadminSlot: 2,
    actions: [],
    delayComplete: false,
    executeAfter: 1_900_000_000,
    readyToSubmit: false,
    spendBundleId: null,
    inputCoinIds: [],
    clearSigning: {
      title: 'Start the protected wallet change',
      financialEffect: 'No administrator or protocol funds move.',
      authorityRule: 'Owner plus either coadministrator',
      replacement: '0x2222222222222222222222222222222222222222',
      reversible: true,
      operationsFrozen: true,
    },
  };
}
