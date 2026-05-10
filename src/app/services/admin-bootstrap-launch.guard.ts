import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { AdminBootstrapService } from './admin-bootstrap.service';
import { AdminSessionService } from './admin-session.service';

export const adminBootstrapLaunchGuard: CanActivateFn = async (_route, state): Promise<boolean | UrlTree> => {
  const session = inject(AdminSessionService);
  const bootstrap = inject(AdminBootstrapService);
  const router = inject(Router);

  if (session.isAuthenticated()) return true;

  try {
    const status = await bootstrap.getBootstrapStatus();
    if (!status.locked && status.authenticated) return true;
  } catch {
  }

  return router.createUrlTree(['/admin/genesis'], {
    queryParams: { returnTo: state.url },
  });
};
