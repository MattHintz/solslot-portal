import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { GovernanceQueueService } from './governance-queue.service';

describe('GovernanceQueueService', () => {
  let service: GovernanceQueueService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AdminSessionService, useValue: { requireJwt: () => 'admin-jwt' } },
      ],
    });
    service = TestBed.inject(GovernanceQueueService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates a typed sale with administrator authentication', async () => {
    const input = {
      kind: 'SGT_SALE' as const,
      title: 'Governed sale',
      sgtAmount: '25000',
      recipientVaultLauncherId: '0x' + '10'.repeat(32),
      saleId: '0x' + '11'.repeat(32),
      paymentRail: 'XCH' as const,
      paymentAmount: '2500000000000',
      expiresAt: 1_900_000_000,
    };
    const promise = service.create(input);
    const request = http.expectOne(`${environment.faucetApi}/admin/governance/proposals`);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer admin-jwt');
    expect(request.request.body).toEqual(input);
    request.flush({ id: 'GOV-1', state: 'DRAFT' });
    expect((await promise).id).toBe('GOV-1');
  });

  it('loads only server-authorized SGT sale payment rails', async () => {
    const promise = service.allocationOptions();
    const request = http.expectOne(
      `${environment.faucetApi}/admin/governance/sgt-allocation-options`,
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer admin-jwt');
    request.flush({
      paymentRails: [
        { id: 'XCH', label: 'XCH', decimals: 12 },
        { id: 'WUSDC_B', label: 'wUSDC.b', decimals: 3, assetId: '0x' + '22'.repeat(32) },
      ],
    });
    expect((await promise).map((rail) => rail.id)).toEqual(['XCH', 'WUSDC_B']);
  });

  it('binds a state transition to the current revision', async () => {
    const proposal = { id: 'GOV-2', revision: 7 } as any;
    const promise = service.transition(proposal, 'READY');
    const request = http.expectOne(
      `${environment.faucetApi}/admin/governance/proposals/GOV-2/transition`,
    );
    expect(request.request.headers.get('If-Match')).toBe('"7"');
    expect(request.request.body).toEqual({ target: 'READY' });
    request.flush({ id: 'GOV-2', state: 'READY', revision: 8 });
    expect((await promise).state).toBe('READY');
  });

  it('requests an exact owner-plus-one publication package', async () => {
    const promise = service.package('GOV-3', 2);
    const request = http.expectOne(
      `${environment.faucetApi}/admin/governance/proposals/GOV-3/publication/package`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ coadminSlot: 2, renewExpired: false });
    expect(request.request.headers.get('Authorization')).toBe('Bearer admin-jwt');
    request.flush({ proposal: { id: 'GOV-3' }, actions: [], readyToSubmit: false });
    expect((await promise).proposal.id).toBe('GOV-3');
  });

  it('requests an explicit renewal without submitting a transaction', async () => {
    const promise = service.package('GOV-3', 1, true);
    const request = http.expectOne(`${environment.faucetApi}/admin/governance/proposals/GOV-3/publication/package`);
    expect(request.request.body).toEqual({ coadminSlot: 1, renewExpired: true });
    request.flush({ proposal: { id: 'GOV-3' }, actions: [], readyToSubmit: false });
    expect((await promise).readyToSubmit).toBeFalse();
  });

  it('checks existing signatures through an authenticated read', async () => {
    const promise = service.publicationStatus('GOV-3');
    const request = http.expectOne(`${environment.faucetApi}/admin/governance/proposals/GOV-3/publication/status`);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer admin-jwt');
    request.flush({ proposal:{ id:'GOV-3' }, actions:[], readyToSubmit:true });
    expect((await promise).readyToSubmit).toBeTrue();
  });

  it('submits only the server-built publication package', async () => {
    const promise = service.submit('GOV-4', 1);
    const request = http.expectOne(
      `${environment.faucetApi}/admin/governance/proposals/GOV-4/publication/submit`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ coadminSlot: 1 });
    request.flush({ proposal: { id: 'GOV-4', state: 'ACTIVE' } });
    expect((await promise).proposal.state).toBe('ACTIVE');
  });

  it('reconstructs committee progress from the chain', async () => {
    const promise = service.reconcile('GOV-5');
    const request = http.expectOne(
      `${environment.faucetApi}/admin/governance/proposals/GOV-5/reconcile`,
    );
    expect(request.request.method).toBe('POST');
    request.flush({
      proposal: { id: 'GOV-5', state: 'ACTIVE' },
      chainState: 'AWAITING_EXECUTE',
      voteTally: '500000',
      votingDeadline: 1_900_000_000,
    });
    expect((await promise).chainState).toBe('AWAITING_EXECUTE');
  });

  it('finalizes only the server-reconstructed allocation bundle', async () => {
    const promise = service.execute('GOV-6');
    const request = http.expectOne(
      `${environment.faucetApi}/admin/governance/proposals/GOV-6/execute`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({
      proposal: {
        id: 'GOV-6',
        state: 'ACTIVE',
        executionBundleId: '0x' + '66'.repeat(32),
      },
      chainState: 'EXECUTION_PENDING',
      submission: { spendBundleId: '0x' + '66'.repeat(32) },
    });
    expect((await promise).submission?.spendBundleId).toBe('0x' + '66'.repeat(32));
  });

  it('prepares and completes a vault vote through the owner-session cookie', async () => {
    const launcher = '0x' + '71'.repeat(32);
    const prepare = service.prepareVaultVote('GOV-7', launcher, '10000');
    const prepareRequest = http.expectOne(
      `${environment.faucetApi}/governance/proposals/GOV-7/vaults/${launcher}/votes/prepare`,
    );
    expect(prepareRequest.request.method).toBe('POST');
    expect(prepareRequest.request.withCredentials).toBeTrue();
    expect(prepareRequest.request.headers.has('Authorization')).toBeFalse();
    expect(prepareRequest.request.body).toEqual({ voteAmount: '10000' });
    prepareRequest.flush({
      schemaVersion: 1,
      proposalId: 'GOV-7',
      operationHash: '0x' + '72'.repeat(32),
    });
    expect((await prepare).proposalId).toBe('GOV-7');

    const complete = service.completeVaultVote('GOV-7', launcher, {
      voteAmount: '10000',
      operationHash: '0x' + '72'.repeat(32),
      aggregatedSignature: '0x' + '73'.repeat(96),
    });
    const completeRequest = http.expectOne(
      `${environment.faucetApi}/governance/proposals/GOV-7/vaults/${launcher}/votes/complete`,
    );
    expect(completeRequest.request.withCredentials).toBeTrue();
    expect(completeRequest.request.body['aggregatedSignature']).toBe('0x' + '73'.repeat(96));
    completeRequest.flush({
      schemaVersion: 1,
      proposalId: 'GOV-7',
      spendBundleId: '0x' + '74'.repeat(32),
    });
    expect((await complete).spendBundleId).toBe('0x' + '74'.repeat(32));
  });
});
