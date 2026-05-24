import { Injectable, inject } from '@angular/core';

import {
  A5_ROSTER_UPDATE_CHAIN_CONFIRMATION_MONITORING_CONTRACT,
  A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT,
  A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT,
} from '../../docs/a5-roster-update-authorization.contract';
import { bytesToHex, hexToBytes } from '../../utils/chia-hash';
import { CoinRecord, CoinsetService } from '../coinset.service';

@Injectable({ providedIn: 'root' })
export class AdminRosterChainConfirmationMonitoringService {
  private readonly coinset = inject(CoinsetService);

  async observe(input: AdminRosterChainConfirmationMonitoringRequest): Promise<AdminRosterChainConfirmationMonitoringResult> {
    const failures: string[] = [];
    const record = asRecord(input.broadcastSubmissionRecord);
    if (!record) {
      failures.push('broadcast_submission_record must be an object');
      return monitoringResult(failures, null);
    }

    collectForbiddenMonitoringMaterial(record, 'broadcast_submission_record', failures);

    expectString(record, 'kind', 'admin_authority_v2_roster_update_broadcast_submission_record', failures, 'broadcast_submission_record.kind');
    expectString(record, 'boundary', A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.boundary, failures, 'broadcast_submission_record.boundary');
    expectString(record, 'result', A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.result, failures, 'broadcast_submission_record.result');

    const sourceCandidate = readRecord(record, 'source_candidate', failures, 'broadcast_submission_record.source_candidate');
    const deterministicReview = readRecord(record, 'deterministic_broadcast_review', failures, 'broadcast_submission_record.deterministic_broadcast_review');
    const pushResponse = readRecord(record, 'push_transaction_response', failures, 'broadcast_submission_record.push_transaction_response');

    if (!sourceCandidate || !deterministicReview || !pushResponse) {
      return monitoringResult(failures, null);
    }

    expectString(sourceCandidate, 'kind', 'admin_authority_v2_roster_update_signed_spend_bundle_candidate', failures, 'broadcast_submission_record.source_candidate.kind');
    expectString(sourceCandidate, 'result', A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.result, failures, 'broadcast_submission_record.source_candidate.result');
    expectString(deterministicReview, 'chain_confirmation_status', 'not_claimed', failures, 'broadcast_submission_record.deterministic_broadcast_review.chain_confirmation_status');

    const sourceSingletonCoinId = normalizeHex(
      input.sourceSingletonCoinId,
      'source_singleton_coin_id',
      failures,
      32,
    );
    const recordSourceSingletonCoinId = normalizeHex(
      readString(sourceCandidate, 'singleton_coin_id', failures, 'broadcast_submission_record.source_candidate.singleton_coin_id') ?? '',
      'broadcast_submission_record.source_candidate.singleton_coin_id',
      failures,
      32,
    );
    const reviewSourceSingletonCoinId = normalizeHex(
      readString(deterministicReview, 'singleton_coin_id', failures, 'broadcast_submission_record.deterministic_broadcast_review.singleton_coin_id') ?? '',
      'broadcast_submission_record.deterministic_broadcast_review.singleton_coin_id',
      failures,
      32,
    );
    const rosterUpdateBindingHash = normalizeHex(
      readString(sourceCandidate, 'roster_update_binding_hash', failures, 'broadcast_submission_record.source_candidate.roster_update_binding_hash') ?? '',
      'broadcast_submission_record.source_candidate.roster_update_binding_hash',
      failures,
      32,
    );

    if (sourceSingletonCoinId && recordSourceSingletonCoinId && sourceSingletonCoinId !== recordSourceSingletonCoinId) {
      failures.push('source_singleton_coin_id must match broadcast_submission_record.source_candidate.singleton_coin_id');
    }
    if (recordSourceSingletonCoinId && reviewSourceSingletonCoinId && recordSourceSingletonCoinId !== reviewSourceSingletonCoinId) {
      failures.push('deterministic broadcast review singleton coin id must match source candidate');
    }

    if (failures.length) return monitoringResult(failures, null);

    let sourceCoinRecord: CoinRecord | null;
    try {
      sourceCoinRecord = await this.coinset.getCoinRecordByName(sourceSingletonCoinId);
    } catch (e) {
      failures.push(`source singleton coin record observation failed: ${errorMessage(e)}`);
      return monitoringResult(failures, null);
    }
    if (!sourceCoinRecord) {
      failures.push('source singleton coin record must be observed from chain');
      return monitoringResult(failures, null);
    }

    let childCoinRecords: CoinRecord[] = [];
    try {
      childCoinRecords = await this.coinset.getCoinRecordsByParentIds([sourceSingletonCoinId], true);
    } catch (e) {
      failures.push(`child coin record observation failed: ${errorMessage(e)}`);
      return monitoringResult(failures, null);
    }

    const sourceSpent = sourceCoinRecord.spent_block_index > 0;
    const observation: AdminRosterChainConfirmationObservation = {
      version: 1,
      kind: 'admin_authority_v2_roster_update_chain_confirmation_observation',
      boundary: A5_ROSTER_UPDATE_CHAIN_CONFIRMATION_MONITORING_CONTRACT.boundary,
      result: A5_ROSTER_UPDATE_CHAIN_CONFIRMATION_MONITORING_CONTRACT.result,
      source_submission: {
        kind: 'admin_authority_v2_roster_update_broadcast_submission_record',
        result: A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.result,
        singleton_coin_id: sourceSingletonCoinId,
        roster_update_binding_hash: rosterUpdateBindingHash,
        relay_status: readOptionalString(deterministicReview, 'relay_status'),
        relay_acceptance_is_chain_confirmation: false,
      },
      source_coin_record: sourceCoinRecord,
      child_coin_records: childCoinRecords,
      observed_coin_record_summary: {
        source_singleton_coin_id: sourceSingletonCoinId,
        source_coin_confirmed_block_index: sourceCoinRecord.confirmed_block_index,
        source_coin_spent_block_index: sourceCoinRecord.spent_block_index,
        source_coin_spent_on_chain: sourceSpent,
        source_coin_observation_status: sourceSpent
          ? 'source_singleton_coin_spent_on_chain'
          : 'source_singleton_coin_unspent_on_chain',
        child_coin_record_count: childCoinRecords.length,
      },
      chain_confirmation_observation: {
        relay_acceptance_status: 'not_chain_confirmation',
        roster_authority_claim: 'not_made',
        roster_transition_recomputed: false,
        observation_status: sourceSpent
          ? 'source_singleton_spend_observed_on_chain'
          : 'source_singleton_still_unspent_after_relay_submission',
      },
      allowed_material: [...A5_ROSTER_UPDATE_CHAIN_CONFIRMATION_MONITORING_CONTRACT.allowedMaterial],
      allowed_outputs: [...A5_ROSTER_UPDATE_CHAIN_CONFIRMATION_MONITORING_CONTRACT.allowedOutputs],
      boundary_guards: [
        'transaction_not_resubmitted',
        'wallet_signature_not_collected',
        'transaction_not_signed',
        'coin_spends_not_mutated',
        'roster_transition_not_recomputed',
        'backend_not_used_as_roster_authority',
        'relay_acceptance_not_treated_as_confirmation',
        'private_keys_not_requested',
      ],
    };

    return monitoringResult(failures, observation);
  }
}

export interface AdminRosterChainConfirmationMonitoringRequest {
  broadcastSubmissionRecord: unknown;
  sourceSingletonCoinId: string;
}

export interface AdminRosterChainConfirmationMonitoringResult {
  ok: boolean;
  status: string;
  failures: string[];
  observation: AdminRosterChainConfirmationObservation | null;
}

export interface AdminRosterChainConfirmationObservation {
  version: 1;
  kind: 'admin_authority_v2_roster_update_chain_confirmation_observation';
  boundary: typeof A5_ROSTER_UPDATE_CHAIN_CONFIRMATION_MONITORING_CONTRACT.boundary;
  result: typeof A5_ROSTER_UPDATE_CHAIN_CONFIRMATION_MONITORING_CONTRACT.result;
  source_submission: {
    kind: 'admin_authority_v2_roster_update_broadcast_submission_record';
    result: typeof A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.result;
    singleton_coin_id: string;
    roster_update_binding_hash: string;
    relay_status: string | null;
    relay_acceptance_is_chain_confirmation: false;
  };
  source_coin_record: CoinRecord;
  child_coin_records: CoinRecord[];
  observed_coin_record_summary: {
    source_singleton_coin_id: string;
    source_coin_confirmed_block_index: number;
    source_coin_spent_block_index: number;
    source_coin_spent_on_chain: boolean;
    source_coin_observation_status: 'source_singleton_coin_spent_on_chain' | 'source_singleton_coin_unspent_on_chain';
    child_coin_record_count: number;
  };
  chain_confirmation_observation: {
    relay_acceptance_status: 'not_chain_confirmation';
    roster_authority_claim: 'not_made';
    roster_transition_recomputed: false;
    observation_status: 'source_singleton_spend_observed_on_chain' | 'source_singleton_still_unspent_after_relay_submission';
  };
  allowed_material: string[];
  allowed_outputs: string[];
  boundary_guards: string[];
}

type JsonRecord = Record<string, unknown>;

const FORBIDDEN_MONITORING_MATERIAL_KEYS = new Set([
  'private_key',
  'privatekey',
  'mnemonic',
  'mnemonics',
  'api_credentials',
  'apicredentials',
  'jwt',
  'nonce',
  'secret',
  'backend_authority_attestation',
  'backendauthorityattestation',
  'wallet_signature_provider',
  'walletsignatureprovider',
]);

function monitoringResult(
  failures: string[],
  observation: AdminRosterChainConfirmationObservation | null,
): AdminRosterChainConfirmationMonitoringResult {
  return {
    ok: failures.length === 0 && observation !== null,
    status: failures.length === 0 && observation !== null
      ? A5_ROSTER_UPDATE_CHAIN_CONFIRMATION_MONITORING_CONTRACT.result
      : 'fails_chain_confirmation_monitoring_rechecks',
    failures,
    observation,
  };
}

function collectForbiddenMonitoringMaterial(value: unknown, path: string, failures: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenMonitoringMaterial(item, `${path}[${index}]`, failures));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (FORBIDDEN_MONITORING_MATERIAL_KEYS.has(normalizedKey)) {
      failures.push(`${childPath} must not be supplied to chain confirmation monitoring`);
    }
    collectForbiddenMonitoringMaterial(child, childPath, failures);
  }
}

function expectString(record: JsonRecord, key: string, expected: string, failures: string[], path: string): void {
  const value = readString(record, key, failures, path);
  if (value !== null && value !== expected) failures.push(`${path} must be ${expected}`);
}

function readRecord(record: JsonRecord, key: string, failures: string[], path: string): JsonRecord | null {
  const value = record[key];
  const nested = asRecord(value);
  if (!nested) failures.push(`${path} must be an object`);
  return nested;
}

function readString(record: JsonRecord, key: string, failures: string[], path: string): string | null {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    failures.push(`${path} must be a non-empty string`);
    return null;
  }
  return value;
}

function readOptionalString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeHex(value: string, path: string, failures: string[], expectedBytes?: number): string {
  try {
    const bytes = hexToBytes(value.trim());
    if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
      failures.push(`${path} must be ${expectedBytes} bytes`);
      return '';
    }
    return bytesToHex(bytes);
  } catch (e) {
    failures.push(`${path} must be hex: ${errorMessage(e)}`);
    return '';
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
