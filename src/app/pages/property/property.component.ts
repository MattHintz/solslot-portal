import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PropertyDossierComponent } from '../../components/property-dossier/property-dossier.component';
import { CollectionApiService, CollectionWorkspace } from '../../services/collection-api.service';
import { formatError } from '../../utils/format-error';

@Component({
  selector: 'pp-property',
  standalone: true,
  imports: [CommonModule, RouterLink, PropertyDossierComponent],
  template: `
    <main class="property-page">
      <nav class="public-nav">
        <a routerLink="/">Solslot</a>
        <span>Public property record</span>
      </nav>
      @if (loading()) {
        <div class="page-state mono">Loading chain-verifiable dossier…</div>
      } @else if (error()) {
        <section class="page-state page-state--error">
          <strong>Property record unavailable</strong>
          <span>{{ error() }}</span>
        </section>
      } @else if (workspace(); as collection) {
        <pp-property-dossier [workspace]="collection" />
      }
    </main>
  `,
  styles: [
    `
      .property-page { width:min(1180px,100%); margin:0 auto; padding:1rem var(--pad-x) 5rem; }
      .public-nav { display:flex; align-items:center; justify-content:space-between; min-height:3.5rem; border-bottom:1px solid var(--border); font-size:.68rem; }
      .public-nav a { color:var(--accent); font-weight:700; }
      .public-nav span { color:var(--muted); font-family:var(--font-mono); }
      .page-state { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:55vh; gap:.5rem; color:var(--muted); text-align:center; }
      .page-state--error strong { color:#ffaaa1; }
    `,
  ],
})
export class PropertyComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CollectionApiService);

  readonly workspace = signal<CollectionWorkspace | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const identifier = this.route.snapshot.paramMap.get('id');
    if (!identifier) {
      this.error.set('Missing property identifier.');
      this.loading.set(false);
      return;
    }
    try {
      this.workspace.set(await this.api.getPublic(identifier));
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.loading.set(false);
    }
  }
}
