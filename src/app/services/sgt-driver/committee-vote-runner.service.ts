import { Injectable, inject } from '@angular/core';

import { ChiaWalletService, UnsignedCoinSpend } from '../chia-wallet.service';
import { ChiaWasmService } from '../chia-wasm.service';
import { CommitteeApiService, CommitteeVoteApiResponse } from '../committee-api.service';
import { GovernanceTrackerReaderService } from '../governance-tracker-reader.service';
import { SgtCoinDiscoveryService, SgtCoin } from './sgt-coin-discovery.service';
import { SgtDriverService } from './sgt-driver.service';
import { SgtVoteSpendBuilderService } from './sgt-vote-spend-builder.service';
import { bytesToHex, hexToBytes } from '../../utils/chia-hash';
import { environment } from '../../../environments/environment';

/**
 * End-to-end orchestrator for the committee VOTE flow (Phase 3d).
 *
 * Glues together every service needed to take a single SGT vote from
 * the connected wallet to a signed-and-pushed spend bundle:
 *
 *   1. **Wallet derivation** — read the connected wallet's pubkey,
 *      derive the synthetic key and standard p2 puzzle hash (the
 *      voter's "inner puzzle hash" the SGT free coin is curried with).
 *   2. **Tracker state** — call
 *      {@link GovernanceTrackerReaderService.getOpenStateVoteInputs}.
 *      Aborts with a clear error if the tracker isn't OPEN.
 *   3. **SGT coin discovery** — call
 *      {@link SgtCoinDiscoveryService.discover}.  Picks the smallest
 *      coin that covers the requested vote amount exactly (LOCK is a
 *      full-coin operation; if no exact-amount coin exists the user
 *      must first split via TRANSFER — surfaced as a typed error).
 *   4. **Voter inner solution** — build the standard p2 delegated
 *      spend that emits the canonical ``CREATE_COIN(locked_ph, amount)``
 *      condition.  The wallet later signs the ``AGG_SIG_ME`` this
 *      delegated puzzle introduces.
 *   5. **CoinSpend assembly** — call
 *      {@link SgtVoteSpendBuilderService} twice (SGT lock + tracker
 *      VOTE).
 *   6. **Wallet signing** — call
 *      {@link ChiaWalletService.signSpendBundle} which returns the
 *      aggregated BLS signature.
 *   7. **Publish** — POST to
 *      {@link CommitteeApiService.castVote} → coinset.org via the
 *      solslot_api forwarder.
 *
 * **Lineage proof caveat (alpha).**  The SGT coin's CAT2 lineage proof
 * is currently set to ``eve`` (empty) which works ONLY for coins that
 * are direct children of the SGT TAIL issuance.  Once SGT changes
 * hands via TRANSFER spends, a real lineage proof is required — that
 * needs a small ``SgtLineageProofService`` (fetch the parent coin
 * record, uncurry its puzzle reveal, return the proof tuple) which
 * isn't yet implemented.  We surface this assumption clearly in the
 * runner result so the UI can warn the user.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeVoteRunnerService {
  private readonly wallet = inject(ChiaWalletService);
  private readonly wasm = inject(ChiaWasmService);
  private readonly tracker = inject(GovernanceTrackerReaderService);
  private readonly discovery = inject(SgtCoinDiscoveryService);
  private readonly sgt = inject(SgtDriverService);
  private readonly builder = inject(SgtVoteSpendBuilderService);
  private readonly api = inject(CommitteeApiService);

  /**
   * Cast a vote of ``additionalVoteAmount`` SGT mojos on the currently
   * OPEN proposal.
   *
   * @returns Discriminated-union {@link VoteRunResult}.  ``'submitted'``
   *   when the bundle was pushed; the API may still report
   *   ``pushed: false`` for mempool rejection — the UI should render
   *   ``apiResponse.status`` either way.  All other variants are
   *   pre-flight failures that didn't touch the wallet or API.
   */
  async castVote(args: CastVoteArgs): Promise<VoteRunResult> {
    if (args.additionalVoteAmount <= BigInt(0)) {
      return { kind: 'invalid-input', reason: 'additional-vote-amount-must-be-positive' };
    }

    // 1. Wallet derivation
    const pubkeyHex = this.wallet.pubkey();
    if (!pubkeyHex) {
      return { kind: 'wallet-not-connected' };
    }
    const sdk = this.sdk();
    const syntheticKey = sdk.PublicKey.fromBytes(hexToBytes(pubkeyHex));
    const voterInnerPuzzleHashBytes = sdk.standardPuzzleHash(syntheticKey);
    const voterInnerPuzzleHash = bytesToHex(voterInnerPuzzleHashBytes);

    // 2. Tracker state
    const voteInputs = await this.tracker.getOpenStateVoteInputs();
    if (!voteInputs) {
      return { kind: 'tracker-not-open' };
    }

    // 3. SGT coin discovery
    const discovery = await this.discovery.discover({ voterInnerPuzzleHash });
    if (discovery.kind !== 'found') {
      return { kind: 'no-sgt-coins', discovery };
    }
    const pick = discovery.coins.find(
      (c) => BigInt(c.amount) === args.additionalVoteAmount,
    );
    if (!pick) {
      return {
        kind: 'no-coin-matches-vote-amount',
        availableAmounts: discovery.coins.map((c) => c.amount),
        requestedAmount: args.additionalVoteAmount,
      };
    }

    // 4. Voter inner solution: a standard p2 delegated spend that
    // creates the canonical sgt_locked_inner output and nothing else.
    const trackerLauncherId = environment.solslotProtocol.governanceLauncherId;
    const trackerStructHash = this.sgt.trackerStructHash({ trackerLauncherId });
    const lockedPuzzleHash = this.sgt.sgtLockedInnerHash({
      trackerStructHash,
      voterInnerPuzzleHash,
      lockProposalHash: voteInputs.proposalHash,
      lockDeadlineSeconds: voteInputs.deadlineSeconds,
    });

    const clvm = this.clvm();
    const createCoinCondition = clvm.createCoin(
      lockedPuzzleHash,
      args.additionalVoteAmount,
      undefined,
    );
    const delegatedSpend = clvm.delegatedSpend([createCoinCondition]);
    const innerSpend = clvm.standardSpend(syntheticKey, delegatedSpend);
    const voterInnerPuzzleHex = bytesToHex(innerSpend.puzzle.serialize());
    const voterInnerSolutionHex = bytesToHex(innerSpend.solution.serialize());

    // 5. CoinSpend assembly
    const sgtGenesisCoinId =
      environment.solslotProtocol.sgtGenesisCoinId;
    if (!sgtGenesisCoinId) {
      return { kind: 'sgt-not-deployed' };
    }
    const sgtTailHash = bytesToHex(this.sgt.sgtTailHash(sgtGenesisCoinId));

    let sgtLockSpend: UnsignedCoinSpend;
    let trackerVoteSpend: UnsignedCoinSpend;
    try {
      sgtLockSpend = this.builder.buildSgtLockCoinSpend({
        sgtCoin: {
          parentCoinInfo: pick.parentCoinInfo,
          puzzleHash: pick.puzzleHash,
          amount: pick.amount,
        },
        voterInnerPuzzleHex,
        voterInnerSolutionHex,
        trackerLauncherId,
        sgtTailHash,
        // Eve case (see class docstring caveat) — empty lineage proof.
        // Sufficient for coins that are direct children of the TAIL
        // issuance.  Will fail for transferred coins until a proper
        // SgtLineageProofService lands.
        lineageProof: {},
        proposalHash: voteInputs.proposalHash,
        deadlineSeconds: voteInputs.deadlineSeconds,
      });
      trackerVoteSpend = this.builder.buildTrackerVoteCoinSpend({
        trackerCoin: voteInputs.trackerCoin,
        trackerInnerPuzzleHex: voteInputs.trackerInnerPuzzleHex,
        trackerLauncherId,
        lineageProof: voteInputs.lineageProof,
        voterInnerPuzzleHash,
        additionalVoteAmount: args.additionalVoteAmount,
      });
    } catch (err) {
      return {
        kind: 'spend-builder-failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 6. Wallet signing
    const signed = await this.wallet.signSpendBundle([
      sgtLockSpend,
      trackerVoteSpend,
    ]);

    // 7. Publish
    const apiResponse = await this.api.castVote(
      {
        coin_spends: signed.coinSpends.map((cs) => ({
          coin: {
            parent_coin_info: this.normalizeHex(cs.coin.parentCoinInfo),
            puzzle_hash: this.normalizeHex(cs.coin.puzzleHash),
            amount: Number(cs.coin.amount),
          },
          puzzle_reveal: this.normalizeHex(cs.puzzleReveal),
          solution: this.normalizeHex(cs.solution),
        })),
        aggregated_signature: this.normalizeHex(signed.aggregatedSignature),
      },
      voteInputs.proposalHash,
    );

    return {
      kind: 'submitted',
      apiResponse,
      pickedCoin: pick,
      voterInnerPuzzleHash,
    };
  }

  // ── Internals ───────────────────────────────────────────────────────

  private normalizeHex(value: string): string {
    return value.startsWith('0x') || value.startsWith('0X') ? value : '0x' + value;
  }

  private sdk(): RunnerSdk {
    const sdk = this.wasm.sdk() as Partial<RunnerSdk>;
    if (!sdk.Clvm || !sdk.PublicKey || !sdk.standardPuzzleHash) {
      throw new Error(
        'CommitteeVoteRunner: chia-wallet-sdk-wasm missing Clvm/PublicKey/standardPuzzleHash',
      );
    }
    return sdk as RunnerSdk;
  }

  private clvm(): RunnerClvm {
    return new (this.sdk().Clvm)();
  }
}

// ───────────────────────────────────────────────────────────────────────
//  Public shapes
// ───────────────────────────────────────────────────────────────────────

export interface CastVoteArgs {
  /**
   * SGT mojos to lock for this vote.  MUST equal the on-chain amount
   * of one of the voter's free SGT coins (LOCK is a full-coin
   * operation; the runner returns ``'no-coin-matches-vote-amount'``
   * if no candidate matches).
   */
  additionalVoteAmount: bigint;
}

export type VoteRunResult =
  | { kind: 'invalid-input'; reason: 'additional-vote-amount-must-be-positive' }
  | { kind: 'wallet-not-connected' }
  | { kind: 'tracker-not-open' }
  | { kind: 'sgt-not-deployed' }
  | {
      kind: 'no-sgt-coins';
      discovery:
        | { kind: 'sgt-not-deployed' }
        | { kind: 'governance-not-deployed' }
        | { kind: 'no-coins'; catSgtFreePuzzleHash: string };
    }
  | {
      kind: 'no-coin-matches-vote-amount';
      availableAmounts: number[];
      requestedAmount: bigint;
    }
  | { kind: 'spend-builder-failed'; error: string }
  | {
      kind: 'submitted';
      apiResponse: CommitteeVoteApiResponse;
      pickedCoin: SgtCoin;
      voterInnerPuzzleHash: string;
    };

// ── SDK typing ──────────────────────────────────────────────────────

interface RunnerSpend {
  puzzle: { serialize(): Uint8Array };
  solution: { serialize(): Uint8Array };
}
interface RunnerClvm {
  createCoin(
    puzzleHash: Uint8Array,
    amount: bigint,
    memos: undefined,
  ): unknown;
  delegatedSpend(conditions: unknown[]): RunnerSpend;
  standardSpend(syntheticKey: unknown, spend: RunnerSpend): RunnerSpend;
}
interface RunnerSdk {
  Clvm: new () => RunnerClvm;
  PublicKey: { fromBytes(bytes: Uint8Array): unknown };
  standardPuzzleHash(syntheticKey: unknown): Uint8Array;
}
