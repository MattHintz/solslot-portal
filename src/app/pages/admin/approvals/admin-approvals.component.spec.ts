import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminApprovalsComponent } from './admin-approvals.component';
import { AdminSessionService } from '../../../services/admin-session.service';
import { AdminOperationApproval, AdminOperationApprovalService } from '../../../services/admin-operation-approval.service';

describe('Mint approval completion', () => {
  it('allows the original proposer to complete while the second signer retains the approval', async () => {
    const subject = signal('coadmin');
    const item = { operationId: 'mint', operation: 'mint.publish', status: 'approved', createdBy: 'owner',
      network: 'testnet11', createdAt: 1, expiresAt: 2_000_000_000,
      signatures: [{ signerAddress: 'owner', adminIndex: 0 }, { signerAddress: 'coadmin', adminIndex: 1 }],
      requestBinding: { method: 'POST', path: '/admin/committee/propose', query: [], body: {} },
    } as unknown as AdminOperationApproval;
    const api = jasmine.createSpyObj<AdminOperationApprovalService>('approvals', ['list', 'execute']);
    api.list.and.resolveTo({ operations: [item], count: 1 });
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
    TestBed.configureTestingModule({providers: [provideRouter([]),
      {provide: AdminSessionService, useValue: {subject: signal('owner')}},
      {provide: AdminOperationApprovalService, useValue: {}},
    ]});
    const component = TestBed.runInInjectionContext(() => new AdminApprovalsComponent());
    const rows = component.identityReview({identityReview: {
      amendmentHash: '0xreviewed', currentEvmChainId: 11155111, replacementEvmChainId: 8453,
      currentDeployment: {verifierAdapter: 'old-verifier'},
      replacementDeployment: {addresses: {verifierAdapter: 'base-verifier', attestationEmitter: 'base-emitter'}},
      acceptedProofVersions: ['0.20.0', '0.21.0'], credentialPolicy: {minimumAge: 18, domain: 'solslot.com', sanctions: {lists: 'all'}},
    }} as unknown as AdminOperationApproval);
    expect(rows.find(row => row.label === 'Current identity network')?.value).toBe('Ethereum Sepolia (11155111)');
    expect(rows.find(row => row.label === 'New identity network')?.value).toBe('Base (8453)');
    expect(rows.find(row => row.label === 'Replacement verifier')?.value).toBe('base-verifier');
    expect(rows.find(row => row.label === 'Checks')?.value).toBe('Age 18+ · sanctions all');
    expect(component.identityNetworkName(1)).toBe('Network details unavailable');
  });
});
