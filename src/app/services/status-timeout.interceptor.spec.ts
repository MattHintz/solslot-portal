import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminStatusRefresh } from './admin-status-refresh.service';
import { statusTimeoutInterceptor } from './status-timeout.interceptor';

describe('Bounded status transport', () => {
  let http: HttpClient, backend: HttpTestingController;
  const url=environment.faucetApi+'/admin/governance/proposals';
  beforeEach(() => {
    TestBed.configureTestingModule({providers:[provideHttpClient(withInterceptors([statusTimeoutInterceptor])),
      provideHttpClientTesting(), AdminStatusRefresh]});
    http=TestBed.inject(HttpClient);backend=TestBed.inject(HttpTestingController);
  });
  afterEach(() => {backend.verify({ignoreCancelled:true});TestBed.resetTestingModule();});

  it('cancels a hung GET and resumes polling without overlapping the old request', fakeAsync(() => {
    const refresh=TestBed.inject(AdminStatusRefresh);
    refresh.start(async () => { await firstValueFrom(http.get(url)); }, () => null, () => true);
    const old=backend.expectOne(url);
    tick(19_999);expect(refresh.refreshing()).toBeTrue();expect(old.cancelled).toBeFalse();
    tick(1);expect(old.cancelled).toBeTrue();expect(refresh.refreshing()).toBeFalse();
    expect(refresh.error()).toContain('retrying automatically');
    expect(refresh.lastUpdated()).toBeNull();
    tick(9_999);backend.expectNone(url);
    tick(1);const retry=backend.expectOne(url);retry.flush({proposals:[]});tick();
    expect(refresh.error()).toBeNull();expect(refresh.lastUpdated()).not.toBeNull();
    expect(() => old.flush({proposals:['stale']})).toThrow();
    TestBed.resetTestingModule();
  }));

  it('reports a typed timeout without inventing success or sending another request', fakeAsync(() => {
    let error:HttpErrorResponse|undefined;
    http.get(url).subscribe({error:e=>error=e});const read=backend.expectOne(url);tick(20_000);
    expect(read.cancelled).toBeTrue();expect(error?.error.code).toBe('STATUS_TIMEOUT');
    backend.expectNone(url);
  }));

  it('does not cancel or retry a submission while the server may be dispatching it', fakeAsync(() => {
    let completed=false;
    http.post(url,{action:'submit'}).subscribe(()=>completed=true);
    const write=backend.expectOne(url);tick(90_000);
    expect(write.cancelled).toBeFalse();expect(completed).toBeFalse();
    write.flush({saved:true});expect(completed).toBeTrue();backend.expectNone(url);
  }));

  it('leaves unrelated downloads outside the status policy', fakeAsync(() => {
    http.get('/assets/source.json').subscribe();const file=backend.expectOne('/assets/source.json');
    tick(30_000);expect(file.cancelled).toBeFalse();file.flush({});
  }));
});
