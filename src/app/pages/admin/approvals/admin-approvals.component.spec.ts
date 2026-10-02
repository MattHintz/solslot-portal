import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminApprovalsComponent } from './admin-approvals.component';
import { AdminSessionService } from '../../../services/admin-session.service';
import { AdminOperationApproval, AdminOperationApprovalService } from '../../../services/admin-operation-approval.service';
import { AdminStatusRefresh } from '../../../services/admin-status-refresh.service';

describe('Mint approval completion', () => {
  it('allows the original proposer to complete while the second signer retains the approval', async () => {
    const subject = signal('coadmin');
    const item = { operationId: 'mint', operation: 'mint.publish', status: 'approved', createdBy: 'owner',
      network: 'testnet11', createdAt: 1, expiresAt: 2_000_000_000,
      signatures: [{ signerAddress: 'owner', adminIndex: 0 }, { signerAddress: 'coadmin', adminIndex: 1 }],
      requestBinding: { method: 'POST', path: '/admin/committee/propose', query: [], body: {} },
    } as unknown as AdminOperationApproval;
    const api = jasmine.createSpyObj<AdminOperationApprovalService>('approvals', ['list', 'get', 'execute']);
    api.list.and.resolveTo({ operations: [item], count: 1 });
    api.get.and.resolveTo(item);
    api.execute.and.resolveTo({});
    await TestBed.configureTestingModule({ imports: [AdminApprovalsComponent], providers: [provideRouter([]),
      { provide: AdminOperationApprovalService, useValue: api },
      { provide: AdminSessionService, useValue: { subject } },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(AdminApprovalsComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const complete = () => Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.includes('Complete approved action'))!;
    expect(complete().disabled).toBeTrue();
    await fixture.componentInstance.execute();
    expect(api.execute).not.toHaveBeenCalled();
    subject.set('owner');
    fixture.detectChanges();
    expect(complete().disabled).toBeFalse();
    complete().click();
    await fixture.whenStable();
    expect(api.execute).toHaveBeenCalledOnceWith(item);
  });
});

describe('Identity network review', () => {
  it('shows the current and replacement networks with the reviewed contracts', () => {
    TestBed.configureTestingModule({providers: [provideRouter([]), AdminStatusRefresh,
      {provide: AdminSessionService, useValue: {subject: signal('owner')}},
      {provide: AdminOperationApprovalService, useValue: {list: () => Promise.resolve({operations: [], count: 0})}},
    ]});
    const component = TestBed.runInInjectionContext(() => new AdminApprovalsComponent());
    const rows = component.identityReview({identityReview: {
      amendmentHash: '0xreviewed', currentEvmChainId: 11155111, replacementEvmChainId: 8453,
      currentDeployment: {verifierAdapter: 'old-verifier'},
      replacementDeployment: {addresses: {verifierAdapter: 'base-verifier', attestationEmitter: 'base-emitter'}},
      acceptedProofVersions: ['0.20.0', '0.21.0'], credentialPolicy: {minimumAge: 18, domain: 'solslot.com', realDocumentOnly: true, devMode: false, sanctions: {lists: 'all'}},
    }} as unknown as AdminOperationApproval);
    expect(rows.find(row => row.label === 'Current identity network')?.value).toBe('Ethereum Sepolia (11155111)');
    expect(rows.find(row => row.label === 'New identity network')?.value).toBe('Base (8453)');
    expect(rows.find(row => row.label === 'Replacement verifier')?.value).toBe('base-verifier');
    expect(rows.find(row => row.label === 'Checks')?.value).toBe('Age 18+ · sanctions all');
    expect(component.identityNetworkName(1)).toBe('Network details unavailable');
  });
});

describe('Approval inbox recovery and refresh', () => {
  const hash = `0x${'77'.repeat(32)}`;
  const base = {
    operationId: 'identity', operation: 'identity.activate', status: 'pending', createdBy: 'owner',
    network: 'testnet11', revision: 2, createdAt: 1, expiresAt: Math.floor(Date.now() / 1000) + 600,
    signatures: [{signerAddress: 'owner', adminIndex: 0}],
    typedData: {message: {operation: 'identity.activate'}},
    requestBinding: {method: 'POST', path: '/admin/identity-deployment/activate', query: [], body: {amendmentHash: hash, revision: 2}},
  } as unknown as AdminOperationApproval;
  const detailed = {...base, identityReview: {
    amendmentHash: hash, revision: 2, approvalExpiresAt: base.expiresAt,
    currentEvmChainId: 11155111, replacementEvmChainId: 8453,
    currentDeployment: {verifierAdapter: 'old-verifier'},
    replacementDeployment: {addresses: {verifierAdapter: 'base-verifier', attestationEmitter: 'base-emitter'}},
    acceptedProofVersions: ['0.20.0', '0.21.0'], credentialPolicy: {minimumAge: 18, domain: 'solslot.com', realDocumentOnly: true, devMode: false, sanctions: {lists: 'all'}},
  }} as AdminOperationApproval;
  let api: jasmine.SpyObj<AdminOperationApprovalService>;
  let fixture: ReturnType<typeof TestBed.createComponent<AdminApprovalsComponent>>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('approvals', ['list', 'get', 'sign', 'execute', 'prepareIdentityDeployment']);
    api.list.and.resolveTo({operations: [base], count: 1});
    api.get.and.resolveTo(detailed);
    await TestBed.configureTestingModule({imports: [AdminApprovalsComponent], providers: [provideRouter([]),
      {provide: AdminSessionService, useValue: {subject: signal('owner'), authoritySlot: () => 0}},
      {provide: AdminOperationApprovalService, useValue: api},
    ]}).compileComponents();
    fixture = TestBed.createComponent(AdminApprovalsComponent);
    await fixture.whenStable(); fixture.detectChanges();
  });

  it('reconstructs complete identity details from a lightweight list after navigation', () => {
    expect(api.get).toHaveBeenCalledWith('identity');
    expect(fixture.nativeElement.textContent).toContain('Base (8453)');
    expect(fixture.nativeElement.textContent).toContain('Ethereum Sepolia (11155111)');
    expect(fixture.nativeElement.textContent).toContain('Age 18+ · sanctions all');
    expect(fixture.nativeElement.textContent).toContain('Waiting for the other required administrator');
  });

  it('blocks signatures and execution as the window expires without a reload', async () => {
    const component = fixture.componentInstance;
    component.refresh.now.set(base.expiresAt * 1000);
    await component.sign(); await component.execute(); fixture.detectChanges();
    expect(api.sign).not.toHaveBeenCalled(); expect(api.execute).not.toHaveBeenCalled();
    expect(component.canPrepareIdentity()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('This approval window has expired');
  });

  it('keeps signing closed when the complete review cannot be read', async () => {
    api.get.and.rejectWith(new Error('review unavailable'));
    await fixture.componentInstance.reload(); fixture.detectChanges();
    expect(fixture.componentInstance.reviewReady(fixture.componentInstance.approval()!)).toBeFalse();
    await fixture.componentInstance.sign();
    expect(api.sign).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('complete network and contract review is not available');
  });

  it('preserves the selected approval when new requests arrive and the order changes', async () => {
    const another = {...base, operationId: 'second'};
    fixture.componentInstance.approval.set(another);
    api.list.and.resolveTo({operations: [base, another], count: 2});
    api.get.and.resolveTo({...detailed, operationId: 'second'});
    await fixture.componentInstance.reload();
    expect(fixture.componentInstance.approval()?.operationId).toBe('second');
  });

  it('opening a fresh review does not sign or execute it', async () => {
    fixture.componentInstance.operations.set([]);
    api.list.and.resolveTo({operations: [base], count: 1});
    api.prepareIdentityDeployment.and.resolveTo(detailed);
    await fixture.componentInstance.prepareIdentity();
    expect(api.sign).not.toHaveBeenCalled(); expect(api.execute).not.toHaveBeenCalled();
    expect(fixture.componentInstance.notice()).toContain('Review the network');
  });
});
