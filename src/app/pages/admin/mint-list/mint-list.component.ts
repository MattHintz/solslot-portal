import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import { MintProposalResponse } from '../../../services/admin-api.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { MintProposalApiService } from '../../../services/mint-proposal-api.service';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'pp-admin-mint-list',
  standalone: true,
  imports: [CommonModule, RouterLink, AdminWorkspaceNavComponent],
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
      @if (loading()) {
        <div class="mt-10 text-sm text-text-muted">Loading proposals…</div>
      }

      @if (error(); as message) {
        <section class="notice notice--error mt-6" role="alert">
          <strong>Could not load proposals</strong>
          <span>{{ message }}</span>
          <button type="button" class="btn btn--ghost" (click)="reload()">Try again</button>
        </section>
      }

      @if (!loading() && !error() && proposals().length === 0) {
        <div class="mt-10 empty-state">
          <strong>No SmartDeed proposals yet</strong>
          <span>Prepare and seal a property collection before opening its governance proposals.</span>
          <a routerLink="/admin/collections" class="btn btn--primary mt-3">Open collections</a>
        </div>
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
              <span class="mono text-xs">{{ p.state }}</span>
              <span class="mono">{{ formatPar(p.par_value) }}</span>
              <span>
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
    `,
  ],
})
export class MintListComponent implements OnInit {
  private readonly api = inject(MintProposalApiService);
  private readonly session = inject(AdminSessionService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly proposals = signal<MintProposalResponse[]>([]);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const subject = this.session.subject();
      const res = await this.api.list({ owner: subject ?? undefined, limit: 100 });
      this.proposals.set(res.proposals);
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

  formatTime(ts: number | null): string {
    if (!ts) return '—';
    return new Date(ts * 1_000).toISOString().replace('T', ' ').replace('.000Z', 'Z');
  }

  shortOwner(owner: string): string {
    if (owner.length <= 16) return owner;
    return `${owner.slice(0, 8)}…${owner.slice(-6)}`;
  }
}
