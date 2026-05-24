import { Injectable, inject } from '@angular/core';

import {
  A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT,
  A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT,
} from '../../docs/a5-roster-update-authorization.contract';
import { bytesToHex, hexToBytes } from '../../utils/chia-hash';
import { CoinsetService, PushTxResponse, PushTxSpendBundle } from '../coinset.service';
import type { UnsignedCoinSpend } from '../chia-wallet.service';

@Injectable({ providedIn: 'root' })
export class AdminRosterSignedBundleBroadcastService {
  private readonly coinset = inject(CoinsetService);

  async submit(input: AdminRosterSignedBundleBroadcastRequest): Promise<AdminRosterSignedBundleBroadcastResult> {
    const failures: string[] = [];
    const candidate = asRecord(input.signedSpendBundleCandidate);
    if (!candidate) {
      failures.push('signed_spend_bundle_candidate must be an object');
      return broadcastResult(failures, null);
    }

    const confirmation = asRecord(input.operatorBroadcastConfirmation);
    if (!confirmation) {
      failures.push('operator_broadcast_confirmation must be an object');
      return broadcastResult(failures, null);
    }

    collectForbiddenBroadcastMaterial(candidate, 'signed_spend_bundle_candidate', failures);
    collectForbiddenBroadcastMaterial(confirmation, 'operator_broadcast_confirmation', failures);

    expectString(candidate, 'kind', 'admin_authority_v2_roster_update_signed_spend_bundle_candidate', failures, 'signed_spend_bundle_candidate.kind');
    expectString(candidate, 'boundary', A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.boundary, failures, 'signed_spend_bundle_candidate.boundary');
    expectString(candidate, 'result', A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.result, failures, 'signed_spend_bundle_candidate.result');

    const sourceCandidate = readRecord(candidate, 'source_candidate', failures, 'signed_spend_bundle_candidate.source_candidate');
    const bundle = readRecord(candidate, 'signed_spend_bundle_candidate', failures, 'signed_spend_bundle_candidate.signed_spend_bundle_candidate');
    const summary = readRecord(candidate, 'wallet_signature_summary', failures, 'signed_spend_bundle_candidate.wallet_signature_summary');
    const postSigningReview = readRecord(candidate, 'deterministic_post_signing_review', failures, 'signed_spend_bundle_candidate.deterministic_post_signing_review');

    if (!sourceCandidate || !bundle || !summary || !postSigningReview) {
      return broadcastResult(failures, null);
    }

    expectString(bundle, 'signing_status', 'signed_by_wallet', failures, 'signed_spend_bundle_candidate.signed_spend_bundle_candidate.signing_status');
    expectString(bundle, 'broadcast_status', 'not_broadcast', failures, 'signed_spend_bundle_candidate.signed_spend_bundle_candidate.broadcast_status');
    expectString(summary, 'signature_type', 'bls_aggregated_signature', failures, 'signed_spend_bundle_candidate.wallet_signature_summary.signature_type');
    compareNumber(
      readSafeInteger(summary, 'signature_bytes', failures, 'signed_spend_bundle_candidate.wallet_signature_summary.signature_bytes'),
      96,
      'wallet signature summary signature_bytes must be 96',
      failures,
    );
    expectString(postSigningReview, 'broadcast_status', 'not_broadcast', failures, 'signed_spend_bundle_candidate.deterministic_post_signing_review.broadcast_status');

    const coinSpendsInput = readArray(bundle, 'coin_spends', failures, 'signed_spend_bundle_candidate.signed_spend_bundle_candidate.coin_spends');
    const coinSpends = coinSpendsInput
      ? coinSpendsInput.map((spend, index) => readCoinSpend(spend, `signed_spend_bundle_candidate.signed_spend_bundle_candidate.coin_spends[${index}]`, failures))
      : null;
    if (!coinSpends || coinSpends.some((spend) => spend === null)) {
      return broadcastResult(failures, null);
    }

    const signedCoinSpends = coinSpends as UnsignedCoinSpend[];
    if (signedCoinSpends.length !== 1) {
      failures.push('signed spend bundle candidate must contain exactly one admin_authority_v2 CoinSpend');
    }

    const aggregatedSignature = normalizeHex(
      readString(bundle, 'aggregated_signature', failures, 'signed_spend_bundle_candidate.signed_spend_bundle_candidate.aggregated_signature') ?? '',
      'signed_spend_bundle_candidate.signed_spend_bundle_candidate.aggregated_signature',
      failures,
      96,
    );

    compareNumber(
      readSafeInteger(summary, 'signed_coin_spend_count', failures, 'signed_spend_bundle_candidate.wallet_signature_summary.signed_coin_spend_count'),
      signedCoinSpends.length,
      'wallet signature summary signed_coin_spend_count must match signed CoinSpend count',
      failures,
    );
    compareNumber(
      readSafeInteger(postSigningReview, 'signed_coin_spend_count', failures, 'signed_spend_bundle_candidate.deterministic_post_signing_review.signed_coin_spend_count'),
      signedCoinSpends.length,
      'deterministic post-signing review signed_coin_spend_count must match signed CoinSpend count',
      failures,
    );

    const sourceSingletonCoinId = readString(sourceCandidate, 'singleton_coin_id', failures, 'signed_spend_bundle_candidate.source_candidate.singleton_coin_id');
    const sourceBindingHash = readString(sourceCandidate, 'roster_update_binding_hash', failures, 'signed_spend_bundle_candidate.source_candidate.roster_update_binding_hash');
    compareHex(
      readString(postSigningReview, 'singleton_coin_id', failures, 'signed_spend_bundle_candidate.deterministic_post_signing_review.singleton_coin_id'),
      sourceSingletonCoinId,
      'deterministic post-signing review singleton coin id must match source candidate',
      failures,
    );
    compareHex(
      readString(postSigningReview, 'roster_update_binding_hash', failures, 'signed_spend_bundle_candidate.deterministic_post_signing_review.roster_update_binding_hash'),
      sourceBindingHash,
      'deterministic post-signing review binding hash must match source candidate',
      failures,
    );

    const confirmed = readBoolean(confirmation, 'confirmed', failures, 'operator_broadcast_confirmation.confirmed');
    if (confirmed === false) failures.push('operator_broadcast_confirmation.confirmed must be true');
    const network = readString(confirmation, 'network', failures, 'operator_broadcast_confirmation.network');
    const expectedNetwork = readOptionalString(confirmation, 'expectedNetwork') ?? readOptionalString(confirmation, 'expected_network');
    if (network && expectedNetwork && network !== expectedNetwork) {
      failures.push('operator_broadcast_confirmation.network must match expected network');
    }

    if (!aggregatedSignature || failures.length) {
      return broadcastResult(failures, null);
    }

    const spendBundle: PushTxSpendBundle = {
      coinSpends: signedCoinSpends,
      aggregatedSignature,
    };

    let pushResponse: PushTxResponse;
    try {
      pushResponse = await this.coinset.pushTransaction(spendBundle);
    } catch (e) {
      failures.push(`push_transaction failed: ${errorMessage(e)}`);
      return broadcastResult(failures, null);
    }

    const submissionRecord: AdminRosterBroadcastSubmissionRecord = {
      version: 1,
      kind: 'admin_authority_v2_roster_update_broadcast_submission_record',
      boundary: A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.boundary,
      result: A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.result,
      source_candidate: {
        kind: 'admin_authority_v2_roster_update_signed_spend_bundle_candidate',
        result: A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.result,
        singleton_coin_id: normalizeHex(sourceSingletonCoinId ?? '', 'signed_spend_bundle_candidate.source_candidate.singleton_coin_id', failures),
        roster_update_binding_hash: normalizeHex(sourceBindingHash ?? '', 'signed_spend_bundle_candidate.source_candidate.roster_update_binding_hash', failures),
      },
      submitted_spend_bundle: {
        coin_spends: signedCoinSpends,
        aggregated_signature: aggregatedSignature,
        signing_status: 'signed_by_wallet',
        broadcast_status: 'submitted_to_transaction_relay',
      },
      operator_broadcast_confirmation: {
        confirmed: true,
        network: network ?? '',
        expected_network: expectedNetwork ?? null,
      },
      push_transaction_response: pushResponse,
      deterministic_broadcast_review: {
        singleton_coin_id: normalizeHex(sourceSingletonCoinId ?? '', 'signed_spend_bundle_candidate.source_candidate.singleton_coin_id', failures),
        roster_update_binding_hash: normalizeHex(sourceBindingHash ?? '', 'signed_spend_bundle_candidate.source_candidate.roster_update_binding_hash', failures),
        signed_coin_spend_count: signedCoinSpends.length,
        relay_status: pushResponse.status,
        chain_confirmation_status: 'not_claimed',
      },
      allowed_material: [...A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.allowedMaterial],
      allowed_outputs: [...A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.allowedOutputs],
      boundary_guards: [
        'operator_confirmed_broadcast',
        'wallet_signature_not_collected',
        'transaction_relay_acceptance_not_chain_confirmation',
        'backend_not_used_as_roster_authority',
        'coin_spends_not_mutated',
        'roster_transition_not_recomputed',
        'private_keys_not_requested',
      ],
    };

    return broadcastResult(failures, submissionRecord);
  }
}

export interface AdminRosterSignedBundleBroadcastRequest {
  signedSpendBundleCandidate: unknown;
  operatorBroadcastConfirmation: {
    confirmed: boolean;
    network: string;
    expectedNetwork?: string;
    expected_network?: string;
  };
}

export interface AdminRosterSignedBundleBroadcastResult {
  ok: boolean;
  status: string;
  failures: string[];
  submissionRecord: AdminRosterBroadcastSubmissionRecord | null;
}

export interface AdminRosterBroadcastSubmissionRecord {
  version: 1;
  kind: 'admin_authority_v2_roster_update_broadcast_submission_record';
  boundary: typeof A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.boundary;
  result: typeof A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.result;
  source_candidate: {
    kind: 'admin_authority_v2_roster_update_signed_spend_bundle_candidate';
    result: typeof A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.result;
    singleton_coin_id: string;
    roster_update_binding_hash: string;
  };
  submitted_spend_bundle: {
    coin_spends: UnsignedCoinSpend[];
    aggregated_signature: string;
    signing_status: 'signed_by_wallet';
    broadcast_status: 'submitted_to_transaction_relay';
  };
  operator_broadcast_confirmation: {
    confirmed: true;
    network: string;
    expected_network: string | null;
  };
  push_transaction_response: PushTxResponse;
  deterministic_broadcast_review: {
    singleton_coin_id: string;
    roster_update_binding_hash: string;
    signed_coin_spend_count: number;
    relay_status: string | null;
    chain_confirmation_status: 'not_claimed';
  };
  allowed_material: string[];
  allowed_outputs: string[];
  boundary_guards: string[];
}

type JsonRecord = Record<string, unknown>;

const FORBIDDEN_BROADCAST_MATERIAL_KEYS = new Set([
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

function broadcastResult(
  failures: string[],
  submissionRecord: AdminRosterBroadcastSubmissionRecord | null,
): AdminRosterSignedBundleBroadcastResult {
  return {
    ok: failures.length === 0 && submissionRecord !== null,
    status: failures.length === 0 && submissionRecord !== null
      ? A5_ROSTER_UPDATE_SIGNED_BUNDLE_BROADCAST_CONTRACT.result
      : 'fails_signed_bundle_broadcast_rechecks',
    failures,
    submissionRecord,
  };
}

function collectForbiddenBroadcastMaterial(value: unknown, path: string, failures: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenBroadcastMaterial(item, `${path}[${index}]`, failures));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (FORBIDDEN_BROADCAST_MATERIAL_KEYS.has(normalizedKey)) {
      failures.push(`${childPath} must not be supplied to signed-bundle broadcast`);
    }
    collectForbiddenBroadcastMaterial(child, childPath, failures);
  }
}

function readCoinSpend(value: unknown, path: string, failures: string[]): UnsignedCoinSpend | null {
  const spend = asRecord(value);
  if (!spend) {
    failures.push(`${path} must be an object`);
    return null;
  }
  const coin = asRecord(spend['coin']);
  if (!coin) {
    failures.push(`${path}.coin must be an object`);
    return null;
  }
  const parentCoinInfo = normalizeHex(readString(coin, 'parentCoinInfo', failures, `${path}.coin.parentCoinInfo`) ?? '', `${path}.coin.parentCoinInfo`, failures, 32);
  const puzzleHash = normalizeHex(readString(coin, 'puzzleHash', failures, `${path}.coin.puzzleHash`) ?? '', `${path}.coin.puzzleHash`, failures, 32);
  const amount = readAmount(coin['amount'], `${path}.coin.amount`, failures);
  const puzzleReveal = normalizeHex(readString(spend, 'puzzleReveal', failures, `${path}.puzzleReveal`) ?? '', `${path}.puzzleReveal`, failures);
  const solution = normalizeHex(readString(spend, 'solution', failures, `${path}.solution`) ?? '', `${path}.solution`, failures);
  if (!parentCoinInfo || !puzzleHash || amount === null || !puzzleReveal || !solution) return null;
  return {
    coin: { parentCoinInfo, puzzleHash, amount },
    puzzleReveal,
    solution,
  };
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

function readArray(record: JsonRecord, key: string, failures: string[], path: string): unknown[] | null {
  const value = record[key];
  if (!Array.isArray(value)) {
    failures.push(`${path} must be an array`);
    return null;
  }
  return value;
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

function readBoolean(record: JsonRecord, key: string, failures: string[], path: string): boolean | null {
  const value = record[key];
  if (typeof value !== 'boolean') {
    failures.push(`${path} must be a boolean`);
    return null;
  }
  return value;
}

function readSafeInteger(record: JsonRecord, key: string, failures: string[], path: string): number | null {
  const value = record[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  failures.push(`${path} must be a non-negative safe integer`);
  return null;
}

function readAmount(value: unknown, path: string, failures: string[]): number | bigint | null {
  if (typeof value === 'bigint') {
    if (value < 0n) failures.push(`${path} must be non-negative`);
    return value >= 0n ? value : null;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  failures.push(`${path} must be a non-negative safe integer`);
  return null;
}

function compareHex(a: string | null, b: string | null, message: string, failures: string[]): void {
  if (!a || !b) return;
  if (normalizeHex(a, message, failures) !== normalizeHex(b, message, failures)) failures.push(message);
}

function compareNumber(a: number | null, b: number, message: string, failures: string[]): void {
  if (a === null) return;
  if (a !== b) failures.push(message);
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
