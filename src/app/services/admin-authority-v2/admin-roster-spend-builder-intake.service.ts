import { Injectable, inject } from '@angular/core';

import { A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT } from '../../docs/a5-roster-update-authorization.contract';
import { coinId } from '../../utils/chia-hash';
import { AdminAuthorityV2Service, bytesToHexPrefixed } from './admin-authority-v2.service';

@Injectable({ providedIn: 'root' })
export class AdminRosterSpendBuilderIntakeService {
  private readonly v2 = inject(AdminAuthorityV2Service);

  verify(input: AdminRosterSpendBuilderIntakeRequest): AdminRosterSpendBuilderIntakeResult {
    const failures: string[] = [];
    const blueprint = parseRecordInput(input.localUnsignedSpendBlueprint, 'local_unsigned_spend_blueprint', failures);
    const report = parseRecordInput(input.localVerificationReport, 'local_verification_report', failures);
    const liveCoin = readInputRecord(input.liveSingletonCoinMetadata, 'live_singleton_coin_metadata', failures);
    const rawCurrentMipsPuzzleReveal = readInputString(input.rawCurrentMipsPuzzleReveal, 'raw_current_mips_puzzle_reveal', failures);
    const rawCurrentMipsQuorumSolution = readInputString(input.rawCurrentMipsQuorumSolution, 'raw_current_mips_quorum_solution', failures);
    const rawCurrentAuthorityInnerPuzzleReveal = readInputString(
      input.rawCurrentAdminAuthorityV2InnerPuzzleReveal,
      'raw_current_admin_authority_v2_inner_puzzle_reveal',
      failures,
    );

    if (blueprint) collectForbiddenMaterial(blueprint, 'local_unsigned_spend_blueprint', failures);
    if (report) collectForbiddenMaterial(report, 'local_verification_report', failures);
    if (liveCoin) collectForbiddenMaterial(liveCoin, 'live_singleton_coin_metadata', failures);

    if (!blueprint || !report || !liveCoin || !rawCurrentMipsPuzzleReveal || !rawCurrentMipsQuorumSolution || !rawCurrentAuthorityInnerPuzzleReveal) {
      return intakeResult(failures, null);
    }

    expectString(blueprint, 'kind', 'admin_authority_v2_roster_update_local_unsigned_spend_blueprint', failures, 'blueprint.kind');
    expectString(blueprint, 'construction_scope', 'local_blueprint_only_no_clvm_spends_no_finalization_no_broadcast', failures, 'blueprint.construction_scope');
    expectString(blueprint, 'result', 'ready_for_future_spend_builder', failures, 'blueprint.result');
    expectString(report, 'kind', 'admin_authority_v2_roster_update_local_verification_report', failures, 'report.kind');
    expectString(report, 'validation_scope', 'local_hash_verification_report_no_spend_execution', failures, 'report.validation_scope');
    expectString(report, 'result', 'locally_verified_for_future_spend_builder', failures, 'report.result');

    const singletonCoin = readRecord(blueprint, 'singleton_coin', failures, 'blueprint.singleton_coin');
    const transition = readRecord(blueprint, 'roster_transition', failures, 'blueprint.roster_transition');
    const blueprintCommitments = readRecord(blueprint, 'verified_commitments', failures, 'blueprint.verified_commitments');
    const reportPackage = readRecord(report, 'package', failures, 'report.package');
    const reportCommitments = readRecord(report, 'signer_input_commitments', failures, 'report.signer_input_commitments');

    if (!singletonCoin || !transition || !blueprintCommitments || !reportPackage || !reportCommitments) {
      return intakeResult(failures, null);
    }

    const liveCoinId = readString(liveCoin, 'coin_id', failures, 'live_singleton_coin_metadata.coin_id');
    const liveParent = readString(liveCoin, 'parent_coin_info', failures, 'live_singleton_coin_metadata.parent_coin_info');
    const livePuzzleHash = readString(liveCoin, 'puzzle_hash', failures, 'live_singleton_coin_metadata.puzzle_hash');
    const liveAmount = readNumber(liveCoin, 'amount', failures, 'live_singleton_coin_metadata.amount');
    const blueprintCoinId = readString(singletonCoin, 'coin_id', failures, 'blueprint.singleton_coin.coin_id');
    const blueprintParent = readString(singletonCoin, 'parent_coin_info', failures, 'blueprint.singleton_coin.parent_coin_info');
    const blueprintPuzzleHash = readString(singletonCoin, 'puzzle_hash', failures, 'blueprint.singleton_coin.puzzle_hash');
    const blueprintAmount = readNumber(singletonCoin, 'amount', failures, 'blueprint.singleton_coin.amount');

    const launcherId = readString(transition, 'launcher_id', failures, 'blueprint.roster_transition.launcher_id');
    const spendName = readString(transition, 'spend_name', failures, 'blueprint.roster_transition.spend_name');
    const spendTag = readNumber(transition, 'spend_tag', failures, 'blueprint.roster_transition.spend_tag');
    const currentAuthorityVersion = readNumber(transition, 'current_authority_version', failures, 'blueprint.roster_transition.current_authority_version');
    const newAuthorityVersion = readNumber(transition, 'new_authority_version', failures, 'blueprint.roster_transition.new_authority_version');
    const currentStateHash = readString(transition, 'current_state_hash', failures, 'blueprint.roster_transition.current_state_hash');
    const newStateHash = readString(transition, 'new_state_hash', failures, 'blueprint.roster_transition.new_state_hash');
    const rosterUpdateBindingHash = readString(transition, 'roster_update_binding_hash', failures, 'blueprint.roster_transition.roster_update_binding_hash');
    const currentMipsRootHash = readString(transition, 'current_mips_root_hash', failures, 'blueprint.roster_transition.current_mips_root_hash');
    const currentAdminsHash = readString(transition, 'current_admins_hash', failures, 'blueprint.roster_transition.current_admins_hash');
    const currentPendingOpsHash = readString(transition, 'current_pending_ops_hash', failures, 'blueprint.roster_transition.current_pending_ops_hash');
    const newMipsRootHash = readString(transition, 'new_mips_root_hash', failures, 'blueprint.roster_transition.new_mips_root_hash');
    const newAdminsHash = readString(transition, 'new_admins_hash', failures, 'blueprint.roster_transition.new_admins_hash');
    const newPendingOpsHash = readString(transition, 'new_pending_ops_hash', failures, 'blueprint.roster_transition.new_pending_ops_hash');

    compareString(launcherId, readString(reportPackage, 'launcher_id', failures, 'report.package.launcher_id'), 'blueprint.roster_transition.launcher_id must match report.package.launcher_id', failures);
    compareNumber(spendTag, readNumber(reportPackage, 'spend_tag', failures, 'report.package.spend_tag'), 'blueprint.roster_transition.spend_tag must match report.package.spend_tag', failures);
    compareString(spendName, readString(reportPackage, 'spend_name', failures, 'report.package.spend_name'), 'blueprint.roster_transition.spend_name must match report.package.spend_name', failures);
    compareNumber(currentAuthorityVersion, readNumber(reportPackage, 'current_authority_version', failures, 'report.package.current_authority_version'), 'blueprint.roster_transition.current_authority_version must match report.package.current_authority_version', failures);
    compareNumber(newAuthorityVersion, readNumber(reportPackage, 'new_authority_version', failures, 'report.package.new_authority_version'), 'blueprint.roster_transition.new_authority_version must match report.package.new_authority_version', failures);
    compareHex(currentStateHash, readString(reportPackage, 'current_state_hash', failures, 'report.package.current_state_hash'), 'blueprint.roster_transition.current_state_hash must match report.package.current_state_hash', failures);
    compareHex(newStateHash, readString(reportPackage, 'new_state_hash', failures, 'report.package.new_state_hash'), 'blueprint.roster_transition.new_state_hash must match report.package.new_state_hash', failures);
    compareHex(rosterUpdateBindingHash, readString(reportPackage, 'roster_update_binding_hash', failures, 'report.package.roster_update_binding_hash'), 'blueprint.roster_transition.roster_update_binding_hash must match report.package.roster_update_binding_hash', failures);

    const blueprintMipsRevealHash = readString(blueprintCommitments, 'current_mips_puzzle_reveal_tree_hash', failures, 'blueprint.verified_commitments.current_mips_puzzle_reveal_tree_hash');
    const blueprintMipsSolutionHash = readString(blueprintCommitments, 'current_mips_quorum_solution_tree_hash', failures, 'blueprint.verified_commitments.current_mips_quorum_solution_tree_hash');
    const blueprintInnerHash = readString(blueprintCommitments, 'current_admin_authority_v2_inner_puzzle_reveal_tree_hash', failures, 'blueprint.verified_commitments.current_admin_authority_v2_inner_puzzle_reveal_tree_hash');
    const blueprintFullPuzzleHash = readString(blueprintCommitments, 'computed_singleton_full_puzzle_hash', failures, 'blueprint.verified_commitments.computed_singleton_full_puzzle_hash');
    const reportMipsRevealHash = readString(reportCommitments, 'current_mips_puzzle_reveal_tree_hash', failures, 'report.signer_input_commitments.current_mips_puzzle_reveal_tree_hash');
    const reportMipsSolutionHash = readString(reportCommitments, 'current_mips_quorum_solution_tree_hash', failures, 'report.signer_input_commitments.current_mips_quorum_solution_tree_hash');
    const reportInnerHash = readString(reportCommitments, 'current_admin_authority_v2_inner_puzzle_reveal_tree_hash', failures, 'report.signer_input_commitments.current_admin_authority_v2_inner_puzzle_reveal_tree_hash');
    const reportFullPuzzleHash = readString(reportCommitments, 'computed_singleton_full_puzzle_hash', failures, 'report.signer_input_commitments.computed_singleton_full_puzzle_hash');
    const reportLiveParent = readString(reportCommitments, 'live_singleton_parent_coin_id', failures, 'report.signer_input_commitments.live_singleton_parent_coin_id');
    const reportLivePuzzleHash = readString(reportCommitments, 'live_singleton_puzzle_hash', failures, 'report.signer_input_commitments.live_singleton_puzzle_hash');
    const reportLiveAmount = readNumber(reportCommitments, 'live_singleton_amount', failures, 'report.signer_input_commitments.live_singleton_amount');

    compareHex(blueprintMipsRevealHash, reportMipsRevealHash, 'blueprint verified MIPS reveal hash must match report signer commitment', failures);
    compareHex(blueprintMipsSolutionHash, reportMipsSolutionHash, 'blueprint verified MIPS solution hash must match report signer commitment', failures);
    compareHex(blueprintInnerHash, reportInnerHash, 'blueprint verified inner puzzle hash must match report signer commitment', failures);
    compareHex(blueprintFullPuzzleHash, reportFullPuzzleHash, 'blueprint computed singleton full puzzle hash must match report signer commitment', failures);

    compareHex(liveParent, blueprintParent, 'live singleton parent coin id must match blueprint singleton coin parent', failures);
    compareHex(livePuzzleHash, blueprintPuzzleHash, 'live singleton puzzle hash must match blueprint singleton coin puzzle hash', failures);
    compareNumber(liveAmount, blueprintAmount, 'live singleton amount must match blueprint singleton coin amount', failures);
    compareHex(liveParent, reportLiveParent, 'live singleton parent coin id must match report signer commitment', failures);
    compareHex(livePuzzleHash, reportLivePuzzleHash, 'live singleton puzzle hash must match report signer commitment', failures);
    compareNumber(liveAmount, reportLiveAmount, 'live singleton amount must match report signer commitment', failures);

    const computedCoinId = computeCoinId(liveParent, livePuzzleHash, liveAmount, failures);
    compareHex(computedCoinId, liveCoinId, 'live singleton coin id must match parent coin id, puzzle hash, and amount', failures);
    compareHex(computedCoinId, blueprintCoinId, 'blueprint singleton coin id must match parent coin id, puzzle hash, and amount', failures);

    const computedMipsRevealHash = computeProgramTreeHash(() => this.v2.computeSerializedProgramTreeHash(rawCurrentMipsPuzzleReveal), 'raw current MIPS puzzle reveal hash verification failed', failures);
    const computedMipsSolutionHash = computeProgramTreeHash(() => this.v2.computeSerializedProgramTreeHash(rawCurrentMipsQuorumSolution), 'raw current MIPS quorum solution hash verification failed', failures);
    const computedInnerHash = computeProgramTreeHash(() => this.v2.computeSerializedProgramTreeHash(rawCurrentAuthorityInnerPuzzleReveal), 'raw current admin_authority_v2 inner puzzle reveal hash verification failed', failures);

    compareHex(computedMipsRevealHash, blueprintMipsRevealHash, 'raw current MIPS puzzle reveal hash must match verified commitment', failures);
    compareHex(computedMipsSolutionHash, blueprintMipsSolutionHash, 'raw current MIPS quorum solution hash must match verified commitment', failures);
    compareHex(computedInnerHash, blueprintInnerHash, 'raw current admin_authority_v2 inner puzzle reveal hash must match verified commitment', failures);
    compareHex(computedMipsRevealHash, currentMipsRootHash, 'raw current MIPS puzzle reveal hash must match current_mips_root_hash', failures);

    const computedCurrentInnerHash = computeProgramTreeHash(() => {
      if (!currentMipsRootHash || !currentAdminsHash || !currentPendingOpsHash || currentAuthorityVersion === null) {
        throw new Error('missing current state fields');
      }
      return bytesToHexPrefixed(this.v2.makeInnerPuzzleHash({
        mipsRootHash: currentMipsRootHash,
        adminsHash: currentAdminsHash,
        pendingOpsHash: currentPendingOpsHash,
        authorityVersion: currentAuthorityVersion,
      }));
    }, 'current inner puzzle hash recomputation failed', failures);
    compareHex(computedInnerHash, computedCurrentInnerHash, 'current inner puzzle hash must match current state commitment', failures);

    const computedCurrentStateHash = computeProgramTreeHash(() => {
      if (!currentMipsRootHash || !currentAdminsHash || !currentPendingOpsHash || currentAuthorityVersion === null) {
        throw new Error('missing current state fields');
      }
      return bytesToHexPrefixed(this.v2.computeStateHash({
        mipsRootHash: currentMipsRootHash,
        adminsHash: currentAdminsHash,
        pendingOpsHash: currentPendingOpsHash,
        authorityVersion: currentAuthorityVersion,
      }));
    }, 'current state hash recomputation failed', failures);
    compareHex(computedCurrentStateHash, currentStateHash, 'current state hash must match current state commitment fields', failures);

    const computedFullPuzzleHash = computeProgramTreeHash(() => {
      if (!launcherId || !computedInnerHash) throw new Error('missing launcher id or inner puzzle hash');
      return bytesToHexPrefixed(this.v2.singletonFullPuzzleHash(launcherId, computedInnerHash));
    }, 'singleton full puzzle hash recomputation failed', failures);
    compareHex(computedFullPuzzleHash, blueprintFullPuzzleHash, 'singleton full puzzle hash must match verified commitment', failures);
    compareHex(computedFullPuzzleHash, livePuzzleHash, 'singleton full puzzle hash must match live coin puzzle hash', failures);

    const intake = failures.length ? null : {
      version: 1,
      kind: 'admin_authority_v2_roster_update_spend_builder_verified_intake',
      boundary: A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.boundary,
      result: A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.result,
      singleton_coin: {
        coin_id: normalizeHex(computedCoinId ?? liveCoinId ?? ''),
        parent_coin_info: normalizeHex(liveParent ?? ''),
        puzzle_hash: normalizeHex(livePuzzleHash ?? ''),
        amount: liveAmount ?? 0,
      },
      roster_transition: {
        launcher_id: normalizeHex(launcherId ?? ''),
        spend_tag: spendTag ?? 0,
        spend_name: spendName ?? '',
        current_authority_version: currentAuthorityVersion ?? 0,
        new_authority_version: newAuthorityVersion ?? 0,
        current_state_hash: normalizeHex(currentStateHash ?? ''),
        new_state_hash: normalizeHex(newStateHash ?? ''),
        roster_update_binding_hash: normalizeHex(rosterUpdateBindingHash ?? ''),
        current_mips_root_hash: normalizeHex(currentMipsRootHash ?? ''),
        new_mips_root_hash: normalizeHex(newMipsRootHash ?? ''),
        current_admins_hash: normalizeHex(currentAdminsHash ?? ''),
        new_admins_hash: normalizeHex(newAdminsHash ?? ''),
        current_pending_ops_hash: normalizeHex(currentPendingOpsHash ?? ''),
        new_pending_ops_hash: normalizeHex(newPendingOpsHash ?? ''),
      },
      deterministic_commitment_summary: {
        current_mips_puzzle_reveal_tree_hash: normalizeHex(computedMipsRevealHash ?? ''),
        current_mips_quorum_solution_tree_hash: normalizeHex(computedMipsSolutionHash ?? ''),
        current_admin_authority_v2_inner_puzzle_reveal_tree_hash: normalizeHex(computedInnerHash ?? ''),
        computed_current_inner_puzzle_hash: normalizeHex(computedCurrentInnerHash ?? ''),
        computed_current_state_hash: normalizeHex(computedCurrentStateHash ?? ''),
        computed_singleton_full_puzzle_hash: normalizeHex(computedFullPuzzleHash ?? ''),
        computed_live_singleton_coin_id: normalizeHex(computedCoinId ?? ''),
      },
      raw_material_status: {
        current_mips_puzzle_reveal: 'received_and_hash_verified_not_executed_not_output',
        current_mips_quorum_solution: 'received_and_hash_verified_not_executed_not_output',
        current_admin_authority_v2_inner_puzzle_reveal: 'received_and_hash_verified_not_output',
      },
      allowed_outputs: [...A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.allowedOutputs],
      local_only_boundaries: [
        'mips_not_executed',
        'clvm_spends_not_constructed',
        'wallet_signature_not_collected',
        'transaction_not_signed',
        'transaction_not_broadcast',
        'backend_not_called',
      ],
    } satisfies AdminRosterSpendBuilderVerifiedIntake;

    return intakeResult(failures, intake);
  }
}

export interface AdminRosterSpendBuilderIntakeRequest {
  localUnsignedSpendBlueprint: unknown;
  localVerificationReport: unknown;
  rawCurrentMipsPuzzleReveal: string;
  rawCurrentMipsQuorumSolution: string;
  rawCurrentAdminAuthorityV2InnerPuzzleReveal: string;
  liveSingletonCoinMetadata: unknown;
}

export interface AdminRosterSpendBuilderIntakeResult {
  ok: boolean;
  status: string;
  failures: string[];
  intake: AdminRosterSpendBuilderVerifiedIntake | null;
}

export interface AdminRosterSpendBuilderVerifiedIntake {
  version: 1;
  kind: 'admin_authority_v2_roster_update_spend_builder_verified_intake';
  boundary: typeof A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.boundary;
  result: typeof A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.result;
  singleton_coin: {
    coin_id: string;
    parent_coin_info: string;
    puzzle_hash: string;
    amount: number;
  };
  roster_transition: {
    launcher_id: string;
    spend_tag: number;
    spend_name: string;
    current_authority_version: number;
    new_authority_version: number;
    current_state_hash: string;
    new_state_hash: string;
    roster_update_binding_hash: string;
    current_mips_root_hash: string;
    new_mips_root_hash: string;
    current_admins_hash: string;
    new_admins_hash: string;
    current_pending_ops_hash: string;
    new_pending_ops_hash: string;
  };
  deterministic_commitment_summary: {
    current_mips_puzzle_reveal_tree_hash: string;
    current_mips_quorum_solution_tree_hash: string;
    current_admin_authority_v2_inner_puzzle_reveal_tree_hash: string;
    computed_current_inner_puzzle_hash: string;
    computed_current_state_hash: string;
    computed_singleton_full_puzzle_hash: string;
    computed_live_singleton_coin_id: string;
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

function intakeResult(failures: string[], intake: AdminRosterSpendBuilderVerifiedIntake | null): AdminRosterSpendBuilderIntakeResult {
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? A5_ROSTER_UPDATE_SPEND_BUILDER_INTAKE_CONTRACT.result : 'fails_spend_builder_intake_rechecks',
    failures,
    intake,
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

function compareString(actual: string | null, expected: string | null, message: string, failures: string[]): void {
  if (actual === null || expected === null) return;
  if (actual !== expected) failures.push(message);
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
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectForbiddenMaterial(item, `${path}[${index}]`, failures));
    }
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
