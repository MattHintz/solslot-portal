import { CommonModule } from '@angular/common';
import { Component, DestroyRef, Input, inject, signal } from '@angular/core';

import { VerifiedMediaService } from '../../services/verified-media.service';
import { MediaAssetV1 } from '../../services/property-metadata/property-dossier';

@Component({
  selector: 'pp-verified-media',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure class="verified-media" [class.is-compact]="compact">
      @if (objectUrl()) {
        <img [src]="objectUrl()" [alt]="asset.alt" />
      } @else if (loading()) {
        <div class="media-state">Verifying media…</div>
      } @else {
        <div class="media-state media-state--failed">Media verification failed</div>
      }
      @if (objectUrl() && rootVerified) {
        <figcaption>SHA-256 and metadata root verified</figcaption>
      }
    </figure>
  `,
  styles: [
    `
      .verified-media { position:relative; width:100%; margin:0; aspect-ratio:16/9; overflow:hidden; background:#071512; border:1px solid var(--border); border-radius:6px; }
      .verified-media.is-compact { aspect-ratio:4/3; }
      img { width:100%; height:100%; object-fit:cover; }
      .media-state { display:grid; place-items:center; width:100%; height:100%; color:var(--muted); font:.7rem var(--font-mono); }
      .media-state--failed { color:#ffaaa1; }
      figcaption { position:absolute; right:.65rem; bottom:.65rem; max-width:calc(100% - 1.3rem); padding:.35rem .5rem; border:1px solid rgba(124,255,178,.35); border-radius:4px; background:rgba(2,11,11,.88); color:var(--accent); font:600 .56rem var(--font-mono); }
    `,
  ],
})
export class VerifiedMediaComponent {
  private readonly verifier = inject(VerifiedMediaService);
  private readonly destroyRef = inject(DestroyRef);
  private currentObjectUrl: string | null = null;
  private loadToken = 0;

  readonly loading = signal(true);
  readonly objectUrl = signal<string | null>(null);

  @Input({ required: true }) set asset(value: MediaAssetV1) {
    this._asset = value;
    void this.load(value);
  }
  get asset(): MediaAssetV1 {
    return this._asset;
  }
  private _asset!: MediaAssetV1;

  @Input() rootVerified = false;
  @Input() compact = false;

  constructor() {
    this.destroyRef.onDestroy(() => this.revoke());
  }

  private async load(asset: MediaAssetV1): Promise<void> {
    const token = ++this.loadToken;
    this.loading.set(true);
    this.objectUrl.set(null);
    this.revoke();
    try {
      const result = await this.verifier.fetchVerified(asset);
      if (token !== this.loadToken) {
        URL.revokeObjectURL(result.objectUrl);
        return;
      }
      this.currentObjectUrl = result.objectUrl;
      this.objectUrl.set(result.objectUrl);
    } catch {
      if (token === this.loadToken) this.objectUrl.set(null);
    } finally {
      if (token === this.loadToken) this.loading.set(false);
    }
  }

  private revoke(): void {
    if (this.currentObjectUrl) URL.revokeObjectURL(this.currentObjectUrl);
    this.currentObjectUrl = null;
  }
}
