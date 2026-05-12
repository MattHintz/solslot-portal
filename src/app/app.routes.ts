import { Routes } from '@angular/router';
import { adminAuthGuard } from './services/admin-auth.guard';
import { adminBootstrapLaunchGuard } from './services/admin-bootstrap-launch.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/admin/genesis/genesis.component').then(
        (m) => m.GenesisComponent,
      ),
    title: 'Genesis Launch · Populis',
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
    path: 'admin/genesis',
    loadComponent: () =>
      import('./pages/admin/genesis/genesis.component').then(
        (m) => m.GenesisComponent,
      ),
    title: 'Genesis Launch · Populis',
  },
  {
    path: 'admin/recovery',
    loadComponent: () =>
      import('./pages/admin/recovery/recovery.component').then(
        (m) => m.RecoveryComponent,
      ),
    title: 'Bootstrap Recovery · Populis',
  },
  {
    path: 'admin',
    // The guard pushes the original URL into ?returnTo= so users land
    // back on their target page after signing in.  Static-imported so
    // inject() inside the guard runs in a valid injection context.
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/dashboard/admin-dashboard.component').then(
        (m) => m.AdminDashboardComponent,
      ),
    title: 'Admin Desk · Populis',
  },
  {
    path: 'admin/mint/new',
    canActivate: [adminAuthGuard],
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
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/trust-roots/trust-roots.component').then(
        (m) => m.TrustRootsComponent,
      ),
    title: 'Trust Roots · Populis',
  },
  {
    // Phase 9-Hermes-D D-2.4: launch-v2 wizard.
    // Computes every deterministic output of a v2 admin-authority
    // genesis launch from operator inputs (parent coin id + admin
    // records + MIPS root).  Preview-only for now — actual on-chain
    // submission lands in D-2.5/D-2.6.
    path: 'admin/launch-authority-v2',
    canActivate: [adminBootstrapLaunchGuard],
    loadComponent: () =>
      import(
        './pages/admin/launch-authority-v2/launch-authority-v2.component'
      ).then((m) => m.LaunchAuthorityV2Component),
    title: 'Launch Authority v2 · Populis',
  },
  {
    path: 'admin/mint/:id',
    canActivate: [adminAuthGuard],
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
