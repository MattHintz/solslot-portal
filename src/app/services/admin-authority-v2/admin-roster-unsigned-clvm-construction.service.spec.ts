import { TestBed } from '@angular/core/testing';

import { coinId } from '../../utils/chia-hash';
import { AdminAuthorityV2Service } from './admin-authority-v2.service';
import {
  AdminRosterUnsignedClvmConstructionRequest,
  AdminRosterUnsignedClvmConstructionService,
} from './admin-roster-unsigned-clvm-construction.service';

const h = (byte: string) => '0x' + byte.repeat(32);
const CURRENT_STATE = h('11');
const CURRENT_FULL_PUZZLE = h('22');
const CURRENT_INNER = h('33');
const CURRENT_MIPS_SOLUTION = h('44');
const LIVE_PARENT = h('55');
const NEW_MIPS = h('66');
const NEW_ADMINS = h('77');
const NEW_INNER = h('88');
const NEW_FULL_PUZZLE = h('99');
const NEW_STATE = h('aa');
const ROSTER_BINDING = h('bb');
const CURRENT_ADMINS = h('cc');
const PENDING_OPS = h('dd');
const LAUNCHER_ID = h('ee');
const LIVE_COIN_ID = coinId(LIVE_PARENT, CURRENT_FULL_PUZZLE, 1);

type V2ConstructionSpy = Pick<AdminAuthorityV2Service,
  'computeSerializedProgramTreeHash' |
  'makeInnerPuzzleHash' |
  'singletonFullPuzzleHash' |
  'computeStateHash' |
  'computeRosterUpdateBindingHash'
>;

describe('AdminRosterUnsignedClvmConstructionService', () => {
  let service: AdminRosterUnsignedClvmConstructionService;
  let v2: jasmine.SpyObj<V2ConstructionSpy>;

  beforeEach(() => {
    v2 = jasmine.createSpyObj('AdminAuthorityV2Service', [
      'computeSerializedProgramTreeHash',
      'makeInnerPuzzleHash',
      'singletonFullPuzzleHash',
      'computeStateHash',
      'computeRosterUpdateBindingHash',
    ]);
    v2.computeSerializedProgramTreeHash.and.callFake((programHex: string) => {
      if (programHex === 'ff80') return CURRENT_STATE;
      if (programHex === 'ff01') return CURRENT_MIPS_SOLUTION;
      if (programHex === 'ff02') return CURRENT_INNER;
      return h('f0');
    });
    v2.makeInnerPuzzleHash.and.callFake((args: { mipsRootHash: string }) => {
      return hexBytes(args.mipsRootHash === CURRENT_STATE ? CURRENT_INNER : NEW_INNER);
    });
    v2.singletonFullPuzzleHash.and.callFake((_launcherId: string, innerPuzzleHash: string) => {
      return hexBytes(innerPuzzleHash === CURRENT_INNER ? CURRENT_FULL_PUZZLE : NEW_FULL_PUZZLE);
    });
    v2.computeStateHash.and.callFake((args: { authorityVersion: number | bigint }) => {
      return hexBytes(Number(args.authorityVersion) === 1 ? CURRENT_STATE : NEW_STATE);
    });
    v2.computeRosterUpdateBindingHash.and.returnValue(hexBytes(ROSTER_BINDING));

    TestBed.configureTestingModule({
      providers: [
        AdminRosterUnsignedClvmConstructionService,
        { provide: AdminAuthorityV2Service, useValue: v2 },
      ],
    });
    service = TestBed.inject(AdminRosterUnsignedClvmConstructionService);
  });

  it('derives an unsigned construction plan without serializing coin spends or signing', () => {
    const result = service.plan(validRequest());

    expect(result.ok).toBeTrue();
    expect(result.status).toBe('unsigned_clvm_construction_plan_only_no_coin_spends');
    expect(result.failures).toEqual([]);
    expect(result.plan?.kind).toBe('admin_authority_v2_roster_update_unsigned_clvm_construction_plan');
    expect(result.plan?.boundary).toBe('derive_unsigned_clvm_construction_plan_without_coin_spend_serialization');
    expect(result.plan?.source_intake.result).toBe('verified_intake_only_no_signed_bundle');
    expect(result.plan?.unsigned_admin_authority_v2_spend_shape.coin.coin_id).toBe(LIVE_COIN_ID);
    expect(result.plan?.unsigned_admin_authority_v2_spend_shape.current_inner_puzzle_hash).toBe(CURRENT_INNER);
    expect(result.plan?.unsigned_admin_authority_v2_spend_shape.new_inner_puzzle_hash).toBe(NEW_INNER);
    expect(result.plan?.unsigned_admin_authority_v2_spend_shape.new_singleton_full_puzzle_hash).toBe(NEW_FULL_PUZZLE);
    expect(result.plan?.unsigned_mips_spend_shape.execution_status).toBe('not_executed');
    expect(result.plan?.expected_conditions_summary.state_announcement).toEqual({
      body_shape: 'protocol_prefix_spend_tag_state_hash',
      spend_tag: 0x07,
      state_hash: NEW_STATE,
    });
    expect(result.plan?.local_only_boundaries).toContain('mips_not_executed');
    expect(result.plan?.local_only_boundaries).toContain('coin_spends_not_serialized');
    expect(result.plan?.local_only_boundaries).toContain('wallet_signature_not_collected');
    expect(result.plan?.local_only_boundaries).toContain('transaction_not_broadcast');
    expect(result.plan?.local_only_boundaries).toContain('backend_not_called');
    expect(result.plan?.local_only_boundaries).toContain('raw_reveal_bytes_not_output');
    expect(JSON.stringify(result.plan)).not.toContain('ff80');
    expect(JSON.stringify(result.plan)).not.toContain('ff01');
    expect(JSON.stringify(result.plan)).not.toContain('ff02');
    expect(v2.computeSerializedProgramTreeHash).toHaveBeenCalledWith('ff80');
    expect(v2.computeSerializedProgramTreeHash).toHaveBeenCalledWith('ff01');
    expect(v2.computeSerializedProgramTreeHash).toHaveBeenCalledWith('ff02');
    expect(v2.computeRosterUpdateBindingHash).toHaveBeenCalledOnceWith({
      currentMipsRootHash: CURRENT_STATE,
      currentAdminsHash: CURRENT_ADMINS,
      currentPendingOpsHash: PENDING_OPS,
      currentAuthorityVersion: 1,
      newAdminsHash: NEW_ADMINS,
      newMipsRootHash: NEW_MIPS,
      newAuthorityVersion: 2,
    });
  });

  it('accepts a verified intake JSON string', () => {
    const request = validRequest();
    request.verifiedSpendBuilderIntake = JSON.stringify(request.verifiedSpendBuilderIntake);

    const result = service.plan(request);

    expect(result.ok).toBeTrue();
    expect(result.plan?.result).toBe('unsigned_clvm_construction_plan_only_no_coin_spends');
  });

  it('fails when the verified intake has crossed into a signed result', () => {
    const request = validRequest();
    const intake = request.verifiedSpendBuilderIntake as Record<string, unknown>;
    intake['result'] = 'signed_bundle_ready';

    const result = service.plan(request);

    expect(result.ok).toBeFalse();
    expect(result.plan).toBeNull();
    expect(result.failures).toContain('verified_spend_builder_intake.result must equal verified_intake_only_no_signed_bundle');
  });

  it('fails when raw MIPS material does not match verified intake commitments', () => {
    const request = validRequest();
    request.rawCurrentMipsPuzzleReveal = 'ff99';

    const result = service.plan(request);

    expect(result.ok).toBeFalse();
    expect(result.plan).toBeNull();
    expect(result.failures).toContain('raw current MIPS puzzle reveal hash must match verified intake commitment');
    expect(result.failures).toContain('raw current MIPS puzzle reveal hash must match verified intake current_mips_root_hash');
  });

  it('fails when live singleton metadata does not match the verified intake', () => {
    const request = validRequest();
    const liveCoin = request.liveSingletonCoinMetadata as Record<string, unknown>;
    liveCoin['puzzle_hash'] = NEW_FULL_PUZZLE;

    const result = service.plan(request);

    expect(result.ok).toBeFalse();
    expect(result.failures).toContain('live singleton puzzle hash must match verified intake singleton coin puzzle hash');
    expect(result.failures).toContain('live singleton coin id must match parent coin id, puzzle hash, and amount');
    expect(result.failures).toContain('singleton full puzzle hash must match live coin puzzle hash');
  });

  it('fails when recomputed new state does not match the verified intake transition', () => {
    const request = validRequest();
    const intake = request.verifiedSpendBuilderIntake as Record<string, unknown>;
    const transition = intake['roster_transition'] as Record<string, unknown>;
    transition['new_state_hash'] = h('ab');

    const result = service.plan(request);

    expect(result.ok).toBeFalse();
    expect(result.failures).toContain('new state hash must match verified intake new state hash');
  });

  it('rejects signing backend and credential material before planning', () => {
    const request = validRequest();
    const intake = request.verifiedSpendBuilderIntake as Record<string, unknown>;
    const liveCoin = request.liveSingletonCoinMetadata as Record<string, unknown>;
    intake['signed_spend_bundle'] = { aggregated_signature: h('ab') };
    liveCoin['jwt'] = 'header.payload.signature';

    const result = service.plan(request);

    expect(result.ok).toBeFalse();
    expect(result.plan).toBeNull();
    expect(result.failures.join('\n')).toContain('signed_spend_bundle must not contain signing, backend, or credential material');
    expect(result.failures.join('\n')).toContain('jwt must not contain signing, backend, or credential material');
  });
});

function validRequest(): AdminRosterUnsignedClvmConstructionRequest {
  return {
    verifiedSpendBuilderIntake: validVerifiedIntake(),
    rawCurrentMipsPuzzleReveal: 'ff80',
    rawCurrentMipsQuorumSolution: 'ff01',
    rawCurrentAdminAuthorityV2InnerPuzzleReveal: 'ff02',
    liveSingletonCoinMetadata: {
      coin_id: LIVE_COIN_ID,
      parent_coin_info: LIVE_PARENT,
      puzzle_hash: CURRENT_FULL_PUZZLE,
      amount: 1,
    },
  };
}

function validVerifiedIntake(): Record<string, unknown> {
  return {
    version: 1,
    kind: 'admin_authority_v2_roster_update_spend_builder_verified_intake',
    boundary: 'normalize_and_reverify_inputs_without_spend_construction',
    result: 'verified_intake_only_no_signed_bundle',
    singleton_coin: {
      coin_id: LIVE_COIN_ID,
      parent_coin_info: LIVE_PARENT,
      puzzle_hash: CURRENT_FULL_PUZZLE,
      amount: 1,
    },
    roster_transition: {
      launcher_id: LAUNCHER_ID,
      spend_tag: 0x07,
      spend_name: 'ADMIN_ROSTER_UPDATE',
      current_authority_version: 1,
      new_authority_version: 2,
      current_state_hash: CURRENT_STATE,
      new_state_hash: NEW_STATE,
      roster_update_binding_hash: ROSTER_BINDING,
      current_mips_root_hash: CURRENT_STATE,
      new_mips_root_hash: NEW_MIPS,
      current_admins_hash: CURRENT_ADMINS,
      new_admins_hash: NEW_ADMINS,
      current_pending_ops_hash: PENDING_OPS,
      new_pending_ops_hash: PENDING_OPS,
    },
    deterministic_commitment_summary: {
      current_mips_puzzle_reveal_tree_hash: CURRENT_STATE,
      current_mips_quorum_solution_tree_hash: CURRENT_MIPS_SOLUTION,
      current_admin_authority_v2_inner_puzzle_reveal_tree_hash: CURRENT_INNER,
      computed_current_inner_puzzle_hash: CURRENT_INNER,
      computed_current_state_hash: CURRENT_STATE,
      computed_singleton_full_puzzle_hash: CURRENT_FULL_PUZZLE,
      computed_live_singleton_coin_id: LIVE_COIN_ID,
    },
    raw_material_status: {
      current_mips_puzzle_reveal: 'received_and_hash_verified_not_executed_not_output',
      current_mips_quorum_solution: 'received_and_hash_verified_not_executed_not_output',
      current_admin_authority_v2_inner_puzzle_reveal: 'received_and_hash_verified_not_output',
    },
    allowed_outputs: [
      'normalized_spend_builder_intake',
      'deterministic_commitment_summary',
      'unsigned_construction_plan',
    ],
    local_only_boundaries: [
      'mips_not_executed',
      'clvm_spends_not_constructed',
      'wallet_signature_not_collected',
      'transaction_not_signed',
      'transaction_not_broadcast',
      'backend_not_called',
    ],
  };
}

function hexBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Uint8Array.from({ length: stripped.length / 2 }, (_, i) => parseInt(stripped.slice(i * 2, i * 2 + 2), 16));
}
