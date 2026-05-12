import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { sha256 } from 'ethers';

import {
  AdminBootstrapService,
  BootstrapManifestArtifact,
  BootstrapRecoveryAnchorVerifyResponse,
  PortalRuntimeConfigArtifact,
} from '../../../services/admin-bootstrap.service';
import {
  DiscoveredRecoveryAnchor,
  RecoveryAnchorDiscoveryReport,
  RecoveryAnchorDiscoveryService,
} from '../../../services/recovery-anchor-discovery.service';

@Component({
  selector: 'app-recovery',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="recovery-page">
      <a routerLink="/admin/genesis" class="back">← Genesis ceremony</a>

      <section class="hero">
        <p class="eyebrow">Path A recovery</p>
        <h1>Bootstrap recovery</h1>
        <p>
          Discover on-chain recovery anchors, paste public bootstrap artifacts,
          and verify that the recovered files match the marker coin payload.
        </p>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2>1. Find recovery anchors</h2>
            <p>Scans coinset.org by the POPULIS_BOOTSTRAP_V1 marker memo.</p>
          </div>
          <button type="button" class="primary" (click)="scanAnchors()" [disabled]="discoveryState().kind === 'pending'">
            {{ discoveryState().kind === 'pending' ? 'Scanning…' : 'Scan chain' }}
          </button>
        </div>

        @if (discoveryState().kind === 'error') {
          <p class="status error">Scan failed: {{ discoveryState().message }}</p>
        }
        @if (discoveryState().kind === 'ready') {
          <p class="status ok">
            Found {{ discoveryState().report.anchors.length }} verified anchor(s)
            from {{ discoveryState().report.scannedCandidateCount }} candidate marker coin(s).
          </p>
          @if (discoveryState().report.rejectedCandidates.length > 0) {
            <p class="status warn">
              Rejected {{ discoveryState().report.rejectedCandidates.length }} malformed candidate(s).
            </p>
            <details class="payload">
              <summary>Rejected candidate details</summary>
              <div class="rejected-list">
                @for (candidate of discoveryState().report.rejectedCandidates; track candidate.markerCoinId) {
                  <div class="rejected">
                    <strong>marker={{ candidate.markerCoinId }}</strong>
                    <span>parent={{ candidate.parentCoinId }}</span>
                    <span>block={{ candidate.confirmedBlockIndex }}</span>
                    <em>{{ candidate.reason }}</em>
                  </div>
                }
              </div>
            </details>
          }
          @if (discoveryState().report.anchors.length === 0) {
            <p class="muted">No recovery anchors found yet.</p>
          }
          <div class="anchor-list">
            @for (anchor of discoveryState().report.anchors; track anchor.markerCoinId; let i = $index) {
              <button
                type="button"
                class="anchor"
                [class.selected]="selectedAnchorIndex() === i"
                (click)="selectAnchor(i)"
              >
                <strong>{{ anchor.bootstrapRecoveryAnchor.network }}</strong>
                <span>launcher={{ anchor.bootstrapRecoveryAnchor.admin_authority_v2_launcher_id }}</span>
                <span>marker={{ anchor.markerCoinId }}</span>
                <span>block={{ anchor.confirmedBlockIndex }}</span>
              </button>
            }
          </div>
        }
      </section>

      <section class="card">
        <h2>2. Paste recovered public artifacts</h2>
        <p class="muted">
          Required: bootstrap_manifest.json, portal_runtime_config.json, and admin_records.json.
          deployment_manifest.json is optional but strengthens verification when available.
        </p>

        @if (selectedAnchor(); as anchor) {
          <details class="payload" open>
            <summary>Selected bootstrap_recovery_anchor.json payload</summary>
            <pre>{{ selectedAnchorPayloadJson() }}</pre>
          </details>
        } @else {
          <p class="status warn">Select or scan an anchor before verification.</p>
        }

        <div class="grid">
          <label>
            <span>bootstrap_manifest.json</span>
            <textarea [ngModel]="bootstrapManifestText()" (ngModelChange)="bootstrapManifestText.set($event)"></textarea>
          </label>
          <label>
            <span>portal_runtime_config.json</span>
            <textarea [ngModel]="portalRuntimeConfigText()" (ngModelChange)="portalRuntimeConfigText.set($event)"></textarea>
          </label>
          <label>
            <span>admin_records.json</span>
            <textarea [ngModel]="adminRecordsText()" (ngModelChange)="adminRecordsText.set($event)"></textarea>
          </label>
          <label>
            <span>deployment_manifest.json optional</span>
            <textarea [ngModel]="deploymentManifestText()" (ngModelChange)="deploymentManifestText.set($event)"></textarea>
          </label>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2>3. Verify and restore trust roots</h2>
            <p>Local hashes must match the on-chain anchor before the API verifier is called.</p>
          </div>
          <button type="button" class="primary" (click)="verifyArtifacts()" [disabled]="!selectedAnchor() || verifyState().kind === 'pending'">
            {{ verifyState().kind === 'pending' ? 'Verifying…' : 'Verify recovered artifacts' }}
          </button>
        </div>

        @if (localHashChecks().length > 0) {
          <div class="checks">
            @for (check of localHashChecks(); track check.name) {
              <div class="check" [class.ok]="check.status === 'match'" [class.error]="check.status === 'mismatch' || check.status === 'invalid'" [class.warn]="check.status === 'missing'">
                <strong>{{ check.name }}</strong>
                <span>{{ check.status }}</span>
                <code>expected={{ check.expected }}</code>
                @if (check.actual) {
                  <code>actual={{ check.actual }}</code>
                }
                @if (check.message) {
                  <em>{{ check.message }}</em>
                }
              </div>
            }
          </div>
        }

        @if (verifyState().kind === 'verified') {
          <p class="status ok">
            Recovery artifacts verified. Admin authority launcher:
            {{ verifyState().response.admin_authority_v2_launcher_id }}.
          </p>
          <a routerLink="/admin/login" class="primary link-button">Continue to permanent admin login</a>
        }
        @if (verifyState().kind === 'rejected') {
          <p class="status error">Verifier rejected artifacts: {{ verifyState().response.error || 'unknown mismatch' }}</p>
        }
        @if (verifyState().kind === 'error') {
          <p class="status error">Verification failed: {{ verifyState().message }}</p>
        }
      </section>
    </main>
  `,
  styles: [
    `
      .recovery-page {
        display: grid;
        gap: 1.25rem;
        max-width: 1180px;
        margin: 0 auto;
        padding: 2rem;
        color: #e8f5ff;
      }
      .back,
      .link-button {
        color: #9ee8ff;
        text-decoration: none;
      }
      .hero,
      .card {
        border: 1px solid rgba(158, 232, 255, 0.18);
        border-radius: 24px;
        background: rgba(7, 17, 31, 0.82);
        padding: 1.25rem;
        box-shadow: 0 20px 80px rgba(0, 0, 0, 0.24);
      }
      .hero h1,
      .card h2 {
        margin: 0 0 0.5rem;
      }
      .eyebrow,
      .muted {
        color: rgba(232, 245, 255, 0.68);
      }
      .card-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
      }
      .primary {
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #64f4ff, #9c7cff);
        color: #07111f;
        font-weight: 800;
        padding: 0.75rem 1rem;
        cursor: pointer;
      }
      .primary:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .anchor-list,
      .checks,
      .grid,
      .rejected-list {
        display: grid;
        gap: 0.75rem;
      }
      .grid {
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      }
      .anchor,
      .check,
      .payload {
        border: 1px solid rgba(158, 232, 255, 0.16);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.04);
        color: inherit;
        padding: 0.85rem;
      }
      .anchor {
        display: grid;
        gap: 0.35rem;
        text-align: left;
      }
      .anchor.selected {
        border-color: #64f4ff;
        background: rgba(100, 244, 255, 0.11);
      }
      label {
        display: grid;
        gap: 0.45rem;
        color: rgba(232, 245, 255, 0.78);
      }
      textarea {
        min-height: 220px;
        resize: vertical;
        border: 1px solid rgba(158, 232, 255, 0.18);
        border-radius: 18px;
        background: rgba(0, 0, 0, 0.25);
        color: #e8f5ff;
        padding: 0.85rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      pre,
      code {
        white-space: pre-wrap;
        word-break: break-all;
      }
      .status {
        border-radius: 16px;
        padding: 0.75rem 0.9rem;
      }
      .ok {
        background: rgba(50, 220, 150, 0.12);
      }
      .warn {
        background: rgba(255, 204, 102, 0.12);
      }
      .error {
        background: rgba(255, 100, 120, 0.14);
      }
      .check {
        display: grid;
        gap: 0.25rem;
      }
      .rejected {
        display: grid;
        gap: 0.25rem;
        color: rgba(232, 245, 255, 0.78);
      }
    `,
  ],
})
export class RecoveryComponent {
  private readonly discovery = inject(RecoveryAnchorDiscoveryService);
  private readonly bootstrap = inject(AdminBootstrapService);

  readonly discoveryState = signal<DiscoveryState>({ kind: 'idle' });
  readonly verifyState = signal<VerifyState>({ kind: 'idle' });
  readonly selectedAnchorIndex = signal<number | null>(null);

  readonly bootstrapManifestText = signal('');
  readonly portalRuntimeConfigText = signal('');
  readonly adminRecordsText = signal('');
  readonly deploymentManifestText = signal('');

  readonly selectedAnchor = computed(() => {
    const state = this.discoveryState();
    if (state.kind !== 'ready') return null;
    const index = this.selectedAnchorIndex();
    if (index === null) return state.report.anchors[0] ?? null;
    return state.report.anchors[index] ?? null;
  });

  readonly selectedAnchorPayloadJson = computed(() => {
    const anchor = this.selectedAnchor();
    return anchor ? JSON.stringify(anchor.bootstrapRecoveryAnchor, null, 2) : '';
  });

  readonly localHashChecks = computed<ArtifactHashCheck[]>(() => {
    const anchor = this.selectedAnchor();
    if (!anchor) return [];
    return [
      this.hashCheck(
        'bootstrap_manifest.json',
        this.bootstrapManifestText(),
        anchor.bootstrapRecoveryAnchor.bootstrap_manifest_hash,
      ),
      this.hashCheck(
        'portal_runtime_config.json',
        this.portalRuntimeConfigText(),
        anchor.bootstrapRecoveryAnchor.portal_runtime_config_hash,
      ),
      this.hashCheck(
        'admin_records.json',
        this.adminRecordsText(),
        anchor.bootstrapRecoveryAnchor.admin_records_hash,
      ),
    ];
  });

  async scanAnchors(): Promise<void> {
    if (this.discoveryState().kind === 'pending') return;
    this.discoveryState.set({ kind: 'pending' });
    this.verifyState.set({ kind: 'idle' });
    try {
      const report = await this.discovery.discoverAnchors();
      this.discoveryState.set({ kind: 'ready', report });
      this.selectedAnchorIndex.set(report.anchors.length > 0 ? 0 : null);
    } catch (err) {
      this.discoveryState.set({ kind: 'error', message: formatError(err) });
      this.selectedAnchorIndex.set(null);
    }
  }

  selectAnchor(index: number): void {
    this.selectedAnchorIndex.set(index);
    this.verifyState.set({ kind: 'idle' });
  }

  async verifyArtifacts(): Promise<void> {
    const anchor = this.selectedAnchor();
    if (!anchor) {
      this.verifyState.set({ kind: 'error', message: 'Select a recovery anchor first.' });
      return;
    }
    const failedCheck = this.localHashChecks().find((check) => check.status !== 'match');
    if (failedCheck) {
      this.verifyState.set({
        kind: 'error',
        message: `${failedCheck.name} ${failedCheck.status}; fix local hash checks first.`,
      });
      return;
    }
    this.verifyState.set({ kind: 'pending' });
    try {
      const bootstrapManifest = parseJsonObject<BootstrapManifestArtifact>(
        this.bootstrapManifestText(),
        'bootstrap_manifest.json',
      );
      const portalRuntimeConfig = parseJsonObject<PortalRuntimeConfigArtifact>(
        this.portalRuntimeConfigText(),
        'portal_runtime_config.json',
      );
      const adminRecords = parseJsonObject<Record<string, unknown>>(
        this.adminRecordsText(),
        'admin_records.json',
      );
      const deploymentManifest = this.deploymentManifestText().trim()
        ? parseJsonObject<Record<string, unknown>>(
            this.deploymentManifestText(),
            'deployment_manifest.json',
          )
        : null;
      const response = await this.bootstrap.verifyRecoveryArtifacts({
        bootstrap_recovery_anchor: anchor.bootstrapRecoveryAnchor,
        bootstrap_manifest: bootstrapManifest,
        portal_runtime_config: portalRuntimeConfig,
        admin_records: adminRecords,
        deployment_manifest: deploymentManifest,
      });
      this.verifyState.set(
        response.verified
          ? { kind: 'verified', response }
          : { kind: 'rejected', response },
      );
    } catch (err) {
      this.verifyState.set({ kind: 'error', message: formatError(err) });
    }
  }

  private hashCheck(name: string, text: string, expected: string): ArtifactHashCheck {
    if (!text.trim()) {
      return { name, expected, actual: null, status: 'missing' };
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      const actual = contentHash(parsed);
      return {
        name,
        expected,
        actual,
        status: actual.toLowerCase() === expected.toLowerCase() ? 'match' : 'mismatch',
      };
    } catch (err) {
      return {
        name,
        expected,
        actual: null,
        status: 'invalid',
        message: formatError(err),
      };
    }
  }
}

type DiscoveryState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ready'; report: RecoveryAnchorDiscoveryReport }
  | { kind: 'error'; message: string };

type VerifyState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'verified'; response: BootstrapRecoveryAnchorVerifyResponse }
  | { kind: 'rejected'; response: BootstrapRecoveryAnchorVerifyResponse }
  | { kind: 'error'; message: string };

interface ArtifactHashCheck {
  name: string;
  expected: string;
  actual: string | null;
  status: 'missing' | 'match' | 'mismatch' | 'invalid';
  message?: string;
}

function parseJsonObject<T extends Record<string, unknown>>(text: string, label: string): T {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as T;
}

function contentHash(value: unknown): string {
  return `sha256:${sha256(new TextEncoder().encode(canonicalJson(value))).slice(2)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
