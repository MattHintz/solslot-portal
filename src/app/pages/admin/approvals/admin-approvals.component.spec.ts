import { sealFixture } from '../../../services/property-metadata/collection-seal-review.fixture';
import { CollectionApiService, CollectionWorkspace } from '../../../services/collection-api.service';
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
    await TestBed.configureTestingModule({ imports: [AdminApprovalsComponent], providers: [provideRouter([]), {provide: CollectionApiService, useValue: {}},
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
    TestBed.configureTestingModule({providers: [provideRouter([]), {provide: CollectionApiService, useValue: {}}, AdminStatusRefresh,
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
    await TestBed.configureTestingModule({imports: [AdminApprovalsComponent], providers: [provideRouter([]), {provide: CollectionApiService, useValue: {}},
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


describe('Property sealing decision receipt', () => {
  let api: jasmine.SpyObj<AdminOperationApprovalService>;
  let collections: jasmine.SpyObj<CollectionApiService>;
  let fixture: ReturnType<typeof TestBed.createComponent<AdminApprovalsComponent>>;
  let item: AdminOperationApproval;
  let workspace: CollectionWorkspace;
  const subject = signal('coadmin');

  beforeEach(async () => {
    ({item, workspace} = sealFixture()); subject.set('coadmin');
    api = jasmine.createSpyObj('approvals', ['list', 'get', 'sign', 'execute']);
    collections = jasmine.createSpyObj('collections', ['get']);
    api.list.and.resolveTo({operations: [item], count: 1});
    collections.get.and.callFake(async () => structuredClone(workspace));
    api.sign.and.resolveTo(item); api.execute.and.resolveTo({...workspace, state: 'SEALED', metadataRoot: workspace.readiness.metadataRoot});
    await TestBed.configureTestingModule({imports: [AdminApprovalsComponent], providers: [provideRouter([]),
      {provide: AdminOperationApprovalService, useValue: api},
      {provide: AdminSessionService, useValue: {subject, authoritySlot: () => 1}},
      {provide: CollectionApiService, useValue: collections},
    ]}).compileComponents();
    fixture = TestBed.createComponent(AdminApprovalsComponent);
    await fixture.whenStable(); fixture.detectChanges();
  });

  it('shows property, exact revision, terms, unresolved facts and effect before a signature', () => {
    const text = fixture.nativeElement.textContent;
    for (const expected of ['Example House', 'Revision 13', 'USD 75,000.00', 'USD 3,000.00 before fee',
      '25 planned SmartDeeds', '4% each', '15% participation based on market value', '14 months',
      '10–12 months', 'US-TN', 'user-confirmed; report details unresolved', 'Payoff evidence not supplied',
      'This does not mint SmartDeeds', 'Approve sealing this revision']) expect(text).toContain(expected);
    expect(text).not.toContain('PRIVATE TITLE MUST NOT APPEAR');
    expect(fixture.componentInstance.operationContext(item)).toContain('TEST-EXAMPLE · revision 13');
    expect(api.sign).not.toHaveBeenCalled(); expect(api.execute).not.toHaveBeenCalled();
  });

  it('lets the second administrator sign but only the property preparer complete sealing', async () => {
    await fixture.componentInstance.sign();
    expect(api.sign).toHaveBeenCalledOnceWith(item.operationId, item.typedData, jasmine.any(Function));
    item.status = 'approved'; item.signatures.push({signerAddress: 'coadmin', adminIndex: 1} as never);
    expect(fixture.componentInstance.canComplete(item)).toBeFalse();
    subject.set('owner');
    expect(fixture.componentInstance.canComplete(item)).toBeTrue();
  });

  it('blocks signing after a failed property read even when an older review was displayed', async () => {
    collections.get.and.rejectWith(new Error('Property unavailable'));
    await fixture.componentInstance.reload(); await fixture.componentInstance.sign(); fixture.detectChanges();
    expect(api.sign).not.toHaveBeenCalled();
    expect(fixture.componentInstance.sealReview()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Property unavailable');
  });

  it('rechecks the exact revision before opening the wallet', async () => {
    workspace.revision++;
    await fixture.componentInstance.sign(); fixture.detectChanges();
    expect(api.sign).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('no longer matches');
  });

  it('requires a new look if the reconstructed root changes before signing', async () => {
    workspace.readiness.metadataRoot = `0x${'66'.repeat(32)}`;
    await fixture.componentInstance.sign();
    expect(api.sign).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toContain('review changed');
  });

  it('rechecks before execution and reports sealing rather than a chain transaction', async () => {
    item.status = 'approved'; subject.set('owner');
    await fixture.componentInstance.execute();
    expect(api.execute).toHaveBeenCalledOnceWith(item);
    expect(fixture.componentInstance.notice()).toContain('Property metadata sealed');
    expect(fixture.componentInstance.notice()).toContain('No SmartDeeds were minted');
  });

  it('does not execute when property readiness is lost', async () => {
    item.status = 'approved'; subject.set('owner'); workspace.readiness.ready = false;
    await fixture.componentInstance.execute();
    expect(api.execute).not.toHaveBeenCalled();
  });

  it('refreshes never prepare, sign or execute an approval', async () => {
    await fixture.componentInstance.reload();
    expect(collections.get).toHaveBeenCalledWith('TEST-EXAMPLE');
    expect(api.sign).not.toHaveBeenCalled(); expect(api.execute).not.toHaveBeenCalled();
  });

  it('shows an expired sealing request after a new login instead of losing its history', async () => {
    const expired = {...item, expiresAt: Math.floor(Date.now() / 1000) - 1};
    api.list.and.callFake(async filter => filter === 'all'
      ? {operations: [expired], count: 1} : {operations: [], count: 0});
    fixture.componentInstance.approval.set(null);
    await fixture.componentInstance.reload(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No active requests');
    expect(fixture.nativeElement.textContent).toContain('Show recent requests');
    await fixture.componentInstance.toggleRecent(); fixture.detectChanges();
    expect(api.list).toHaveBeenCalledWith('all');
    expect(fixture.nativeElement.textContent).toContain('Recent requests');
    expect(fixture.nativeElement.textContent).toContain('This approval window has expired');
    expect(fixture.nativeElement.textContent).toContain('Saved property and content reviews remain');
    const approve = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.includes('Approve sealing this revision'))!;
    expect(approve.disabled).toBeTrue();
    await fixture.componentInstance.sign(); await fixture.componentInstance.execute();
    expect(api.sign).not.toHaveBeenCalled(); expect(api.execute).not.toHaveBeenCalled();
  });

  it('labels a completed request as completed even after its signing deadline passes', async () => {
    const completed = {...item, status: 'consumed' as const, sealExecution: {state:'confirmed' as const}, expiresAt: Math.floor(Date.now() / 1000) - 1};
    api.list.and.resolveTo({operations: [completed], count: 1});
    await fixture.componentInstance.toggleRecent(); fixture.detectChanges();
    expect(fixture.componentInstance.statusLabel(completed)).toBe('Completed');
    expect(fixture.componentInstance.nextStep(completed)).toBe('Metadata sealed. Minting is a separate step.');
    expect(fixture.nativeElement.textContent).toContain('Completion is checked against the saved result');
    expect(api.sign).not.toHaveBeenCalled(); expect(api.execute).not.toHaveBeenCalled();
  });

  it('uses hours for the longer window and identifies the deadline timezone', () => {
    const component = fixture.componentInstance;
    const longer = {...item, expiresAt: Math.floor(component.refresh.now() / 1000) + 86_400};
    expect(component.remaining(longer)).toBe('24h 0m left to approve and execute');
    expect(fixture.nativeElement.textContent).toContain('Request deadline · your local time');
  });

  it('keeps execution failures visible across automatic refresh and rejects an unsealed success response', async () => {
    item.status = 'approved'; subject.set('owner');
    api.execute.and.resolveTo({state:'REVIEW'});
    await fixture.componentInstance.execute();
    expect(fixture.componentInstance.notice()).toBeNull();
    await fixture.componentInstance.reload(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sealing is not confirmed for this exact revision');
    expect(api.execute).toHaveBeenCalledTimes(1);
  });

  it('offers retry only for the exact unfinished seal while preserving deadline and preparer checks', async () => {
    const retry = {...item, status:'consumed' as const, sealExecution:{state:'retry_required' as const}};
    api.list.and.resolveTo({operations:[retry],count:1}); subject.set('owner');
    await fixture.componentInstance.reload(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Retry sealing approved revision');
    expect(fixture.componentInstance.canComplete(retry)).toBeTrue();
    subject.set('coadmin'); expect(fixture.componentInstance.canComplete(retry)).toBeFalse();
    subject.set('owner'); fixture.componentInstance.refresh.now.set(retry.expiresAt*1000);
    expect(fixture.componentInstance.canComplete(retry)).toBeFalse();
    expect(fixture.componentInstance.statusLabel(retry)).toBe('Expired · not sealed');
    expect(api.execute).not.toHaveBeenCalled();
  });
});
