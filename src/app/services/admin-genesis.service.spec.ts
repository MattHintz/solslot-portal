import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { AdminGenesisService, GenesisSourceShas } from './admin-genesis.service';

describe('AdminGenesisService', () => {
  const ceremonyId = '0x' + '11'.repeat(32);
  const sourceShas: GenesisSourceShas = {
    protocol: '1'.repeat(40),
    evm: '2'.repeat(40),
    api: '3'.repeat(40),
    customerWeb: '4'.repeat(40),
    adminPortal: '5'.repeat(40),
  };
  let service: AdminGenesisService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AdminGenesisService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates a frozen-commit draft through the V2 genesis router', async () => {
    const promise = service.createDraft(' token ', sourceShas);
    const req = http.expectOne(`${environment.faucetApi}/admin/genesis/drafts`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token');
    expect(req.request.body).toEqual({
      sourceShas,
      reviewClass: 'internal-engineering-testnet',
    });
    req.flush({ ceremony_id: ceremonyId, state: 'draft' });
    expect((await promise).ceremony_id).toBe(ceremonyId);
  });

  it('keeps invitation preparation and acceptance token-scoped and public', async () => {
    const typedData = {
      domain: { name: 'Solslot Protocol', version: '2', chainId: 11155111 },
      types: {},
      primaryType: 'X',
      message: {},
    };
    const prepared = service.prepareInvitation('fragment-token', '0x' + 'ab'.repeat(20));
    const prepareReq = http.expectOne(`${environment.faucetApi}/admin/genesis/invitations/prepare`);
    expect(prepareReq.request.headers.has('Authorization')).toBeFalse();
    prepareReq.flush({ ceremonyId, slot: 2, expiresAt: 99, typedData });
    expect((await prepared).slot).toBe(2);

    const accepted = service.acceptInvitation(
      'fragment-token',
      '0x' + 'ab'.repeat(20),
      '0xsignature',
    );
    const acceptReq = http.expectOne(`${environment.faucetApi}/admin/genesis/invitations/accept`);
    expect(acceptReq.request.body.signature).toBe('0xsignature');
    acceptReq.flush({ ceremonyId, slot: 2, enrolled: true, state: 'draft' });
    expect((await accepted).enrolled).toBeTrue();
  });

  it('uses distinct preflight and broadcast endpoints', async () => {
    const preflight = service.preflight('token', ceremonyId);
    const preflightReq = http.expectOne(
      `${environment.faucetApi}/admin/genesis/${ceremonyId}/preflight`,
    );
    preflightReq.flush({ ready: true, ceremonyId, spendCount: 48 });
    await preflight;

    const broadcast = service.broadcast('token', ceremonyId);
    const broadcastReq = http.expectOne(
      `${environment.faucetApi}/admin/genesis/${ceremonyId}/broadcast`,
    );
    expect(broadcastReq.request.method).toBe('POST');
    broadcastReq.flush({ ceremony_id: ceremonyId, state: 'broadcast' });
    expect((await broadcast).state).toBe('broadcast');
  });

  it('rejects blank operator tokens and malformed ceremony IDs before HTTP', () => {
    expect(() => service.createDraft(' ', sourceShas)).toThrowError(/operator token is required/);
    expect(() => service.getCeremony('token', 'not-a-ceremony')).toThrowError(/ceremony ID/);
  });
});
