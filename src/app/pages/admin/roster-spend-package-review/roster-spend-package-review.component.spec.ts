import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RosterSpendPackageReviewComponent } from './roster-spend-package-review.component';
import { AdminAuthorityV2Service } from '../../../services/admin-authority-v2/admin-authority-v2.service';
import { AdminRosterUpdateService } from '../../../services/admin-roster-update.service';

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

function fillSignerInputs(component: RosterSpendPackageReviewComponent, amount = '1'): void {
  component.setSignerInput('currentMipsPuzzleReveal', 'ff80');
  component.setSignerInput('currentMipsQuorumSolution', 'ff01');
  component.setSignerInput('currentAuthorityInnerPuzzleReveal', 'ff02');
  component.setSignerInput('liveSingletonParentCoinId', H1);
  component.setSignerInput('liveSingletonPuzzleHash', H2);
  component.setSignerInput('liveSingletonAmount', amount);
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

  beforeEach(async () => {
    v2 = jasmine.createSpyObj('AdminAuthorityV2Service', [
      'validateUnsignedRosterSpendPackage',
      'computeSerializedProgramTreeHash',
      'makeInnerPuzzleHash',
      'singletonFullPuzzleHash',
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
    rosterUpdate = jasmine.createSpyObj('AdminRosterUpdateService', [
      'prepare',
      'requestAdminChallenge',
      'loginAdmin',
      'lookupLiveSingleton',
    ]);

    await TestBed.configureTestingModule({
      imports: [RosterSpendPackageReviewComponent],
      providers: [
        provideRouter([]),
        { provide: AdminAuthorityV2Service, useValue: v2 },
        { provide: AdminRosterUpdateService, useValue: rosterUpdate },
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
