import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RosterSpendPackageReviewComponent } from './roster-spend-package-review.component';
import { AdminAuthorityV2Service } from '../../../services/admin-authority-v2/admin-authority-v2.service';
import { AdminRosterMipsExecutionCoinSpendService } from '../../../services/admin-authority-v2/admin-roster-mips-execution-coin-spend.service';
import { AdminRosterUpdateService } from '../../../services/admin-roster-update.service';
import { coinId } from '../../../utils/chia-hash';

const H1 = '0x' + '11'.repeat(32);
const H2 = '0x' + '22'.repeat(32);
const H3 = '0x' + '33'.repeat(32);
const H4 = '0x' + '44'.repeat(32);

type V2ReviewSpy = Pick<
  AdminAuthorityV2Service,
  'validateUnsignedRosterSpendPackage'
    | 'computeSerializedProgramTreeHash'
    | 'makeInnerPuzzleHash'
    | 'singletonFullPuzzleHash'
    | 'computeStateHash'
    | 'computeRosterUpdateBindingHash'
>;

function validPackage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const pkg = {
    version: 1,
    kind: 'admin_authority_v2_roster_update_unsigned_package',
    network: 'testnet11',
    package_status: 'unsigned_package_only',
    signing_status: 'not_signed',
    broadcast_status: 'not_built_not_submitted',
    backend_dependency: 'optional_admin_cross_check_only',
    launcher_id: H4,
    activation_status: 'candidate_not_active_until_admin_roster_update_confirms',
    spend_intent: {
      kind: 'admin_authority_v2_roster_update',
      spend_tag: 7,
      spend_name: 'ADMIN_ROSTER_UPDATE',
      launcher_id: H4,
      current_state_hash: H1,
      new_state_hash: H2,
      roster_update_binding_hash: H3,
      binding_hash_source: 'local_admin_authority_v2_service',
      validation_scope: 'local_unsigned_package_no_broadcast',
    },
    current: {
      authority_version: 1,
      mips_root_hash: H1,
      admins_hash: H2,
      state_hash: H1,
      pending_ops_hash: H3,
      admin_records: [
        { admin_idx: 0, m_within: 1, leaves: [{ leaf_hash: H1 }] },
      ],
    },
    update: {
      new_authority_version: 2,
      new_admin_record: { admin_idx: 1, m_within: 1, leaves: [{ leaf_hash: H2 }] },
      new_threshold: 2,
      new_mips_member_hashes: [H1, H2],
      new_mips_root_hash: H2,
      new_admins_hash: H3,
      new_pending_ops_hash: H3,
      new_state_hash: H2,
      roster_update_binding_hash: H3,
      updated_admin_records: [
        { admin_idx: 0, m_within: 1, leaves: [{ leaf_hash: H1 }] },
        { admin_idx: 1, m_within: 1, leaves: [{ leaf_hash: H2 }] },
      ],
    },
    live_singleton: {
      source: 'operator_wallet_or_coinset_client',
      required_amount: 1,
      selected_coin: null,
    },
    required_local_signer_inputs: [
      'current MIPS puzzle reveal matching current.mips_root_hash',
      'wallet signature over final Chia spend bundle',
    ],
    optional_attachments: {
      api_cross_check_status: 'not checked',
      api_cross_check: null,
      api_live_singleton_lookup: null,
    },
  };
  return { ...pkg, ...overrides };
}

function packageWithFullRosterMaterialPrefill(): Record<string, unknown> {
  const pkg = validPackage();
  return {
    ...pkg,
    current: {
      ...(pkg['current'] as Record<string, unknown>),
      pending_ops: [],
    },
    live_singleton: {
      ...(pkg['live_singleton'] as Record<string, unknown>),
      singleton_lineage_proof: {
        parent_parent_coin_info: H1,
        parent_inner_puzzle_hash: null,
        parent_amount: 1,
      },
    },
  };
}

function fillSignerInputs(component: RosterSpendPackageReviewComponent, amount = '1'): void {
  component.setSignerInput('currentMipsPuzzleReveal', 'ff80');
  component.setSignerInput('currentMipsQuorumSolution', 'ff01');
  component.setSignerInput('currentAuthorityInnerPuzzleReveal', 'ff02');
  component.setSignerInput('liveSingletonParentCoinId', H1);
  component.setSignerInput('liveSingletonPuzzleHash', H2);
  component.setSignerInput('liveSingletonAmount', amount);
}

function fillRosterMaterialInputs(component: RosterSpendPackageReviewComponent): void {
  component.setRosterMaterialInput(
    'currentAdminRecordsJson',
    JSON.stringify([{ admin_idx: 0, m_within: 1, leaves: [{ leaf_hash: H1 }] }]),
  );
  component.setRosterMaterialInput('currentPendingOpsJson', JSON.stringify([]));
  component.setRosterMaterialInput(
    'newAdminRecordJson',
    JSON.stringify({ admin_idx: 1, m_within: 1, leaves: [{ leaf_hash: H2 }] }),
  );
  component.setRosterMaterialInput(
    'singletonLineageProofJson',
    JSON.stringify({ parent_parent_coin_info: H1, parent_inner_puzzle_hash: null, parent_amount: 1 }),
  );
}

function hexBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.slice(i * 2, i * 2 + 2), 16));
}

describe('RosterSpendPackageReviewComponent', () => {
  let fixture: ComponentFixture<RosterSpendPackageReviewComponent>;
  let component: RosterSpendPackageReviewComponent;
  let v2: jasmine.SpyObj<V2ReviewSpy>;
  let rosterUpdate: jasmine.SpyObj<Pick<AdminRosterUpdateService, 'prepare' | 'requestAdminChallenge' | 'loginAdmin' | 'lookupLiveSingleton'>>;
  let mipsCandidate: jasmine.SpyObj<Pick<AdminRosterMipsExecutionCoinSpendService, 'build'>>;

  beforeEach(async () => {
    v2 = jasmine.createSpyObj('AdminAuthorityV2Service', [
      'validateUnsignedRosterSpendPackage',
      'computeSerializedProgramTreeHash',
      'makeInnerPuzzleHash',
      'singletonFullPuzzleHash',
      'computeStateHash',
      'computeRosterUpdateBindingHash',
    ]);
    v2.validateUnsignedRosterSpendPackage.and.returnValue({
      ok: true,
      status: 'passes local checks',
      failures: [],
    });
    v2.computeSerializedProgramTreeHash.and.callFake((programHex: string) => {
      if (programHex === 'ff80') return H1;
      if (programHex === 'ff02') return H3;
      return H4;
    });
    v2.makeInnerPuzzleHash.and.returnValue(hexBytes(H3));
    v2.singletonFullPuzzleHash.and.returnValue(hexBytes(H2));
    v2.computeStateHash.and.callFake((args: { authorityVersion: number | bigint }) => {
      return hexBytes(Number(args.authorityVersion) === 1 ? H1 : H2);
    });
    v2.computeRosterUpdateBindingHash.and.returnValue(hexBytes(H3));
    rosterUpdate = jasmine.createSpyObj('AdminRosterUpdateService', [
      'prepare',
      'requestAdminChallenge',
      'loginAdmin',
      'lookupLiveSingleton',
    ]);
    mipsCandidate = jasmine.createSpyObj('AdminRosterMipsExecutionCoinSpendService', ['build']);
    mipsCandidate.build.and.returnValue({
      ok: true,
      status: 'unsigned_coin_spend_candidate_only_no_signatures',
      failures: [],
      candidate: {
        version: 1,
        kind: 'admin_authority_v2_roster_update_unsigned_coin_spend_candidate',
        boundary: 'execute_mips_and_serialize_unsigned_coin_spends_without_signing_or_broadcast',
        result: 'unsigned_coin_spend_candidate_only_no_signatures',
        unsigned_spend_bundle_candidate: {
          coin_spends: [
            {
              coin: { parentCoinInfo: H1, puzzleHash: H2, amount: 1 },
              puzzleReveal: '0xfeed',
              solution: '0xbeef',
            },
          ],
          signing_status: 'unsigned_no_signature_material',
          broadcast_status: 'not_broadcast',
        },
        boundary_guards: [
          'wallet_signature_not_collected',
          'transaction_not_signed',
          'transaction_not_broadcast',
        ],
      },
    } as unknown as ReturnType<AdminRosterMipsExecutionCoinSpendService['build']>);


    await TestBed.configureTestingModule({
      imports: [RosterSpendPackageReviewComponent],
      providers: [
        provideRouter([]),
        { provide: AdminAuthorityV2Service, useValue: v2 },
        { provide: AdminRosterUpdateService, useValue: rosterUpdate },
        { provide: AdminRosterMipsExecutionCoinSpendService, useValue: mipsCandidate },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RosterSpendPackageReviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders a valid pasted package with passing local preflight and summary', () => {
    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fixture.detectChanges();

    expect(component.preflight()?.ok).toBeTrue();
    expect(v2.validateUnsignedRosterSpendPackage).toHaveBeenCalledOnceWith(validPackage());
    expect(fixture.nativeElement.textContent).toContain('Unsigned package preflight: passes local checks');
    expect(fixture.nativeElement.textContent).toContain('Local package contract, hash, append-only roster, and secret-leak checks pass.');
    expect(fixture.nativeElement.textContent).toContain('testnet11');
    expect(fixture.nativeElement.textContent).toContain(H4);
    expect(fixture.nativeElement.textContent).toContain('current MIPS puzzle reveal matching current.mips_root_hash');
    const disabledButton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Build/sign roster spend unavailable'));
    expect(disabledButton?.disabled).toBeTrue();
  });

  it('renders invalid JSON parse errors without running preflight', () => {
    component.setPackageText('{ invalid json');
    fixture.detectChanges();

    expect(component.parseError()).toContain('Invalid JSON:');
    expect(component.preflight()).toBeNull();
    expect(v2.validateUnsignedRosterSpendPackage).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Invalid JSON:');
  });

  it('renders stale binding hash validator failures', () => {
    v2.validateUnsignedRosterSpendPackage.and.returnValue({
      ok: false,
      status: 'fails local checks',
      failures: ['update.roster_update_binding_hash must match computed roster update binding hash'],
    });

    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fixture.detectChanges();

    expect(component.preflight()?.ok).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Unsigned package preflight: fails local checks');
    expect(fixture.nativeElement.textContent).toContain(
      'update.roster_update_binding_hash must match computed roster update binding hash',
    );
  });

  it('keeps optional API attachments as review metadata when preflight passes', () => {
    const pkg = validPackage({
      optional_attachments: {
        api_cross_check_status: 'matches local preview',
        api_cross_check: { submission_status: 'validated_preview_only_roster_spend_not_submitted' },
        api_live_singleton_lookup: { lookup_status: 'found_unique_unspent_candidate' },
      },
    });

    component.setPackageText(JSON.stringify(pkg, null, 2));
    fixture.detectChanges();

    expect(component.preflight()?.ok).toBeTrue();
    expect(component.summary()?.apiCrossCheckStatus).toBe('matches local preview');
    expect(fixture.nativeElement.textContent).toContain('matches local preview');
  });

  it('keeps signer readiness incomplete when package passes but signer inputs are missing', () => {
    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fixture.detectChanges();

    expect(component.preflight()?.ok).toBeTrue();
    expect(component.signerInputReadiness().ok).toBeFalse();
    expect(component.localVerificationReportJson()).toBeNull();
    expect(component.localUnsignedSpendBlueprintJson()).toBeNull();
    expect(component.localUnsignedClvmConstructionPlanJson()).toBeNull();
    expect(component.signerInputReadiness().status).toBe('incomplete');
    expect(component.signerInputReadiness().failures).toContain('current MIPS puzzle reveal is required');
    expect(component.signerInputReadiness().failures).toContain('current MIPS quorum solution is required');
    expect(component.signerInputReadiness().failures).toContain(
      'current admin_authority_v2 inner puzzle reveal is required',
    );
    expect(fixture.nativeElement.textContent).toContain('Signer input readiness: incomplete');
  });

  it('marks signer inputs locally ready for a future spend builder when required fields are present', () => {
    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fillSignerInputs(component);
    fixture.detectChanges();

    expect(component.signerInputReadiness()).toEqual({
      ok: true,
      status: 'locally verified for future spend builder',
      failures: [],
    });
    expect(fixture.nativeElement.textContent).toContain(
      'Signer input readiness: locally verified for future spend builder',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Local signer inputs match package hashes for a future spend builder. Nothing is signed or broadcast here.',
    );
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

  it('renders a hash-only local verification report after signer input verification passes', () => {
    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fillSignerInputs(component);
    fixture.detectChanges();

    const reportJson = component.localVerificationReportJson();
    expect(reportJson).not.toBeNull();
    const report = JSON.parse(reportJson ?? '{}') as Record<string, unknown>;
    const commitments = report['signer_input_commitments'] as Record<string, unknown>;

    expect(report['kind']).toBe('admin_authority_v2_roster_update_local_verification_report');
    expect(report['validation_scope']).toBe('local_hash_verification_report_no_spend_execution');
    expect(report['result']).toBe('locally_verified_for_future_spend_builder');
    expect(commitments['current_mips_puzzle_reveal_tree_hash']).toBe(H1);
    expect(commitments['current_mips_quorum_solution_tree_hash']).toBe(H4);
    expect(commitments['current_admin_authority_v2_inner_puzzle_reveal_tree_hash']).toBe(H3);
    expect(commitments['computed_singleton_full_puzzle_hash']).toBe(H2);
    expect(reportJson).not.toContain('ff80');
    expect(reportJson).not.toContain('ff01');
    expect(reportJson).not.toContain('ff02');
    expect(reportJson?.toLowerCase()).not.toContain('jwt');
    expect(reportJson?.toLowerCase()).not.toContain('nonce');
    expect(reportJson?.toLowerCase()).not.toContain('bearer');
    expect(reportJson?.toLowerCase()).not.toContain('secret');
    expect(fixture.nativeElement.textContent).toContain('Local verification report');
    expect(fixture.nativeElement.textContent).toContain(
      'Hash-only report for handoff to a future spend builder.',
    );
  });

  it('renders a local unsigned spend blueprint after signer input verification passes', () => {
    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fillSignerInputs(component);
    fixture.detectChanges();

    const blueprintJson = component.localUnsignedSpendBlueprintJson();
    expect(blueprintJson).not.toBeNull();
    const blueprint = JSON.parse(blueprintJson ?? '{}') as Record<string, unknown>;
    const singletonCoin = blueprint['singleton_coin'] as Record<string, unknown>;
    const transition = blueprint['roster_transition'] as Record<string, unknown>;
    const commitments = blueprint['verified_commitments'] as Record<string, unknown>;
    const boundaries = blueprint['local_only_boundaries'] as string[];

    expect(blueprint['kind']).toBe('admin_authority_v2_roster_update_local_unsigned_spend_blueprint');
    expect(blueprint['construction_scope']).toBe('local_blueprint_only_no_clvm_spends_no_finalization_no_broadcast');
    expect(blueprint['result']).toBe('ready_for_future_spend_builder');
    expect(singletonCoin['coin_id']).toBe(coinId(H1, H2, 1));
    expect(singletonCoin['parent_coin_info']).toBe(H1);
    expect(singletonCoin['puzzle_hash']).toBe(H2);
    expect(singletonCoin['amount']).toBe(1);
    expect(transition['launcher_id']).toBe(H4);
    expect(transition['current_state_hash']).toBe(H1);
    expect(transition['new_state_hash']).toBe(H2);
    expect(transition['roster_update_binding_hash']).toBe(H3);
    expect(commitments['current_mips_puzzle_reveal_tree_hash']).toBe(H1);
    expect(commitments['current_mips_quorum_solution_tree_hash']).toBe(H4);
    expect(commitments['current_admin_authority_v2_inner_puzzle_reveal_tree_hash']).toBe(H3);
    expect(commitments['computed_singleton_full_puzzle_hash']).toBe(H2);
    expect(boundaries).toContain('clvm_spends_not_constructed');
    expect(boundaries).toContain('transaction_not_broadcast');
    expect(boundaries).toContain('backend_not_called');
    expect(blueprintJson).not.toContain('ff80');
    expect(blueprintJson).not.toContain('ff01');
    expect(blueprintJson).not.toContain('ff02');
    expect(blueprintJson?.toLowerCase()).not.toContain('jwt');
    expect(blueprintJson?.toLowerCase()).not.toContain('nonce');
    expect(blueprintJson?.toLowerCase()).not.toContain('bearer');
    expect(blueprintJson?.toLowerCase()).not.toContain('secret');
    expect(fixture.nativeElement.textContent).toContain('Local unsigned spend blueprint');
    expect(fixture.nativeElement.textContent).toContain('does not construct coin spends or collect');
  });

  it('renders a local unsigned CLVM construction plan after intake rechecks pass', () => {
    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fillSignerInputs(component);
    fixture.detectChanges();

    const planJson = component.localUnsignedClvmConstructionPlanJson();
    expect(planJson).not.toBeNull();
    const plan = JSON.parse(planJson ?? '{}') as Record<string, unknown>;
    const sourceIntake = plan['source_intake'] as Record<string, unknown>;
    const adminShape = plan['unsigned_admin_authority_v2_spend_shape'] as Record<string, unknown>;
    const mipsShape = plan['unsigned_mips_spend_shape'] as Record<string, unknown>;
    const conditions = plan['expected_conditions_summary'] as Record<string, unknown>;
    const stateAnnouncement = conditions['state_announcement'] as Record<string, unknown>;
    const summary = plan['deterministic_unsigned_construction_summary'] as Record<string, unknown>;
    const boundaries = plan['local_only_boundaries'] as string[];

    expect(plan['kind']).toBe('admin_authority_v2_roster_update_unsigned_clvm_construction_plan');
    expect(plan['boundary']).toBe('derive_unsigned_clvm_construction_plan_without_coin_spend_serialization');
    expect(plan['result']).toBe('unsigned_clvm_construction_plan_only_no_coin_spends');
    expect(sourceIntake['result']).toBe('verified_intake_only_no_signed_bundle');
    expect(adminShape['current_inner_puzzle_hash']).toBe(H3);
    expect(adminShape['new_state_hash']).toBe(H2);
    expect(adminShape['roster_update_binding_hash']).toBe(H3);
    expect(mipsShape['execution_status']).toBe('not_executed');
    expect(stateAnnouncement['body_shape']).toBe('protocol_prefix_spend_tag_state_hash');
    expect(stateAnnouncement['state_hash']).toBe(H2);
    expect(summary['current_mips_puzzle_reveal_tree_hash']).toBe(H1);
    expect(summary['current_mips_quorum_solution_tree_hash']).toBe(H4);
    expect(summary['current_admin_authority_v2_inner_puzzle_reveal_tree_hash']).toBe(H3);
    expect(boundaries).toContain('mips_not_executed');
    expect(boundaries).toContain('coin_spends_not_serialized');
    expect(boundaries).toContain('wallet_signature_not_collected');
    expect(boundaries).toContain('transaction_not_broadcast');
    expect(boundaries).toContain('backend_not_called');
    expect(boundaries).toContain('raw_reveal_bytes_not_output');
    expect(planJson).not.toContain('ff80');
    expect(planJson).not.toContain('ff01');
    expect(planJson).not.toContain('ff02');
    expect(planJson?.toLowerCase()).not.toContain('jwt');
    expect(planJson?.toLowerCase()).not.toContain('nonce');
    expect(planJson?.toLowerCase()).not.toContain('bearer');
    expect(planJson?.toLowerCase()).not.toContain('secret');
    expect(fixture.nativeElement.textContent).toContain('Local unsigned CLVM construction plan');
    expect(fixture.nativeElement.textContent).toContain('does not execute MIPS, serialize coin spends');
    expect(v2.computeStateHash).toHaveBeenCalledWith({
      mipsRootHash: H2,
      adminsHash: H3,
      pendingOpsHash: H3,
      authorityVersion: 2,
    });
    expect(v2.computeRosterUpdateBindingHash).toHaveBeenCalledWith({
      currentMipsRootHash: H1,
      currentAdminsHash: H2,
      currentPendingOpsHash: H3,
      currentAuthorityVersion: 1,
      newAdminsHash: H3,
      newMipsRootHash: H2,
      newAuthorityVersion: 2,
    });
  });

  it('keeps unsigned CoinSpend candidate unavailable until full roster material is supplied', () => {
    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fillSignerInputs(component);
    fixture.detectChanges();

    expect(component.rosterUpdateMaterialReadiness().ok).toBeFalse();
    expect(JSON.parse(component.effectiveCurrentAdminRecordsJson())).toEqual([
      { admin_idx: 0, m_within: 1, leaves: [{ leaf_hash: H1 }] },
    ]);
    expect(JSON.parse(component.effectiveNewAdminRecordJson())).toEqual(
      { admin_idx: 1, m_within: 1, leaves: [{ leaf_hash: H2 }] },
    );
    expect(component.rosterUpdateMaterialReadiness().failures).toContain('current pending ops JSON array is required');
    expect(component.rosterUpdateMaterialReadiness().failures).toContain('singleton lineage proof JSON object is required');
    expect(component.localUnsignedCoinSpendCandidateJson()).toBeNull();
    expect(mipsCandidate.build).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Roster material readiness: incomplete');
    expect(fixture.nativeElement.textContent).toContain('Public roster material may be prefilled from the package when present.');
    expect(fixture.nativeElement.textContent).toContain('Manual edits override prefilled values');
    expect(fixture.nativeElement.textContent).toContain('rechecked fail-closed');
  });

  it('prefills complete public roster material from the package for candidate construction', () => {
    component.setPackageText(JSON.stringify(packageWithFullRosterMaterialPrefill(), null, 2));
    fillSignerInputs(component);
    fixture.detectChanges();

    const call = mipsCandidate.build.calls.mostRecent().args[0];

    expect(component.currentAdminRecordsJson()).toBe('');
    expect(component.currentPendingOpsJson()).toBe('');
    expect(component.newAdminRecordJson()).toBe('');
    expect(component.singletonLineageProofJson()).toBe('');
    expect(component.rosterUpdateMaterialReadiness().ok).toBeTrue();
    expect(call.rosterUpdateMaterial).toEqual({
      current_admin_records: [{ admin_idx: 0, m_within: 1, leaves: [{ leaf_hash: H1 }] }],
      current_pending_ops: [],
      new_admin_record: { admin_idx: 1, m_within: 1, leaves: [{ leaf_hash: H2 }] },
      singleton_lineage_proof: { parent_parent_coin_info: H1, parent_inner_puzzle_hash: null, parent_amount: 1 },
    });
  });

  it('lets manual roster material inputs override package prefill', () => {
    const manualNewAdmin = { admin_idx: 1, m_within: 1, leaves: [{ leaf_hash: H4 }] };
    component.setPackageText(JSON.stringify(packageWithFullRosterMaterialPrefill(), null, 2));
    component.setRosterMaterialInput('newAdminRecordJson', JSON.stringify(manualNewAdmin));
    fillSignerInputs(component);
    fixture.detectChanges();

    const call = mipsCandidate.build.calls.mostRecent().args[0];

    expect(component.rosterUpdateMaterialReadiness().ok).toBeTrue();
    expect(call.rosterUpdateMaterial).toEqual(jasmine.objectContaining({
      new_admin_record: manualNewAdmin,
    }));
  });

  it('renders a local unsigned CoinSpend candidate after material parsing and candidate rechecks pass', () => {
    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fillSignerInputs(component);
    fillRosterMaterialInputs(component);
    fixture.detectChanges();

    const candidateJson = component.localUnsignedCoinSpendCandidateJson();
    expect(candidateJson).not.toBeNull();
    const candidate = JSON.parse(candidateJson ?? '{}') as Record<string, unknown>;
    const bundle = candidate['unsigned_spend_bundle_candidate'] as Record<string, unknown>;
    const call = mipsCandidate.build.calls.mostRecent().args[0];

    expect(component.rosterUpdateMaterialReadiness().ok).toBeTrue();
    expect(candidate['kind']).toBe('admin_authority_v2_roster_update_unsigned_coin_spend_candidate');
    expect(candidate['result']).toBe('unsigned_coin_spend_candidate_only_no_signatures');
    expect(bundle['signing_status']).toBe('unsigned_no_signature_material');
    expect(bundle['broadcast_status']).toBe('not_broadcast');
    expect(call.rosterUpdateMaterial).toEqual({
      current_admin_records: [{ admin_idx: 0, m_within: 1, leaves: [{ leaf_hash: H1 }] }],
      current_pending_ops: [],
      new_admin_record: { admin_idx: 1, m_within: 1, leaves: [{ leaf_hash: H2 }] },
      singleton_lineage_proof: { parent_parent_coin_info: H1, parent_inner_puzzle_hash: null, parent_amount: 1 },
    });
    expect(call.unsignedClvmConstructionPlan).toEqual(jasmine.objectContaining({
      result: 'unsigned_clvm_construction_plan_only_no_coin_spends',
    }));
    expect(call.verifiedSpendBuilderIntake).toEqual(jasmine.objectContaining({
      result: 'verified_intake_only_no_signed_bundle',
    }));
    expect(candidateJson).toContain('0xfeed');
    expect(candidateJson).toContain('0xbeef');
    expect(candidateJson?.toLowerCase()).not.toContain('aggregatedsignature');
    expect(candidateJson?.toLowerCase()).not.toContain('jwt');
    expect(candidateJson?.toLowerCase()).not.toContain('secret');
    expect(fixture.nativeElement.textContent).toContain('Local unsigned CoinSpend candidate');
    expect(fixture.nativeElement.textContent).toContain('it is not signed and is not broadcast');
  });

  it('fails local hash checks when the MIPS reveal does not match current.mips_root_hash', () => {
    v2.computeSerializedProgramTreeHash.and.callFake((programHex: string) => {
      if (programHex === 'ff80') return H4;
      if (programHex === 'ff02') return H3;
      return H4;
    });

    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fillSignerInputs(component);
    fixture.detectChanges();

    expect(component.signerInputReadiness().ok).toBeFalse();
    expect(component.signerInputReadiness().status).toBe('fails local hash checks');
    expect(component.signerInputReadiness().failures).toContain(
      'current MIPS puzzle reveal tree hash must match current.mips_root_hash',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'current MIPS puzzle reveal tree hash must match current.mips_root_hash',
    );
  });

  it('fails local hash checks when the inner reveal does not match the package current state', () => {
    v2.makeInnerPuzzleHash.and.returnValue(hexBytes(H4));

    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fillSignerInputs(component);
    fixture.detectChanges();

    expect(component.signerInputReadiness().ok).toBeFalse();
    expect(component.signerInputReadiness().status).toBe('fails local hash checks');
    expect(component.signerInputReadiness().failures).toContain(
      'current admin_authority_v2 inner puzzle reveal tree hash must match computed current inner puzzle hash',
    );
  });

  it('compares pasted live singleton fields against selected coin metadata when attached', () => {
    const pkg = validPackage({
      live_singleton: {
        source: 'optional_api_lookup',
        required_amount: 1,
        selected_coin: {
          coin_id: H4,
          parent_coin_info: H3,
          puzzle_hash: H2,
          amount: 1,
        },
      },
    });

    component.setPackageText(JSON.stringify(pkg, null, 2));
    fillSignerInputs(component);
    fixture.detectChanges();

    expect(component.signerInputReadiness().ok).toBeFalse();
    expect(component.signerInputReadiness().failures).toContain(
      'live singleton parent coin id must match package live_singleton.selected_coin.parent_coin_info',
    );
  });

  it('rejects live singleton amount values other than one', () => {
    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fillSignerInputs(component, '2');
    fixture.detectChanges();

    expect(component.signerInputReadiness().ok).toBeFalse();
    expect(component.signerInputReadiness().failures).toContain('live singleton amount must equal 1');
    expect(fixture.nativeElement.textContent).toContain('live singleton amount must equal 1');
  });

  it('does not accept final wallet signatures in signer readiness inputs yet', () => {
    fixture.detectChanges();
    const fields = Array.from(
      fixture.nativeElement.querySelectorAll('input, textarea') as NodeListOf<HTMLInputElement | HTMLTextAreaElement>,
    );

    expect(fields.some((field) => field.placeholder.toLowerCase().includes('signature'))).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain(
      'Final wallet signature is a future step and is not accepted or stored on this screen.',
    );
  });

  it('renders JWT/signature/nonce validation failures', () => {
    v2.validateUnsignedRosterSpendPackage.and.returnValue({
      ok: false,
      status: 'fails local checks',
      failures: [
        'package.optional_attachments.api_cross_check.jwt must not contain credentials or signatures',
        'package.optional_attachments.api_cross_check.signature must not contain credentials or signatures',
        'package.optional_attachments.api_cross_check.nonce must not contain credentials or signatures',
      ],
    });
    const pkg = validPackage({
      optional_attachments: {
        api_cross_check_status: 'matches local preview',
        api_cross_check: {
          jwt: 'header.payload.signature',
          signature: '0x' + 'ab'.repeat(65),
          nonce: H1,
        },
        api_live_singleton_lookup: null,
      },
    });

    component.setPackageText(JSON.stringify(pkg, null, 2));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('jwt must not contain credentials or signatures');
    expect(fixture.nativeElement.textContent).toContain('signature must not contain credentials or signatures');
    expect(fixture.nativeElement.textContent).toContain('nonce must not contain credentials or signatures');
  });

  it('does not call roster update backend flows during local review', () => {
    component.setPackageText(JSON.stringify(validPackage(), null, 2));
    fillSignerInputs(component);
    fixture.detectChanges();

    expect(rosterUpdate.requestAdminChallenge).not.toHaveBeenCalled();
    expect(rosterUpdate.loginAdmin).not.toHaveBeenCalled();
    expect(rosterUpdate.prepare).not.toHaveBeenCalled();
    expect(rosterUpdate.lookupLiveSingleton).not.toHaveBeenCalled();
  });
});
