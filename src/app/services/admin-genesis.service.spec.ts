import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { environment } from '../../environments/environment';
import { AdminGenesisService } from './admin-genesis.service';

describe('AdminGenesisService', () => {
  let service: AdminGenesisService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AdminGenesisService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('checks deployment status with the pasted one-shot token', async () => {
    const promise = service.getDeployment(' token-123 ');

    const req = http.expectOne(`${environment.faucetApi}/admin/deployment`);
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-123');
    req.flush({ deployed: false, manifest: null });

    await expectAsync(promise).toBeResolvedTo({ deployed: false, manifest: null });
  });

  it('dry-runs protocol deployment without pushing or persisting', async () => {
    const promise = service.dryRunProtocolDeploy('genesis-token', {
      quorum_bps: 6000,
      pgt_total_supply: 2_000_000,
    });

    const req = http.expectOne(`${environment.faucetApi}/admin/deploy/protocol`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer genesis-token');
    expect(req.request.body).toEqual({
      quorum_bps: 6000,
      pgt_total_supply: 2_000_000,
      dry_run: true,
    });
    req.flush({
      spend_bundle_id: null,
      pushed: false,
      manifest: { pool_launcher_id: '0x' + '11'.repeat(32) },
    });

    const result = await promise;
    expect(result.pushed).toBeFalse();
    expect(result.manifest['pool_launcher_id']).toBe('0x' + '11'.repeat(32));
  });

  it('pushes protocol deployment when dry_run is not set by the caller', async () => {
    const promise = service.deployProtocol('genesis-token', { fee_per_spend: 1 });

    const req = http.expectOne(`${environment.faucetApi}/admin/deploy/protocol`);
    expect(req.request.body).toEqual({ fee_per_spend: 1 });
    req.flush({
      spend_bundle_id: '0x' + 'aa'.repeat(32),
      pushed: true,
      manifest: { tracker_launcher_id: '0x' + '22'.repeat(32) },
    });

    const result = await promise;
    expect(result.pushed).toBeTrue();
    expect(result.spend_bundle_id).toBe('0x' + 'aa'.repeat(32));
  });

  it('rejects blank tokens before making HTTP requests', async () => {
    await expectAsync(service.getDeployment('   ')).toBeRejectedWithError(/token is required/);
    http.expectNone(`${environment.faucetApi}/admin/deployment`);
  });
});
