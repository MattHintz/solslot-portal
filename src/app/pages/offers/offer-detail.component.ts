import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ChiaWalletService } from '../../services/chia-wallet.service';
import { EvmWalletService } from '../../services/evm-wallet.service';
import {
  MemberOfferContext,
  OfferEligibility,
  classifyOfferEligibility,
} from '../../services/offer-domain';
import { OfferSourceService } from '../../services/offer-source.service';
import { SessionService } from '../../services/session.service';
import {
  VaultAcceptOfferAuthorizationArgs,
  VaultAcceptOfferAuthorizationResult,
} from '../../services/vault-accept-offer-authorize.service';
import { VaultAcceptOfferCommitResult } from '../../services/vault-accept-offer-commit.service';
import { VaultAcceptOfferLifecycleService } from '../../services/vault-accept-offer-lifecycle.service';
import {
  protocolCoordinateFromEnvironment,
  resolveProtocolCoordinate,
} from '../../services/protocol-coordinate-guard';
import { ZkPassportAcceptOfferProofService } from '../../services/zkpassport-accept-offer-proof.service';
import { formatError } from '../../utils/format-error';
import { AUTH_TYPE_BLS, AUTH_TYPE_SECP256K1, AUTH_TYPE_SECP256R1 } from '../../utils/chia-hash';

@Component({
  selector: 'pp-offer-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-14 pb-24 max-w-5xl">
      <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4">
        Member Offer
      </div>

      @if (offer(); as offer) {
        <div class="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <div>
            <h1 class="font-display text-4xl md:text-5xl">{{ offer.title }}</h1>
            <div class="mt-5 grid gap-4 sm:grid-cols-2">
              <div class="card">
                <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Price</div>
                <div class="mono text-xl mt-2">{{ offer.terms.priceMojos | number }} mojo</div>
              </div>
              <div class="card">
                <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Pool tokens</div>
                <div class="mono text-xl mt-2">{{ offer.terms.tokenAmount | number }}</div>
              </div>
            </div>

            <div class="card mt-5 space-y-4">
              <div>
                <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Deed launcher</div>
                <div class="mono text-xs break-all mt-2">{{ offer.deedLauncherId }}</div>
              </div>
              <div>
                <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Artifact</div>
                <div class="mono text-xs break-all mt-2">
                  {{ offer.artifact?.artifactId || 'unavailable' }}
                </div>
              </div>
              <div>
                <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Eligibility state</div>
                <div class="mono text-sm mt-2" [class.text-brand]="eligibility().canAccept">
                  {{ eligibility().state }}
                </div>
              </div>
            </div>
          </div>

          <aside class="card h-fit space-y-5">
            <div>
              <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Vault</div>
              <div class="mono text-xs break-all mt-2">
                {{ context().vaultLauncherId || 'not connected' }}
              </div>
            </div>

            <div>
              <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Member path</div>
              <ol class="mt-3 grid gap-2">
                @for (step of onboardingSteps(); track step.key) {
                  <li class="path-step" [attr.data-status]="step.status">
                    <span class="path-step__dot" aria-hidden="true"></span>
                    <span class="min-w-0">
                      <span class="block text-sm">{{ step.label }}</span>
                      <span class="mono text-[0.65rem] text-text-muted">{{ step.notation }}</span>
                    </span>
                  </li>
                }
              </ol>
            </div>

            <div>
              <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Status</div>
              <p class="mt-2 text-sm text-text-muted">{{ eligibility().reason }}</p>
            </div>

            @if (error()) {
              <div
                class="rounded-card border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300 whitespace-pre-wrap"
              >
                {{ error() }}
              </div>
            }

            @switch (eligibility().requiredAction) {
              @case ('connect_wallet') {
                <a
                  [routerLink]="['/connect']"
                  [queryParams]="returnQueryParams()"
                  class="btn btn--primary w-full text-center inline-block"
                >
                  Connect wallet
                </a>
              }
              @case ('create_vault') {
                <a
                  [routerLink]="['/create-vault']"
                  [queryParams]="returnQueryParams()"
                  class="btn btn--primary w-full text-center inline-block"
                >
                  Create vault
                </a>
              }
              @case ('wait_for_vault_confirmation') {
                <button class="btn btn--primary w-full" type="button" (click)="refreshVault()">
                  Refresh vault
                </button>
              }
              @case ('enroll_zkpassport') {
                <a
                  [routerLink]="['/vault']"
                  [queryParams]="vaultEnrollmentQueryParams()"
                  class="btn btn--primary w-full text-center inline-block"
                >
                  Enroll zkPassport
                </a>
              }
              @case ('refresh_chain_state') {
                <button class="btn btn--primary w-full" type="button" (click)="refreshVault()">
                  Refresh chain state
                </button>
              }
              @default {
                @if (acceptStatus() === 'confirmed') {
                  <button class="btn btn--primary w-full" type="button" disabled>
                    Offer accepted
                  </button>
                } @else if (acceptAuthorization()) {
                  <button
                    class="btn btn--primary w-full"
                    type="button"
                    [disabled]="acceptStatus() === 'authorizing' || acceptStatus() === 'committing'"
                    (click)="commitAcceptOffer()"
                  >
                    {{ acceptStatus() === 'committing' ? 'Submitting signed bundle...' : 'Submit signed bundle' }}
                  </button>
                } @else {
                  <button
                    class="btn btn--primary w-full"
                    type="button"
                    [disabled]="!eligibility().canAccept || acceptStatus() === 'authorizing'"
                    (click)="authorizeAcceptOffer()"
                  >
                    {{ acceptStatus() === 'authorizing' ? 'Awaiting wallet signature...' : 'Authorize acceptance' }}
                  </button>
                }
              }
            }

            @if (acceptStatus() !== 'idle') {
              <div class="rounded-card border border-brand/30 bg-brand-soft p-3 text-sm text-brand">
                {{ acceptStatusMessage() }}
                @if (acceptResult(); as result) {
                  <div class="mono text-[0.7rem] break-all mt-2">
                    Next vault coin: {{ result.confirmedVaultCoinId }}
                  </div>
                } @else if (acceptAuthorization(); as authorization) {
                  <div class="mono text-[0.7rem] break-all mt-2">
                    Expected next vault coin:
                    {{ authorization.packageState.expectedNextVaultCoin.coinId }}
                  </div>
                }
              </div>
            }

            @if (acceptStatus() === 'confirmed') {
              <div class="grid gap-2">
                <a routerLink="/vault" class="btn btn--primary w-full text-center inline-block">
                  View deed in vault
                </a>
                <a routerLink="/offers" class="btn btn--ghost w-full text-center inline-block">
                  Back to offers
                </a>
              </div>
            }
          </aside>
        </div>
      } @else {
        <div class="card">
          <h1 class="font-display text-3xl">Offer unavailable</h1>
          <p class="text-sm text-text-muted mt-2">No matching offer was found.</p>
          <a routerLink="/offers" class="btn btn--ghost mt-4 inline-block">Back to offers</a>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .path-step {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 0.65rem;
        align-items: center;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 0.55rem 0.65rem;
      }

      .path-step__dot {
        width: 0.55rem;
        height: 0.55rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.22);
      }

      .path-step[data-status='done'] .path-step__dot {
        background: var(--accent);
        box-shadow: 0 0 10px rgba(124, 255, 178, 0.55);
      }

      .path-step[data-status='current'] {
        border-color: rgba(124, 255, 178, 0.35);
        background: rgba(124, 255, 178, 0.06);
      }

      .path-step[data-status='current'] .path-step__dot {
        background: var(--accent);
      }
    `,
  ],
})
export class OfferDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionService);
  private readonly evmWallet = inject(EvmWalletService);
  private readonly chiaWallet = inject(ChiaWalletService);
  private readonly proofService = inject(ZkPassportAcceptOfferProofService);
  private readonly offerSource = inject(OfferSourceService);
  private readonly acceptOfferLifecycle = inject(VaultAcceptOfferLifecycleService);

  readonly error = signal<string | null>(null);
  readonly acceptStatus = signal<AcceptOfferStatus>('idle');
  readonly acceptAuthorization = signal<VaultAcceptOfferAuthorizationResult | null>(null);
  readonly acceptResult = signal<VaultAcceptOfferCommitResult | null>(null);

  readonly offerId = computed(() => this.route.snapshot.paramMap.get('id') ?? 'testnet-deed-001');

  readonly returnTarget = computed(() => `/offers/${this.offerId()}`);

  readonly offer = computed(() => {
    return this.offerSource.offerById(this.offerId());
  });

  readonly context = computed<MemberOfferContext>(() => {
    const session = this.session.session();
    const vault = this.session.vault();
    const vaultLauncherId = vault?.vault_launcher_id ?? session?.vaultLauncherId ?? null;
    const walletConnected = !!session || !!this.evmWallet.address() || !!this.chiaWallet.pubkey();
    const zkPassportProofConfirmed = vaultLauncherId
      ? this.hasAcceptOfferProof(vaultLauncherId)
      : false;
    return {
      walletConnected,
      vaultLauncherId,
      vaultConfirmed: vault ? vault.confirmed : vaultLauncherId ? false : undefined,
      zkPassportProofConfirmed,
      chainStateFresh: vault ? true : vaultLauncherId ? false : undefined,
      currentTimestamp: Math.floor(Date.now() / 1000),
    };
  });

  readonly eligibility = computed<OfferEligibility>(() =>
    classifyOfferEligibility(this.offer(), this.context()),
  );

  readonly onboardingSteps = computed<OfferOnboardingStep[]>(() =>
    buildOnboardingSteps(this.eligibility(), this.acceptStatus()),
  );

  readonly acceptStatusMessage = computed(() => {
    switch (this.acceptStatus()) {
      case 'authorizing':
        return 'Waiting for the vault wallet to authorize the accept-offer spend.';
      case 'authorized':
        return 'Signed accept package ready. Submit the signed bundle to finish acceptance.';
      case 'committing':
        return 'Signed bundle submitted. Waiting for the next vault coin to confirm.';
      case 'confirmed':
        return 'Offer acceptance confirmed on chain.';
      case 'error':
        return 'Offer acceptance needs attention before it can continue.';
      default:
        return '';
    }
  });

  returnQueryParams(): Record<string, string> {
    return { returnTo: this.returnTarget() };
  }

  vaultEnrollmentQueryParams(): Record<string, string> {
    return { ...this.returnQueryParams(), intent: 'zkpassport' };
  }

  async refreshVault(): Promise<void> {
    this.error.set(null);
    try {
      await this.session.refreshVault();
    } catch (e) {
      this.error.set(formatError(e));
    }
  }

  async authorizeAcceptOffer(): Promise<void> {
    if (!this.eligibility().canAccept) {
      return;
    }
    this.error.set(null);
    this.acceptAuthorization.set(null);
    this.acceptResult.set(null);
    this.acceptStatus.set('authorizing');
    try {
      const offer = this.requireOffer();
      const context = this.context();
      const authorizationArgs = this.acceptOfferAuthorizationArgs();
      const authorization = await this.acceptOfferLifecycle.authorizeEligibleAcceptOffer({
        offerDetail: offer,
        context,
        authorizationArgs,
      });
      this.acceptAuthorization.set(authorization);
      this.acceptStatus.set('authorized');
    } catch (e) {
      this.acceptStatus.set('error');
      this.error.set(formatError(e));
    }
  }

  async commitAcceptOffer(): Promise<void> {
    const authorization = this.acceptAuthorization();
    if (!authorization) {
      this.error.set('Authorize acceptance with the vault wallet before submitting the signed bundle.');
      this.acceptStatus.set('error');
      return;
    }
    this.error.set(null);
    this.acceptStatus.set('committing');
    try {
      const result = await this.acceptOfferLifecycle.commitAuthorizedAcceptOffer(authorization);
      this.acceptResult.set(result);
      this.acceptStatus.set('confirmed');
    } catch (e) {
      this.acceptStatus.set('error');
      this.error.set(formatError(e));
    }
  }

  private hasAcceptOfferProof(vaultLauncherId: string): boolean {
    try {
      this.proofService.requireProofParams(vaultLauncherId);
      return true;
    } catch {
      return false;
    }
  }

  private requireOffer() {
    const offer = this.offer();
    if (!offer) {
      throw new Error('Offer is not available.');
    }
    return offer;
  }

  private acceptOfferAuthorizationArgs(): VaultAcceptOfferAuthorizationArgs {
    const offer = this.requireOffer();
    const session = this.session.session();
    const vault = this.session.vault();
    const vaultLauncherId = vault?.vault_launcher_id ?? session?.vaultLauncherId ?? null;
    const vaultCoinId = vault?.current_coin_id ?? null;
    const ownerPubkey = vault?.owner_pubkey || session?.compressedPubkey || '';
    const authTypeLabel = vault?.auth_type ?? session?.authType ?? null;
    const authType = authTypeFromLabel(authTypeLabel);
    const poolLauncherId = resolveProtocolCoordinate({
      coordinateName: 'pool launcher id',
      pinned: protocolCoordinateFromEnvironment('poolLauncherId'),
      candidate: offer.artifact?.poolLauncherId,
      candidateLabel: 'offer artifact',
      errorPrefix: 'Offer acceptance',
    });
    const poolInnerPuzzleHash = resolveProtocolCoordinate({
      coordinateName: 'pool inner puzzle hash',
      pinned: protocolCoordinateFromEnvironment('poolInnerPuzzleHash'),
      candidate: offer.artifact?.poolInnerPuzzleHash,
      candidateLabel: 'offer artifact',
      errorPrefix: 'Offer acceptance',
    });
    const bridgePolicyHash = resolveProtocolCoordinate({
      coordinateName: 'bridge policy hash',
      pinned: protocolCoordinateFromEnvironment('bridgePolicyHash'),
      candidate: offer.artifact?.bridgePolicyHash,
      candidateLabel: 'offer artifact',
      errorPrefix: 'Offer acceptance',
    });
    const membersMerkleRoot = offer.artifact?.membersMerkleRoot ?? undefined;
    const missing: string[] = [];

    if (!vaultLauncherId) missing.push('vault launcher id');
    if (!vaultCoinId) missing.push('current vault coin id');
    if (!ownerPubkey) missing.push('owner public key');
    if (authType === null) missing.push('vault auth type');
    if (!poolLauncherId) missing.push('pool launcher id');
    if (!poolInnerPuzzleHash) missing.push('pool inner puzzle hash');

    if (missing.length) {
      throw new Error(
        `Offer acceptance is missing local acceptance context: ${missing.join(', ')}. ` +
        'Refresh the vault and use an admin/API offer artifact that includes the acceptance coordinates.',
      );
    }
    if (authType !== AUTH_TYPE_BLS) {
      throw new Error(
        `Offer acceptance currently supports BLS vault authorization only; this vault uses ${authTypeLabel ?? 'unknown auth'}.`,
      );
    }

    return {
      vaultLauncherId: vaultLauncherId!,
      vaultCoinId: vaultCoinId!,
      ownerPubkey,
      authType,
      membersMerkleRoot,
      poolLauncherId,
      bridgePolicyHash,
      offer,
      poolInnerPuzzleHash: poolInnerPuzzleHash!,
      currentTimestamp: this.context().currentTimestamp,
    };
  }
}

type AcceptOfferStatus = 'idle' | 'authorizing' | 'authorized' | 'committing' | 'confirmed' | 'error';

type OfferOnboardingStepKey = 'wallet' | 'vault' | 'zkpassport' | 'eligibility' | 'accept';
type OfferOnboardingStepStatus = 'done' | 'current' | 'pending' | 'blocked';

interface OfferOnboardingStep {
  key: OfferOnboardingStepKey;
  label: string;
  notation: string;
  status: OfferOnboardingStepStatus;
}

function buildOnboardingSteps(
  eligibility: OfferEligibility,
  acceptStatus: AcceptOfferStatus,
): OfferOnboardingStep[] {
  const state = eligibility.state;
  const connected = state !== 'NM:UNCONNECTED';
  const hasVault =
    connected &&
    state !== 'NM:NO_VAULT' &&
    state !== 'NM:VAULT_PENDING';
  const vaultPending = state === 'NM:VAULT_PENDING';
  const zkConfirmed =
    hasVault &&
    state !== 'NM:ZK_REQUIRED';
  const actionable =
    state === 'EM:ELIGIBLE' ||
    state === 'EM:CHAIN_STALE' ||
    state === 'EM:NOT_ELIGIBLE';
  const acceptConfirmed = acceptStatus === 'confirmed';
  const acceptSubmitting = acceptStatus === 'committing';
  const acceptAuthorized = acceptStatus === 'authorized';
  const acceptActive =
    eligibility.canAccept &&
    (acceptStatus === 'idle' ||
      acceptStatus === 'authorizing' ||
      acceptStatus === 'authorized' ||
      acceptStatus === 'error');

  return [
    {
      key: 'wallet',
      label: 'Connect wallet',
      notation: connected ? 'NM:WALLET_CONNECTED' : 'NM:UNCONNECTED',
      status: stepStatus(state === 'NM:UNCONNECTED', connected, false),
    },
    {
      key: 'vault',
      label: 'Create or load vault',
      notation: vaultPending ? 'NM:VAULT_PENDING' : hasVault ? 'NM:VAULT_READY' : 'NM:NO_VAULT',
      status: stepStatus(state === 'NM:NO_VAULT' || vaultPending, hasVault, !connected),
    },
    {
      key: 'zkpassport',
      label: 'Enroll zkPassport',
      notation: zkConfirmed ? 'EM:ZK_CONFIRMED' : 'NM:ZK_REQUIRED',
      status: stepStatus(state === 'NM:ZK_REQUIRED', zkConfirmed, !hasVault),
    },
    {
      key: 'eligibility',
      label: 'Confirm eligibility',
      notation: eligibility.canAccept ? 'EM:ELIGIBLE' : state,
      status: stepStatus(actionable && !eligibility.canAccept, eligibility.canAccept, !zkConfirmed),
    },
    {
      key: 'accept',
      label: 'Accept offer',
      notation: acceptNotation(eligibility, acceptStatus),
      status: acceptConfirmed
        ? 'done'
        : acceptSubmitting || acceptAuthorized || acceptActive
          ? 'current'
          : 'pending',
    },
  ];
}

function acceptNotation(
  eligibility: OfferEligibility,
  acceptStatus: AcceptOfferStatus,
): string {
  if (acceptStatus === 'confirmed') {
    return 'EM:ACCEPT_CONFIRMED';
  }
  if (acceptStatus === 'committing') {
    return 'EM:ACCEPT_SUBMITTED';
  }
  if (eligibility.canAccept || acceptStatus === 'authorized' || acceptStatus === 'authorizing') {
    return 'EM:ACCEPT_AUTH_REQUIRED';
  }
  return 'EM:ACCEPT_PENDING';
}

function stepStatus(
  current: boolean,
  done: boolean,
  blocked: boolean,
): OfferOnboardingStepStatus {
  if (done) return 'done';
  if (current) return 'current';
  if (blocked) return 'blocked';
  return 'pending';
}

function authTypeFromLabel(label: string | null): number | null {
  switch (label) {
    case 'chia_bls':
      return AUTH_TYPE_BLS;
    case 'evm':
      return AUTH_TYPE_SECP256K1;
    case 'passkey':
      return AUTH_TYPE_SECP256R1;
    default:
      return null;
  }
}
