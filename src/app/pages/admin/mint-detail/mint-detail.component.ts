import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MintProposalResponse } from '../../../services/admin-api.service';
import { MintDraftStorageService } from '../../../services/mint-draft-storage.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { formatError } from '../../../utils/format-error';

/**
 * Detailed view of a single mint proposal.
 *
 * Read-only mirror of every column in the SQLite row, organised into the
 * same four groups the backend uses (operator metadata, computed hashes,
 * on-chain ids, timestamps).  The only mutating action available today
 * is **Cancel** — DRAFT-only, owner-only, server-enforced.
 *
 * Publish + Execute are 501 stubs in the API today (Step B); the buttons
 * surface them as "coming soon" so operators understand the page is the
 * eventual home of those flows.
 */
@Component({
  selector: 'pp-admin-mint-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-12 pb-24 max-w-4xl">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <a routerLink="/admin" class="mono text-xs text-text-muted hover:text-brand">
            &larr; Back to dashboard
          </a>
          <h1 class="mt-2 font-display text-3xl md:text-4xl truncate">
            @if (proposal(); as p) {
              {{ p.property_id }}
            } @else {
              Mint proposal
            }
          </h1>
          <div class="mono text-xs text-text-muted mt-1 truncate">
            {{ proposalId() }}
          </div>
        </div>

        @if (proposal(); as p) {
          <span class="state-pill" [attr.data-state]="p.state">{{ p.state }}</span>
        }
      </header>

      @if (loading()) {
        <div class="mt-8 mono text-sm text-text-muted">Loading proposal&hellip;</div>
      } @else if (loadError()) {
        <div class="mt-8 rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          <div class="font-display text-base mb-1">Couldn't load proposal.</div>
          <div class="mono text-xs">{{ loadError() }}</div>
          <button class="btn btn--ghost mt-3" type="button" (click)="reload()">
            Retry
          </button>
        </div>
      } @else if (proposal(); as p) {
        <div class="mt-8 grid gap-6">
          <section class="card grid gap-4">
            <h2 class="font-display text-2xl">Operator metadata</h2>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <div class="form-label">Asset class</div>
                <div class="mono">{{ p.asset_class }}</div>
              </div>
              <div>
                <div class="form-label">Jurisdiction</div>
                <div class="mono">{{ p.jurisdiction }}</div>
              </div>
              <div>
                <div class="form-label">Par value</div>
                <div class="mono">{{ formatPar(p.par_value) }}</div>
              </div>
              <div>
                <div class="form-label">Royalty</div>
                <div class="mono">{{ p.royalty_bps / 100 }}%</div>
              </div>
              <div class="sm:col-span-2">
                <div class="form-label">Royalty payee puzhash</div>
                <div class="mono text-xs break-all">{{ p.royalty_puzhash }}</div>
              </div>
              <div class="sm:col-span-2">
                <div class="form-label">Owner pubkey (proposer)</div>
                <div class="mono text-xs break-all">{{ p.owner_pubkey }}</div>
                @if (isOwner()) {
                  <div class="text-xs text-brand mt-1">You are the proposer.</div>
                }
              </div>
            </div>
          </section>

          <section class="card grid gap-3">
            <h2 class="font-display text-2xl">Governance</h2>
            <div class="grid gap-3 sm:grid-cols-3">
              <div>
                <div class="form-label">Vote tally</div>
                <div class="mono">{{ p.vote_tally }}</div>
              </div>
              <div>
                <div class="form-label">Quorum required</div>
                <div class="mono">{{ p.quorum_required }}</div>
              </div>
              <div>
                <div class="form-label">Deadline</div>
                <div class="mono">{{ p.deadline ?? '—' }}</div>
              </div>
            </div>
          </section>

          <section class="card grid gap-3">
            <h2 class="font-display text-2xl">Computed hashes</h2>
            <p class="text-xs text-text-muted">
              Populated atomically by <code class="mono">/publish</code>;
              null while DRAFT.
            </p>
            <dl class="grid gap-2 text-xs mono">
              <div>
                <dt class="text-text-muted">smart_deed_inner_puzhash</dt>
                <dd class="break-all">{{ p.computed.smart_deed_inner_puzhash ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">eve_inner_puzhash</dt>
                <dd class="break-all">{{ p.computed.eve_inner_puzhash ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">deed_full_puzhash</dt>
                <dd class="break-all">{{ p.computed.deed_full_puzhash ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">proposal_hash</dt>
                <dd class="break-all">{{ p.computed.proposal_hash ?? '—' }}</dd>
              </div>
            </dl>
          </section>

          <section class="card grid gap-3">
            <h2 class="font-display text-2xl">On-chain ids</h2>
            <p class="text-xs text-text-muted">
              Populated by <code class="mono">/publish</code> and
              <code class="mono">/execute</code> as the proposal moves through
              the lifecycle.
            </p>
            <dl class="grid gap-2 text-xs mono">
              <div>
                <dt class="text-text-muted">proposal_tracker_coin_id</dt>
                <dd class="break-all">{{ p.on_chain.proposal_tracker_coin_id ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">pgt_lock_coin_id</dt>
                <dd class="break-all">{{ p.on_chain.pgt_lock_coin_id ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">deed_launcher_id</dt>
                <dd class="break-all">{{ p.on_chain.deed_launcher_id ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">published_bundle_id</dt>
                <dd class="break-all">{{ p.on_chain.published_bundle_id ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">executed_bundle_id</dt>
                <dd class="break-all">{{ p.on_chain.executed_bundle_id ?? '—' }}</dd>
              </div>
            </dl>
          </section>

          <section class="card grid gap-3">
            <h2 class="font-display text-2xl">Timestamps</h2>
            <dl class="grid gap-2 text-xs mono sm:grid-cols-2">
              <div>
                <dt class="text-text-muted">created_at</dt>
                <dd>{{ formatTime(p.timestamps.created_at) }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">published_at</dt>
                <dd>{{ formatTime(p.timestamps.published_at) }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">executed_at</dt>
                <dd>{{ formatTime(p.timestamps.executed_at) }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">minted_at</dt>
                <dd>{{ formatTime(p.timestamps.minted_at) }}</dd>
              </div>
            </dl>
          </section>

          @if (p.off_chain_metadata) {
            <section class="card grid gap-3">
              <h2 class="font-display text-2xl">Off-chain metadata</h2>
              <pre class="mono text-xs whitespace-pre-wrap break-all">{{ formatMetadata(p.off_chain_metadata) }}</pre>
            </section>
          }

          <section class="flex flex-wrap gap-3 justify-end">
            @if (canCancel()) {
              <button
                type="button"
                class="btn btn--ghost"
                (click)="cancel()"
                [disabled]="busy()"
              >
                @if (busy()) {
                  Canceling&hellip;
                } @else {
                  Cancel DRAFT
                }
              </button>
            }
            <button class="btn btn--ghost" type="button" disabled title="Step B">
              Publish (coming soon)
            </button>
            <button class="btn btn--ghost" type="button" disabled title="Step B">
              Execute (coming soon)
            </button>
          </section>

          @if (actionError()) {
            <div class="rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
              <div class="font-display text-base mb-1">Action failed.</div>
              <div class="mono text-xs">{{ actionError() }}</div>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      .form-label {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--muted);
        margin-bottom: 0.35rem;
      }

      .state-pill {
        font-family: var(--font-mono);
        font-size: 0.72rem;
        letter-spacing: 0.2em;
        padding: 0.3rem 0.7rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
        align-self: flex-start;
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
export class MintDetailComponent {
  private readonly drafts = inject(MintDraftStorageService);
  private readonly session = inject(AdminSessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly proposalId = signal<string>(this.route.snapshot.paramMap.get('id') ?? '');
  readonly proposal = signal<MintProposalResponse | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  readonly isOwner = computed(() => {
    const p = this.proposal();
    const sub = this.session.subject();
    return !!p && !!sub && p.owner_pubkey.toLowerCase() === sub.toLowerCase();
  });

  /** Mirrors the server's cancel-eligibility rule: DRAFT + owner-only. */
  readonly canCancel = computed(
    () => this.proposal()?.state === 'DRAFT' && this.isOwner(),
  );

  constructor() {
    void this.reload();
  }

  /**
   * Load the proposal from browser localStorage.  ``async`` is kept
   * for signature back-compat with template ``await``-callers; the
   * underlying storage read is synchronous.  Phase B2 will extend
   * this to walk chain for ``PROPOSED+`` state when the proposal
   * has been submitted on chain.
   */
  async reload(): Promise<void> {
    const id = this.proposalId();
    if (!id) {
      this.loadError.set('Missing proposal id in route.');
      return;
    }
    if (!this.session.isAuthenticated()) {
      this.loadError.set('Not authenticated.');
      return;
    }
    this.loadError.set(null);
    this.loading.set(true);
    try {
      const p = this.drafts.get(id);
      if (!p) {
        this.loadError.set(
          `Proposal ${id} not found in this browser's local drafts.  ` +
            'Drafts are scoped per-browser; ask the admin who created ' +
            'it for an export, or recreate it here.',
        );
        return;
      }
      this.proposal.set(p);
    } catch (e) {
      this.loadError.set(formatError(e));
    } finally {
      this.loading.set(false);
    }
  }

  async cancel(): Promise<void> {
    const id = this.proposalId();
    if (!id || !this.session.isAuthenticated()) return;
    if (!confirm('Cancel this DRAFT mint proposal?  This is permanent.')) return;
    this.actionError.set(null);
    this.busy.set(true);
    try {
      const updated = this.drafts.cancel(id);
      if (updated) this.proposal.set(updated);
    } catch (e) {
      this.actionError.set(formatError(e));
    } finally {
      this.busy.set(false);
    }
  }

  formatPar(parMojos: number): string {
    const dollars = parMojos / 100;
    return `\$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /** Render a unix-seconds timestamp as a UTC ISO string, or "—" if null. */
  formatTime(ts: number | null): string {
    if (!ts) return '—';
    return new Date(ts * 1_000).toISOString().replace('T', ' ').replace('.000Z', 'Z');
  }

  formatMetadata(meta: Record<string, unknown>): string {
    try {
      return JSON.stringify(meta, null, 2);
    } catch {
      return String(meta);
    }
  }
}
