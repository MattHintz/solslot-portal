import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import { MintProposalResponse } from '../../../services/admin-api.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { Eip712LeafHashService } from '../../../services/eip712-leaf-hash.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { MintDraftStorageService } from '../../../services/mint-draft-storage.service';
import { MintProposalApiService } from '../../../services/mint-proposal-api.service';
import {
  MintProposalV2PublishRunnerService,
  PublishRunResult,
} from '../../../services/mint-proposal-v2/mint-proposal-v2-publish-runner.service';
import {
  ExecuteMintResult,
  MintProposalV2ExecuteRunnerService,
} from '../../../services/mint-proposal-v2/mint-proposal-v2-execute-runner.service';
import {
  MintProposalChainEvidence,
  MintProposalChainStateService,
} from '../../../services/mint-proposal-v2/mint-proposal-chain-state.service';
import {
  MintProposalLifecycleView,
  mintProposalLifecycleView,
} from '../../../services/mint-lifecycle-view';
import {
  AssemblePublishArgsResult,
  PublishMintArgsAssemblerService,
} from '../../../services/mint-proposal-v2/publish-mint-args-assembler.service';
import { MintPublishService } from '../../../services/mint-proposal-v2/mint-publish.service';
import { PropertyRegistryRegistrationMaterialService } from '../../../services/mint-proposal-v2/property-registry-registration-material.service';
import { environment } from '../../../../environments/environment';
import { formatError } from '../../../utils/format-error';
import { assetClassToCode, canonicalPropertyIdHash } from '../../../utils/mint-property-id';

const ZERO_PROPERTY_REGISTRY_PUZZLE_HASH = '0x' + '0'.repeat(64);

/**
 * Detailed view of a single mint proposal.
 *
 * Read-only mirror of every column in the SQLite row, organised into the
 * same four groups the backend uses (operator metadata, computed hashes,
 * on-chain ids, timestamps).  The only mutating action available today
 * is **Cancel** — DRAFT-only, owner-only, server-enforced.
 *
 * Publish and execute are assembled client-side and forwarded through the
 * publish-only API relay.
 */
@Component({
  selector: 'pp-admin-mint-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, AdminWorkspaceNavComponent],
  template: `
    <solslot-admin-workspace-nav />
    <section class="container-p pt-12 pb-24 max-w-4xl">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <a routerLink="/admin/mint" class="mono text-xs text-text-muted hover:text-brand">
            &larr; Back to mint proposals
          </a>
          <h1 class="mt-2 font-display text-3xl md:text-4xl truncate">
            @if (proposal(); as p) {
              {{ p.property_id }}
            } @else {
              Mint proposal
            }
          </h1>
          <div class="mono text-xs text-text-muted mt-1 truncate">
            {{ proposalId() }}
          </div>
        </div>

        @if (proposal(); as p) {
          <span class="state-pill" [attr.data-state]="p.state">{{ p.state }}</span>
        }
      </header>

      <p class="ux-caption">Review the property terms and the next required action below. Publishing opens committee voting; minting happens only after the proposal passes and its transaction is confirmed.</p>
      @if (loading()) {
        <div class="mt-8 mono text-sm text-text-muted">Loading proposal&hellip;</div>
      } @else if (loadError()) {
        <div
          class="mt-8 rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300"
        >
          <div class="font-display text-base mb-1">Couldn't load proposal.</div>
          <div class="mono text-xs">{{ loadError() }}</div>
          <button class="btn btn--ghost mt-3" type="button" (click)="reload()">Retry</button>
        </div>
      } @else if (proposal(); as p) {
        <div class="mt-8 grid gap-6">
          @if (lifecycle(); as l) {
            <section class="card grid gap-4">
              <header class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span class="form-label">Current step</span>
                  <h2 class="font-display text-2xl">What happens next</h2>
                </div>
                <span class="notation-pill">{{ l.notation }}</span>
              </header>
              <div class="grid gap-3 md:grid-cols-2">
                <div>
                  <div class="form-label">Next action</div>
                  <div class="text-sm">{{ l.requiredAction }}</div>
                </div>
                <div>
                  <div class="form-label">Expected result</div>
                  <div class="text-sm text-text-muted">{{ l.outcome }}</div>
                </div>
              </div>
              <details class="technical-details">
                <summary>Technical evidence</summary>
                <dl class="grid gap-2 text-xs mono sm:grid-cols-2">
                  <div>
                    <dt class="text-text-muted">Proposal hash</dt>
                    <dd class="break-all">{{ l.diagnostics.proposalHash ?? '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-text-muted">SmartDeed puzzle</dt>
                    <dd class="break-all">{{ l.diagnostics.deedFullPuzhash ?? '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-text-muted">SmartDeed launcher</dt>
                    <dd class="break-all">{{ l.diagnostics.deedLauncherId ?? '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-text-muted">Offer record</dt>
                    <dd class="break-all">{{ l.diagnostics.offerArtifactId ?? '—' }}</dd>
                  </div>
                </dl>
              </details>
            </section>
          }

          <section class="card grid gap-4">
            <h2 class="font-display text-2xl">Property & mint terms</h2>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <div class="form-label">Asset class</div>
                <div class="mono">{{ p.asset_class }}</div>
              </div>
              <div>
                <div class="form-label">Jurisdiction</div>
                <div class="mono">{{ p.jurisdiction }}</div>
              </div>
              <div>
                <div class="form-label">Par value</div>
                <div class="mono">{{ formatPar(p.par_value) }}</div>
              </div>
              <div>
                <div class="form-label">Royalty</div>
                <div class="mono">{{ p.royalty_bps / 100 }}%</div>
              </div>
            </div>
            <details class="technical-details">
              <summary>Signing and treasury evidence</summary>
              <dl class="grid gap-2 text-xs mono">
                <div><dt>Treasury puzzle hash</dt><dd class="break-all">{{ p.royalty_puzhash }}</dd></div>
                <div><dt>Owner public key</dt><dd class="break-all">{{ p.owner_pubkey }}</dd></div>
              </dl>
            </details>
          </section>

          <section class="card grid gap-3">
            <h2 class="font-display text-2xl">Governance</h2>
            <div class="grid gap-3 sm:grid-cols-3">
              <div>
                <div class="form-label">Vote tally</div>
                <div class="mono">{{ p.vote_tally }}</div>
              </div>
              <div>
                <div class="form-label">Quorum required</div>
                <div class="mono">{{ p.quorum_required }}</div>
              </div>
              <div>
                <div class="form-label">Deadline</div>
                <div class="mono">{{ p.deadline ?? '—' }}</div>
              </div>
            </div>
          </section>

          <details class="card technical-archive">
            <summary>Computed protocol commitments</summary>
            <dl class="grid gap-2 text-xs mono">
              <div>
                <dt class="text-text-muted">smart_deed_inner_puzhash</dt>
                <dd class="break-all">{{ p.computed.smart_deed_inner_puzhash ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">eve_inner_puzhash</dt>
                <dd class="break-all">{{ p.computed.eve_inner_puzhash ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">deed_full_puzhash</dt>
                <dd class="break-all">{{ p.computed.deed_full_puzhash ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">proposal_hash</dt>
                <dd class="break-all">{{ p.computed.proposal_hash ?? '—' }}</dd>
              </div>
            </dl>
          </details>

          <details class="card technical-archive">
            <summary>On-chain identifiers</summary>
            <dl class="grid gap-2 text-xs mono">
              <div>
                <dt class="text-text-muted">proposal_tracker_coin_id</dt>
                <dd class="break-all">{{ p.on_chain.proposal_tracker_coin_id ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">sgt_lock_coin_id</dt>
                <dd class="break-all">{{ p.on_chain.sgt_lock_coin_id ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">deed_launcher_id</dt>
                <dd class="break-all">{{ p.on_chain.deed_launcher_id ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">published_bundle_id</dt>
                <dd class="break-all">{{ p.on_chain.published_bundle_id ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">executed_bundle_id</dt>
                <dd class="break-all">{{ p.on_chain.executed_bundle_id ?? '—' }}</dd>
              </div>
            </dl>
          </details>

          <section class="card grid gap-3">
            <header class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-display text-2xl">Chain evidence</h2>
              @if (chainEvidence(); as e) {
                <span class="chain-pill" [attr.data-kind]="chainEvidenceKind(e)">
                  {{ chainEvidenceTitle(e) }}
                </span>
              }
            </header>
            @if (chainEvidence(); as e) {
              <div class="rounded-card border p-3 text-xs" [ngClass]="chainEvidenceClass(e)">
                <div class="mono">{{ chainEvidenceDetail(e) }}</div>
                @if (chainEvidenceExpectedPuzzleHash(e); as expected) {
                  <dl class="mt-3 grid gap-2 mono text-[0.68rem]">
                    <div>
                      <dt class="text-text-muted">expected_full_puzzle_hash</dt>
                      <dd class="break-all">{{ expected }}</dd>
                    </div>
                    @if (chainEvidenceLivePuzzleHash(e); as live) {
                      <div>
                        <dt class="text-text-muted">live_puzzle_hash</dt>
                        <dd class="break-all">{{ live }}</dd>
                      </div>
                    }
                  </dl>
                }
              </div>
            } @else {
              <div
                class="rounded-card border border-white/10 bg-white/[0.03] p-3 text-xs text-text-muted"
              >
                <div class="mono">Not checked yet.</div>
              </div>
            }
            <div class="flex justify-end">
              <button
                class="btn btn--ghost"
                type="button"
                (click)="refreshChainEvidence()"
                [disabled]="chainEvidence()?.kind === 'checking'"
              >
                @if (chainEvidence()?.kind === 'checking') {
                  Checking&hellip;
                } @else {
                  Refresh chain evidence
                }
              </button>
            </div>
          </section>

          <section class="card grid gap-3">
            <h2 class="font-display text-2xl">Timestamps</h2>
            <dl class="grid gap-2 text-xs mono sm:grid-cols-2">
              <div>
                <dt class="text-text-muted">created_at</dt>
                <dd>{{ formatTime(p.timestamps.created_at) }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">published_at</dt>
                <dd>{{ formatTime(p.timestamps.published_at) }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">executed_at</dt>
                <dd>{{ formatTime(p.timestamps.executed_at) }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">minted_at</dt>
                <dd>{{ formatTime(p.timestamps.minted_at) }}</dd>
              </div>
            </dl>
          </section>

          @if (p.off_chain_metadata) {
            <details class="card technical-archive">
              <summary>Legacy metadata record</summary>
              <pre class="mono text-xs whitespace-pre-wrap break-all">{{
                formatMetadata(p.off_chain_metadata)
              }}</pre>
            </details>
          }

          @if (canPublish()) {
            <section class="card grid gap-3">
              <header class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span class="form-label">Owner action</span>
                  <h2 class="font-display text-2xl">Submit for governance</h2>
                </div>
                <span class="notation-pill">No customer funds move</span>
              </header>
              <p class="text-sm text-text-muted">
                Your wallet confirms the property and the exact SmartDeed terms. The protocol
                then opens the standard SGT vote. This does not publish the SmartDeed by itself.
              </p>
              <dl class="decision-receipt">
                <div><dt>Purpose</dt><dd>Open the governed SmartDeed proposal</dd></div>
                <div><dt>Network</dt><dd>{{ networkLabel }}</dd></div>
                <div><dt>Financial effect</dt><dd>No customer payment or administrator transfer</dd></div>
                <div><dt>Next safeguard</dt><dd>SGT approval is required before execution</dd></div>
              </dl>

              <div class="flex flex-wrap gap-3 justify-end">
                <button
                  class="btn btn--primary"
                  type="button"
                  (click)="reviewAndPublish()"
                  [disabled]="publishBusy() || ownerMemberHashBusy() || !!canonicalPreview()?.error"
                >
                  @if (publishBusy() || ownerMemberHashBusy()) {
                    Preparing secure request&hellip;
                  } @else {
                    Review in wallet
                  }
                </button>
              </div>

              @if (previewError(); as err) {
                <div
                  class="rounded-card border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300"
                >
                  {{ err }}
                </div>
              }

              @if (publishResult(); as pr) {
                <div class="rounded-card border p-3 text-xs" [ngClass]="publishResultClass(pr)">
                  <div class="font-display text-sm mb-2">
                    {{ publishResultTitle(pr) }}
                  </div>
                  <span>{{ publishResultHelp(pr) }}</span>
                  <details class="technical-details">
                    <summary>Technical receipt</summary>
                    <pre class="mono text-[0.7rem] whitespace-pre-wrap break-all">{{ formatArgs(pr) }}</pre>
                  </details>
                </div>
              }
            </section>
          }

          <section class="flex flex-wrap gap-3 justify-end">
            @if (canCancel()) {
              <button
                type="button"
                class="btn btn--ghost"
                (click)="cancel()"
                [disabled]="busy() || publishBusy() || executeBusy()"
              >
                @if (busy()) {
                  Canceling&hellip;
                } @else {
                  Cancel DRAFT
                }
              </button>
            }
            @if (canExecute()) {
              <div class="w-full rounded-card border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm text-cyan-100">
                <div class="font-display text-base mb-1">Complete the approved SmartDeed</div>
                <p>
                  Continue only after the governance result above shows approval. Your wallet signs
                  this SmartDeed action only; it does not authorize a payment or wallet transfer.
                </p>
                <div class="mt-3 flex justify-end">
                  <button
                    class="btn btn--primary"
                    type="button"
                    (click)="execute()"
                    [disabled]="executeBusy()"
                  >
                    @if (executeBusy()) {
                      Confirming&hellip;
                    } @else {
                      Review final action
                    }
                  </button>
                </div>
              </div>
            }
          </section>

          @if (executeResult(); as er) {
            <div class="rounded-card border p-3 text-xs" [ngClass]="executeResultClass(er)">
              <div class="font-display text-sm mb-2">
                {{ executeResultTitle(er) }}
              </div>
              <pre class="mono text-[0.7rem] whitespace-pre-wrap break-all">{{
                formatArgs(er)
              }}</pre>
            </div>
          }

          @if (actionError()) {
            <div
              class="rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300"
            >
              <div class="font-display text-base mb-1">Action failed.</div>
              <div class="mono text-xs">{{ actionError() }}</div>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      .form-label {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--muted);
        margin-bottom: 0.35rem;
      }

      .decision-receipt {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1px;
        margin: 0;
        border: 1px solid var(--border);
        background: var(--border);
      }
      .decision-receipt div {
        min-width: 0;
        padding: 0.85rem;
        background: var(--bg-2);
      }
      .decision-receipt dt {
        color: var(--muted);
        font: 0.65rem var(--font-mono);
        text-transform: uppercase;
      }
      .decision-receipt dd {
        margin: 0.3rem 0 0;
        font-size: 0.78rem;
      }
      .technical-details {
        padding-top: 0.75rem;
        border-top: 1px solid var(--border);
      }
      .technical-details summary {
        color: var(--muted);
        font: 0.68rem var(--font-mono);
        cursor: pointer;
      }
      .technical-details dl,
      .technical-details pre {
        margin-top: 0.75rem;
      }
      .technical-archive > summary {
        color: var(--muted);
        font: 0.72rem var(--font-mono);
        cursor: pointer;
      }
      .technical-archive[open] > summary {
        margin-bottom: 1rem;
        color: var(--text);
      }

      .state-pill {
        font-family: var(--font-mono);
        font-size: 0.72rem;
        letter-spacing: 0.2em;
        padding: 0.3rem 0.7rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
        align-self: flex-start;
      }
      .state-pill[data-state='PROPOSED'],
      .state-pill[data-state='VOTING'] {
        color: #2ce7ff;
        background: rgba(44, 231, 255, 0.12);
      }
      .state-pill[data-state='PASSED'],
      .state-pill[data-state='EXECUTED'] {
        color: #7cffb2;
        background: rgba(124, 255, 178, 0.14);
      }
      .state-pill[data-state='MINTED'] {
        color: #04110d;
        background: rgba(124, 255, 178, 0.85);
      }
      .state-pill[data-state='FAILED'],
      .state-pill[data-state='CANCELED'] {
        color: rgba(255, 120, 120, 0.9);
        background: rgba(255, 120, 120, 0.1);
      }

      .notation-pill {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        letter-spacing: 0.18em;
        padding: 0.24rem 0.6rem;
        border-radius: 999px;
        color: #04110d;
        background: rgba(124, 255, 178, 0.85);
      }

      .chain-pill {
        font-family: var(--font-mono);
        font-size: 0.66rem;
        letter-spacing: 0.18em;
        padding: 0.22rem 0.6rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
      }

      .chain-pill[data-kind='confirmed'] {
        color: #04110d;
        background: rgba(124, 255, 178, 0.85);
      }

      .chain-pill[data-kind='checking'],
      .chain-pill[data-kind='pending'] {
        color: #2ce7ff;
        background: rgba(44, 231, 255, 0.12);
      }

      .chain-pill[data-kind='drift'],
      .chain-pill[data-kind='error'] {
        color: rgba(255, 120, 120, 0.95);
        background: rgba(255, 120, 120, 0.12);
      }
      @media (max-width: 620px) {
        .decision-receipt {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class MintDetailComponent {
  private readonly drafts = inject(MintDraftStorageService);
  private readonly proposalApi = inject(MintProposalApiService);
  private readonly session = inject(AdminSessionService);
  private readonly assembler = inject(PublishMintArgsAssemblerService);
  private readonly publishRunner = inject(MintProposalV2PublishRunnerService);
  private readonly executeRunner = inject(MintProposalV2ExecuteRunnerService);
  private readonly chainState = inject(MintProposalChainStateService);
  private readonly registryMaterial = inject(PropertyRegistryRegistrationMaterialService);
  private readonly evmWallet = inject(EvmWalletService);
  private readonly eip712Leaf = inject(Eip712LeafHashService);
  private readonly route = inject(ActivatedRoute);

  readonly proposalId = signal<string>(this.route.snapshot.paramMap.get('id') ?? '');
  readonly networkLabel = environment.chiaNetwork;
  readonly proposal = signal<MintProposalResponse | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly chainEvidence = signal<ChainEvidenceView | null>(null);
  readonly sharedRecord = signal(false);

  readonly lifecycle = computed<MintProposalLifecycleView | null>(() => {
    const p = this.proposal();
    return p ? mintProposalLifecycleView(p) : null;
  });

  readonly isOwner = computed(() => {
    const p = this.proposal();
    const sub = this.session.subject();
    return !!p && !!sub && p.owner_pubkey.toLowerCase() === sub.toLowerCase();
  });

  /** Mirrors the server's cancel-eligibility rule: DRAFT + owner-only. */
  readonly canCancel = computed(() => this.proposal()?.state === 'DRAFT' && this.isOwner());

  /**
   * Same gating rule as {@link canCancel}: only the DRAFT's owner can
   * publish.  Other states are server-enforced no-ops, but we still
   * suppress the UI to avoid implying the action is available.
   */
  readonly canPublish = computed(() => this.proposal()?.state === 'DRAFT' && this.isOwner());

  readonly canExecute = computed(() => {
    const state = this.proposal()?.state;
    return state === 'PROPOSED' || state === 'VOTING' || state === 'PASSED';
  });

  // ── Publish-panel state ───────────────────────────────────────────
  readonly ownerMemberHashInput = signal('');
  readonly ownerMemberAddress = signal<string | null>(null);
  readonly ownerMemberPubkey = signal<string | null>(null);
  readonly ownerMemberHashBusy = signal(false);
  readonly propertyRegistryPuzzleHash = signal<string | null>(null);
  readonly publishBusy = signal(false);
  readonly firstVoteAmountInput = signal('');
  readonly votingWindowSecondsInput = signal('');

  readonly previewResult = signal<AssemblePublishArgsResult | null>(null);
  readonly previewError = signal<string | null>(null);
  readonly publishResult = signal<PublishRunResult | null>(null);
  readonly executeBusy = signal(false);
  readonly executeResult = signal<ExecuteMintResult | null>(null);

  readonly canonicalPreview = computed<CanonicalPublishPreview | null>(() => {
    const p = this.proposal();
    if (!p) return null;
    try {
      return {
        propertyIdCanon: canonicalPropertyIdHash(p.property_id),
        parValueMojos: String(p.par_value),
        assetClassCode: String(assetClassToCode(p.asset_class)),
        propertyRegistryPuzzleHash: this.previewPropertyRegistryPuzzleHash(),
        error: null,
      };
    } catch (e) {
      return {
        propertyIdCanon: '—',
        parValueMojos: String(p.par_value),
        assetClassCode: '—',
        propertyRegistryPuzzleHash: this.previewPropertyRegistryPuzzleHash(),
        error: formatError(e),
      };
    }
  });

  readonly defaultFirstVote = () => environment.solslotProtocol.governanceMinProposalStake;
  readonly defaultVotingWindow = () => environment.solslotProtocol.governanceVotingWindowSeconds;

  constructor() {
    void this.reload();
  }

  /** Load the shared API record, with legacy localStorage as an offline fallback. */
  async reload(): Promise<void> {
    const id = this.proposalId();
    if (!id) {
      this.loadError.set('Missing proposal id in route.');
      return;
    }
    if (!this.session.isAuthenticated()) {
      this.loadError.set('Not authenticated.');
      return;
    }
    this.loadError.set(null);
    this.loading.set(true);
    try {
      const local = this.drafts.get(id);
      let p: MintProposalResponse | null = null;
      let apiError: unknown = null;
      try {
        const shared = await this.proposalApi.get(id);
        p =
          !shared.off_chain_metadata && local?.off_chain_metadata
            ? { ...shared, off_chain_metadata: local.off_chain_metadata }
            : shared;
        this.sharedRecord.set(true);
      } catch (e) {
        apiError = e;
        p = local;
        this.sharedRecord.set(false);
      }
      if (!p) {
        this.loadError.set(
          `Proposal ${id} was not found in the shared workspace or this browser. ` +
            formatError(apiError),
        );
        return;
      }
      this.proposal.set(p);
      void this.refreshChainEvidence();
    } catch (e) {
      this.loadError.set(formatError(e));
    } finally {
      this.loading.set(false);
    }
  }

  async cancel(): Promise<void> {
    const id = this.proposalId();
    if (!id || !this.session.isAuthenticated()) return;
    if (!confirm('Cancel this DRAFT mint proposal?  This is permanent.')) return;
    this.actionError.set(null);
    this.busy.set(true);
    try {
      const updated = this.sharedRecord()
        ? await this.proposalApi.cancel(id)
        : this.drafts.cancel(id);
      if (updated) this.proposal.set(updated);
    } catch (e) {
      this.actionError.set(formatError(e));
    } finally {
      this.busy.set(false);
    }
  }

  formatPar(parMojos: number): string {
    const dollars = parMojos / 100;
    return `\$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /** Render a unix-seconds timestamp as a UTC ISO string, or "—" if null. */
  formatTime(ts: number | null): string {
    if (!ts) return '—';
    return new Date(ts * 1_000).toISOString().replace('T', ' ').replace('.000Z', 'Z');
  }

  formatMetadata(meta: Record<string, unknown>): string {
    try {
      return JSON.stringify(meta, null, 2);
    } catch {
      return String(meta);
    }
  }

  /**
   * JSON-stringify a {@link PublishMintArgs} for display.  BigInt
   * values aren't JSON-native, so we coerce them via a replacer; the
   * value strings stay decimal (matching the runner's wire format).
   */
  formatArgs(args: unknown): string {
    return JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  }

  async deriveOwnerMemberHash(): Promise<void> {
    this.previewError.set(null);
    this.actionError.set(null);
    this.ownerMemberHashBusy.set(true);
    try {
      const { pubkey, address } = await this.evmWallet.recoverFirstAdminPubkey();
      const leaf = this.eip712Leaf.compute(pubkey, environment.chiaNetwork);
      this.ownerMemberHashInput.set(leaf.leaf_hash);
      this.ownerMemberAddress.set(address);
      this.ownerMemberPubkey.set(pubkey);
      this.previewResult.set(null);
    } catch (e) {
      this.previewError.set(`Could not derive ownerMemberHash: ${formatError(e)}`);
    } finally {
      this.ownerMemberHashBusy.set(false);
    }
  }

  async reviewAndPublish(): Promise<void> {
    if (!this.ownerMemberHashInput()) {
      await this.deriveOwnerMemberHash();
    }
    if (!this.ownerMemberHashInput() || this.previewError()) return;
    await this.publish();
  }

  /** Call the pure assembler and surface the discriminated result. */
  async preview(): Promise<void> {
    await this.assembleCurrentPublishArgs();
  }

  async publish(): Promise<void> {
    const assembled = await this.assembleCurrentPublishArgs();
    if (!assembled || assembled.kind !== 'ok') return;

    this.actionError.set(null);
    this.publishResult.set(null);
    this.publishBusy.set(true);
    try {
      const result = await this.publishRunner.publishMint(assembled.args);
      this.publishResult.set(result);
      if (result.kind === 'submitted' && result.apiResponse.pushed) {
        const updated = this.drafts.markPublished(this.proposalId(), {
          smartDeedInnerPuzhash: result.artifacts.smartDeedInnerPuzhash,
          eveInnerPuzhash: result.artifacts.eveInnerPuzhash,
          deedFullPuzhash: result.artifacts.deedFullPuzhash,
          proposalHash: result.artifacts.proposalHash,
          proposalTrackerCoinId: result.artifacts.proposalSingletonLauncherId,
          proposalSingletonLauncherId: result.artifacts.proposalSingletonLauncherId,
          sgtLockCoinId: result.sgtLockCoinId,
          deedLauncherId: result.artifacts.deedLauncherId,
          publishedBundleId: result.apiResponse.spendBundleId,
          propertyRegistryPuzzleHash: assembled.args.propertyRegistryPuzzleHash,
          propertyRegistryCoinId: result.propertyRegistryCoinId,
          ownerMemberHash: assembled.args.ownerMemberHash,
          govMemberHash: assembled.args.govMemberHash,
          proposalDataHash: result.artifacts.proposalDataHash,
          deadline: Number(result.votingDeadline),
        });
        if (updated) {
          this.proposal.set(updated);
        }
        await this.reload();
      }
    } catch (e) {
      this.actionError.set(formatError(e));
    } finally {
      this.publishBusy.set(false);
    }
  }

  publishResultTitle(result: PublishRunResult): string {
    if (result.kind === 'submitted') {
      return result.apiResponse.pushed
        ? 'Publish submitted.'
        : 'Publish returned a chain rejection.';
    }
    return `Publish stopped: ${result.kind}.`;
  }

  publishResultHelp(result: PublishRunResult): string {
    if (result.kind === 'submitted' && result.apiResponse.pushed) {
      return 'The proposal is in the network. Solslot will continue tracking governance and confirmation.';
    }
    if (result.kind === 'submitted') {
      return 'The network did not accept the request. No proposal was opened.';
    }
    return 'The safety checks stopped this request before submission.';
  }

  publishResultClass(result: PublishRunResult): string {
    if (result.kind === 'submitted' && result.apiResponse.pushed) {
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
    }
    if (result.kind === 'submitted') {
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    }
    return 'border-red-500/40 bg-red-500/10 text-red-300';
  }

  async execute(): Promise<void> {
    const draft = this.proposal();
    if (!draft) return;

    this.actionError.set(null);
    this.executeResult.set(null);
    this.executeBusy.set(true);
    try {
      const result = await this.executeRunner.executeMint(draft);
      this.executeResult.set(result);
      if (result.kind === 'submitted' && result.apiResponse.pushed) {
        const updated = this.drafts.markExecuted(this.proposalId(), {
          executedBundleId: result.apiResponse.spendBundleId,
        });
        if (updated) this.proposal.set(updated);
        await this.reload();
      }
    } catch (e) {
      this.actionError.set(formatError(e));
    } finally {
      this.executeBusy.set(false);
    }
  }

  executeResultTitle(result: ExecuteMintResult): string {
    if (result.kind === 'submitted') {
      return result.apiResponse.pushed
        ? 'Execute submitted.'
        : 'Execute returned a chain rejection.';
    }
    if (result.kind === 'kos-signer-unavailable') {
      return 'MINT co-signer unavailable. The bundle was not submitted.';
    }
    return `Execute stopped: ${result.kind}.`;
  }

  executeResultClass(result: ExecuteMintResult): string {
    if (result.kind === 'submitted' && result.apiResponse.pushed) {
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
    }
    if (result.kind === 'submitted') {
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    }
    if (result.kind === 'kos-signer-unavailable') {
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    }
    return 'border-red-500/40 bg-red-500/10 text-red-300';
  }

  async refreshChainEvidence(): Promise<void> {
    const p = this.proposal();
    if (!p) return;
    this.chainEvidence.set({ kind: 'checking' });
    try {
      this.chainEvidence.set(await this.chainState.check(p));
    } catch (e) {
      this.chainEvidence.set({ kind: 'error', message: formatError(e) });
    }
  }

  chainEvidenceKind(e: ChainEvidenceView): string {
    switch (e.kind) {
      case 'confirmed-draft':
      case 'confirmed-transition':
        return (
          this.trackerEvidenceKind(e) ??
          this.propertyRegistryEvidenceKind(e) ??
          this.sgtLockEvidenceKind(e) ??
          'confirmed'
        );
      case 'unconfirmed':
      case 'checking':
        return 'pending';
      case 'mismatch':
        return 'drift';
      case 'error':
        return 'error';
      default:
        return 'local';
    }
  }

  chainEvidenceTitle(e: ChainEvidenceView): string {
    switch (e.kind) {
      case 'checking':
        return 'checking';
      case 'confirmed-draft':
        return (
          this.trackerEvidenceTitle(e) ??
          this.propertyRegistryEvidenceTitle(e) ??
          this.sgtLockEvidenceTitle(e) ??
          'confirmed'
        );
      case 'confirmed-transition':
        return (
          this.trackerEvidenceTitle(e) ??
          this.propertyRegistryEvidenceTitle(e) ??
          this.sgtLockEvidenceTitle(e) ??
          'transitioned'
        );
      case 'unconfirmed':
        return 'pending';
      case 'mismatch':
        return 'drift';
      case 'unverifiable':
        return 'unverifiable';
      case 'error':
        return 'error';
      case 'local-only':
        return 'local';
    }
  }

  chainEvidenceClass(e: ChainEvidenceView): string {
    switch (e.kind) {
      case 'confirmed-draft':
      case 'confirmed-transition':
        if (
          this.trackerEvidenceKind(e) === 'pending' ||
          this.propertyRegistryEvidenceKind(e) === 'pending' ||
          this.sgtLockEvidenceKind(e) === 'pending'
        ) {
          return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
        }
        if (
          this.trackerEvidenceKind(e) === 'drift' ||
          this.propertyRegistryEvidenceKind(e) === 'drift' ||
          this.sgtLockEvidenceKind(e) === 'drift'
        ) {
          return 'border-red-500/40 bg-red-500/10 text-red-300';
        }
        return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
      case 'mismatch':
      case 'error':
        return 'border-red-500/40 bg-red-500/10 text-red-300';
      case 'unconfirmed':
      case 'checking':
        return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
      default:
        return 'border-white/10 bg-white/[0.03] text-text-muted';
    }
  }

  chainEvidenceDetail(e: ChainEvidenceView): string {
    switch (e.kind) {
      case 'checking':
        return 'Walking the proposal singleton lineage.';
      case 'local-only':
        return 'No proposal singleton launcher id is stored yet; this record is still local-only.';
      case 'unverifiable':
        return `Launcher ${e.launcherId} is stored, but the expected eve_inner_puzhash is missing.`;
      case 'unconfirmed':
        return `Launcher ${e.launcherId} is not fully confirmed yet (${e.stage}).`;
      case 'confirmed-draft':
        return (
          `Live coin ${e.liveCoinId} matches the expected A.1 ${e.proposalPuzzleState} ` +
          `state at version ${e.stateVersion}.` +
          this.trackerEvidenceDetail(e) +
          this.propertyRegistryEvidenceDetail(e) +
          this.sgtLockEvidenceDetail(e)
        );
      case 'confirmed-transition':
        return (
          `Latest spend emitted a valid ${e.transitionCase} transition from ` +
          `${e.previousPuzzleState}-v${e.previousStateVersion} to ` +
          `${e.proposalPuzzleState}-v${e.stateVersion}.` +
          this.trackerEvidenceDetail(e) +
          this.propertyRegistryEvidenceDetail(e) +
          this.sgtLockEvidenceDetail(e)
        );
      case 'mismatch':
        return (
          `Live coin ${e.liveCoinId} does not match the stored published DRAFT-v0 ` +
          'puzzle hash. The proposal may have transitioned or the local mirror may be stale.'
        );
      case 'error':
        return `Chain check failed: ${e.message}`;
    }
  }

  chainEvidenceExpectedPuzzleHash(e: ChainEvidenceView): string | null {
    return 'expectedPuzzleHash' in e ? e.expectedPuzzleHash : null;
  }

  chainEvidenceLivePuzzleHash(e: ChainEvidenceView): string | null {
    return 'livePuzzleHash' in e ? e.livePuzzleHash : null;
  }

  private sgtLockEvidenceKind(e: ChainEvidenceView): 'pending' | 'drift' | null {
    if (!('sgtLock' in e) || !e.sgtLock) return null;
    switch (e.sgtLock.kind) {
      case 'unconfirmed':
        return 'pending';
      case 'invalid-stored-id':
        return 'drift';
      default:
        return null;
    }
  }

  private sgtLockEvidenceTitle(e: ChainEvidenceView): 'pending' | 'drift' | null {
    const kind = this.sgtLockEvidenceKind(e);
    if (kind === 'pending' || kind === 'drift') return kind;
    return null;
  }

  private sgtLockEvidenceDetail(e: ChainEvidenceView): string {
    if (!('sgtLock' in e) || !e.sgtLock) return '';
    switch (e.sgtLock.kind) {
      case 'invalid-stored-id':
        return ' Stored SGT lock coin id is malformed.';
      case 'unconfirmed':
        return ` SGT lock coin ${e.sgtLock.coinId} is not confirmed yet.`;
      case 'confirmed-unspent':
        return ` SGT lock coin ${e.sgtLock.coinId} is confirmed and unspent.`;
      case 'confirmed-spent':
        return (
          ` SGT lock coin ${e.sgtLock.coinId} confirmed at height ` +
          `${e.sgtLock.confirmedBlockIndex} and spent at height ${e.sgtLock.spentBlockIndex}.`
        );
    }
  }

  private trackerEvidenceKind(e: ChainEvidenceView): 'pending' | 'drift' | null {
    if (!('tracker' in e) || !e.tracker) return null;
    switch (e.tracker.kind) {
      case 'bound':
        return null;
      case 'not-active':
        return e.tracker.trackerState === 'IDLE' ? 'drift' : 'pending';
      case 'read-failed':
        return 'pending';
      default:
        return 'drift';
    }
  }

  private trackerEvidenceTitle(e: ChainEvidenceView): 'pending' | 'drift' | null {
    const kind = this.trackerEvidenceKind(e);
    if (kind === 'pending' || kind === 'drift') return kind;
    return null;
  }

  private trackerEvidenceDetail(e: ChainEvidenceView): string {
    if (!('tracker' in e) || !e.tracker) return '';
    switch (e.tracker.kind) {
      case 'bound':
        return (
          ` Governance tracker is ${e.tracker.trackerState} for the same ` +
          `${e.tracker.billKind} proposal hash with deadline ` +
          `${e.tracker.votingDeadlineSeconds}.` +
          (e.tracker.billKind === 'MINT'
            ? ` MINT binds deed ${e.tracker.deedFullPuzzleHash}, property ` +
              `${e.tracker.propertyIdCanon}, registry ${e.tracker.propertyRegistryPuzzleHash}.`
            : '')
        );
      case 'invalid-local-proposal-hash':
        return ' Stored proposal_hash is malformed, so tracker binding cannot be verified.';
      case 'invalid-local-mint-bill':
        return ' Local publish context is missing, so the tracker MINT bill cannot be verified.';
      case 'read-failed':
        return ` Governance tracker check failed: ${e.tracker.error}.`;
      case 'not-active':
        return ` Governance tracker is ${e.tracker.trackerState}, not active for this proposal.`;
      case 'mismatch':
        if (e.tracker.reason === 'bill-kind') {
          return (
            ` Governance tracker bill mismatch: expected ${e.tracker.expectedBillKind}, ` +
            `live ${e.tracker.liveBillKind}.`
          );
        }
        if (e.tracker.reason === 'mint-bill') {
          return (
            ' Governance tracker MINT payload mismatch: expected ' +
            `${this.formatArgs(e.tracker.expectedMintBill)}, live ` +
            `${this.formatArgs(e.tracker.liveMintBill)}.`
          );
        }
        return (
          ` Governance tracker ${e.tracker.reason} mismatch: expected ` +
          `${e.tracker.expectedProposalHash} / deadline ${e.tracker.expectedDeadlineSeconds ?? 'n/a'}, ` +
          `live ${e.tracker.liveProposalHash} / deadline ${e.tracker.liveDeadlineSeconds}.`
        );
    }
  }

  private propertyRegistryEvidenceKind(e: ChainEvidenceView): 'pending' | 'drift' | null {
    if (!('propertyRegistry' in e) || !e.propertyRegistry) return null;
    switch (e.propertyRegistry.kind) {
      case 'confirmed-present':
        return null;
      case 'mismatch':
        return 'drift';
      case 'not-configured':
      case 'not-launched':
      case 'read-failed':
        return 'pending';
    }
  }

  private propertyRegistryEvidenceTitle(e: ChainEvidenceView): 'pending' | 'drift' | null {
    const kind = this.propertyRegistryEvidenceKind(e);
    if (kind === 'pending' || kind === 'drift') return kind;
    return null;
  }

  private propertyRegistryEvidenceDetail(e: ChainEvidenceView): string {
    if (!('propertyRegistry' in e) || !e.propertyRegistry) return '';
    switch (e.propertyRegistry.kind) {
      case 'confirmed-present':
        return (
          ` Property registry confirms ${e.propertyRegistry.propertyIdCanon} ` +
          `at version ${e.propertyRegistry.registryVersion}.`
        );
      case 'mismatch':
        return (
          ` Property registry does not currently include ` +
          `${e.propertyRegistry.propertyIdCanon}.`
        );
      case 'not-configured':
        return ` Property registry check is not configured: ${e.propertyRegistry.error}`;
      case 'not-launched':
        return ` Property registry is not launched: ${e.propertyRegistry.error}`;
      case 'read-failed':
        return ` Property registry check failed: ${e.propertyRegistry.error}`;
    }
  }

  private async assembleCurrentPublishArgs(): Promise<AssemblePublishArgsResult | null> {
    this.previewResult.set(null);
    this.previewError.set(null);
    const draft = this.proposal();
    if (!draft) return null;

    const ownerMemberHash = this.ownerMemberHashInput().trim();
    if (!ownerMemberHash) {
      this.previewError.set('Derive ownerMemberHash from the connected EVM wallet.');
      return null;
    }

    const firstVoteRaw = this.firstVoteAmountInput().trim();
    const windowRaw = this.votingWindowSecondsInput().trim();
    let firstVoteAmount: bigint | undefined;
    let votingWindowSeconds: bigint | undefined;
    try {
      if (firstVoteRaw) firstVoteAmount = BigInt(firstVoteRaw);
      if (windowRaw) votingWindowSeconds = BigInt(windowRaw);
    } catch {
      this.previewError.set('firstVoteAmount and votingWindowSeconds must be integers.');
      return null;
    }

    const result = this.assembler.assemble({
      draft,
      ownerMemberHash,
      protocolContext: {
        protocolDidSingletonStructHex: environment.solslotProtocol.protocolDidSingletonStructHex,
        protocolDidPuzhash: environment.solslotProtocol.protocolDidPuzhash,
        protocolDidInnerPuzhash: environment.solslotProtocol.protocolDidInnerPuzhash,
        governanceSingletonStructHex: environment.solslotProtocol.governanceSingletonStructHex,
        poolSingletonLauncherId: environment.solslotProtocol.poolLauncherId,
        poolSingletonLauncherPuzzleHash: MintPublishService.SINGLETON_LAUNCHER_HASH,
        p2PoolModHash: environment.solslotProtocol.p2PoolModHash,
        p2VaultModHash: environment.solslotProtocol.p2VaultModHash,
        propertyRegistryPuzzleHash: this.preflightPropertyRegistryPuzzleHash(),
      },
      ...(firstVoteAmount !== undefined ? { firstVoteAmount } : {}),
      ...(votingWindowSeconds !== undefined ? { votingWindowSeconds } : {}),
    });
    if (result.kind !== 'ok') {
      this.previewResult.set(result);
      return result;
    }

    const registry = await this.registryMaterial.build({
      registryLauncherId: environment.solslotProtocol.propertyRegistryLauncherId,
      registryGovPubkey: environment.solslotProtocol.propertyRegistryGovPubkey,
      propertyIdCanon: result.args.propertyIdCanon,
    });
    if (registry.kind !== 'ok') {
      this.previewResult.set(null);
      this.previewError.set(`Could not build property-registry co-spend: ${registry.error}`);
      return null;
    }

    const ok: AssemblePublishArgsResult = {
      kind: 'ok',
      args: {
        ...result.args,
        propertyRegistryPuzzleHash: registry.propertyRegistryPuzzleHash,
        propertyRegistryCoinSpend: registry.spend,
      },
    };
    this.propertyRegistryPuzzleHash.set(registry.propertyRegistryPuzzleHash);
    this.previewResult.set(ok);
    return ok;
  }

  private preflightPropertyRegistryPuzzleHash(): string {
    return (
      valid32ByteHex(this.propertyRegistryPuzzleHash()) ||
      valid32ByteHex(environment.solslotProtocol.propertyRegistryCurrentPuzzleHash) ||
      ZERO_PROPERTY_REGISTRY_PUZZLE_HASH
    );
  }

  private previewPropertyRegistryPuzzleHash(): string {
    return (
      this.propertyRegistryPuzzleHash() ||
      environment.solslotProtocol.propertyRegistryCurrentPuzzleHash ||
      '—'
    );
  }
}

interface CanonicalPublishPreview {
  propertyIdCanon: string;
  parValueMojos: string;
  assetClassCode: string;
  propertyRegistryPuzzleHash: string;
  error: string | null;
}

type ChainEvidenceView =
  MintProposalChainEvidence | { kind: 'checking' } | { kind: 'error'; message: string };

function valid32ByteHex(v: string | null | undefined): string | null {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) ? v : null;
}
