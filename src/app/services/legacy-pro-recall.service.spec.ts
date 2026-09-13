import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LegacyProRecallService } from './legacy-pro-recall.service';
import { AdminSessionService } from './admin-session.service';
import { environment } from '../../environments/environment';

describe('LegacyProRecallService authority', () => {
  let service: LegacyProRecallService;
  let http: HttpTestingController;
  let token: string | null;
  beforeEach(() => {
    token = null;
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: AdminSessionService, useValue: { jwt: () => token } },
    ] });
    service = TestBed.inject(LegacyProRecallService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('does not request private records without a current session', async () => {
    await expectAsync(service.search('sample')).toBeRejectedWithError(/current administrator/);
    http.expectNone(() => true);
  });
  it('uses the current bearer token and does not assert a client-chosen administrator subject', async () => {
    token = 'test-session-token';
    const result = service.search('  sample  ');
    const request = http.expectOne(r => r.url === `${environment.legacyRecallApi.replace(/\/$/, '')}/legacy/pro-vaults/recall`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer test-session-token');
    expect(request.request.headers.has('X-Admin-Subject')).toBeFalse();
    expect(request.request.params.get('q')).toBe('sample');
    request.flush({ records: [], count: 0 });
    await result;
    token = null;
    await expectAsync(service.search('sample')).toBeRejectedWithError(/current administrator/);
    http.expectNone(() => true);
  });
});
