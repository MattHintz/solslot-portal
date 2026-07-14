import { Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';
import {
  SolslotApiService,
  type VaultCredentialReceipt,
  type ZkPassportEnrollmentRecord,
} from './solslot-api.service';

const RETIRED_LOCAL_RECEIPT_KEY = 'SOLSLOT_ZKPASSPORT_PROOFS_V2';
const EMPTY_ATTEST_ROOT =
  '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a';

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
    if (receipt.confirmedBlockIndex === null || receipt.confirmedBlockIndex === undefined) return null;
    const root = normalizeHex32(receipt.identityAttestRoot, 'receipt.identityAttestRoot');
    if (root === EMPTY_ATTEST_ROOT) return null;
    if (!receipt.chiaVaultCoinId) return null;
    if (normalizeHex32(receipt.chiaVaultCoinId, 'receipt.chiaVaultCoinId') !== currentCoinId) {
      return null;
    }
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
