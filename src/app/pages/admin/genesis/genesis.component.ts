import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { environment } from '../../../../environments/environment';
import {
  AdminGenesisService,
  GenesisCeremony,
  GenesisInvitation,
  GenesisPlanInput,
  GenesisPreflight,
  GenesisSourceShas,
} from '../../../services/admin-genesis.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { formatError } from '../../../utils/format-error';

type GenesisAction =
  | 'draft'
  | 'load'
  | 'invite'
  | 'enroll'
  | 'roster'
  | 'plan'
  | 'plan-sign'
  | 'preflight'
  | 'broadcast'
  | 'confirm'
  | 'artifact'
  | 'artifact-sign'
  | 'finalize'
  | 'abandon'
  | 'wallet'
  | null;

@Component({
  selector: 'solslot-admin-genesis',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="container-p max-w-7xl py-8 md:py-12">
      <header class="border-b border-white/10 pb-5">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="max-w-3xl">
            <div class="mono text-[0.68rem] uppercase tracking-[0.18em] text-brand">
              Solslot V2 · testnet11
            </div>
            <h1 class="font-display text-3xl md:text-4xl mt-2">Genesis ceremony console</h1>
            <p class="text-sm text-text-muted mt-2">
              Eight singleton surfaces, 32 bridge parents, three administrators, and one
              deterministic broadcast.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span class="gate" [class.gate--ready]="writesEnabled">
              {{ writesEnabled ? 'ceremony writes enabled' : 'read-only launch lock' }}
            </span>
            <a routerLink="/admin" class="btn btn--ghost">Admin desk</a>
          </div>
        </div>
      </header>

      <section class="grid gap-px bg-white/10 border border-white/10 md:grid-cols-5 mt-5">
        <div class="status-cell">
          <span>State</span><strong>{{ ceremony()?.state || 'not loaded' }}</strong>
        </div>
        <div class="status-cell">
          <span>Roster</span><strong>{{ enrolledAdmins() }} / 3</strong>
        </div>
        <div class="status-cell">
          <span>Plan signatures</span><strong>{{ planSignatures() }} / 2</strong>
        </div>
        <div class="status-cell">
          <span>Artifact signatures</span><strong>{{ artifactSignatures() }} / 2</strong>
        </div>
        <div class="status-cell">
          <span>Wallet</span><strong>{{ shortWallet() }}</strong>
        </div>
      </section>

      @if (error()) {
        <section class="notice notice--error mt-4" role="alert">
          <strong>Action rejected</strong><span>{{ error() }}</span>
        </section>
      }
      @if (message()) {
        <section class="notice mt-4" role="status">
          <strong>Current result</strong><span>{{ message() }}</span>
        </section>
      }

      <section class="grid gap-6 lg:grid-cols-[0.72fr_1.28fr] mt-6">
        <div class="space-y-5">
          <section class="panel">
            <div class="section-label">Operator access</div>
            <label class="field mt-3">
              <span>SOLSLOT_ADMIN_TOKEN</span>
              <input
                type="password"
                class="input mono"
                autocomplete="off"
                [(ngModel)]="tokenInput"
              />
            </label>
            <label class="field mt-3">
              <span>Ceremony ID</span>
              <input class="input mono" [(ngModel)]="ceremonyIdInput" placeholder="0x…" />
            </label>
            <button
              class="btn btn--ghost w-full justify-center mt-3"
              [disabled]="busy()"
              (click)="loadCeremony()"
            >
              {{ pendingAction() === 'load' ? 'Loading…' : 'Load ceremony' }}
            </button>
          </section>

          <section class="panel">
            <div class="section-label">Administrator wallet</div>
            <div class="grid grid-cols-2 gap-2 mt-3">
              <button
                class="btn btn--ghost justify-center"
                [disabled]="busy()"
                (click)="connectInjected()"
              >
                Browser wallet
              </button>
              <button
                class="btn btn--ghost justify-center"
                [disabled]="busy()"
                (click)="connectWalletConnect()"
              >
                WalletConnect
              </button>
            </div>
            <label class="field mt-3">
              <span>Invitation fragment token</span>
              <input class="input mono" [(ngModel)]="invitationTokenInput" />
            </label>
            <button
              class="btn btn--primary w-full justify-center mt-3"
              [disabled]="
                busy() || !writesEnabled || !invitationTokenInput().trim() || !wallet.address()
              "
              (click)="acceptInvitation()"
            >
              {{ pendingAction() === 'enroll' ? 'Signing enrollment…' : 'Enroll this admin slot' }}
            </button>
          </section>

          <section class="panel">
            <div class="section-label">Safety gates</div>
            <div class="gate-list mt-3">
              <div>
                <span>Frozen source commits</span
                ><b>{{ ceremony()?.source_shas ? 'yes' : 'no' }}</b>
              </div>
              <div>
                <span>2-of-3 plan approval</span><b>{{ planSignatures() >= 2 ? 'yes' : 'no' }}</b>
              </div>
              <div>
                <span>Internal testnet review</span
                ><b>{{ preflight()?.ready ? 'verified' : 'pending' }}</b>
              </div>
              <div>
                <span>Deterministic spend count</span
                ><b>{{ preflight()?.spendCount || 'pending' }}</b>
              </div>
              <div>
                <span>Post-chain artifact quorum</span
                ><b>{{ artifactSignatures() >= 2 ? 'yes' : 'no' }}</b>
              </div>
            </div>
          </section>
        </div>

        <div class="space-y-5">
          <section class="panel">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="section-label">1 · Frozen release</div>
                <h2 class="font-display text-xl mt-1">Create a clean ceremony draft</h2>
              </div>
              <button
                class="btn btn--primary"
                [disabled]="busy() || !writesEnabled"
                (click)="createDraft()"
              >
                {{ pendingAction() === 'draft' ? 'Creating…' : 'Create draft' }}
              </button>
            </div>
            <textarea class="code-input mt-4" rows="8" [(ngModel)]="sourceShasJson"></textarea>
          </section>

          <section class="panel">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="section-label">2 · Admin roster</div>
                <h2 class="font-display text-xl mt-1">Three independent wallet slots</h2>
              </div>
              <button
                class="btn btn--primary"
                [disabled]="busy() || !writesEnabled || enrolledAdmins() !== 3"
                (click)="freezeRoster()"
              >
                Freeze roster
              </button>
            </div>
            <div class="grid gap-2 md:grid-cols-3 mt-4">
              @for (slot of [1, 2, 3]; track slot) {
                <div class="slot">
                  <div class="flex items-center justify-between gap-2">
                    <strong>Admin {{ slot }}</strong>
                    <span>{{ slotStatus(slot) }}</span>
                  </div>
                  <button
                    class="btn btn--ghost w-full justify-center mt-3"
                    [disabled]="busy() || !writesEnabled || slotEnrolled(slot)"
                    (click)="issueInvitation(slot)"
                  >
                    Issue invitation
                  </button>
                  @if (invitationFragments()[slot]; as fragment) {
                    <input class="input mono mt-2" readonly [value]="fragment" />
                  }
                </div>
              }
            </div>
          </section>

          <section class="panel">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="section-label">3 · Deterministic plan</div>
                <h2 class="font-display text-xl mt-1">
                  Coordinates, funding, validators, and trust anchors
                </h2>
              </div>
              <button
                class="btn btn--primary"
                [disabled]="busy() || !writesEnabled || ceremony()?.state !== 'roster_frozen'"
                (click)="createPlan()"
              >
                {{ pendingAction() === 'plan' ? 'Building…' : 'Build plan' }}
              </button>
            </div>
            <textarea class="code-input mt-4" rows="18" [(ngModel)]="planJson"></textarea>
            <div class="flex flex-wrap items-end gap-3 mt-3">
              <label class="field w-28">
                <span>Admin slot</span>
                <select class="input" [(ngModel)]="signerSlotInput">
                  <option [ngValue]="1">1</option>
                  <option [ngValue]="2">2</option>
                  <option [ngValue]="3">3</option>
                </select>
              </label>
              <button
                class="btn btn--ghost"
                [disabled]="busy() || !writesEnabled || !ceremony()?.plan_hash || !wallet.address()"
                (click)="signPlan()"
              >
                {{ pendingAction() === 'plan-sign' ? 'Signing…' : 'Sign plan hash' }}
              </button>
            </div>
          </section>

          <section class="panel">
            <div class="section-label">4 · Pre-broadcast gate</div>
            <div class="action-row mt-3">
              <button
                class="btn btn--primary"
                [disabled]="busy() || !writesEnabled || ceremony()?.state !== 'plan_approved'"
                (click)="runPreflight()"
              >
                {{ pendingAction() === 'preflight' ? 'Verifying…' : 'Run preflight' }}
              </button>
              <label class="check">
                <input type="checkbox" [(ngModel)]="broadcastArmed" />
                <span>Plan hash and testnet evidence reviewed</span>
              </label>
              <button
                class="btn btn--danger"
                [disabled]="busy() || !writesEnabled || !preflight()?.ready || !broadcastArmed()"
                (click)="broadcast()"
              >
                {{ pendingAction() === 'broadcast' ? 'Broadcasting…' : 'Broadcast once' }}
              </button>
            </div>
            @if (preflight(); as result) {
              <dl class="result-grid mt-4">
                <div>
                  <dt>Plan hash</dt>
                  <dd>{{ result.planHash }}</dd>
                </div>
                <div>
                  <dt>Bundle ID</dt>
                  <dd>{{ result.spendBundleId }}</dd>
                </div>
                <div>
                  <dt>Review class</dt>
                  <dd>{{ result.reviewClass }}</dd>
                </div>
                <div>
                  <dt>Evidence hash</dt>
                  <dd>{{ result.auditApprovalHash }}</dd>
                </div>
              </dl>
            }
          </section>

          <section class="panel">
            <div class="section-label">5 · Confirmation and signed artifact</div>
            <div class="action-row mt-3">
              <button
                class="btn btn--ghost"
                [disabled]="busy() || !writesEnabled || ceremony()?.state !== 'broadcast'"
                (click)="confirm()"
              >
                Check three confirmations
              </button>
              <button
                class="btn btn--ghost"
                [disabled]="busy() || !writesEnabled || ceremony()?.state !== 'confirmed'"
                (click)="createArtifact()"
              >
                Build artifact
              </button>
              <button
                class="btn btn--ghost"
                [disabled]="
                  busy() || !writesEnabled || !ceremony()?.artifact_hash || !wallet.address()
                "
                (click)="signArtifact()"
              >
                Sign artifact hash
              </button>
              <button
                class="btn btn--primary"
                [disabled]="busy() || !writesEnabled || ceremony()?.state !== 'artifact_signed'"
                (click)="finalize()"
              >
                Write lock last
              </button>
            </div>
          </section>

          <section class="panel border-red-500/30">
            <div class="section-label text-red-300">Abandonment</div>
            <div class="flex flex-col md:flex-row gap-3 mt-3">
              <input
                class="input flex-1"
                [(ngModel)]="abandonReasonInput"
                placeholder="Recorded reason, minimum 8 characters"
              />
              <button
                class="btn btn--danger"
                [disabled]="busy() || !writesEnabled || abandonReasonInput().trim().length < 8"
                (click)="abandon()"
              >
                Abandon ceremony
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>
  `,
  styles: `
    .panel {
      border: 1px solid rgb(255 255 255 / 0.1);
      background: rgb(255 255 255 / 0.025);
      padding: 1rem;
      border-radius: 4px;
    }
    .status-cell {
      background: rgb(5 18 21);
      padding: 0.8rem;
      min-width: 0;
    }
    .status-cell span,
    .field span,
    .section-label {
      display: block;
      font: 600 0.66rem/1.25 monospace;
      text-transform: uppercase;
      letter-spacing: 0;
      color: var(--color-text-muted);
    }
    .status-cell strong {
      display: block;
      margin-top: 0.3rem;
      overflow-wrap: anywhere;
    }
    .field .input {
      width: 100%;
      margin-top: 0.35rem;
    }
    .code-input {
      width: 100%;
      resize: vertical;
      border: 1px solid rgb(255 255 255 / 0.12);
      background: rgb(0 8 10 / 0.8);
      padding: 0.8rem;
      font: 0.72rem/1.55 monospace;
      color: inherit;
      border-radius: 3px;
    }
    .notice {
      display: grid;
      grid-template-columns: 9rem 1fr;
      gap: 1rem;
      border: 1px solid rgb(77 255 178 / 0.3);
      background: rgb(77 255 178 / 0.07);
      padding: 0.8rem;
      font-size: 0.82rem;
    }
    .notice--error {
      border-color: rgb(248 113 113 / 0.45);
      background: rgb(248 113 113 / 0.08);
    }
    .gate {
      border: 1px solid rgb(248 113 113 / 0.45);
      padding: 0.45rem 0.6rem;
      font: 600 0.65rem/1 monospace;
      text-transform: uppercase;
    }
    .gate--ready {
      border-color: rgb(77 255 178 / 0.45);
      color: rgb(134 239 172);
    }
    .slot {
      border: 1px solid rgb(255 255 255 / 0.1);
      padding: 0.75rem;
      min-width: 0;
    }
    .slot span {
      font: 0.65rem monospace;
      color: var(--color-text-muted);
    }
    .gate-list {
      display: grid;
      gap: 0.65rem;
      font-size: 0.78rem;
    }
    .gate-list div {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      border-bottom: 1px solid rgb(255 255 255 / 0.08);
      padding-bottom: 0.55rem;
    }
    .action-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.65rem;
    }
    .check {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.75rem;
      color: var(--color-text-muted);
    }
    .result-grid {
      display: grid;
      gap: 0.5rem;
    }
    .result-grid div {
      display: grid;
      grid-template-columns: 8rem minmax(0, 1fr);
      gap: 0.75rem;
      font-size: 0.72rem;
    }
    .result-grid dt {
      color: var(--color-text-muted);
    }
    .result-grid dd {
      font-family: monospace;
      overflow-wrap: anywhere;
    }
    @media (max-width: 640px) {
      .notice,
      .result-grid div {
        grid-template-columns: 1fr;
        gap: 0.25rem;
      }
    }
  `,
})
export class GenesisComponent implements OnInit {
  private readonly genesis = inject(AdminGenesisService);
  readonly wallet = inject(EvmWalletService);

  readonly writesEnabled = environment.protocolWritesEnabled;
  readonly tokenInput = signal('');
  readonly ceremonyIdInput = signal('');
  readonly invitationTokenInput = signal('');
  readonly signerSlotInput = signal(1);
  readonly abandonReasonInput = signal('');
  readonly sourceShasJson = signal(defaultSourceShasJson());
  readonly planJson = signal(defaultPlanJson());
  readonly ceremony = signal<GenesisCeremony | null>(null);
  readonly invitationFragments = signal<Record<number, string>>({});
  readonly preflight = signal<GenesisPreflight | null>(null);
  readonly broadcastArmed = signal(false);
  readonly pendingAction = signal<GenesisAction>(null);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  readonly busy = computed(() => this.pendingAction() !== null);
  readonly enrolledAdmins = computed(
    () => this.ceremony()?.invitations?.filter((slot) => !!slot.compressed_pubkey).length || 0,
  );
  readonly planSignatures = computed(() => this.ceremony()?.plan_signatures?.length || 0);
  readonly artifactSignatures = computed(() => this.ceremony()?.artifact_signatures?.length || 0);
  readonly shortWallet = computed(() => {
    const address = this.wallet.address();
    return address ? `${address.slice(0, 8)}…${address.slice(-6)}` : 'not connected';
  });

  ngOnInit(): void {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const invitation = params.get('genesis-admin');
    if (invitation) this.invitationTokenInput.set(invitation);
  }

  async connectInjected(): Promise<void> {
    await this.perform(
      'wallet',
      () => this.wallet.connectInjected(),
      () => {
        this.message.set('Browser wallet connected for ceremony signatures.');
      },
    );
  }

  async connectWalletConnect(): Promise<void> {
    await this.perform(
      'wallet',
      () => this.wallet.connectWalletConnect({ resetSession: true }),
      () => {
        this.message.set('WalletConnect session established for ceremony signatures.');
      },
    );
  }

  async createDraft(): Promise<void> {
    await this.perform(
      'draft',
      () =>
        this.genesis.createDraft(
          this.tokenInput(),
          parseJson<GenesisSourceShas>(this.sourceShasJson()),
        ),
      (result) => {
        this.setCeremony(result);
        this.message.set('Fresh ceremony draft created from five frozen commits.');
      },
    );
  }

  async loadCeremony(): Promise<void> {
    await this.perform(
      'load',
      () => this.genesis.getCeremony(this.tokenInput(), this.requiredCeremonyId()),
      (result) => {
        this.setCeremony(result);
        this.message.set(`Ceremony state recovered: ${result.state}.`);
      },
    );
  }

  async issueInvitation(slot: number): Promise<void> {
    await this.perform(
      'invite',
      () => this.genesis.issueInvitation(this.tokenInput(), this.requiredCeremonyId(), slot),
      (result: GenesisInvitation) => {
        this.invitationFragments.update((current) => ({
          ...current,
          [slot]: result.invitationFragment,
        }));
        this.message.set(`Administrator ${slot} invitation issued; it expires in 48 hours.`);
      },
    );
  }

  async acceptInvitation(): Promise<void> {
    const address = this.wallet.address();
    if (!address) {
      this.error.set('Connect the administrator wallet before accepting an invitation.');
      return;
    }
    const invitationToken = this.invitationTokenInput().trim();
    await this.perform(
      'enroll',
      async () => {
        const prepared = await this.genesis.prepareInvitation(invitationToken, address);
        const signature = await this.wallet.signTypedData(prepared.typedData);
        const accepted = await this.genesis.acceptInvitation(invitationToken, address, signature);
        this.ceremonyIdInput.set(accepted.ceremonyId);
        return accepted;
      },
      (result) => this.message.set(`Administrator slot ${result.slot} enrolled.`),
    );
  }

  async freezeRoster(): Promise<void> {
    await this.operatorMutation('roster', () =>
      this.genesis.freezeRoster(this.tokenInput(), this.requiredCeremonyId()),
    );
  }

  async createPlan(): Promise<void> {
    await this.perform(
      'plan',
      () =>
        this.genesis.createPlan(
          this.tokenInput(),
          this.requiredCeremonyId(),
          parseJson<GenesisPlanInput>(this.planJson()),
        ),
      (result) => {
        this.setCeremony(result.ceremony);
        this.message.set(
          'Deterministic plan created. Two enrolled administrators must sign its hash.',
        );
      },
    );
  }

  async signPlan(): Promise<void> {
    await this.perform(
      'plan-sign',
      async () => {
        const ceremonyId = this.requiredCeremonyId();
        const prepared = await this.genesis.preparePlanSignature(
          ceremonyId,
          this.signerSlotInput(),
        );
        const signature = await this.wallet.signTypedData(prepared.typedData);
        return this.genesis.signPlan(ceremonyId, prepared.slot, signature);
      },
      (result) => {
        this.setCeremony(result);
        this.message.set(`Plan signature ${this.planSignatures()} of 2 recorded.`);
      },
    );
  }

  async runPreflight(): Promise<void> {
    await this.perform(
      'preflight',
      () => this.genesis.preflight(this.tokenInput(), this.requiredCeremonyId()),
      (result) => {
        this.preflight.set(result);
        this.broadcastArmed.set(false);
        this.message.set(
          'Pre-broadcast gate passed against live funding, Sepolia, and validator evidence.',
        );
      },
    );
  }

  async broadcast(): Promise<void> {
    if (!this.preflight()?.ready || !this.broadcastArmed()) {
      this.error.set('Run and review preflight before broadcast.');
      return;
    }
    if (!window.confirm('Broadcast this deterministic ceremony exactly once?')) return;
    await this.operatorMutation('broadcast', () =>
      this.genesis.broadcast(this.tokenInput(), this.requiredCeremonyId()),
    );
  }

  async confirm(): Promise<void> {
    await this.operatorMutation('confirm', () =>
      this.genesis.confirm(this.tokenInput(), this.requiredCeremonyId()),
    );
  }

  async createArtifact(): Promise<void> {
    await this.perform(
      'artifact',
      () => this.genesis.createArtifact(this.tokenInput(), this.requiredCeremonyId()),
      (result) => {
        this.setCeremony(result.ceremony);
        this.message.set('Canonical artifact built. Two administrators must sign its hash.');
      },
    );
  }

  async signArtifact(): Promise<void> {
    await this.perform(
      'artifact-sign',
      async () => {
        const ceremonyId = this.requiredCeremonyId();
        const prepared = await this.genesis.prepareArtifactSignature(
          ceremonyId,
          this.signerSlotInput(),
        );
        const signature = await this.wallet.signTypedData(prepared.typedData);
        return this.genesis.signArtifact(ceremonyId, prepared.slot, signature);
      },
      (result) => {
        this.setCeremony(result);
        this.message.set(`Artifact signature ${this.artifactSignatures()} of 2 recorded.`);
      },
    );
  }

  async finalize(): Promise<void> {
    await this.perform(
      'finalize',
      () => this.genesis.finalize(this.tokenInput(), this.requiredCeremonyId()),
      (result) => {
        this.setCeremony(result.ceremony);
        this.message.set(`Ceremony locked. Artifact ${result.artifactHash}.`);
      },
    );
  }

  async abandon(): Promise<void> {
    if (!window.confirm('Permanently abandon this ceremony and all of its coordinates?')) return;
    await this.operatorMutation('abandon', () =>
      this.genesis.abandon(
        this.tokenInput(),
        this.requiredCeremonyId(),
        this.abandonReasonInput().trim(),
      ),
    );
  }

  slotEnrolled(slot: number): boolean {
    return !!this.ceremony()?.invitations?.find((entry) => entry.slot === slot)?.compressed_pubkey;
  }

  slotStatus(slot: number): string {
    return this.slotEnrolled(slot)
      ? 'enrolled'
      : this.invitationFragments()[slot]
        ? 'invited'
        : 'open';
  }

  private async operatorMutation(
    action: GenesisAction,
    operation: () => Promise<GenesisCeremony>,
  ): Promise<void> {
    await this.perform(action, operation, (result) => {
      this.setCeremony(result);
      this.message.set(`Ceremony advanced to ${result.state}.`);
    });
  }

  private async perform<T>(
    action: GenesisAction,
    operation: () => Promise<T>,
    success: (result: T) => void,
  ): Promise<void> {
    if (this.busy()) return;
    this.pendingAction.set(action);
    this.error.set(null);
    try {
      success(await operation());
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.pendingAction.set(null);
    }
  }

  private setCeremony(result: GenesisCeremony): void {
    this.ceremony.set(result);
    this.ceremonyIdInput.set(result.ceremony_id);
  }

  private requiredCeremonyId(): string {
    const value = this.ceremony()?.ceremony_id || this.ceremonyIdInput().trim();
    if (!value) throw new Error('A ceremony ID is required.');
    return value;
  }
}

function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Invalid ceremony JSON: ${formatError(error)}`);
  }
}

function defaultSourceShasJson(): string {
  return JSON.stringify(
    {
      protocol: '',
      evm: '',
      omnichain: '',
      api: '',
      legacyBackend: '',
      keyOfSolomon: '',
      samuel: '',
      customerWeb: '',
      adminPortal: '',
    },
    null,
    2,
  );
}

function defaultPlanJson(): string {
  return JSON.stringify(
    {
      evmAddresses: { forwarder: '', verifierAdapter: '', attestationEmitter: '' },
      fundingCoinIds: {
        sgt: '',
        pool: '',
        did: '',
        governance: '',
        navRegistry: '',
        protocolConfig: '',
        adminAuthority: '',
        vaultVersionRegistry: '',
        bridgeBatch: '',
      },
      faucetPuzzleHash: '',
      governanceBlsPubkey: '',
      validatorPubkeys: ['', '', ''],
      trustedTreasuryReservePuzzleHash: '',
      trustedProtocolTreasuryPuzzleHash: '',
      trustedGovernanceRewardsPuzzleHash: '',
      trustedGovernanceRewardsRoot: '',
      retiredCoordinates: [''],
      protocolParameters: {
        quorumBps: 5000,
        votingWindowSeconds: 300,
        sgtTotalSupply: 1000000,
        minProposalStake: 10000,
        fpScale: 1000,
        minNavRegistryVersion: 1,
        initialPoolStatus: 1,
        initialTotalPoolTokenSupply: 0,
        initialTreasuryReserveTokens: 0,
      },
    },
    null,
    2,
  );
}
