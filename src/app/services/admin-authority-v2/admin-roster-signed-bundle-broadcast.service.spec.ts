import { TestBed } from '@angular/core/testing';

import { CoinsetService } from '../coinset.service';
import { UnsignedCoinSpend } from '../chia-wallet.service';
import { AdminRosterSignedBundleBroadcastService } from './admin-roster-signed-bundle-broadcast.service';

const H1 = h('11');
const H2 = h('22');
const H3 = h('33');
const H4 = h('44');
const SIG = '0x' + 'aa'.repeat(96);

const COIN_SPEND: UnsignedCoinSpend = {
  coin: {
    parentCoinInfo: H1,
    puzzleHash: H2,
    amount: 1,
  },
  puzzleReveal: '0xfeed',
  solution: '0xbeef',
};

describe('AdminRosterSignedBundleBroadcastService', () => {
  let service: AdminRosterSignedBundleBroadcastService;
  let coinset: jasmine.SpyObj<Pick<CoinsetService, 'pushTransaction'>>;

  beforeEach(() => {
    coinset = jasmine.createSpyObj('CoinsetService', ['pushTransaction']);
    coinset.pushTransaction.and.resolveTo({ success: true, status: 'SUCCESS' });

    TestBed.configureTestingModule({
      providers: [
        AdminRosterSignedBundleBroadcastService,
        { provide: CoinsetService, useValue: coinset },
      ],
    });
    service = TestBed.inject(AdminRosterSignedBundleBroadcastService);
  });

  it('pushes a signed candidate after explicit operator confirmation without claiming chain confirmation', async () => {
    const result = await service.submit({
      signedSpendBundleCandidate: signedCandidate(),
      operatorBroadcastConfirmation: { confirmed: true, network: 'testnet11', expectedNetwork: 'testnet11' },
    });

    expect(result.ok).toBeTrue();
    expect(result.status).toBe('submitted_spend_bundle_push_result_not_confirmation');
    expect(coinset.pushTransaction).toHaveBeenCalledOnceWith({
      coinSpends: [COIN_SPEND],
      aggregatedSignature: SIG,
    });
    expect(result.submissionRecord?.kind).toBe('admin_authority_v2_roster_update_broadcast_submission_record');
    expect(result.submissionRecord?.submitted_spend_bundle).toEqual({
      coin_spends: [COIN_SPEND],
      aggregated_signature: SIG,
      signing_status: 'signed_by_wallet',
      broadcast_status: 'submitted_to_transaction_relay',
    });
    expect(result.submissionRecord?.push_transaction_response).toEqual({ success: true, status: 'SUCCESS' });
    expect(result.submissionRecord?.deterministic_broadcast_review).toEqual({
      singleton_coin_id: H3,
      roster_update_binding_hash: H4,
      signed_coin_spend_count: 1,
      relay_status: 'SUCCESS',
      chain_confirmation_status: 'not_claimed',
    });
    expect(result.submissionRecord?.boundary_guards).toContain('operator_confirmed_broadcast');
    expect(result.submissionRecord?.boundary_guards).toContain('wallet_signature_not_collected');
    expect(result.submissionRecord?.boundary_guards).toContain('transaction_relay_acceptance_not_chain_confirmation');
    expect(result.submissionRecord?.boundary_guards).toContain('backend_not_used_as_roster_authority');
    expect(JSON.stringify(result.submissionRecord).toLowerCase()).not.toContain('mnemonic');
    expect(JSON.stringify(result.submissionRecord).toLowerCase()).not.toContain('jwt');
  });

  it('requires explicit operator broadcast confirmation before pushing', async () => {
    const result = await service.submit({
      signedSpendBundleCandidate: signedCandidate(),
      operatorBroadcastConfirmation: { confirmed: false, network: 'testnet11' },
    });

    expect(result.ok).toBeFalse();
    expect(result.submissionRecord).toBeNull();
    expect(result.failures).toContain('operator_broadcast_confirmation.confirmed must be true');
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('requires operator confirmation network to match expected network before pushing', async () => {
    const result = await service.submit({
      signedSpendBundleCandidate: signedCandidate(),
      operatorBroadcastConfirmation: { confirmed: true, network: 'mainnet', expectedNetwork: 'testnet11' },
    });

    expect(result.ok).toBeFalse();
    expect(result.submissionRecord).toBeNull();
    expect(result.failures).toContain('operator_broadcast_confirmation.network must match expected network');
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('rejects invalid aggregated signatures before pushing', async () => {
    const result = await service.submit({
      signedSpendBundleCandidate: signedCandidate({
        signed_spend_bundle_candidate: {
          coin_spends: [COIN_SPEND],
          aggregated_signature: '0x' + 'aa'.repeat(95),
          signing_status: 'signed_by_wallet',
          broadcast_status: 'not_broadcast',
        },
      }),
      operatorBroadcastConfirmation: { confirmed: true, network: 'testnet11' },
    });

    expect(result.ok).toBeFalse();
    expect(result.submissionRecord).toBeNull();
    expect(result.failures).toContain('signed_spend_bundle_candidate.signed_spend_bundle_candidate.aggregated_signature must be 96 bytes');
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('rejects deterministic post-signing review mismatches before pushing', async () => {
    const result = await service.submit({
      signedSpendBundleCandidate: signedCandidate({
        deterministic_post_signing_review: {
          singleton_coin_id: H3,
          roster_update_binding_hash: H2,
          signed_coin_spend_count: 1,
          broadcast_status: 'not_broadcast',
        },
      }),
      operatorBroadcastConfirmation: { confirmed: true, network: 'testnet11' },
    });

    expect(result.ok).toBeFalse();
    expect(result.submissionRecord).toBeNull();
    expect(result.failures).toContain('deterministic post-signing review binding hash must match source candidate');
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('rejects candidates that have already been broadcast before pushing', async () => {
    const result = await service.submit({
      signedSpendBundleCandidate: signedCandidate({
        signed_spend_bundle_candidate: {
          coin_spends: [COIN_SPEND],
          aggregated_signature: SIG,
          signing_status: 'signed_by_wallet',
          broadcast_status: 'submitted_to_transaction_relay',
        },
      }),
      operatorBroadcastConfirmation: { confirmed: true, network: 'testnet11' },
    });

    expect(result.ok).toBeFalse();
    expect(result.submissionRecord).toBeNull();
    expect(result.failures).toContain('signed_spend_bundle_candidate.signed_spend_bundle_candidate.broadcast_status must be not_broadcast');
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('rejects forbidden wallet provider or secret material before pushing', async () => {
    const result = await service.submit({
      signedSpendBundleCandidate: signedCandidate({ wallet_signature_provider: { id: 'wallet' } }),
      operatorBroadcastConfirmation: { confirmed: true, network: 'testnet11', jwt: 'forbidden' } as never,
    });

    expect(result.ok).toBeFalse();
    expect(result.submissionRecord).toBeNull();
    expect(result.failures).toContain('signed_spend_bundle_candidate.wallet_signature_provider must not be supplied to signed-bundle broadcast');
    expect(result.failures).toContain('operator_broadcast_confirmation.jwt must not be supplied to signed-bundle broadcast');
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('surfaces transaction relay failures without producing a submission record', async () => {
    coinset.pushTransaction.and.rejectWith(new Error('ASSERT_MY_COIN_ID failed'));

    const result = await service.submit({
      signedSpendBundleCandidate: signedCandidate(),
      operatorBroadcastConfirmation: { confirmed: true, network: 'testnet11' },
    });

    expect(result.ok).toBeFalse();
    expect(result.submissionRecord).toBeNull();
    expect(result.failures).toContain('push_transaction failed: ASSERT_MY_COIN_ID failed');
    expect(coinset.pushTransaction).toHaveBeenCalledOnceWith({
      coinSpends: [COIN_SPEND],
      aggregatedSignature: SIG,
    });
  });
});

function signedCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    kind: 'admin_authority_v2_roster_update_signed_spend_bundle_candidate',
    boundary: 'collect_wallet_signature_for_unsigned_spend_bundle_without_broadcast',
    result: 'signed_spend_bundle_candidate_not_broadcast',
    source_candidate: {
      kind: 'admin_authority_v2_roster_update_unsigned_coin_spend_candidate',
      result: 'unsigned_coin_spend_candidate_only_no_signatures',
      singleton_coin_id: H3,
      roster_update_binding_hash: H4,
    },
    signed_spend_bundle_candidate: {
      coin_spends: [COIN_SPEND],
      aggregated_signature: SIG,
      signing_status: 'signed_by_wallet',
      broadcast_status: 'not_broadcast',
    },
    wallet_signature_summary: {
      signature_type: 'bls_aggregated_signature',
      signature_bytes: 96,
      signed_coin_spend_count: 1,
      provider: 'connected_chia_wallet_signSpendBundle',
    },
    deterministic_post_signing_review: {
      singleton_coin_id: H3,
      roster_update_binding_hash: H4,
      signed_coin_spend_count: 1,
      broadcast_status: 'not_broadcast',
    },
    allowed_material: ['wallet_signature', 'aggregated_signature'],
    allowed_outputs: [
      'signed_spend_bundle_candidate',
      'wallet_signature_summary',
      'deterministic_post_signing_review',
    ],
    boundary_guards: [
      'transaction_not_broadcast',
      'backend_not_used_as_roster_authority',
      'coin_spends_not_mutated',
      'roster_transition_not_recomputed',
      'private_keys_not_requested',
    ],
    ...overrides,
  };
}

function h(byte: string): string {
  return '0x' + byte.repeat(32);
}
