import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import {
  DecodedBill,
  GovernanceTrackerReaderService,
  TrackerStateSnapshot,
} from '../../../services/governance-tracker-reader.service';
import {
  CommitteeVoteRunnerService,
  VoteRunResult,
} from '../../../services/pgt-driver/committee-vote-runner.service';
import {
  CommitteeMintLifecycleView,
  committeeMintLifecycleView,
} from '../../../services/mint-lifecycle-view';
import { formatError } from '../../../utils/format-error';

/**
 * Public committee view — the live on-chain governance proposal (if any)
 * available for PGT-weighted voting.
 *
 * No authentication.  Per POP-CANON-013, the committee endpoints are
 * intentionally not gated by `require_admin_jwt`: any PGT holder can
 * read this state and (in the VOTE-wiring follow-up) submit a signed
 * vote bundle.  Locking this behind the admin allowlist would conflate
 * operator authority with token-holder governance.
 *
 * **Data source (Phase B2).**  This page walks the PGT-backed
 * governance tracker singleton on chain
 * ({@link environment.populisProtocol.governanceLauncherId}) via
 * {@link GovernanceTrackerReaderService}.  The tracker holds at most
 * one proposal at a time; its state machine (IDLE → PROPOSED →
 * VOTING → EXECUTE / EXPIRE → IDLE) is reconstructed by decoding each
 * spend's solution in chain order.  No API call required.
 *
 * **Vote button.**  Wired (Phase 3e).  Delegates to
 * {@link CommitteeVoteRunnerService} which discovers the voter's PGT
 * coin, assembles a CAT2-wrapped PGT lock + singleton-wrapped tracker
 * VOTE bundle via {@link PgtVoteSpendBuilderService}, asks the wallet
 * to sign via {@link ChiaWalletService.signSpendBundle}, and POSTs
 * the result to the publish-only ``/admin/committee/vote`` forwarder
 * (Brick 3.5c-3).  Vote amount is the user-input PGT mojo count;
 * LOCK is a full-coin operation so it must equal one of the voter's
 * free PGT coin amounts exactly.
 */
@Component({
  selector: 'pp-committee',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="container-p pt-12 pb-24 max-w-5xl">
      <header>
        <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
          Solslot · Committee
        </div>
        <h1 class="font-display text-4xl md:text-5xl">Governance proposal feed.</h1>
        <p class="mt-4 text-text-muted text-sm max-w-2xl">
          The SGT-backed governance tracker holds at most one open
          proposal at a time.  This page reads the tracker singleton
          directly from chain (coinset.org) — there is no API in the
          read path.  Anyone holding SGT / Committee Coin can vote.
        </p>
        <p class="mt-3 text-text-muted text-xs max-w-2xl">
          Your wallet builds and signs an SGT-VOTE spend bundle locally;
          the committee endpoint is a public, publish-only forwarder.
        </p>
      </header>

      <div class="mt-10 flex items-center gap-3 flex-wrap">
        <button class="btn btn--ghost" type="button" (click)="reload()" [disabled]="loading()">
          @if (loading()) { Refreshing&hellip; } @else { Refresh }
        </button>
        @if (lastCheckedAt(); as ts) {
          <span class="mono text-xs text-text-muted">
            Last checked {{ formatRelative(ts) }}
          </span>
        }
        <a routerLink="/admin/login" class="mono text-xs text-text-muted hover:text-brand ml-auto">
          Admin sign-in &rarr;
        </a>
      </div>

      <div class="mt-8">
        @if (error()) {
          <div class="rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            <div class="font-display text-base mb-1">Couldn't read the governance tracker.</div>
            <div class="mono text-xs">{{ error() }}</div>
          </div>
        } @else if (loading() && !snapshot()) {
          <div class="mono text-sm text-text-muted">Loading on-chain state&hellip;</div>
        } @else if (snapshot(); as snap) {
          @switch (snap.kind) {
            @case ('NOT_DEPLOYED') {
              <div class="card text-center text-text-muted">
                <div class="font-display text-2xl text-text">Governance tracker not deployed.</div>
                <p class="mt-2 max-w-md mx-auto text-sm">
                  No tracker singleton is configured for this network, or
                  the configured launcher id has not yet confirmed on chain.
                </p>
              </div>
            }
            @case ('NOT_SPENT') {
              <div class="card text-center text-text-muted">
                <div class="font-display text-2xl text-text">Tracker launcher pending.</div>
                <p class="mt-2 max-w-md mx-auto text-sm">
                  The launcher coin has confirmed but its eve singleton
                  hasn't been minted yet.  Refresh in a moment.
                </p>
              </div>
            }
            @case ('IDLE') {
              <div class="card text-center text-text-muted">
                <div class="font-display text-2xl text-text">No open proposal.</div>
                <p class="mt-2 max-w-md mx-auto text-sm">
                  The tracker is idle.  When an admin opens a proposal on
                  chain it will appear here automatically.
                </p>
                <p class="mt-3 mono text-[0.7rem]">
                  Quorum required: {{ formatPgt(snap.quorumRequired) }} SGT ·
                  Voting window: {{ Number(snap.votingWindowSeconds) }}s ·
                  Min stake: {{ formatPgt(snap.minProposalStake) }} SGT
                </p>
              </div>
            }
            @default {
              <article class="card flex flex-col gap-5">
                <div class="flex items-start justify-between gap-4 flex-wrap">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="state-pill" [attr.data-state]="snap.kind">{{ snap.kind }}</span>
                      @if (committeeLifecycle(snap); as lifecycle) {
                        <span class="notation-pill">{{ lifecycle.notation }}</span>
                      }
                      <span class="mono text-xs text-text-muted truncate">
                        proposal_hash {{ snap.proposalHash }}
                      </span>
                    </div>
                    <div class="mt-3 font-display text-2xl">
                      {{ billHeadline(snap.bill) }}
                    </div>
                    <div class="mt-1 text-xs text-text-muted">
                      {{ billSubhead(snap.bill) }}
                    </div>
                  </div>
                  <div class="flex items-end gap-2 shrink-0">
                    <label class="flex flex-col gap-1 text-xs mono text-text-muted">
                      Vote amount (SGT mojos)
                      <input
                        type="number"
                        class="input mono text-sm w-40"
                        min="1"
                        step="1"
                        [(ngModel)]="voteAmountInput"
                        [disabled]="!canVote(snap) || voting()"
                      />
                    </label>
                    <button
                      class="btn btn--primary"
                      type="button"
                      [disabled]="!canVote(snap) || voting() || !hasValidAmount()"
                      [title]="voteButtonTitle(snap)"
                      (click)="submitVote()"
                    >
                      @if (voting()) { Casting&hellip; } @else { Vote YES }
                    </button>
                  </div>
                </div>

                @if (snap.bill.kind === 'MINT') {
                  @if (committeeLifecycle(snap); as lifecycle) {
                    <div class="lifecycle-note">
                      <div>
                        <div class="form-label">Required action</div>
                        <div class="text-sm">{{ lifecycle.requiredAction }}</div>
                      </div>
                      <div>
                        <div class="form-label">Mint-to-offer path</div>
                        <div class="text-sm text-text-muted">{{ lifecycle.outcome }}</div>
                      </div>
                    </div>
                  }
                }

                @if (lastVoteResult(); as result) {
                  <div
                    class="rounded-card border p-3 text-sm"
                    [class.border-emerald-500\\/40]="voteResultOk(result)"
                    [class.bg-emerald-500\\/10]="voteResultOk(result)"
                    [class.text-emerald-300]="voteResultOk(result)"
                    [class.border-amber-500\\/40]="!voteResultOk(result)"
                    [class.bg-amber-500\\/10]="!voteResultOk(result)"
                    [class.text-amber-300]="!voteResultOk(result)"
                  >
                    <div class="font-display text-base mb-1">
                      {{ voteResultHeadline(result) }}
                    </div>
                    <div class="mono text-xs whitespace-pre-wrap">
                      {{ voteResultDetail(result) }}
                    </div>
                  </div>
                }

                <div class="max-w-xl">
                  <div class="flex items-center justify-between text-xs mono mb-1">
                    <span class="text-text-muted">Quorum progress</span>
                    <span>
                      {{ formatPgt(snap.voteTally) }} / {{ formatPgt(snap.quorumRequired) }} SGT
                      ({{ progressPct(snap) }}%)
                    </span>
                  </div>
                  <div class="quorum-bar">
                    <div class="quorum-bar__fill" [style.width.%]="progressPct(snap)"></div>
                  </div>
                </div>

                <dl class="grid gap-2 text-xs mono sm:grid-cols-2">
                  <div>
                    <dt class="text-text-muted">Voting deadline</dt>
                    <dd>{{ formatDeadline(snap.votingDeadlineSeconds) }}</dd>
                  </div>
                  <div>
                    <dt class="text-text-muted">Time remaining</dt>
                    <dd>{{ formatRemaining(snap.votingDeadlineSeconds) }}</dd>
                  </div>
                  <div>
                    <dt class="text-text-muted">Tracker spends</dt>
                    <dd>{{ snap.spendCount }}</dd>
                  </div>
                  <div>
                    <dt class="text-text-muted">Last spend block</dt>
                    <dd>{{ snap.lastSpendBlockIndex }}</dd>
                  </div>
                </dl>

                <details class="text-xs mono">
                  <summary class="cursor-pointer text-text-muted">
                    Bill payload
                  </summary>
                  <pre class="mt-2 whitespace-pre-wrap break-all">{{ billDetailJson(snap.bill) }}</pre>
                </details>
              </article>
            }
          }
        }
      </div>
    </section>
  `,
  styles: [
    `
      .state-pill {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        letter-spacing: 0.18em;
        padding: 0.18rem 0.5rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
      }
      .state-pill[data-state='OPEN'] {
        color: #2ce7ff;
        background: rgba(44, 231, 255, 0.12);
      }
      .state-pill[data-state='AWAITING_EXECUTE'] {
        color: #7cffb2;
        background: rgba(124, 255, 178, 0.12);
      }
      .state-pill[data-state='AWAITING_EXPIRE'] {
        color: #ffb27c;
        background: rgba(255, 178, 124, 0.12);
      }

      .notation-pill {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        letter-spacing: 0.18em;
        padding: 0.18rem 0.5rem;
        border-radius: 999px;
        color: #04110d;
        background: rgba(124, 255, 178, 0.85);
      }

      .lifecycle-note {
        display: grid;
        gap: 0.75rem;
        border: 1px solid rgba(124, 255, 178, 0.22);
        border-radius: 8px;
        background: rgba(124, 255, 178, 0.06);
        padding: 0.9rem;
      }

      .form-label {
        font-family: var(--font-mono);
        font-size: 0.66rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--muted);
        margin-bottom: 0.25rem;
      }

      .quorum-bar {
        position: relative;
        height: 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        overflow: hidden;
      }
      .quorum-bar__fill {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          rgba(124, 255, 178, 0.8),
          rgba(44, 231, 255, 0.7)
        );
        transition: width 0.35s ease;
        max-width: 100%;
      }
    `,
  ],
})
export class CommitteeComponent {
  private readonly tracker = inject(GovernanceTrackerReaderService);
  private readonly wallet = inject(ChiaWalletService);
  private readonly runner = inject(CommitteeVoteRunnerService);

  readonly snapshot = signal<TrackerStateSnapshot | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastCheckedAt = signal<number | null>(null);

  /** Vote-cast input (PGT mojos).  ngModel-bound so users can edit. */
  voteAmountInput = '';

  /** True while a vote is being assembled / signed / submitted. */
  readonly voting = signal(false);

  /** Last completed vote result (success or any pre-flight failure). */
  readonly lastVoteResult = signal<VoteRunResult | null>(null);

  /** Total open-state proposals (0 or 1). Convenience for templates/tests. */
  readonly openCount = computed(() => {
    const s = this.snapshot();
    if (!s) return 0;
    return s.kind === 'OPEN' || s.kind === 'AWAITING_EXECUTE' || s.kind === 'AWAITING_EXPIRE'
      ? 1
      : 0;
  });

  constructor() {
    void this.reload();
  }

  /**
   * Read the live tracker singleton state from chain.  Idempotent —
   * safe to call as often as the user clicks Refresh.  The on-chain
   * walk is shallow (≤ MAX_DEPTH proposal-tracker transitions) and
   * results are not cached locally; PGT holders should always see
   * the freshest possible state.
   */
  async reload(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const snap = await this.tracker.readCurrentState();
      this.snapshot.set(snap);
      this.lastCheckedAt.set(Date.now());
    } catch (e) {
      this.error.set(formatError(e));
      this.snapshot.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Vote-button gating ──────────────────────────────────────────────

  committeeLifecycle(snap: TrackerStateSnapshot): CommitteeMintLifecycleView | null {
    return committeeMintLifecycleView(snap);
  }

  canVote(snap: TrackerStateSnapshot): boolean {
    if (snap.kind !== 'OPEN') return false;
    return this.wallet.isConnected();
  }

  voteButtonTitle(snap: TrackerStateSnapshot): string {
    if (snap.kind === 'AWAITING_EXECUTE') {
      return 'Voting closed — proposal is awaiting EXECUTE';
    }
    if (snap.kind === 'AWAITING_EXPIRE') {
      return 'Voting closed — proposal is awaiting EXPIRE';
    }
    if (!this.wallet.isConnected()) {
      return 'Connect a Chia wallet to vote';
    }
    return 'Cast an SGT-weighted vote on this proposal';
  }

  hasValidAmount(): boolean {
    const v = this.voteAmountInput.trim();
    if (!v) return false;
    try {
      return BigInt(v) > 0n;
    } catch {
      return false;
    }
  }

  /**
   * Cast a vote with the input amount.  Delegates to
   * {@link CommitteeVoteRunnerService} and stores the typed result so
   * the template can render every outcome (success or pre-flight
   * failure).  On a successful submission we also reload the tracker
   * state so the quorum progress reflects the new tally as soon as
   * the chain confirms.
   */
  async submitVote(): Promise<void> {
    if (!this.hasValidAmount()) return;
    this.voting.set(true);
    this.lastVoteResult.set(null);
    try {
      const result = await this.runner.castVote({
        additionalVoteAmount: BigInt(this.voteAmountInput.trim()),
      });
      this.lastVoteResult.set(result);
      if (result.kind === 'submitted' && result.apiResponse.pushed) {
        // Refresh tracker state so the bar updates once the chain
        // confirms.  Fire-and-forget: the result panel is already
        // showing success either way.
        void this.reload();
      }
    } catch (e) {
      // Synchronous throws from the runner (e.g. wallet signing
      // failure) get reflected as a generic error result so the UI
      // surfaces something instead of going silent.
      this.lastVoteResult.set({
        kind: 'spend-builder-failed',
        error: formatError(e),
      });
    } finally {
      this.voting.set(false);
    }
  }

  voteResultOk(result: VoteRunResult): boolean {
    return result.kind === 'submitted' && result.apiResponse.pushed;
  }

  voteResultHeadline(result: VoteRunResult): string {
    switch (result.kind) {
      case 'submitted':
        return result.apiResponse.pushed
          ? `Vote submitted (${result.apiResponse.status})`
          : `Vote rejected by chain: ${result.apiResponse.status}`;
      case 'invalid-input':
        return 'Invalid vote amount.';
      case 'wallet-not-connected':
        return 'Connect a Chia wallet to vote.';
      case 'tracker-not-open':
        return 'Tracker is no longer in OPEN state.';
      case 'pgt-not-deployed':
        return 'SGT has not been issued on this network yet.';
      case 'no-pgt-coins':
        return "You don't appear to hold any free SGT / Committee Coin.";
      case 'no-coin-matches-vote-amount':
        return 'No free SGT coin matches the requested vote amount.';
      case 'spend-builder-failed':
        return 'Could not build the vote spend.';
    }
  }

  voteResultDetail(result: VoteRunResult): string {
    switch (result.kind) {
      case 'submitted':
        return `bundle ${result.apiResponse.spendBundleId}\nlocked coin ${result.pickedCoin.amount} mojos`;
      case 'invalid-input':
        return 'Vote amount must be a positive integer.';
      case 'wallet-not-connected':
        return 'Use the wallet panel to connect Goby or Sage, then retry.';
      case 'tracker-not-open':
        return 'Refresh the page; the proposal may have moved to AWAITING_EXECUTE / EXPIRE.';
      case 'pgt-not-deployed':
        return 'Wait until SGT issuance lands, then refresh.';
      case 'no-pgt-coins':
        return `Discovery: ${result.discovery.kind}`;
      case 'no-coin-matches-vote-amount':
        return (
          `LOCK is a full-coin operation. You can lock exactly one ` +
          `coin's worth per vote. Available amounts (mojos): ` +
          `${result.availableAmounts.join(', ') || '—'}`
        );
      case 'spend-builder-failed':
        return result.error;
    }
  }

  // ── Bill renderers ──────────────────────────────────────────────────

  billHeadline(bill: DecodedBill): string {
    switch (bill.kind) {
      case 'MINT':
        return 'MINT — spawn deed coin';
      case 'FREEZE':
        return bill.newPoolStatus === 0 ? 'FREEZE pool' : 'UNFREEZE pool';
      case 'SETTLE':
        return 'SETTLE batch';
      case 'VAULT_VERSION':
        return `VAULT_VERSION upgrade → v${bill.newVaultVersion}`;
      case 'UNKNOWN':
        return `Unknown bill (tag ${bill.tagHex})`;
    }
  }

  billSubhead(bill: DecodedBill): string {
    switch (bill.kind) {
      case 'MINT':
        return `deed_full_puzzle_hash ${bill.deedFullPuzzleHash}`;
      case 'FREEZE':
        return `new pool status = ${bill.newPoolStatus}`;
      case 'SETTLE':
        return `${bill.numDeeds} deeds · total ${bill.totalAmount} mojos`;
      case 'VAULT_VERSION':
        return `inner_mod_hash ${bill.newVaultInnerModHash}`;
      case 'UNKNOWN':
        return 'Off-chain interpretation unavailable.';
    }
  }

  billDetailJson(bill: DecodedBill): string {
    return JSON.stringify(
      bill,
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    );
  }

  // ── Formatting helpers ──────────────────────────────────────────────

  formatPgt(mojos: bigint): string {
    return mojos.toLocaleString('en-US');
  }

  progressPct(snap: TrackerStateSnapshot): number {
    if (snap.kind !== 'OPEN' && snap.kind !== 'AWAITING_EXECUTE' && snap.kind !== 'AWAITING_EXPIRE') {
      return 0;
    }
    if (snap.quorumRequired <= 0n) return 0;
    // Convert to Number for the percentage display — both operands fit
    // easily within Number precision (PGT supply is 1M).
    const ratio =
      Number(snap.voteTally) / Number(snap.quorumRequired);
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  }

  formatDeadline(deadlineSeconds: bigint): string {
    const ms = Number(deadlineSeconds) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }

  formatRemaining(deadlineSeconds: bigint): string {
    const now = Math.floor(Date.now() / 1000);
    const delta = Number(deadlineSeconds) - now;
    if (delta <= 0) return 'closed';
    if (delta < 60) return `${delta}s`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m`;
    return `${Math.floor(delta / 3600)}h ${Math.floor((delta % 3600) / 60)}m`;
  }

  formatRelative(timestampMs: number): string {
    const deltaSec = Math.floor((Date.now() - timestampMs) / 1000);
    if (deltaSec < 5) return 'just now';
    if (deltaSec < 60) return `${deltaSec}s ago`;
    if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
    return `${Math.floor(deltaSec / 3600)}h ago`;
  }

  // Expose Number globally so the template can format BigInt-typed
  // window seconds without a custom pipe.
  readonly Number = Number;
}
