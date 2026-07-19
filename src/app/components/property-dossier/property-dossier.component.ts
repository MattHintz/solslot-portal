import { CommonModule } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';

import { CollectionWorkspace } from '../../services/collection-api.service';
import {
  DocumentAssetV1,
  MediaAssetV1,
  PropertyDossierDraftV1,
} from '../../services/property-metadata/property-dossier';
import { VerifiedMediaComponent } from './verified-media.component';

type DossierTab = 'overview' | 'economics' | 'legal' | 'documents' | 'updates' | 'evidence';

@Component({
  selector: 'pp-property-dossier',
  standalone: true,
  imports: [CommonModule, VerifiedMediaComponent],
  template: `
    <article class="dossier">
      <header class="dossier-header">
        <div class="dossier-title">
          <span class="eyebrow">{{ workspace().state === 'PUBLISHED' ? 'SmartDeed collection' : 'Dossier preview' }}</span>
          <h1>{{ dossier().title }}</h1>
          <p>{{ address() || dossier().collectionId }}</p>
        </div>
        <div class="verification" [class.is-verified]="verified()">
          <strong>{{ verified() ? 'Chain verified' : verificationLabel() }}</strong>
          <span class="mono">{{ shortHash(workspace().metadataRoot) }}</span>
        </div>
      </header>

      @if (hero(); as asset) {
        <pp-verified-media [asset]="asset" [rootVerified]="verified()" />
      } @else {
        <div class="hero-empty">Hero image required before publication</div>
      }

      <nav class="dossier-tabs" aria-label="Property dossier views">
        @for (item of tabs; track item.id) {
          <button
            type="button"
            [class.is-active]="tab() === item.id"
            (click)="tab.set(item.id)"
          >{{ item.label }}</button>
        }
      </nav>

      @switch (tab()) {
        @case ('overview') {
          <section class="dossier-section overview-grid">
            <div class="narrative">
              <span class="section-label">Property overview</span>
              <h2>{{ dossier().title }}</h2>
              <p>{{ dossier().summary || 'Summary pending.' }}</p>
            </div>
            <dl class="facts">
              <div><dt>Property type</dt><dd>{{ dossier().property?.propertyType || 'Pending' }}</dd></div>
              <div><dt>Built</dt><dd>{{ dossier().property?.yearBuilt || 'Pending' }}</dd></div>
              <div><dt>Interior</dt><dd>{{ valueWithUnit(dossier().property?.interiorSquareFeet, 'sq ft') }}</dd></div>
              <div><dt>Bedrooms</dt><dd>{{ dossier().property?.bedrooms || 'Pending' }}</dd></div>
              <div><dt>Bathrooms</dt><dd>{{ dossier().property?.bathrooms || 'Pending' }}</dd></div>
              <div><dt>Occupancy</dt><dd>{{ dossier().operations?.occupancyStatus || 'Pending' }}</dd></div>
            </dl>
          </section>

          @if (gallery().length) {
            <section class="dossier-section">
              <div class="section-heading"><span class="section-label">Property media</span><h2>Verified views</h2></div>
              <div class="media-grid">
                @for (asset of gallery(); track asset.assetId) {
                  <pp-verified-media [asset]="asset" [rootVerified]="verified()" [compact]="true" />
                }
              </div>
            </section>
          }

          @if (dossier().history.length) {
            <section class="dossier-section">
              <div class="section-heading"><span class="section-label">Property record</span><h2>History</h2></div>
              <div class="timeline">
                @for (event of dossier().history; track $index) {
                  <div><time>{{ event.date || 'Date pending' }}</time><strong>{{ event.title || 'Untitled event' }}</strong><p>{{ event.detail || '' }}</p></div>
                }
              </div>
            </section>
          }
        }

        @case ('economics') {
          <section class="dossier-section">
            <div class="section-heading"><span class="section-label">Issuance snapshot</span><h2>Economics</h2></div>
            <dl class="metric-grid">
              <div><dt>Market value</dt><dd>{{ money(dossier().valuation?.marketValueMinor, dossier().valuation?.currency) }}</dd><small>As of {{ dossier().valuation?.asOfDate || 'pending' }}</small></div>
              <div><dt>Target raise</dt><dd>{{ money(dossier().offering?.targetRaiseMinor, dossier().offering?.currency) }}</dd><small>{{ dossier().offering?.assetClass || 'Asset class pending' }}</small></div>
              <div><dt>Projected return</dt><dd>{{ bps(dossier().offering?.projectedReturnBps) }}</dd><small>{{ dossier().offering?.termMonths || '—' }} month term</small></div>
              <div><dt>Gross rent</dt><dd>{{ money(dossier().operations?.monthlyGrossRentMinor, dossier().operations?.currency) }}</dd><small>Monthly</small></div>
              <div><dt>Operating expense</dt><dd>{{ money(dossier().operations?.annualOperatingExpenseMinor, dossier().operations?.currency) }}</dd><small>Annual</small></div>
              <div><dt>Debt balance</dt><dd>{{ money(dossier().capital?.debtBalanceMinor, dossier().capital?.currency) }}</dd><small>{{ bps(dossier().capital?.debtRateBps) }} rate</small></div>
            </dl>
          </section>

          <section class="dossier-section split-section">
            <div>
              <span class="section-label">Valuation basis</span>
              <h2>{{ dossier().valuation?.method || 'Method pending' }}</h2>
              <p>{{ dossier().valuation?.source || 'Valuation source pending.' }}</p>
            </div>
            <div>
              <span class="section-label">Operations</span>
              <h2>{{ dossier().operations?.manager || 'Property manager pending' }}</h2>
              <p>{{ dossier().operations?.leaseSummary || 'Lease summary pending.' }}</p>
            </div>
          </section>

          <section class="dossier-section">
            <div class="section-heading"><span class="section-label">SmartDeed plan</span><h2>Allocation</h2></div>
            <div class="allocation-table">
              @for (deed of dossier().deedAllocation; track deed.deedId || $index) {
                <div><strong class="mono">{{ deed.deedId || 'ID pending' }}</strong><span>{{ share(deed.sharePpm) }}</span><span class="mono">{{ deed.parValueMojos || 'Par pending' }} mojos</span></div>
              }
            </div>
          </section>
        }

        @case ('legal') {
          <section class="dossier-section split-section">
            <div>
              <span class="section-label">Issuer</span>
              <h2>{{ dossier().legal?.issuerLegalName || 'Issuer pending' }}</h2>
              <p>{{ dossier().legal?.collateralSummary || 'Collateral summary pending.' }}</p>
            </div>
            <dl class="legal-facts">
              <div><dt>Structure</dt><dd>{{ dossier().legal?.securityStructure || 'Pending' }}</dd></div>
              <div><dt>Filing</dt><dd>{{ dossier().legal?.filingStatus || 'Pending' }}</dd></div>
              <div><dt>Reference</dt><dd class="mono">{{ dossier().legal?.filingReference || 'Pending' }}</dd></div>
              <div><dt>Settlement</dt><dd>{{ dossier().legal?.settlementBasis || 'Pending' }}</dd></div>
            </dl>
          </section>
          <section class="dossier-section">
            <div class="section-heading"><span class="section-label">Risk register</span><h2>Material risks</h2></div>
            <div class="risk-list">
              @for (risk of dossier().risks; track risk.riskId || $index) {
                <article [attr.data-severity]="risk.severity || 'pending'">
                  <span>{{ risk.severity || 'pending' }}</span>
                  <div><strong>{{ risk.title || 'Risk title pending' }}</strong><p>{{ risk.detail || 'Risk detail pending.' }}</p></div>
                </article>
              } @empty {
                <p class="empty-copy">Risk register pending.</p>
              }
            </div>
          </section>
          @if (dossier().disclosures.length) {
            <section class="dossier-section">
              <div class="section-heading"><span class="section-label">Disclosures</span><h2>Investor notices</h2></div>
              <ol class="disclosures">@for (item of dossier().disclosures; track $index) { <li>{{ item }}</li> }</ol>
            </section>
          }
        }

        @case ('documents') {
          <section class="dossier-section">
            <div class="section-heading"><span class="section-label">Verified files</span><h2>Documents</h2></div>
            <div class="document-list">
              @for (document of documents(); track document.assetId) {
                <a [href]="preferredUri(document)" target="_blank" rel="noopener">
                  <span><strong>{{ document.title }}</strong><small>{{ document.category }} · {{ fileSize(document.byteSize) }}</small></span>
                  <span class="mono">{{ shortHash(document.sha256) }}</span>
                </a>
              } @empty {
                <p class="empty-copy">Verified documents pending.</p>
              }
            </div>
          </section>
          @if (dossier().dataSources.length) {
            <section class="dossier-section">
              <div class="section-heading"><span class="section-label">References</span><h2>Data sources</h2></div>
              <div class="source-list">
                @for (source of dossier().dataSources; track $index) {
                  <a [href]="source.url || null" target="_blank" rel="noopener"><strong>{{ source.name || 'Source pending' }}</strong><span>{{ source.asOfDate || 'Date pending' }}</span></a>
                }
              </div>
            </section>
          }
        }

        @case ('updates') {
          <section class="dossier-section">
            <div class="section-heading"><span class="section-label">Append-only record</span><h2>Metadata versions</h2></div>
            <div class="version-list">
              @for (version of workspace().metadataVersions; track version.id) {
                <article>
                  <span class="version-sequence">v{{ version.sequence }}</span>
                  <div><strong>{{ version.kind === 'ISSUANCE' ? 'Governance-approved issuance' : 'Owner-signed operational update' }}</strong><p class="mono">{{ version.metadataRoot }}</p></div>
                  <time>{{ version.createdAt * 1000 | date: 'mediumDate' }}</time>
                </article>
              } @empty {
                <p class="empty-copy">The immutable issuance version appears after the first proposal is published.</p>
              }
            </div>
          </section>
        }

        @case ('evidence') {
          <section class="dossier-section">
            <div class="section-heading"><span class="section-label">Chain evidence</span><h2>Commitments</h2></div>
            <dl class="evidence-grid">
              <div><dt>Metadata root</dt><dd class="mono">{{ workspace().metadataRoot || 'Pending seal' }}</dd></div>
              <div><dt>Anchor ID</dt><dd class="mono">{{ workspace().metadataAnchorId || 'Published with first proposal' }}</dd></div>
              <div><dt>Canonical payload</dt><dd>{{ workspace().canonicalByteSize || workspace().readiness.canonicalByteSize || 0 | number }} bytes</dd></div>
              <div><dt>Governance</dt><dd>{{ workspace().verification?.currentVersionGovernance || 'Pending issuance' }}</dd></div>
            </dl>
          </section>
          <section class="dossier-section">
            <div class="section-heading"><span class="section-label">Deed lineage</span><h2>Proposal status</h2></div>
            <div class="deed-list">
              @for (deed of workspace().deeds; track deed.deedId) {
                <article><div><strong class="mono">{{ deed.deedId }}</strong><span>{{ deed.proposalState }}</span></div><p class="mono">{{ deed.outputCoinId || deed.deedLauncherId || 'Output coin pending' }}</p></article>
              }
            </div>
          </section>
          @if (workspace().anchorEvidence.length) {
            <section class="dossier-section">
              <div class="section-heading"><span class="section-label">Reconstruction</span><h2>Anchor checks</h2></div>
              <div class="deed-list">
                @for (evidence of workspace().anchorEvidence; track evidence.id) {
                  <article><div><strong>{{ evidence.status }}</strong><span>Height {{ evidence.confirmationHeight || 'pending' }}</span></div><p class="mono">{{ evidence.reconstructedRoot || evidence.anchorCoinId }}</p></article>
                }
              </div>
            </section>
          }
        }
      }
    </article>
  `,
  styles: [
    `
      .dossier { width:100%; }
      .dossier-header { display:flex; justify-content:space-between; align-items:flex-end; gap:2rem; padding:1rem 0 1.25rem; }
      .dossier-title h1 { font:600 clamp(1.9rem,5vw,3.6rem)/1.05 var(--font-display); letter-spacing:0; }
      .dossier-title p { margin-top:.45rem; color:var(--muted); }
      .eyebrow,.section-label { display:block; margin-bottom:.45rem; color:var(--accent); font:600 .6rem var(--font-mono); text-transform:uppercase; letter-spacing:.14em; }
      .verification { min-width:12rem; display:flex; flex-direction:column; align-items:flex-end; padding:.65rem 0; color:#ffb5a8; }
      .verification.is-verified { color:var(--accent); }
      .verification strong { font-size:.75rem; }
      .verification span { max-width:15rem; margin-top:.2rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; }
      .hero-empty { display:grid; place-items:center; aspect-ratio:16/9; border:1px dashed var(--border); border-radius:6px; color:var(--muted); font:.7rem var(--font-mono); }
      .dossier-tabs { display:flex; gap:.2rem; overflow-x:auto; margin-top:1.25rem; border-bottom:1px solid var(--border); }
      .dossier-tabs button { flex:0 0 auto; padding:.75rem .8rem; border:0; border-bottom:2px solid transparent; background:none; color:var(--muted); font:600 .62rem var(--font-mono); text-transform:uppercase; cursor:pointer; }
      .dossier-tabs button.is-active { color:var(--text); border-bottom-color:var(--accent); }
      .dossier-section { padding:2.2rem 0; border-bottom:1px solid var(--border); }
      .dossier-section h2 { font-size:1.45rem; letter-spacing:0; }
      .dossier-section p { color:var(--muted); font-size:.82rem; line-height:1.7; }
      .overview-grid,.split-section { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(18rem,.8fr); gap:3rem; }
      .narrative p { max-width:46rem; margin-top:1rem; }
      .facts,.metric-grid,.legal-facts,.evidence-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; margin:0; background:var(--border); border:1px solid var(--border); }
      .facts div,.metric-grid div,.legal-facts div,.evidence-grid div { min-width:0; padding:.85rem; background:var(--bg-2); }
      dt { color:var(--muted); font:.56rem var(--font-mono); text-transform:uppercase; }
      dd { margin:.3rem 0 0; overflow-wrap:anywhere; font-size:.78rem; }
      .metric-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .metric-grid dd { font-size:1.2rem; font-weight:600; }
      .metric-grid small { display:block; margin-top:.25rem; color:var(--muted); font-size:.62rem; }
      .section-heading { margin-bottom:1rem; }
      .media-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:.75rem; }
      .timeline,.risk-list,.version-list,.deed-list { display:grid; gap:1px; background:var(--border); border:1px solid var(--border); }
      .timeline > div,.risk-list article,.version-list article,.deed-list article { display:grid; grid-template-columns:8rem 1fr; gap:1rem; padding:1rem; background:var(--bg-2); }
      .timeline time { color:var(--muted); font:.64rem var(--font-mono); }
      .risk-list article { grid-template-columns:6rem 1fr; }
      .risk-list article > span { color:var(--muted); font:600 .58rem var(--font-mono); text-transform:uppercase; }
      .risk-list article[data-severity='high'] > span { color:#ff9d91; }
      .risk-list article[data-severity='medium'] > span { color:#ffd071; }
      .allocation-table,.document-list,.source-list { border-top:1px solid var(--border); }
      .allocation-table > div,.document-list a,.source-list a { display:grid; grid-template-columns:1.4fr .65fr 1fr; gap:1rem; padding:.85rem 0; border-bottom:1px solid var(--border); font-size:.72rem; }
      .document-list a { grid-template-columns:1fr minmax(8rem,.45fr); align-items:center; }
      .document-list span { display:flex; flex-direction:column; min-width:0; overflow-wrap:anywhere; }
      .document-list small,.source-list span { color:var(--muted); }
      .source-list a { grid-template-columns:1fr auto; }
      .disclosures { display:grid; gap:.65rem; padding-left:1.2rem; color:var(--muted); font-size:.76rem; }
      .version-list article { grid-template-columns:3rem 1fr auto; align-items:start; }
      .version-list article > div { min-width:0; }
      .version-sequence { color:var(--accent); font:600 .64rem var(--font-mono); }
      .version-list article p { overflow-wrap:anywhere; font-size:.62rem; }
      .version-list time { color:var(--muted); font:.62rem var(--font-mono); }
      .deed-list article { grid-template-columns:minmax(10rem,.5fr) 1fr; }
      .deed-list article div { display:flex; justify-content:space-between; gap:1rem; }
      .deed-list article p { overflow-wrap:anywhere; font-size:.62rem; }
      .evidence-grid { grid-template-columns:1fr; }
      .empty-copy { padding:1rem 0; }
      @media (max-width:800px) { .dossier-header { align-items:flex-start; flex-direction:column; } .verification { align-items:flex-start; } .overview-grid,.split-section { grid-template-columns:1fr; gap:1.5rem; } .metric-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .media-grid { grid-template-columns:1fr 1fr; } }
      @media (max-width:520px) { .facts,.metric-grid,.legal-facts { grid-template-columns:1fr; } .media-grid { grid-template-columns:1fr; } .timeline > div,.risk-list article,.version-list article,.deed-list article,.allocation-table > div,.document-list a { grid-template-columns:1fr; } }
    `,
  ],
})
export class PropertyDossierComponent {
  readonly workspace = input.required<CollectionWorkspace>();
  readonly tab = signal<DossierTab>('overview');
  readonly tabs: Array<{ id: DossierTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'economics', label: 'Economics' },
    { id: 'legal', label: 'Legal & risks' },
    { id: 'documents', label: 'Documents' },
    { id: 'updates', label: 'Updates' },
    { id: 'evidence', label: 'On-chain evidence' },
  ];
  readonly dossier = computed(() => this.workspace().dossier);
  readonly verified = computed(() => this.workspace().verification?.verified === true);
  readonly media = computed(() => this.dossier().media.filter(isCompleteMedia));
  readonly hero = computed(() => this.media().find((asset) => asset.role === 'hero') ?? null);
  readonly gallery = computed(() => this.media().filter((asset) => asset.role !== 'hero'));
  readonly documents = computed(() => this.dossier().documents.filter(isCompleteDocument));
  readonly address = computed(() => formatAddress(this.dossier()));

  verificationLabel(): string {
    if (this.workspace().verification?.chainReconstructed === false) return 'Chain proof pending';
    if (this.workspace().state === 'SEALED') return 'Sealed for signature';
    return 'Draft metadata';
  }

  shortHash(value: string | null | undefined): string {
    if (!value) return 'Pending';
    return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
  }

  valueWithUnit(value: string | undefined, unit: string): string {
    return value ? `${value} ${unit}` : 'Pending';
  }

  money(value: string | undefined, currency = 'USD'): string {
    if (!value || !/^-?\d+$/.test(value)) return 'Pending';
    const minor = BigInt(value);
    const negative = minor < 0n;
    const absolute = negative ? -minor : minor;
    const major = absolute / 100n;
    const cents = String(absolute % 100n).padStart(2, '0');
    return `${negative ? '-' : ''}${currency} ${major.toLocaleString('en-US')}.${cents}`;
  }

  bps(value: string | undefined): string {
    if (!value || !/^-?\d+$/.test(value)) return 'Pending';
    return `${(Number(value) / 100).toFixed(2)}%`;
  }

  share(ppm: number | undefined): string {
    return ppm === undefined ? 'Share pending' : `${(ppm / 10_000).toFixed(2)}%`;
  }

  fileSize(bytes: number): string {
    return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
  }

  preferredUri(document: DocumentAssetV1): string {
    return document.uris.find((uri) => uri.startsWith('https://')) ?? document.uris[0];
  }
}

function isCompleteMedia(value: PropertyDossierDraftV1['media'][number]): value is MediaAssetV1 {
  return Boolean(
    value.uris?.length &&
      value.sha256 &&
      value.cid &&
      value.mimeType &&
      value.byteSize,
  );
}

function isCompleteDocument(
  value: PropertyDossierDraftV1['documents'][number],
): value is DocumentAssetV1 {
  return Boolean(
    value.uris?.length &&
      value.sha256 &&
      value.cid &&
      value.mimeType &&
      value.byteSize,
  );
}

function formatAddress(dossier: PropertyDossierDraftV1): string {
  const address = dossier.property?.address;
  if (!address) return '';
  return [address.line1, address.city, address.region, address.postalCode, address.country]
    .filter(Boolean)
    .join(', ');
}
