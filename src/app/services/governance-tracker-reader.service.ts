import { Injectable, inject } from '@angular/core';

import { ChiaSingletonReaderService } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService } from './coinset.service';
import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import { environment } from '../../environments/environment';

/**
 * Reader for the PGT-backed governance proposal-tracker singleton
 * (``governance_singleton_inner.clsp``).
 *
 * **Why this exists (Brick 3.5c-4 / Phase B2).**  The committee desk
 * needs to surface the live on-chain proposal — if any — so PGT
 * holders can decide whether to vote.  Pre-Hermes-D the API tracked
 * "open proposals" in a SQLite table; that table is gone, and the
 * remaining source of truth is the tracker singleton itself.  This
 * service walks the tracker lineage, decodes each spend's solution
 * (PROPOSE / VOTE / EXECUTE / EXPIRE), and computes the current
 * state by applying transitions in chain order.
 *
 * The lineage walk and CLVM-replay primitives are reused from
 * {@link ChiaSingletonReaderService}; this service adds the
 * tracker-specific solution decoder and the IDLE → OPEN →
 * AWAITING_EXECUTE / AWAITING_EXPIRE → IDLE state machine.
 *
 * **Trust model.**  The tracker launcher id
 * ({@link environment.populisProtocol.governanceLauncherId}) is the
 * trust root.  Because singletons conserve over their lineage, any
 * coin we reach by walking forward from that launcher is necessarily
 * the canonical tracker — only the original curried code can have
 * created the eve.  We do not separately verify each puzzle reveal's
 * mod-hash here; the launcher id substitutes for that check.
 *
 * **Quorum semantics.**  The on-chain quorum check is
 * ``VOTE_TALLY * 10000 >= QUORUM_BPS * PGT_TOTAL_SUPPLY``.  For
 * display we mirror ``QUORUM_BPS`` and ``PGT_TOTAL_SUPPLY`` from
 * {@link environment.populisProtocol} (must equal the values the
 * operator curried at launch).  After the deadline:
 *
 *   * ``vote_tally * 10000 >= quorum_bps * pgt_total_supply`` →
 *     ``AWAITING_EXECUTE``: anyone may submit the EXECUTE spend.
 *   * otherwise → ``AWAITING_EXPIRE``: anyone may submit EXPIRE.
 */
@Injectable({ providedIn: 'root' })
export class GovernanceTrackerReaderService {
  private readonly reader = inject(ChiaSingletonReaderService);
  private readonly coinset = inject(CoinsetService);
  private readonly chiaWasm = inject(ChiaWasmService);

  // ── Spend-case opcodes (mirror governance_singleton_inner.clsp) ───────
  static readonly TRK_PROPOSE = 1;
  static readonly TRK_VOTE = 2;
  static readonly TRK_EXECUTE = 3;
  static readonly TRK_EXPIRE = 4;

  // ── Bill operation tags (mirror governance_singleton_inner.clsp) ──────
  /** 'M' — spawn a deed at the given full puzzle hash. */
  static readonly BILL_MINT = 0x4d;
  /** 'F' — flip pool status. */
  static readonly BILL_FREEZE = 0x46;
  /** 'S' — settle a batch of deeds. */
  static readonly BILL_SETTLE = 0x53;
  /** 'V' — ratify a vault_version_registry code change. */
  static readonly BILL_VAULT_VERSION = 0x56;

  /**
   * Read the current state of the governance tracker singleton.
   *
   * Returns a tagged snapshot.  ``NOT_DEPLOYED`` means the configured
   * launcher id was not found on chain; ``NOT_SPENT`` means the
   * launcher exists but its eve coin has not yet been created
   * (mempool race); ``IDLE`` means the tracker is ready to receive a
   * PROPOSE; ``OPEN`` / ``AWAITING_EXECUTE`` / ``AWAITING_EXPIRE``
   * mean a proposal is active in the corresponding lifecycle slot.
   *
   * @param nowSeconds Unix timestamp used to decide whether the
   *   proposal's deadline has passed (defaults to ``Date.now()``).
   *   Injectable for deterministic tests.
   */
  async readCurrentState(
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): Promise<TrackerStateSnapshot> {
    const launcherId = environment.populisProtocol.governanceLauncherId;
    if (!launcherId) {
      return { kind: 'NOT_DEPLOYED', reason: 'launcher-id-missing' };
    }

    const lineage = await this.reader.walkLineage(launcherId);
    if (!lineage) {
      return { kind: 'NOT_DEPLOYED', reason: 'launcher-not-on-chain' };
    }

    // First non-launcher node is the eve coin (created when the launcher
    // is spent).  If the launcher itself is unspent, there is no eve yet.
    const nonLauncher = lineage.nodes.filter((n) => !n.isLauncher);
    if (nonLauncher.length === 0) {
      // Echo the lineage's launcher id back so callers can see exactly
      // which singleton we tried (matches the value the reader actually
      // walked, not just whatever is currently in env).
      return { kind: 'NOT_SPENT', launcherId: lineage.launcherId };
    }

    // Apply each spent non-launcher coin's transition in chain order.
    // The state coin entering the eve is IDLE; each spend transitions it.
    let state: InternalState = { kind: 'IDLE' };
    let spendCount = 0;
    let lastSpendBlockIndex: number | null = null;

    for (const node of nonLauncher) {
      if (node.spentBlockIndex === null) {
        // Unspent leaf — running state IS the current state.
        break;
      }
      const ps = await this.coinset.getPuzzleAndSolution(
        node.coinId,
        node.spentBlockIndex,
      );
      if (!ps) {
        throw new Error(
          `GovernanceTrackerReader: missing puzzle/solution for spent ` +
            `coin ${node.coinId} at height ${node.spentBlockIndex}`,
        );
      }
      const decoded = this.decodeSpendSolution(ps.solution);
      state = this.applyTransition(state, decoded);
      spendCount += 1;
      lastSpendBlockIndex = node.spentBlockIndex;
    }

    return this.publish(state, spendCount, lastSpendBlockIndex, nowSeconds);
  }

  /**
   * Decode the on-chain singleton-wrapped solution into ``(spend_case,
   * params)``.  The singleton wrapper has shape ``(lineage_proof
   * my_amount inner_solution)`` and the inner solution has shape
   * ``(my_id my_inner_puzzlehash my_amount spend_case params)``.
   */
  decodeSpendSolution(solutionHex: string): DecodedSpend {
    const clvm = this.clvm();
    const solution = clvm.deserialize(hexToBytes(solutionHex));
    // Skip lineage_proof + my_amount → take inner_solution.
    const innerSolution = solution.rest().rest().first();
    // Skip my_id + my_inner_puzzlehash + my_amount → take (spend_case, params).
    const tail = innerSolution.rest().rest().rest();
    const spendCase = Number(tail.first().toInt());
    const params = tail.rest().first();
    return { spendCase, params };
  }

  // ── State machine ────────────────────────────────────────────────────

  private applyTransition(
    state: InternalState,
    decoded: DecodedSpend,
  ): InternalState {
    switch (decoded.spendCase) {
      case GovernanceTrackerReaderService.TRK_PROPOSE: {
        if (state.kind !== 'IDLE') {
          throw new Error(
            'GovernanceTrackerReader: PROPOSE applied to non-IDLE state',
          );
        }
        const params = decoded.params;
        // params = (proposal_hash bill_op voter_inner_puzhash
        //           first_vote_amount voting_deadline)
        const proposalHash = bytesToHex(params.first().toAtom() ?? new Uint8Array());
        const billOp = params.rest().first();
        const firstVoteAmount = params.rest().rest().rest().first().toInt();
        const votingDeadline = params.rest().rest().rest().rest().first().toInt();
        return {
          kind: 'OPEN',
          proposalHash,
          bill: this.decodeBill(billOp),
          voteTally: firstVoteAmount,
          votingDeadlineSeconds: votingDeadline,
        };
      }
      case GovernanceTrackerReaderService.TRK_VOTE: {
        if (state.kind !== 'OPEN') {
          throw new Error(
            'GovernanceTrackerReader: VOTE applied to non-OPEN state',
          );
        }
        // params = (voter_inner_puzhash additional_vote_amount)
        const additional = decoded.params.rest().first().toInt();
        return { ...state, voteTally: state.voteTally + additional };
      }
      case GovernanceTrackerReaderService.TRK_EXECUTE:
      case GovernanceTrackerReaderService.TRK_EXPIRE:
        return { kind: 'IDLE' };
      default:
        throw new Error(
          `GovernanceTrackerReader: unknown spend_case ${decoded.spendCase}`,
        );
    }
  }

  /**
   * Decode a bill operation tuple.  Tagged tuples follow
   * ``governance_singleton_inner.clsp``'s ``dispatch_bill``:
   *
   *   * ``(M deed_full_puzhash)``
   *   * ``(F new_pool_status)``
   *   * ``(S splitxch_root total_amount num_deeds)``
   *   * ``(V new_vault_inner_mod_hash new_canonical_params_hash new_vault_version)``
   */
  decodeBill(billOp: ClvmNode): DecodedBill {
    const tagAtom = billOp.first().toAtom();
    const tag = tagAtom && tagAtom.length === 1 ? tagAtom[0] : -1;
    const rest = billOp.rest();
    switch (tag) {
      case GovernanceTrackerReaderService.BILL_MINT:
        return {
          kind: 'MINT',
          deedFullPuzzleHash: bytesToHex(rest.first().toAtom() ?? new Uint8Array()),
        };
      case GovernanceTrackerReaderService.BILL_FREEZE:
        return {
          kind: 'FREEZE',
          newPoolStatus: Number(rest.first().toInt()),
        };
      case GovernanceTrackerReaderService.BILL_SETTLE:
        return {
          kind: 'SETTLE',
          splitxchRoot: bytesToHex(rest.first().toAtom() ?? new Uint8Array()),
          totalAmount: rest.rest().first().toInt(),
          numDeeds: rest.rest().rest().first().toInt(),
        };
      case GovernanceTrackerReaderService.BILL_VAULT_VERSION:
        return {
          kind: 'VAULT_VERSION',
          newVaultInnerModHash: bytesToHex(rest.first().toAtom() ?? new Uint8Array()),
          newCanonicalParamsHash: bytesToHex(
            rest.rest().first().toAtom() ?? new Uint8Array(),
          ),
          newVaultVersion: rest.rest().rest().first().toInt(),
        };
      default:
        return {
          kind: 'UNKNOWN',
          tagHex:
            tagAtom && tagAtom.length > 0
              ? bytesToHex(tagAtom)
              : '0x',
        };
    }
  }

  /**
   * Compute the absolute quorum threshold in PGT mojos and bucket the
   * final state for the UI.
   */
  private publish(
    state: InternalState,
    spendCount: number,
    lastSpendBlockIndex: number | null,
    nowSeconds: number,
  ): TrackerStateSnapshot {
    const env = environment.populisProtocol;
    const quorumRequired =
      (BigInt(env.governanceQuorumBps) * BigInt(env.governancePgtTotalSupply)) /
      10000n;
    if (state.kind === 'IDLE') {
      return {
        kind: 'IDLE',
        spendCount,
        lastSpendBlockIndex,
        quorumRequired,
        minProposalStake: BigInt(env.governanceMinProposalStake),
        votingWindowSeconds: BigInt(env.governanceVotingWindowSeconds),
      };
    }
    // OPEN: bucket by deadline + quorum.
    const deadlinePassed =
      BigInt(nowSeconds) >= state.votingDeadlineSeconds;
    let kind: 'OPEN' | 'AWAITING_EXECUTE' | 'AWAITING_EXPIRE';
    if (!deadlinePassed) {
      kind = 'OPEN';
    } else if (state.voteTally >= quorumRequired) {
      kind = 'AWAITING_EXECUTE';
    } else {
      kind = 'AWAITING_EXPIRE';
    }
    return {
      kind,
      proposalHash: state.proposalHash,
      bill: state.bill,
      voteTally: state.voteTally,
      votingDeadlineSeconds: state.votingDeadlineSeconds,
      quorumRequired,
      spendCount,
      lastSpendBlockIndex: lastSpendBlockIndex ?? 0,
    };
  }

  // ── WASM accessor ────────────────────────────────────────────────────

  private clvm(): ClvmShape {
    const sdk = this.chiaWasm.sdk() as { Clvm?: new () => ClvmShape };
    if (!sdk.Clvm) {
      throw new Error(
        'GovernanceTrackerReader: chia-wallet-sdk-wasm not loaded. ' +
          'Await ChiaWasmService.ready() before calling readCurrentState().',
      );
    }
    return new sdk.Clvm();
  }
}

// ─── Public types ────────────────────────────────────────────────────────

export type TrackerStateSnapshot =
  | { kind: 'NOT_DEPLOYED'; reason: 'launcher-id-missing' | 'launcher-not-on-chain' }
  | { kind: 'NOT_SPENT'; launcherId: string }
  | {
      kind: 'IDLE';
      spendCount: number;
      lastSpendBlockIndex: number | null;
      quorumRequired: bigint;
      minProposalStake: bigint;
      votingWindowSeconds: bigint;
    }
  | {
      kind: 'OPEN' | 'AWAITING_EXECUTE' | 'AWAITING_EXPIRE';
      proposalHash: string;
      bill: DecodedBill;
      voteTally: bigint;
      votingDeadlineSeconds: bigint;
      quorumRequired: bigint;
      spendCount: number;
      lastSpendBlockIndex: number;
    };

export type DecodedBill =
  | { kind: 'MINT'; deedFullPuzzleHash: string }
  | { kind: 'FREEZE'; newPoolStatus: number }
  | {
      kind: 'SETTLE';
      splitxchRoot: string;
      totalAmount: bigint;
      numDeeds: bigint;
    }
  | {
      kind: 'VAULT_VERSION';
      newVaultInnerModHash: string;
      newCanonicalParamsHash: string;
      newVaultVersion: bigint;
    }
  | { kind: 'UNKNOWN'; tagHex: string };

export interface DecodedSpend {
  spendCase: number;
  params: ClvmNode;
}

// ─── Internal types ──────────────────────────────────────────────────────

type InternalState =
  | { kind: 'IDLE' }
  | {
      kind: 'OPEN';
      proposalHash: string;
      bill: DecodedBill;
      voteTally: bigint;
      votingDeadlineSeconds: bigint;
    };

/**
 * Narrowed view of the chia-wallet-sdk-wasm Program shape we use.
 * Mirrors the surface in ``MintProposalV2Service`` /
 * ``ChiaSingletonReaderService``; we don't depend on the SDK's full
 * type signature (which evolves per minor version).
 */
export interface ClvmNode {
  first(): ClvmNode;
  rest(): ClvmNode;
  toAtom(): Uint8Array | null;
  toInt(): bigint;
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ClvmNode;
}
