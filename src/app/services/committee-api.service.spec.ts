import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { CommitteeApiService, SpendBundleJson } from './committee-api.service';
import { environment } from '../../environments/environment';

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

describe('CommitteeApiService', () => {
  let service: CommitteeApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
});
