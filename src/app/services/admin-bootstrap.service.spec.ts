import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { environment } from '../../environments/environment';
import { AdminBootstrapService } from './admin-bootstrap.service';

describe('AdminBootstrapService', () => {
  let service: AdminBootstrapService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AdminBootstrapService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('starts a bootstrap session with the pasted one-shot token and credentials', async () => {
    const promise = service.startBootstrapSession(' bootstrap-token ');

    const req = http.expectOne(`${environment.faucetApi}/admin/bootstrap/challenge`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.get('Authorization')).toBe('Bearer bootstrap-token');
    req.flush({ unlocked: true, expires_at: 1234 });

    await expectAsync(promise).toBeResolvedTo({ unlocked: true, expires_at: 1234 });
  });

  it('checks bootstrap status with credentials and without resending the raw token', async () => {
    const promise = service.getBootstrapStatus();

    const req = http.expectOne(`${environment.faucetApi}/admin/bootstrap/status`);
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({ locked: false, authenticated: true, expires_at: 1234 });

    await expectAsync(promise).toBeResolvedTo({ locked: false, authenticated: true, expires_at: 1234 });
  });

  it('rejects blank tokens before making HTTP requests', async () => {
    await expectAsync(service.startBootstrapSession('   ')).toBeRejectedWithError(/token is required/);
    http.expectNone(`${environment.faucetApi}/admin/bootstrap/challenge`);
  });

  it('does not persist bootstrap credentials in browser storage', async () => {
    const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();

    const promise = service.startBootstrapSession('bootstrap-token');
    const req = http.expectOne(`${environment.faucetApi}/admin/bootstrap/challenge`);
    req.flush({ unlocked: true, expires_at: 1234 });

    await promise;

    expect(setItem).not.toHaveBeenCalled();
  });
});
