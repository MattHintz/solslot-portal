import { Injectable, inject } from '@angular/core';

import { A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT } from '../../docs/a5-roster-update-authorization.contract';
import { coinId, hexToBytes } from '../../utils/chia-hash';
import { ChiaWasmService } from '../chia-wasm.service';
import type { UnsignedCoinSpend } from '../chia-wallet.service';
import { AdminAuthorityV2Service, bytesToHexPrefixed } from './admin-authority-v2.service';
import type { AdminRosterSpendBuilderVerifiedIntake } from './admin-roster-spend-builder-intake.service';
import type { AdminRosterUnsignedClvmConstructionPlan } from './admin-roster-unsigned-clvm-construction.service';

const SPEND_ADMIN_ROSTER_UPDATE = 0x07;
const CREATE_COIN = 51;
const AGG_SIG_ME = 50;
const CREATE_PUZZLE_ANNOUNCEMENT = 62;
const ASSERT_MY_AMOUNT = 73;
const PROTOCOL_PREFIX = 0x50;
const DEFAULT_MAX_MIPS_EXECUTION_COST = 11_000_000_000n;

@Injectable({ providedIn: 'root' })
export class AdminRosterMipsExecutionCoinSpendService {
  private readonly wasm = inject(ChiaWasmService);
  private readonly v2 = inject(AdminAuthorityV2Service);

  build(input: AdminRosterMipsExecutionCoinSpendRequest): AdminRosterMipsExecutionCoinSpendResult {
    const failures: string[] = [];
    const plan = parseRecordInput(input.unsignedClvmConstructionPlan, 'unsigned_clvm_construction_plan', failures);
    const intake = parseRecordInput(input.verifiedSpendBuilderIntake, 'verified_spend_builder_intake', failures);
    const liveCoin = readInputRecord(input.liveSingletonCoinMetadata, 'live_singleton_coin_metadata', failures);
    const material = readInputRecord(input.rosterUpdateMaterial, 'roster_update_material', failures);
    const rawCurrentMipsPuzzleReveal = readInputString(input.rawCurrentMipsPuzzleReveal, 'raw_current_mips_puzzle_reveal', failures);
    const rawCurrentMipsQuorumSolution = readInputString(input.rawCurrentMipsQuorumSolution, 'raw_current_mips_quorum_solution', failures);
    const rawCurrentAuthorityInnerPuzzleReveal = readInputString(
      input.rawCurrentAdminAuthorityV2InnerPuzzleReveal,
      'raw_current_admin_authority_v2_inner_puzzle_reveal',
      failures,
    );

    if (plan) collectForbiddenMaterial(plan, 'unsigned_clvm_construction_plan', failures);
    if (intake) collectForbiddenMaterial(intake, 'verified_spend_builder_intake', failures);
    if (liveCoin) collectForbiddenMaterial(liveCoin, 'live_singleton_coin_metadata', failures);
    if (material) collectForbiddenMaterial(material, 'roster_update_material', failures);

    if (!plan || !intake || !liveCoin || !material || !rawCurrentMipsPuzzleReveal || !rawCurrentMipsQuorumSolution || !rawCurrentAuthorityInnerPuzzleReveal) {
      return candidateResult(failures, null);
    }

    expectString(plan, 'kind', 'admin_authority_v2_roster_update_unsigned_clvm_construction_plan', failures, 'unsigned_clvm_construction_plan.kind');
    expectString(plan, 'boundary', 'derive_unsigned_clvm_construction_plan_without_coin_spend_serialization', failures, 'unsigned_clvm_construction_plan.boundary');
    expectString(plan, 'result', 'unsigned_clvm_construction_plan_only_no_coin_spends', failures, 'unsigned_clvm_construction_plan.result');
    expectString(intake, 'kind', 'admin_authority_v2_roster_update_spend_builder_verified_intake', failures, 'verified_spend_builder_intake.kind');
    expectString(intake, 'boundary', 'normalize_and_reverify_inputs_without_spend_construction', failures, 'verified_spend_builder_intake.boundary');
    expectString(intake, 'result', 'verified_intake_only_no_signed_bundle', failures, 'verified_spend_builder_intake.result');

    const planAdminShape = readRecord(plan, 'unsigned_admin_authority_v2_spend_shape', failures, 'unsigned_clvm_construction_plan.unsigned_admin_authority_v2_spend_shape');
    const planMipsShape = readRecord(plan, 'unsigned_mips_spend_shape', failures, 'unsigned_clvm_construction_plan.unsigned_mips_spend_shape');
    const planExpected = readRecord(plan, 'expected_conditions_summary', failures, 'unsigned_clvm_construction_plan.expected_conditions_summary');
    const planSummary = readRecord(plan, 'deterministic_unsigned_construction_summary', failures, 'unsigned_clvm_construction_plan.deterministic_unsigned_construction_summary');
    const intakeCoin = readRecord(intake, 'singleton_coin', failures, 'verified_spend_builder_intake.singleton_coin');
    const transition = readRecord(intake, 'roster_transition', failures, 'verified_spend_builder_intake.roster_transition');
    const intakeSummary = readRecord(intake, 'deterministic_commitment_summary', failures, 'verified_spend_builder_intake.deterministic_commitment_summary');
    const planCoin = planAdminShape ? readRecord(planAdminShape, 'coin', failures, 'unsigned_clvm_construction_plan.unsigned_admin_authority_v2_spend_shape.coin') : null;
    const expectedAnnouncement = planExpected ? readRecord(planExpected, 'state_announcement', failures, 'unsigned_clvm_construction_plan.expected_conditions_summary.state_announcement') : null;
    const expectedContinuation = planExpected ? readRecord(planExpected, 'singleton_continuation', failures, 'unsigned_clvm_construction_plan.expected_conditions_summary.singleton_continuation') : null;

    if (!planAdminShape || !planMipsShape || !planExpected || !planSummary || !intakeCoin || !transition || !intakeSummary || !planCoin || !expectedAnnouncement || !expectedContinuation) {
      return candidateResult(failures, null);
    }

    const liveCoinId = readString(liveCoin, 'coin_id', failures, 'live_singleton_coin_metadata.coin_id');
    const liveParent = readString(liveCoin, 'parent_coin_info', failures, 'live_singleton_coin_metadata.parent_coin_info');
    const livePuzzleHash = readString(liveCoin, 'puzzle_hash', failures, 'live_singleton_coin_metadata.puzzle_hash');
    const liveAmount = readNumber(liveCoin, 'amount', failures, 'live_singleton_coin_metadata.amount');
    const launcherId = readString(transition, 'launcher_id', failures, 'verified_spend_builder_intake.roster_transition.launcher_id');
    const spendTag = readNumber(transition, 'spend_tag', failures, 'verified_spend_builder_intake.roster_transition.spend_tag');
    const newAuthorityVersion = readNumber(transition, 'new_authority_version', failures, 'verified_spend_builder_intake.roster_transition.new_authority_version');
    const currentMipsRootHash = readString(transition, 'current_mips_root_hash', failures, 'verified_spend_builder_intake.roster_transition.current_mips_root_hash');
    const newMipsRootHash = readString(transition, 'new_mips_root_hash', failures, 'verified_spend_builder_intake.roster_transition.new_mips_root_hash');
    const currentAdminsHash = readString(transition, 'current_admins_hash', failures, 'verified_spend_builder_intake.roster_transition.current_admins_hash');
    const newAdminsHash = readString(transition, 'new_admins_hash', failures, 'verified_spend_builder_intake.roster_transition.new_admins_hash');
    const currentPendingOpsHash = readString(transition, 'current_pending_ops_hash', failures, 'verified_spend_builder_intake.roster_transition.current_pending_ops_hash');
    const newPendingOpsHash = readString(transition, 'new_pending_ops_hash', failures, 'verified_spend_builder_intake.roster_transition.new_pending_ops_hash');
    const rosterUpdateBindingHash = readString(transition, 'roster_update_binding_hash', failures, 'verified_spend_builder_intake.roster_transition.roster_update_binding_hash');
    const expectedNewStateHash = readString(expectedAnnouncement, 'state_hash', failures, 'unsigned_clvm_construction_plan.expected_conditions_summary.state_announcement.state_hash');
    const expectedNextInnerPuzzleHash = readString(expectedContinuation, 'next_inner_puzzle_hash', failures, 'unsigned_clvm_construction_plan.expected_conditions_summary.singleton_continuation.next_inner_puzzle_hash');
    const expectedNextFullPuzzleHash = readString(expectedContinuation, 'next_full_puzzle_hash', failures, 'unsigned_clvm_construction_plan.expected_conditions_summary.singleton_continuation.next_full_puzzle_hash');

    compareHex(liveCoinId, readString(planCoin, 'coin_id', failures, 'unsigned_clvm_construction_plan.unsigned_admin_authority_v2_spend_shape.coin.coin_id'), 'live singleton coin id must match unsigned CLVM plan coin id', failures);
    compareHex(liveParent, readString(planCoin, 'parent_coin_info', failures, 'unsigned_clvm_construction_plan.unsigned_admin_authority_v2_spend_shape.coin.parent_coin_info'), 'live singleton parent coin id must match unsigned CLVM plan coin parent', failures);
    compareHex(livePuzzleHash, readString(planCoin, 'puzzle_hash', failures, 'unsigned_clvm_construction_plan.unsigned_admin_authority_v2_spend_shape.coin.puzzle_hash'), 'live singleton puzzle hash must match unsigned CLVM plan coin puzzle hash', failures);
    compareNumber(liveAmount, readNumber(planCoin, 'amount', failures, 'unsigned_clvm_construction_plan.unsigned_admin_authority_v2_spend_shape.coin.amount'), 'live singleton amount must match unsigned CLVM plan coin amount', failures);
    compareHex(liveCoinId, readString(intakeCoin, 'coin_id', failures, 'verified_spend_builder_intake.singleton_coin.coin_id'), 'live singleton coin id must match verified intake coin id', failures);

    const computedCoinId = computeCoinId(liveParent, livePuzzleHash, liveAmount, failures);
    compareHex(computedCoinId, liveCoinId, 'live singleton coin id must match parent coin id, puzzle hash, and amount', failures);

    const computedMipsPuzzleHash = computeProgramTreeHash(() => this.v2.computeSerializedProgramTreeHash(rawCurrentMipsPuzzleReveal), 'raw current MIPS puzzle reveal hash verification failed', failures);
    const computedMipsSolutionHash = computeProgramTreeHash(() => this.v2.computeSerializedProgramTreeHash(rawCurrentMipsQuorumSolution), 'raw current MIPS quorum solution hash verification failed', failures);
    const computedInnerHash = computeProgramTreeHash(() => this.v2.computeSerializedProgramTreeHash(rawCurrentAuthorityInnerPuzzleReveal), 'raw current admin_authority_v2 inner puzzle reveal hash verification failed', failures);

    compareHex(computedMipsPuzzleHash, readString(planMipsShape, 'puzzle_reveal_tree_hash', failures, 'unsigned_clvm_construction_plan.unsigned_mips_spend_shape.puzzle_reveal_tree_hash'), 'raw current MIPS puzzle reveal hash must match unsigned CLVM plan MIPS reveal hash', failures);
    compareHex(computedMipsPuzzleHash, readString(planSummary, 'current_mips_puzzle_reveal_tree_hash', failures, 'unsigned_clvm_construction_plan.deterministic_unsigned_construction_summary.current_mips_puzzle_reveal_tree_hash'), 'raw current MIPS puzzle reveal hash must match unsigned CLVM plan summary', failures);
    compareHex(computedMipsPuzzleHash, readString(intakeSummary, 'current_mips_puzzle_reveal_tree_hash', failures, 'verified_spend_builder_intake.deterministic_commitment_summary.current_mips_puzzle_reveal_tree_hash'), 'raw current MIPS puzzle reveal hash must match verified intake commitment', failures);
    compareHex(computedMipsPuzzleHash, currentMipsRootHash, 'raw current MIPS puzzle reveal hash must match current_mips_root_hash', failures);
    compareHex(computedMipsSolutionHash, readString(planMipsShape, 'quorum_solution_tree_hash', failures, 'unsigned_clvm_construction_plan.unsigned_mips_spend_shape.quorum_solution_tree_hash'), 'raw current MIPS quorum solution hash must match unsigned CLVM plan MIPS solution hash', failures);
    compareHex(computedMipsSolutionHash, readString(planSummary, 'current_mips_quorum_solution_tree_hash', failures, 'unsigned_clvm_construction_plan.deterministic_unsigned_construction_summary.current_mips_quorum_solution_tree_hash'), 'raw current MIPS quorum solution hash must match unsigned CLVM plan summary', failures);
    compareHex(computedMipsSolutionHash, readString(intakeSummary, 'current_mips_quorum_solution_tree_hash', failures, 'verified_spend_builder_intake.deterministic_commitment_summary.current_mips_quorum_solution_tree_hash'), 'raw current MIPS quorum solution hash must match verified intake commitment', failures);
    compareHex(computedInnerHash, readString(planAdminShape, 'current_inner_puzzle_hash', failures, 'unsigned_clvm_construction_plan.unsigned_admin_authority_v2_spend_shape.current_inner_puzzle_hash'), 'raw current admin_authority_v2 inner puzzle hash must match unsigned CLVM plan current inner hash', failures);
    compareHex(computedInnerHash, readString(intakeSummary, 'current_admin_authority_v2_inner_puzzle_reveal_tree_hash', failures, 'verified_spend_builder_intake.deterministic_commitment_summary.current_admin_authority_v2_inner_puzzle_reveal_tree_hash'), 'raw current admin_authority_v2 inner puzzle hash must match verified intake commitment', failures);

    if (spendTag !== SPEND_ADMIN_ROSTER_UPDATE) failures.push('verified intake spend_tag must be ADMIN_ROSTER_UPDATE');

    const currentAdminRecordsInput = readArray(material, 'current_admin_records', failures, 'roster_update_material.current_admin_records');
    const currentPendingOpsInput = readArray(material, 'current_pending_ops', failures, 'roster_update_material.current_pending_ops');
    const newAdminRecordInput = readRecord(material, 'new_admin_record', failures, 'roster_update_material.new_admin_record');
    const lineageProofInput = readRecord(material, 'singleton_lineage_proof', failures, 'roster_update_material.singleton_lineage_proof');

    if (!currentAdminRecordsInput || !currentPendingOpsInput || !newAdminRecordInput || !lineageProofInput) {
      return candidateResult(failures, null);
    }

    let execution: ExecutionBuild | null = null;
    if (failures.length === 0) {
      execution = runExecutionBuild(() => this.buildWithClvm({
        currentAdminRecordsInput,
        currentPendingOpsInput,
        newAdminRecordInput,
        lineageProofInput,
        rawCurrentMipsPuzzleReveal,
        rawCurrentMipsQuorumSolution,
        rawCurrentAuthorityInnerPuzzleReveal,
        liveCoinId,
        liveParent,
        livePuzzleHash,
        liveAmount,
        launcherId,
        newAuthorityVersion,
        currentAdminsHash,
        currentPendingOpsHash,
        newAdminsHash,
        newPendingOpsHash,
        newMipsRootHash,
        rosterUpdateBindingHash,
        expectedNewStateHash,
        expectedNextInnerPuzzleHash,
        expectedNextFullPuzzleHash,
        maxCost: input.maxCost,
        failures,
      }), 'MIPS execution and unsigned CoinSpend serialization failed', failures);
    }

    const candidate = failures.length || !execution ? null : {
      version: 1,
      kind: 'admin_authority_v2_roster_update_unsigned_coin_spend_candidate',
      boundary: A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.boundary,
      result: A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.result,
      source_plan: {
        kind: 'admin_authority_v2_roster_update_unsigned_clvm_construction_plan',
        result: 'unsigned_clvm_construction_plan_only_no_coin_spends',
        singleton_coin_id: normalizeHex(liveCoinId ?? ''),
        roster_update_binding_hash: normalizeHex(rosterUpdateBindingHash ?? ''),
      },
      bounded_mips_execution_report: execution.report,
      unsigned_admin_authority_v2_coin_spend: execution.coinSpend,
      embedded_mips_authorization_payload: {
        puzzle_reveal_tree_hash: normalizeHex(computedMipsPuzzleHash ?? ''),
        quorum_solution_tree_hash: normalizeHex(computedMipsSolutionHash ?? ''),
        execution_scope: 'executed_inside_admin_authority_v2_inner_solution',
        raw_material_location: 'admin_authority_v2_coin_spend.solution_only',
      },
      unsigned_spend_bundle_candidate: {
        coin_spends: [execution.coinSpend],
        signing_status: 'unsigned_no_signature_material',
        broadcast_status: 'not_broadcast',
      },
      deterministic_pre_signing_review: {
        singleton_coin_id: normalizeHex(liveCoinId ?? ''),
        current_singleton_full_puzzle_hash: normalizeHex(livePuzzleHash ?? ''),
        next_singleton_full_puzzle_hash: normalizeHex(expectedNextFullPuzzleHash ?? ''),
        new_state_hash: normalizeHex(expectedNewStateHash ?? ''),
        roster_update_binding_hash: normalizeHex(rosterUpdateBindingHash ?? ''),
        mips_execution_cost: execution.report.cost,
      },
      raw_material_status: {
        current_mips_puzzle_reveal: 'serialized_inside_admin_authority_v2_coin_spend_solution_only',
        current_mips_quorum_solution: 'serialized_inside_admin_authority_v2_coin_spend_solution_only',
        current_admin_authority_v2_inner_puzzle_reveal: 'serialized_inside_admin_authority_v2_coin_spend_puzzle_reveal_only',
      },
      allowed_material: [...A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.allowedMaterial],
      allowed_outputs: [...A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.allowedOutputs],
      boundary_guards: [
        'wallet_signature_not_collected',
        'transaction_not_signed',
        'transaction_not_broadcast',
        'backend_not_used_as_roster_authority',
        'credentials_not_output',
      ],
    } satisfies AdminRosterMipsExecutionCoinSpendCandidate;

    return candidateResult(failures, candidate);
  }

  private buildWithClvm(input: ExecutionBuildInput): ExecutionBuild {
    if (!input.liveParent || !input.livePuzzleHash || input.liveAmount === null || !input.launcherId || !input.newMipsRootHash) {
      throw new Error('required singleton coin metadata and roster transition fields are incomplete');
    }
    const clvm = this.clvm();
    const currentAdminRecords = input.currentAdminRecordsInput.map((record, index) => adminRecordProgram(clvm, record, `roster_update_material.current_admin_records[${index}]`, input.failures));
    const currentPendingOps = input.currentPendingOpsInput.map((record, index) => pendingOpProgram(clvm, record, `roster_update_material.current_pending_ops[${index}]`, input.failures));
    const newAdminRecord = adminRecordProgram(clvm, input.newAdminRecordInput, 'roster_update_material.new_admin_record', input.failures);
    if (currentAdminRecords.some((record) => record === null) || currentPendingOps.some((record) => record === null) || !newAdminRecord) {
      throw new Error('invalid roster update material records');
    }

    const currentAdminsProgram = clvm.list(currentAdminRecords as ProgramShape[]);
    const currentPendingOpsProgram = clvm.list(currentPendingOps as ProgramShape[]);
    const newAdminsProgram = clvm.list([...(currentAdminRecords as ProgramShape[]), newAdminRecord]);
    compareHex(bytesToHexPrefixed(currentAdminsProgram.treeHash()), input.currentAdminsHash, 'current admin records hash must match verified intake current_admins_hash', input.failures);
    compareHex(bytesToHexPrefixed(currentPendingOpsProgram.treeHash()), input.currentPendingOpsHash, 'current pending ops hash must match verified intake current_pending_ops_hash', input.failures);
    compareHex(bytesToHexPrefixed(currentPendingOpsProgram.treeHash()), input.newPendingOpsHash, 'current pending ops hash must match verified intake new_pending_ops_hash', input.failures);
    compareHex(bytesToHexPrefixed(newAdminsProgram.treeHash()), input.newAdminsHash, 'current admin records plus new admin hash must match verified intake new_admins_hash', input.failures);

    const mipsPuzzle = clvm.deserialize(hexToBytes(input.rawCurrentMipsPuzzleReveal));
    const mipsSolution = clvm.deserialize(hexToBytes(input.rawCurrentMipsQuorumSolution));
    const currentInnerPuzzle = clvm.deserialize(hexToBytes(input.rawCurrentAuthorityInnerPuzzleReveal));
    const spendArgs = clvm.list([
      currentAdminsProgram,
      currentPendingOpsProgram,
      mipsPuzzle,
      mipsSolution,
      newAdminRecord,
      clvm.atom(bytes32(input.newMipsRootHash, 'verified_spend_builder_intake.roster_transition.new_mips_root_hash')),
    ]);
    const innerSolution = clvm.list([
      clvm.int(BigInt(SPEND_ADMIN_ROSTER_UPDATE)),
      clvm.int(BigInt(input.liveAmount ?? 0)),
      clvm.int(BigInt(input.newAuthorityVersion ?? 0)),
      spendArgs,
    ]);

    const maxCost = normalizeCost(input.maxCost ?? DEFAULT_MAX_MIPS_EXECUTION_COST);
    const output = currentInnerPuzzle.run(innerSolution, maxCost, false);
    const cost = normalizeCost(output.cost);
    if (cost > maxCost) input.failures.push('MIPS execution cost must be within limit');
    const decoded = decodeConditions(output.value);
    checkDecodedConditions(decoded, input, input.failures);

    const singletonStruct = singletonStructProgram(clvm, input.launcherId);
    const fullPuzzle = singletonFullPuzzle(this.sdk(), clvm, singletonStruct, currentInnerPuzzle);
    const fullPuzzleHash = bytesToHexPrefixed(fullPuzzle.treeHash());
    compareHex(fullPuzzleHash, input.livePuzzleHash, 'serialized singleton puzzle reveal tree hash must match live coin puzzle hash', input.failures);
    const lineageProof = singletonLineageProofProgram(clvm, input.lineageProofInput, input.failures);
    const singletonSolution = clvm.list([
      lineageProof,
      clvm.int(BigInt(input.liveAmount ?? 0)),
      innerSolution,
    ]);
    const coinSpend: UnsignedCoinSpend = {
      coin: {
        parentCoinInfo: normalizeHex(input.liveParent ?? ''),
        puzzleHash: normalizeHex(input.livePuzzleHash),
        amount: input.liveAmount,
      },
      puzzleReveal: bytesToHexPrefixed(fullPuzzle.serialize()),
      solution: bytesToHexPrefixed(singletonSolution.serialize()),
    };
    const report: BoundedMipsExecutionReport = {
      status: 'executed_and_conditions_match_expected_roster_update',
      max_cost: maxCost.toString(),
      cost: cost.toString(),
      opcodes: decoded.opcodes,
      create_puzzle_announcements: decoded.createPuzzleAnnouncements.map(bytesToHexPrefixed),
      create_coins: decoded.createCoins.map((coin) => ({
        puzzle_hash: bytesToHexPrefixed(coin.puzzleHash),
        amount: Number(coin.amount),
      })),
      agg_sig_me_conditions: decoded.aggSigMe.map((condition) => ({
        public_key: bytesToHexPrefixed(condition.publicKey),
        message: bytesToHexPrefixed(condition.message),
      })),
      asserted_my_amount: decoded.assertedMyAmounts.map((amount) => Number(amount)),
    };
    return { coinSpend, report };
  }

  private sdk(): SdkShape {
    const sdk = this.wasm.sdk() as SdkShape;
    if (!sdk.Clvm) throw new Error('MIPS execution CoinSpend service: chia-wallet-sdk-wasm Clvm export unavailable');
    return sdk;
  }

  private clvm(): ClvmShape {
    const { Clvm } = this.sdk();
    if (!Clvm) throw new Error('MIPS execution CoinSpend service: chia-wallet-sdk-wasm Clvm export unavailable');
    return new Clvm();
  }
}

export interface AdminRosterMipsExecutionCoinSpendRequest {
  unsignedClvmConstructionPlan: unknown;
  verifiedSpendBuilderIntake: unknown;
  rawCurrentMipsPuzzleReveal: string;
  rawCurrentMipsQuorumSolution: string;
  rawCurrentAdminAuthorityV2InnerPuzzleReveal: string;
  liveSingletonCoinMetadata: unknown;
  rosterUpdateMaterial: unknown;
  maxCost?: number | bigint | string;
}

export interface AdminRosterMipsExecutionCoinSpendResult {
  ok: boolean;
  status: string;
  failures: string[];
  candidate: AdminRosterMipsExecutionCoinSpendCandidate | null;
}

export interface AdminRosterMipsExecutionCoinSpendCandidate {
  version: 1;
  kind: 'admin_authority_v2_roster_update_unsigned_coin_spend_candidate';
  boundary: typeof A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.boundary;
  result: typeof A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.result;
  source_plan: {
    kind: AdminRosterUnsignedClvmConstructionPlan['kind'];
    result: AdminRosterUnsignedClvmConstructionPlan['result'];
    singleton_coin_id: string;
    roster_update_binding_hash: string;
  };
  bounded_mips_execution_report: BoundedMipsExecutionReport;
  unsigned_admin_authority_v2_coin_spend: UnsignedCoinSpend;
  embedded_mips_authorization_payload: {
    puzzle_reveal_tree_hash: string;
    quorum_solution_tree_hash: string;
    execution_scope: string;
    raw_material_location: string;
  };
  unsigned_spend_bundle_candidate: {
    coin_spends: UnsignedCoinSpend[];
    signing_status: string;
    broadcast_status: string;
  };
  deterministic_pre_signing_review: {
    singleton_coin_id: string;
    current_singleton_full_puzzle_hash: string;
    next_singleton_full_puzzle_hash: string;
    new_state_hash: string;
    roster_update_binding_hash: string;
    mips_execution_cost: string;
  };
  raw_material_status: {
    current_mips_puzzle_reveal: string;
    current_mips_quorum_solution: string;
    current_admin_authority_v2_inner_puzzle_reveal: string;
  };
  allowed_material: string[];
  allowed_outputs: string[];
  boundary_guards: string[];
}

export interface BoundedMipsExecutionReport {
  status: 'executed_and_conditions_match_expected_roster_update';
  max_cost: string;
  cost: string;
  opcodes: number[];
  create_puzzle_announcements: string[];
  create_coins: Array<{ puzzle_hash: string; amount: number }>;
  agg_sig_me_conditions: Array<{ public_key: string; message: string }>;
  asserted_my_amount: number[];
}

type JsonRecord = Record<string, unknown>;

interface ExecutionBuildInput {
  currentAdminRecordsInput: unknown[];
  currentPendingOpsInput: unknown[];
  newAdminRecordInput: JsonRecord;
  lineageProofInput: JsonRecord;
  rawCurrentMipsPuzzleReveal: string;
  rawCurrentMipsQuorumSolution: string;
  rawCurrentAuthorityInnerPuzzleReveal: string;
  liveCoinId: string | null;
  liveParent: string | null;
  livePuzzleHash: string | null;
  liveAmount: number | null;
  launcherId: string | null;
  newAuthorityVersion: number | null;
  currentAdminsHash: string | null;
  currentPendingOpsHash: string | null;
  newAdminsHash: string | null;
  newPendingOpsHash: string | null;
  newMipsRootHash: string | null;
  rosterUpdateBindingHash: string | null;
  expectedNewStateHash: string | null;
  expectedNextInnerPuzzleHash: string | null;
  expectedNextFullPuzzleHash: string | null;
  maxCost?: number | bigint | string;
  failures: string[];
}

interface ExecutionBuild {
  coinSpend: UnsignedCoinSpend;
  report: BoundedMipsExecutionReport;
}

interface DecodedConditions {
  opcodes: number[];
  createPuzzleAnnouncements: Uint8Array[];
  createCoins: Array<{ puzzleHash: Uint8Array; amount: bigint }>;
  aggSigMe: Array<{ publicKey: Uint8Array; message: Uint8Array }>;
  assertedMyAmounts: bigint[];
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  atom(value: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
  list(values: ProgramShape[]): ProgramShape;
  pair(first: ProgramShape, rest: ProgramShape): ProgramShape;
}

interface ProgramShape {
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
  curry(args: ProgramShape[]): ProgramShape;
  run(solution: ProgramShape, maxCost: bigint, mempoolMode: boolean): { value: ProgramShape; cost: bigint | number | string };
  toList?(): ProgramShape[] | null;
  toAtom?(): Uint8Array;
  toInt?(): bigint;
  parseCreatePuzzleAnnouncement?(): { message: Uint8Array } | null;
}

interface SdkShape {
  Clvm?: new () => ClvmShape;
  Constants?: {
    singletonTopLayerV11?: () => Uint8Array;
    singletonTopLayer?: () => Uint8Array;
  };
}

function candidateResult(failures: string[], candidate: AdminRosterMipsExecutionCoinSpendCandidate | null): AdminRosterMipsExecutionCoinSpendResult {
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.result : 'fails_mips_execution_coin_spend_rechecks',
    failures,
    candidate,
  };
}

function runExecutionBuild(run: () => ExecutionBuild, message: string, failures: string[]): ExecutionBuild | null {
  try {
    return run();
  } catch (e) {
    failures.push(`${message}: ${errorMessage(e)}`);
    return null;
  }
}

function adminRecordProgram(clvm: ClvmShape, value: unknown, path: string, failures: string[]): ProgramShape | null {
  const record = readInputRecord(value, path, failures);
  if (!record) return null;
  const adminIdx = readNumber(record, 'admin_idx', failures, `${path}.admin_idx`);
  const leaves = readArray(record, 'leaves', failures, `${path}.leaves`);
  const mWithin = readNumber(record, 'm_within', failures, `${path}.m_within`);
  if (adminIdx === null || !leaves || mWithin === null) return null;
  const leafPrograms = leaves.map((leaf, index) => {
    const leafRecord = asRecord(leaf);
    const leafHash = leafRecord ? readString(leafRecord, 'leaf_hash', failures, `${path}.leaves[${index}].leaf_hash`) : typeof leaf === 'string' ? leaf : null;
    if (!leafHash) {
      failures.push(`${path}.leaves[${index}] must be a leaf hash string or object with leaf_hash`);
      return null;
    }
    return clvm.atom(bytes32(leafHash, `${path}.leaves[${index}]`));
  });
  if (leafPrograms.some((leaf) => leaf === null)) return null;
  return clvm.list([
    clvm.int(BigInt(adminIdx)),
    clvm.list(leafPrograms as ProgramShape[]),
    clvm.int(BigInt(mWithin)),
  ]);
}

function pendingOpProgram(clvm: ClvmShape, value: unknown, path: string, failures: string[]): ProgramShape | null {
  const record = readInputRecord(value, path, failures);
  if (!record) return null;
  const adminIdx = readNumber(record, 'admin_idx', failures, `${path}.admin_idx`);
  const opKind = readNumber(record, 'op_kind', failures, `${path}.op_kind`);
  const targetHash = readString(record, 'target_hash', failures, `${path}.target_hash`);
  const activatesAt = readNumber(record, 'activates_at', failures, `${path}.activates_at`);
  if (adminIdx === null || opKind === null || !targetHash || activatesAt === null) return null;
  return clvm.list([
    clvm.int(BigInt(adminIdx)),
    clvm.int(BigInt(opKind)),
    clvm.atom(bytes32(targetHash, `${path}.target_hash`)),
    clvm.int(BigInt(activatesAt)),
  ]);
}

function singletonLineageProofProgram(clvm: ClvmShape, value: JsonRecord, failures: string[]): ProgramShape {
  const parentParent = readString(value, 'parent_parent_coin_info', failures, 'roster_update_material.singleton_lineage_proof.parent_parent_coin_info');
  const parentInner = optionalString(value, 'parent_inner_puzzle_hash');
  const parentAmount = readNumber(value, 'parent_amount', failures, 'roster_update_material.singleton_lineage_proof.parent_amount');
  if (!parentParent || parentAmount === null) throw new Error('singleton lineage proof is incomplete');
  if (parentInner) {
    return clvm.list([
      clvm.atom(bytes32(parentParent, 'roster_update_material.singleton_lineage_proof.parent_parent_coin_info')),
      clvm.atom(bytes32(parentInner, 'roster_update_material.singleton_lineage_proof.parent_inner_puzzle_hash')),
      clvm.int(BigInt(parentAmount)),
    ]);
  }
  return clvm.list([
    clvm.atom(bytes32(parentParent, 'roster_update_material.singleton_lineage_proof.parent_parent_coin_info')),
    clvm.int(BigInt(parentAmount)),
  ]);
}

function singletonStructProgram(clvm: ClvmShape, launcherId: string): ProgramShape {
  return clvm.pair(
    clvm.atom(hexToBytes(AdminAuthorityV2Service.SINGLETON_MOD_HASH)),
    clvm.pair(clvm.atom(bytes32(launcherId, 'launcher_id')), clvm.atom(hexToBytes(AdminAuthorityV2Service.SINGLETON_LAUNCHER_HASH))),
  );
}

function singletonFullPuzzle(sdk: SdkShape, clvm: ClvmShape, singletonStruct: ProgramShape, innerPuzzle: ProgramShape): ProgramShape {
  const topLayer = sdk.Constants?.singletonTopLayerV11?.() ?? sdk.Constants?.singletonTopLayer?.();
  if (!topLayer) throw new Error('singleton top-layer bytecode unavailable in WASM SDK');
  return clvm.deserialize(topLayer).curry([singletonStruct, innerPuzzle]);
}

function decodeConditions(value: ProgramShape): DecodedConditions {
  const conditions = value.toList?.() ?? [];
  const decoded: DecodedConditions = {
    opcodes: [],
    createPuzzleAnnouncements: [],
    createCoins: [],
    aggSigMe: [],
    assertedMyAmounts: [],
  };
  for (const condition of conditions) {
    const parsedAnnouncement = condition.parseCreatePuzzleAnnouncement?.();
    const parts = condition.toList?.() ?? [];
    const opcode = atomAsNumber(parts[0]);
    if (opcode !== null) decoded.opcodes.push(opcode);
    if (parsedAnnouncement) {
      decoded.createPuzzleAnnouncements.push(parsedAnnouncement.message);
      continue;
    }
    if (opcode === CREATE_PUZZLE_ANNOUNCEMENT) {
      const message = parts[1]?.toAtom?.();
      if (message) decoded.createPuzzleAnnouncements.push(message);
      continue;
    }
    if (opcode === CREATE_COIN) {
      const puzzleHash = parts[1]?.toAtom?.();
      const amount = programAsBigInt(parts[2]);
      if (puzzleHash && amount !== null) decoded.createCoins.push({ puzzleHash, amount });
      continue;
    }
    if (opcode === AGG_SIG_ME) {
      const publicKey = parts[1]?.toAtom?.();
      const message = parts[2]?.toAtom?.();
      if (publicKey && message) decoded.aggSigMe.push({ publicKey, message });
      continue;
    }
    if (opcode === ASSERT_MY_AMOUNT) {
      const amount = programAsBigInt(parts[1]);
      if (amount !== null) decoded.assertedMyAmounts.push(amount);
    }
  }
  return decoded;
}

function checkDecodedConditions(decoded: DecodedConditions, input: ExecutionBuildInput, failures: string[]): void {
  const expectedAnnouncement = expectedAnnouncementBytes(input.expectedNewStateHash, input.rosterUpdateBindingHash, failures);
  const hasAnnouncement = decoded.createPuzzleAnnouncements.some((message) => sameBytes(message, expectedAnnouncement));
  if (!hasAnnouncement) failures.push('MIPS execution conditions must include expected roster update state announcement');
  const expectedCreateCoin = decoded.createCoins.some((coin) => sameHex(bytesToHexPrefixed(coin.puzzleHash), input.expectedNextInnerPuzzleHash) && coin.amount === BigInt(input.liveAmount ?? 0));
  if (!expectedCreateCoin) failures.push('MIPS execution conditions must include expected singleton continuation CREATE_COIN');
  if (!decoded.assertedMyAmounts.some((amount) => amount === BigInt(input.liveAmount ?? 0))) failures.push('MIPS execution conditions must assert the live singleton amount');
  for (const aggSig of decoded.aggSigMe) {
    if (!sameHex(bytesToHexPrefixed(aggSig.message), input.rosterUpdateBindingHash)) failures.push('MIPS AGG_SIG_ME messages must bind to roster update binding hash');
  }
}

function expectedAnnouncementBytes(expectedNewStateHash: string | null, rosterUpdateBindingHash: string | null, failures: string[]): Uint8Array {
  if (!expectedNewStateHash) {
    failures.push('expected new state hash is required for condition checks');
    return new Uint8Array(0);
  }
  if (!rosterUpdateBindingHash) failures.push('roster update binding hash is required for MIPS signature condition checks');
  const state = bytes32(expectedNewStateHash, 'expected_state_hash');
  const out = new Uint8Array(2 + state.length);
  out[0] = PROTOCOL_PREFIX;
  out[1] = SPEND_ADMIN_ROSTER_UPDATE;
  out.set(state, 2);
  return out;
}

function parseRecordInput(value: unknown, path: string, failures: string[]): JsonRecord | null {
  if (typeof value === 'string') {
    try {
      return readInputRecord(JSON.parse(value) as unknown, path, failures);
    } catch (e) {
      failures.push(`${path} must be valid JSON: ${errorMessage(e)}`);
      return null;
    }
  }
  return readInputRecord(value, path, failures);
}

function readInputRecord(value: unknown, path: string, failures: string[]): JsonRecord | null {
  const record = asRecord(value);
  if (!record) failures.push(`${path} must be an object`);
  return record;
}

function readInputString(value: unknown, path: string, failures: string[]): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    failures.push(`${path} is required`);
    return null;
  }
  return value.trim();
}

function readRecord(root: JsonRecord, key: string, failures: string[], path: string): JsonRecord | null {
  return readInputRecord(root[key], path, failures);
}

function readArray(root: JsonRecord, key: string, failures: string[], path: string): unknown[] | null {
  const value = root[key];
  if (!Array.isArray(value)) {
    failures.push(`${path} must be an array`);
    return null;
  }
  return value;
}

function readString(root: JsonRecord, key: string, failures: string[], path: string): string | null {
  const value = root[key];
  if (typeof value !== 'string' || !value.trim()) {
    failures.push(`${path} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function optionalString(root: JsonRecord, key: string): string | null {
  const value = root[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(root: JsonRecord, key: string, failures: string[], path: string): number | null {
  const value = root[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    failures.push(`${path} must be a finite number`);
    return null;
  }
  return value;
}

function expectString(root: JsonRecord, key: string, expected: string, failures: string[], path: string): void {
  const actual = readString(root, key, failures, path);
  if (actual !== null && actual !== expected) failures.push(`${path} must be ${expected}`);
}

function computeProgramTreeHash(fn: () => string, message: string, failures: string[]): string | null {
  try {
    return fn();
  } catch (e) {
    failures.push(`${message}: ${errorMessage(e)}`);
    return null;
  }
}

function computeCoinId(parent: string | null, puzzleHash: string | null, amount: number | null, failures: string[]): string | null {
  if (!parent || !puzzleHash || amount === null) return null;
  try {
    return coinId(parent, puzzleHash, amount);
  } catch (e) {
    failures.push(`live singleton coin id recomputation failed: ${errorMessage(e)}`);
    return null;
  }
}

function compareHex(actual: string | null, expected: string | null, message: string, failures: string[]): void {
  if (!actual || !expected) return;
  if (!sameHex(actual, expected)) failures.push(message);
}

function compareNumber(actual: number | null, expected: number | null, message: string, failures: string[]): void {
  if (actual === null || expected === null) return;
  if (actual !== expected) failures.push(message);
}

function sameHex(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeHex(a) === normalizeHex(b);
}

function normalizeHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X') ? `0x${value.slice(2).toLowerCase()}` : `0x${value.toLowerCase()}`;
}

function bytes32(value: string, path: string): Uint8Array {
  const bytes = hexToBytes(value);
  if (bytes.length !== 32) throw new Error(`${path} must be 32 bytes`);
  return bytes;
}

function normalizeCost(value: number | bigint | string): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function programAsBigInt(program: ProgramShape | undefined): bigint | null {
  if (!program) return null;
  const asInt = program.toInt?.();
  if (typeof asInt === 'bigint') return asInt;
  const atom = program.toAtom?.();
  if (!atom) return null;
  return atomToBigInt(atom);
}

function atomAsNumber(program: ProgramShape | undefined): number | null {
  const value = programAsBigInt(program);
  return value === null ? null : Number(value);
}

function atomToBigInt(atom: Uint8Array): bigint {
  if (atom.length === 0) return 0n;
  let value = 0n;
  for (const byte of atom) value = (value << 8n) | BigInt(byte);
  return value;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function collectForbiddenMaterial(value: unknown, path: string, failures: string[]): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenMaterial(entry, `${path}[${index}]`, failures));
    return;
  }
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('wallet_signature') ||
      lower.includes('aggregated_signature') ||
      lower.includes('aggregatedsignature') ||
      lower.includes('signed_spend_bundle') ||
      lower.includes('signedspendbundle') ||
      lower.includes('api_credentials') ||
      lower === 'jwt' ||
      lower.includes('nonce') ||
      lower.includes('secret') ||
      lower.includes('private_key') ||
      lower.includes('privatekey')
    ) {
      failures.push(`${path}.${key} must not contain signing, backend, credential, or secret material`);
    }
    collectForbiddenMaterial(child, `${path}.${key}`, failures);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
