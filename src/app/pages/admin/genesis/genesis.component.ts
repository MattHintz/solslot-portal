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

type GenesisAction = 'status' | 'dry-run' | 'deploy' | 'bootstrap-status' | 'bootstrap-session' | null;
type GenesisStageId = 'unlock' | 'base' | 'authority' | 'sealed';

@Component({
  selector: 'pp-admin-genesis',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="container-p pt-10 pb-24 max-w-6xl">
      <div class="rounded-[2rem] border border-brand/20 bg-gradient-to-br from-brand/15 via-white/[0.03] to-black/40 p-6 md:p-10 shadow-[0_0_80px_rgba(0,211,167,0.08)]">
        <div class="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] items-start">
          <div>
            <div class="mono text-[0.7rem] uppercase tracking-[0.28em] text-brand mb-3">
              Solslot · Protocol ceremony · Act I
            </div>
            <h1 class="font-display text-5xl md:text-7xl leading-none">
              @if (bootstrapLocked()) {
                Genesis is sealed.
              } @else {
                Let there be genesis.
              }
            </h1>
            <p class="mt-5 text-text-muted max-w-2xl text-base md:text-lg">
              @if (bootstrapLocked()) {
                The bootstrap ceremony is already finalized. Continue through
                permanent admin login, the admin desk, or recovery artifact review.
              } @else {
                This software is in ceremony mode. Complete the base protocol launch,
                bind the first admin wallet, and seal the bootstrap record before the
                rest of Solslot Protocol opens.
              }
            </p>
            <div class="mt-6 flex flex-wrap gap-3">
              <span class="rounded-full border border-white/10 bg-black/20 px-3 py-1 mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Current stage: {{ activeStageLabel() }}
              </span>
              <span class="rounded-full border border-white/10 bg-black/20 px-3 py-1 mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Token is memory-only
              </span>
            </div>
          </div>

          <div class="card border border-white/10 bg-black/20">
            <h2 class="font-display text-2xl">Ceremony boundary</h2>
            <p class="text-sm text-text-muted mt-2">
              The one-shot token only unlocks Genesis. It does not become protocol
              admin authority.
            </p>
            <p class="text-sm text-text-muted mt-2">
              Genesis is complete only after <code>admin_authority_v2</code> binds
              admin slot 0 and the bootstrap manifest locks the ceremony.
            </p>
            <div class="mt-5 grid gap-2 text-sm">
              <a routerLink="/admin/login" class="btn btn--ghost justify-center">Permanent admin login</a>
              <a routerLink="/admin" class="btn btn--ghost justify-center">Admin desk after Genesis</a>
            </div>
          </div>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-4 mt-6">
        @for (stage of stages; track stage.id) {
          <div
            class="rounded-card border p-4 bg-white/[0.03]"
            [ngClass]="stageClass(stage.id)"
          >
            <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
              {{ stage.kicker }}
            </div>
            <div class="font-display text-xl mt-1">{{ stage.title }}</div>
            <p class="text-xs text-text-muted mt-2">{{ stage.body }}</p>
          </div>
        }
      </div>

      @if (error(); as e) {
        <div class="card mt-6 border border-red-500/40 bg-red-500/10">
          <h3 class="font-display text-xl">Genesis action failed</h3>
          <p class="text-sm break-words mt-1">{{ e }}</p>
        </div>
      }

      <div class="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] mt-6">
        <aside class="space-y-6">
          <div class="card border border-white/10">
            <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-brand">Operator key</div>
            <h2 class="font-display text-3xl mt-1">
              @if (bootstrapLocked()) {
                Genesis is already complete.
              } @else {
                Unlock the ceremony.
              }
            </h2>
            <p class="text-sm text-text-muted mt-2">
              @if (bootstrapLocked()) {
                The bootstrapper is locked. New bootstrap sessions are disabled,
                and the one-shot token is no longer accepted for ceremony steps.
              } @else {
                Paste the one-shot Genesis token. The page keeps it in memory and
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
                  POPULIS_ADMIN_TOKEN
                </div>
                <input
                  type="password"
                  class="input mt-1 w-full mono text-xs"
                  autocomplete="off"
                  [(ngModel)]="tokenInput"
                  placeholder="Paste token to begin"
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
                    1 · Check base manifest
                  }
                </button>
                <button
                  type="button"
                  class="btn btn--ghost justify-center"
                  [disabled]="busy()"
                  (click)="checkBootstrapStatus()"
                >
                  @if (pendingAction() === 'bootstrap-status') {
                    Checking bootstrap seal…
                  } @else {
                    2 · Check bootstrap seal
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
                    3 · Start Genesis session
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
            <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Live state</div>
            <dl class="mt-4 grid gap-3 text-sm">
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
                <dt class="text-text-muted">Ceremony seal</dt>
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
                <h2 class="font-display text-3xl mt-1">Forge the base world.</h2>
                <p class="text-sm text-text-muted mt-2 max-w-2xl">
                  Keep defaults for a first testnet ceremony. Dry-run computes the
                  manifest; deploy pushes the Genesis bundle and persists it.
                </p>
              </div>
              @if (status()?.deployed || deployResult()?.pushed) {
                <span class="rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 mono text-[0.65rem] uppercase tracking-[0.18em] text-green-200">
                  Base ready
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
                <input type="number" class="input mt-1 w-full mono text-xs" min="1" [(ngModel)]="pgtTotalSupplyInput" />
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
            <summary class="cursor-pointer font-display text-2xl">Advanced coin selection</summary>
            <p class="text-xs text-text-muted mt-3">
              Leave these blank unless you intentionally want to force exact faucet coins.
            </p>
            <div class="grid gap-4 md:grid-cols-2 mt-4">
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">SGT coin id</div>
                <input type="text" class="input mt-1 w-full mono text-xs" [(ngModel)]="pgtCoinIdInput" placeholder="0x…" />
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
            </div>
          </details>

          <div class="card border border-brand/20 bg-brand/5">
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="dryRun()">
                @if (pendingAction() === 'dry-run') {
                  Computing dry run…
                } @else {
                  Dry-run Genesis
                }
              </button>
              <button type="button" class="btn btn--primary" [disabled]="busy() || !canDeployBase()" (click)="deploy()">
                @if (pendingAction() === 'deploy') {
                  Deploying…
                } @else {
                  Deploy base protocol
                }
              </button>
              <span class="text-xs text-text-muted">
                Deploy unlocks the first-admin authority chapter.
              </span>
            </div>
            @if (!canDeployBase()) {
              <p class="text-xs text-text-muted mt-3">
                Dry-run successfully before deploying, unless an existing manifest is already loaded.
              </p>
            }
          </div>

          @if (bootstrapLocked()) {
            <div class="card border border-green-500/40 bg-green-500/10">
              <h3 class="font-display text-2xl">Genesis sealed.</h3>
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
                  <span class="btn btn--primary opacity-50 cursor-not-allowed">First-admin ceremony finalized</span>
                  <a routerLink="/admin/login" class="btn btn--ghost">Continue with permanent admin login</a>
                } @else if (canContinueToAuthority()) {
                  <a routerLink="/admin/launch-authority-v2" class="btn btn--primary">Continue Act II: bind admin slot 0</a>
                } @else {
                  <span class="btn btn--primary opacity-50 cursor-not-allowed">Start Genesis session to continue</span>
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
      kicker: 'Chapter 1',
      title: 'Unlock',
      body: 'Token accepted, bootstrap status known, session active.',
    },
    {
      id: 'base',
      kicker: 'Chapter 2',
      title: 'Base world',
      body: 'Dry-run and deploy the base protocol manifest.',
    },
    {
      id: 'authority',
      kicker: 'Chapter 3',
      title: 'First admin',
      body: 'Bind wallet authority as permanent admin slot 0.',
    },
    {
      id: 'sealed',
      kicker: 'Chapter 4',
      title: 'Seal',
      body: 'Finalize public artifacts and lock the bootstrapper.',
    },
  ];

  readonly tokenInput = signal('');
  readonly quorumBpsInput = signal(5000);
  readonly votingWindowSecondsInput = signal(300);
  readonly pgtTotalSupplyInput = signal(1_000_000);
  readonly minProposalStakeInput = signal(10_000);
  readonly fpScaleInput = signal(1000);
  readonly initialPoolStatusInput = signal(1);
  readonly feePerSpendInput = signal(0);
  readonly pgtCoinIdInput = signal('');
  readonly poolCoinIdInput = signal('');
  readonly didCoinIdInput = signal('');
  readonly govCoinIdInput = signal('');

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
  readonly activeStage = computed<GenesisStageId>(() => {
    if (this.bootstrapLocked()) return 'sealed';
    if (this.baseManifestReady()) return 'authority';
    if (this.status() || this.bootstrapStatus()?.authenticated || this.dryRunReady()) return 'base';
    return 'unlock';
  });
  readonly activeStageLabel = computed(() => {
    const stage = this.stages.find((s) => s.id === this.activeStage());
    return stage ? stage.title : 'Genesis';
  });
  readonly manifestJson = computed(() => {
    const manifest = this.deployResult()?.manifest ?? this.status()?.manifest ?? null;
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
      this.actionMessage.set(status.deployed ? 'Base manifest found. Continue to first-admin authority when the Genesis session is active.' : 'No base manifest exists yet. Dry-run Genesis next.');
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
          'The token was accepted, but the browser did not keep the bootstrap cookie. Open http://127.0.0.1:4200 directly instead of the IDE preview, then start the Genesis session again.',
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
      this.actionMessage.set('Dry-run complete. Review the manifest, then deploy the base protocol when it looks right.');
    });
  }

  async deploy(): Promise<void> {
    const ok = window.confirm(
      'This will push the protocol genesis spend bundle and persist the deployment manifest. Dry-run first and continue only if the manifest is correct.',
    );
    if (!ok) return;
    await this.run('deploy', async () => {
      const current = await this.genesis.getDeployment(this.tokenInput());
      this.status.set(current);
      if (current.deployed) {
        this.deployResult.set(null);
        this.actionMessage.set('Base manifest already exists. Continue Act II and bind the first admin wallet.');
        return;
      }
      const result = await this.genesis.deployProtocol(this.tokenInput(), this.request());
      this.deployResult.set(result);
      this.actionMessage.set('Base protocol deployed. Continue Act II and bind the first admin wallet.');
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
      pgt_total_supply: this.pgtTotalSupplyInput(),
      min_proposal_stake: this.minProposalStakeInput(),
      fp_scale: this.fpScaleInput(),
      initial_pool_status: this.initialPoolStatusInput(),
      fee_per_spend: this.feePerSpendInput(),
      ...optionalCoin('pgt_coin_id', this.pgtCoinIdInput()),
      ...optionalCoin('pool_coin_id', this.poolCoinIdInput()),
      ...optionalCoin('did_coin_id', this.didCoinIdInput()),
      ...optionalCoin('gov_coin_id', this.govCoinIdInput()),
    };
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
    if (status.locked) return 'Genesis is sealed. Bootstrap is finalized and the permanent admin path is active.';
    if (status.authenticated) return 'Genesis session active. You can deploy base protocol and continue to first-admin authority.';
    return 'No active Genesis session cookie. Start the Genesis session before continuing to first-admin authority.';
  }
}

interface GenesisStage {
  id: GenesisStageId;
  kicker: string;
  title: string;
  body: string;
}

function optionalCoin(key: 'pgt_coin_id' | 'pool_coin_id' | 'did_coin_id' | 'gov_coin_id', value: string): Partial<GenesisDeployRequest> {
  const trimmed = value.trim();
  return trimmed ? { [key]: trimmed } : {};
}
