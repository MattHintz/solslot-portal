import { TestBed } from '@angular/core/testing';

import { coinId } from '../../utils/chia-hash';
import { AdminAuthorityV2Service } from './admin-authority-v2.service';
import {
  AdminRosterSpendBuilderIntakeRequest,
  AdminRosterSpendBuilderIntakeService,
} from './admin-roster-spend-builder-intake.service';

const H1 = '0x' + '11'.repeat(32);
const H2 = '0x' + '22'.repeat(32);
const H3 = '0x' + '33'.repeat(32);
const H4 = '0x' + '44'.repeat(32);
const H5 = '0x' + '55'.repeat(32);
const LIVE_COIN_ID = coinId(H5, H2, 1);

type V2IntakeSpy = Pick<AdminAuthorityV2Service,
  'computeSerializedProgramTreeHash' |
  'makeInnerPuzzleHash' |
  'singletonFullPuzzleHash' |
  'computeStateHash'
>;

describe('AdminRosterSpendBuilderIntakeService', () => {
  let service: AdminRosterSpendBuilderIntakeService;
  let v2: jasmine.SpyObj<V2IntakeSpy>;

  beforeEach(() => {
    v2 = jasmine.createSpyObj('AdminAuthorityV2Service', [
      'computeSerializedProgramTreeHash',
      'makeInnerPuzzleHash',
      'singletonFullPuzzleHash',
      'computeStateHash',
    ]);
    v2.computeSerializedProgramTreeHash.and.callFake((programHex: string) => {
      if (programHex === 'ff80') return H1;
      if (programHex === 'ff01') return H4;
      if (programHex === 'ff02') return H3;
      return '0x' + '99'.repeat(32);
    });
    v2.makeInnerPuzzleHash.and.returnValue(hexBytes(H3));
    v2.singletonFullPuzzleHash.and.returnValue(hexBytes(H2));
    v2.computeStateHash.and.returnValue(hexBytes(H1));

    TestBed.configureTestingModule({
      providers: [
        AdminRosterSpendBuilderIntakeService,
        { provide: AdminAuthorityV2Service, useValue: v2 },
      ],
    });
    service = TestBed.inject(AdminRosterSpendBuilderIntakeService);
  });

  it('normalizes and verifies intake without constructing spends or signing', () => {
    const result = service.verify(validRequest());

    expect(result.ok).toBeTrue();
    expect(result.status).toBe('verified_intake_only_no_signed_bundle');
    expect(result.failures).toEqual([]);
    expect(result.intake?.kind).toBe('admin_authority_v2_roster_update_spend_builder_verified_intake');
    expect(result.intake?.boundary).toBe('normalize_and_reverify_inputs_without_spend_construction');
    expect(result.intake?.singleton_coin.coin_id).toBe(LIVE_COIN_ID);
    expect(result.intake?.deterministic_commitment_summary.current_mips_puzzle_reveal_tree_hash).toBe(H1);
    expect(result.intake?.deterministic_commitment_summary.current_mips_quorum_solution_tree_hash).toBe(H4);
    expect(result.intake?.deterministic_commitment_summary.current_admin_authority_v2_inner_puzzle_reveal_tree_hash).toBe(H3);
    expect(result.intake?.deterministic_commitment_summary.computed_singleton_full_puzzle_hash).toBe(H2);
    expect(result.intake?.local_only_boundaries).toContain('mips_not_executed');
    expect(result.intake?.local_only_boundaries).toContain('clvm_spends_not_constructed');
    expect(result.intake?.local_only_boundaries).toContain('wallet_signature_not_collected');
    expect(result.intake?.local_only_boundaries).toContain('transaction_not_broadcast');
    expect(result.intake?.local_only_boundaries).toContain('backend_not_called');
    expect(JSON.stringify(result.intake)).not.toContain('ff80');
    expect(JSON.stringify(result.intake)).not.toContain('ff01');
    expect(JSON.stringify(result.intake)).not.toContain('ff02');
    expect(v2.computeSerializedProgramTreeHash).toHaveBeenCalledWith('ff80');
    expect(v2.computeSerializedProgramTreeHash).toHaveBeenCalledWith('ff01');
    expect(v2.computeSerializedProgramTreeHash).toHaveBeenCalledWith('ff02');
    expect(v2.makeInnerPuzzleHash).toHaveBeenCalledWith({
      mipsRootHash: H1,
      adminsHash: H2,
      pendingOpsHash: H3,
      authorityVersion: 1,
    });
    expect(v2.singletonFullPuzzleHash).toHaveBeenCalledWith(H4, H3);
  });

  it('accepts blueprint and report as JSON strings', () => {
    const request = validRequest();
    request.localUnsignedSpendBlueprint = JSON.stringify(request.localUnsignedSpendBlueprint);
    request.localVerificationReport = JSON.stringify(request.localVerificationReport);

    const result = service.verify(request);

    expect(result.ok).toBeTrue();
    expect(result.intake?.result).toBe('verified_intake_only_no_signed_bundle');
  });

  it('fails when blueprint and report commitments diverge', () => {
    const request = validRequest();
    const report = request.localVerificationReport as Record<string, unknown>;
    const commitments = report['signer_input_commitments'] as Record<string, unknown>;
    commitments['current_admin_authority_v2_inner_puzzle_reveal_tree_hash'] = H4;

    const result = service.verify(request);

    expect(result.ok).toBeFalse();
    expect(result.intake).toBeNull();
    expect(result.failures).toContain('blueprint verified inner puzzle hash must match report signer commitment');
  });

  it('fails when a raw reveal does not match the verified commitment', () => {
    const request = validRequest();
    request.rawCurrentMipsPuzzleReveal = 'ff99';

    const result = service.verify(request);

    expect(result.ok).toBeFalse();
    expect(result.failures).toContain('raw current MIPS puzzle reveal hash must match verified commitment');
    expect(result.failures).toContain('raw current MIPS puzzle reveal hash must match current_mips_root_hash');
  });

  it('fails when live coin id does not match parent puzzle hash and amount', () => {
    const request = validRequest();
    const liveCoin = request.liveSingletonCoinMetadata as Record<string, unknown>;
    liveCoin['coin_id'] = H1;

    const result = service.verify(request);

    expect(result.ok).toBeFalse();
    expect(result.failures).toContain('live singleton coin id must match parent coin id, puzzle hash, and amount');
  });

  it('fails when singleton full puzzle hash does not match the live coin puzzle hash', () => {
    v2.singletonFullPuzzleHash.and.returnValue(hexBytes(H5));

    const result = service.verify(validRequest());

    expect(result.ok).toBeFalse();
    expect(result.failures).toContain('singleton full puzzle hash must match verified commitment');
    expect(result.failures).toContain('singleton full puzzle hash must match live coin puzzle hash');
  });

  it('rejects signing backend and credential material at intake', () => {
    const request = validRequest();
    const blueprint = request.localUnsignedSpendBlueprint as Record<string, unknown>;
    const report = request.localVerificationReport as Record<string, unknown>;
    const liveCoin = request.liveSingletonCoinMetadata as Record<string, unknown>;
    blueprint['wallet_signature'] = '0x' + 'ab'.repeat(65);
    report['jwt'] = 'header.payload.signature';
    liveCoin['nonce'] = H1;

    const result = service.verify(request);

    expect(result.ok).toBeFalse();
    expect(result.intake).toBeNull();
    expect(result.failures.join('\n')).toContain('wallet_signature must not contain signing, backend, or credential material');
    expect(result.failures.join('\n')).toContain('jwt must not contain signing, backend, or credential material');
    expect(result.failures.join('\n')).toContain('nonce must not contain signing, backend, or credential material');
  });
});

function validRequest(): AdminRosterSpendBuilderIntakeRequest {
  return {
    localUnsignedSpendBlueprint: validBlueprint(),
    localVerificationReport: validReport(),
    rawCurrentMipsPuzzleReveal: 'ff80',
    rawCurrentMipsQuorumSolution: 'ff01',
    rawCurrentAdminAuthorityV2InnerPuzzleReveal: 'ff02',
    liveSingletonCoinMetadata: {
      coin_id: LIVE_COIN_ID,
      parent_coin_info: H5,
      puzzle_hash: H2,
      amount: 1,
    },
  };
}

function validBlueprint(): Record<string, unknown> {
  return {
    version: 1,
    kind: 'admin_authority_v2_roster_update_local_unsigned_spend_blueprint',
    construction_scope: 'local_blueprint_only_no_clvm_spends_no_finalization_no_broadcast',
    result: 'ready_for_future_spend_builder',
    singleton_coin: {
      coin_id: LIVE_COIN_ID,
      parent_coin_info: H5,
      puzzle_hash: H2,
      amount: 1,
    },
    roster_transition: {
      launcher_id: H4,
      spend_tag: 0x07,
      spend_name: 'ADMIN_ROSTER_UPDATE',
      current_authority_version: 1,
      new_authority_version: 2,
      current_state_hash: H1,
      new_state_hash: H2,
      roster_update_binding_hash: H3,
      current_mips_root_hash: H1,
      new_mips_root_hash: H2,
      current_admins_hash: H2,
      new_admins_hash: H3,
      current_pending_ops_hash: H3,
      new_pending_ops_hash: H3,
    },
    verified_commitments: {
      current_mips_puzzle_reveal_tree_hash: H1,
      current_mips_quorum_solution_tree_hash: H4,
      current_admin_authority_v2_inner_puzzle_reveal_tree_hash: H3,
      computed_singleton_full_puzzle_hash: H2,
    },
    deferred_material: [
      'raw_current_mips_puzzle_reveal',
      'raw_current_mips_quorum_solution',
      'raw_current_admin_authority_v2_inner_puzzle_reveal',
      'wallet_finalization_material',
      'api_credentials',
    ],
    local_only_boundaries: [
      'mips_not_executed',
      'clvm_spends_not_constructed',
      'transaction_not_finalized',
      'transaction_not_broadcast',
      'backend_not_called',
    ],
  };
}

function validReport(): Record<string, unknown> {
  return {
    version: 1,
    kind: 'admin_authority_v2_roster_update_local_verification_report',
    validation_scope: 'local_hash_verification_report_no_spend_execution',
    result: 'locally_verified_for_future_spend_builder',
    package: {
      kind: 'admin_authority_v2_roster_update_unsigned_package',
      network: 'testnet11',
      launcher_id: H4,
      spend_tag: 0x07,
      spend_name: 'ADMIN_ROSTER_UPDATE',
      current_authority_version: 1,
      new_authority_version: 2,
      current_state_hash: H1,
      new_state_hash: H2,
      roster_update_binding_hash: H3,
    },
    signer_input_commitments: {
      current_mips_puzzle_reveal_tree_hash: H1,
      current_mips_quorum_solution_tree_hash: H4,
      current_admin_authority_v2_inner_puzzle_reveal_tree_hash: H3,
      computed_singleton_full_puzzle_hash: H2,
      live_singleton_parent_coin_id: H5,
      live_singleton_puzzle_hash: H2,
      live_singleton_amount: 1,
      package_selected_coin_id: LIVE_COIN_ID,
    },
    omitted_inputs: [
      'raw_current_mips_puzzle_reveal',
      'raw_current_mips_quorum_solution',
      'raw_current_admin_authority_v2_inner_puzzle_reveal',
      'wallet_finalization_material',
      'api_credentials',
    ],
    local_only_boundaries: [
      'mips_not_executed',
      'clvm_spends_not_constructed',
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
