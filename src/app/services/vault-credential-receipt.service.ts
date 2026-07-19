import { Injectable, inject } from '@angular/core';
import { sha256 } from 'ethers';

import { environment } from '../../environments/environment';
import {
  SolslotApiService,
  type VaultCredentialReceipt,
  type ZkPassportEnrollmentRecord,
} from './solslot-api.service';
import { canonicalIntBytes, coinId, hexToBytes } from '../utils/chia-hash';

const RETIRED_LOCAL_RECEIPT_KEY = 'SOLSLOT_ZKPASSPORT_PROOFS_V2';
const EMPTY_ATTEST_ROOT =
  '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a';
const ZKPASSPORT_ATTEST_DOMAIN = new TextEncoder().encode('solslot-zkpassport-vault-attestation-v2');

/**
 * In-memory view of public credential receipts freshly recovered from the API.
 * Browser storage is deliberately never consulted for authorization.
 */
@Injectable({ providedIn: 'root' })
export class VaultCredentialReceiptService {
  private readonly api = inject(SolslotApiService);
  private readonly records = new Map<string, ZkPassportEnrollmentRecord>();
  private readonly serverRecovered = new Set<string>();

  constructor() {
    this.dropRetiredLocalReceiptCache();
  }

  async refresh(vaultLauncherId: string): Promise<ZkPassportEnrollmentRecord | null> {
    const key = normalizeHex32(vaultLauncherId, 'vaultLauncherId');
    try {
      const record = await this.api.getZkPassportEnrollment(key);
      if (!record) {
        this.clear(key);
        return null;
      }
      this.validateRecordBinding(record, key);
      this.records.set(key, record);
      this.serverRecovered.add(key);
      return record;
    } catch (error) {
      this.clear(key);
      throw error;
    }
  }

  cached(vaultLauncherId: string | null | undefined): ZkPassportEnrollmentRecord | null {
    if (!vaultLauncherId) return null;
    return this.records.get(normalizeHex32(vaultLauncherId, 'vaultLauncherId')) ?? null;
  }

  confirmedReceipt(
    vaultLauncherId: string | null | undefined,
    currentVaultCoinId: string | null | undefined,
  ): VaultCredentialReceipt | null {
    if (!vaultLauncherId || !currentVaultCoinId) return null;
    const key = normalizeHex32(vaultLauncherId, 'vaultLauncherId');
    const currentCoinId = normalizeHex32(currentVaultCoinId, 'currentVaultCoinId');
    if (!this.serverRecovered.has(key)) return null;

    const record = this.records.get(key);
    const receipt = record?.receipt ?? null;
    if (record?.status !== 'chia_confirmed' || !receipt) return null;
    if (normalizeHex32(receipt.vaultLauncherId, 'receipt.vaultLauncherId') !== key) return null;
    if (record.network !== 'testnet11' || receipt.network !== 'testnet11') return null;
    if (record.policyVersion !== environment.zkPassport.policyVersion) return null;
    if (receipt.policyVersion !== environment.zkPassport.policyVersion) return null;
    if (normalizeHex32(receipt.bridgePolicyHash, 'receipt.bridgePolicyHash') !==
        normalizeHex32(record.bridgePolicyHash, 'record.bridgePolicyHash')) return null;
    if (normalizeHex32(receipt.bridgeParentId, 'receipt.bridgeParentId') !==
        normalizeHex32(record.bridgeParentId, 'record.bridgeParentId')) return null;
    if (receipt.bridgeAmount !== record.bridgeAmount) return null;
    if (normalizeHex32(receipt.bridgeCoinId, 'receipt.bridgeCoinId') !==
        normalizeHex32(record.bridgeCoinId, 'record.bridgeCoinId')) return null;
    const expectedBridgeCoinId = coinId(record.bridgeParentId, record.bridgePolicyHash, record.bridgeAmount);
    if (normalizeHex32(record.bridgeCoinId, 'record.bridgeCoinId') !== expectedBridgeCoinId) return null;
    if (receipt.confirmedBlockIndex === null || receipt.confirmedBlockIndex === undefined) return null;
    const root = normalizeHex32(receipt.identityAttestRoot, 'receipt.identityAttestRoot');
    if (root === EMPTY_ATTEST_ROOT) return null;
    if (!receipt.chiaVaultCoinId) return null;
    if (normalizeHex32(receipt.chiaVaultCoinId, 'receipt.chiaVaultCoinId') !== currentCoinId) {
      return null;
    }
    if (!this.hasValidMessages(receipt)) return null;
    return receipt;
  }

  clear(vaultLauncherId: string | null | undefined): void {
    if (!vaultLauncherId) return;
    const key = normalizeHex32(vaultLauncherId, 'vaultLauncherId');
    this.records.delete(key);
    this.serverRecovered.delete(key);
  }

  private validateRecordBinding(record: ZkPassportEnrollmentRecord, expectedLauncherId: string): void {
    if (normalizeHex32(record.vaultLauncherId, 'record.vaultLauncherId') !== expectedLauncherId) {
      throw new Error('The recovered zkPassport receipt belongs to a different vault.');
    }
    if (record.network !== 'testnet11') {
      throw new Error(`The recovered zkPassport receipt is for ${record.network}, not testnet11.`);
    }
    if (record.policyVersion !== environment.zkPassport.policyVersion) {
      throw new Error('The recovered zkPassport receipt uses a retired policy version.');
    }
  }

  private hasValidMessages(receipt: VaultCredentialReceipt): boolean {
    if (!receipt.bridgeMessage && !receipt.validatorMessage) return true;
    if (!receipt.bridgeMessage) return false;
    const expectedBridgeMessage = computeAttestationBridgeMessage({
      vaultLauncherId: receipt.vaultLauncherId,
      attestationRoot: receipt.identityAttestRoot,
      bridgePolicyHash: receipt.bridgePolicyHash,
      policyVersion: receipt.policyVersion,
    });
    if (normalizeHex32(receipt.bridgeMessage, 'receipt.bridgeMessage') !== expectedBridgeMessage) {
      return false;
    }
    if (!receipt.validatorMessage) return true;
    if (
      !receipt.scopedNullifier ||
      receipt.nullifierType === null ||
      receipt.nullifierType === undefined ||
      !receipt.serviceScopeHash ||
      !receipt.serviceSubscopeHash ||
      receipt.proofTimestamp === null ||
      receipt.proofTimestamp === undefined
    ) {
      return false;
    }
    const expectedValidatorMessage = computeValidatorBridgeMessage({
      vaultLauncherId: receipt.vaultLauncherId,
      attestationRoot: receipt.identityAttestRoot,
      bridgePolicyHash: receipt.bridgePolicyHash,
      bridgeCoinId: receipt.bridgeCoinId,
      bridgeMessage: receipt.bridgeMessage,
      attestationLeafHash: receipt.attestationLeafHash,
      scopedNullifier: receipt.scopedNullifier,
      nullifierType: receipt.nullifierType,
      serviceScopeHash: receipt.serviceScopeHash,
      serviceSubscopeHash: receipt.serviceSubscopeHash,
      proofTimestamp: receipt.proofTimestamp,
      policyVersion: receipt.policyVersion,
    });
    return normalizeHex32(receipt.validatorMessage, 'receipt.validatorMessage') === expectedValidatorMessage;
  }

  private dropRetiredLocalReceiptCache(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(RETIRED_LOCAL_RECEIPT_KEY);
    } catch {
      // Storage can be unavailable in private browsing and test environments.
    }
  }
}

function normalizeHex32(value: string, field: string): string {
  const normalized = value.startsWith('0x') || value.startsWith('0X')
    ? `0x${value.slice(2).toLowerCase()}`
    : `0x${value.toLowerCase()}`;
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${field} must be a 32-byte hex string`);
  }
  return normalized;
}

function computeAttestationBridgeMessage(input: {
  vaultLauncherId: string;
  attestationRoot: string;
  bridgePolicyHash: string;
  policyVersion: number;
}): string {
  return listTreeHash([
    atomTreeHash(ZKPASSPORT_ATTEST_DOMAIN),
    intTreeHash(input.policyVersion, 'policyVersion', 0xffff),
    atomTreeHash(hexToBytes(normalizeHex32(input.vaultLauncherId, 'vaultLauncherId'))),
    atomTreeHash(hexToBytes(normalizeHex32(input.attestationRoot, 'attestationRoot'))),
    atomTreeHash(hexToBytes(normalizeHex32(input.bridgePolicyHash, 'bridgePolicyHash'))),
  ]);
}

function computeValidatorBridgeMessage(input: {
  vaultLauncherId: string;
  attestationRoot: string;
  bridgePolicyHash: string;
  bridgeCoinId: string;
  bridgeMessage: string;
  attestationLeafHash: string;
  scopedNullifier: string;
  nullifierType: number;
  serviceScopeHash: string;
  serviceSubscopeHash: string;
  proofTimestamp: number;
  policyVersion: number;
}): string {
  return listTreeHash([
    atomTreeHash(uintToBytes32(input.policyVersion, 'policyVersion', 0xffff)),
    atomTreeHash(hexToBytes(normalizeHex32(input.vaultLauncherId, 'vaultLauncherId'))),
    atomTreeHash(hexToBytes(normalizeHex32(input.attestationRoot, 'attestationRoot'))),
    atomTreeHash(hexToBytes(normalizeHex32(input.bridgePolicyHash, 'bridgePolicyHash'))),
    atomTreeHash(hexToBytes(normalizeHex32(input.bridgeCoinId, 'bridgeCoinId'))),
    atomTreeHash(hexToBytes(normalizeHex32(input.bridgeMessage, 'bridgeMessage'))),
    atomTreeHash(hexToBytes(normalizeHex32(input.attestationLeafHash, 'attestationLeafHash'))),
    atomTreeHash(hexToBytes(normalizeHex32(input.scopedNullifier, 'scopedNullifier'))),
    atomTreeHash(uintToBytes32(input.nullifierType, 'nullifierType', 0xffff)),
    atomTreeHash(hexToBytes(normalizeHex32(input.serviceScopeHash, 'serviceScopeHash'))),
    atomTreeHash(hexToBytes(normalizeHex32(input.serviceSubscopeHash, 'serviceSubscopeHash'))),
    atomTreeHash(uintToBytes32(input.proofTimestamp, 'proofTimestamp', Number.MAX_SAFE_INTEGER)),
  ]);
}

function listTreeHash(items: string[]): string {
  return items.reduceRight((rest, item) => pairTreeHash(item, rest), atomTreeHash(new Uint8Array(0)));
}

function atomTreeHash(atom: Uint8Array): string {
  return sha256(concatBytes(new Uint8Array([1]), atom));
}

function pairTreeHash(first: string, rest: string): string {
  return sha256(concatBytes(new Uint8Array([2]), hexToBytes(first), hexToBytes(rest)));
}

function intTreeHash(value: number, field: string, max: number): string {
  return atomTreeHash(canonicalIntBytes(assertIntegerRange(value, field, max)));
}

function uintToBytes32(value: number, field: string, max: number): Uint8Array {
  const n = assertIntegerRange(value, field, max);
  const bytes = canonicalIntBytes(n);
  if (bytes.length > 32) {
    throw new Error(`${field} must fit in 32 bytes`);
  }
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

function assertIntegerRange(value: number, field: string, max: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${field} must be an unsigned integer`);
  }
  return BigInt(value);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
