import { Routes } from '@angular/router';
import { adminAuthGuard } from './services/admin-auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/admin/genesis/genesis.component').then(
        (m) => m.GenesisComponent,
      ),
    title: 'Protocol Status · Solslot',
  },
  {
    path: 'connect',
    loadComponent: () =>
      import('./pages/connect/connect.component').then((m) => m.ConnectComponent),
    title: 'Vault Connect · Solslot',
  },
  {
    path: 'create-vault',
    loadComponent: () =>
      import('./pages/create-vault/create-vault.component').then((m) => m.CreateVaultComponent),
    title: 'Create Vault · Solslot',
  },
  {
    path: 'vault',
    loadComponent: () =>
      import('./pages/vault/vault.component').then((m) => m.VaultComponent),
    title: 'My Vault · Solslot',
  },
  {
    path: 'offers/:id',
    loadComponent: () =>
      import('./pages/offers/offer-detail.component').then(
        (m) => m.OfferDetailComponent,
      ),
    title: 'SmartDeed Offer · Solslot',
  },

  // ── Admin desk (wallet-signed JWT auth) ───────────────────────────────────
  {
    path: 'admin/login',
    loadComponent: () =>
      import('./pages/admin/login/admin-login.component').then(
        (m) => m.AdminLoginComponent,
      ),
    title: 'Admin Sign-in · Solslot',
  },
  {
    path: 'admin/genesis',
    loadComponent: () =>
      import('./pages/admin/genesis/genesis.component').then(
        (m) => m.GenesisComponent,
      ),
    title: 'Genesis Launch · Solslot',
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
    title: 'Admin Desk · Solslot',
  },
  {
    path: 'admin/mint/new',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/mint-new/mint-new.component').then(
        (m) => m.MintNewComponent,
      ),
    title: 'New Mint Proposal · Solslot',
  },
  {
    path: 'admin/pool-economics-v2',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/pool-economics-v2/pool-economics-v2.component').then(
        (m) => m.PoolEconomicsV2Component,
      ),
    title: 'Pool Economic V2 · Solslot',
  },
  {
    path: 'admin/legacy-recall',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/legacy-recall/legacy-recall.component').then(
        (m) => m.LegacyRecallComponent,
      ),
    title: 'Legacy Recall · Solslot',
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
    title: 'Trust Roots · Solslot',
  },
  {
    path: 'admin/mint/:id',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/mint-detail/mint-detail.component').then(
        (m) => m.MintDetailComponent,
      ),
    title: 'Mint Proposal · Solslot',
  },
  {
    // Public: no guard.  Per POP-CANON-013 the committee endpoints are
    // open to any SGT holder, not just allowlisted admins.
    path: 'committee',
    loadComponent: () =>
      import('./pages/admin/committee/committee.component').then(
        (m) => m.CommitteeComponent,
      ),
    title: 'Committee · Solslot',
  },

  {
    path: '**',
    redirectTo: '',
  },
];
