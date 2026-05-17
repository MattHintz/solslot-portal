import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AddAdminSlotComponent } from './add-admin-slot.component';
import { AdminAuthorityV2Service } from '../../../services/admin-authority-v2/admin-authority-v2.service';
import {
  AdminChallengeResponse,
  AdminAuthorityV2LiveSingletonLookup,
  AdminRosterUpdatePrepareResponse,
  AdminRosterUpdateService,
} from '../../../services/admin-roster-update.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { ChiaWasmService } from '../../../services/chia-wasm.service';
import { Eip712LeafHashService } from '../../../services/eip712-leaf-hash.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';

describe('AddAdminSlotComponent', () => {
  let fixture: ComponentFixture<AddAdminSlotComponent>;
  let session: jasmine.SpyObj<Pick<AdminSessionService, 'subject' | 'pubkey'>>;
  let v2: jasmine.SpyObj<Pick<AdminAuthorityV2Service, 'computeAdminsHash' | 'computeStateHash' | 'computeRosterUpdateBindingHash' | 'validateUnsignedRosterSpendPackage'>>;
  let evmWallet: jasmine.SpyObj<{
    isConnected: () => boolean;
    address: () => string | null;
    connectInjected: () => Promise<string>;
    connectWalletConnect: () => Promise<string>;
    signTypedData: (typedData: unknown) => Promise<string>;
    recoverFirstAdminPubkey: () => Promise<{ pubkey: string; address: string }>;
  }>;
  let eip712: jasmine.SpyObj<Pick<Eip712LeafHashService, 'compute' | 'computeMipsRootEip712MOfN'>>;
  let rosterUpdate: jasmine.SpyObj<Pick<AdminRosterUpdateService, 'prepare' | 'requestAdminChallenge' | 'loginAdmin' | 'lookupLiveSingleton'>>;

  const currentPubkey = '0x02' + '11'.repeat(32);
  const newPubkey = '0x03' + '22'.repeat(32);
  const currentAddress = '0x0e61d3bb1148bdd802f747caea112333d156626a';
  const newAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const currentLeaf = {
    leaf_hash: '0x' + 'aa'.repeat(32),
    secp256k1_pubkey: currentPubkey,
    type_hash: '0x' + 'bb'.repeat(32),
    prefix_and_domain_separator: '0x1901' + 'cc'.repeat(32),
    network: 'testnet11' as const,
  };
  const newLeaf = {
    leaf_hash: '0x' + 'dd'.repeat(32),
    secp256k1_pubkey: newPubkey,
    type_hash: '0x' + 'ee'.repeat(32),
    prefix_and_domain_separator: '0x1901' + 'ff'.repeat(32),
    network: 'testnet11' as const,
  };

  beforeEach(async () => {
    session = jasmine.createSpyObj('AdminSessionService', ['subject', 'pubkey']);
    session.subject.and.returnValue(currentAddress);
    session.pubkey.and.returnValue(currentPubkey);

    evmWallet = jasmine.createSpyObj('EvmWalletService', [
      'isConnected',
      'address',
      'connectInjected',
      'connectWalletConnect',
      'signTypedData',
      'recoverFirstAdminPubkey',
    ]);
    evmWallet.isConnected.and.returnValue(true);
    evmWallet.address.and.returnValue(currentAddress);
    evmWallet.connectInjected.and.resolveTo(newAddress);
    evmWallet.connectWalletConnect.and.resolveTo(newAddress);
    evmWallet.signTypedData.and.resolveTo('0x' + 'ab'.repeat(65));
    evmWallet.recoverFirstAdminPubkey.and.resolveTo({ pubkey: newPubkey, address: newAddress });

    eip712 = jasmine.createSpyObj('Eip712LeafHashService', [
      'compute',
      'computeMipsRootEip712MOfN',
    ]);
    eip712.compute.and.callFake((pubkey: string) => {
      if (pubkey.toLowerCase() === currentPubkey) return currentLeaf;
      if (pubkey.toLowerCase() === newPubkey) return newLeaf;
      throw new Error('unexpected pubkey');
    });
    eip712.computeMipsRootEip712MOfN.and.returnValue({
      mips_root_hash: '0x' + '44'.repeat(32),
      shape: 'mofn',
      required: 2,
      member_count: 2,
      member_hashes: ['0x' + '55'.repeat(32), '0x' + '66'.repeat(32)],
    });
    rosterUpdate = jasmine.createSpyObj('AdminRosterUpdateService', [
      'prepare',
      'requestAdminChallenge',
      'loginAdmin',
      'lookupLiveSingleton',
    ]);
    rosterUpdate.prepare.and.resolveTo(preparedResponse());
    rosterUpdate.requestAdminChallenge.and.resolveTo(adminChallengeResponse());
    rosterUpdate.loginAdmin.and.resolveTo({
      jwt: 'header.payload.signature',
      expires_at: 1_800_000_000,
      owner: currentAddress,
    });
    rosterUpdate.lookupLiveSingleton.and.resolveTo(liveSingletonLookup());
    v2 = jasmine.createSpyObj('AdminAuthorityV2Service', [
      'computeAdminsHash',
      'computeStateHash',
      'computeRosterUpdateBindingHash',
      'validateUnsignedRosterSpendPackage',
    ]);
    v2.computeAdminsHash.and.callFake((records: ReadonlyArray<{ adminIdx: number | bigint }>) =>
      new Uint8Array(Array(32).fill(records.length === 1 ? 0x33 : 0x77)),
    );
    v2.computeStateHash.and.callFake((args: { authorityVersion: number | bigint }) =>
      new Uint8Array(Array(32).fill(args.authorityVersion === 1 || args.authorityVersion === 1n ? 0x00 : 0x88)),
    );
    v2.computeRosterUpdateBindingHash.and.returnValue(new Uint8Array(Array(32).fill(0x99)));
    v2.validateUnsignedRosterSpendPackage.and.returnValue({
      ok: true,
      status: 'passes local checks',
      failures: [],
    });

    await TestBed.configureTestingModule({
      imports: [AddAdminSlotComponent],
      providers: [
        provideRouter([]),
        { provide: AdminSessionService, useValue: session },
        { provide: ChiaWasmService, useValue: { ready: () => true } },
        { provide: AdminAuthorityV2Service, useValue: v2 },
        { provide: Eip712LeafHashService, useValue: eip712 },
        { provide: EvmWalletService, useValue: evmWallet },
        { provide: AdminRosterUpdateService, useValue: rosterUpdate },
      ],
    }).compileComponents();
  });

  function create(): AddAdminSlotComponent {
    fixture = TestBed.createComponent(AddAdminSlotComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('captures a new EVM admin and previews a 2-of-2 roster update', async () => {
    const component = create();

    await component.recoverNewAdminFromWallet();
    fixture.detectChanges();

    const preview = component.preview();
    expect(preview).not.toBeNull();
    expect(preview?.newAdminSlotIndex).toBe(1);
    expect(preview?.newThreshold).toBe(2);
    expect(preview?.newAuthorityVersion).toBe(2);
    expect(preview?.currentAdminsHash).toBe('0x' + '33'.repeat(32));
    expect(preview?.newAdminsHash).toBe('0x' + '77'.repeat(32));
    expect(preview?.newMipsRootHash).toBe('0x' + '44'.repeat(32));
    expect(preview?.newStateHash).toBe('0x' + '88'.repeat(32));
    expect(eip712.computeMipsRootEip712MOfN).toHaveBeenCalledOnceWith(
      [currentPubkey, newPubkey],
      2,
      'testnet11',
    );
  });

  it('exports updated admin_records.json without signatures or secrets', async () => {
    const component = create();

    await component.recoverNewAdminFromWallet();
    const json = component.adminRecordsJson();
    const artifact = JSON.parse(json) as {
      launcher_id: string;
      admin_records: Array<{ admin_idx: number; m_within: number; leaves: Array<Record<string, string>> }>;
    };

    expect(artifact.launcher_id).toBe(
      '0xf3fd2dedfc77a5b8f65acdfaff04d3786844a8c4d0529d3dbc4d37dc4012bb84',
    );
    expect(artifact.admin_records.length).toBe(2);
    expect(artifact.admin_records[0].admin_idx).toBe(0);
    expect(artifact.admin_records[1].admin_idx).toBe(1);
    expect(artifact.admin_records[1].m_within).toBe(1);
    expect(artifact.admin_records[1].leaves[0]['evm_address']).toBe(newAddress);
    expect(json).not.toContain('signature');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('bearer');
    expect(json).not.toContain('jwt');
  });

  it('keeps chain submission disabled until the roster spend signer exists', async () => {
    const component = create();

    await component.recoverNewAdminFromWallet();
    fixture.detectChanges();
    const button = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.includes('Submit roster update spend unavailable'));

    expect(button).toBeDefined();
    expect(button?.disabled).toBeTrue();
    expect(component.previewJson()).toContain('preview_only_roster_spend_signer_not_wired');
  });

  it('exports a local unsigned roster spend package without API authorization', async () => {
    const component = create();

    await component.recoverNewAdminFromWallet();
    const json = component.unsignedRosterSpendPackageJson();
    const pkg = JSON.parse(json) as {
      kind: string;
      package_status: string;
      signing_status: string;
      broadcast_status: string;
      activation_status: string;
      backend_dependency: string;
      spend_intent: {
        spend_tag: number;
        spend_name: string;
        current_state_hash: string;
        new_state_hash: string;
        roster_update_binding_hash: string;
        binding_hash_source: string;
        validation_scope: string;
      };
      current: {
        authority_version: number;
        mips_root_hash: string;
        admins_hash: string;
        state_hash: string;
        admin_records: Array<{ admin_idx: number }>;
      };
      update: {
        new_authority_version: number;
        new_admin_record: { admin_idx: number };
        new_threshold: number;
        new_mips_member_hashes: string[];
        roster_update_binding_hash: string;
        updated_admin_records: Array<{ admin_idx: number }>;
      };
      live_singleton: { source: string; selected_coin: unknown | null };
      required_local_signer_inputs: string[];
      optional_attachments: {
        api_cross_check: AdminRosterUpdatePrepareResponse | null;
        api_cross_check_status: string;
        api_live_singleton_lookup: unknown | null;
      };
    };

    expect(pkg.kind).toBe('admin_authority_v2_roster_update_unsigned_package');
    expect(Object.keys(pkg)).toEqual([
      'version',
      'kind',
      'network',
      'package_status',
      'signing_status',
      'broadcast_status',
      'backend_dependency',
      'launcher_id',
      'activation_status',
      'spend_intent',
      'current',
      'update',
      'live_singleton',
      'required_local_signer_inputs',
      'optional_attachments',
    ]);
    expect(Object.keys(pkg.spend_intent)).toEqual([
      'kind',
      'spend_tag',
      'spend_name',
      'launcher_id',
      'current_state_hash',
      'new_state_hash',
      'roster_update_binding_hash',
      'binding_hash_source',
      'validation_scope',
    ]);
    expect(Object.keys(pkg.optional_attachments)).toEqual([
      'api_cross_check_status',
      'api_cross_check',
      'api_live_singleton_lookup',
    ]);
    expect(pkg.package_status).toBe('unsigned_package_only');
    expect(pkg.signing_status).toBe('not_signed');
    expect(pkg.broadcast_status).toBe('not_built_not_submitted');
    expect(pkg.activation_status).toBe(
      'candidate_not_active_until_admin_roster_update_confirms',
    );
    expect(pkg.backend_dependency).toBe('optional_admin_cross_check_only');
    expect(pkg.spend_intent.spend_tag).toBe(7);
    expect(pkg.spend_intent.spend_name).toBe('ADMIN_ROSTER_UPDATE');
    expect(pkg.spend_intent.current_state_hash).toBe('0x' + '00'.repeat(32));
    expect(pkg.spend_intent.new_state_hash).toBe('0x' + '88'.repeat(32));
    expect(pkg.spend_intent.roster_update_binding_hash).toBe('0x' + '99'.repeat(32));
    expect(pkg.spend_intent.binding_hash_source).toBe('local_admin_authority_v2_service');
    expect(pkg.spend_intent.validation_scope).toBe('local_unsigned_package_no_broadcast');
    expect(pkg.current.authority_version).toBe(1);
    expect(pkg.current.mips_root_hash).toBe(
      '0x95cbfe1c977e0c82ccbc539fa25c295eff23af25900d4e8d9e9ff2eed35a15fe',
    );
    expect(pkg.current.admins_hash).toBe('0x' + '33'.repeat(32));
    expect(pkg.current.state_hash).toBe('0x' + '00'.repeat(32));
    expect(pkg.current['pending_ops_hash' as keyof typeof pkg.current]).toBe(
      '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a',
    );
    expect(pkg.current.admin_records.map((r) => r.admin_idx)).toEqual([0]);
    expect(pkg.update.new_authority_version).toBe(2);
    expect(pkg.update.new_admin_record.admin_idx).toBe(1);
    expect(pkg.update.new_threshold).toBe(2);
    expect(pkg.update.new_mips_member_hashes).toEqual([
      '0x' + '55'.repeat(32),
      '0x' + '66'.repeat(32),
    ]);
    expect(pkg.update.roster_update_binding_hash).toBe('0x' + '99'.repeat(32));
    expect(pkg.update['new_pending_ops_hash' as keyof typeof pkg.update]).toBe(
      '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a',
    );
    expect(pkg.update.updated_admin_records.map((r) => r.admin_idx)).toEqual([0, 1]);
    expect(pkg.live_singleton.source).toBe('operator_wallet_or_coinset_client');
    expect(pkg.live_singleton['required_amount' as keyof typeof pkg.live_singleton]).toBe(1);
    expect(pkg.live_singleton.selected_coin).toBeNull();
    expect(pkg.required_local_signer_inputs).toContain(
      'current MIPS puzzle reveal matching current.mips_root_hash',
    );
    expect(pkg.optional_attachments.api_cross_check).toBeNull();
    expect(pkg.optional_attachments.api_cross_check_status).toBe('not checked');
    expect(pkg.optional_attachments.api_live_singleton_lookup).toBeNull();
    expect(component.unsignedRosterSpendPreflight()?.ok).toBeTrue();
    expect(component.unsignedRosterSpendPreflight()?.status).toBe('passes local checks');
    expect(rosterUpdate.requestAdminChallenge).not.toHaveBeenCalled();
    expect(rosterUpdate.loginAdmin).not.toHaveBeenCalled();
    expect(rosterUpdate.prepare).not.toHaveBeenCalled();
    expect(rosterUpdate.lookupLiveSingleton).not.toHaveBeenCalled();
    expect(json).not.toContain('header.payload.signature');
    expect(json).not.toContain('bearer');
    expect(json).not.toContain('jwt');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('nonce');
    expect(json).not.toContain('0x' + 'ab'.repeat(65));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Unsigned package preflight: passes local checks');
    expect(fixture.nativeElement.textContent).toContain('Local-only contract, hash, append-only roster, and credential-leak checks pass.');
  });

  it('optionally cross-checks the local roster update preview with the API', async () => {
    const component = create();

    await component.recoverNewAdminFromWallet();
    await component.authorizeRosterUpdateApi();
    await component.prepareRosterUpdateWithApi();
    fixture.detectChanges();

    expect(rosterUpdate.requestAdminChallenge).toHaveBeenCalledOnceWith(currentAddress);
    expect(evmWallet.signTypedData).toHaveBeenCalledOnceWith(adminChallengeResponse().typed_data);
    expect(rosterUpdate.loginAdmin).toHaveBeenCalledOnceWith({
      owner: currentAddress,
      nonce: '0x' + '98'.repeat(32),
      signature: '0x' + 'ab'.repeat(65),
      auth_type: 'evm',
    });
    expect(rosterUpdate.prepare).toHaveBeenCalledOnceWith(
      'header.payload.signature',
      jasmine.objectContaining({
        current_authority_version: 1,
        current_mips_root_hash:
          '0x95cbfe1c977e0c82ccbc539fa25c295eff23af25900d4e8d9e9ff2eed35a15fe',
        current_admins_hash: '0x' + '33'.repeat(32),
        current_pending_ops_hash: '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a',
        new_authority_version: 2,
        new_mips_root_hash: '0x' + '44'.repeat(32),
      }),
    );
    const request = rosterUpdate.prepare.calls.mostRecent().args[1];
    expect(request.updated_admin_records['admin_records']).toEqual(
      jasmine.arrayContaining([
        jasmine.objectContaining({ admin_idx: 0 }),
        jasmine.objectContaining({ admin_idx: 1 }),
      ]),
    );
    expect(component.preparedRosterUpdate()?.roster_update_binding_hash).toBe('0x' + '99'.repeat(32));
    expect(fixture.nativeElement.textContent).toContain('validated_preview_only_roster_spend_not_submitted');
    expect(fixture.nativeElement.textContent).toContain('matches local preview');
    expect(fixture.nativeElement.textContent).toContain('0x' + '99'.repeat(32));
    expect(fixture.nativeElement.textContent).toContain('ADMIN_ROSTER_UPDATE');
    expect(fixture.nativeElement.textContent).toContain('prepare_only_no_broadcast');
    expect(fixture.nativeElement.textContent).toContain('live singleton coin id and amount');
    expect(component.unsignedRosterSpendPackageJson()).toContain('"api_cross_check"');
    expect(component.unsignedRosterSpendPackageJson()).toContain('"api_cross_check_status": "matches local preview"');
  });

  it('surfaces local unsigned package preflight failures without backend calls', async () => {
    v2.validateUnsignedRosterSpendPackage.and.returnValue({
      ok: false,
      status: 'fails local checks',
      failures: ['update.roster_update_binding_hash must match computed roster update binding hash'],
    });
    const component = create();

    await component.recoverNewAdminFromWallet();
    fixture.detectChanges();

    expect(component.unsignedRosterSpendPreflight()?.ok).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Unsigned package preflight: fails local checks');
    expect(fixture.nativeElement.textContent).toContain(
      'update.roster_update_binding_hash must match computed roster update binding hash',
    );
    expect(rosterUpdate.requestAdminChallenge).not.toHaveBeenCalled();
    expect(rosterUpdate.loginAdmin).not.toHaveBeenCalled();
    expect(rosterUpdate.prepare).not.toHaveBeenCalled();
    expect(rosterUpdate.lookupLiveSingleton).not.toHaveBeenCalled();
  });

  it('surfaces optional API cross-check errors without enabling spend submission', async () => {
    const component = create();
    rosterUpdate.prepare.and.rejectWith(new Error('current_admins_hash does not match active A.5 state'));

    await component.recoverNewAdminFromWallet();
    await component.authorizeRosterUpdateApi();
    await component.prepareRosterUpdateWithApi();
    fixture.detectChanges();

    expect(component.preparedRosterUpdate()).toBeNull();
    expect(component.prepareError()).toContain('current_admins_hash');
    expect(fixture.nativeElement.textContent).toContain('Submit roster update spend unavailable');
  });

  it('optionally looks up and displays the live singleton candidate with the API JWT', async () => {
    const component = create();

    await component.recoverNewAdminFromWallet();
    await component.authorizeRosterUpdateApi();
    await component.lookupLiveSingletonWithApi();
    fixture.detectChanges();

    expect(rosterUpdate.lookupLiveSingleton).toHaveBeenCalledOnceWith('header.payload.signature');
    expect(component.liveSingletonLookup()?.selected_coin?.coin_id).toBe('0x' + '12'.repeat(32));
    expect(fixture.nativeElement.textContent).toContain('found_unique_unspent_candidate');
    expect(fixture.nativeElement.textContent).toContain('not_verified_lineage_walker_pending');
    expect(fixture.nativeElement.textContent).toContain('0x' + '12'.repeat(32));
    expect(component.unsignedRosterSpendPackageJson()).toContain('"api_live_singleton_lookup"');
    expect(component.unsignedRosterSpendPackageJson()).toContain('"source": "optional_api_lookup"');
  });

  it('requires the current admin wallet before minting an API JWT', async () => {
    evmWallet.address.and.returnValue(newAddress);
    const component = create();

    await component.authorizeRosterUpdateApi();

    expect(rosterUpdate.requestAdminChallenge).not.toHaveBeenCalled();
    expect(component.prepareApiJwt()).toBeNull();
    expect(component.prepareError()).toContain(currentAddress);
    expect(component.prepareError()).toContain(newAddress);
  });
});

function adminChallengeResponse(): AdminChallengeResponse {
  return {
    nonce: '0x' + '98'.repeat(32),
    expires_at: 1_700_000_000,
    typed_data: {
      domain: { name: 'Populis Protocol', version: '1', chainId: 1 },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        PopulisAdminLogin: [
          { name: 'owner', type: 'address' },
          { name: 'nonce', type: 'bytes32' },
          { name: 'issuedAt', type: 'uint256' },
          { name: 'authType', type: 'string' },
          { name: 'scope', type: 'string' },
        ],
      },
      primaryType: 'PopulisAdminLogin',
      message: {
        owner: '0x0e61d3bb1148bdd802f747caea112333d156626a',
        nonce: '0x' + '98'.repeat(32),
        issuedAt: 1_700_000_000,
        authType: 'evm',
        scope: 'admin',
      },
    },
  };
}

function liveSingletonLookup(): AdminAuthorityV2LiveSingletonLookup {
  return {
    lookup_status: 'found_unique_unspent_candidate',
    launcher_id: '0xf3fd2dedfc77a5b8f65acdfaff04d3786844a8c4d0529d3dbc4d37dc4012bb84',
    expected_inner_puzzle_hash: '0x' + '10'.repeat(32),
    expected_full_puzzle_hash: '0x' + '11'.repeat(32),
    expected_amount: 1,
    candidates_found: 1,
    selected_coin: {
      coin_id: '0x' + '12'.repeat(32),
      parent_coin_info: '0x' + '13'.repeat(32),
      puzzle_hash: '0x' + '11'.repeat(32),
      amount: 1,
      confirmed_block_index: 123,
      spent_block_index: 0,
    },
    lineage_verification_status: 'not_verified_lineage_walker_pending',
  };
}

function preparedResponse(): AdminRosterUpdatePrepareResponse {
  return {
    submission_status: 'validated_preview_only_roster_spend_not_submitted',
    activation_status: 'candidate_not_active_until_admin_roster_update_confirms',
    launcher_id: '0xf3fd2dedfc77a5b8f65acdfaff04d3786844a8c4d0529d3dbc4d37dc4012bb84',
    current_authority_version: 1,
    new_authority_version: 2,
    current_admin_count: 1,
    new_admin_count: 2,
    new_admin_slot_index: 1,
    new_threshold: 2,
    current_mips_root_hash:
      '0x95cbfe1c977e0c82ccbc539fa25c295eff23af25900d4e8d9e9ff2eed35a15fe',
    current_admins_hash: '0x' + '33'.repeat(32),
    current_pending_ops_hash:
      '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a',
    new_mips_root_hash: '0x' + '44'.repeat(32),
    new_admins_hash: '0x' + '77'.repeat(32),
    new_pending_ops_hash:
      '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a',
    new_state_hash: '0x' + '88'.repeat(32),
    roster_update_binding_hash: '0x' + '99'.repeat(32),
    spend_intent: {
      kind: 'admin_authority_v2_roster_update',
      spend_tag: 7,
      spend_name: 'ADMIN_ROSTER_UPDATE',
      launcher_id: '0xf3fd2dedfc77a5b8f65acdfaff04d3786844a8c4d0529d3dbc4d37dc4012bb84',
      current_state_hash: '0x' + '00'.repeat(32),
      new_state_hash: '0x' + '88'.repeat(32),
      roster_update_binding_hash: '0x' + '99'.repeat(32),
      validation_scope: 'prepare_only_no_broadcast',
    },
    missing_for_live_submission: [
      'live singleton coin id and amount',
      'wallet signature over the final Chia spend bundle',
    ],
  };
}
