import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

import { routes } from '../app.routes';
import { adminAuthGuard } from './admin-auth.guard';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { adminBootstrapLaunchGuard } from './admin-bootstrap-launch.guard';
import { AdminSessionService } from './admin-session.service';

describe('adminBootstrapLaunchGuard', () => {
  let session: jasmine.SpyObj<Pick<AdminSessionService, 'isAuthenticated'>>;
  let bootstrap: jasmine.SpyObj<Pick<AdminBootstrapService, 'getBootstrapStatus'>>;
  let router: Router;

  beforeEach(() => {
    session = jasmine.createSpyObj('AdminSessionService', ['isAuthenticated']);
    bootstrap = jasmine.createSpyObj('AdminBootstrapService', ['getBootstrapStatus']);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AdminSessionService, useValue: session },
        { provide: AdminBootstrapService, useValue: bootstrap },
      ],
    });
    router = TestBed.inject(Router);
  });

  async function runGuard(url = '/admin/launch-authority-v2'): Promise<boolean | UrlTree> {
    return TestBed.runInInjectionContext(() =>
      adminBootstrapLaunchGuard(
        {} as ActivatedRouteSnapshot,
        { url } as RouterStateSnapshot,
      ),
    ) as Promise<boolean | UrlTree>;
  }

  it('allows permanent admin sessions without checking bootstrap status', async () => {
    session.isAuthenticated.and.returnValue(true);

    const result = await runGuard();

    expect(result).toBeTrue();
    expect(bootstrap.getBootstrapStatus).not.toHaveBeenCalled();
  });

  it('allows launch authority during an active unlocked bootstrap session', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: false, authenticated: true });

    const result = await runGuard();

    expect(result).toBeTrue();
    expect(bootstrap.getBootstrapStatus).toHaveBeenCalledOnceWith();
  });

  it('redirects missing bootstrap sessions back to genesis', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: false, authenticated: false });

    const result = await runGuard();

    expect(result instanceof UrlTree).toBeTrue();
    const url = router.serializeUrl(result as UrlTree);
    expect(url).toContain('/admin/genesis');
    expect(url).toContain('returnTo=%2Fadmin%2Flaunch-authority-v2');
  });

  it('allows locked bootstrap sessions to review finalized launch artifacts', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: true, authenticated: false });

    const result = await runGuard();

    expect(result).toBeTrue();
  });

  it('fails closed when bootstrap status cannot be checked', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.rejectWith(new Error('network unavailable'));

    const result = await runGuard();

    expect(result instanceof UrlTree).toBeTrue();
    expect(router.serializeUrl(result as UrlTree)).toContain('/admin/genesis');
  });

  it('uses the bootstrap-aware guard only for first-admin launch route', () => {
    const launchRoute = routes.find((route) => route.path === 'admin/launch-authority-v2');
    const adminRoute = routes.find((route) => route.path === 'admin');
    const mintRoute = routes.find((route) => route.path === 'admin/mint/new');

    expect(launchRoute?.canActivate).toEqual([adminBootstrapLaunchGuard]);
    expect(adminRoute?.canActivate).toEqual([adminAuthGuard]);
    expect(mintRoute?.canActivate).toEqual([adminAuthGuard]);
  });
});
