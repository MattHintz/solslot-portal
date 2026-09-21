import { Injectable, inject, signal } from '@angular/core';
import {
  HDNodeWallet,
  TypedDataEncoder,
  getAddress,
  getBytes,
  keccak256,
} from 'ethers';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import { ChiaWasmService } from './chia-wasm.service';
import {
  AdminKeyChangeIntentV1,
  ChiaSigningAction,
  RecoveryDrillChallenge,
} from './admin-security.service';
import { Eip712TypedData } from './solslot-api.service';
import { createAdminLostRecoveryPackage, validateRecoveryDrill } from './admin-recovery-handoff';

export const ADMIN_RECOVERY_BLS_PATH = [12381, 8444, 2, 0] as const;
export const ADMIN_RECOVERY_BLS_PATH_LABEL = 'm/12381/8444/2/0-unhardened';
export const ADMIN_RECOVERY_EVM_PATH = "m/44'/60'/0'/0/0";

@Injectable({ providedIn: 'root' })
export class AdminRecoveryKitService {
  private readonly wasm = inject(ChiaWasmService);
  private blsSecretKey: WasmSecretKey | null = null;
  private evmGuardian: HDNodeWallet | null = null;

  readonly unlocked = signal(false);
  readonly recoveryBlsPubkey = signal<string | null>(null);
  readonly evmGuardianAddress = signal<string | null>(null);

  create(): AdminRecoverySecret {
    const mnemonic = generateMnemonic(wordlist, 256);
    const publicIdentity = this.unlock(mnemonic);
    return { mnemonic, ...publicIdentity };
  }

  unlock(
    mnemonicValue: string,
    expected?: { recoveryBlsPubkey?: string; evmGuardian?: string },
  ): AdminRecoveryPublicIdentity {
    const mnemonic = normalizeMnemonic(mnemonicValue);
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new Error('The administrator recovery phrase is invalid.');
    }
    const sdk = this.requireSdk();
    const seed = mnemonicToSeedSync(mnemonic);
    let master: WasmSecretKey | null = null;
    let recovery: WasmSecretKey | null = null;
    try {
      master = sdk.SecretKey.fromSeed(seed);
      recovery = master.deriveUnhardenedPath([...ADMIN_RECOVERY_BLS_PATH]);
      const publicKey = recovery.publicKey();
      let recoveryBlsPubkey: string;
      try {
        recoveryBlsPubkey = bytesToHex(publicKey.toBytes()).toLowerCase();
      } finally {
        publicKey.free();
      }
      const guardian = HDNodeWallet.fromPhrase(mnemonic, '', ADMIN_RECOVERY_EVM_PATH);
      const evmGuardian = getAddress(guardian.address);
      if (
        expected?.recoveryBlsPubkey &&
        normalizeHex(expected.recoveryBlsPubkey) !== recoveryBlsPubkey
      ) {
        throw new Error('This phrase does not match the enrolled Chia recovery key.');
      }
      if (
        expected?.evmGuardian &&
        getAddress(expected.evmGuardian) !== evmGuardian
      ) {
        throw new Error('This phrase does not match the enrolled recovery guardian.');
      }
      this.clear();
      this.blsSecretKey = recovery;
      this.evmGuardian = guardian;
      this.recoveryBlsPubkey.set(recoveryBlsPubkey);
      this.evmGuardianAddress.set(evmGuardian);
      this.unlocked.set(true);
      recovery = null;
      return { recoveryBlsPubkey, evmGuardian };
    } finally {
      seed.fill(0);
      master?.free();
      recovery?.free();
    }
  }

  clear(): void {
    this.blsSecretKey?.free();
    this.blsSecretKey = null;
    this.evmGuardian = null;
    this.recoveryBlsPubkey.set(null);
    this.evmGuardianAddress.set(null);
    this.unlocked.set(false);
  }

  generateBackupPassword(): string {
    const values = new Uint16Array(6);
    crypto.getRandomValues(values);
    return Array.from(values, (value) => wordlist[value & 2047]).join(' ');
  }

  async signDrill(challenge: RecoveryDrillChallenge): Promise<{
    evmSignature: string;
    blsSignature: string;
  }> {
    const snapshot = structuredClone(challenge);
    const guardian = this.requireGuardian();
    const key = this.requireBlsKey();
    validateDrillTypedData(snapshot, guardian.address, this.requireBlsPublicKey());
    const localDigest = validateRecoveryDrill(snapshot, this.requireBlsPublicKey());
    if (snapshot.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new Error('This recovery test has expired. Prepare a new one.');
    }
    const digest = requireHexBytes(localDigest, 32, 'BLS drill digest');
    const signature = key.sign(digest);
    try {
      const { EIP712Domain: _domain, ...types } = snapshot.evmTypedData.types;
      const evmSignature = await guardian.signTypedData(
        snapshot.evmTypedData.domain,
        types,
        snapshot.evmTypedData.message,
      );
      return {
        evmSignature,
        blsSignature: bytesToHex(signature.toBytes()).toLowerCase(),
      };
    } finally {
      digest.fill(0);
      signature.free();
    }
  }

  async signLostKeyAuthorization(args: {
    intent: AdminKeyChangeIntentV1;
    intentHash: string;
    coordinator: string;
    guardianTypedData: Eip712TypedData;
    recoveryBlsDigest: string;
  }): Promise<{ guardianSignature: string; recoveryBlsSignature: string }> {
    const verified = createAdminLostRecoveryPackage(structuredClone(args));
    const guardian = this.requireGuardian();
    validateLostKeyTypedData(
      verified.guardianTypedData,
      verified.intent,
      verified.intentHash,
      verified.coordinator,
      guardian.address,
      this.requireBlsPublicKey(),
    );
    const { EIP712Domain: _domain, ...types } = verified.guardianTypedData.types;
    const guardianSignature = await guardian.signTypedData(
      verified.guardianTypedData.domain,
      types,
      verified.guardianTypedData.message,
    );
    return {
      guardianSignature,
      recoveryBlsSignature: this.signDigest(verified.recoveryBlsDigest),
    };
  }

  async signRecoveryGuardianAction(args: {
    action: 'ACCEPT' | 'VETO';
    expectedChainId?: 84532 | 8453;
    intentHash: string;
    coordinator: string;
    expectedGuardian: string;
    typedData: Eip712TypedData;
  }): Promise<string> {
    const guardian = this.requireGuardian();
    validateRecoveryGuardianTypedData(
      args.typedData,
      args.action,
      args.intentHash,
      args.coordinator,
      args.expectedGuardian,
      guardian.address,
      args.expectedChainId ?? 84532,
    );
    const { EIP712Domain: _domain, ...types } = args.typedData.types;
    return guardian.signTypedData(
      args.typedData.domain,
      types,
      args.typedData.message,
    );
  }

  private signDigest(digestHex: string): string {
    const digest = requireHexBytes(digestHex, 32, 'recovery intent digest');
    const signature = this.requireBlsKey().sign(digest);
    try {
      return bytesToHex(signature.toBytes()).toLowerCase();
    } finally {
      digest.fill(0);
      signature.free();
    }
  }

  signBlsAction(_action: ChiaSigningAction): string {
    throw new Error('Chia recovery signing is unavailable until this page can verify the complete recovery transaction.');
  }

  private requireBlsPublicKey(): string {
    const value = this.recoveryBlsPubkey();
    if (!value) throw new Error('Unlock the administrator recovery kit first.');
    return value;
  }

  private requireBlsKey(): WasmSecretKey {
    if (!this.blsSecretKey) {
      throw new Error('Unlock the administrator recovery kit first.');
    }
    return this.blsSecretKey;
  }

  private requireGuardian(): HDNodeWallet {
    if (!this.evmGuardian) {
      throw new Error('Unlock the administrator recovery kit first.');
    }
    return this.evmGuardian;
  }

  private requireSdk(): RecoverySdk {
    const sdk = this.wasm.sdk();
    if (!sdk.SecretKey || !sdk.Signature) {
      throw new Error('The reviewed Chia recovery signer is unavailable.');
    }
    return sdk as RecoverySdk;
  }
}

export interface AdminRecoveryPublicIdentity {
  recoveryBlsPubkey: string;
  evmGuardian: string;
}

export interface AdminRecoverySecret extends AdminRecoveryPublicIdentity {
  mnemonic: string;
}

function validateDrillTypedData(
  challenge: RecoveryDrillChallenge,
  expectedGuardian: string,
  expectedBlsPublicKey: string,
): void {
  const typedData = challenge.evmTypedData;
  const expectedDomain = {
    name: 'Solslot Admin Recovery',
    version: typedData.domain.version === '2' && typedData.domain.chainId === 8453 ? '2' : '1',
    chainId: typedData.domain.version === '2' && typedData.domain.chainId === 8453 ? 8453 : 84532,
  };
  const expectedDomainFields = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
  ];
  const expectedFields = [
    { name: 'ceremonyId', type: 'bytes32' },
    { name: 'slot', type: 'uint8' },
    { name: 'dailyWallet', type: 'address' },
    { name: 'evmGuardian', type: 'address' },
    { name: 'recoveryBlsCommitment', type: 'bytes32' },
    { name: 'revision', type: 'uint64' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint64' },
  ];
  if (
    challenge.recoveryBlsPath !== ADMIN_RECOVERY_BLS_PATH_LABEL ||
    challenge.recoveryEvmPath !== ADMIN_RECOVERY_EVM_PATH ||
    typedData.primaryType !== 'SolslotAdminRecoveryDrill' ||
    !sameJson(typedData.domain, expectedDomain) ||
    !sameJson(typedData.types['EIP712Domain'], expectedDomainFields) ||
    !sameJson(typedData.types['SolslotAdminRecoveryDrill'], expectedFields) ||
    Object.keys(typedData.types).sort().join(',') !==
      ['EIP712Domain', 'SolslotAdminRecoveryDrill'].sort().join(',') ||
    getAddress(String(typedData.message['evmGuardian'])) !== getAddress(expectedGuardian) ||
    String(typedData.message['recoveryBlsCommitment']).toLowerCase() !==
      keccak256(getBytes(expectedBlsPublicKey)).toLowerCase() ||
    !isBytes32(String(typedData.message['ceremonyId'])) ||
    !isBytes32(String(typedData.message['recoveryBlsCommitment'])) ||
    !isBytes32(String(typedData.message['nonce'])) ||
    Number(typedData.message['expiresAt']) !== challenge.expiresAt ||
    Number(typedData.message['revision']) !== challenge.revision ||
    !Number.isInteger(Number(typedData.message['slot'])) ||
    TypedDataEncoder.hash(
      typedData.domain,
      { SolslotAdminRecoveryDrill: expectedFields },
      typedData.message,
    ).length !== 66
  ) {
    throw new Error('Refusing an altered administrator recovery drill.');
  }
  if (!/^0x[0-9a-f]{96}$/i.test(expectedBlsPublicKey)) {
    throw new Error('The unlocked recovery BLS key is invalid.');
  }
}

function validateLostKeyTypedData(
  typedData: Eip712TypedData,
  intent: AdminKeyChangeIntentV1,
  intentHash: string,
  coordinator: string,
  expectedGuardian: string,
  expectedBlsPublicKey: string,
): void {
  const domainFields = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ];
  const authorizationFields = [{ name: 'intentHash', type: 'bytes32' }];
  const normalizedHash = normalizeHex(intentHash);
  if (
    intent.kind !== 'LOST' ||
    !isBytes32(normalizedHash) ||
    ![84532, 8453].includes(intent.evmChainId) ||
    intent.chiaNetwork !== 'testnet11' ||
    getAddress(intent.oldRecoveryGuardian) !== getAddress(expectedGuardian) ||
    normalizeHex(intent.oldRecoveryBlsKey) !== normalizeHex(expectedBlsPublicKey) ||
    typedData.primaryType !== 'SolslotLostKeyPrepare' ||
    !sameJson(Object.keys(typedData.domain).sort(), [
      'chainId',
      'name',
      'verifyingContract',
      'version',
    ]) ||
    typedData.domain.name !== 'Solslot Admin Recovery' ||
    typedData.domain.version !== '1' ||
    Number(typedData.domain.chainId) !== intent.evmChainId ||
    getAddress(String(typedData.domain.verifyingContract)) !== getAddress(coordinator) ||
    !sameJson(Object.keys(typedData.types).sort(), [
      'EIP712Domain',
      'SolslotLostKeyPrepare',
    ]) ||
    !sameJson(typedData.types['EIP712Domain'], domainFields) ||
    !sameJson(typedData.types['SolslotLostKeyPrepare'], authorizationFields) ||
    !sameJson(Object.keys(typedData.message), ['intentHash']) ||
    normalizeHex(String(typedData.message['intentHash'])) !== normalizedHash ||
    TypedDataEncoder.hash(
      typedData.domain,
      { SolslotLostKeyPrepare: authorizationFields },
      typedData.message,
    ).length !== 66
  ) {
    throw new Error('Refusing an altered lost-wallet recovery authorization.');
  }
}

function validateRecoveryGuardianTypedData(
  typedData: Eip712TypedData,
  action: 'ACCEPT' | 'VETO',
  intentHash: string,
  coordinator: string,
  expectedGuardian: string,
  unlockedGuardian: string,
  expectedChainId: number,
): void {
  const domainFields = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ];
  const primaryType =
    action === 'ACCEPT'
      ? 'SolslotRecoveryGuardianAccept'
      : 'SolslotRecoveryGuardianVeto';
  const authorizationFields = [{ name: 'intentHash', type: 'bytes32' }];
  if (
    ![84532, 8453].includes(expectedChainId) ||
    !isBytes32(intentHash) ||
    getAddress(coordinator) !== coordinator ||
    getAddress(expectedGuardian) !== getAddress(unlockedGuardian) ||
    typedData.primaryType !== primaryType ||
    !sameJson(typedData.domain, {
      name: 'Solslot Admin Recovery',
      version: '1',
      chainId: expectedChainId,
      verifyingContract: coordinator,
    }) ||
    !sameJson(typedData.types['EIP712Domain'], domainFields) ||
    !sameJson(typedData.types[primaryType], authorizationFields) ||
    Object.keys(typedData.types).sort().join(',') !==
      ['EIP712Domain', primaryType].sort().join(',') ||
    !sameJson(typedData.message, { intentHash }) ||
    TypedDataEncoder.hash(
      typedData.domain,
      { [primaryType]: authorizationFields },
      typedData.message,
    ).length !== 66
  ) {
    throw new Error('Refusing an altered recovery-guardian action.');
  }
}

function normalizeMnemonic(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeHex(value: string): string {
  return `0x${String(value).toLowerCase().replace(/^0x/, '')}`;
}

function isBytes32(value: string): boolean {
  return /^0x[0-9a-f]{64}$/i.test(value);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function requireHexBytes(
  value: string,
  expectedLength: number | undefined,
  label: string,
): Uint8Array {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error(`${label} must be hexadecimal.`);
  }
  const bytes = hexToBytes(value);
  if (expectedLength !== undefined && bytes.byteLength !== expectedLength) {
    bytes.fill(0);
    throw new Error(`${label} must be ${expectedLength} bytes.`);
  }
  return bytes;
}

interface WasmFreeable {
  free(): void;
}

interface WasmPublicKey extends WasmFreeable {
  toBytes(): Uint8Array;
}

interface WasmSignature extends WasmFreeable {
  toBytes(): Uint8Array;
}

interface WasmSecretKey extends WasmFreeable {
  publicKey(): WasmPublicKey;
  sign(message: Uint8Array): WasmSignature;
  deriveUnhardenedPath(path: number[]): WasmSecretKey;
}

interface RecoverySdk {
  SecretKey: { fromSeed(seed: Uint8Array): WasmSecretKey };
  Signature: { aggregate(signatures: WasmSignature[]): WasmSignature };
}
