import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import {
  CollectionApiService,
  CollectionFeatureStatus,
  CollectionState,
  CollectionWorkspace,
} from '../../../services/collection-api.service';
import { formatError } from '../../../utils/format-error';

type StateFilter = 'ALL' | CollectionState;

@Component({
  selector: 'pp-admin-collections',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AdminWorkspaceNavComponent],
  template: `
    <solslot-admin-workspace-nav />
    <main class="collection-index">
      <header class="desk-header">
        <div>
          <div class="eyebrow">Property workspace</div>
          <h1>Properties & SmartDeeds</h1>
          <p>Prepare a property once, then manage its documents, ownership plan, review, and SmartDeeds.</p>
        </div>
        <div class="desk-actions">
          <button
            type="button"
            class="btn btn--primary"
            (click)="createOpen.set(true)"
            [disabled]="feature()?.metadataEnabled === false"
          >
            Add property
          </button>
        </div>
      </header>

      <ol class="ux-steps" aria-label="SmartDeed minting process">
        <li><span>01</span><div><strong>Prepare the property</strong><p>Add its details, documents, and SmartDeed allocation.</p></div></li>
        <li><span>02</span><div><strong>Review and seal</strong><p>Resolve open checks, then seal the agreed property record.</p></div></li>
        <li><span>03</span><div><strong>Approve and vote</strong><p>The owner and one coadministrator approve publication. SGT holders vote separately.</p></div></li>
        <li><span>04</span><div><strong>Mint and confirm</strong><p>Execute a passed proposal and wait for network confirmation.</p></div></li>
      </ol>

      @if (feature(); as flags) {
        @if (!flags.metadataEnabled) {
          <section class="notice notice--locked">
            <strong>Property drafting is not available on this server</strong>
            <span>Open System Health to see which release setting is keeping it closed.</span>
            <a routerLink="/admin/system-health">Open System Health</a>
          </section>
        } @else if (!flags.mintingEnabled) {
          <section class="notice">
            <strong>Preparation is open; publishing is closed</strong>
            <span>You can complete and review the property now. No SmartDeed can be published yet.</span>
          </section>
        }
      }

      <nav class="filter-bar" aria-label="Collection state filter">
        @for (state of states; track state) {
          <button
            type="button"
            [class.is-active]="filter() === state"
            [attr.aria-pressed]="filter() === state"
            (click)="filter.set(state)"
          >
            {{ state === 'ALL' ? 'All' : stateLabel(state) }}
          </button>
        }
        <span class="filter-count">{{ filtered().length }} {{ filtered().length === 1 ? 'property' : 'properties' }}</span>
      </nav>

      @if (loading()) {
        <div class="empty-state mono">Loading shared collection workspace…</div>
      } @else if (error()) {
        <section class="notice notice--error" role="alert">
          <strong>Collections could not be loaded</strong>
          <span>{{ error() }}</span>
          <button type="button" class="btn btn--ghost" (click)="reload()">Retry</button>
        </section>
      } @else if (!filtered().length) {
        <section class="empty-state">
          <strong>No properties in this view</strong>
          <span>Add a property to begin its shared collection workspace.</span>
        </section>
      } @else {
        <div class="collection-table" role="table" aria-label="Property collections">
          <div class="table-head" role="row">
              <span>Collection</span><span>Readiness</span><span>Ownership plan</span><span>Updated</span>
          </div>
          @for (collection of filtered(); track collection.id) {
            <a
              class="collection-row"
              role="row"
              [routerLink]="['/admin/collections', collection.id]"
            >
              <span class="collection-name">
                <span class="state" [attr.data-state]="collection.state">
                  {{ collection.state }}
                </span>
                <strong>{{ collection.dossier.title }}</strong>
                <small>{{ propertyTypeLabel(collection) }}</small>
              </span>
              <span class="readiness">
                <strong>{{ readinessLabel(collection) }}</strong>
                <small>{{ collection.readiness.issues.length || 0 }} open checks</small>
              </span>
              <span>
                <strong>{{ allocationPercent(collection) | number: '1.0-3' }}% planned</strong>
                <small>{{ deedCount(collection) }} SmartDeeds</small>
              </span>
              <span>
                <strong>{{ collection.updatedAt * 1000 | date: 'MMM d, y' }}</strong>
                <small>{{ shortOwner(collection.ownerSubject) }}</small>
              </span>
            </a>
          }
        </div>
      }

    </main>

    @if (createOpen()) {
      <div class="dialog-shell" role="dialog" aria-modal="true" aria-label="New collection">
        <button class="dialog-backdrop" type="button" (click)="createOpen.set(false)"></button>
        <form class="dialog" (ngSubmit)="create()">
          <header>
            <div class="eyebrow">New workspace</div>
            <h2>Add a property</h2>
          </header>
          <label>
            Property title
            <input
              name="title"
              [(ngModel)]="newTitle"
              required
              maxlength="180"
              placeholder="127 Eastmoreland Street"
            />
          </label>
          <p class="identifier-note">
            Solslot creates the permanent collection identifier automatically.
          </p>
          @if (createError()) {
            <div class="form-error">{{ createError() }}</div>
          }
          <div class="dialog-actions">
            <button type="button" class="btn btn--ghost" (click)="createOpen.set(false)">
              Cancel
            </button>
            <button type="submit" class="btn btn--primary" [disabled]="creating()">
              {{ creating() ? 'Creating…' : 'Start property workspace' }}
            </button>
          </div>
        </form>
      </div>
    }
  `,
  styles: [
    `
      .collection-index { max-width: 1180px; margin: 0 auto; padding: 2.5rem var(--pad-x) 5rem; }
      .desk-header { display:flex; align-items:flex-end; justify-content:space-between; gap:1.5rem; padding-bottom:1.5rem; border-bottom:1px solid var(--border); }
      .desk-header h1 { font-family:var(--font-sans); font-size:clamp(1.8rem, 4vw, 2.6rem); letter-spacing:0; }
      .desk-header p { color:var(--muted); font-size:.88rem; margin-top:.45rem; max-width:42rem; }
      .eyebrow { color:var(--accent); font:600 .66rem var(--font-mono); text-transform:uppercase; letter-spacing:.18em; margin-bottom:.5rem; }
      .desk-actions { display:flex; flex-wrap:wrap; gap:.6rem; }
      .notice { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:1rem; margin-top:1rem; padding:.85rem 1rem; border:1px solid rgba(44,231,255,.28); border-radius:6px; background:rgba(44,231,255,.06); font-size:.78rem; }
      .notice span { color:var(--muted); }
      .notice a { color:var(--accent); font-size:.72rem; white-space:nowrap; }
      .notice--locked,.notice--error { border-color:rgba(255,145,94,.35); background:rgba(255,145,94,.08); }
      .filter-bar { display:flex; align-items:center; gap:.25rem; margin:1.5rem 0 .75rem; border-bottom:1px solid var(--border); }
      .filter-bar button { padding:.65rem .85rem; border:0; border-bottom:2px solid transparent; background:none; color:var(--muted); font:500 .68rem var(--font-mono); text-transform:uppercase; cursor:pointer; }
      .filter-bar button.is-active { color:var(--text); border-bottom-color:var(--accent); }
      .filter-count { margin-left:auto; color:var(--muted); font-size:.72rem; }
      .collection-table { border:1px solid var(--border); border-radius:6px; overflow:hidden; }
      .table-head,.collection-row { display:grid; grid-template-columns:minmax(15rem,2fr) 1fr 1fr 1fr; align-items:center; gap:1rem; }
      .table-head { padding:.65rem 1rem; background:rgba(255,255,255,.04); color:var(--muted); font:500 .62rem var(--font-mono); text-transform:uppercase; }
      .collection-row { padding:1rem; border-top:1px solid var(--border); transition:background .15s ease; }
      .collection-row:hover { background:rgba(124,255,178,.055); }
      .collection-row > span { display:flex; flex-direction:column; min-width:0; }
      .collection-row strong { font-size:.82rem; letter-spacing:0; }
      .collection-row small { color:var(--muted); font-size:.68rem; margin-top:.15rem; overflow:hidden; text-overflow:ellipsis; }
      .collection-name { position:relative; padding-left:5rem; }
      .state { position:absolute; left:0; top:.1rem; width:4.3rem; color:var(--muted); font:600 .55rem var(--font-mono); letter-spacing:.08em; }
      .state[data-state='SEALED'],.state[data-state='PUBLISHED'] { color:var(--accent); }
      .empty-state { display:flex; flex-direction:column; align-items:center; gap:.35rem; padding:4rem 1rem; color:var(--muted); border:1px dashed var(--border); border-radius:6px; text-align:center; }
      .empty-state strong { color:var(--text); }
      .dialog-shell { position:fixed; inset:0; z-index:1000; display:grid; place-items:center; padding:1rem; }
      .dialog-backdrop { position:absolute; inset:0; border:0; background:rgba(0,0,0,.72); }
      .dialog { position:relative; width:min(32rem,100%); display:grid; gap:1rem; padding:1.5rem; border:1px solid var(--border); border-radius:8px; background:#061412; box-shadow:var(--shadow-soft); }
      .dialog h2 { font-family:var(--font-sans); font-size:1.45rem; letter-spacing:0; }
      label { display:grid; gap:.35rem; color:var(--muted); font-size:.72rem; }
      .dialog-actions { display:flex; justify-content:flex-end; gap:.6rem; margin-top:.5rem; }
      .form-error { color:#ff9c9c; font-size:.72rem; }
      .identifier-note { margin:0; color:var(--muted); font-size:.7rem; }
      @media (max-width:760px) { .desk-header { align-items:flex-start; flex-direction:column; } .table-head { display:none; } .collection-row { grid-template-columns:1fr 1fr; } .collection-name { grid-column:1/-1; } .notice { grid-template-columns:1fr; } }
    `,
  ],
})
export class CollectionsComponent {
  private readonly api = inject(CollectionApiService);
  private readonly router = inject(Router);

  readonly states: StateFilter[] = ['ALL', 'DRAFT', 'REVIEW', 'SEALED', 'PUBLISHED'];
  readonly feature = signal<CollectionFeatureStatus | null>(null);
  readonly collections = signal<CollectionWorkspace[]>([]);
  readonly filter = signal<StateFilter>('ALL');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly createOpen = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly filtered = computed(() => {
    const state = this.filter();
    return state === 'ALL'
      ? this.collections()
      : this.collections().filter((collection) => collection.state === state);
  });

  newTitle = '';

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const feature = await this.api.featureStatus();
      this.feature.set(feature);
      if (feature.metadataEnabled) {
        const result = await this.api.list();
        this.collections.set(result.collections);
      } else {
        this.collections.set([]);
      }
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.loading.set(false);
    }
  }

  async create(): Promise<void> {
    this.creating.set(true);
    this.createError.set(null);
    try {
      const title = this.newTitle.trim();
      if (!title) {
        throw new Error('Enter the property title.');
      }
      const created = await this.api.create(title);
      this.createOpen.set(false);
      await this.router.navigate(['/admin/collections', created.id]);
    } catch (error) {
      this.createError.set(formatError(error));
    } finally {
      this.creating.set(false);
    }
  }

  readinessLabel(collection: CollectionWorkspace): string {
    if (collection.state === 'PUBLISHED') return 'On chain';
    if (collection.readiness?.ready) return 'Ready to seal';
    return 'Needs attention';
  }

  allocationPercent(collection: CollectionWorkspace): number {
    return (
      collection.dossier.deedAllocation.reduce(
      (total, deed) => total + (deed.sharePpm || 0),
      0,
      ) / 10_000
    );
  }

  deedCount(collection: CollectionWorkspace): number {
    return collection.deeds.length || collection.dossier.deedAllocation.length;
  }

  propertyTypeLabel(collection: CollectionWorkspace): string {
    const classification = collection.dossier.classification;
    if (!classification?.assetClass || !classification.projectStage) {
      return 'Classification not complete';
    }
    const classLabels: Record<NonNullable<typeof classification.assetClass>, string> = {
      'RWA-RE-RES': 'Residential',
      'RWA-RE-MFR': 'Multifamily',
      'RWA-RE-COM': 'Commercial',
      'RWA-RE-IND': 'Industrial',
      'RWA-RE-HOS': 'Hospitality',
      'RWA-RE-LAND': 'Land',
      'RWA-RE-MIX': 'Mixed-use',
    };
    const stage = classification.projectStage
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (value: string) => value.toUpperCase());
    return `${classLabels[classification.assetClass]} · ${stage}`;
  }

  stateLabel(state: CollectionState): string {
    return state.charAt(0) + state.slice(1).toLowerCase();
  }

  shortOwner(owner: string): string {
    return owner.length > 18 ? `${owner.slice(0, 10)}…${owner.slice(-6)}` : owner;
  }

}
