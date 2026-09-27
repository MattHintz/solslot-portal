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
    path: 'offers',
    redirectTo: 'admin/pool-economics-v2',
    pathMatch: 'full',
  },
  {
    path: 'offers/:id',
    redirectTo: 'admin/pool-economics-v2',
  },
  {
    path: 'properties/:id',
    loadComponent: () =>
      import('./pages/property/property.component').then((m) => m.PropertyComponent),
    title: 'Property Dossier · Solslot',
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
    title: 'Alpha Protocol Launch · Solslot',
  },
  {
    path: 'admin/genesis/security',
    data: { launchSecurity: true },
    loadComponent: () =>
      import('./pages/admin/admin-authority/admin-authority.component').then(
        (m) => m.AdminAuthorityComponent,
      ),
    title: 'Security & Access · Solslot',
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
    path: 'admin/collections',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/collections/collections.component').then(
        (m) => m.CollectionsComponent,
      ),
    title: 'Properties · Solslot',
  },
  {
    path: 'admin/collections/:id',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/collection-editor/collection-editor.component').then(
        (m) => m.CollectionEditorComponent,
      ),
    title: 'Collection Workspace · Solslot',
  },
  {
    path: 'admin/omnichain-activation',
    redirectTo: 'admin/genesis',
    pathMatch: 'full',
  },
  {
    path: 'admin/sales',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/sales/admin-sales.component').then(
        (m) => m.AdminSalesComponent,
      ),
    title: 'Sales & Refunds · Solslot',
  },
  {
    path: 'admin/system-health',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/system-health/admin-system-health.component').then(
        (m) => m.AdminSystemHealthComponent,
      ),
    title: 'System Health · Solslot',
  },
  {
    path: 'admin/mint',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/mint-list/mint-list.component').then(
        (m) => m.MintListComponent,
      ),
    title: 'SmartDeed Proposals · Solslot',
  },
  {
    path: 'admin/mint/new',
    redirectTo: 'admin/collections',
    pathMatch: 'full',
  },
  {
    path: 'admin/sgt-allocations',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/sgt-allocations/sgt-allocations.component').then(
        (m) => m.SgtAllocationsComponent,
      ),
    title: 'SGT Allocations · Solslot',
  },
  {
    path: 'admin/sols-liquidity',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/sols-liquidity/sols-liquidity.component').then(
        (m) => m.SolsLiquidityComponent,
      ),
    title: 'SOLS Liquidity · Solslot',
  },
  {
    path: 'admin/pool-economics-v2',
    redirectTo: 'admin/sols-liquidity',
    pathMatch: 'full',
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
    title: 'SmartDeed Proposal · Solslot',
  },
  {
    path: 'admin/authority',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/admin-authority/admin-authority.component').then(
        (m) => m.AdminAuthorityComponent,
      ),
    title: 'Security & Access · Solslot',
  },
  {
    path: 'admin/recover-wallet',
    loadComponent: () =>
      import('./pages/admin/lost-recovery/admin-lost-recovery.component').then(
        (m) => m.AdminLostRecoveryComponent,
      ),
    title: 'Recover Administrator Wallet · Solslot',
  },
  {
    path: 'recover-admin-access',
    loadComponent: () =>
      import('./pages/admin/recovery-access/admin-recovery-access.component').then(
        (m) => m.AdminRecoveryAccessComponent,
      ),
    title: 'Administrator Recovery · Solslot',
  },
  {
    path: 'admin/approvals',
    canActivate: [adminAuthGuard],
    loadComponent: () =>
      import('./pages/admin/approvals/admin-approvals.component').then(
        (m) => m.AdminApprovalsComponent,
      ),
    title: 'Approval Inbox · Solslot',
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
