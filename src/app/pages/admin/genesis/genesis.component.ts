import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  AdminGenesisService,
  GenesisDeployRequest,
  GenesisDeployResponse,
  GenesisDeploymentStatus,
} from '../../../services/admin-genesis.service';
import {
  AdminBootstrapService,
  BootstrapStatusResponse,
} from '../../../services/admin-bootstrap.service';
import { formatError } from '../../../utils/format-error';
import { environment } from '../../../../environments/environment';

type GenesisAction = 'status' | 'dry-run' | 'deploy' | 'bootstrap-status' | 'bootstrap-session' | null;
type GenesisStageId = 'unlock' | 'base' | 'authority' | 'sealed';

@Component({
  selector: 'pp-admin-genesis',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="container-p pt-8 pb-20 max-w-7xl">
      <header class="border-b border-white/10 pb-5">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="mono text-[0.68rem] uppercase tracking-[0.22em] text-brand mb-2">
              Solslot admin · {{ networkModeLabel() }}
            </div>
            <h1 class="font-display text-3xl md:text-4xl leading-tight">
              @if (bootstrapLocked()) {
                Protocol bootstrap finalized
              } @else {
                Protocol bootstrap control
              }
            </h1>
            <p class="mt-2 text-sm text-text-muted max-w-3xl">
              @if (bootstrapLocked()) {
                Bootstrap artifacts are locked. Use permanent admin login for
                operational work or review the recovery bundle.
              } @else {
                Run the server-side protocol deployment, bind admin slot 0,
                and seal the public artifact bundle before enabling new vault
                and listing flows.
              }
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <a routerLink="/admin/login" class="btn btn--ghost">Permanent admin login</a>
            <a routerLink="/admin" class="btn btn--ghost">Admin desk</a>
            <a routerLink="/admin/recovery" class="btn btn--ghost">Recovery</a>
          </div>
        </div>
      </header>

      <div class="grid gap-3 md:grid-cols-5 mt-5">
        <div class="status-tile">
          <div class="status-label">Network mode</div>
          <div class="status-value">{{ networkModeLabel() }}</div>
        </div>
        <div class="status-tile">
          <div class="status-label">Deployment manifest</div>
          <div class="status-value">{{ baseManifestLabel() }}</div>
        </div>
        <div class="status-tile">
          <div class="status-label">Bootstrap session</div>
          <div class="status-value">{{ bootstrapSessionLabel() }}</div>
        </div>
        <div class="status-tile">
          <div class="status-label">Dry-run</div>
          <div class="status-value">{{ dryRunLabel() }}</div>
        </div>
        <div class="status-tile">
          <div class="status-label">Bootstrap lock</div>
          <div class="status-value">{{ bootstrapLocked() ? 'locked' : 'open' }}</div>
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-4 mt-3">
        @for (stage of stages; track stage.id) {
          <div
            class="rounded-card border p-4 bg-white/[0.03]"
            [ngClass]="stageClass(stage.id)"
          >
            <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
              {{ stage.kicker }}
            </div>
            <div class="font-display text-lg mt-1">{{ stage.title }}</div>
            <p class="text-xs text-text-muted mt-2">{{ stage.body }}</p>
          </div>
        }
      </div>

      @if (error(); as e) {
        <div class="card mt-6 border border-red-500/40 bg-red-500/10">
          <h3 class="font-display text-xl">Admin action failed</h3>
          <p class="text-sm break-words mt-1">{{ e }}</p>
        </div>
      }

      <div class="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] mt-6">
        <aside class="space-y-6">
          <div class="card border border-white/10">
            <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-brand">Access control</div>
            <h2 class="font-display text-2xl mt-1">
              @if (bootstrapLocked()) {
                Bootstrap is finalized
              } @else {
                Start an operator session
              }
            </h2>
            <p class="text-sm text-text-muted mt-2">
              @if (bootstrapLocked()) {
                The bootstrapper is locked. New bootstrap sessions are disabled,
                and the one-shot token is no longer accepted for bootstrap steps.
              } @else {
                Paste the one-shot admin token. The page keeps it in memory and
                sends it only as <code>Authorization: Bearer …</code>.
              }
            </p>
            @if (bootstrapLocked()) {
              <div class="mt-4 grid gap-2">
                <a routerLink="/admin/login" class="btn btn--primary justify-center">Permanent admin login</a>
                <a routerLink="/admin" class="btn btn--ghost justify-center">Open Admin desk</a>
                <a routerLink="/admin/recovery" class="btn btn--ghost justify-center">Review recovery artifacts</a>
              </div>
            } @else {
              <label class="block mt-5">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  SOLSLOT_ADMIN_TOKEN
                </div>
                <input
                  type="password"
                  class="input mt-1 w-full mono text-xs"
                  autocomplete="off"
                  [(ngModel)]="tokenInput"
                  placeholder="Paste one-shot token"
                />
              </label>
              <div class="mt-4 grid gap-2">
                <button
                  type="button"
                  class="btn btn--ghost justify-center"
                  [disabled]="busy()"
                  (click)="checkDeployment()"
                >
                  @if (pendingAction() === 'status') {
                    Checking base manifest…
                  } @else {
                    Check deployment manifest
                  }
                </button>
                <button
                  type="button"
                  class="btn btn--ghost justify-center"
                  [disabled]="busy()"
                  (click)="checkBootstrapStatus()"
                >
                  @if (pendingAction() === 'bootstrap-status') {
                    Checking bootstrap status…
                  } @else {
                    Check bootstrap status
                  }
                </button>
                <button
                  type="button"
                  class="btn btn--primary justify-center"
                  [disabled]="busy()"
                  (click)="startBootstrapSession()"
                >
                  @if (pendingAction() === 'bootstrap-session') {
                    Starting session…
                  } @else {
                    Start bootstrap session
                  }
                </button>
              </div>
            }
            @if (actionMessage()) {
              <div class="mt-4 rounded-card border border-brand/30 bg-brand/10 p-3 text-sm">
                {{ actionMessage() }}
              </div>
            }
            @if (bootstrapCookieWarning()) {
              <div class="mt-4 rounded-card border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-100">
                {{ bootstrapCookieWarning() }}
              </div>
            }
          </div>

          <div class="card border border-white/10">
            <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Boundary rules</div>
            <ul class="mt-4 grid gap-3 text-sm text-text-muted">
              <li>Dry-run does not broadcast and does not write artifacts.</li>
              <li>Deploy broadcasts a {{ networkModeLabel() }} spend bundle and persists <code>deployment_manifest.json</code>.</li>
              <li>The one-shot token is temporary; permanent authority starts at admin slot 0.</li>
              <li>Solslot staging unlocks only from the final public artifact bundle.</li>
            </ul>
          </div>

          <div class="card border border-white/10">
            <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Runtime state</div>
            <dl class="mt-4 grid gap-3 text-sm">
              <div class="flex items-center justify-between gap-3">
                <dt class="text-text-muted">Network mode</dt>
                <dd class="mono">{{ networkModeLabel() }}</dd>
              </div>
              <div class="flex items-center justify-between gap-3">
                <dt class="text-text-muted">Base manifest</dt>
                <dd class="mono">{{ baseManifestLabel() }}</dd>
              </div>
              <div class="flex items-center justify-between gap-3">
                <dt class="text-text-muted">Bootstrap session</dt>
                <dd class="mono">{{ bootstrapSessionLabel() }}</dd>
              </div>
              <div class="flex items-center justify-between gap-3">
                <dt class="text-text-muted">Dry run</dt>
                <dd class="mono">{{ dryRunLabel() }}</dd>
              </div>
              <div class="flex items-center justify-between gap-3">
                <dt class="text-text-muted">Bootstrap lock</dt>
                <dd class="mono">{{ bootstrapLocked() ? 'locked' : 'open' }}</dd>
              </div>
            </dl>
          </div>
        </aside>

        <div class="space-y-6">
          <div class="card border border-white/10">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-brand">Base protocol</div>
                <h2 class="font-display text-2xl mt-1">Deployment parameters</h2>
                <p class="text-sm text-text-muted mt-2 max-w-2xl">
                  Keep defaults for the first {{ networkModeLabel() }} run unless an auditor or
                  operator has approved a specific override. Dry-run computes the
                  manifest; deploy pushes the spend bundle and persists it.
                </p>
              </div>
              @if (status()?.deployed || deployResult()?.pushed) {
                <span class="rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 mono text-[0.65rem] uppercase tracking-[0.18em] text-green-200">
                  Deployment ready
                </span>
              }
            </div>

            <div class="grid gap-4 sm:grid-cols-2 mt-6">
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Quorum bps</div>
                <input type="number" class="input mt-1 w-full mono text-xs" min="1" max="10000" [(ngModel)]="quorumBpsInput" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Voting window sec</div>
                <input type="number" class="input mt-1 w-full mono text-xs" min="1" [(ngModel)]="votingWindowSecondsInput" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">SGT total supply</div>
                <input type="number" class="input mt-1 w-full mono text-xs" min="1" [(ngModel)]="sgtTotalSupplyInput" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Min proposal stake</div>
                <input type="number" class="input mt-1 w-full mono text-xs" min="1" [(ngModel)]="minProposalStakeInput" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">FP scale</div>
                <input type="number" class="input mt-1 w-full mono text-xs" min="1" [(ngModel)]="fpScaleInput" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Min NAV registry version</div>
                <input type="number" class="input mt-1 w-full mono text-xs" min="1" [(ngModel)]="minNavRegistryVersionInput" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Fee per spend</div>
                <input type="number" class="input mt-1 w-full mono text-xs" min="0" [(ngModel)]="feePerSpendInput" />
              </label>
            </div>
            <label class="block mt-4">
              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Initial pool status</div>
              <select class="input mt-1 w-full mono text-xs" [(ngModel)]="initialPoolStatusInput">
                <option [ngValue]="1">Open</option>
                <option [ngValue]="0">Closed</option>
              </select>
            </label>
          </div>

          <details class="card border border-white/10">
            <summary class="cursor-pointer font-display text-xl">Manual faucet coin IDs</summary>
            <p class="text-xs text-text-muted mt-3">
              Leave these blank for normal operation. The server bootstrapper
              automatically handles the funded-faucet fan-out when the faucet
              has enough balance but too few distinct UTXOs.
            </p>
            <div class="grid gap-4 md:grid-cols-2 mt-4">
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">SGT coin id</div>
                <input type="text" class="input mt-1 w-full mono text-xs" [(ngModel)]="sgtCoinIdInput" placeholder="0x…" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Pool coin id</div>
                <input type="text" class="input mt-1 w-full mono text-xs" [(ngModel)]="poolCoinIdInput" placeholder="0x…" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">DID coin id</div>
                <input type="text" class="input mt-1 w-full mono text-xs" [(ngModel)]="didCoinIdInput" placeholder="0x…" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Governance coin id</div>
                <input type="text" class="input mt-1 w-full mono text-xs" [(ngModel)]="govCoinIdInput" placeholder="0x…" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">NAV registry coin id</div>
                <input type="text" class="input mt-1 w-full mono text-xs" [(ngModel)]="navRegistryCoinIdInput" placeholder="0x…" />
              </label>
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Protocol config coin id</div>
                <input type="text" class="input mt-1 w-full mono text-xs" [(ngModel)]="protocolConfigCoinIdInput" placeholder="0x…" />
              </label>
            </div>
          </details>

          <div class="card border border-brand/20 bg-brand/5">
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="dryRun()">
                @if (pendingAction() === 'dry-run') {
                  Computing dry run…
                } @else {
                  Dry-run deployment
                }
              </button>
              <button type="button" class="btn btn--primary" [disabled]="busy() || !canDeployBase()" (click)="deploy()">
                @if (pendingAction() === 'deploy') {
                  Deploying…
                } @else {
                  Deploy protocol bundle
                }
              </button>
              <span class="text-xs text-text-muted">
                Deploy is the first broadcast transaction in this flow.
              </span>
            </div>
            @if (!canDeployBase()) {
              <p class="text-xs text-text-muted mt-3">
                A successful dry-run is required before deploy unless an existing
                deployment manifest is already loaded.
              </p>
            }
          </div>

          @if (bootstrapLocked()) {
            <div class="card border border-green-500/40 bg-green-500/10">
              <h3 class="font-display text-2xl">Bootstrap finalized</h3>
              <p class="text-sm text-text-muted mt-2">
                Bootstrapper locked after successful recordation. The public
                <code>admin_records.json</code>,
                <code>portal_runtime_config.json</code>, and
                <code>bootstrap_manifest.json</code> artifacts are now the
                durable bootstrap record.
              </p>
              <p class="text-sm text-text-muted mt-2">
                Continue with permanent admin login using the recorded admin slot 0 wallet.
              </p>
              <div class="mt-4 flex flex-wrap gap-2">
                <a routerLink="/admin/login" class="btn btn--primary">Permanent admin login</a>
                <a routerLink="/admin" class="btn btn--ghost">Open Admin desk</a>
                <a routerLink="/admin/recovery" class="btn btn--ghost">Open recovery page</a>
              </div>
            </div>
          }

          @if (deployResult(); as r) {
            <div class="card border border-green-500/30 bg-green-500/5">
              <h3 class="font-display text-xl">
                @if (r.pushed) {
                  ✓ Base protocol bundle pushed
                } @else {
                  Dry-run manifest computed
                }
              </h3>
              <dl class="mt-3 grid gap-2 text-sm">
                <div>
                  <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Pushed</dt>
                  <dd class="mono">{{ r.pushed }}</dd>
                </div>
                <div>
                  <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Spend bundle id</dt>
                  <dd class="mono break-all">{{ r.spend_bundle_id || '—' }}</dd>
                </div>
              </dl>
            </div>
          }

          @if (serverGeneratedPins().length) {
            <div class="card border border-brand/20 bg-brand/5">
              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-brand">
                Server-generated public anchors
              </div>
              <h3 class="font-display text-2xl mt-1">Public runtime pins</h3>
              <p class="text-sm text-text-muted mt-2">
                These values are generated by the server bootstrap. They are public
                coordinates for staging unlocks, not secrets and not wallet authority.
              </p>
              <dl class="mt-4 grid gap-3 text-xs">
                @for (pin of serverGeneratedPins(); track pin.label) {
                  <div class="rounded-card border border-white/10 bg-black/20 p-3">
                    <dt class="mono uppercase tracking-[0.16em] text-text-muted">{{ pin.label }}</dt>
                    <dd class="mono break-all mt-1">{{ pin.value }}</dd>
                  </div>
                }
              </dl>
            </div>
          }

          @if (manifestJson()) {
            <div class="card border border-white/10">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 class="font-display text-2xl">Base manifest</h3>
                  <p class="text-sm text-text-muted mt-1">
                    Review this record before continuing to first-admin authority.
                  </p>
                </div>
                <button type="button" class="btn btn--ghost" (click)="copyManifest()">Copy manifest</button>
              </div>
              <pre class="mt-4 mono text-[0.65rem] bg-black/30 p-3 rounded overflow-x-auto max-h-96">{{ manifestJson() }}</pre>
              <div class="mt-4 flex flex-wrap gap-3">
                @if (bootstrapStatus()?.locked === true) {
                  <span class="btn btn--primary opacity-50 cursor-not-allowed">Admin authority finalized</span>
                  <a routerLink="/admin/login" class="btn btn--ghost">Continue with permanent admin login</a>
                } @else if (canContinueToAuthority()) {
                  <a routerLink="/admin/launch-authority-v2" class="btn btn--primary">Continue: bind admin slot 0</a>
                } @else {
                  <span class="btn btn--primary opacity-50 cursor-not-allowed">Start bootstrap session to continue</span>
                }
              </div>
              @if (copyMessage(); as msg) {
                <p class="text-xs text-text-muted mt-2">{{ msg }}</p>
              }
            </div>
          }
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .input {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 0.5rem 0.75rem;
        color: inherit;
      }
      .input:focus {
        outline: none;
        border-color: rgba(0, 200, 120, 0.6);
        background: rgba(255, 255, 255, 0.06);
      }
      .status-tile {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.03);
        padding: 0.85rem 1rem;
        min-height: 76px;
      }
      .status-label {
        font-family: var(--font-mono, monospace);
        font-size: 0.64rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
      }
      .status-value {
        margin-top: 0.35rem;
        font-family: var(--font-mono, monospace);
        font-size: 0.86rem;
        color: rgba(255, 255, 255, 0.9);
      }
      code {
        background: rgba(255, 255, 255, 0.06);
        padding: 0 0.25rem;
        border-radius: 3px;
      }
    `,
  ],
})
export class GenesisComponent {
  private readonly genesis = inject(AdminGenesisService);
  private readonly bootstrap = inject(AdminBootstrapService);

  readonly stages: readonly GenesisStage[] = [
    {
      id: 'unlock',
      kicker: 'Step 1',
      title: 'Operator session',
      body: 'Token checked, bootstrap status known, session cookie active.',
    },
    {
      id: 'base',
      kicker: 'Step 2',
      title: 'Protocol deploy',
      body: 'Dry-run, review, and deploy the base protocol manifest.',
    },
    {
      id: 'authority',
      kicker: 'Step 3',
      title: 'Admin authority',
      body: 'Bind wallet authority as permanent admin slot 0.',
    },
    {
      id: 'sealed',
      kicker: 'Step 4',
      title: 'Artifact lock',
      body: 'Finalize public artifacts and lock the bootstrapper.',
    },
  ];

  readonly tokenInput = signal('');
  readonly quorumBpsInput = signal(5000);
  readonly votingWindowSecondsInput = signal(300);
  readonly sgtTotalSupplyInput = signal(1_000_000);
  readonly minProposalStakeInput = signal(10_000);
  readonly fpScaleInput = signal(1000);
  readonly minNavRegistryVersionInput = signal(1);
  readonly initialPoolStatusInput = signal(1);
  readonly feePerSpendInput = signal(0);
  readonly sgtCoinIdInput = signal('');
  readonly poolCoinIdInput = signal('');
  readonly didCoinIdInput = signal('');
  readonly govCoinIdInput = signal('');
  readonly navRegistryCoinIdInput = signal('');
  readonly protocolConfigCoinIdInput = signal('');

  readonly pendingAction = signal<GenesisAction>(null);
  readonly status = signal<GenesisDeploymentStatus | null>(null);
  readonly bootstrapStatus = signal<BootstrapStatusResponse | null>(null);
  readonly deployResult = signal<GenesisDeployResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly copyMessage = signal<string | null>(null);
  readonly actionMessage = signal<string | null>(null);
  readonly bootstrapCookieWarning = signal<string | null>(null);

  readonly busy = computed(() => this.pendingAction() !== null);
  readonly bootstrapLocked = computed(() => this.bootstrapStatus()?.locked === true);
  readonly baseManifestReady = computed(() => this.status()?.deployed === true || this.deployResult()?.pushed === true);
  readonly dryRunReady = computed(() => this.deployResult()?.pushed === false && !!this.deployResult()?.manifest);
  readonly canDeployBase = computed(() => this.dryRunReady() && this.status()?.deployed !== true);
  readonly canContinueToAuthority = computed(() => this.baseManifestReady() && this.bootstrapStatus()?.authenticated === true);
  readonly networkModeLabel = computed(() => {
    const network =
      this.deployResult()?.network ??
      this.status()?.network ??
      this.currentManifest()?.['network'] ??
      environment.chiaNetwork;
    return typeof network === 'string' && network.length ? network : 'unknown';
  });
  readonly activeStage = computed<GenesisStageId>(() => {
    if (this.bootstrapLocked()) return 'sealed';
    if (this.baseManifestReady()) return 'authority';
    if (this.status() || this.bootstrapStatus()?.authenticated || this.dryRunReady()) return 'base';
    return 'unlock';
  });
  readonly activeStageLabel = computed(() => {
    const stage = this.stages.find((s) => s.id === this.activeStage());
    return stage ? stage.title : 'Bootstrap';
  });
  readonly manifestJson = computed(() => {
    const manifest = this.currentManifest();
    return manifest ? JSON.stringify(manifest, null, 2) : '';
  });
  readonly baseManifestLabel = computed(() => {
    if (this.status()?.deployed || this.deployResult()?.pushed) return 'deployed';
    if (this.dryRunReady()) return 'dry-run ready';
    if (this.status()?.deployed === false) return 'none';
    return 'unknown';
  });
  readonly bootstrapSessionLabel = computed(() => {
    const status = this.bootstrapStatus();
    if (!status) return 'unknown';
    if (status.locked) return 'locked';
    return status.authenticated ? 'active' : 'not active';
  });
  readonly dryRunLabel = computed(() => this.dryRunReady() ? 'complete' : 'needed');
  readonly serverGeneratedPins = computed(() => {
    const manifest = this.currentManifest();
    if (!manifest) return [];
    return [
      ['poolLauncherId', manifest['pool_launcher_id']],
      ['poolInnerPuzzleHash', manifest['pool_inner_puzhash']],
      ['bridgePolicyHash', manifest['bridge_policy_hash']],
      ['membersMerkleRoot', manifest['members_merkle_root']],
      ['protocolConfigLauncherId', manifest['protocol_config_launcher_id']],
      ['vaultVersionRegistryLauncherId', manifest['vault_version_registry_launcher_id'] ?? 'pending first-admin finalize'],
    ]
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
      .map(([label, value]) => ({ label, value }));
  });

  async ngOnInit(): Promise<void> {
    await this.loadBootstrapStatus();
  }

  stageClass(stage: GenesisStageId): string {
    if (stage === this.activeStage()) return 'border-brand/50 bg-brand/10 shadow-[0_0_30px_rgba(0,211,167,0.08)]';
    if (this.stageComplete(stage)) return 'border-green-500/40 bg-green-500/10';
    return 'border-white/10';
  }

  stageComplete(stage: GenesisStageId): boolean {
    switch (stage) {
      case 'unlock':
        return !!this.status() && !!this.bootstrapStatus();
      case 'base':
        return this.baseManifestReady();
      case 'authority':
        return this.bootstrapLocked();
      case 'sealed':
        return this.bootstrapLocked();
    }
  }

  async checkDeployment(): Promise<void> {
    await this.run('status', async () => {
      this.deployResult.set(null);
      const status = await this.genesis.getDeployment(this.tokenInput());
      this.status.set(status);
      this.actionMessage.set(status.deployed ? 'Deployment manifest found. Continue to admin slot 0 after the bootstrap session is active.' : 'No deployment manifest exists yet. Run a deployment dry-run next.');
    });
  }

  async checkBootstrapStatus(): Promise<void> {
    await this.run('bootstrap-status', async () => {
      const status = await this.bootstrap.getBootstrapStatus();
      this.bootstrapStatus.set(status);
      this.actionMessage.set(this.describeBootstrapStatus(status));
    });
  }

  async startBootstrapSession(): Promise<void> {
    if (this.bootstrapLocked()) return;
    await this.run('bootstrap-session', async () => {
      const session = await this.bootstrap.startBootstrapSession(this.tokenInput());
      this.bootstrapStatus.set({
        locked: false,
        authenticated: session.unlocked,
        expires_at: session.expires_at,
      });
      const verified = await this.bootstrap.getBootstrapStatus();
      this.bootstrapStatus.set(verified);
      if (!verified.authenticated) {
        this.bootstrapCookieWarning.set(
          'The token was accepted, but the browser did not keep the bootstrap cookie. Open the hosted admin URL directly instead of an IDE preview, then start the bootstrap session again.',
        );
      } else {
        this.bootstrapCookieWarning.set(null);
      }
      const deployment = await this.genesis.getDeployment(this.tokenInput());
      this.status.set(deployment);
      this.actionMessage.set(this.describeBootstrapStatus(verified));
    });
  }

  async dryRun(): Promise<void> {
    await this.run('dry-run', async () => {
      this.status.set(null);
      const result = await this.genesis.dryRunProtocolDeploy(this.tokenInput(), this.request());
      this.deployResult.set(result);
      this.actionMessage.set('Dry-run complete. Review the manifest and public pins before deploying.');
    });
  }

  async deploy(): Promise<void> {
    const ok = window.confirm(
      `This will broadcast the protocol deployment bundle on ${this.networkModeLabel()} and persist deployment_manifest.json. Continue only after reviewing the dry-run manifest.`,
    );
    if (!ok) return;
    await this.run('deploy', async () => {
      const current = await this.genesis.getDeployment(this.tokenInput());
      this.status.set(current);
      if (current.deployed) {
        this.deployResult.set(null);
        this.actionMessage.set('Deployment manifest already exists. Continue to admin slot 0 binding.');
        return;
      }
      const result = await this.genesis.deployProtocol(this.tokenInput(), this.request());
      this.deployResult.set(result);
      this.actionMessage.set('Protocol deployment pushed. Continue to admin slot 0 binding.');
    });
  }

  async copyManifest(): Promise<void> {
    const json = this.manifestJson();
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      this.copyMessage.set('Copied manifest to clipboard.');
    } catch {
      this.copyMessage.set('Copy failed — select and copy manually.');
    }
  }

  private async run(action: Exclude<GenesisAction, null>, work: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    this.copyMessage.set(null);
    this.actionMessage.set(null);
    if (action !== 'bootstrap-session') this.bootstrapCookieWarning.set(null);
    this.pendingAction.set(action);
    try {
      await work();
    } catch (e) {
      this.error.set(formatError(e));
    } finally {
      this.pendingAction.set(null);
    }
  }

  private request(): GenesisDeployRequest {
    return {
      quorum_bps: this.quorumBpsInput(),
      voting_window_seconds: this.votingWindowSecondsInput(),
      sgt_total_supply: this.sgtTotalSupplyInput(),
      min_proposal_stake: this.minProposalStakeInput(),
      fp_scale: this.fpScaleInput(),
      min_nav_registry_version: this.minNavRegistryVersionInput(),
      initial_pool_status: this.initialPoolStatusInput(),
      fee_per_spend: this.feePerSpendInput(),
      ...optionalCoin('sgt_coin_id', this.sgtCoinIdInput()),
      ...optionalCoin('pool_coin_id', this.poolCoinIdInput()),
      ...optionalCoin('did_coin_id', this.didCoinIdInput()),
      ...optionalCoin('gov_coin_id', this.govCoinIdInput()),
      ...optionalCoin('nav_registry_coin_id', this.navRegistryCoinIdInput()),
      ...optionalCoin('protocol_config_coin_id', this.protocolConfigCoinIdInput()),
    };
  }

  private currentManifest(): GenesisDeploymentStatus['manifest'] {
    return this.deployResult()?.manifest ?? this.status()?.manifest ?? null;
  }

  private async loadBootstrapStatus(): Promise<void> {
    try {
      const status = await this.bootstrap.getBootstrapStatus();
      this.bootstrapStatus.set(status);
      if (status.locked) {
        this.actionMessage.set(this.describeBootstrapStatus(status));
      }
    } catch {
    }
  }

  private describeBootstrapStatus(status: BootstrapStatusResponse): string {
    if (status.locked) return 'Bootstrap finalized. Permanent admin login is active.';
    if (status.authenticated) return 'Bootstrap session active. You can deploy the base protocol and continue to admin slot 0.';
    return 'No active bootstrap session cookie. Start the bootstrap session before continuing.';
  }
}

interface GenesisStage {
  id: GenesisStageId;
  kicker: string;
  title: string;
  body: string;
}

function optionalCoin(
  key:
    | 'sgt_coin_id'
    | 'pool_coin_id'
    | 'did_coin_id'
    | 'gov_coin_id'
    | 'nav_registry_coin_id'
    | 'protocol_config_coin_id',
  value: string,
): Partial<GenesisDeployRequest> {
  const trimmed = value.trim();
  return trimmed ? { [key]: trimmed } : {};
}
