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
   *   * ``(M deed_full_puzhash property_id_canon property_registry_puzzle_hash)``
   *   * ``(F new_pool_status)``
   *   * ``(S splitxch_root total_amount num_deeds deed_releases_hash)``
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
          propertyIdCanon: bytesToHex(rest.rest().first().toAtom() ?? new Uint8Array()),
          propertyRegistryPuzzleHash: bytesToHex(
            rest.rest().rest().first().toAtom() ?? new Uint8Array(),
          ),
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
          deedReleasesHash: bytesToHex(
            rest.rest().rest().rest().first().toAtom() ?? new Uint8Array(),
          ),
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

  // ── Vote-spend inputs (Phase 3d) ─────────────────────────────────────

  /**
   * Return the inputs the PGT VOTE spend builder needs when the tracker
   * is in OPEN state.  Returns ``null`` if the tracker isn't currently
   * accepting votes (any non-OPEN state).
   *
   * **How the current inner puzzle is reconstructed.**  The on-chain
   * unspent tracker coin's full puzzle hash =
   * ``singleton(struct, current_inner)`` where ``current_inner`` is the
   * tracker mod curried with the immutable params + the CURRENT state
   * fields (proposal_hash, bill_op, vote_tally, voting_deadline).  We
   * don't have ``current_inner``'s reveal directly — it doesn't exist on
   * chain yet because the current coin hasn't been spent.  We
   * reconstruct it by:
   *
   *   1. Fetching the LAST spend's full puzzle reveal (the previous
   *      tracker singleton's puzzle).
   *   2. Uncurrying ``singleton(struct, OLD_inner)`` → ``OLD_inner``.
   *   3. Uncurrying ``OLD_inner`` → ``(MOD, [16 args])``.
   *   4. Keeping the first 12 immutable args, substituting the last 4
   *      with the CURRENT state fields the snapshot tracks.
   *   5. Re-currying and re-wrapping in the singleton top layer.
   *
   * The resulting inner hash MUST equal the unspent coin's
   * inner-singleton hash — we cross-check by verifying
   * ``singleton(struct, current_inner).treeHash()`` equals
   * ``currentCoin.puzzleHash``.  Mismatch throws.
   *
   * @returns ``null`` for non-OPEN snapshots; otherwise the spend inputs.
   */
  async getOpenStateVoteInputs(
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): Promise<OpenStateVoteInputs | null> {
    const snapshot = await this.readCurrentState(nowSeconds);
    if (snapshot.kind !== 'OPEN') {
      return null;
    }
    const inputs = await this.reconstructActiveTrackerInputs(
      snapshot,
      'getOpenStateVoteInputs',
      'VOTE',
    );
    return {
      trackerCoin: inputs.trackerCoin,
      trackerInnerPuzzleHex: inputs.trackerInnerPuzzleHex,
      lineageProof: inputs.lineageProof,
      proposalHash: snapshot.proposalHash,
      deadlineSeconds: snapshot.votingDeadlineSeconds,
    };
  }

  /**
   * Return the inputs the tracker EXECUTE spend builder needs when the
   * tracker is executable.  Returns ``null`` for every non-executable state.
   */
  async getAwaitingExecuteInputs(
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): Promise<AwaitingExecuteInputs | null> {
    const snapshot = await this.readCurrentState(nowSeconds);
    if (snapshot.kind !== 'AWAITING_EXECUTE') {
      return null;
    }
    const inputs = await this.reconstructActiveTrackerInputs(
      snapshot,
      'getAwaitingExecuteInputs',
      'EXECUTE',
    );
    return {
      ...inputs,
      proposalHash: snapshot.proposalHash,
      bill: snapshot.bill,
      deadlineSeconds: snapshot.votingDeadlineSeconds,
    };
  }

  private async reconstructActiveTrackerInputs(
    snapshot: ActiveTrackerSnapshot,
    label: string,
    action: string,
  ): Promise<ReconstructedActiveTrackerInputs> {
    const launcherId = environment.populisProtocol.governanceLauncherId;
    const lineage = await this.reader.walkLineage(launcherId);
    if (!lineage) {
      throw new Error(`${label}: launcher not on chain`);
    }
    const nonLauncher = lineage.nodes.filter((n) => !n.isLauncher);
    const lastSpent = [...nonLauncher]
      .reverse()
      .find((n) => n.spentBlockIndex !== null);
    const current = nonLauncher.find((n) => n.spentBlockIndex === null);
    if (!lastSpent || !current) {
      throw new Error(
        `${label}: lineage walk did not yield a spent parent ` +
          `plus current unspent coin (required for ${action}).`,
      );
    }
    const ps = await this.coinset.getPuzzleAndSolution(
      lastSpent.coinId,
      lastSpent.spentBlockIndex!,
    );
    if (!ps) {
      throw new Error(
        `${label}: missing puzzle/solution for last spent coin ${lastSpent.coinId}`,
      );
    }

    const clvm = this.clvm();
    const lastFullPuzzle = clvm.deserialize(hexToBytes(ps.puzzleReveal));
    const fullUncurried = lastFullPuzzle.uncurry();
    if (!fullUncurried || fullUncurried.args.length !== 2) {
      throw new Error(
        `${label}: last spend puzzle reveal is not a curried singleton`,
      );
    }
    const singletonStruct = fullUncurried.args[0];
    const oldInner = fullUncurried.args[1];
    const innerUncurried = oldInner.uncurry();
    if (!innerUncurried || innerUncurried.args.length !== 16) {
      throw new Error(
        `${label}: tracker inner expects 16 curried args, ` +
          `got ${innerUncurried?.args.length ?? 0}`,
      );
    }
    // Replace the last 4 state args with the CURRENT state (post-transition).
    const immutableArgs = innerUncurried.args.slice(0, 12);
    const proposalHashBytes = hexToBytes(snapshot.proposalHash);
    const billProgram = this.encodeBillProgram(clvm, snapshot.bill);
    const newStateArgs = [
      clvm.atom(proposalHashBytes),
      billProgram,
      clvm.int(snapshot.voteTally),
      clvm.int(snapshot.votingDeadlineSeconds),
    ];
    const newInner = innerUncurried.program.curry([
      ...immutableArgs,
      ...newStateArgs,
    ]);
    const newFullPuzzle = fullUncurried.program.curry([singletonStruct, newInner]);
    const newFullPuzzleHash = newFullPuzzle.treeHash();

    // Cross-check: the reconstructed full puzzle hash MUST match what the
    // unspent coin claims.  Otherwise we'd build a spend that misses the
    // coin entirely (and the wallet would reject signing).
    if (bytesToHex(newFullPuzzleHash) !== current.puzzleHash) {
      throw new Error(
        `${label}: reconstructed tracker full puzzle hash ` +
          `${bytesToHex(newFullPuzzleHash)} does not match unspent coin ` +
          `${current.puzzleHash}. State decode or curry order has drifted.`,
      );
    }

    return {
      trackerCoin: {
        parentCoinInfo: current.parentCoinId,
        puzzleHash: current.puzzleHash,
        amount: current.amount,
      },
      trackerLauncherId: launcherId,
      trackerInnerPuzzleHex: bytesToHex(newInner.serialize()),
      lineageProof: {
        parentName: lastSpent.parentCoinId,
        innerPuzzleHash: bytesToHex(oldInner.treeHash()),
        amount: lastSpent.amount,
      },
    };
  }

  /**
   * Return the inputs the {@link MintPublishSpendBuilderService.buildTrackerProposeCoinSpend}
   * builder needs when the tracker is in **IDLE** state.  Returns
   * ``null`` if the tracker isn't currently accepting a new proposal
   * (any non-IDLE state).
   *
   * **How the current inner puzzle is reconstructed.**  When the
   * tracker is IDLE, the four state args of its curried inner puzzle
   * are all zero atoms (``proposal_hash=0``, ``bill_operation=0``,
   * ``vote_tally=0``, ``voting_deadline=0``) per
   * ``populis_puzzles.pgt_driver.proposal_tracker_inner_puzzle``.  We
   * recover the 12 immutable args by uncurrying the LAST SPEND's
   * reveal — which must be the post-execute / post-expire spend that
   * transitioned the tracker back into IDLE — and substitute the last
   * 4 args with zero atoms.
   *
   * **Fresh-launch caveat.**  If the current unspent coin IS the eve
   * coin (i.e. the singleton was just launched and has never had a
   * proposal opened), there is no prior non-launcher spend to uncurry,
   * so the reader throws.  Supporting the fresh-launch case requires a
   * separate ``buildIdleInnerFromEnvironment()`` helper that materialises
   * all 12 immutable args from ``environment.populisProtocol``
   * constants; tracked as a follow-up.  Production tracker singletons
   * are launched well before the first MINT publish, so this branch is
   * rare in practice.
   *
   * Cross-checks the reconstructed full puzzle hash against the
   * current unspent coin's claimed puzzle hash.  Mismatch throws — the
   * same defensive cross-check pattern as
   * {@link getOpenStateVoteInputs}.
   *
   * @returns ``null`` for non-IDLE snapshots; otherwise the spend inputs.
   */
  async getIdleStateProposeInputs(
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): Promise<IdleStateProposeInputs | null> {
    const snapshot = await this.readCurrentState(nowSeconds);
    if (snapshot.kind !== 'IDLE') {
      return null;
    }
    const launcherId = environment.populisProtocol.governanceLauncherId;
    const lineage = await this.reader.walkLineage(launcherId);
    if (!lineage) {
      throw new Error('getIdleStateProposeInputs: launcher not on chain');
    }
    const nonLauncher = lineage.nodes.filter((n) => !n.isLauncher);
    const lastSpent = [...nonLauncher]
      .reverse()
      .find((n) => n.spentBlockIndex !== null);
    const current = nonLauncher.find((n) => n.spentBlockIndex === null);
    if (!current) {
      throw new Error(
        'getIdleStateProposeInputs: lineage walk did not yield a ' +
          'current unspent coin (tracker not in IDLE on chain).',
      );
    }
    if (!lastSpent) {
      // Fresh-launch case: the eve coin is in IDLE but has never been
      // spent, so we have no prior non-launcher reveal to uncurry.
      // See class-level caveat above; tracked as a follow-up.
      throw new Error(
        'getIdleStateProposeInputs: tracker is in fresh-launch IDLE ' +
          '(eve never spent).  Reconstructing the IDLE inner from ' +
          'environment constants is not yet implemented; this branch is ' +
          'expected to be rare in practice because production trackers ' +
          'are launched well before the first MINT publish.',
      );
    }
    const ps = await this.coinset.getPuzzleAndSolution(
      lastSpent.coinId,
      lastSpent.spentBlockIndex!,
    );
    if (!ps) {
      throw new Error(
        `getIdleStateProposeInputs: missing puzzle/solution for last ` +
          `spent coin ${lastSpent.coinId}`,
      );
    }

    const clvm = this.clvm();
    const lastFullPuzzle = clvm.deserialize(hexToBytes(ps.puzzleReveal));
    const fullUncurried = lastFullPuzzle.uncurry();
    if (!fullUncurried || fullUncurried.args.length !== 2) {
      throw new Error(
        'getIdleStateProposeInputs: last spend puzzle reveal is not a ' +
          'curried singleton',
      );
    }
    const singletonStruct = fullUncurried.args[0];
    const oldInner = fullUncurried.args[1];
    const innerUncurried = oldInner.uncurry();
    if (!innerUncurried || innerUncurried.args.length !== 16) {
      throw new Error(
        `getIdleStateProposeInputs: tracker inner expects 16 curried ` +
          `args, got ${innerUncurried?.args.length ?? 0}`,
      );
    }
    // Replace the last 4 state args with IDLE-state zero atoms.  In
    // CLVM the zero integer and the nil (empty) atom share the same
    // canonical serialisation; we use clvm.nil() for byte-exact match
    // with how `Program.to(0)` is encoded by chia_rs.
    const immutableArgs = innerUncurried.args.slice(0, 12);
    const idleStateArgs = [clvm.nil(), clvm.nil(), clvm.nil(), clvm.nil()];
    const newInner = innerUncurried.program.curry([
      ...immutableArgs,
      ...idleStateArgs,
    ]);
    const newFullPuzzle = fullUncurried.program.curry([
      singletonStruct,
      newInner,
    ]);
    const newFullPuzzleHash = newFullPuzzle.treeHash();

    if (bytesToHex(newFullPuzzleHash) !== current.puzzleHash) {
      throw new Error(
        'getIdleStateProposeInputs: reconstructed tracker full puzzle ' +
          `hash ${bytesToHex(newFullPuzzleHash)} does not match unspent ` +
          `coin ${current.puzzleHash}.  IDLE-state reconstruction or ` +
          'curry order has drifted.',
      );
    }

    return {
      trackerCoin: {
        parentCoinInfo: current.parentCoinId,
        puzzleHash: current.puzzleHash,
        amount: current.amount,
      },
      trackerInnerPuzzleHex: bytesToHex(newInner.serialize()),
      trackerLauncherId: launcherId,
      lineageProof: {
        parentName: lastSpent.parentCoinId,
        innerPuzzleHash: bytesToHex(oldInner.treeHash()),
        amount: lastSpent.amount,
      },
    };
  }

  /**
   * Encode a {@link DecodedBill} back into the canonical CLVM bill tuple
   * the governance tracker curries as ``BILL_OPERATION``.
   *
   * Mirrors ``populis_puzzles.pgt_driver.bill_mint / bill_freeze / bill_settle /
   * bill_vault_version``.  ``UNKNOWN`` bills throw — re-currying with an
   * unknown bill would produce an inner hash that doesn't match the
   * unspent coin (the cross-check in {@link getOpenStateVoteInputs} would
   * catch this anyway, but throwing here gives a clearer error).
   */
  private encodeBillProgram(clvm: ClvmShape, bill: DecodedBill): ClvmNode {
    switch (bill.kind) {
      case 'MINT':
        return clvm.list([
          clvm.atom(new Uint8Array([GovernanceTrackerReaderService.BILL_MINT])),
          clvm.atom(hexToBytes(bill.deedFullPuzzleHash)),
          ...(is32ByteHex(bill.propertyIdCanon) &&
          is32ByteHex(bill.propertyRegistryPuzzleHash)
            ? [
                clvm.atom(hexToBytes(bill.propertyIdCanon)),
                clvm.atom(hexToBytes(bill.propertyRegistryPuzzleHash)),
              ]
            : []),
        ]);
      case 'FREEZE':
        return clvm.list([
          clvm.atom(new Uint8Array([GovernanceTrackerReaderService.BILL_FREEZE])),
          clvm.int(BigInt(bill.newPoolStatus)),
        ]);
      case 'SETTLE':
        return clvm.list([
          clvm.atom(new Uint8Array([GovernanceTrackerReaderService.BILL_SETTLE])),
          clvm.atom(hexToBytes(bill.splitxchRoot)),
          clvm.int(bill.totalAmount),
          clvm.int(bill.numDeeds),
          clvm.atom(hexToBytes(bill.deedReleasesHash)),
        ]);
      case 'VAULT_VERSION':
        return clvm.list([
          clvm.atom(
            new Uint8Array([GovernanceTrackerReaderService.BILL_VAULT_VERSION]),
          ),
          clvm.atom(hexToBytes(bill.newVaultInnerModHash)),
          clvm.atom(hexToBytes(bill.newCanonicalParamsHash)),
          clvm.int(bill.newVaultVersion),
        ]);
      case 'UNKNOWN':
        throw new Error(
          `encodeBillProgram: cannot encode UNKNOWN bill with tag ${bill.tagHex}`,
        );
    }
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
  | {
      kind: 'MINT';
      deedFullPuzzleHash: string;
      propertyIdCanon: string;
      propertyRegistryPuzzleHash: string;
    }
  | { kind: 'FREEZE'; newPoolStatus: number }
  | {
      kind: 'SETTLE';
      splitxchRoot: string;
      totalAmount: bigint;
      numDeeds: bigint;
      deedReleasesHash: string;
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

/**
 * Inputs the PGT VOTE spend builder needs.  Produced by
 * {@link GovernanceTrackerReaderService.getOpenStateVoteInputs} only
 * when the tracker is in OPEN state.
 */
export interface OpenStateVoteInputs {
  /** The current unspent tracker singleton coin. */
  trackerCoin: { parentCoinInfo: string; puzzleHash: string; amount: number };
  /**
   * Reconstructed OPEN-state tracker inner puzzle reveal (0x-hex).
   * Tree hash, when wrapped in the singleton top layer with the same
   * struct, equals ``trackerCoin.puzzleHash``.
   */
  trackerInnerPuzzleHex: string;
  /**
   * Lineage proof for the tracker spend — derived from the last spent
   * coin (the parent of ``trackerCoin``).
   */
  lineageProof: {
    parentName: string;
    innerPuzzleHash: string;
    amount: number;
  };
  /** Current proposal hash (mirrors ``snapshot.proposalHash``). */
  proposalHash: string;
  /** Voting deadline in absolute seconds (uint64). */
  deadlineSeconds: bigint;
}

/**
 * Inputs the tracker EXECUTE spend builder needs.  Produced only when the
 * tracker has crossed its deadline and met quorum.
 */
export interface AwaitingExecuteInputs {
  /** The current unspent tracker singleton coin. */
  trackerCoin: { parentCoinInfo: string; puzzleHash: string; amount: number };
  /** Reconstructed executable tracker inner puzzle reveal (0x-hex). */
  trackerInnerPuzzleHex: string;
  /** Tracker singleton launcher id. */
  trackerLauncherId: string;
  /** Lineage proof for the tracker spend. */
  lineageProof: {
    parentName: string;
    innerPuzzleHash: string;
    amount: number;
  };
  /** Current proposal hash (mirrors ``snapshot.proposalHash``). */
  proposalHash: string;
  /** Full bill payload curried into tracker state. */
  bill: DecodedBill;
  /** Voting deadline in absolute seconds (uint64). */
  deadlineSeconds: bigint;
}

/**
 * Inputs the tracker-PROPOSE spend builder
 * ({@link MintPublishSpendBuilderService.buildTrackerProposeCoinSpend})
 * needs.  Produced by
 * {@link GovernanceTrackerReaderService.getIdleStateProposeInputs} only
 * when the tracker is in IDLE state.
 *
 * Note: this shape intentionally OMITS ``proposalHash`` and
 * ``deadlineSeconds`` (unlike {@link OpenStateVoteInputs}) because
 * those values are CREATED by the publish flow, not READ from chain —
 * the runner picks ``deadlineSeconds`` from a user-controlled voting
 * window and computes ``proposalHash`` from the bill operation.
 */
export interface IdleStateProposeInputs {
  /** The current unspent tracker singleton coin (in IDLE state). */
  trackerCoin: { parentCoinInfo: string; puzzleHash: string; amount: number };
  /**
   * Reconstructed IDLE-state tracker inner puzzle reveal (0x-hex).
   * Tree hash, when wrapped in the singleton top layer with the same
   * struct, equals ``trackerCoin.puzzleHash``.
   */
  trackerInnerPuzzleHex: string;
  /** Tracker singleton launcher id (= ``environment.populisProtocol.governanceLauncherId``). */
  trackerLauncherId: string;
  /**
   * Lineage proof for the tracker spend — derived from the last spent
   * coin (the parent of ``trackerCoin``), which transitioned the
   * singleton back into IDLE via TRK_EXECUTE or TRK_EXPIRE.
   */
  lineageProof: {
    parentName: string;
    innerPuzzleHash: string;
    amount: number;
  };
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

type ActiveTrackerSnapshot = Extract<
  TrackerStateSnapshot,
  { kind: 'OPEN' | 'AWAITING_EXECUTE' | 'AWAITING_EXPIRE' }
>;

interface ReconstructedActiveTrackerInputs {
  trackerCoin: { parentCoinInfo: string; puzzleHash: string; amount: number };
  trackerInnerPuzzleHex: string;
  trackerLauncherId: string;
  lineageProof: {
    parentName: string;
    innerPuzzleHash: string;
    amount: number;
  };
}

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
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
  curry(args: ClvmNode[]): ClvmNode;
  uncurry(): { program: ClvmNode; args: ClvmNode[] } | null;
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ClvmNode;
  atom(value: Uint8Array): ClvmNode;
  int(value: bigint): ClvmNode;
  list(value: ClvmNode[]): ClvmNode;
  pair(first: ClvmNode, rest: ClvmNode): ClvmNode;
  nil(): ClvmNode;
}

function is32ByteHex(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
}
