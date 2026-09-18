import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  AdminLaunchService,
  LaunchWorkspace,
  RailOwnershipResult,
} from '../../../services/admin-launch.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { GenesisComponent } from './genesis.component';

describe('GenesisComponent', () => {
  const walletAddress = `0x${'ab'.repeat(20)}`;
  const ceremonyId = `0x${'11'.repeat(32)}`;
  const typedData = {
    domain: { name: 'Solslot Protocol', version: '2', chainId: 11155111 },
    types: {},
    primaryType: 'SolslotLaunchAction',
    message: {},
  };
  const address = signal<string | null>(null);

  let fixture: ComponentFixture<GenesisComponent>;
  let component: GenesisComponent;
  let launch: jasmine.SpyObj<AdminLaunchService>;
  let wallet: {
    address: typeof address;
    connectInjected: jasmine.Spy;
    connectWalletConnect: jasmine.Spy;
    disconnect: jasmine.Spy;
    signTypedData: jasmine.Spy;
    signLaunchCeremony: jasmine.Spy;
    signLaunchAction: jasmine.Spy;
    signSafeMessage: jasmine.Spy;
    sendBaseSepoliaTransaction: jasmine.Spy;
  };

  function workspace(state = 'roster_open'): LaunchWorkspace {
    return {
      session: {
        authenticated: true,
        slot: 1,
        role: 'owner',
        wallet: walletAddress,
        expiresAt: 1_900_000_000,
      },
      launch: {
        ceremonyId,
        state,
        network: 'testnet11',
        createdAt: 1_800_000_000,
        updatedAt: 1_800_000_001,
        administrators: [
          { slot: 1, role: 'owner', enrolled: true, wallet: walletAddress },
          { slot: 2, role: 'coadmin', enrolled: false },
          { slot: 3, role: 'coadmin', enrolled: false },
        ],
        planSignatureSlots: [],
        artifactSignatureSlots: [],
      },
      readiness: [
        {
          id: 'release',
          title: 'Reviewed RC21 release',
          status: 'Healthy',
          impact: 'The exact release evidence matches this server.',
          assignedRole: 'system',
        },
        {
          id: 'funding',
          title: 'Ceremony funding',
          status: 'Waiting',
          impact: 'The fixed nine-output transaction has not been created.',
          assignedRole: 'owner',
        },
      ],
      nextTask: {
        title: 'Enroll the administrator team',
        body: 'Create private links for Admin 2 and Admin 3.',
        assignedRole: 'owner',
        action: 'enrollment',
      },
      gates: {},
      actionApprovals: {},
      notice: 'TESTNET, NO REAL INVESTMENT OR LEGAL RIGHT.',
    };
  }

  beforeEach(async () => {
    launch = jasmine.createSpyObj<AdminLaunchService>('AdminLaunchService', [
      'publicStatus',
      'claimOwner',
      'prepareInvitation',
      'reissueOwnerEnrollment',
      'acceptInvitation',
      'resumeChallenge',
      'resumeLogin',
      'logout',
      'workspace',
      'issueInvitation',
      'freezeRoster',
      'railOwnership',
      'signRailOwnership',
      'recordRailOwnershipBroadcast',
      'settlementRehearsal',
      'startSettlementRehearsal',
      'prepareFunding',
      'executeFunding',
      'confirmFunding',
      'proposeGate',
      'prepareAction',
      'approveAction',
      'activateGate',
      'closeXchVouchers',
      'buildPlan',
      'preparePlanSignature',
      'signPlan',
      'preflight',
      'broadcast',
      'progress',
      'prepareArtifactSignature',
      'signArtifact',
      'archive',
    ]);
    launch.publicStatus.and.resolveTo({
      enabled: true,
      network: 'testnet11',
      title: 'Administrator setup & launch',
      notice: 'Testnet only',
    });
    launch.workspace.and.rejectWith(new Error('not signed in'));
    launch.railOwnership.and.rejectWith(new Error('not available'));
    launch.settlementRehearsal.and.rejectWith(new Error('not available'));

    address.set(null);
    wallet = {
      address,
      connectInjected: jasmine.createSpy('connectInjected').and.resolveTo(walletAddress),
      connectWalletConnect: jasmine
        .createSpy('connectWalletConnect')
        .and.resolveTo(walletAddress),
      disconnect: jasmine.createSpy('disconnect').and.resolveTo(),
      signTypedData: jasmine.createSpy('signTypedData').and.resolveTo('0xsigned'),
      signLaunchCeremony: jasmine.createSpy('signLaunchCeremony').and.resolveTo('0xsigned'),
      signLaunchAction: jasmine.createSpy('signLaunchAction').and.resolveTo('0xresume'),
      signSafeMessage: jasmine.createSpy('signSafeMessage').and.resolveTo('0xsafe'),
      sendBaseSepoliaTransaction: jasmine
        .createSpy('sendBaseSepoliaTransaction')
        .and.resolveTo(`0x${'33'.repeat(32)}`),
    };

    await TestBed.configureTestingModule({
      imports: [GenesisComponent],
      providers: [
        provideRouter([]),
        { provide: AdminLaunchService, useValue: launch },
        { provide: EvmWalletService, useValue: wallet },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GenesisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows a neutral wallet sign-in without ceremony identifiers or raw protocol inputs', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Administrator setup & launch');
    expect(text).toContain('Already enrolled?');
    expect(text).toContain('Sign in with browser wallet');
    expect(text).not.toContain('bearer token');
    expect(text).not.toContain('Source SHA');
    expect(text).not.toContain('Plan JSON');
    expect(text).not.toContain(ceremonyId);
  });

  it('does not expose transport errors when the launch service is unavailable', async () => {
    launch.publicStatus.and.rejectWith(
      new Error(
        '200 OK — Http failure during parsing for https://example.test/protocol-api/admin/launch/public',
      ),
    );

    await component.ngOnInit();

    expect(component.error()).toBe(
      'The administrator service could not be reached. No action is available. Try again after the service is restored.',
    );
    expect(component.error()).not.toContain('Http failure during parsing');
  });

  it('shows a resumable confirmation state without asking for another broadcast', () => {
    const transactionHash = `0x${'44'.repeat(32)}`;
    const rail: RailOwnershipResult = {
      status: {
        state: 'BROADCAST_PENDING',
        phase: 'schedule',
        network: 'baseSepolia',
        scheduledFor: null,
        approvals: [],
        broadcastTransaction: null,
        broadcast: null,
        submission: {
          transactionHash,
          submittedBy: walletAddress,
          submittedAt: 1_800_000_002,
        },
      },
      decisionReceipt: {
        title: 'Schedule ownership',
        network: 'Base Sepolia',
        financialEffect: 'Test-network gas only',
        customerImpact: 'No customer funds move',
        reversibility: 'Timelock delay applies',
        requiredApprovers: 'Owner plus one coadministrator',
      },
    };

    component.workspace.set(workspace());
    component.railOwnership.set(rail);
    fixture.detectChanges();

    const text = (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
    expect(component.railStateLabel()).toBe('Submitted to Base Sepolia');
    expect(text).toContain('You do not need to submit it again');
    expect(text).toContain(transactionHash);
    expect(text).not.toContain('Schedule 24-hour handoff');
  });

  it('explains the timelock wait without sending the administrator to a script', () => {
    const rail: RailOwnershipResult = {
      status: {
        state: 'WAITING_FOR_DELAY',
        phase: 'execute',
        network: 'baseSepolia',
        scheduledFor: 1_900_000_000,
        approvals: [],
        broadcastTransaction: null,
        broadcast: null,
        submission: null,
      },
      decisionReceipt: {
        title: 'Accept ownership',
        network: 'Base Sepolia',
        financialEffect: 'Test-network gas only',
        customerImpact: 'No customer funds move',
        reversibility: 'Final after approval',
        requiredApprovers: 'Owner plus one coadministrator',
      },
    };

    component.workspace.set(workspace());
    component.railOwnership.set(rail);
    fixture.detectChanges();

    const text = (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
    expect(text).toContain('Safety delay in progress');
    expect(text).toContain('No action is needed yet');
    expect(text).toContain('Final acceptance');
    expect(component.railActionLabel()).toBe('Check now');
    expect(text).not.toContain('execute package');
    expect(text).not.toContain('calldata');
  });

  it('resumes the active launch from the connected wallet and maps the role automatically', async () => {
    const current = workspace();
    launch.resumeChallenge.and.resolveTo({
      nonce: 'resume-nonce',
      expiresAt: 1_900_000_000,
      typedData,
    });
    launch.resumeLogin.and.resolveTo(current.session);
    launch.workspace.and.resolveTo(current);

    await component.signIn('injected');
    fixture.detectChanges();

    expect(wallet.connectInjected).toHaveBeenCalled();
    expect(wallet.signLaunchAction).toHaveBeenCalledOnceWith(typedData, undefined);
    expect(launch.resumeLogin).toHaveBeenCalledOnceWith(
      walletAddress,
      'resume-nonce',
      '0xresume',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Signed in as Owner, Administrator 1',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Select slot');
  });

  it('enrolls the owner into slot 1 from a one-time secure link', async () => {
    component.ownerToken.set('private-owner-token');
    component.ownerName = 'Owner Admin';
    launch.claimOwner.and.resolveTo({
      claimed: true,
      ceremonyId,
      ownerEnrollmentToken: 'owner-enrollment-token',
      enrollmentExpiresAt: 1_900_000_000,
      sessionExpiresAt: 1_900_000_000,
    });
    launch.prepareInvitation.and.resolveTo({
      ceremonyBinding: {ceremonyId, evmChainId:11155111},
      ceremonyId,
      slot: 1,
      expiresAt: 1_900_000_000,
      typedData,
    });
    launch.acceptInvitation.and.resolveTo();
    launch.resumeChallenge.and.resolveTo({
      nonce: 'resume-nonce',
      expiresAt: 1_900_000_000,
      typedData,
    });
    launch.resumeLogin.and.resolveTo(workspace().session);
    launch.workspace.and.resolveTo(workspace());

    await component.claimOwner('injected');

    expect(launch.claimOwner).toHaveBeenCalledOnceWith({
      token: 'private-owner-token',
      displayName: 'Owner Admin',
      email: undefined,
      timezone: component.timezone,
    });
    expect(launch.acceptInvitation).toHaveBeenCalledOnceWith(
      'owner-enrollment-token',
      walletAddress,
      '0xsigned',
    );
    expect(component.workspace()?.session.slot).toBe(1);
  });

  it('prepares only the fixed nine-output funding receipt with the 530-mojo bridge input', async () => {
    launch.workspace.and.resolveTo(workspace());
    const outputs = [
      { name: 'adminAuthority', amount: 1, coinId: `0x${'01'.repeat(32)}` },
      { name: 'bridgeBatch', amount: 530, coinId: `0x${'02'.repeat(32)}` },
      { name: 'did', amount: 1, coinId: `0x${'03'.repeat(32)}` },
      { name: 'governance', amount: 1, coinId: `0x${'04'.repeat(32)}` },
      { name: 'navRegistry', amount: 1, coinId: `0x${'05'.repeat(32)}` },
      { name: 'pool', amount: 1, coinId: `0x${'06'.repeat(32)}` },
      { name: 'protocolConfig', amount: 1, coinId: `0x${'07'.repeat(32)}` },
      { name: 'sgt', amount: 1_000_022, coinId: `0x${'08'.repeat(32)}` },
      { name: 'vaultVersionRegistry', amount: 1, coinId: `0x${'09'.repeat(32)}` },
    ];
    launch.prepareFunding.and.resolveTo({
      receipt: {
        plan: {
          sourceCoinId: `0x${'44'.repeat(32)}`,
          sourceAmount: 2_000_000,
          fee: 0,
          outputs,
          fundingCoinIds: Object.fromEntries(
            outputs.map((output) => [output.name, output.coinId]),
          ),
          changeAmount: 999_442,
        },
        planHash: `0x${'55'.repeat(32)}`,
        state: 'prepared',
        createdAt: 1_800_000_000,
        updatedAt: 1_800_000_000,
      },
      summary: {
        sourceBalanceMojos: 2_000_000,
        totalMojos: 1_000_558,
        feeMojos: 0,
        outputs: outputs.map((output) => ({
          purpose: output.name,
          amountMojos: output.amount,
        })),
        bridgeBatchMojos: 530,
        customizationAllowed: false,
      },
    });

    await component.prepareFunding();
    fixture.detectChanges();

    expect(component.fundingPreparation()?.summary.customizationAllowed).toBeFalse();
    expect(component.fundingPreparation()?.summary.bridgeBatchMojos).toBe(530);
    expect(component.fundingReceipt()?.plan.outputs.length).toBe(9);
    expect(fixture.nativeElement.textContent).toContain('Less than 0.000002 XCH');
    expect(fixture.nativeElement.textContent).toContain('cannot be changed');
    expect(fixture.nativeElement.textContent).toContain('Exact mojos');
    expect(fixture.nativeElement.textContent).toContain('530');
  });

  it('keeps final broadcast behind an approved, open ceremony-only window', async () => {
    const current = workspace('plan_approved');
    current.nextTask = {
      title: 'Prepare final launch',
      body: 'Open the bounded broadcast window.',
      assignedRole: 'owner',
      action: 'preflight',
    };
    current.gates.ceremonyBroadcast = {
      name: 'ceremonyBroadcast',
      network: 'testnet11',
      opensAt: 1_800_000_000,
      closesAt: 1_800_000_900,
      state: 'closed',
      configuredState: 'enabled',
      payloadHash: `0x${'66'.repeat(32)}`,
      updatedAt: 1_800_000_000,
    };
    launch.workspace.and.resolveTo(current);
    launch.proposeGate.and.resolveTo({
      gate: { ...current.gates.ceremonyBroadcast, state: 'pending' },
      decisionReceipt: {
        title: 'Open final launch window',
        network: 'testnet11',
        financialEffect: 'No fee',
        customerImpact: 'Allows only the approved genesis bundle',
        reversibility: 'Closes automatically',
        requiredApprovers: 'Owner plus one coadministrator',
      },
    });
    launch.prepareAction.and.resolveTo({
      actionId: 'gate-action',
      payloadHash: `0x${'77'.repeat(32)}`,
      expiresAt: 1_900_000_000,
      typedData,
      typedDataHash: `0x${'88'.repeat(32)}`,
      decisionReceipt: {
        title: 'Open final launch window',
        network: 'testnet11',
        financialEffect: 'No fee',
        customerImpact: 'Allows only the approved genesis bundle',
        reversibility: 'Closes automatically',
        requiredApprovers: 'Owner plus one coadministrator',
      },
    });

    component.workspace.set(current);
    await component.runPrimaryAction();

    expect(launch.broadcast).not.toHaveBeenCalled();
    expect(component.pendingDecision()?.kind).toBe('action');
    expect(component.decisionReceipt()?.customerImpact).toContain(
      'only the approved genesis bundle',
    );
  });

  it('summarizes readiness and keeps protected setup out of the owner workflow', async () => {
    const current = workspace();
    current.nextTask = {
      title: 'Finish the fixed launch coordinates',
      body: 'The protected mint signer is not installed yet.',
      assignedRole: 'technical-coadmin',
      action: 'replacePlanEvidence',
    };
    current.readiness[1].status = 'Blocked';
    launch.workspace.and.resolveTo(current);
    component.workspace.set(current);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('1 of 2 ready');
    expect(text).toContain('1 item still needs attention');
    expect(text).toContain('Check setup again');
    expect(text).toContain('No administrator should paste keys');
    expect(text).toContain('Setup needed');
    expect(text).not.toContain('Complete the fixed launch coordinates');

    await component.runPrimaryAction();

    expect(launch.workspace).toHaveBeenCalled();
    expect(launch.buildPlan).not.toHaveBeenCalled();
    expect(component.message()).toBe('Solslot checked the launch services again.');
  });

  it('moves the customer payment check after the signed launch archive', () => {
    const beforeLaunch = workspace('roster_open');
    beforeLaunch.readiness.push({
      id: 'settlement',
      title: 'Customer payment activation',
      status: 'Waiting',
      impact: 'This check follows protocol launch.',
      assignedRole: 'coadmin',
    });
    component.workspace.set(beforeLaunch);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Run the customer payment check');

    const launched = workspace('locked');
    launched.readiness.push({
      id: 'settlement',
      title: 'Customer payment activation',
      status: 'Needs action',
      impact: 'Prove delivery and an exact refund before customer sales.',
      assignedRole: 'coadmin',
    });
    component.workspace.set(launched);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Run the customer payment check');
    expect(text).toContain('Complete two Stripe test purchases');
    expect(text).toContain('Stripe test mode');
    expect(text).toContain('Send a test payment');
    expect(text).toContain('Prove a full refund');
    expect(text).toContain('Unlock sales controls');
  });
  it('shows XCH vouchers off when readiness is absent, even with a stale open gate', () => {
    const current = workspace('locked');
    current.gates.xchVouchers = {name: 'xchVouchers', network: 'testnet11', opensAt: 1,
      closesAt: 2_000_000_000, state: 'open', configuredState: 'open', payloadHash: 'hash', updatedAt: 1};
    component.workspace.set(current);
    expect(component.operationGateNames).toContain('xchVouchers');
    expect(component.canOpenXchVouchers()).toBeFalse();
    expect(component.gateOpen('xchVouchers')).toBeFalse();
    expect(component.gateHelp('xchVouchers')).toContain('stablecoins or Stripe');
  });

  it('uses the authenticated off endpoint and refreshes the server state', async () => {
    launch.closeXchVouchers.and.resolveTo({} as any);
    launch.workspace.and.resolveTo(workspace('locked'));
    await component.closeXchVouchers();
    expect(launch.closeXchVouchers).toHaveBeenCalledTimes(1);
    expect(launch.workspace).toHaveBeenCalled();
    expect(component.gateOpen('xchVouchers')).toBeFalse();
  });

});
