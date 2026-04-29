import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AdminSessionService } from './admin-session.service';

/**
 * Route guard that protects every `/admin/*` route except `/admin/login`
 * and the public committee pages.
 *
 * Behaviour:
 *   - If the {@link AdminSessionService} reports an active authenticated
 *     session, the route activates.
 *   - Otherwise the user is redirected to `/admin/login`, with the
 *     attempted URL preserved in `?returnTo=` so the login page can route
 *     them back after a successful sign-in.
 *
 * The session service drops expired JWTs at construction time
 * (`load()` checks `expiresAt`), so a stale localStorage session can never
 * reach a guarded page even if the user reloads with a cached token.
 *
 * Note that this is a UX safety net only — the real authority check lives
 * in `populis_api/admin_auth.py:require_admin_jwt`, which re-validates
 * live allowlist membership on every request (POP-CANON-012).
 */
export const adminAuthGuard: CanActivateFn = (route, state): boolean | UrlTree => {
  const session = inject(AdminSessionService);
  const router = inject(Router);

  if (session.isAuthenticated()) return true;

  return router.createUrlTree(['/admin/login'], {
    queryParams: { returnTo: state.url },
  });
};
