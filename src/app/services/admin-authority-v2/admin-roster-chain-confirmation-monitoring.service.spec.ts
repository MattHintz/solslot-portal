import { TestBed } from '@angular/core/testing';

import { CoinRecord, CoinsetService } from '../coinset.service';
import { AdminRosterChainConfirmationMonitoringService } from './admin-roster-chain-confirmation-monitoring.service';

const H1 = h('11');
const H2 = h('22');
const H3 = h('33');
const H4 = h('44');
const SIG = '0x' + 'aa'.repeat(96);

const SOURCE_COIN_RECORD: CoinRecord = {
  coin: {
    parent_coin_info: H1,
    puzzle_hash: H2,
    amount: 1,
  },
  confirmed_block_index: 100,
  spent_block_index: 123,
  coinbase: false,
  timestamp: 1_700_000_000,
};

const CHILD_COIN_RECORD: CoinRecord = {
  coin: {
    parent_coin_info: H3,
    puzzle_hash: H4,
    amount: 1,
  },
  confirmed_block_index: 123,
  spent_block_index: 0,
  coinbase: false,
  timestamp: 1_700_000_100,
};

describe('AdminRosterChainConfirmationMonitoringService', () => {
  let service: AdminRosterChainConfirmationMonitoringService;
  let coinset: jasmine.SpyObj<Pick<CoinsetService, 'getCoinRecordByName' | 'getCoinRecordsByParentIds' | 'pushTransaction'>>;

  beforeEach(() => {
    coinset = jasmine.createSpyObj('CoinsetService', [
      'getCoinRecordByName',
      'getCoinRecordsByParentIds',
      'pushTransaction',
    ]);
    coinset.getCoinRecordByName.and.resolveTo(SOURCE_COIN_RECORD);
    coinset.getCoinRecordsByParentIds.and.resolveTo([CHILD_COIN_RECORD]);

    TestBed.configureTestingModule({
      providers: [
        AdminRosterChainConfirmationMonitoringService,
        { provide: CoinsetService, useValue: coinset },
      ],
    });
    service = TestBed.inject(AdminRosterChainConfirmationMonitoringService);
  });

  it('observes a spent source singleton coin from public chain records without resubmission or confirmation conflation', async () => {
    const result = await service.observe({
      broadcastSubmissionRecord: submissionRecord(),
      sourceSingletonCoinId: H3,
    });

    expect(result.ok).toBeTrue();
    expect(result.status).toBe('chain_confirmation_observation_only');
    expect(coinset.getCoinRecordByName).toHaveBeenCalledOnceWith(H3);
    expect(coinset.getCoinRecordsByParentIds).toHaveBeenCalledOnceWith([H3], true);
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
    expect(result.observation?.source_submission).toEqual({
      kind: 'admin_authority_v2_roster_update_broadcast_submission_record',
      result: 'submitted_spend_bundle_push_result_not_confirmation',
      singleton_coin_id: H3,
      roster_update_binding_hash: H4,
      relay_status: 'SUCCESS',
      relay_acceptance_is_chain_confirmation: false,
    });
    expect(result.observation?.observed_coin_record_summary).toEqual({
      source_singleton_coin_id: H3,
      source_coin_confirmed_block_index: 100,
      source_coin_spent_block_index: 123,
      source_coin_spent_on_chain: true,
      source_coin_observation_status: 'source_singleton_coin_spent_on_chain',
      child_coin_record_count: 1,
    });
    expect(result.observation?.chain_confirmation_observation).toEqual({
      relay_acceptance_status: 'not_chain_confirmation',
      roster_authority_claim: 'not_made',
      roster_transition_recomputed: false,
      observation_status: 'source_singleton_spend_observed_on_chain',
    });
    expect(result.observation?.boundary_guards).toContain('transaction_not_resubmitted');
    expect(result.observation?.boundary_guards).toContain('relay_acceptance_not_treated_as_confirmation');
    expect(result.observation?.boundary_guards).toContain('backend_not_used_as_roster_authority');
    expect(JSON.stringify(result.observation).toLowerCase()).not.toContain('jwt');
    expect(JSON.stringify(result.observation).toLowerCase()).not.toContain('mnemonic');
  });

  it('reports an unspent source singleton as observation-only pending state', async () => {
    coinset.getCoinRecordByName.and.resolveTo({
      ...SOURCE_COIN_RECORD,
      spent_block_index: 0,
    });
    coinset.getCoinRecordsByParentIds.and.resolveTo([]);

    const result = await service.observe({
      broadcastSubmissionRecord: submissionRecord(),
      sourceSingletonCoinId: H3,
    });

    expect(result.ok).toBeTrue();
    expect(result.observation?.observed_coin_record_summary.source_coin_spent_on_chain).toBeFalse();
    expect(result.observation?.observed_coin_record_summary.source_coin_observation_status).toBe('source_singleton_coin_unspent_on_chain');
    expect(result.observation?.chain_confirmation_observation.observation_status).toBe('source_singleton_still_unspent_after_relay_submission');
    expect(result.observation?.chain_confirmation_observation.relay_acceptance_status).toBe('not_chain_confirmation');
  });

  it('rejects submission records that do not come from the broadcast boundary before reading chain state', async () => {
    const result = await service.observe({
      broadcastSubmissionRecord: submissionRecord({ result: 'chain_confirmed' }),
      sourceSingletonCoinId: H3,
    });

    expect(result.ok).toBeFalse();
    expect(result.observation).toBeNull();
    expect(result.failures).toContain('broadcast_submission_record.result must be submitted_spend_bundle_push_result_not_confirmation');
    expect(coinset.getCoinRecordByName).not.toHaveBeenCalled();
    expect(coinset.getCoinRecordsByParentIds).not.toHaveBeenCalled();
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('rejects source singleton mismatches before reading chain state', async () => {
    const result = await service.observe({
      broadcastSubmissionRecord: submissionRecord(),
      sourceSingletonCoinId: H2,
    });

    expect(result.ok).toBeFalse();
    expect(result.observation).toBeNull();
    expect(result.failures).toContain('source_singleton_coin_id must match broadcast_submission_record.source_candidate.singleton_coin_id');
    expect(coinset.getCoinRecordByName).not.toHaveBeenCalled();
    expect(coinset.getCoinRecordsByParentIds).not.toHaveBeenCalled();
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('rejects submission records that already claim chain confirmation before reading chain state', async () => {
    const result = await service.observe({
      broadcastSubmissionRecord: submissionRecord({
        deterministic_broadcast_review: {
          singleton_coin_id: H3,
          roster_update_binding_hash: H4,
          signed_coin_spend_count: 1,
          relay_status: 'SUCCESS',
          chain_confirmation_status: 'confirmed',
        },
      }),
      sourceSingletonCoinId: H3,
    });

    expect(result.ok).toBeFalse();
    expect(result.observation).toBeNull();
    expect(result.failures).toContain('broadcast_submission_record.deterministic_broadcast_review.chain_confirmation_status must be not_claimed');
    expect(coinset.getCoinRecordByName).not.toHaveBeenCalled();
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('rejects forbidden wallet or backend authority material before reading chain state', async () => {
    const result = await service.observe({
      broadcastSubmissionRecord: submissionRecord({ wallet_signature_provider: { id: 'wallet' }, jwt: 'forbidden' }),
      sourceSingletonCoinId: H3,
    });

    expect(result.ok).toBeFalse();
    expect(result.observation).toBeNull();
    expect(result.failures).toContain('broadcast_submission_record.wallet_signature_provider must not be supplied to chain confirmation monitoring');
    expect(result.failures).toContain('broadcast_submission_record.jwt must not be supplied to chain confirmation monitoring');
    expect(coinset.getCoinRecordByName).not.toHaveBeenCalled();
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when the source singleton coin record is not observed from chain', async () => {
    coinset.getCoinRecordByName.and.resolveTo(null);

    const result = await service.observe({
      broadcastSubmissionRecord: submissionRecord(),
      sourceSingletonCoinId: H3,
    });

    expect(result.ok).toBeFalse();
    expect(result.observation).toBeNull();
    expect(result.failures).toContain('source singleton coin record must be observed from chain');
    expect(coinset.getCoinRecordsByParentIds).not.toHaveBeenCalled();
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('surfaces public coin-record read failures without producing an observation', async () => {
    coinset.getCoinRecordByName.and.rejectWith(new Error('coinset unavailable'));

    const result = await service.observe({
      broadcastSubmissionRecord: submissionRecord(),
      sourceSingletonCoinId: H3,
    });

    expect(result.ok).toBeFalse();
    expect(result.observation).toBeNull();
    expect(result.failures).toContain('source singleton coin record observation failed: coinset unavailable');
    expect(coinset.getCoinRecordsByParentIds).not.toHaveBeenCalled();
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });
});

function submissionRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    kind: 'admin_authority_v2_roster_update_broadcast_submission_record',
    boundary: 'push_signed_spend_bundle_after_operator_confirmation',
    result: 'submitted_spend_bundle_push_result_not_confirmation',
    source_candidate: {
      kind: 'admin_authority_v2_roster_update_signed_spend_bundle_candidate',
      result: 'signed_spend_bundle_candidate_not_broadcast',
      singleton_coin_id: H3,
      roster_update_binding_hash: H4,
    },
    submitted_spend_bundle: {
      coin_spends: [
        {
          coin: { parentCoinInfo: H1, puzzleHash: H2, amount: 1 },
          puzzleReveal: '0xfeed',
          solution: '0xbeef',
        },
      ],
      aggregated_signature: SIG,
      signing_status: 'signed_by_wallet',
      broadcast_status: 'submitted_to_transaction_relay',
    },
    operator_broadcast_confirmation: {
      confirmed: true,
      network: 'testnet11',
      expected_network: 'testnet11',
    },
    push_transaction_response: { success: true, status: 'SUCCESS' },
    deterministic_broadcast_review: {
      singleton_coin_id: H3,
      roster_update_binding_hash: H4,
      signed_coin_spend_count: 1,
      relay_status: 'SUCCESS',
      chain_confirmation_status: 'not_claimed',
    },
    allowed_material: [
      'signed_spend_bundle_candidate',
      'aggregated_signature',
      'push_transaction_response',
    ],
    allowed_outputs: [
      'broadcast_submission_record',
      'push_transaction_response',
      'post_broadcast_monitoring_hints',
    ],
    boundary_guards: [
      'operator_confirmed_broadcast',
      'wallet_signature_not_collected',
      'transaction_relay_acceptance_not_chain_confirmation',
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
