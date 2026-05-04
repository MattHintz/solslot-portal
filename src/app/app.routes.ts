import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/landing/landing.component').then((m) => m.LandingComponent),
    title: 'Populis Portal — Members Area',
  },
  {
    path: 'connect',
    loadComponent: () =>
      import('./pages/connect/connect.component').then((m) => m.ConnectComponent),
    title: 'Connect Wallet · Populis Portal',
  },
  {
    path: 'create-vault',
    loadComponent: () =>
      import('./pages/create-vault/create-vault.component').then((m) => m.CreateVaultComponent),
    title: 'Create Vault · Populis Portal',
  },
  {
    path: 'vault',
    loadComponent: () =>
      import('./pages/vault/vault.component').then((m) => m.VaultComponent),
    title: 'My Vault · Populis Portal',
  },

  // ── Admin desk (wallet-signed JWT auth) ───────────────────────────────────
  {
    path: 'admin/login',
    loadComponent: () =>
      import('./pages/admin/login/admin-login.component').then(
        (m) => m.AdminLoginComponent,
      ),
    title: 'Admin Sign-in · Populis',
  },
  {
    path: 'admin',
    canActivate: [
      // The guard pushes the original URL into ?returnTo= so users land
      // back on their target page after signing in.
      (route, state) =>
        import('./services/admin-auth.guard').then((m) => m.adminAuthGuard(route, state)),
    ],
    loadComponent: () =>
      import('./pages/admin/dashboard/admin-dashboard.component').then(
        (m) => m.AdminDashboardComponent,
      ),
    title: 'Admin Desk · Populis',
  },
  {
    path: 'admin/mint/new',
    canActivate: [
      (route, state) =>
        import('./services/admin-auth.guard').then((m) => m.adminAuthGuard(route, state)),
    ],
    loadComponent: () =>
      import('./pages/admin/mint-new/mint-new.component').then(
        (m) => m.MintNewComponent,
      ),
    title: 'New Mint Proposal · Populis',
  },
  {
    // Trust Roots admin page (Phase 3): surfaces /protocol +
    // /admin/auth/authority and verifies them against on-chain
    // state via ChiaSingletonReaderService.
    path: 'admin/trust-roots',
    canActivate: [
      (route, state) =>
        import('./services/admin-auth.guard').then((m) => m.adminAuthGuard(route, state)),
    ],
    loadComponent: () =>
      import('./pages/admin/trust-roots/trust-roots.component').then(
        (m) => m.TrustRootsComponent,
      ),
    title: 'Trust Roots · Populis',
  },
  {
    path: 'admin/mint/:id',
    canActivate: [
      (route, state) =>
        import('./services/admin-auth.guard').then((m) => m.adminAuthGuard(route, state)),
    ],
    loadComponent: () =>
      import('./pages/admin/mint-detail/mint-detail.component').then(
        (m) => m.MintDetailComponent,
      ),
    title: 'Mint Proposal · Populis',
  },
  {
    // Public: no guard.  Per POP-CANON-013 the committee endpoints are
    // open to any PGT holder, not just allowlisted admins.
    path: 'committee',
    loadComponent: () =>
      import('./pages/admin/committee/committee.component').then(
        (m) => m.CommitteeComponent,
      ),
    title: 'Committee · Populis',
  },

  {
    path: '**',
    redirectTo: '',
  },
];
