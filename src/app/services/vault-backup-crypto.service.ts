import { Injectable } from '@angular/core';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

const FORMAT_VERSION = 1;
export const GOOGLE_VAULT_DERIVATION = {
  scheme: 'chia-all-unhardened' as const,
  path: [12381, 8444, 2, 0] as const,
  syntheticKeyVersion: 1 as const,
};
export const GOOGLE_VAULT_MAX_BACKUP_BYTES = 16 * 1024;
const PBKDF2_ITERATIONS = 600_000;
const MIN_PASSWORD_LENGTH = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface SolslotVaultBackupEnvelope {
  format: 'solslot-google-vault';
  version: 1;
  protocol: 'solslot-v2';
  network: 'testnet11';
  publicKey: string;
  launcherId: string | null;
  createdAt: string;
  updatedAt: string;
  derivation: typeof GOOGLE_VAULT_DERIVATION;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string;
  };
  cipher: {
    name: 'AES-GCM';
    iv: string;
  };
  ciphertext: string;
}

interface EncryptedPayload {
  mnemonic: string;
  derivation: typeof GOOGLE_VAULT_DERIVATION;
}

@Injectable({ providedIn: 'root' })
export class VaultBackupCryptoService {
  generateMnemonic(): string {
    return generateMnemonic(wordlist, 256);
  }

  validatePassword(password: string): void {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new VaultBackupCryptoError(
        'weak_password',
        `Recovery password must contain at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
  }

  async encrypt(args: {
    mnemonic: string;
    password: string;
    publicKey: string;
    launcherId?: string | null;
    createdAt?: string;
  }): Promise<SolslotVaultBackupEnvelope> {
    const mnemonic = normalizeMnemonic(args.mnemonic);
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new VaultBackupCryptoError('invalid_mnemonic', 'The recovery phrase is invalid.');
    }
    this.validatePassword(args.password);
    const publicKey = normalizePublicKey(args.publicKey);
    const launcherId = args.launcherId || null;
    if (!isNullableBytes32(launcherId)) throw invalidBackup();
    const createdAt = args.createdAt || new Date().toISOString();
    const updatedAt = new Date().toISOString();
    validateTimestamp(createdAt);
    validateTimestamp(updatedAt);
    if (Date.parse(createdAt) > Date.parse(updatedAt)) throw invalidBackup();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const metadata = {
      format: 'solslot-google-vault' as const,
      version: FORMAT_VERSION as 1,
      protocol: 'solslot-v2' as const,
      network: 'testnet11' as const,
      publicKey,
      launcherId,
      createdAt,
      updatedAt,
      derivation: GOOGLE_VAULT_DERIVATION,
      kdf: {
        name: 'PBKDF2' as const,
        hash: 'SHA-256' as const,
        iterations: PBKDF2_ITERATIONS,
        salt: toBase64(salt),
      },
      cipher: {
        name: 'AES-GCM' as const,
        iv: toBase64(iv),
      },
    };
    const plaintext = encoder.encode(
      JSON.stringify({ mnemonic, derivation: GOOGLE_VAULT_DERIVATION } satisfies EncryptedPayload),
    );
    if (plaintext.byteLength > GOOGLE_VAULT_MAX_BACKUP_BYTES) throw invalidBackup();
    try {
      const key = await deriveKey(args.password, salt, PBKDF2_ITERATIONS);
      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: exactBuffer(iv),
          additionalData: aad(metadata),
          tagLength: 128,
        },
        key,
        exactBuffer(plaintext),
      );
      const envelope = { ...metadata, ciphertext: toBase64(new Uint8Array(encrypted)) };
      if (serializedEnvelopeBytes(envelope).byteLength > GOOGLE_VAULT_MAX_BACKUP_BYTES) {
        throw invalidBackup();
      }
      return envelope;
    } finally {
      plaintext.fill(0);
      salt.fill(0);
      iv.fill(0);
    }
  }

  async decrypt(
    value: unknown,
    password: string,
  ): Promise<{ mnemonic: string; envelope: SolslotVaultBackupEnvelope }> {
    const envelope = parseEnvelope(value);
    const salt = fromBase64(envelope.kdf.salt, 16);
    const iv = fromBase64(envelope.cipher.iv, 12);
    const ciphertext = fromBase64(envelope.ciphertext, undefined, GOOGLE_VAULT_MAX_BACKUP_BYTES);
    const metadata = metadataFromEnvelope(envelope);
    try {
      const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
      let decrypted: ArrayBuffer;
      try {
        decrypted = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: exactBuffer(iv),
            additionalData: aad(metadata),
            tagLength: 128,
          },
          key,
          exactBuffer(ciphertext),
        );
      } catch {
        throw new VaultBackupCryptoError(
          'decrypt_failed',
          'The recovery password is incorrect or the backup is damaged.',
        );
      }
      const plaintext = new Uint8Array(decrypted);
      try {
        const parsed = JSON.parse(decoder.decode(plaintext)) as Partial<EncryptedPayload>;
        if (
          !hasExactKeys(parsed, ['mnemonic', 'derivation']) ||
          !sameDerivation(parsed.derivation) ||
          typeof parsed.mnemonic !== 'string'
        ) {
          throw new Error('invalid payload');
        }
        const mnemonic = normalizeMnemonic(parsed.mnemonic);
        if (!validateMnemonic(mnemonic, wordlist)) throw new Error('invalid mnemonic');
        return { mnemonic, envelope };
      } catch (error) {
        if (error instanceof VaultBackupCryptoError) throw error;
        throw new VaultBackupCryptoError('invalid_backup', 'The Google Drive backup is invalid.');
      } finally {
        plaintext.fill(0);
      }
    } finally {
      salt.fill(0);
      iv.fill(0);
      ciphertext.fill(0);
    }
  }

  parse(value: unknown): SolslotVaultBackupEnvelope {
    return parseEnvelope(value);
  }
}

export class VaultBackupCryptoError extends Error {
  constructor(
    readonly code:
      | 'weak_password'
      | 'invalid_mnemonic'
      | 'invalid_backup'
      | 'decrypt_failed',
    message: string,
  ) {
    super(message);
    this.name = 'VaultBackupCryptoError';
  }
}

function parseEnvelope(value: unknown): SolslotVaultBackupEnvelope {
  if (!isRecord(value)) throw invalidBackup();
  if (serializedEnvelopeBytes(value).byteLength > GOOGLE_VAULT_MAX_BACKUP_BYTES) throw invalidBackup();
  const kdf = value['kdf'];
  const cipher = value['cipher'];
  if (
    !hasExactKeys(value, [
      'format',
      'version',
      'protocol',
      'network',
      'publicKey',
      'launcherId',
      'createdAt',
      'updatedAt',
      'derivation',
      'kdf',
      'cipher',
      'ciphertext',
    ]) ||
    value['format'] !== 'solslot-google-vault' ||
    value['version'] !== FORMAT_VERSION ||
    value['protocol'] !== 'solslot-v2' ||
    value['network'] !== 'testnet11' ||
    typeof value['publicKey'] !== 'string' ||
    !isNullableBytes32(value['launcherId']) ||
    typeof value['createdAt'] !== 'string' ||
    typeof value['updatedAt'] !== 'string' ||
    typeof value['ciphertext'] !== 'string' ||
    !isRecord(kdf) ||
    !hasExactKeys(kdf, ['name', 'hash', 'iterations', 'salt']) ||
    kdf['name'] !== 'PBKDF2' ||
    kdf['hash'] !== 'SHA-256' ||
    kdf['iterations'] !== PBKDF2_ITERATIONS ||
    typeof kdf['salt'] !== 'string' ||
    !sameDerivation(value['derivation']) ||
    !isRecord(cipher) ||
    !hasExactKeys(cipher, ['name', 'iv']) ||
    cipher['name'] !== 'AES-GCM' ||
    typeof cipher['iv'] !== 'string'
  ) {
    throw invalidBackup();
  }
  if (normalizePublicKey(value['publicKey']) !== value['publicKey']) throw invalidBackup();
  fromBase64(kdf['salt'], 16);
  fromBase64(cipher['iv'], 12);
  fromBase64(value['ciphertext'], undefined, GOOGLE_VAULT_MAX_BACKUP_BYTES);
  validateTimestamp(value['createdAt']);
  validateTimestamp(value['updatedAt']);
  if (Date.parse(value['createdAt']) > Date.parse(value['updatedAt'])) throw invalidBackup();
  return value as unknown as SolslotVaultBackupEnvelope;
}

function metadataFromEnvelope(envelope: SolslotVaultBackupEnvelope) {
  const { ciphertext: _ciphertext, ...metadata } = envelope;
  return metadata;
}

function aad(metadata: Omit<SolslotVaultBackupEnvelope, 'ciphertext'>): ArrayBuffer {
  return exactBuffer(encoder.encode(JSON.stringify(metadata)));
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const passwordBytes = encoder.encode(password.normalize('NFKC'));
  try {
    const material = await crypto.subtle.importKey(
      'raw',
      exactBuffer(passwordBytes),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: exactBuffer(salt), iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    passwordBytes.fill(0);
  }
}

function normalizeMnemonic(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePublicKey(value: string): string {
  const normalized = value.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{96}$/.test(normalized)) throw invalidBackup();
  return `0x${normalized}`;
}

function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string, expectedLength?: number, maxLength = GOOGLE_VAULT_MAX_BACKUP_BYTES): Uint8Array {
  try {
    if (value.length > Math.ceil((maxLength * 4) / 3) + 4) throw new Error('oversized');
    const binary = atob(value);
    const result = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (
      (expectedLength !== undefined && result.length !== expectedLength) ||
      result.length === 0 ||
      result.length > maxLength
    ) {
      throw new Error('invalid length');
    }
    return result;
  } catch {
    throw invalidBackup();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: ReadonlyArray<string>): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNullableBytes32(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value));
}

function sameDerivation(value: unknown): value is typeof GOOGLE_VAULT_DERIVATION {
  return (
    isRecord(value) &&
    value['scheme'] === GOOGLE_VAULT_DERIVATION.scheme &&
    value['syntheticKeyVersion'] === GOOGLE_VAULT_DERIVATION.syntheticKeyVersion &&
    Array.isArray(value['path']) &&
    value['path'].length === GOOGLE_VAULT_DERIVATION.path.length &&
    value['path'].every((segment, index) => segment === GOOGLE_VAULT_DERIVATION.path[index])
  );
}

function validateTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw invalidBackup();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw invalidBackup();
}

function serializedEnvelopeBytes(value: unknown): Uint8Array {
  try {
    return encoder.encode(JSON.stringify(value));
  } catch {
    throw invalidBackup();
  }
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}

function invalidBackup(): VaultBackupCryptoError {
  return new VaultBackupCryptoError('invalid_backup', 'The Google Drive backup is invalid.');
}
