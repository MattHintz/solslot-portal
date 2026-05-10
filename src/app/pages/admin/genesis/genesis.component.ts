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

@Component({
  selector: 'pp-admin-genesis',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="container-p pt-12 pb-24 max-w-5xl">
      <header class="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
            Populis · Let there be genesis
          </div>
          <h1 class="font-display text-4xl md:text-5xl">Genesis launch.</h1>
          <p class="mt-3 text-text-muted max-w-2xl text-sm">
            Initialize the base protocol stack through the existing one-shot
            <code>/admin/deploy/protocol</code> endpoint. This page is not
            guarded by admin login because the first admin may not exist yet;
            paste the genesis admin token only when you are ready to check,
            dry-run, or deploy.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a routerLink="/admin/login" class="btn btn--ghost">Admin login</a>
          <a routerLink="/admin" class="btn btn--ghost">Admin desk</a>
        </div>
      </header>

      <div class="card mt-8 border border-yellow-500/30 bg-yellow-500/10">
        <h2 class="font-display text-2xl">Bootstrap boundary</h2>
        <p class="text-sm text-text-muted mt-2">
          This base genesis deploy does not create admin slot 0 and does not
          make the token holder a protocol admin. The token is operator
          authority for the one-shot deploy endpoint only.
        </p>
        <p class="text-sm text-text-muted mt-2">
          The first admin must be launched separately at
          <code>admin_authority_v2</code> genesis. After the base manifest is
          correct, continue to the first-admin authority launch and bind the
          intended wallet as admin slot 0.
        </p>
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_1fr] mt-10">
        <div class="card">
          <h2 class="font-display text-2xl">Operator token</h2>
          <p class="text-xs text-text-muted mt-1">
            The token is kept only in this page's memory and sent as
            <code>Authorization: Bearer …</code>.
          </p>
          <label class="block mt-4">
            <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
              One-shot admin token
            </div>
            <input
              type="password"
              class="input mt-1 w-full mono text-xs"
              autocomplete="off"
              [(ngModel)]="tokenInput"
              placeholder="POPULIS_ADMIN_TOKEN"
            />
          </label>
          <button
            type="button"
            class="btn btn--ghost mt-4"
            [disabled]="busy()"
            (click)="checkDeployment()"
          >
            @if (pendingAction() === 'status') {
              Checking…
            } @else {
              Check current deployment
            }
          </button>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn--ghost"
              [disabled]="busy()"
              (click)="checkBootstrapStatus()"
            >
              @if (pendingAction() === 'bootstrap-status') {
                Checking bootstrap…
              } @else {
                Check bootstrap session
              }
            </button>
            <button
              type="button"
              class="btn btn--primary"
              [disabled]="busy() || bootstrapStatus()?.locked === true"
              (click)="startBootstrapSession()"
            >
              @if (pendingAction() === 'bootstrap-session') {
                Starting bootstrap…
              } @else {
                Start bootstrap session
              }
            </button>
          </div>
        </div>

        <div class="card">
          <h2 class="font-display text-2xl">Deployment parameters</h2>
          <div class="grid gap-4 sm:grid-cols-2 mt-4">
            <label class="block">
              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Quorum bps</div>
              <input type="number" class="input mt-1 w-full mono text-xs" min="1" max="10000" [(ngModel)]="quorumBpsInput" />
            </label>
            <label class="block">
              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Voting window sec</div>
              <input type="number" class="input mt-1 w-full mono text-xs" min="1" [(ngModel)]="votingWindowSecondsInput" />
            </label>
            <label class="block">
              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">PGT total supply</div>
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
      </div>

      <div class="card mt-6">
        <h2 class="font-display text-2xl">Optional explicit faucet coins</h2>
        <p class="text-xs text-text-muted mt-1">
          Leave blank to let the API choose four distinct unspent faucet coins.
        </p>
        <div class="grid gap-4 md:grid-cols-2 mt-4">
          <label class="block">
            <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">PGT coin id</div>
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
      </div>

      <div class="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="dryRun()">
          @if (pendingAction() === 'dry-run') {
            Computing dry run…
          } @else {
            Dry-run genesis
          }
        </button>
        <button type="button" class="btn btn--primary" [disabled]="busy()" (click)="deploy()">
          @if (pendingAction() === 'deploy') {
            Deploying…
          } @else {
            Deploy protocol genesis
          }
        </button>
        <span class="text-xs text-text-muted">
          Dry-run first; deploy refuses if a manifest already exists.
        </span>
      </div>

      @if (error(); as e) {
        <div class="card mt-6 border border-red-500/40 bg-red-500/10">
          <h3 class="font-display text-xl">Genesis action failed</h3>
          <p class="text-sm break-words mt-1">{{ e }}</p>
        </div>
      }

      @if (status(); as s) {
        <div class="card mt-6 border border-white/10">
          <h3 class="font-display text-xl">Deployment status</h3>
          <p class="text-sm mt-1">
            @if (s.deployed) {
              Manifest exists.
            } @else {
              No manifest exists yet.
            }
          </p>
        </div>
      }

      @if (bootstrapStatus(); as b) {
        <div class="card mt-6 border border-white/10">
          <h3 class="font-display text-xl">Bootstrap session</h3>
          <p class="text-sm mt-1">
            @if (b.locked) {
              Bootstrapper locked after successful recordation.
            } @else if (b.authenticated) {
              Bootstrap session active.
            } @else {
              No active bootstrap session cookie.
            }
          </p>
          @if (b.expires_at) {
            <p class="mono text-xs text-text-muted mt-2">Expires at {{ b.expires_at }}</p>
          }
        </div>
      }

      @if (deployResult(); as r) {
        <div class="card mt-6 border border-green-500/30 bg-green-500/5">
          <h3 class="font-display text-xl">
            @if (r.pushed) {
              ✓ Genesis bundle pushed
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
        <div class="card mt-6">
          <h3 class="font-display text-xl">Manifest</h3>
          <pre class="mt-3 mono text-[0.65rem] bg-black/30 p-3 rounded overflow-x-auto">{{ manifestJson() }}</pre>
          <div class="mt-4 flex flex-wrap gap-3">
            <button type="button" class="btn btn--ghost" (click)="copyManifest()">Copy manifest</button>
            @if (bootstrapStatus()?.locked === true) {
              <span class="btn btn--primary opacity-50 cursor-not-allowed">First-admin launch locked</span>
            } @else {
              <a routerLink="/admin/launch-authority-v2" class="btn btn--primary">Next: launch first admin authority</a>
            }
          </div>
          @if (copyMessage(); as msg) {
            <p class="text-xs text-text-muted mt-2">{{ msg }}</p>
          }
        </div>
      }
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

  readonly busy = computed(() => this.pendingAction() !== null);
  readonly manifestJson = computed(() => {
    const manifest = this.deployResult()?.manifest ?? this.status()?.manifest ?? null;
    return manifest ? JSON.stringify(manifest, null, 2) : '';
  });

  async checkDeployment(): Promise<void> {
    await this.run('status', async () => {
      this.deployResult.set(null);
      this.status.set(await this.genesis.getDeployment(this.tokenInput()));
    });
  }

  async checkBootstrapStatus(): Promise<void> {
    await this.run('bootstrap-status', async () => {
      this.bootstrapStatus.set(await this.bootstrap.getBootstrapStatus());
    });
  }

  async startBootstrapSession(): Promise<void> {
    await this.run('bootstrap-session', async () => {
      const session = await this.bootstrap.startBootstrapSession(this.tokenInput());
      this.bootstrapStatus.set({
        locked: false,
        authenticated: session.unlocked,
        expires_at: session.expires_at,
      });
    });
  }

  async dryRun(): Promise<void> {
    await this.run('dry-run', async () => {
      this.status.set(null);
      this.deployResult.set(await this.genesis.dryRunProtocolDeploy(this.tokenInput(), this.request()));
    });
  }

  async deploy(): Promise<void> {
    const ok = window.confirm(
      'This will push the protocol genesis spend bundle and persist the deployment manifest. Dry-run first and continue only if the manifest is correct.',
    );
    if (!ok) return;
    await this.run('deploy', async () => {
      this.status.set(null);
      this.deployResult.set(await this.genesis.deployProtocol(this.tokenInput(), this.request()));
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
}

function optionalCoin(key: 'pgt_coin_id' | 'pool_coin_id' | 'did_coin_id' | 'gov_coin_id', value: string): Partial<GenesisDeployRequest> {
  const trimmed = value.trim();
  return trimmed ? { [key]: trimmed } : {};
}
