import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import {
  OmnichainOwnershipActivationService,
  OwnershipActivationStatus,
} from './omnichain-ownership-activation.service';

const status: OwnershipActivationStatus = {
  schemaVersion: 1,
  state: 'AWAITING_APPROVALS',
  packageHash: `0x${'11'.repeat(32)}`,
  sourceSha: '22'.repeat(20),
  network: 'baseSepolia',
  chainId: 84532,
  phase: 'schedule',
  operationId: `0x${'33'.repeat(32)}`,
  rootSafe: '0xb7e02C216A2B3aF0cC4Ad8808fA169f2F0B19724',
  timelock: '0x5eC98d5a9C24C2a80957AB04630812C36807aad3',
  rootSafeTransactionHash: `0x${'44'.repeat(32)}`,
  scheduledFor: null,
  approvals: [],
  broadcastTransaction: null,
  broadcast: null,
};

describe('OmnichainOwnershipActivationService', () => {
  let http: HttpTestingController;
  let service: OmnichainOwnershipActivationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AdminSessionService, useValue: { requireJwt: () => 'admin-jwt' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(OmnichainOwnershipActivationService);
  });

  afterEach(() => http.verify());

  it('loads the authenticated immutable activation status', async () => {
    const result = service.get();
    const request = http.expectOne(
      `${environment.faucetApi}/admin/omnichain/ownership-activation`,
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer admin-jwt');
    request.flush(status);
    expect(await result).toEqual(status);
  });

  it('submits only the Safe signature and records only the wallet transaction hash', async () => {
    const signature = `0x${'55'.repeat(65)}`;
    const signed = service.sign(signature);
    const signRequest = http.expectOne(
      `${environment.faucetApi}/admin/omnichain/ownership-activation/sign`,
    );
    expect(signRequest.request.body).toEqual({ signature });
    signRequest.flush(status);
    await signed;

    const transactionHash = `0x${'66'.repeat(32)}`;
    const broadcast = service.recordBroadcast(transactionHash);
    const broadcastRequest = http.expectOne(
      `${environment.faucetApi}/admin/omnichain/ownership-activation/broadcast`,
    );
    expect(broadcastRequest.request.body).toEqual({ transactionHash });
    broadcastRequest.flush(status);
    await broadcast;
  });
});
