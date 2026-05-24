import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  MintProposalResponse,
  MintProposalState,
} from '../../../services/admin-api.service';
import { MintDraftStorageService } from '../../../services/mint-draft-storage.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { formatError } from '../../../utils/format-error';

type StateFilter = 'all' | MintProposalState;
type OwnerFilter = 'all' | 'mine';

const STATE_OPTIONS: ReadonlyArray<{ value: StateFilter; label: string }> = [
  { value: 'all', label: 'All states' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PROPOSED', label: 'Proposed' },
  { value: 'VOTING', label: 'Voting' },
  { value: 'PASSED', label: 'Passed' },
  { value: 'EXECUTING', label: 'Executing' },
  { value: 'MINTED', label: 'Minted' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELED', label: 'Canceled' },
];

/**
 * Admin desk dashboard — the operator's home view.
 *
 * Shows the full mint-proposal queue with state and owner filters,
 * paged at 50 rows per fetch.  The CTA "+ New mint proposal" routes to
 * `/admin/mint/new`; clicking a row routes to `/admin/mint/{id}`.
 *
 * The state-filter chips map directly to the backend's `?state=` query
 * param.  The owner toggle ("All / Mine") maps to `?owner=<jwt-sub>`.
 *
 * Auth: this route is gated by {@link adminAuthGuard}; all `listMintProposals`
 * calls use the cached JWT from {@link AdminSessionService}.
 */
@Component({
  selector: 'pp-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-12 pb-24">
      <header class="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
            Populis · Admin Desk
          </div>
          <h1 class="font-display text-4xl md:text-5xl">Mint proposals.</h1>
          <p class="mt-2 text-text-muted text-sm">
            Signed in as
            <span class="mono text-text">{{ subject() ?? 'unknown' }}</span>
            ·
            <button
              type="button"
              class="hover:text-brand mono uppercase tracking-[0.18em] text-xs"
              (click)="logout()"
            >
              Sign out
            </button>
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <a routerLink="/admin/genesis" class="btn btn--ghost">
            Genesis
          </a>
          <a routerLink="/admin/trust-roots" class="btn btn--ghost">
            Trust roots
          </a>
          <a routerLink="/admin/launch-protocol-config" class="btn btn--ghost">
            Launch A.3
          </a>
          <a routerLink="/admin/launch-authority-v2" class="btn btn--ghost">
            Launch authority v2
          </a>
          <a routerLink="/admin/authority-v2/add-admin-slot" class="btn btn--ghost">
            Add admin slot
          </a>
          <a routerLink="/admin/authority-v2/roster-spend-package-review" class="btn btn--ghost">
            Review roster package
          </a>
          <a routerLink="/admin/mint/new" class="btn btn--primary">
            + New mint proposal
          </a>
        </div>
      </header>

      <div class="mt-10 flex flex-wrap gap-2">
        @for (opt of stateOptions; track opt.value) {
          <button
            type="button"
            class="chip"
            [class.chip--active]="stateFilter() === opt.value"
            (click)="setStateFilter(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
        <span class="mx-2 self-center opacity-30">·</span>
        <button
          type="button"
          class="chip"
          [class.chip--active]="ownerFilter() === 'all'"
          (click)="setOwnerFilter('all')"
        >
          All admins
        </button>
        <button
          type="button"
          class="chip"
          [class.chip--active]="ownerFilter() === 'mine'"
          (click)="setOwnerFilter('mine')"
        >
          Mine only
        </button>
      </div>

      <div class="mt-8">
        @if (loading()) {
          <div class="mono text-sm text-text-muted">Loading proposals&hellip;</div>
        } @else if (error()) {
          <div class="rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            <div class="font-display text-base mb-1">Couldn't load proposals.</div>
            <div class="mono text-xs">{{ error() }}</div>
            <button class="btn btn--ghost mt-3" type="button" (click)="reload()">
              Retry
            </button>
          </div>
        } @else if (proposals().length === 0) {
          <div class="card text-center text-text-muted">
            <div class="font-display text-2xl text-text">No proposals yet.</div>
            <p class="mt-2 max-w-md mx-auto text-sm">
              Click <span class="text-brand">+ New mint proposal</span> to draft
              a deed for committee voting.
            </p>
          </div>
        } @else {
          <div class="grid gap-3">
            @for (p of proposals(); track p.id) {
              <a
                [routerLink]="['/admin/mint', p.id]"
                class="card hover:border-brand transition flex items-center justify-between gap-6"
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="state-pill" [attr.data-state]="p.state">
                      {{ p.state }}
                    </span>
                    <span class="mono text-xs text-text-muted truncate">
                      {{ p.id }}
                    </span>
                  </div>
                  <div class="mt-2 font-display text-2xl truncate">
                    {{ p.property_id }}
                  </div>
                  <div class="mt-1 text-xs text-text-muted truncate">
                    {{ p.asset_class }} · {{ p.jurisdiction }} ·
                    par {{ formatPar(p.par_value) }}
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div class="mono text-xs text-text-muted">Royalty</div>
                  <div class="font-display text-xl">
                    {{ p.royalty_bps / 100 }}%
                  </div>
                </div>
              </a>
            }
          </div>

          <div class="mt-6 mono text-xs text-text-muted">
            Showing {{ proposals().length }} of {{ total() }}.
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .chip {
        font-family: var(--font-mono);
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        padding: 0.4rem 0.85rem;
        border-radius: 999px;
        border: 1px solid var(--border);
        color: var(--muted);
        background: rgba(255, 255, 255, 0.02);
        transition:
          color 0.18s ease,
          border-color 0.18s ease,
          background 0.18s ease;
      }
      .chip:hover {
        color: var(--text);
        border-color: rgba(124, 255, 178, 0.45);
      }
      .chip--active {
        color: #04110d;
        background: rgba(124, 255, 178, 0.85);
        border-color: rgba(124, 255, 178, 0.85);
      }

      .state-pill {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        letter-spacing: 0.18em;
        padding: 0.18rem 0.5rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
      }
      .state-pill[data-state='DRAFT'] {
        color: rgba(234, 255, 247, 0.9);
      }
      .state-pill[data-state='PROPOSED'],
      .state-pill[data-state='VOTING'] {
        color: #2ce7ff;
        background: rgba(44, 231, 255, 0.12);
      }
      .state-pill[data-state='PASSED'],
      .state-pill[data-state='EXECUTING'] {
        color: #7cffb2;
        background: rgba(124, 255, 178, 0.14);
      }
      .state-pill[data-state='MINTED'] {
        color: #04110d;
        background: rgba(124, 255, 178, 0.85);
      }
      .state-pill[data-state='FAILED'],
      .state-pill[data-state='CANCELED'] {
        color: rgba(255, 120, 120, 0.9);
        background: rgba(255, 120, 120, 0.1);
      }
    `,
  ],
})
export class AdminDashboardComponent {
  private readonly drafts = inject(MintDraftStorageService);
  private readonly session = inject(AdminSessionService);

  readonly stateOptions = STATE_OPTIONS;

  readonly stateFilter = signal<StateFilter>('all');
  readonly ownerFilter = signal<OwnerFilter>('all');

  readonly proposals = signal<MintProposalResponse[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly subject = computed(() => this.session.subject());

  constructor() {
    void this.reload();
  }

  setStateFilter(v: StateFilter): void {
    this.stateFilter.set(v);
    void this.reload();
  }

  setOwnerFilter(v: OwnerFilter): void {
    this.ownerFilter.set(v);
    void this.reload();
  }

  /**
   * Load mint proposals from browser localStorage.
   *
   * **Scope.** Phase B1 surfaces only DRAFT/CANCELED proposals
   * (the ones that live in localStorage).  Once a draft is submitted
   * on chain (Phase B2), its state advances to PROPOSED+ and the
   * data source becomes the proposal-tracker singleton lineage on
   * coinset; the dashboard will then merge both sources for the
   * full per-admin view.
   *
   * **Owner filter.**  ``'mine'`` filters to the current admin's
   * subject; ``'all'`` shows every draft in this browser (across
   * past admin sessions).  Cross-admin visibility lives on the
   * committee desk (chain-only reads in Phase B2).
   */
  async reload(): Promise<void> {
    if (!this.session.isAuthenticated()) {
      // Admin guard should prevent this; defend against direct service use.
      this.error.set('Not authenticated.');
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    try {
      const ownerFilter =
        this.ownerFilter() === 'mine' ? this.subject() ?? null : null;
      let proposals = this.drafts.list(ownerFilter);
      const stateFilter = this.stateFilter();
      if (stateFilter !== 'all') {
        proposals = proposals.filter((p) => p.state === stateFilter);
      }
      // Cap at 50 to match the previous API limit — keeps UI
      // pagination semantics identical for back-compat.
      const limited = proposals.slice(0, 50);
      this.proposals.set(limited);
      this.total.set(proposals.length);
    } catch (e) {
      this.error.set(formatError(e));
    } finally {
      this.loading.set(false);
    }
  }

  logout(): void {
    this.session.logoutAndRedirect();
  }

  /**
   * Render a par_value (mojos) as USD-style cents.  1 mojo = 1¢ in the
   * Populis convention; 1_000_000_000 mojos = $10,000,000.00.
   */
  formatPar(parMojos: number): string {
    const dollars = parMojos / 100;
    return `\$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
