import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MintProposalResponse } from '../../../services/admin-api.service';
import { formatError } from '../../../utils/format-error';

/**
 * Public committee view — open mint proposals available for PGT-weighted
 * voting.
 *
 * No authentication.  Per POP-CANON-013, the committee endpoints are
 * intentionally not gated by `require_admin_jwt`: any PGT holder can
 * read this list and (in Step B) submit a signed vote bundle.  Locking
 * this behind the admin allowlist would conflate operator authority
 * with token-holder governance.
 *
 * The "Vote YES" button is a placeholder until the API's
 * `/admin/committee/vote` endpoint moves out of 501.  Real voting
 * involves the user's wallet building + signing a PGT-VOTE spend bundle
 * on the client; the API just forwards.
 */
@Component({
  selector: 'pp-committee',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-12 pb-24 max-w-5xl">
      <header>
        <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
          Populis · Committee
        </div>
        <h1 class="font-display text-4xl md:text-5xl">Open mint proposals.</h1>
        <p class="mt-4 text-text-muted text-sm max-w-2xl">
          Any PGT holder may vote on proposals in
          <span class="state-pill" data-state="PROPOSED">PROPOSED</span> or
          <span class="state-pill" data-state="VOTING">VOTING</span>.
          Your wallet builds and signs a PGT-VOTE spend bundle locally;
          this site just forwards it to the chain.
        </p>
        <p class="mt-3 text-text-muted text-xs max-w-2xl">
          The committee endpoint is a public, publish-only forwarder &mdash;
          we do not custody your PGT or your vote.
        </p>
      </header>

      <div class="mt-10 flex items-center gap-3">
        <button class="btn btn--ghost" type="button" (click)="reload()" [disabled]="loading()">
          @if (loading()) {
            Refreshing&hellip;
          } @else {
            Refresh
          }
        </button>
        <a routerLink="/admin/login" class="mono text-xs text-text-muted hover:text-brand">
          Admin sign-in &rarr;
        </a>
      </div>

      <div class="mt-8">
        @if (error()) {
          <div class="rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            <div class="font-display text-base mb-1">Couldn't load committee feed.</div>
            <div class="mono text-xs">{{ error() }}</div>
          </div>
        } @else if (loading() && proposals().length === 0) {
          <div class="mono text-sm text-text-muted">Loading&hellip;</div>
        } @else if (proposals().length === 0) {
          <div class="card text-center text-text-muted">
            <div class="font-display text-2xl text-text">No open proposals.</div>
            <p class="mt-2 max-w-md mx-auto text-sm">
              The committee feed is empty.  When operators publish mint
              proposals on chain they'll appear here automatically.
            </p>
          </div>
        } @else {
          <div class="grid gap-3">
            @for (p of proposals(); track p.id) {
              <article class="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="state-pill" [attr.data-state]="p.state">{{ p.state }}</span>
                    <span class="mono text-xs text-text-muted truncate">
                      {{ p.id }}
                    </span>
                  </div>
                  <div class="mt-2 font-display text-2xl truncate">
                    {{ p.property_id }}
                  </div>
                  <div class="mt-1 text-xs text-text-muted truncate">
                    {{ p.asset_class }} · {{ p.jurisdiction }} · par {{ formatPar(p.par_value) }}
                  </div>

                  <div class="mt-3 max-w-md">
                    <div class="flex items-center justify-between text-xs mono mb-1">
                      <span class="text-text-muted">Quorum progress</span>
                      <span>
                        {{ p.vote_tally }} / {{ p.quorum_required }}
                        ({{ progressPct(p) }}%)
                      </span>
                    </div>
                    <div class="quorum-bar">
                      <div class="quorum-bar__fill" [style.width.%]="progressPct(p)"></div>
                    </div>
                  </div>
                </div>

                <button
                  class="btn btn--ghost shrink-0"
                  type="button"
                  disabled
                  title="Step B — voting goes live with /admin/committee/vote"
                >
                  Vote YES (coming soon)
                </button>
              </article>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .state-pill {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        letter-spacing: 0.18em;
        padding: 0.18rem 0.5rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
      }
      .state-pill[data-state='PROPOSED'],
      .state-pill[data-state='VOTING'] {
        color: #2ce7ff;
        background: rgba(44, 231, 255, 0.12);
      }

      .quorum-bar {
        position: relative;
        height: 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        overflow: hidden;
      }
      .quorum-bar__fill {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          rgba(124, 255, 178, 0.8),
          rgba(44, 231, 255, 0.7)
        );
        transition: width 0.35s ease;
        max-width: 100%;
      }
    `,
  ],
})
export class CommitteeComponent {
  readonly proposals = signal<MintProposalResponse[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.reload();
  }

  /**
   * Load all PROPOSED+ mint proposals visible to the committee.
   *
   * **Phase B1 (current):** the previous API endpoint
   * (``GET /admin/committee/proposals``) was deleted as part of the
   * Hermes-D API-removal pass.  Cross-admin visibility requires
   * walking each proposal-tracker singleton on chain via
   * {@link ChiaSingletonReaderService}, indexed by a registry
   * singleton (or a published manifest of proposal launcher_ids).
   * That work is Phase B2; until it lands, this desk renders an
   * empty list with an in-band notice.
   *
   * **Why we don't fall back to localStorage drafts.**  The
   * committee desk's purpose is to show *all admins'* in-flight
   * proposals so any committee member can vote.  Showing only
   * the current browser's drafts would be misleading — a
   * committee member voting on a proposal they wrote is not what
   * the page is for.
   */
  async reload(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.proposals.set([]);
      this.error.set(
        'Cross-admin proposal visibility is not yet wired to on-chain ' +
          'reads (Phase B2 follow-up).  Once the proposal-tracker singleton ' +
          'index is in place, this desk will list every PROPOSED+ proposal ' +
          'directly from chain via coinset.org — no API needed.',
      );
    } catch (e) {
      this.error.set(formatError(e));
    } finally {
      this.loading.set(false);
    }
  }

  formatPar(parMojos: number): string {
    const dollars = parMojos / 100;
    return `\$${dollars.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  progressPct(p: MintProposalResponse): number {
    if (p.quorum_required <= 0) return 0;
    const pct = (p.vote_tally / p.quorum_required) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }
}
