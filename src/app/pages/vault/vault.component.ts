import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { sha256 } from 'ethers';
import { SessionService } from '../../services/session.service';
import { VaultVersionStatusService, type VaultVersionStatus } from '../../services/vault-version-status.service';
import { ZkPassportAttestationService } from '../../services/zkpassport-attestation.service';
import {
  ValidatorBridgeSpendPackage,
  ZkPassportEvmAttestationPollerService,
  ZkPassportEvmPollResult,
} from '../../services/zkpassport-evm-attestation-poller.service';
import {
  ZkPassportVaultEnrollmentSpendPackage,
  ZkPassportVaultEnrollmentSpendService,
} from '../../services/zkpassport-vault-enrollment-spend.service';
import {
  ZkPassportVaultEnrollmentAuthorizationResult,
  ZkPassportVaultEnrollmentAuthorizeService,
} from '../../services/zkpassport-vault-enrollment-authorize.service';
import {
  ZkPassportVaultEnrollmentCommitResult,
  ZkPassportVaultEnrollmentCommitService,
} from '../../services/zkpassport-vault-enrollment-commit.service';
import { ZkPassportProofStoreService } from '../../services/zkpassport-proof-store.service';
import { ZkPassportValidatorSignerService } from '../../services/zkpassport-validator-signer.service';
import {
  UpgradeProgress,
  UpgradeRunResult,
  VaultUpgradeRunnerService,
} from '../../services/vault-upgrade-runner.service';
import { AUTH_TYPE_BLS, AUTH_TYPE_SECP256K1, AUTH_TYPE_SECP256R1, bytesToHex, hexToBytes } from '../../utils/chia-hash';

/** Polling cadence while the vault is still unconfirmed.  Testnet11 blocks
 *  are ~18s, so 5s keeps UI snappy without hammering coinset.org. */
const PENDING_POLL_MS = 5_000;

/** Fallback cadence once confirmed — much slower; we mostly watch for new
 *  deeds / balance changes.  30s is plenty. */
const CONFIRMED_POLL_MS = 30_000;

type EnrollmentStatus =
  | 'idle'
  | 'attestation_pending'
  | 'preview_ready'
  | 'authorization_pending'
  | 'authorized'
  | 'commit_pending'
  | 'confirmed'
  | 'malformed'
  | 'timeout';

interface ZkPassportEnrollmentPreview {
  spendCase: '0x7a';
  vaultLauncherId: string;
  vaultCoinId: string;
  vaultSubscope: string;
  scopedNullifier: string;
  nullifierType: number;
  serviceScopeHash: string;
  serviceSubscopeHash: string;
  proofTimestamp: number;
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
  validatorMessage: string;
  bridgeSpendPackage: ValidatorBridgeSpendPackage;
  unsignedEnrollmentSpendPackage: ZkPassportVaultEnrollmentSpendPackage | null;
}

@Component({
  selector: 'pp-vault',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-16 pb-24 max-w-4xl">
      <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4">Your Vault</div>
      <h1 class="font-display text-4xl md:text-5xl">Vault dashboard</h1>

      @if (returnTo(); as target) {
        <div class="card mt-6 text-sm text-text-muted">
          Complete vault setup here; after zkPassport enrollment confirms,
          you will return to <span class="mono text-brand">{{ target }}</span>.
        </div>
      }

      @if (checkingVersion()) {
        <div class="card mt-6 text-sm text-text-muted inline-flex items-center gap-3">
          <span class="pp-spinner" aria-hidden="true"></span>
          Checking vault version against the on-chain registry…
        </div>
      } @else if (versionStatus(); as status) {
        @if (status.kind === 'outdated') {
          <div class="rounded-card border border-amber-400/30 bg-amber-400/10 p-5 mt-6">
            <div class="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div class="font-display text-xl text-amber-100">Upgrade available</div>
                <p class="text-sm text-amber-100/80 mt-1">
                  A newer vault version ({{ status.registryVersion }}) is published on chain.
                  @switch (status.reason) {
                    @case ('code') { The upgrade includes a code change. }
                    @case ('params') { The upgrade repairs protocol parameters. }
                    @case ('both') { The upgrade includes a code change and parameter repairs. }
                  }
                </p>
              </div>
              <button
                class="btn btn--primary"
                type="button"
                (click)="upgradeVault()"
                [disabled]="upgrading()"
              >
                @if (upgrading()) { Upgrading… } @else { Upgrade vault }
              </button>
            </div>

            @if (upgradeProgress(); as p) {
              <div class="mt-4 text-sm text-amber-100/90 inline-flex items-center gap-2">
                @if (upgrading()) { <span class="pp-spinner" aria-hidden="true"></span> }
                <span>{{ p.message }}</span>
                @if (p.deedTotal) {
                  <span class="mono text-xs text-amber-200">({{ p.deedIndex }}/{{ p.deedTotal }})</span>
                }
              </div>
            }

            @if (upgradeError()) {
              <div class="mt-4 rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300 whitespace-pre-wrap">
                {{ upgradeError() }}
              </div>
            }

            @if (upgradeResult(); as r) {
              <div class="mt-4 rounded-card border border-brand/30 bg-brand-soft p-4 text-sm">
                <div class="text-brand">New vault launched:</div>
                <div class="mono text-xs break-all mt-1">{{ r.newVaultLauncherId }}</div>
                @if (r.deedsUnmigratable) {
                  <p class="text-amber-200 mt-2">
                    This vault predates the migrate upgrade, so its deeds could not be moved
                    automatically. Transfer any freely-transferable XCH / pool-share assets
                    from your wallet.
                  </p>
                } @else {
                  <p class="text-text-muted mt-2">
                    {{ r.migratedDeeds.length }} deed(s) migrated to the new vault.
                  </p>
                }
              </div>
            }
          </div>
        } @else {
          <div class="card mt-6 text-sm text-brand inline-flex items-center gap-2">
            <span class="pp-dot" aria-hidden="true"></span>
            Vault version {{ status.registryVersion }} — up to date
          </div>
        }
      }

      @if (!session.session()) {
        <div class="card mt-10">
          <p class="text-text-muted">No active session. Connect a wallet to open or create your vault.</p>
          <a
            [routerLink]="['/connect']"
            [queryParams]="returnQueryParams()"
            class="btn btn--primary mt-4 inline-block"
          >
            Connect Wallet
          </a>
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
              <h2 class="font-display text-2xl mt-1">Verify on EVM and prepare Chia bridge</h2>
              <p class="text-sm text-text-muted mt-2">
                Start the zkPassport EVM proof flow for this vault. The portal polls the
                attestation event, derives the anonymous Chia commitments, and prepares
                the validator bridge package without a backend signer.
              </p>
              <div class="mono text-[0.7rem] text-brand mt-2 break-all">
                Subscope: {{ vaultSubscope() }}
              </div>
            </div>

            <div class="flex flex-wrap gap-3">
              <button
                class="btn btn--primary"
                type="button"
                (click)="startZkPassportEnrollment()"
                [disabled]="enrollmentStatus() === 'attestation_pending'"
              >
                Start zkPassport verification
              </button>
              <button
                class="btn"
                type="button"
                (click)="checkZkPassportAttestation()"
                [disabled]="enrollmentStatus() === 'attestation_pending'"
              >
                Check EVM attestation
              </button>
              <button class="btn btn--ghost" type="button" (click)="clearEnrollmentPreview()">
                Clear
              </button>
            </div>

            @if (zkPassportProofUrl()) {
              <div class="text-xs text-text-muted">
                Proof flow URL:
                <span class="mono break-all">{{ zkPassportProofUrl() }}</span>
                <a class="btn btn--ghost text-xs mt-3 inline-flex" [href]="zkPassportProofUrl()" target="_blank" rel="noopener">
                  Open proof flow
                </a>
              </div>
            }

            @if (enrollmentStatus() === 'attestation_pending') {
              <div class="rounded-card border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
                Waiting for the EVM <span class="mono">VaultAttestationVerified</span> event…
              </div>
            }

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
                      spend_case {{ preview.spendCase }} · bridge coin {{ preview.bridgeCoinId }} ·
                      {{ preview.bridgeSpendPackage.status }}
                    </div>
                  </div>
                  <button
                    class="btn btn--primary"
                    type="button"
                    (click)="authorizeZkPassportEnrollment()"
                    [disabled]="!preview.unsignedEnrollmentSpendPackage || enrollmentStatus() === 'authorization_pending' || enrollmentStatus() === 'commit_pending'"
                  >
                    @if (enrollmentStatus() === 'authorization_pending') { Authorizing… } @else { Authorize spend }
                  </button>
                </div>

                @if (preview.unsignedEnrollmentSpendPackage) {
                  <div class="mono text-[0.7rem] text-brand mt-3 break-all">
                    Unsigned Chia package ready ·
                    {{ preview.unsignedEnrollmentSpendPackage.coinSpends.length }} coin spends
                  </div>
                } @else {
                  <div class="text-xs text-amber-200 mt-3">
                    Waiting for validator threshold signatures before the unsigned Chia
                    package can be serialized.
                  </div>
                }

                <pre class="mono text-[0.68rem] mt-4 overflow-auto whitespace-pre-wrap break-all">{{ enrollmentPreviewJson() }}</pre>

                @if (enrollmentStatus() === 'authorization_pending') {
                  <p class="text-sm text-amber-200 mt-3">
                    Awaiting wallet authorization for the Chia enrollment bundle…
                  </p>
                }

                @if (enrollmentStatus() === 'authorized' && enrollmentAuthorizationResult(); as authorized) {
                  <div class="flex flex-wrap items-center gap-3 mt-3">
                    <p class="text-sm text-brand">
                      Signed enrollment bundle ready:
                      <span class="mono">{{ authorized.signedSpendBundle.coinSpends.length }} coin spends</span>
                    </p>
                    <button class="btn btn--primary" type="button" (click)="commitZkPassportEnrollment()">
                      Submit signed bundle
                    </button>
                  </div>
                }

                @if (enrollmentStatus() === 'commit_pending') {
                  <p class="text-sm text-amber-200 mt-3">
                    Submitted to coinset; waiting for the vault singleton to confirm…
                  </p>
                }

                @if (enrollmentStatus() === 'confirmed' && enrollmentCommitResult(); as committed) {
                  <p class="text-sm text-brand mt-3">
                    Enrollment confirmed at block
                    <span class="mono">{{ committed.confirmedBlockIndex ?? 'unknown' }}</span>
                    with vault coin
                    <span class="mono break-all">{{ committed.confirmedVaultCoinId }}</span>
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly zkPassport = inject(ZkPassportAttestationService);
  private readonly evmPoller = inject(ZkPassportEvmAttestationPollerService);
  private readonly proofStore = inject(ZkPassportProofStoreService);
  private readonly enrollmentSpend = inject(ZkPassportVaultEnrollmentSpendService);
  private readonly enrollmentAuthorize = inject(ZkPassportVaultEnrollmentAuthorizeService);
  private readonly enrollmentCommit = inject(ZkPassportVaultEnrollmentCommitService);
  private readonly validatorSigner = inject(ZkPassportValidatorSignerService);
  private readonly vaultVersionStatus = inject(VaultVersionStatusService);
  private readonly upgradeRunner = inject(VaultUpgradeRunnerService);
  readonly refreshing = signal(false);
  readonly versionStatus = signal<VaultVersionStatus | null>(null);
  readonly checkingVersion = signal(false);
  readonly upgrading = signal(false);
  readonly upgradeProgress = signal<UpgradeProgress | null>(null);
  readonly upgradeError = signal<string | null>(null);
  readonly upgradeResult = signal<UpgradeRunResult | null>(null);
  readonly enrollmentStatus = signal<EnrollmentStatus>('idle');
  readonly enrollmentError = signal<string | null>(null);
  readonly enrollmentPreview = signal<ZkPassportEnrollmentPreview | null>(null);
  readonly enrollmentAuthorizationResult = signal<ZkPassportVaultEnrollmentAuthorizationResult | null>(null);
  readonly enrollmentCommitResult = signal<ZkPassportVaultEnrollmentCommitResult | null>(null);
  readonly zkPassportProofUrl = signal<string | null>(null);
  readonly returnTo = signal<string | null>(
    safeReturnTo(this.route.snapshot.queryParamMap.get('returnTo')),
  );

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
  private attestationStartedAtMs: number | null = null;
  private readonly visibilityHandler = () => this.onVisibilityChange();
  private readonly proofMessageHandler = (ev: MessageEvent) => this.onVerifyPopupMessage(ev);

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
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.proofMessageHandler);
    }
  }

  ngOnDestroy(): void {
    this.clearPoll();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.proofMessageHandler);
    }
  }

  /** Manual refresh (button click). */
  async manualRefresh(): Promise<void> {
    await this.refresh();
    this.reschedulePoll();
  }

  /**
   * One-click vault upgrade (Brick 6): launch a new vault at the registry's
   * canonical descriptor, migrate the deeds, then re-point the session onto
   * the new vault.  Streams progress into ``upgradeProgress`` for the UI.
   */
  async upgradeVault(): Promise<void> {
    if (this.upgrading()) {
      return;
    }
    const vault = this.session.vault();
    const launcherId = vault?.vault_launcher_id;
    if (!launcherId) {
      this.upgradeError.set('No vault is loaded to upgrade. Refresh and retry.');
      return;
    }
    this.upgradeError.set(null);
    this.upgradeResult.set(null);
    this.upgradeProgress.set(null);
    this.upgrading.set(true);
    try {
      const result = await this.upgradeRunner.runUpgrade(launcherId, (progress) => {
        this.upgradeProgress.set(progress);
      });
      this.upgradeResult.set(result);
      // Swap the session onto the freshly launched vault and re-check status.
      this.session.setVaultLauncherId(result.newVaultLauncherId);
      this.versionStatus.set(null);
      await this.refresh();
    } catch (err) {
      this.upgradeError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.upgrading.set(false);
    }
  }

  private onVerifyPopupMessage(ev: MessageEvent): void {
    if (ev.origin !== window.location.origin) {
      return;
    }
    if (ev.data?.type === 'zkpassport_proof' && ev.data?.verified === true) {
      void this.checkZkPassportAttestation();
    }
  }

  async startZkPassportEnrollment(): Promise<void> {
    this.enrollmentError.set(null);
    this.enrollmentPreview.set(null);
    const session = this.session.session();
    try {
      if (!session?.vaultLauncherId) {
        throw new Error('No active vault session.');
      }
      this.attestationStartedAtMs = Date.now();
      const proofUrl = this.evmPoller.proofLaunchUrl(session.vaultLauncherId);
      if (!proofUrl) {
        throw new Error(
          'zkPassport verification URL is not configured. Set environment.zkPassport.verificationUrl before starting verification.',
        );
      }
      this.zkPassportProofUrl.set(proofUrl);
      if (typeof window !== 'undefined') {
        window.open(proofUrl, '_blank', 'noopener');
      }
      await this.checkZkPassportAttestation();
    } catch (err) {
      this.enrollmentStatus.set('idle');
      this.enrollmentError.set(err instanceof Error ? err.message : String(err));
    }
  }

  async checkZkPassportAttestation(): Promise<void> {
    this.enrollmentError.set(null);
    const vault = this.session.vault();
    const session = this.session.session();
    try {
      if (!session?.vaultLauncherId) {
        throw new Error('No active vault session.');
      }
      if (!vault?.current_coin_id) {
        throw new Error('Refresh the vault until a current coin id is available.');
      }
      const result = await this.evmPoller.pollOnce(session.vaultLauncherId, {
        startedAtMs: this.attestationStartedAtMs ?? undefined,
      });
      let validatorSignatures = undefined;
      if (result.kind === 'found' && result.bridgeSpendPackage.status === 'insufficient_signatures') {
        try {
          validatorSignatures = await this.validatorSigner.collectSignatures(
            result.enrollment.validatorMessage,
          );
        } catch (sigErr) {
          this.enrollmentError.set(
            'Validator signer unavailable: ' + (sigErr instanceof Error ? sigErr.message : String(sigErr)),
          );
        }
      }
      const finalResult = validatorSignatures
        ? await this.evmPoller.pollOnce(session.vaultLauncherId, {
            startedAtMs: this.attestationStartedAtMs ?? undefined,
            validatorSignatures,
          })
        : result;
      await this.applyAttestationPollResult(finalResult, vault.current_coin_id);
    } catch (err) {
      this.enrollmentStatus.set('idle');
      this.enrollmentError.set(err instanceof Error ? err.message : String(err));
    }
  }

  clearEnrollmentPreview(): void {
    this.enrollmentStatus.set('idle');
    this.enrollmentError.set(null);
    this.enrollmentPreview.set(null);
    this.enrollmentAuthorizationResult.set(null);
    this.enrollmentCommitResult.set(null);
    this.zkPassportProofUrl.set(null);
    this.attestationStartedAtMs = null;
  }

  async authorizeZkPassportEnrollment(): Promise<void> {
    const preview = this.enrollmentPreview();
    const session = this.session.session();
    const vault = this.session.vault();
    const ownerPubkey = session?.compressedPubkey ?? vault?.owner_pubkey;
    try {
      if (!preview?.unsignedEnrollmentSpendPackage) {
        throw new Error('No unsigned enrollment spend package is ready to submit.');
      }
      if (!session || !ownerPubkey) {
        throw new Error('No vault owner pubkey is available for enrollment submission.');
      }
      if (!vault?.current_coin_id) {
        throw new Error('Refresh the vault until a current coin id is available.');
      }
      this.enrollmentError.set(null);
      this.enrollmentAuthorizationResult.set(null);
      this.enrollmentStatus.set('authorization_pending');
      const result = await this.enrollmentAuthorize.authorizeFromChain({
        vaultLauncherId: preview.vaultLauncherId,
        vaultCoinId: vault.current_coin_id,
        ownerPubkey,
        authType: this.authTypeCode(session.authType),
        bridgePolicyHash: preview.bridgePolicyHash,
        bridgeParentId: preview.bridgeParentId,
        bridgeAmount: preview.bridgeAmount,
        newIdentityAttestRoot: preview.newIdentityAttestRoot,
        attestationLeafHash: preview.attestationLeafHash,
        scopedNullifier: preview.scopedNullifier,
        nullifierType: preview.nullifierType,
        serviceScopeHash: preview.serviceScopeHash,
        serviceSubscopeHash: preview.serviceSubscopeHash,
        proofTimestamp: preview.proofTimestamp,
        signerIndices: preview.bridgeSpendPackage.signerIndices,
        validatorSignatures: preview.bridgeSpendPackage.signatures,
        currentTimestamp: Math.floor(Date.now() / 1000),
      });
      this.enrollmentAuthorizationResult.set(result);
      this.enrollmentStatus.set('authorized');
    } catch (err) {
      this.enrollmentStatus.set('preview_ready');
      this.enrollmentError.set(err instanceof Error ? err.message : String(err));
    }
  }

  async commitZkPassportEnrollment(): Promise<void> {
    const preview = this.enrollmentPreview();
    const authorization = this.enrollmentAuthorizationResult();
    try {
      if (!preview || !authorization) {
        throw new Error('No signed enrollment bundle is ready to submit.');
      }
      this.enrollmentError.set(null);
      this.enrollmentCommitResult.set(null);
      this.enrollmentStatus.set('commit_pending');
      const result = await this.enrollmentCommit.commitAuthorizedEnrollment(authorization);
      this.persistEnrollmentProof(preview);
      this.enrollmentCommitResult.set(result);
      this.enrollmentStatus.set('confirmed');
      const target = this.returnTo();
      if (target) {
        await this.router.navigateByUrl(target);
      }
    } catch (err) {
      this.enrollmentStatus.set(authorization ? 'authorized' : 'preview_ready');
      this.enrollmentError.set(err instanceof Error ? err.message : String(err));
    }
  }

  private persistEnrollmentProof(preview: ZkPassportEnrollmentPreview): void {
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
  }

  returnQueryParams(): Record<string, string> {
    const target = this.returnTo();
    return target ? { returnTo: target } : {};
  }

  private async applyAttestationPollResult(
    result: ZkPassportEvmPollResult,
    vaultCoinId: string,
  ): Promise<void> {
    if (result.kind === 'pending') {
      this.enrollmentStatus.set('attestation_pending');
      return;
    }
    if (result.kind === 'timeout') {
      this.enrollmentStatus.set('timeout');
      this.enrollmentError.set('Timed out waiting for the EVM VaultAttestationVerified event.');
      return;
    }
    if (result.kind === 'malformed') {
      this.enrollmentStatus.set('malformed');
      this.enrollmentPreview.set(null);
      this.enrollmentError.set(result.reason);
      return;
    }
    const enrollment = result.enrollment;
    const session = this.session.session();
    const vault = this.session.vault();
    const ownerPubkey = session?.compressedPubkey ?? vault?.owner_pubkey;
    if (!session || !ownerPubkey) {
      throw new Error('No vault owner pubkey is available for enrollment spend construction.');
    }
    const unsignedEnrollmentSpendPackage =
      result.bridgeSpendPackage.status === 'threshold_ready'
        ? await this.enrollmentSpend.buildFromChain({
            vaultLauncherId: enrollment.vaultLauncherId,
            vaultCoinId,
            ownerPubkey,
            authType: this.authTypeCode(session.authType),
            bridgePolicyHash: enrollment.bridgePolicyHash,
            bridgeParentId: enrollment.bridgeParentId,
            bridgeAmount: enrollment.bridgeAmount,
            newIdentityAttestRoot: enrollment.newIdentityAttestRoot,
            attestationLeafHash: enrollment.attestationLeafHash,
            scopedNullifier: enrollment.scopedNullifier,
            nullifierType: enrollment.nullifierType,
            serviceScopeHash: enrollment.serviceScopeHash,
            serviceSubscopeHash: enrollment.serviceSubscopeHash,
            proofTimestamp: enrollment.proofTimestamp,
            currentTimestamp: Math.floor(Date.now() / 1000),
            signerIndices: result.bridgeSpendPackage.signerIndices,
            validatorSignatures: result.bridgeSpendPackage.signatures,
          })
        : null;
    const assertedCoinAnnouncement = bytesToHex(
      hexToBytes(
        sha256(
          this.concatBytes(
            hexToBytes(enrollment.bridgeCoinId),
            hexToBytes(enrollment.bridgeAnnouncementPayload),
          ),
        ),
      ),
    );
    this.enrollmentPreview.set({
      spendCase: '0x7a',
      vaultLauncherId: enrollment.vaultLauncherId,
      vaultCoinId,
      vaultSubscope: enrollment.vaultSubscope,
      scopedNullifier: enrollment.scopedNullifier,
      nullifierType: enrollment.nullifierType,
      serviceScopeHash: enrollment.serviceScopeHash,
      serviceSubscopeHash: enrollment.serviceSubscopeHash,
      proofTimestamp: enrollment.proofTimestamp,
      attestationLeafHash: enrollment.attestationLeafHash,
      newIdentityAttestRoot: enrollment.newIdentityAttestRoot,
      attestationProof: enrollment.attestationProof,
      bridgePolicyHash: enrollment.bridgePolicyHash,
      bridgeParentId: enrollment.bridgeParentId,
      bridgeAmount: enrollment.bridgeAmount,
      bridgeCoinId: enrollment.bridgeCoinId,
      bridgeMessage: enrollment.bridgeMessage,
      bridgeAnnouncementPayload: enrollment.bridgeAnnouncementPayload,
      assertedCoinAnnouncement,
      validatorMessage: enrollment.validatorMessage,
      bridgeSpendPackage: result.bridgeSpendPackage,
      unsignedEnrollmentSpendPackage,
    });
    this.enrollmentStatus.set('preview_ready');
  }

  private authTypeCode(authType: 'evm' | 'chia_bls' | 'passkey'): number {
    if (authType === 'evm') return AUTH_TYPE_SECP256K1;
    if (authType === 'chia_bls') return AUTH_TYPE_BLS;
    return AUTH_TYPE_SECP256R1;
  }

  private async refresh(): Promise<void> {
    if (!this.session.session()) return;
    this.refreshing.set(true);
    try {
      await this.session.refreshVault();
      await this.checkVersionStatus();
    } finally {
      this.refreshing.set(false);
    }
  }

  private async checkVersionStatus(): Promise<void> {
    const vault = this.session.vault();
    if (!vault?.vault_launcher_id) {
      return;
    }
    if (this.checkingVersion()) {
      return;
    }
    this.checkingVersion.set(true);
    try {
      const status = await this.vaultVersionStatus.checkVault(vault.vault_launcher_id);
      this.versionStatus.set(status);
    } finally {
      this.checkingVersion.set(false);
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

function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
