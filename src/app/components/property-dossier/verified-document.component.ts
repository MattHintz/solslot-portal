import { Component, DestroyRef, Input, inject, signal } from '@angular/core';

import { DocumentAssetV1 } from '../../services/property-metadata/property-dossier';
import { VerifiedMediaService } from '../../services/verified-media.service';

@Component({
  selector: 'pp-verified-document',
  standalone: true,
  template: `
    <article>
      <div>
        <strong>{{ asset.title }}</strong>
        <small>{{ asset.category }} · {{ asset.mimeType }}</small>
        <p role="status">
          @if (objectUrl()) {
            {{ rootVerified ? 'File bytes and metadata root verified.' : 'File bytes match; metadata root is not verified.' }}
          } @else if (loading()) {
            Checking the file against its recorded hash, size and type…
          } @else if (!attempted()) {
            Check this file before downloading it.
          } @else {
            File withheld. No source matched its recorded hash, size and type.
          }
        </p>
      </div>
      @if (objectUrl(); as url) {
        <a [href]="url" [attr.download]="downloadName">Download checked file</a>
      } @else if (!loading()) {
        <button type="button" (click)="check()">{{ attempted() ? 'Retry file check' : 'Check file' }}</button>
      }
    </article>
  `,
  styles: [`
    :host { display:block; min-width:0; }
    article { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1rem 0; border-bottom:1px solid var(--border); }
    article > div { min-width:0; }
    strong,small { display:block; overflow-wrap:anywhere; }
    small,p { color:var(--muted); font-size:.75rem; }
    p { margin:.4rem 0 0; }
    a,button { display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:.5rem .8rem; border:1px solid var(--border); background:var(--bg-2); color:var(--text); font:inherit; font-size:.75rem; text-align:center; cursor:pointer; }
    a:focus-visible,button:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
    @media(max-width:520px) { article { align-items:stretch; flex-direction:column; } }
  `],
})
export class VerifiedDocumentComponent {
  private readonly verifier = inject(VerifiedMediaService);
  private token = 0;
  private destroyed = false;
  private controller: AbortController | null = null;
  private _asset!: DocumentAssetV1;
  readonly objectUrl = signal<string | null>(null);
  readonly loading = signal(false);
  readonly attempted = signal(false);

  @Input({ required: true }) set asset(value: DocumentAssetV1) {
    this._asset = value;
    this.controller?.abort();
    ++this.token;
    this.revoke();
    this.loading.set(false);
    this.attempted.set(false);
  }
  get asset(): DocumentAssetV1 { return this._asset; }
  @Input() rootVerified = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      ++this.token;
      this.controller?.abort();
      this.revoke();
    });
  }

  get downloadName(): string {
    const name = this.asset.assetId.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'checked-document';
    const extension: Record<string, string> = {
      'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg',
      'image/webp': '.webp', 'image/gif': '.gif',
    };
    return name + (extension[this.asset.mimeType.toLowerCase()] || '.bin');
  }

  async check(): Promise<void> {
    if (this.destroyed || this.loading()) return;
    const token = ++this.token;
    this.controller = new AbortController();
    this.revoke();
    this.loading.set(true);
    this.attempted.set(true);
    try {
      const result = await this.verifier.fetchVerified(this.asset, this.controller.signal);
      if (token !== this.token || this.destroyed) {
        URL.revokeObjectURL(result.objectUrl);
      } else {
        this.objectUrl.set(result.objectUrl);
      }
    } catch {
      // Keep the source URL inaccessible when verification fails.
    } finally {
      if (token === this.token && !this.destroyed) this.loading.set(false);
    }
  }

  private revoke(): void {
    const previous = this.objectUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.objectUrl.set(null);
  }
}
