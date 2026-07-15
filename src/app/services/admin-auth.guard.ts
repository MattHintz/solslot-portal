import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AdminSessionService } from './admin-session.service';

/**
 * Route guard that protects every `/admin/*` route except `/admin/login`
 * and the public committee pages.
 *
 * Behaviour:
 *   - The {@link AdminSessionService} re-verifies the signed envelope against
 *     the currently verified genesis artifact before the route activates.
 *   - Otherwise the user is redirected to `/admin/login`, with the
 *     attempted URL preserved in `?returnTo=` so the login page can route
 *     them back after a successful sign-in.
 *
 * The route guard is only one layer. Every API mutation still verifies its
 * action-specific authorization and administrator threshold server-side.
 */
export const adminAuthGuard: CanActivateFn = (route, state): boolean | UrlTree => {
  const session = inject(AdminSessionService);
  const router = inject(Router);

  try {
    session.requireSession();
    return true;
  } catch {
    session.logout();
  }

  return router.createUrlTree(['/admin/login'], {
    queryParams: { returnTo: state.url },
  });
};
