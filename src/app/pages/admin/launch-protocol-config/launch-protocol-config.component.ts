import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  AdminProtocolConfigService,
  ProtocolConfigFinalizeResponse,
} from '../../../services/admin-protocol-config.service';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import { ChiaWasmService } from '../../../services/chia-wasm.service';
import { ProtocolInfo } from '../../../services/solslot-api.service';
import {
  ProtocolConfigLaunchInputs,
  ProtocolConfigLaunchPreview,
  ProtocolConfigLaunchResult,
  ProtocolConfigLaunchService,
  ProtocolConfigNetwork,
} from '../../../services/protocol-config/protocol-config-launch.service';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'app-launch-protocol-config',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <main class="min-h-screen bg-bg text-text px-6 py-10">
      <section class="max-w-6xl mx-auto space-y-8">
        <header class="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <a routerLink="/admin/trust-roots" class="text-sm text-brand hover:underline">
              ← Trust roots
            </a>
            <p class="mono text-xs uppercase tracking-[0.24em] text-brand mt-5">A.3 launch wizard</p>
            <h1 class="font-display text-4xl mt-2">Launch protocol config</h1>
            <p class="text-text-muted max-w-3xl mt-3 leading-relaxed">
              Use this wizard to launch the A.3 protocol-config singleton from the approved
              pool, governance, network, and version.  After broadcast, copy the launcher id
              into the API environment so vault creation can be enabled.
            </p>
          </div>
          <a routerLink="/admin" class="btn btn--ghost self-start">Admin desk</a>
        </header>

        <section class="card border-yellow-500/30 bg-yellow-500/5">
          <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 class="font-display text-2xl text-yellow-100">Before you launch</h2>
              <p class="text-sm text-text-muted mt-2 leading-relaxed max-w-3xl">
                Confirm the firm has approved these exact protocol coordinates.  This wizard asks
                your connected Chia wallet to fund a one-mojo singleton launch and broadcasts the
                combined spend through coinset.org.  It never asks for seed phrases or private keys.
              </p>
            </div>
            @if (protocol()?.protocol_config_launcher_id) {
              <span class="chip chip--active">A.3 already configured</span>
            } @else {
              <span class="chip">A.3 not configured</span>
            }
          </div>
          @if (protocol()?.protocol_config_launcher_id) {
            <p class="text-xs text-text-muted mt-4 leading-relaxed">
              The current protocol response already reports
              <span class="mono">{{ protocol()?.protocol_config_launcher_id }}</span>.
              Only launch another A.3 singleton if this is a deliberate migration and the API
              environment will be updated to the new launcher id.
            </p>
          }
        </section>

        <div class="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section class="card space-y-6">
            <div>
              <h2 class="font-display text-2xl">1. Protocol inputs</h2>
              <p class="text-sm text-text-muted mt-2 leading-relaxed">
                The pool and governance values are prefilled from <span class="mono">/protocol</span>
                when available.  Review them against the approved deployment record before signing.
              </p>
              <div class="mt-4 flex flex-wrap gap-3">
                <button type="button" class="btn btn--ghost text-xs" (click)="refreshProtocol()" [disabled]="loadingProtocol()">
                  {{ loadingProtocol() ? 'Refreshing…' : 'Refresh /protocol' }}
                </button>
                @if (protocolLoadError()) {
                  <span class="text-xs text-red-300 self-center">{{ protocolLoadError() }}</span>
                }
              </div>
            </div>

            <label class="block">
              <span class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Pool launcher id</span>
              <input class="input mt-2 mono" [(ngModel)]="poolLauncherIdInput" placeholder="0x…" />
            </label>

            <label class="block">
              <span class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Governance launcher id</span>
              <input class="input mt-2 mono" [(ngModel)]="governanceLauncherIdInput" placeholder="0x…" />
            </label>

            <div class="grid gap-4 md:grid-cols-2">
              <label class="block">
                <span class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Network</span>
                <select class="input mt-2" [(ngModel)]="networkInput">
                  <option value="testnet11">testnet11</option>
                  <option value="mainnet">mainnet</option>
                </select>
              </label>
              <label class="block">
                <span class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Config version</span>
                <input class="input mt-2" type="number" min="1" step="1" [(ngModel)]="configVersionInput" />
              </label>
            </div>

            <label class="block">
              <span class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Governance BLS public key</span>
              <input class="input mt-2 mono" [(ngModel)]="governancePubkeyInput" placeholder="0x… 48-byte BLS G1 pubkey" />
              <p class="text-xs text-text-muted mt-2 leading-relaxed">
                This key controls future A.3 updates.  For a test launch, you may use the connected
                Chia wallet public key after confirming it is the intended governance key.
              </p>
              @if (walletConnected()) {
                <button type="button" class="btn btn--ghost text-xs mt-3" (click)="useConnectedGovernanceKey()">
                  Use connected Chia wallet pubkey
                </button>
              }
            </label>
          </section>

          <aside class="space-y-6">
            <section class="card">
              <h2 class="font-display text-2xl">2. Wallet</h2>
              @if (walletConnected()) {
                <p class="text-sm text-green-200 mt-2">
                  Chia wallet connected via {{ walletConnectionKind() || 'wallet' }}.
                </p>
                <p class="mono text-xs break-all mt-3 text-text-muted">{{ walletPubkey() }}</p>
              } @else {
                <p class="text-sm text-text-muted mt-2 leading-relaxed">
                  Connect the Chia wallet that will fund the one-mojo singleton launcher.
                </p>
                <div class="mt-4 flex flex-wrap gap-3">
                  @if (hasGoby()) {
                    <button type="button" class="btn btn--ghost text-xs" (click)="connectChia('goby')" [disabled]="!!connectingChia()">
                      Connect Goby
                    </button>
                  }
                  @if (hasSage()) {
                    <button type="button" class="btn btn--ghost text-xs" (click)="connectChia('sage')" [disabled]="!!connectingChia()">
                      Connect Sage
                    </button>
                  }
                  <button type="button" class="btn btn--ghost text-xs" (click)="connectChia('sage-walletconnect')" [disabled]="!!connectingChia()">
                    Sage WalletConnect
                  </button>
                </div>
              }
              @if (restoringSageWalletConnect()) {
                <p class="text-xs text-text-muted mt-3">Checking existing Sage session...</p>
              } @else if (connectingChia()) {
                <p class="text-xs text-text-muted mt-3">Connecting {{ connectingChia() }}…</p>
              }
              @if (sageWalletConnectUri(); as uri) {
                <div class="mt-4 rounded-card border border-brand/30 bg-brand/10 p-3">
                  <div class="font-display text-lg">Sage WalletConnect is waiting.</div>
                  <p class="text-xs text-text-muted mt-2 leading-relaxed">
                    Open Sage, choose WalletConnect, then paste this pairing URI if Sage does
                    not open automatically.
                  </p>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button type="button" class="btn btn--primary text-xs" (click)="copySagePairUri(uri)">
                      Copy pairing URI
                    </button>
                    <button type="button" class="btn btn--ghost text-xs" (click)="cancelSagePairing()">
                      Cancel
                    </button>
                  </div>
                  <pre class="mono mt-3 max-h-32 overflow-auto rounded-card border border-white/10 bg-black/30 p-3 text-[0.65rem] text-text-muted">{{ uri }}</pre>
                </div>
              }
              @if (chiaConnectError()) {
                <p class="text-xs text-red-300 mt-3">{{ chiaConnectError() }}</p>
              }
              @if (copyConfirmation()) {
                <p class="text-xs text-green-200 mt-3">{{ copyConfirmation() }}</p>
              }
              @if (!chiaWasmReady()) {
                <p class="text-xs text-yellow-200 mt-3">Chia WASM is still loading.  Reload if this does not clear.</p>
              }
            </section>

            <section class="card">
              <h2 class="font-display text-2xl">3. Preview</h2>
              @if (preview(); as p) {
                <dl class="mt-4 space-y-3 text-sm">
                  <div>
                    <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Content hash</dt>
                    <dd class="mono text-xs break-all mt-1">{{ p.contentHash }}</dd>
                  </div>
                  <div>
                    <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">A.3 inner puzzle hash</dt>
                    <dd class="mono text-xs break-all mt-1">{{ p.eveInnerPuzzleHash }}</dd>
                  </div>
                  <div>
                    <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Network id</dt>
                    <dd class="mono text-xs break-all mt-1">{{ p.inputs.networkId }}</dd>
                  </div>
                </dl>
              } @else {
                <p class="text-sm text-text-muted mt-3 leading-relaxed">
                  {{ previewError() || 'Complete the inputs to compute the launch preview.' }}
                </p>
              }
            </section>
          </aside>
        </div>

        <section class="card space-y-5">
          <div>
            <h2 class="font-display text-2xl">4. Launch on chain</h2>
            <p class="text-sm text-text-muted mt-2 leading-relaxed max-w-3xl">
              When you click launch, your wallet signs only the funding coin spend.  The wizard
              combines that signed spend with the permissionless singleton launcher spend and pushes
              the full spend bundle to coinset.org.
            </p>
          </div>

          <label class="flex gap-3 items-start text-sm text-text-muted leading-relaxed">
            <input type="checkbox" class="mt-1" [ngModel]="operatorConfirmed()" (ngModelChange)="operatorConfirmed.set($event)" />
            <span>
              I confirm these A.3 inputs match the approved protocol deployment record, and I
              understand that after broadcast I must set
              <span class="mono">SOLSLOT_PROTOCOL_CONFIG_LAUNCHER_ID</span> and restart the API
              before vault creation is enabled.
            </span>
          </label>

          <div class="flex flex-wrap items-center gap-3">
            <button type="button" class="btn btn--primary" (click)="submitLaunch()" [disabled]="!canSubmit()">
              {{ submitButtonLabel() }}
            </button>
            @if (!walletConnected()) {
              <span class="text-xs text-text-muted">Connect a Chia wallet first.</span>
            } @else if (!operatorConfirmed()) {
              <span class="text-xs text-text-muted">Confirm the launch checklist first.</span>
            } @else if (previewError()) {
              <span class="text-xs text-text-muted">Fix preview inputs first.</span>
            }
          </div>

          @if (submitError()) {
            <p class="text-sm text-red-300">{{ submitError() }}</p>
          }

          @if (submittedResult(); as result) {
            <div class="rounded-card border border-green-500/30 bg-green-500/5 p-4">
              <h3 class="font-display text-xl text-green-100">A.3 launch submitted</h3>
              <p class="text-sm text-text-muted mt-2 leading-relaxed">
                Coinset accepted the spend bundle with status
                <span class="mono">{{ result.pushResponse.status || 'submitted' }}</span>.
                Wait for chain confirmation, then update and restart the API.
              </p>
              <dl class="mt-4 space-y-3 text-sm">
                <div>
                  <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">A.3 launcher id</dt>
                  <dd class="mono text-xs break-all mt-1">{{ result.launcherId }}</dd>
                </div>
                <div>
                  <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">API env line</dt>
                  <dd class="mono text-xs break-all mt-1">{{ envLine() }}</dd>
                </div>
              </dl>
              <div class="mt-4 flex flex-wrap gap-3">
                <button type="button" class="btn btn--ghost text-xs" (click)="copyEnvLine()">
                  Copy env line
                </button>
                <a routerLink="/admin/trust-roots" class="btn btn--ghost text-xs">Open Trust Roots</a>
              </div>
              @if (copyConfirmation()) {
                <p class="text-xs text-green-200 mt-3">{{ copyConfirmation() }}</p>
              }
            </div>

            <div class="rounded-card border border-brand/30 bg-brand/5 p-4">
              <h3 class="font-display text-xl text-brand">Finalize API configuration</h3>
              <p class="text-sm text-text-muted mt-2 leading-relaxed">
                Paste the one-shot API admin token to set
                <span class="mono">SOLSLOT_PROTOCOL_CONFIG_LAUNCHER_ID</span> in the API
                environment and verify the live <span class="mono">/protocol</span> response.
              </p>
              <label class="block mt-4">
                <span class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">One-shot API admin token</span>
                <input
                  class="input mt-2"
                  type="password"
                  autocomplete="off"
                  [ngModel]="finalizeAdminTokenInput()"
                  (ngModelChange)="finalizeAdminTokenInput.set($event)"
                  placeholder="SOLSLOT_ADMIN_TOKEN"
                />
              </label>
              <div class="mt-4 flex flex-wrap gap-3">
                <button type="button" class="btn btn--primary text-xs" (click)="finalizeApiConfig()" [disabled]="!canFinalizeApiConfig()">
                  {{ finalizeButtonLabel() }}
                </button>
                @if (finalizeState().kind === 'idle' && !finalizeAdminTokenInput().trim()) {
                  <span class="text-xs text-text-muted self-center">Token is required for this API mutation.</span>
                }
              </div>
              @if (finalizeError()) {
                <p class="text-sm text-red-300 mt-3">{{ finalizeError() }}</p>
              }
              @if (finalizedConfig(); as finalized) {
                <dl class="mt-4 space-y-3 text-sm">
                  <div>
                    <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Verified launcher id</dt>
                    <dd class="mono text-xs break-all mt-1">{{ finalized.protocol_config_launcher_id }}</dd>
                  </div>
                  <div>
                    <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Protocol config hash</dt>
                    <dd class="mono text-xs break-all mt-1">{{ finalized.protocol_config_hash || 'not available' }}</dd>
                  </div>
                  <div>
                    <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">Env file</dt>
                    <dd class="mono text-xs break-all mt-1">{{ finalized.env_file_path }}</dd>
                  </div>
                </dl>
                <p class="text-xs text-green-200 mt-3">
                  API finalize complete. Refresh Trust Roots or retry vault creation.
                </p>
              }
            </div>
          }
        </section>
      </section>
    </main>
  `,
})
export class LaunchProtocolConfigComponent {
  private readonly http = inject(HttpClient);
  private readonly wallet = inject(ChiaWalletService);
  private readonly wasm = inject(ChiaWasmService);
  private readonly launch = inject(ProtocolConfigLaunchService);
  private readonly adminProtocolConfig = inject(AdminProtocolConfigService);

  readonly protocol = signal<ProtocolInfo | null>(null);
  readonly loadingProtocol = signal(false);
  readonly protocolLoadError = signal<string | null>(null);
  readonly poolLauncherIdInput = signal('');
  readonly governanceLauncherIdInput = signal('');
  readonly networkInput = signal<ProtocolConfigNetwork>(environment.chiaNetwork);
  readonly configVersionInput = signal(1);
  readonly governancePubkeyInput = signal('');
  readonly operatorConfirmed = signal(false);
  readonly connectingChia = signal<'goby' | 'sage' | 'sage-walletconnect' | null>(null);
  readonly chiaConnectError = signal<string | null>(null);
  readonly submitState = signal<SubmitState>({ kind: 'idle' });
  readonly finalizeAdminTokenInput = signal('');
  readonly finalizeState = signal<FinalizeState>({ kind: 'idle' });
  readonly copyConfirmation = signal<string | null>(null);

  readonly walletConnected = computed(() => this.wallet.isConnected());
  readonly walletPubkey = computed(() => this.wallet.pubkey());
  readonly walletConnectionKind = computed(() => this.wallet.connectionKind());
  readonly sageWalletConnectUri = this.wallet.sageWalletConnectUri;
  readonly restoringSageWalletConnect = this.wallet.restoringSageWalletConnect;
  readonly chiaWasmReady = computed(() => this.wasm.ready());

  readonly previewResult = computed<
    | { preview: ProtocolConfigLaunchPreview; error: null }
    | { preview: null; error: string | null }
  >(() => {
    const inputs = this.launchInputs();
    if (!inputs) return { preview: null, error: null };
    if (!this.chiaWasmReady()) return { preview: null, error: 'Chia WASM is not ready yet.' };
    try {
      return { preview: this.launch.preview(inputs), error: null };
    } catch (e) {
      return { preview: null, error: formatError(e) };
    }
  });
  readonly preview = computed(() => this.previewResult().preview);
  readonly previewError = computed(() => {
    const result = this.previewResult();
    if (result.error) return result.error;
    if (!this.launchInputs()) return 'Fill pool launcher id, governance launcher id, governance pubkey, network, and version.';
    return null;
  });
  readonly submittedResult = computed(() => {
    const s = this.submitState();
    return s.kind === 'submitted' ? s.result : null;
  });
  readonly submitError = computed(() => {
    const s = this.submitState();
    return s.kind === 'error' ? s.message : null;
  });
  readonly finalizedConfig = computed(() => {
    const s = this.finalizeState();
    return s.kind === 'finalized' ? s.result : null;
  });
  readonly finalizeError = computed(() => {
    const s = this.finalizeState();
    return s.kind === 'error' ? s.message : null;
  });
  readonly canSubmit = computed(() =>
    this.walletConnected()
    && !!this.preview()
    && this.operatorConfirmed()
    && this.submitState().kind !== 'submitting'
    && this.submitState().kind !== 'submitted',
  );
  readonly envLine = computed(() => {
    const result = this.submittedResult();
    return result ? `SOLSLOT_PROTOCOL_CONFIG_LAUNCHER_ID=${result.launcherId}` : '';
  });
  readonly submitButtonLabel = computed(() => {
    const s = this.submitState();
    if (s.kind === 'submitting') return 'Signing and broadcasting…';
    if (s.kind === 'submitted') return 'Launch submitted';
    return 'Launch A.3 on chain';
  });
  readonly canFinalizeApiConfig = computed(() =>
    !!this.submittedResult()
    && !!this.finalizeAdminTokenInput().trim()
    && this.finalizeState().kind !== 'finalizing',
  );
  readonly finalizeButtonLabel = computed(() => {
    const s = this.finalizeState();
    if (s.kind === 'finalizing') return 'Finalizing API…';
    if (s.kind === 'finalized') return 'Finalize again';
    return 'Finalize API A.3 config';
  });

  constructor() {
    void this.refreshProtocol();
    effect((onCleanup) => {
      const message = this.copyConfirmation();
      if (!message) return;
      const timeout = setTimeout(() => this.copyConfirmation.set(null), 3000);
      onCleanup(() => clearTimeout(timeout));
    });
  }

  async refreshProtocol(): Promise<void> {
    if (this.loadingProtocol()) return;
    this.protocolLoadError.set(null);
    this.loadingProtocol.set(true);
    try {
      const protocol = await firstValueFrom(
        this.http.get<ProtocolInfo>(`${environment.faucetApi}/protocol`),
      );
      this.protocol.set(protocol);
      this.poolLauncherIdInput.set(protocol.pool_launcher_id || '');
      this.governanceLauncherIdInput.set(protocol.governance_launcher_id || '');
      this.networkInput.set(protocol.network);
      this.configVersionInput.set(protocol.protocol_config_version || 1);
    } catch (e) {
      this.protocolLoadError.set(formatError(e));
    } finally {
      this.loadingProtocol.set(false);
    }
  }

  hasGoby(): boolean {
    return this.wallet.hasGoby();
  }

  hasSage(): boolean {
    return this.wallet.hasSage();
  }

  async connectChia(kind: 'goby' | 'sage' | 'sage-walletconnect'): Promise<void> {
    if (this.connectingChia()) return;
    this.chiaConnectError.set(null);
    this.connectingChia.set(kind);
    try {
      if (kind === 'goby') await this.wallet.connectGoby();
      else if (kind === 'sage') await this.wallet.connectSage();
      else await this.wallet.connectSageWalletConnect();
    } catch (e) {
      this.chiaConnectError.set(formatError(e));
    } finally {
      this.connectingChia.set(null);
    }
  }

  useConnectedGovernanceKey(): void {
    const pubkey = this.walletPubkey();
    if (pubkey) this.governancePubkeyInput.set(pubkey);
  }

  async copySagePairUri(uri: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(uri);
      this.copyConfirmation.set('Sage pairing URI copied.');
    } catch {
      this.chiaConnectError.set('Could not copy pairing URI. Select and copy it manually.');
    }
  }

  cancelSagePairing(): void {
    this.wallet.disconnect();
    this.connectingChia.set(null);
    this.chiaConnectError.set(null);
  }

  async submitLaunch(): Promise<void> {
    if (!this.canSubmit()) return;
    const inputs = this.launchInputs();
    if (!inputs) return;
    this.submitState.set({ kind: 'submitting' });
    try {
      const result = await this.launch.submit(inputs);
      this.submitState.set({ kind: 'submitted', result });
    } catch (e) {
      this.submitState.set({ kind: 'error', message: formatError(e) });
    }
  }

  async copyEnvLine(): Promise<void> {
    const line = this.envLine();
    if (!line) return;
    try {
      await navigator.clipboard.writeText(line);
      this.copyConfirmation.set('Copied to clipboard.');
    } catch {
      this.copyConfirmation.set('Copy failed — select and copy the env line manually.');
    }
  }

  async finalizeApiConfig(): Promise<void> {
    if (!this.canFinalizeApiConfig()) return;
    const result = this.submittedResult();
    if (!result) return;
    this.finalizeState.set({ kind: 'finalizing' });
    try {
      const finalized = await this.adminProtocolConfig.finalizeProtocolConfig(
        this.finalizeAdminTokenInput(),
        result.launcherId,
      );
      this.finalizeState.set({ kind: 'finalized', result: finalized });
      await this.refreshProtocol();
    } catch (e) {
      this.finalizeState.set({ kind: 'error', message: formatError(e) });
    }
  }

  private launchInputs(): ProtocolConfigLaunchInputs | null {
    const poolLauncherId = this.poolLauncherIdInput().trim();
    const governanceLauncherId = this.governanceLauncherIdInput().trim();
    const governancePubkey = this.governancePubkeyInput().trim();
    if (!poolLauncherId || !governanceLauncherId || !governancePubkey) return null;
    return {
      poolLauncherId,
      governanceLauncherId,
      network: this.networkInput(),
      configVersion: this.configVersionInput(),
      governancePubkey,
    };
  }
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'submitted'; result: ProtocolConfigLaunchResult }
  | { kind: 'error'; message: string };

type FinalizeState =
  | { kind: 'idle' }
  | { kind: 'finalizing' }
  | { kind: 'finalized'; result: ProtocolConfigFinalizeResponse }
  | { kind: 'error'; message: string };
