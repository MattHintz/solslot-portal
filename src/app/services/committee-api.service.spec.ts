import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import {
  CommitteeApiService,
  PublishProposalMetadataJson,
  SpendBundleJson,
} from './committee-api.service';
import { environment } from '../../environments/environment';
import { AdminOperationApprovalService } from './admin-operation-approval.service';

function fakeBundle(): SpendBundleJson {
  return {
    coin_spends: [
      {
        coin: {
          parent_coin_info: '0x' + '11'.repeat(32),
          puzzle_hash: '0x' + '22'.repeat(32),
          amount: 100,
        },
        puzzle_reveal: '0xff01',
        solution: '0xff80',
      },
    ],
    aggregated_signature: '0x' + 'c0'.repeat(96),
  };
}

function fakeMetadata(): PublishProposalMetadataJson {
  return {
    property_id: 'PROPERTY-1',
    collection_id: 'COLLECTION-1',
    asset_class_name: 'RWA-RE-RES',
    property_id_canon: '0x' + '01'.repeat(32),
    collection_id_canon: '0x' + '09'.repeat(32),
    share_ppm: 750_000,
    property_registry_coin_id: '0x' + '07'.repeat(32),
    property_registry_puzzle_hash: '0x' + '08'.repeat(32),
    par_value_mojos: 1_000_000,
    asset_class: 1,
    jurisdiction: '0x5553',
    royalty_puzhash: '0x' + '02'.repeat(32),
    royalty_bps: 250,
    quorum_threshold: 5000,
    owner_member_hash: '0x' + '03'.repeat(32),
    gov_member_hash: '0x' + '04'.repeat(32),
    voting_deadline: 1_700_000_000,
  };
}

describe('CommitteeApiService', () => {
  let service: CommitteeApiService;
  let http: HttpTestingController;
  let approvals: jasmine.SpyObj<AdminOperationApprovalService>;

  beforeEach(() => {
    approvals = jasmine.createSpyObj<AdminOperationApprovalService>(
      'AdminOperationApprovalService',
      ['prepareSignAndRequireSecond'],
    );
    approvals.prepareSignAndRequireSecond.and.rejectWith(new Error('approval pending'));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AdminOperationApprovalService, useValue: approvals },
      ],
    });
    service = TestBed.inject(CommitteeApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('POSTs spend_bundle to /admin/committee/vote without proposal_id', async () => {
    const bundle = fakeBundle();
    const pending = service.castVote(bundle);
    const req = http.expectOne(`${environment.faucetApi}/admin/committee/vote`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    expect(req.request.body).toEqual({ spend_bundle: bundle });
    req.flush({
      pushed: true,
      status: 'SUCCESS',
      spend_bundle_id: '0x' + 'ab'.repeat(32),
    });
    const result = await pending;
    expect(result.pushed).toBe(true);
    expect(result.status).toBe('SUCCESS');
    expect(result.spendBundleId).toBe('0x' + 'ab'.repeat(32));
    expect(result.proposalId).toBeUndefined();
  });

  it('includes proposal_id in the request body when provided', async () => {
    const bundle = fakeBundle();
    const proposalId = '0x' + 'cd'.repeat(32);
    const pending = service.castVote(bundle, proposalId);
    const req = http.expectOne(`${environment.faucetApi}/admin/committee/vote`);
    expect(req.request.body).toEqual({
      spend_bundle: bundle,
      proposal_id: proposalId,
    });
    req.flush({
      pushed: true,
      status: 'SUCCESS',
      spend_bundle_id: '0x' + 'ab'.repeat(32),
      proposal_id: proposalId,
    });
    const result = await pending;
    expect(result.proposalId).toBe(proposalId);
  });

  it('surfaces pushed=false with chain status on mempool rejection', async () => {
    const pending = service.castVote(fakeBundle());
    const req = http.expectOne(`${environment.faucetApi}/admin/committee/vote`);
    req.flush({
      pushed: false,
      status: 'BAD_AGGREGATE_SIGNATURE',
      spend_bundle_id: '0x' + 'ab'.repeat(32),
    });
    const result = await pending;
    expect(result.pushed).toBe(false);
    expect(result.status).toBe('BAD_AGGREGATE_SIGNATURE');
  });

  it('rejects on HTTP errors so the caller can surface them', async () => {
    const pending = service.castVote(fakeBundle());
    const req = http.expectOne(`${environment.faucetApi}/admin/committee/vote`);
    req.flush('coinset offline', {
      status: 502,
      statusText: 'Bad Gateway',
    });
    await expectAsync(pending).toBeRejected();
  });

  // ── publishProposal (mint PROPOSE forwarder) ──────────────────────────

  it('binds the complete canonical publish request for owner-plus-one approval', async () => {
    const bundle = fakeBundle();
    const metadata = fakeMetadata();
    const pending = service.publishProposal(bundle, 'draft-123', metadata);
    expect(approvals.prepareSignAndRequireSecond).toHaveBeenCalledOnceWith({
      operation: 'mint.publish',
      revision: 0,
      binding: {
        method: 'POST',
        path: '/admin/committee/propose',
        query: [],
        body: {
          spend_bundle: bundle,
          proposal_id: 'draft-123',
          proposal_metadata: metadata,
        },
      },
    });
    await expectAsync(pending).toBeRejectedWithError('approval pending');
  });

  it('binds canonical execution bundles for owner-plus-one approval', async () => {
    const bundle = fakeBundle();
    const pending = service.executeProposal(bundle, 'draft-123');
    expect(approvals.prepareSignAndRequireSecond).toHaveBeenCalledOnceWith({
      operation: 'mint.execute',
      revision: 0,
      binding: {
        method: 'POST',
        path: '/admin/committee/execute',
        query: [],
        body: {
          spend_bundle: bundle,
          proposal_id: 'draft-123',
        },
      },
    });
    await expectAsync(pending).toBeRejectedWithError('approval pending');
  });
});
