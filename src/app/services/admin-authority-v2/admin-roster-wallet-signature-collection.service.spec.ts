import { TestBed } from '@angular/core/testing';

import { ChiaWalletService, UnsignedCoinSpend } from '../chia-wallet.service';
import {
  AdminRosterWalletSignatureCollectionService,
} from './admin-roster-wallet-signature-collection.service';

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

describe('AdminRosterWalletSignatureCollectionService', () => {
  let service: AdminRosterWalletSignatureCollectionService;
  let wallet: jasmine.SpyObj<Pick<ChiaWalletService, 'signSpendBundle'>>;

  beforeEach(() => {
    wallet = jasmine.createSpyObj('ChiaWalletService', ['signSpendBundle']);
    wallet.signSpendBundle.and.resolveTo({
      coinSpends: [COIN_SPEND],
      aggregatedSignature: SIG,
    });

    TestBed.configureTestingModule({
      providers: [
        AdminRosterWalletSignatureCollectionService,
        { provide: ChiaWalletService, useValue: wallet },
      ],
    });
    service = TestBed.inject(AdminRosterWalletSignatureCollectionService);
  });

  it('collects a wallet signature for an unsigned candidate without broadcasting', async () => {
    const result = await service.collect({ unsignedCoinSpendCandidate: unsignedCandidate() });

    expect(result.ok).toBeTrue();
    expect(result.status).toBe('signed_spend_bundle_candidate_not_broadcast');
    expect(wallet.signSpendBundle).toHaveBeenCalledOnceWith([COIN_SPEND]);
    expect(result.signedCandidate?.kind).toBe('admin_authority_v2_roster_update_signed_spend_bundle_candidate');
    expect(result.signedCandidate?.signed_spend_bundle_candidate).toEqual({
      coin_spends: [COIN_SPEND],
      aggregated_signature: SIG,
      signing_status: 'signed_by_wallet',
      broadcast_status: 'not_broadcast',
    });
    expect(result.signedCandidate?.wallet_signature_summary).toEqual({
      signature_type: 'bls_aggregated_signature',
      signature_bytes: 96,
      signed_coin_spend_count: 1,
      provider: 'connected_chia_wallet_signSpendBundle',
    });
    expect(result.signedCandidate?.boundary_guards).toContain('transaction_not_broadcast');
    expect(result.signedCandidate?.boundary_guards).toContain('coin_spends_not_mutated');
    expect(JSON.stringify(result.signedCandidate).toLowerCase()).not.toContain('mnemonic');
    expect(JSON.stringify(result.signedCandidate).toLowerCase()).not.toContain('jwt');
  });

  it('rejects candidates that already contain signature material before calling the wallet', async () => {
    const candidate = unsignedCandidate({
      unsigned_spend_bundle_candidate: {
        coin_spends: [COIN_SPEND],
        signing_status: 'unsigned_no_signature_material',
        broadcast_status: 'not_broadcast',
        aggregated_signature: SIG,
      },
    });

    const result = await service.collect({ unsignedCoinSpendCandidate: candidate });

    expect(result.ok).toBeFalse();
    expect(result.signedCandidate).toBeNull();
    expect(result.failures).toContain(
      'unsigned_coin_spend_candidate.unsigned_spend_bundle_candidate.aggregated_signature must not be supplied before wallet signature collection',
    );
    expect(wallet.signSpendBundle).not.toHaveBeenCalled();
  });

  it('rejects candidates whose unsigned spend bundle mutates the admin CoinSpend', async () => {
    const mutatedSpend: UnsignedCoinSpend = {
      ...COIN_SPEND,
      solution: '0xcafe',
    };
    const candidate = unsignedCandidate({
      unsigned_spend_bundle_candidate: {
        coin_spends: [mutatedSpend],
        signing_status: 'unsigned_no_signature_material',
        broadcast_status: 'not_broadcast',
      },
    });

    const result = await service.collect({ unsignedCoinSpendCandidate: candidate });

    expect(result.ok).toBeFalse();
    expect(result.failures).toContain('unsigned spend bundle CoinSpend must match unsigned_admin_authority_v2_coin_spend');
    expect(wallet.signSpendBundle).not.toHaveBeenCalled();
  });

  it('rejects wallet responses that return mutated CoinSpends', async () => {
    wallet.signSpendBundle.and.resolveTo({
      coinSpends: [{ ...COIN_SPEND, puzzleReveal: '0xcafe' }],
      aggregatedSignature: SIG,
    });

    const result = await service.collect({ unsignedCoinSpendCandidate: unsignedCandidate() });

    expect(result.ok).toBeFalse();
    expect(result.signedCandidate).toBeNull();
    expect(result.failures).toContain('wallet returned CoinSpends must match the unsigned candidate bytes exactly');
  });

  it('rejects invalid wallet signatures', async () => {
    wallet.signSpendBundle.and.resolveTo({
      coinSpends: [COIN_SPEND],
      aggregatedSignature: '0x' + 'aa'.repeat(95),
    });

    const result = await service.collect({ unsignedCoinSpendCandidate: unsignedCandidate() });

    expect(result.ok).toBeFalse();
    expect(result.signedCandidate).toBeNull();
    expect(result.failures).toContain('wallet_signed_spend_bundle.aggregatedSignature must be 96 bytes');
  });

  it('surfaces wallet signing failures without producing a signed candidate', async () => {
    wallet.signSpendBundle.and.rejectWith(new Error('User rejected request'));

    const result = await service.collect({ unsignedCoinSpendCandidate: unsignedCandidate() });

    expect(result.ok).toBeFalse();
    expect(result.signedCandidate).toBeNull();
    expect(result.failures).toContain('wallet signature collection failed: User rejected request');
  });
});

function unsignedCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    kind: 'admin_authority_v2_roster_update_unsigned_coin_spend_candidate',
    boundary: 'execute_mips_and_serialize_unsigned_coin_spends_without_signing_or_broadcast',
    result: 'unsigned_coin_spend_candidate_only_no_signatures',
    source_plan: {
      kind: 'admin_authority_v2_roster_update_unsigned_clvm_construction_plan',
      result: 'unsigned_clvm_construction_plan_only_no_coin_spends',
      singleton_coin_id: H3,
      roster_update_binding_hash: H4,
    },
    bounded_mips_execution_report: {
      status: 'executed_and_conditions_match_expected_roster_update',
      max_cost: '11000000000',
      cost: '123',
      opcodes: [],
      create_puzzle_announcements: [],
      create_coins: [],
      agg_sig_me_conditions: [],
      asserted_my_amount: [],
    },
    unsigned_admin_authority_v2_coin_spend: COIN_SPEND,
    embedded_mips_authorization_payload: {
      puzzle_reveal_tree_hash: H1,
      quorum_solution_tree_hash: H2,
      execution_scope: 'executed_inside_admin_authority_v2_inner_solution',
      raw_material_location: 'admin_authority_v2_coin_spend.solution_only',
    },
    unsigned_spend_bundle_candidate: {
      coin_spends: [COIN_SPEND],
      signing_status: 'unsigned_no_signature_material',
      broadcast_status: 'not_broadcast',
    },
    deterministic_pre_signing_review: {
      singleton_coin_id: H3,
      current_singleton_full_puzzle_hash: H2,
      next_singleton_full_puzzle_hash: H1,
      new_state_hash: H2,
      roster_update_binding_hash: H4,
      mips_execution_cost: '123',
    },
    raw_material_status: {
      current_mips_puzzle_reveal: 'serialized_inside_admin_authority_v2_coin_spend_solution_only',
      current_mips_quorum_solution: 'serialized_inside_admin_authority_v2_coin_spend_solution_only',
      current_admin_authority_v2_inner_puzzle_reveal: 'serialized_inside_admin_authority_v2_coin_spend_puzzle_reveal_only',
    },
    allowed_material: [
      'raw_reveal_bytes_inside_unsigned_coin_spend_puzzle_reveal_only',
      'raw_solution_bytes_inside_unsigned_coin_spend_solution_only',
    ],
    allowed_outputs: [
      'bounded_mips_execution_report',
      'unsigned_admin_authority_v2_coin_spend',
      'embedded_mips_authorization_payload',
      'unsigned_spend_bundle_candidate',
      'deterministic_pre_signing_review',
    ],
    boundary_guards: [
      'wallet_signature_not_collected',
      'transaction_not_signed',
      'transaction_not_broadcast',
      'backend_not_used_as_roster_authority',
      'credentials_not_output',
    ],
    ...overrides,
  };
}

function h(byte: string): string {
  return '0x' + byte.repeat(32);
}
