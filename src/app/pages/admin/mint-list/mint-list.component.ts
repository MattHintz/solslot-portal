import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import { AdminRefreshStatusComponent } from '../../../components/admin-workspace/admin-refresh-status.component';
import { MintProposalResponse } from '../../../services/admin-api.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { MintProposalApiService } from '../../../services/mint-proposal-api.service';
import { AdminStatusRefresh } from '../../../services/admin-status-refresh.service';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'pp-admin-mint-list',
  standalone: true,
  imports: [CommonModule, RouterLink, AdminWorkspaceNavComponent, AdminRefreshStatusComponent],
  providers: [AdminStatusRefresh],
  template: `
    <solslot-admin-workspace-nav />
    <section class="container-p py-12 md:py-16">
      <header class="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
            Governed issuance
          </div>
          <h1 class="font-display text-4xl md:text-5xl">SmartDeed proposals</h1>
          <p class="mt-3 max-w-3xl text-sm leading-relaxed text-text-muted">
            Follow each approved property from owner submission through governance and confirmation.
          </p>
        </div>
        <div class="flex flex-wrap gap-3">
          <a routerLink="/admin/collections" class="btn btn--primary">Prepare a property</a>
        </div>
      </header>

      <ol class="ux-steps" aria-label="SmartDeed minting process">
        <li><span>01</span><div><strong>Prepare the property</strong><p>Add its details, documents, and SmartDeed allocation.</p></div></li>
        <li><span>02</span><div><strong>Review and seal</strong><p>Resolve open checks, then seal the agreed property record.</p></div></li>
        <li><span>03</span><div><strong>Approve and vote</strong><p>The owner and one coadministrator approve publication. SGT holders vote separately.</p></div></li>
        <li><span>04</span><div><strong>Mint and confirm</strong><p>Execute a passed proposal and wait for network confirmation.</p></div></li>
      </ol>
      <p class="ux-caption">A proposal is a request to mint. A SmartDeed exists only after the mint transaction is confirmed. Customer offers and delivery follow separately.</p>
      <solslot-admin-refresh-status [state]="refresh" />
      @if (loading()) {
        <div class="mint-feedback" role="status">Loading proposals…</div>
      }

      @if (error(); as message) {
        <section class="mint-read-error" role="alert">
          <strong>{{ proposals().length ? 'Could not update proposals' : 'Could not load proposals' }}</strong>
          <span>{{ message }}</span>
          @if (proposals().length) { <span>Your last successful results are still shown below.</span> }
        </section>
      }

      @if (!loading() && !error() && proposals().length === 0) {
        <section class="mint-empty-state" aria-labelledby="mint-empty-title">
          <span class="empty-step" aria-hidden="true">01</span>
          <div class="empty-copy">
            <h2 id="mint-empty-title">Start with a property</h2>
            <p>No SmartDeed proposals yet. Add the property details and documents, then review and seal its record before opening a proposal.</p>
            <small>Drafting a property does not mint a SmartDeed or offer it for sale.</small>
          </div>
          <a routerLink="/admin/collections" class="btn btn--primary">Open properties <span aria-hidden="true">→</span></a>
        </section>
      }

      @if (proposals().length > 0) {
        <div class="mt-8 collection-table" role="table" aria-label="SmartDeed proposals">
          <div class="table-head" role="row">
            <span>Property / Collection</span>
            <span>State</span>
            <span>Par value</span>
            <span>Created</span>
          </div>
          @for (p of proposals(); track p.id) {
            <a
              class="collection-row"
              role="row"
              [routerLink]="['/admin/mint', p.id]"
            >
              <span class="collection-name">
                <span class="state" [attr.data-state]="p.state">{{ p.state }}</span>
                <strong>{{ p.property_id }}</strong>
                <small class="mono">{{ p.collection_id }}</small>
              </span>
              <span class="mono text-xs"><small class="mobile-label">State</small>{{ p.state }}</span>
              <span class="mono"><small class="mobile-label">Par value</small>{{ formatPar(p.par_value) }}</span>
              <span>
                <small class="mobile-label">Created</small>
                <strong>{{ formatTime(p.timestamps.created_at) }}</strong>
                <small class="mono break-all">{{ shortOwner(p.owner_pubkey) }}</small>
              </span>
            </a>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      .mint-feedback { padding: 2rem 0; color: var(--muted); }
      .mint-read-error { display: grid; gap: 0.5rem; margin-top: 1.25rem; padding: 1.25rem; border: 1px solid rgba(248, 113, 113, 0.4); border-radius: 8px; background: rgba(127, 29, 29, 0.15); font-size: 0.9rem; overflow-wrap: anywhere; }
      .mint-read-error strong { color: #fca5a5; }
      .mint-empty-state {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 1.5rem;
        margin-top: 1.5rem;
        padding: clamp(1.25rem, 3vw, 2rem);
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface, #0b1d17);
      }
      .empty-step { display: grid; place-items: center; width: 3rem; height: 3rem; border: 1px solid var(--border); border-radius: 8px; color: var(--accent, #7cebb1); font: 0.8rem var(--font-mono); }
      .empty-copy { min-width: 0; }
      .empty-copy h2 { font: 1.5rem/1.2 var(--font-display); margin: 0; }
      .empty-copy p { margin: 0.75rem 0; max-width: 42rem; color: var(--muted); font-size: 0.9rem; line-height: 1.6; }
      .empty-copy small { display: block; color: var(--muted); font-size: 0.75rem; line-height: 1.5; }
      .mint-empty-state .btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.75rem; min-height: 44px; white-space: nowrap; }
      .mint-empty-state .btn:focus-visible, .collection-row:focus-visible { outline: 2px solid var(--accent, #7cebb1); outline-offset: 4px; }
      .mobile-label { display: none; }
      .collection-table {
        display: grid;
        gap: 0.5rem;
      }
      .table-head,
      .collection-row {
        display: grid;
        grid-template-columns: 2fr 1fr 1fr 1fr;
        gap: 1rem;
        align-items: center;
        padding: 0.75rem 1rem;
      }
      .table-head {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--muted);
      }
      .collection-row {
        border: 1px solid var(--border);
        text-decoration: none;
        transition: background 0.15s ease;
      }
      .collection-row:hover {
        background: rgba(255, 255, 255, 0.04);
      }
      .collection-name {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .collection-row > span { min-width: 0; overflow-wrap: anywhere; }
      .collection-row > span:last-child { display: grid; gap: 0.35rem; }
      .state {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.15em;
        padding: 0.15rem 0.4rem;
        border: 1px solid rgba(255, 255, 255, 0.14);
        align-self: flex-start;
      }
      .state[data-state='DRAFT'] {
        color: #d4d4d8;
      }
      .state[data-state='PROPOSED'],
      .state[data-state='VOTING'] {
        color: #2ce7ff;
        border-color: rgba(44, 231, 255, 0.4);
      }
      .state[data-state='PASSED'],
      .state[data-state='EXECUTED'] {
        color: #7cffb2;
        border-color: rgba(124, 255, 178, 0.4);
      }
      .state[data-state='MINTED'] {
        color: #04110d;
        background: rgba(124, 255, 178, 0.85);
        border-color: rgba(124, 255, 178, 0.85);
      }
      .state[data-state='FAILED'],
      .state[data-state='CANCELED'] {
        color: #fca5a5;
        border-color: rgba(248, 113, 113, 0.4);
      }
      @media (max-width: 760px) {
        .mint-empty-state { grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 1rem; }
        .mint-empty-state .btn { grid-column: 1 / -1; justify-self: start; max-width: 100%; }
        .table-head { display: none; }
        .collection-row { grid-template-columns: 1fr 1fr; gap: 1rem; }
        .collection-name { grid-column: 1 / -1; }
        .collection-row > span:last-child { grid-column: 1 / -1; }
        .mobile-label { display: block; margin-bottom: 0.35rem; font: 0.65rem var(--font-mono); color: var(--muted); text-transform: uppercase; }
      }
      @media (max-width: 420px) {
        .mint-empty-state { grid-template-columns: 1fr; }
        .empty-step { width: 2.5rem; height: 2.5rem; }
        .mint-empty-state .btn { width: 100%; }
      }
    `,
  ],
})
export class MintListComponent implements OnInit {
  private readonly api = inject(MintProposalApiService);
  private readonly session = inject(AdminSessionService);
  readonly refresh = inject(AdminStatusRefresh);
  private hasLoaded = false;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly proposals = signal<MintProposalResponse[]>([]);

  ngOnInit(): void {
    this.refresh.start(() => this.loadProposals(), () => {
      const expiresAt = this.session.expiresAt();
      return !this.session.isAuthenticated() || !expiresAt || expiresAt * 1000 <= this.refresh.now()
        ? 'Sign in again to update proposals.' : null;
    });
  }

  async reload(): Promise<void> {
    await this.refresh.refresh();
  }

  private async loadProposals(): Promise<void> {
    if (!this.hasLoaded) this.loading.set(true);
    try {
      const subject = this.session.subject();
      const res = await this.api.list({ owner: subject ?? undefined, limit: 100 });
      this.proposals.set(res.proposals);
      this.hasLoaded = true;
      this.error.set(null);
    } catch (e) {
      this.error.set(formatError(e));
      throw e;
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

  formatTime(ts: number | null): string {
    if (!ts) return '—';
    return new Date(ts * 1_000).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric',
      minute: '2-digit', timeZoneName: 'short',
    });
  }

  shortOwner(owner: string): string {
    if (owner.length <= 16) return owner;
    return `${owner.slice(0, 8)}…${owner.slice(-6)}`;
  }
}
