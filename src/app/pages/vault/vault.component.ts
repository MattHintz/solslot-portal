import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { sha256 } from 'ethers';
import { SessionService } from '../../services/session.service';
import { ZkPassportAttestationService } from '../../services/zkpassport-attestation.service';
import { ZkPassportProofStoreService } from '../../services/zkpassport-proof-store.service';
import { bytesToHex, coinId, hexToBytes } from '../../utils/chia-hash';

/** Polling cadence while the vault is still unconfirmed.  Testnet11 blocks
 *  are ~18s, so 5s keeps UI snappy without hammering coinset.org. */
const PENDING_POLL_MS = 5_000;

/** Fallback cadence once confirmed — much slower; we mostly watch for new
 *  deeds / balance changes.  30s is plenty. */
const CONFIRMED_POLL_MS = 30_000;

type EnrollmentStatus = 'idle' | 'preview_ready' | 'submit_pending';

interface ZkPassportEnrollmentPreview {
  spendCase: '0x7a';
  vaultLauncherId: string;
  vaultCoinId: string;
  vaultSubscope: string;
  attestationLeafHash: string;
  newIdentityAttestRoot: string;
  attestationProof: { bitpath: number; siblings: string[] };
  bridgePolicyHash: string;
  bridgeParentId: string;
  bridgeAmount: number;
  bridgeCoinId: string;
  bridgeMessage: string;
  bridgeAnnouncementPayload: string;
  assertedCoinAnnouncement: string;
}

@Component({
  selector: 'pp-vault',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="container-p pt-16 pb-24 max-w-4xl">
      <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4">Your Vault</div>
      <h1 class="font-display text-4xl md:text-5xl">Vault dashboard</h1>

      @if (!session.session()) {
        <div class="card mt-10">
          <p class="text-text-muted">No active session. Connect a wallet to open or create your vault.</p>
          <a routerLink="/connect" class="btn btn--primary mt-4 inline-block">Connect Wallet</a>
        </div>
      } @else {
        <div class="grid gap-4 md:grid-cols-2 mt-10">
          <div class="card">
            <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Owner</div>
            <div class="mono text-sm mt-1 break-all">{{ session.session()!.address }}</div>
          </div>
          <div class="card">
            <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Launcher id</div>
            <div class="mono text-sm mt-1 break-all">{{ session.session()!.vaultLauncherId }}</div>
          </div>
        </div>

        <div class="mt-6 flex items-center gap-3">
          <button
            class="btn"
            (click)="manualRefresh()"
            [disabled]="refreshing()"
            type="button"
          >
            @if (refreshing()) { Refreshing… } @else { Refresh now }
          </button>
          @if (pending()) {
            <span class="mono text-xs text-text-muted inline-flex items-center gap-2">
              <span class="pp-dot"></span>
              Auto-polling every {{ pollCadenceSeconds() }}s
            </span>
          } @else if (session.vault()) {
            <span class="mono text-xs text-brand uppercase tracking-[0.15em]">Live</span>
          }
        </div>

        @if (session.vault(); as v) {
          <div class="card mt-8 space-y-3" [class.pp-pending]="!v.confirmed">
            <div class="flex items-baseline justify-between">
              <span class="uppercase text-xs tracking-[0.2em] text-text-muted">Confirmation</span>
              @if (v.confirmed) {
                <span class="mono text-sm text-brand">
                  confirmed at block {{ v.confirmed_block_index }}
                </span>
              } @else {
                <span class="mono text-sm inline-flex items-center gap-2 text-amber-300">
                  <span class="pp-spinner" aria-hidden="true"></span>
                  pending &mdash; waiting for testnet11 block
                </span>
              }
            </div>
            <div class="flex items-baseline justify-between">
              <span class="uppercase text-xs tracking-[0.2em] text-text-muted">Full puzzle hash</span>
              <span class="mono text-xs break-all">{{ v.vault_full_puzhash }}</span>
            </div>
            <div class="flex items-baseline justify-between">
              <span class="uppercase text-xs tracking-[0.2em] text-text-muted">p2_vault (deed holder)</span>
              <span class="mono text-xs break-all">{{ v.p2_vault_puzhash }}</span>
            </div>
            <div class="flex items-baseline justify-between">
              <span class="uppercase text-xs tracking-[0.2em] text-text-muted">XCH balance</span>
              <span class="mono text-sm">{{ v.balance.xch_mojos }} mojo</span>
            </div>
            <div class="flex items-baseline justify-between" *ngIf="v.current_coin_id">
              <span class="uppercase text-xs tracking-[0.2em] text-text-muted">Current coin id</span>
              <span class="mono text-xs break-all">{{ v.current_coin_id }}</span>
            </div>
          </div>

          <div class="card mt-8 space-y-5">
            <div>
              <div class="uppercase text-xs tracking-[0.2em] text-text-muted">zkPassport enrollment</div>
              <h2 class="font-display text-2xl mt-1">Build identity enrollment preview</h2>
              <p class="text-sm text-text-muted mt-2">
                Paste the verifier/bridge output for this vault. The portal computes the
                anonymous attestation root and the exact <span class="mono">'z'</span>
                spend inputs. Broadcast wiring lands in the next spend-builder brick.
              </p>
              <div class="mono text-[0.7rem] text-brand mt-2 break-all">
                Subscope: {{ vaultSubscope() }}
              </div>
            </div>

            <form class="grid gap-4 md:grid-cols-2" (ngSubmit)="buildEnrollmentPreview()">
              <label class="block md:col-span-2">
                <span class="form-label">Scoped nullifier</span>
                <input
                  class="input mt-1 w-full mono text-xs"
                  name="scoped_nullifier"
                  [(ngModel)]="enroll.scopedNullifier"
                  placeholder="0x… 32 bytes"
                />
              </label>

              <label class="block">
                <span class="form-label">Nullifier type</span>
                <input
                  class="input mt-1 w-full mono text-xs"
                  name="nullifier_type"
                  [(ngModel)]="enroll.nullifierType"
                  type="number"
                  min="0"
                />
              </label>

              <label class="block">
                <span class="form-label">Proof timestamp</span>
                <input
                  class="input mt-1 w-full mono text-xs"
                  name="proof_timestamp"
                  [(ngModel)]="enroll.proofTimestamp"
                  type="number"
                  min="0"
                />
              </label>

              <label class="block md:col-span-2">
                <span class="form-label">Service scope hash</span>
                <input
                  class="input mt-1 w-full mono text-xs"
                  name="service_scope_hash"
                  [(ngModel)]="enroll.serviceScopeHash"
                  placeholder="0x… Poseidon2(populis.app)"
                />
              </label>

              <label class="block md:col-span-2">
                <span class="form-label">Service subscope hash</span>
                <input
                  class="input mt-1 w-full mono text-xs"
                  name="service_subscope_hash"
                  [(ngModel)]="enroll.serviceSubscopeHash"
                  placeholder="0x… Poseidon2(vault:0x...)"
                />
              </label>

              <label class="block md:col-span-2">
                <span class="form-label">Bridge policy hash</span>
                <input
                  class="input mt-1 w-full mono text-xs"
                  name="bridge_policy_hash"
                  [(ngModel)]="enroll.bridgePolicyHash"
                  placeholder="0x… 32 bytes"
                />
              </label>

              <label class="block">
                <span class="form-label">Bridge parent id</span>
                <input
                  class="input mt-1 w-full mono text-xs"
                  name="bridge_parent_id"
                  [(ngModel)]="enroll.bridgeParentId"
                  placeholder="0x… 32 bytes"
                />
              </label>

              <label class="block">
                <span class="form-label">Bridge amount</span>
                <input
                  class="input mt-1 w-full mono text-xs"
                  name="bridge_amount"
                  [(ngModel)]="enroll.bridgeAmount"
                  type="number"
                  min="1"
                />
              </label>

              <div class="md:col-span-2 flex flex-wrap gap-3">
                <button class="btn btn--primary" type="submit">Build preview</button>
                <button class="btn btn--ghost" type="button" (click)="clearEnrollmentPreview()">
                  Clear
                </button>
              </div>
            </form>

            @if (enrollmentError()) {
              <div class="rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300 whitespace-pre-wrap">
                {{ enrollmentError() }}
              </div>
            }

            @if (enrollmentPreview(); as preview) {
              <div class="rounded-card border border-brand/30 bg-brand-soft p-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="font-display text-xl">Preview ready</div>
                    <div class="mono text-[0.7rem] text-text-muted">
                      spend_case {{ preview.spendCase }} · bridge coin {{ preview.bridgeCoinId }}
                    </div>
                  </div>
                  <button class="btn btn--primary" type="button" (click)="markEnrollmentSubmitPending()">
                    Mark submit pending
                  </button>
                </div>

                <pre class="mono text-[0.68rem] mt-4 overflow-auto whitespace-pre-wrap break-all">{{ enrollmentPreviewJson() }}</pre>

                @if (enrollmentStatus() === 'submit_pending') {
                  <p class="text-sm text-amber-200 mt-3">
                    Submit is staged for the next brick: this preview contains the
                    data the vault <span class="mono">'z'</span> spend builder needs.
                  </p>
                }
              </div>
            }
          </div>

          <div class="mt-6">
            <div class="uppercase text-xs tracking-[0.2em] text-text-muted mb-3">Deeds held</div>
            @if (!v.balance.deeds || v.balance.deeds.length === 0) {
              <div class="card text-sm text-text-muted">No deeds yet.</div>
            } @else {
              <div class="grid gap-3">
                @for (deed of v.balance.deeds; track deed.launcher_id) {
                  <div class="card flex items-baseline justify-between">
                    <div>
                      <div class="font-display text-lg">{{ deed.asset_class }} · {{ deed.property_id }}</div>
                      <div class="mono text-xs text-text-muted mt-1">{{ deed.launcher_id }}</div>
                    </div>
                    <div class="text-right">
                      <div class="mono text-sm">{{ deed.par_value }}</div>
                      <div class="text-xs text-text-muted">{{ deed.jurisdiction }}</div>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }
      }
    </section>
  `,
  styles: [
    `
      .pp-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 10px rgba(124, 255, 178, 0.7);
        animation: pp-pulse 1.4s ease-in-out infinite;
      }
      @keyframes pp-pulse {
        0%, 100% { opacity: 0.35; transform: scale(0.9); }
        50%     { opacity: 1;    transform: scale(1.15); }
      }

      .pp-spinner {
        width: 0.85rem;
        height: 0.85rem;
        border: 2px solid rgba(252, 211, 77, 0.25);
        border-top-color: rgb(252, 211, 77);
        border-radius: 999px;
        animation: pp-spin 0.9s linear infinite;
        display: inline-block;
      }
      @keyframes pp-spin {
        to { transform: rotate(360deg); }
      }

      .pp-pending {
        position: relative;
        overflow: hidden;
      }
      .pp-pending::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(124, 255, 178, 0.08) 50%,
          transparent 100%
        );
        animation: pp-sweep 2.4s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes pp-sweep {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
    `,
  ],
})
export class VaultComponent implements OnDestroy {
  readonly session = inject(SessionService);
  private readonly zkPassport = inject(ZkPassportAttestationService);
  private readonly proofStore = inject(ZkPassportProofStoreService);
  readonly refreshing = signal(false);
  readonly enrollmentStatus = signal<EnrollmentStatus>('idle');
  readonly enrollmentError = signal<string | null>(null);
  readonly enrollmentPreview = signal<ZkPassportEnrollmentPreview | null>(null);

  enroll = {
    scopedNullifier: '',
    nullifierType: 1,
    serviceScopeHash: '',
    serviceSubscopeHash: '',
    proofTimestamp: Math.floor(Date.now() / 1000),
    bridgePolicyHash: '0x' + '00'.repeat(32),
    bridgeParentId: '',
    bridgeAmount: 1,
  };

  /** True while the current vault is still waiting for confirmation. */
  readonly pending = computed(() => {
    const v = this.session.vault();
    return !!v && !v.confirmed;
  });

  readonly pollCadenceSeconds = computed(() =>
    Math.round((this.pending() ? PENDING_POLL_MS : CONFIRMED_POLL_MS) / 1000)
  );

  readonly vaultSubscope = computed(() => {
    const launcherId = this.session.session()?.vaultLauncherId;
    return launcherId ? this.zkPassport.computeVaultSubscope(launcherId) : '—';
  });

  readonly enrollmentPreviewJson = computed(() => {
    const preview = this.enrollmentPreview();
    return preview ? JSON.stringify(preview, null, 2) : '';
  });

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly visibilityHandler = () => this.onVisibilityChange();

  constructor() {
    if (this.session.session() && !this.session.vault()) {
      void this.refresh();
    }

    // Re-schedule whenever pending state changes (faster cadence when pending).
    effect(() => {
      // Track both signals so the effect re-runs when either changes.
      this.pending();
      this.session.session();
      this.reschedulePoll();
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  ngOnDestroy(): void {
    this.clearPoll();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /** Manual refresh (button click). */
  async manualRefresh(): Promise<void> {
    await this.refresh();
    this.reschedulePoll();
  }

  buildEnrollmentPreview(): void {
    this.enrollmentError.set(null);
    this.enrollmentPreview.set(null);
    const vault = this.session.vault();
    const session = this.session.session();
    try {
      if (!session?.vaultLauncherId) {
        throw new Error('No active vault session.');
      }
      if (!vault?.current_coin_id) {
        throw new Error('Refresh the vault until a current coin id is available.');
      }
      const bridgeAmount = Number(this.enroll.bridgeAmount);
      if (!Number.isInteger(bridgeAmount) || bridgeAmount <= 0) {
        throw new Error('bridgeAmount must be a positive integer.');
      }
      const attestationLeafHash = this.zkPassport.computeAttestationLeaf({
        vaultLauncherId: session.vaultLauncherId,
        scopedNullifier: this.enroll.scopedNullifier,
        nullifierType: Number(this.enroll.nullifierType),
        serviceScopeHash: this.enroll.serviceScopeHash,
        serviceSubscopeHash: this.enroll.serviceSubscopeHash,
        proofTimestamp: Number(this.enroll.proofTimestamp),
      });
      const newIdentityAttestRoot = this.zkPassport.computeAttestationRoot([attestationLeafHash]);
      const bridgePolicyHash = this.enroll.bridgePolicyHash;
      const bridgeParentId = this.enroll.bridgeParentId;
      const bridgeCoinId = coinId(bridgeParentId, bridgePolicyHash, bridgeAmount);
      const bridgeMessage = this.zkPassport.computeAttestationBridgeMessage({
        vaultLauncherId: session.vaultLauncherId,
        attestationRoot: newIdentityAttestRoot,
        bridgePolicyHash,
      });
      const bridgeAnnouncementPayload = '0x50' + bridgeMessage.slice(2);
      const assertedCoinAnnouncement = bytesToHex(
        hexToBytes(
          sha256(
            this.concatBytes(
              hexToBytes(bridgeCoinId),
              hexToBytes(bridgeAnnouncementPayload),
            ),
          ),
        ),
      );
      const proof = this.zkPassport.singleLeafProof();
      this.enrollmentPreview.set({
        spendCase: '0x7a',
        vaultLauncherId: session.vaultLauncherId,
        vaultCoinId: vault.current_coin_id,
        vaultSubscope: this.zkPassport.computeVaultSubscope(session.vaultLauncherId),
        attestationLeafHash,
        newIdentityAttestRoot,
        attestationProof: { bitpath: proof.bitpath, siblings: [] },
        bridgePolicyHash,
        bridgeParentId,
        bridgeAmount,
        bridgeCoinId,
        bridgeMessage,
        bridgeAnnouncementPayload,
        assertedCoinAnnouncement,
      });
      this.enrollmentStatus.set('preview_ready');
    } catch (err) {
      this.enrollmentStatus.set('idle');
      this.enrollmentError.set(err instanceof Error ? err.message : String(err));
    }
  }

  clearEnrollmentPreview(): void {
    this.enrollmentStatus.set('idle');
    this.enrollmentError.set(null);
    this.enrollmentPreview.set(null);
  }

  markEnrollmentSubmitPending(): void {
    const preview = this.enrollmentPreview();
    if (!preview) {
      return;
    }
    this.proofStore.save({
      vaultLauncherId: preview.vaultLauncherId,
      vaultSubscope: preview.vaultSubscope,
      identityAttestRoot: preview.newIdentityAttestRoot,
      attestationLeafHash: preview.attestationLeafHash,
      attestationProof: preview.attestationProof,
      bridgePolicyHash: preview.bridgePolicyHash,
      bridgeMessage: preview.bridgeMessage,
      enrolledAt: Math.floor(Date.now() / 1000),
    });
    this.enrollmentStatus.set('submit_pending');
  }

  private async refresh(): Promise<void> {
    if (!this.session.session()) return;
    this.refreshing.set(true);
    try {
      await this.session.refreshVault();
    } finally {
      this.refreshing.set(false);
    }
  }

  private reschedulePoll(): void {
    this.clearPoll();
    if (!this.session.session()) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const cadence = this.pending() ? PENDING_POLL_MS : CONFIRMED_POLL_MS;
    this.pollTimer = setTimeout(async () => {
      await this.refresh();
      this.reschedulePoll();
    }, cadence);
  }

  private clearPoll(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private concatBytes(...chunks: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  private onVisibilityChange(): void {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      this.clearPoll();
    } else {
      // Back to the tab — fire an immediate refresh then resume polling.
      void (async () => {
        await this.refresh();
        this.reschedulePoll();
      })();
    }
  }
}
