import { Injectable, inject } from '@angular/core';

import { A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT } from '../../docs/a5-roster-update-authorization.contract';
import { coinId } from '../../utils/chia-hash';
import { AdminAuthorityV2Service, bytesToHexPrefixed } from './admin-authority-v2.service';
import type { AdminRosterSpendBuilderVerifiedIntake } from './admin-roster-spend-builder-intake.service';

@Injectable({ providedIn: 'root' })
export class AdminRosterUnsignedClvmConstructionService {
  private readonly v2 = inject(AdminAuthorityV2Service);

  plan(input: AdminRosterUnsignedClvmConstructionRequest): AdminRosterUnsignedClvmConstructionResult {
    const failures: string[] = [];
    const intake = parseRecordInput(input.verifiedSpendBuilderIntake, 'verified_spend_builder_intake', failures);
    const liveCoin = readInputRecord(input.liveSingletonCoinMetadata, 'live_singleton_coin_metadata', failures);
    const rawCurrentMipsPuzzleReveal = readInputString(input.rawCurrentMipsPuzzleReveal, 'raw_current_mips_puzzle_reveal', failures);
    const rawCurrentMipsQuorumSolution = readInputString(input.rawCurrentMipsQuorumSolution, 'raw_current_mips_quorum_solution', failures);
    const rawCurrentAuthorityInnerPuzzleReveal = readInputString(
      input.rawCurrentAdminAuthorityV2InnerPuzzleReveal,
      'raw_current_admin_authority_v2_inner_puzzle_reveal',
      failures,
    );

    if (intake) collectForbiddenMaterial(intake, 'verified_spend_builder_intake', failures);
    if (liveCoin) collectForbiddenMaterial(liveCoin, 'live_singleton_coin_metadata', failures);

    if (!intake || !liveCoin || !rawCurrentMipsPuzzleReveal || !rawCurrentMipsQuorumSolution || !rawCurrentAuthorityInnerPuzzleReveal) {
      return constructionResult(failures, null);
    }

    expectString(intake, 'kind', 'admin_authority_v2_roster_update_spend_builder_verified_intake', failures, 'verified_spend_builder_intake.kind');
    expectString(intake, 'boundary', 'normalize_and_reverify_inputs_without_spend_construction', failures, 'verified_spend_builder_intake.boundary');
    expectString(intake, 'result', 'verified_intake_only_no_signed_bundle', failures, 'verified_spend_builder_intake.result');

    const singletonCoin = readRecord(intake, 'singleton_coin', failures, 'verified_spend_builder_intake.singleton_coin');
    const transition = readRecord(intake, 'roster_transition', failures, 'verified_spend_builder_intake.roster_transition');
    const commitments = readRecord(intake, 'deterministic_commitment_summary', failures, 'verified_spend_builder_intake.deterministic_commitment_summary');

    if (!singletonCoin || !transition || !commitments) return constructionResult(failures, null);

    const liveCoinId = readString(liveCoin, 'coin_id', failures, 'live_singleton_coin_metadata.coin_id');
    const liveParent = readString(liveCoin, 'parent_coin_info', failures, 'live_singleton_coin_metadata.parent_coin_info');
    const livePuzzleHash = readString(liveCoin, 'puzzle_hash', failures, 'live_singleton_coin_metadata.puzzle_hash');
    const liveAmount = readNumber(liveCoin, 'amount', failures, 'live_singleton_coin_metadata.amount');
    const intakeCoinId = readString(singletonCoin, 'coin_id', failures, 'verified_spend_builder_intake.singleton_coin.coin_id');
    const intakeParent = readString(singletonCoin, 'parent_coin_info', failures, 'verified_spend_builder_intake.singleton_coin.parent_coin_info');
    const intakePuzzleHash = readString(singletonCoin, 'puzzle_hash', failures, 'verified_spend_builder_intake.singleton_coin.puzzle_hash');
    const intakeAmount = readNumber(singletonCoin, 'amount', failures, 'verified_spend_builder_intake.singleton_coin.amount');

    const launcherId = readString(transition, 'launcher_id', failures, 'verified_spend_builder_intake.roster_transition.launcher_id');
    const spendTag = readNumber(transition, 'spend_tag', failures, 'verified_spend_builder_intake.roster_transition.spend_tag');
    const spendName = readString(transition, 'spend_name', failures, 'verified_spend_builder_intake.roster_transition.spend_name');
    const currentAuthorityVersion = readNumber(transition, 'current_authority_version', failures, 'verified_spend_builder_intake.roster_transition.current_authority_version');
    const newAuthorityVersion = readNumber(transition, 'new_authority_version', failures, 'verified_spend_builder_intake.roster_transition.new_authority_version');
    const currentStateHash = readString(transition, 'current_state_hash', failures, 'verified_spend_builder_intake.roster_transition.current_state_hash');
    const newStateHash = readString(transition, 'new_state_hash', failures, 'verified_spend_builder_intake.roster_transition.new_state_hash');
    const rosterUpdateBindingHash = readString(transition, 'roster_update_binding_hash', failures, 'verified_spend_builder_intake.roster_transition.roster_update_binding_hash');
    const currentMipsRootHash = readString(transition, 'current_mips_root_hash', failures, 'verified_spend_builder_intake.roster_transition.current_mips_root_hash');
    const newMipsRootHash = readString(transition, 'new_mips_root_hash', failures, 'verified_spend_builder_intake.roster_transition.new_mips_root_hash');
    const currentAdminsHash = readString(transition, 'current_admins_hash', failures, 'verified_spend_builder_intake.roster_transition.current_admins_hash');
    const newAdminsHash = readString(transition, 'new_admins_hash', failures, 'verified_spend_builder_intake.roster_transition.new_admins_hash');
    const currentPendingOpsHash = readString(transition, 'current_pending_ops_hash', failures, 'verified_spend_builder_intake.roster_transition.current_pending_ops_hash');
    const newPendingOpsHash = readString(transition, 'new_pending_ops_hash', failures, 'verified_spend_builder_intake.roster_transition.new_pending_ops_hash');

    const committedMipsPuzzleHash = readString(commitments, 'current_mips_puzzle_reveal_tree_hash', failures, 'verified_spend_builder_intake.deterministic_commitment_summary.current_mips_puzzle_reveal_tree_hash');
    const committedMipsSolutionHash = readString(commitments, 'current_mips_quorum_solution_tree_hash', failures, 'verified_spend_builder_intake.deterministic_commitment_summary.current_mips_quorum_solution_tree_hash');
    const committedInnerHash = readString(commitments, 'current_admin_authority_v2_inner_puzzle_reveal_tree_hash', failures, 'verified_spend_builder_intake.deterministic_commitment_summary.current_admin_authority_v2_inner_puzzle_reveal_tree_hash');
    const committedCurrentInnerHash = readString(commitments, 'computed_current_inner_puzzle_hash', failures, 'verified_spend_builder_intake.deterministic_commitment_summary.computed_current_inner_puzzle_hash');
    const committedCurrentStateHash = readString(commitments, 'computed_current_state_hash', failures, 'verified_spend_builder_intake.deterministic_commitment_summary.computed_current_state_hash');
    const committedFullPuzzleHash = readString(commitments, 'computed_singleton_full_puzzle_hash', failures, 'verified_spend_builder_intake.deterministic_commitment_summary.computed_singleton_full_puzzle_hash');
    const committedCoinId = readString(commitments, 'computed_live_singleton_coin_id', failures, 'verified_spend_builder_intake.deterministic_commitment_summary.computed_live_singleton_coin_id');

    compareHex(liveCoinId, intakeCoinId, 'live singleton coin id must match verified intake singleton coin id', failures);
    compareHex(liveParent, intakeParent, 'live singleton parent coin id must match verified intake singleton coin parent', failures);
    compareHex(livePuzzleHash, intakePuzzleHash, 'live singleton puzzle hash must match verified intake singleton coin puzzle hash', failures);
    compareNumber(liveAmount, intakeAmount, 'live singleton amount must match verified intake singleton coin amount', failures);

    const computedCoinId = computeCoinId(liveParent, livePuzzleHash, liveAmount, failures);
    compareHex(computedCoinId, liveCoinId, 'live singleton coin id must match parent coin id, puzzle hash, and amount', failures);
    compareHex(computedCoinId, committedCoinId, 'live singleton coin id must match verified intake commitment', failures);

    const computedMipsPuzzleHash = computeProgramTreeHash(() => this.v2.computeSerializedProgramTreeHash(rawCurrentMipsPuzzleReveal), 'raw current MIPS puzzle reveal hash verification failed', failures);
    const computedMipsSolutionHash = computeProgramTreeHash(() => this.v2.computeSerializedProgramTreeHash(rawCurrentMipsQuorumSolution), 'raw current MIPS quorum solution hash verification failed', failures);
    const computedInnerHash = computeProgramTreeHash(() => this.v2.computeSerializedProgramTreeHash(rawCurrentAuthorityInnerPuzzleReveal), 'raw current admin_authority_v2 inner puzzle reveal hash verification failed', failures);

    compareHex(computedMipsPuzzleHash, committedMipsPuzzleHash, 'raw current MIPS puzzle reveal hash must match verified intake commitment', failures);
    compareHex(computedMipsSolutionHash, committedMipsSolutionHash, 'raw current MIPS quorum solution hash must match verified intake commitment', failures);
    compareHex(computedInnerHash, committedInnerHash, 'raw current admin_authority_v2 inner puzzle reveal hash must match verified intake commitment', failures);
    compareHex(computedMipsPuzzleHash, currentMipsRootHash, 'raw current MIPS puzzle reveal hash must match verified intake current_mips_root_hash', failures);

    const computedCurrentInnerHash = computeProgramTreeHash(() => {
      if (!currentMipsRootHash || !currentAdminsHash || !currentPendingOpsHash || currentAuthorityVersion === null) throw new Error('missing current state fields');
      return bytesToHexPrefixed(this.v2.makeInnerPuzzleHash({
        mipsRootHash: currentMipsRootHash,
        adminsHash: currentAdminsHash,
        pendingOpsHash: currentPendingOpsHash,
        authorityVersion: currentAuthorityVersion,
      }));
    }, 'current inner puzzle hash recomputation failed', failures);
    compareHex(computedCurrentInnerHash, computedInnerHash, 'current inner puzzle hash must match raw current inner reveal hash', failures);
    compareHex(computedCurrentInnerHash, committedCurrentInnerHash, 'current inner puzzle hash must match verified intake current inner commitment', failures);

    const computedCurrentStateHash = computeProgramTreeHash(() => {
      if (!currentMipsRootHash || !currentAdminsHash || !currentPendingOpsHash || currentAuthorityVersion === null) throw new Error('missing current state fields');
      return bytesToHexPrefixed(this.v2.computeStateHash({
        mipsRootHash: currentMipsRootHash,
        adminsHash: currentAdminsHash,
        pendingOpsHash: currentPendingOpsHash,
        authorityVersion: currentAuthorityVersion,
      }));
    }, 'current state hash recomputation failed', failures);
    compareHex(computedCurrentStateHash, currentStateHash, 'current state hash must match verified intake current state hash', failures);
    compareHex(computedCurrentStateHash, committedCurrentStateHash, 'current state hash must match verified intake current state commitment', failures);

    const computedCurrentFullPuzzleHash = computeProgramTreeHash(() => {
      if (!launcherId || !computedCurrentInnerHash) throw new Error('missing launcher id or current inner puzzle hash');
      return bytesToHexPrefixed(this.v2.singletonFullPuzzleHash(launcherId, computedCurrentInnerHash));
    }, 'current singleton full puzzle hash recomputation failed', failures);
    compareHex(computedCurrentFullPuzzleHash, committedFullPuzzleHash, 'singleton full puzzle hash must match verified intake commitment', failures);
    compareHex(computedCurrentFullPuzzleHash, livePuzzleHash, 'singleton full puzzle hash must match live coin puzzle hash', failures);

    const computedNewStateHash = computeProgramTreeHash(() => {
      if (!newMipsRootHash || !newAdminsHash || !newPendingOpsHash || newAuthorityVersion === null) throw new Error('missing new state fields');
      return bytesToHexPrefixed(this.v2.computeStateHash({
        mipsRootHash: newMipsRootHash,
        adminsHash: newAdminsHash,
        pendingOpsHash: newPendingOpsHash,
        authorityVersion: newAuthorityVersion,
      }));
    }, 'new state hash recomputation failed', failures);
    compareHex(computedNewStateHash, newStateHash, 'new state hash must match verified intake new state hash', failures);

    const computedRosterUpdateBindingHash = computeProgramTreeHash(() => {
      if (!currentMipsRootHash || !currentAdminsHash || !currentPendingOpsHash || currentAuthorityVersion === null || !newAdminsHash || !newMipsRootHash || newAuthorityVersion === null) {
        throw new Error('missing roster transition fields');
      }
      return bytesToHexPrefixed(this.v2.computeRosterUpdateBindingHash({
        currentMipsRootHash,
        currentAdminsHash,
        currentPendingOpsHash,
        currentAuthorityVersion,
        newAdminsHash,
        newMipsRootHash,
        newAuthorityVersion,
      }));
    }, 'roster update binding hash recomputation failed', failures);
    compareHex(computedRosterUpdateBindingHash, rosterUpdateBindingHash, 'roster update binding hash must match verified intake transition', failures);

    const computedNewInnerHash = computeProgramTreeHash(() => {
      if (!newMipsRootHash || !newAdminsHash || !newPendingOpsHash || newAuthorityVersion === null) throw new Error('missing new state fields');
      return bytesToHexPrefixed(this.v2.makeInnerPuzzleHash({
        mipsRootHash: newMipsRootHash,
        adminsHash: newAdminsHash,
        pendingOpsHash: newPendingOpsHash,
        authorityVersion: newAuthorityVersion,
      }));
    }, 'new inner puzzle hash recomputation failed', failures);

    const computedNewFullPuzzleHash = computeProgramTreeHash(() => {
      if (!launcherId || !computedNewInnerHash) throw new Error('missing launcher id or new inner puzzle hash');
      return bytesToHexPrefixed(this.v2.singletonFullPuzzleHash(launcherId, computedNewInnerHash));
    }, 'new singleton full puzzle hash recomputation failed', failures);

    const plan = failures.length ? null : {
      version: 1,
      kind: 'admin_authority_v2_roster_update_unsigned_clvm_construction_plan',
      boundary: A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.boundary,
      result: A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.result,
      source_intake: {
        kind: 'admin_authority_v2_roster_update_spend_builder_verified_intake',
        result: 'verified_intake_only_no_signed_bundle',
        singleton_coin_id: normalizeHex(computedCoinId ?? liveCoinId ?? ''),
        launcher_id: normalizeHex(launcherId ?? ''),
        roster_update_binding_hash: normalizeHex(computedRosterUpdateBindingHash ?? rosterUpdateBindingHash ?? ''),
      },
      unsigned_admin_authority_v2_spend_shape: {
        coin: {
          coin_id: normalizeHex(computedCoinId ?? liveCoinId ?? ''),
          parent_coin_info: normalizeHex(liveParent ?? ''),
          puzzle_hash: normalizeHex(livePuzzleHash ?? ''),
          amount: liveAmount ?? 0,
        },
        singleton_launcher_id: normalizeHex(launcherId ?? ''),
        current_singleton_full_puzzle_hash: normalizeHex(computedCurrentFullPuzzleHash ?? ''),
        current_inner_puzzle_hash: normalizeHex(computedCurrentInnerHash ?? ''),
        new_inner_puzzle_hash: normalizeHex(computedNewInnerHash ?? ''),
        new_singleton_full_puzzle_hash: normalizeHex(computedNewFullPuzzleHash ?? ''),
        spend_tag: spendTag ?? 0,
        spend_name: spendName ?? '',
        current_state_hash: normalizeHex(computedCurrentStateHash ?? currentStateHash ?? ''),
        new_state_hash: normalizeHex(computedNewStateHash ?? newStateHash ?? ''),
        roster_update_binding_hash: normalizeHex(computedRosterUpdateBindingHash ?? rosterUpdateBindingHash ?? ''),
        puzzle_reveal_status: 'derived_from_verified_singleton_wrapper_and_inner_reveal_hash_not_serialized',
        solution_status: 'planned_only_not_serialized_as_coin_spend',
      },
      unsigned_mips_spend_shape: {
        puzzle_reveal_tree_hash: normalizeHex(computedMipsPuzzleHash ?? ''),
        quorum_solution_tree_hash: normalizeHex(computedMipsSolutionHash ?? ''),
        authorization_scope: 'current_admin_authority_v2_mips_quorum',
        execution_status: 'not_executed',
        solution_status: 'hash_verified_not_executed_not_serialized_as_coin_spend',
      },
      expected_conditions_summary: {
        state_announcement: {
          body_shape: 'protocol_prefix_spend_tag_state_hash',
          spend_tag: spendTag ?? 0,
          state_hash: normalizeHex(computedNewStateHash ?? newStateHash ?? ''),
        },
        singleton_continuation: {
          launcher_id: normalizeHex(launcherId ?? ''),
          next_inner_puzzle_hash: normalizeHex(computedNewInnerHash ?? ''),
          next_full_puzzle_hash: normalizeHex(computedNewFullPuzzleHash ?? ''),
          amount: liveAmount ?? 0,
        },
      },
      deterministic_unsigned_construction_summary: {
        current_mips_puzzle_reveal_tree_hash: normalizeHex(computedMipsPuzzleHash ?? ''),
        current_mips_quorum_solution_tree_hash: normalizeHex(computedMipsSolutionHash ?? ''),
        current_admin_authority_v2_inner_puzzle_reveal_tree_hash: normalizeHex(computedInnerHash ?? ''),
        current_singleton_full_puzzle_hash: normalizeHex(computedCurrentFullPuzzleHash ?? ''),
        current_state_hash: normalizeHex(computedCurrentStateHash ?? ''),
        new_admin_authority_v2_inner_puzzle_hash: normalizeHex(computedNewInnerHash ?? ''),
        new_singleton_full_puzzle_hash: normalizeHex(computedNewFullPuzzleHash ?? ''),
        new_state_hash: normalizeHex(computedNewStateHash ?? ''),
        roster_update_binding_hash: normalizeHex(computedRosterUpdateBindingHash ?? ''),
      },
      raw_material_status: {
        current_mips_puzzle_reveal: 'received_and_hash_verified_not_executed_not_output',
        current_mips_quorum_solution: 'received_and_hash_verified_not_executed_not_output',
        current_admin_authority_v2_inner_puzzle_reveal: 'received_and_hash_verified_not_output',
      },
      allowed_outputs: [...A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.allowedOutputs],
      local_only_boundaries: [
        'mips_not_executed',
        'coin_spends_not_serialized',
        'wallet_signature_not_collected',
        'transaction_not_signed',
        'transaction_not_broadcast',
        'backend_not_called',
        'raw_reveal_bytes_not_output',
      ],
    } satisfies AdminRosterUnsignedClvmConstructionPlan;

    return constructionResult(failures, plan);
  }
}

export interface AdminRosterUnsignedClvmConstructionRequest {
  verifiedSpendBuilderIntake: unknown;
  rawCurrentMipsPuzzleReveal: string;
  rawCurrentMipsQuorumSolution: string;
  rawCurrentAdminAuthorityV2InnerPuzzleReveal: string;
  liveSingletonCoinMetadata: unknown;
}

export interface AdminRosterUnsignedClvmConstructionResult {
  ok: boolean;
  status: string;
  failures: string[];
  plan: AdminRosterUnsignedClvmConstructionPlan | null;
}

export interface AdminRosterUnsignedClvmConstructionPlan {
  version: 1;
  kind: 'admin_authority_v2_roster_update_unsigned_clvm_construction_plan';
  boundary: typeof A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.boundary;
  result: typeof A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.result;
  source_intake: {
    kind: AdminRosterSpendBuilderVerifiedIntake['kind'];
    result: AdminRosterSpendBuilderVerifiedIntake['result'];
    singleton_coin_id: string;
    launcher_id: string;
    roster_update_binding_hash: string;
  };
  unsigned_admin_authority_v2_spend_shape: {
    coin: {
      coin_id: string;
      parent_coin_info: string;
      puzzle_hash: string;
      amount: number;
    };
    singleton_launcher_id: string;
    current_singleton_full_puzzle_hash: string;
    current_inner_puzzle_hash: string;
    new_inner_puzzle_hash: string;
    new_singleton_full_puzzle_hash: string;
    spend_tag: number;
    spend_name: string;
    current_state_hash: string;
    new_state_hash: string;
    roster_update_binding_hash: string;
    puzzle_reveal_status: string;
    solution_status: string;
  };
  unsigned_mips_spend_shape: {
    puzzle_reveal_tree_hash: string;
    quorum_solution_tree_hash: string;
    authorization_scope: string;
    execution_status: string;
    solution_status: string;
  };
  expected_conditions_summary: {
    state_announcement: {
      body_shape: string;
      spend_tag: number;
      state_hash: string;
    };
    singleton_continuation: {
      launcher_id: string;
      next_inner_puzzle_hash: string;
      next_full_puzzle_hash: string;
      amount: number;
    };
  };
  deterministic_unsigned_construction_summary: {
    current_mips_puzzle_reveal_tree_hash: string;
    current_mips_quorum_solution_tree_hash: string;
    current_admin_authority_v2_inner_puzzle_reveal_tree_hash: string;
    current_singleton_full_puzzle_hash: string;
    current_state_hash: string;
    new_admin_authority_v2_inner_puzzle_hash: string;
    new_singleton_full_puzzle_hash: string;
    new_state_hash: string;
    roster_update_binding_hash: string;
  };
  raw_material_status: {
    current_mips_puzzle_reveal: string;
    current_mips_quorum_solution: string;
    current_admin_authority_v2_inner_puzzle_reveal: string;
  };
  allowed_outputs: string[];
  local_only_boundaries: string[];
}

type JsonRecord = Record<string, unknown>;

function constructionResult(failures: string[], plan: AdminRosterUnsignedClvmConstructionPlan | null): AdminRosterUnsignedClvmConstructionResult {
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? A5_ROSTER_UPDATE_UNSIGNED_CLVM_CONSTRUCTION_CONTRACT.result : 'fails_unsigned_clvm_construction_rechecks',
    failures,
    plan,
  };
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

function readRecord(root: JsonRecord, key: string, failures: string[], path = key): JsonRecord | null {
  const record = asRecord(root[key]);
  if (!record) failures.push(`${path} must be an object`);
  return record;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function readInputString(value: unknown, path: string, failures: string[]): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    failures.push(`${path} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function readString(root: JsonRecord, key: string, failures: string[], path = key): string | null {
  const value = root[key];
  if (typeof value !== 'string' || !value.trim()) {
    failures.push(`${path} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function readNumber(root: JsonRecord, key: string, failures: string[], path = key): number | null {
  const value = root[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    failures.push(`${path} must be an integer`);
    return null;
  }
  return value;
}

function expectString(root: JsonRecord, key: string, expected: string, failures: string[], path = key): void {
  const value = root[key];
  if (value !== expected) failures.push(`${path} must equal ${expected}`);
}

function compareNumber(actual: number | null, expected: number | null, message: string, failures: string[]): void {
  if (actual === null || expected === null) return;
  if (actual !== expected) failures.push(message);
}

function compareHex(actual: string | null, expected: string | null, message: string, failures: string[]): void {
  if (actual === null || expected === null) return;
  if (normalizeHex(actual) !== normalizeHex(expected)) failures.push(message);
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

function normalizeHex(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

function collectForbiddenMaterial(value: unknown, path: string, failures: string[]): void {
  const record = asRecord(value);
  if (!record) {
    if (Array.isArray(value)) value.forEach((item, index) => collectForbiddenMaterial(item, `${path}[${index}]`, failures));
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (isForbiddenKey(key)) failures.push(`${path}.${key} must not contain signing, backend, or credential material`);
    collectForbiddenMaterial(child, `${path}.${key}`, failures);
  }
}

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('wallet_signature') ||
    lower.includes('signed_spend_bundle') ||
    lower.includes('api_credentials') ||
    lower.includes('jwt') ||
    lower.includes('nonce') ||
    lower.includes('secret') ||
    lower.includes('bearer') ||
    lower.includes('private_key');
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
