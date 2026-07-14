import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { AdminRosterUpdateService } from './admin-roster-update.service';

describe('AdminRosterUpdateService', () => {
  let service: AdminRosterUpdateService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AdminRosterUpdateService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('posts roster update prepare requests with an explicit bearer token', async () => {
    const request = {
      updated_admin_records: { version: 1, launcher_id: '0x' + '11'.repeat(32), admin_records: [] },
      current_authority_version: 1,
      current_mips_root_hash: '0x' + '22'.repeat(32),
      current_admins_hash: '0x' + '33'.repeat(32),
      current_pending_ops_hash: '0x' + '44'.repeat(32),
      new_authority_version: 2,
      new_mips_root_hash: '0x' + '55'.repeat(32),
    };
    const promise = service.prepare(' admin-jwt ', request);

    const req = http.expectOne(`${environment.faucetApi}/admin/auth/authority_v2/roster_update/prepare`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer admin-jwt');
    expect(req.request.body).toEqual(request);
    req.flush(preparedResponse());

    await expectAsync(promise).toBeResolvedTo(preparedResponse());
  });

  it('requests an API admin challenge for an EVM owner', async () => {
    const promise = service.requestAdminChallenge('0x1234567890abcdef1234567890abcdef12345678');

    const req = http.expectOne(`${environment.faucetApi}/admin/auth/challenge`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      owner: '0x1234567890abcdef1234567890abcdef12345678',
      auth_type: 'evm',
    });
    req.flush({
      nonce: '0x' + '99'.repeat(32),
      expires_at: 1234,
      typed_data: {
        domain: { name: 'Solslot Protocol', version: '1', chainId: 1 },
        types: { EIP712Domain: [], SolslotAdminLogin: [] },
        primaryType: 'SolslotAdminLogin',
        message: {},
      },
    });

    await expectAsync(promise).toBeResolved();
  });

  it('posts signed API admin login challenges', async () => {
    const promise = service.loginAdmin({
      owner: '0x1234567890abcdef1234567890abcdef12345678',
      nonce: '0x' + '99'.repeat(32),
      signature: '0x' + 'aa'.repeat(65),
      auth_type: 'evm',
    });

    const req = http.expectOne(`${environment.faucetApi}/admin/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      owner: '0x1234567890abcdef1234567890abcdef12345678',
      nonce: '0x' + '99'.repeat(32),
      signature: '0x' + 'aa'.repeat(65),
      auth_type: 'evm',
    });
    req.flush({
      jwt: 'header.payload.signature',
      expires_at: 5678,
      owner: '0x1234567890abcdef1234567890abcdef12345678',
    });

    await expectAsync(promise).toBeResolvedTo({
      jwt: 'header.payload.signature',
      expires_at: 5678,
      owner: '0x1234567890abcdef1234567890abcdef12345678',
    });
  });

  it('looks up the live admin authority singleton with bearer auth', async () => {
    const promise = service.lookupLiveSingleton(' api-jwt ');

    const req = http.expectOne(`${environment.faucetApi}/admin/auth/authority_v2/live_singleton`);
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer api-jwt');
    req.flush(liveSingletonLookup());

    await expectAsync(promise).toBeResolvedTo(liveSingletonLookup());
  });

  it('rejects missing bearer tokens before sending an HTTP request', async () => {
    await expectAsync(
      service.prepare('', {
        updated_admin_records: {},
        new_authority_version: 2,
        new_mips_root_hash: '0x' + '55'.repeat(32),
      }),
    ).toBeRejectedWithError(/bearer token is required/);
  });
});

function liveSingletonLookup() {
  return {
    lookup_status: 'found_unique_unspent_candidate',
    launcher_id: '0x' + '11'.repeat(32),
    expected_inner_puzzle_hash: '0x' + '22'.repeat(32),
    expected_full_puzzle_hash: '0x' + '33'.repeat(32),
    expected_amount: 1,
    candidates_found: 1,
    selected_coin: {
      coin_id: '0x' + '44'.repeat(32),
      parent_coin_info: '0x' + '55'.repeat(32),
      puzzle_hash: '0x' + '33'.repeat(32),
      amount: 1,
      confirmed_block_index: 123,
      spent_block_index: 0,
    },
    lineage_verification_status: 'not_verified_lineage_walker_pending',
  };
}

function preparedResponse() {
  return {
    submission_status: 'validated_preview_only_roster_spend_not_submitted',
    activation_status: 'candidate_not_active_until_admin_roster_update_confirms',
    launcher_id: '0x' + '11'.repeat(32),
    current_authority_version: 1,
    new_authority_version: 2,
    current_admin_count: 1,
    new_admin_count: 2,
    new_admin_slot_index: 1,
    new_threshold: 2,
    current_mips_root_hash: '0x' + '22'.repeat(32),
    current_admins_hash: '0x' + '33'.repeat(32),
    current_pending_ops_hash: '0x' + '44'.repeat(32),
    new_mips_root_hash: '0x' + '55'.repeat(32),
    new_admins_hash: '0x' + '66'.repeat(32),
    new_pending_ops_hash: '0x' + '44'.repeat(32),
    new_state_hash: '0x' + '77'.repeat(32),
    roster_update_binding_hash: '0x' + '88'.repeat(32),
    spend_intent: {
      kind: 'admin_authority_v2_roster_update',
      spend_tag: 7,
      spend_name: 'ADMIN_ROSTER_UPDATE',
      launcher_id: '0x' + '11'.repeat(32),
      current_state_hash: '0x' + '99'.repeat(32),
      new_state_hash: '0x' + '77'.repeat(32),
      roster_update_binding_hash: '0x' + '88'.repeat(32),
      validation_scope: 'prepare_only_no_broadcast',
    },
    missing_for_live_submission: [
      'live singleton coin id and amount',
      'wallet signature over the final Chia spend bundle',
    ],
  };
}
