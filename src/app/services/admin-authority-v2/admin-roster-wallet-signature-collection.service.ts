import { Injectable, inject } from '@angular/core';

import {
  A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT,
  A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT,
} from '../../docs/a5-roster-update-authorization.contract';
import { bytesToHex, hexToBytes } from '../../utils/chia-hash';
import { ChiaWalletService, SignedSpendBundle, UnsignedCoinSpend } from '../chia-wallet.service';
import type { AdminRosterMipsExecutionCoinSpendCandidate } from './admin-roster-mips-execution-coin-spend.service';

@Injectable({ providedIn: 'root' })
export class AdminRosterWalletSignatureCollectionService {
  private readonly wallet = inject(ChiaWalletService);

  async collect(input: AdminRosterWalletSignatureCollectionRequest): Promise<AdminRosterWalletSignatureCollectionResult> {
    const failures: string[] = [];
    const candidate = asRecord(input.unsignedCoinSpendCandidate);
    if (!candidate) {
      failures.push('unsigned_coin_spend_candidate must be an object');
      return signatureCollectionResult(failures, null);
    }

    collectExistingSignatureMaterial(candidate, 'unsigned_coin_spend_candidate', failures);
    expectString(candidate, 'kind', 'admin_authority_v2_roster_update_unsigned_coin_spend_candidate', failures, 'unsigned_coin_spend_candidate.kind');
    expectString(candidate, 'boundary', A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.boundary, failures, 'unsigned_coin_spend_candidate.boundary');
    expectString(candidate, 'result', A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.result, failures, 'unsigned_coin_spend_candidate.result');

    const sourcePlan = readRecord(candidate, 'source_plan', failures, 'unsigned_coin_spend_candidate.source_plan');
    const executionReport = readRecord(candidate, 'bounded_mips_execution_report', failures, 'unsigned_coin_spend_candidate.bounded_mips_execution_report');
    const unsignedAdminSpend = readCoinSpend(candidate['unsigned_admin_authority_v2_coin_spend'], 'unsigned_coin_spend_candidate.unsigned_admin_authority_v2_coin_spend', failures);
    const bundle = readRecord(candidate, 'unsigned_spend_bundle_candidate', failures, 'unsigned_coin_spend_candidate.unsigned_spend_bundle_candidate');
    const preSigningReview = readRecord(candidate, 'deterministic_pre_signing_review', failures, 'unsigned_coin_spend_candidate.deterministic_pre_signing_review');

    if (!sourcePlan || !executionReport || !unsignedAdminSpend || !bundle || !preSigningReview) {
      return signatureCollectionResult(failures, null);
    }

    expectString(bundle, 'signing_status', 'unsigned_no_signature_material', failures, 'unsigned_coin_spend_candidate.unsigned_spend_bundle_candidate.signing_status');
    expectString(bundle, 'broadcast_status', 'not_broadcast', failures, 'unsigned_coin_spend_candidate.unsigned_spend_bundle_candidate.broadcast_status');

    const coinSpendsInput = readArray(bundle, 'coin_spends', failures, 'unsigned_coin_spend_candidate.unsigned_spend_bundle_candidate.coin_spends');
    const coinSpends = coinSpendsInput
      ? coinSpendsInput.map((spend, index) => readCoinSpend(spend, `unsigned_coin_spend_candidate.unsigned_spend_bundle_candidate.coin_spends[${index}]`, failures))
      : null;
    if (!coinSpends || coinSpends.some((spend) => spend === null)) {
      return signatureCollectionResult(failures, null);
    }
    const unsignedCoinSpends = coinSpends as UnsignedCoinSpend[];
    if (unsignedCoinSpends.length !== 1) {
      failures.push('unsigned spend bundle candidate must contain exactly one admin_authority_v2 CoinSpend');
    } else {
      compareCoinSpend(unsignedCoinSpends[0], unsignedAdminSpend, 'unsigned spend bundle CoinSpend must match unsigned_admin_authority_v2_coin_spend', failures);
    }

    const sourceSingletonCoinId = readString(sourcePlan, 'singleton_coin_id', failures, 'unsigned_coin_spend_candidate.source_plan.singleton_coin_id');
    const sourceBindingHash = readString(sourcePlan, 'roster_update_binding_hash', failures, 'unsigned_coin_spend_candidate.source_plan.roster_update_binding_hash');
    compareHex(
      readString(preSigningReview, 'singleton_coin_id', failures, 'unsigned_coin_spend_candidate.deterministic_pre_signing_review.singleton_coin_id'),
      sourceSingletonCoinId,
      'deterministic pre-signing review singleton coin id must match source plan',
      failures,
    );
    compareHex(
      readString(preSigningReview, 'roster_update_binding_hash', failures, 'unsigned_coin_spend_candidate.deterministic_pre_signing_review.roster_update_binding_hash'),
      sourceBindingHash,
      'deterministic pre-signing review binding hash must match source plan',
      failures,
    );
    compareHex(
      readString(preSigningReview, 'current_singleton_full_puzzle_hash', failures, 'unsigned_coin_spend_candidate.deterministic_pre_signing_review.current_singleton_full_puzzle_hash'),
      unsignedAdminSpend.coin.puzzleHash,
      'deterministic pre-signing review current singleton full puzzle hash must match CoinSpend puzzle hash',
      failures,
    );
    compareString(
      readString(preSigningReview, 'mips_execution_cost', failures, 'unsigned_coin_spend_candidate.deterministic_pre_signing_review.mips_execution_cost'),
      readString(executionReport, 'cost', failures, 'unsigned_coin_spend_candidate.bounded_mips_execution_report.cost'),
      'deterministic pre-signing review MIPS execution cost must match execution report cost',
      failures,
    );

    if (failures.length) {
      return signatureCollectionResult(failures, null);
    }

    let signed: SignedSpendBundle;
    try {
      signed = await this.wallet.signSpendBundle(unsignedCoinSpends);
    } catch (e) {
      failures.push(`wallet signature collection failed: ${errorMessage(e)}`);
      return signatureCollectionResult(failures, null);
    }

    const signedCoinSpends = signed.coinSpends.map((spend, index) => readCoinSpend(spend, `wallet_signed_spend_bundle.coinSpends[${index}]`, failures));
    const aggregatedSignature = normalizeHex(signed.aggregatedSignature, 'wallet_signed_spend_bundle.aggregatedSignature', failures, 96);
    if (signedCoinSpends.some((spend) => spend === null)) {
      return signatureCollectionResult(failures, null);
    }
    compareCoinSpendArrays(
      signedCoinSpends as UnsignedCoinSpend[],
      unsignedCoinSpends,
      'wallet returned CoinSpends must match the unsigned candidate bytes exactly',
      failures,
    );

    if (!aggregatedSignature || failures.length) {
      return signatureCollectionResult(failures, null);
    }

    const signedCandidate: AdminRosterSignedSpendBundleCandidate = {
      version: 1,
      kind: 'admin_authority_v2_roster_update_signed_spend_bundle_candidate',
      boundary: A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.boundary,
      result: A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.result,
      source_candidate: {
        kind: 'admin_authority_v2_roster_update_unsigned_coin_spend_candidate',
        result: A5_ROSTER_UPDATE_MIPS_EXECUTION_COIN_SPEND_CONTRACT.result,
        singleton_coin_id: normalizeHex(sourceSingletonCoinId ?? '', 'unsigned_coin_spend_candidate.source_plan.singleton_coin_id', failures),
        roster_update_binding_hash: normalizeHex(sourceBindingHash ?? '', 'unsigned_coin_spend_candidate.source_plan.roster_update_binding_hash', failures),
      },
      signed_spend_bundle_candidate: {
        coin_spends: unsignedCoinSpends,
        aggregated_signature: aggregatedSignature,
        signing_status: 'signed_by_wallet',
        broadcast_status: 'not_broadcast',
      },
      wallet_signature_summary: {
        signature_type: 'bls_aggregated_signature',
        signature_bytes: 96,
        signed_coin_spend_count: unsignedCoinSpends.length,
        provider: 'connected_chia_wallet_signSpendBundle',
      },
      deterministic_post_signing_review: {
        singleton_coin_id: normalizeHex(sourceSingletonCoinId ?? '', 'unsigned_coin_spend_candidate.source_plan.singleton_coin_id', failures),
        roster_update_binding_hash: normalizeHex(sourceBindingHash ?? '', 'unsigned_coin_spend_candidate.source_plan.roster_update_binding_hash', failures),
        signed_coin_spend_count: unsignedCoinSpends.length,
        broadcast_status: 'not_broadcast',
      },
      allowed_material: [...A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.allowedMaterial],
      allowed_outputs: [...A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.allowedOutputs],
      boundary_guards: [
        'transaction_not_broadcast',
        'backend_not_used_as_roster_authority',
        'coin_spends_not_mutated',
        'roster_transition_not_recomputed',
        'private_keys_not_requested',
      ],
    };

    return signatureCollectionResult(failures, signedCandidate);
  }
}

export interface AdminRosterWalletSignatureCollectionRequest {
  unsignedCoinSpendCandidate: unknown;
}

export interface AdminRosterWalletSignatureCollectionResult {
  ok: boolean;
  status: string;
  failures: string[];
  signedCandidate: AdminRosterSignedSpendBundleCandidate | null;
}

export interface AdminRosterSignedSpendBundleCandidate {
  version: 1;
  kind: 'admin_authority_v2_roster_update_signed_spend_bundle_candidate';
  boundary: typeof A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.boundary;
  result: typeof A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.result;
  source_candidate: {
    kind: AdminRosterMipsExecutionCoinSpendCandidate['kind'];
    result: AdminRosterMipsExecutionCoinSpendCandidate['result'];
    singleton_coin_id: string;
    roster_update_binding_hash: string;
  };
  signed_spend_bundle_candidate: {
    coin_spends: UnsignedCoinSpend[];
    aggregated_signature: string;
    signing_status: 'signed_by_wallet';
    broadcast_status: 'not_broadcast';
  };
  wallet_signature_summary: {
    signature_type: 'bls_aggregated_signature';
    signature_bytes: 96;
    signed_coin_spend_count: number;
    provider: 'connected_chia_wallet_signSpendBundle';
  };
  deterministic_post_signing_review: {
    singleton_coin_id: string;
    roster_update_binding_hash: string;
    signed_coin_spend_count: number;
    broadcast_status: 'not_broadcast';
  };
  allowed_material: string[];
  allowed_outputs: string[];
  boundary_guards: string[];
}

type JsonRecord = Record<string, unknown>;

const EXISTING_SIGNATURE_KEYS = new Set([
  'aggregatedSignature',
  'aggregated_signature',
  'signature',
  'signatures',
  'signedSpendBundle',
  'signed_spend_bundle',
  'signed_spend_bundle_candidate',
]);

function signatureCollectionResult(
  failures: string[],
  signedCandidate: AdminRosterSignedSpendBundleCandidate | null,
): AdminRosterWalletSignatureCollectionResult {
  return {
    ok: failures.length === 0 && signedCandidate !== null,
    status: failures.length === 0 && signedCandidate !== null
      ? A5_ROSTER_UPDATE_WALLET_SIGNATURE_COLLECTION_CONTRACT.result
      : 'fails_wallet_signature_collection_rechecks',
    failures,
    signedCandidate,
  };
}

function collectExistingSignatureMaterial(value: unknown, path: string, failures: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectExistingSignatureMaterial(item, `${path}[${index}]`, failures));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    if (EXISTING_SIGNATURE_KEYS.has(key)) {
      failures.push(`${childPath} must not be supplied before wallet signature collection`);
    }
    collectExistingSignatureMaterial(child, childPath, failures);
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

function compareString(a: string | null, b: string | null, message: string, failures: string[]): void {
  if (!a || !b) return;
  if (a !== b) failures.push(message);
}

function compareCoinSpend(a: UnsignedCoinSpend, b: UnsignedCoinSpend, message: string, failures: string[]): void {
  if (coinSpendFingerprint(a) !== coinSpendFingerprint(b)) failures.push(message);
}

function compareCoinSpendArrays(a: UnsignedCoinSpend[], b: UnsignedCoinSpend[], message: string, failures: string[]): void {
  if (a.length !== b.length) {
    failures.push(message);
    return;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (coinSpendFingerprint(a[index]) !== coinSpendFingerprint(b[index])) {
      failures.push(message);
      return;
    }
  }
}

function coinSpendFingerprint(spend: UnsignedCoinSpend): string {
  return JSON.stringify({
    coin: {
      parentCoinInfo: spend.coin.parentCoinInfo.toLowerCase(),
      puzzleHash: spend.coin.puzzleHash.toLowerCase(),
      amount: spend.coin.amount.toString(),
    },
    puzzleReveal: spend.puzzleReveal.toLowerCase(),
    solution: spend.solution.toLowerCase(),
  });
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
