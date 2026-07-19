import { Injectable } from '@angular/core';
import { sha256, toUtf8Bytes } from 'ethers';

import { bytesToHex, hexToBytes } from '../../utils/chia-hash';
import {
  DeedAllocationV1,
  MAX_CANONICAL_METADATA_BYTES,
  TARGET_ALLOCATION_PPM,
} from './property-dossier';


export const MAX_METADATA_MEMO_BYTES = 1024;
const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;
const HEADER_MAGIC = new TextEncoder().encode('SOLSMD');
const CHUNK_MAGIC = new TextEncoder().encode('SOLSMC');
const REFERENCE_MAGIC = new TextEncoder().encode('SOLSMR');
const MEMO_VERSION = 1;
const CHUNK_PREFIX_BYTES = CHUNK_MAGIC.length + 1 + 2 + 2;
const CHUNK_PAYLOAD_BYTES = MAX_METADATA_MEMO_BYTES - CHUNK_PREFIX_BYTES;

export class PropertyMetadataError extends Error {}

export interface MetadataCommitment {
  canonicalJson: string;
  canonicalBytes: Uint8Array;
  metadataRoot: string;
  byteSize: number;
}

export interface MetadataMemoReference {
  metadataRoot: string;
  metadataAnchorId: string;
}

@Injectable({ providedIn: 'root' })
export class PropertyMetadataService {
  commit(value: unknown, enforceSize = true): MetadataCommitment {
    const canonicalJson = canonicalizeJcs(value);
    const canonicalBytes = toUtf8Bytes(canonicalJson);
    if (enforceSize && canonicalBytes.length > MAX_CANONICAL_METADATA_BYTES) {
      throw new PropertyMetadataError(
        `Canonical metadata is ${canonicalBytes.length} bytes; limit is ${MAX_CANONICAL_METADATA_BYTES}.`,
      );
    }
    return {
      canonicalJson,
      canonicalBytes,
      metadataRoot: sha256(canonicalBytes),
      byteSize: canonicalBytes.length,
    };
  }

  validateDeedAllocation(deeds: ReadonlyArray<DeedAllocationV1>): void {
    validateDeedAllocation(deeds);
  }

  buildMemos(commitment: MetadataCommitment): Uint8Array[] {
    return buildMetadataMemos(commitment);
  }

  reconstructMemos(memos: ReadonlyArray<Uint8Array>): MetadataCommitment {
    return reconstructMetadataMemos(memos);
  }

  estimateConsensusCost(byteSize: number): number {
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new PropertyMetadataError('byteSize must be a non-negative safe integer.');
    }
    return byteSize * 12_000;
  }
}

export function canonicalizeJcs(value: unknown): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'string') {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Math.abs(value) > SAFE_INTEGER_MAX) {
      throw new PropertyMetadataError(
        'Floating-point or unsafe integers are prohibited; use decimal strings.',
      );
    }
    return String(value);
  }
  if (typeof value === 'bigint') {
    throw new PropertyMetadataError('BigInt is not JSON; use a decimal string.');
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJcs(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const fields = keys.map((key) => {
      assertValidUnicode(key);
      const child = record[key];
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
        throw new PropertyMetadataError(`Unsupported JSON value at key ${key}.`);
      }
      return `${JSON.stringify(key)}:${canonicalizeJcs(child)}`;
    });
    return `{${fields.join(',')}}`;
  }
  throw new PropertyMetadataError(`Unsupported JSON value type: ${typeof value}.`);
}

export function validateDeedAllocation(deeds: ReadonlyArray<DeedAllocationV1>): void {
  if (!deeds.length) {
    throw new PropertyMetadataError('Deed allocation must contain at least one deed.');
  }
  const seen = new Set<string>();
  let total = 0;
  deeds.forEach((deed, index) => {
    const deedId = deed.deedId?.trim();
    if (!deedId) throw new PropertyMetadataError(`Deed allocation row ${index + 1} has no ID.`);
    const normalized = deedId.toUpperCase();
    if (seen.has(normalized)) throw new PropertyMetadataError(`Duplicate deed ID: ${deedId}.`);
    seen.add(normalized);
    if (!Number.isInteger(deed.sharePpm) || deed.sharePpm <= 0 || deed.sharePpm > TARGET_ALLOCATION_PPM) {
      throw new PropertyMetadataError(`Deed ${deedId} share must be between 1 and 1,000,000 ppm.`);
    }
    total += deed.sharePpm;
  });
  if (total !== TARGET_ALLOCATION_PPM) {
    throw new PropertyMetadataError(`Deed allocation totals ${total} ppm; expected 1,000,000.`);
  }
}

export function buildMetadataMemos(commitment: MetadataCommitment): Uint8Array[] {
  if (commitment.canonicalBytes.length > MAX_CANONICAL_METADATA_BYTES) {
    throw new PropertyMetadataError('Canonical metadata exceeds the 24 KiB publication cap.');
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < commitment.canonicalBytes.length; offset += CHUNK_PAYLOAD_BYTES) {
    chunks.push(commitment.canonicalBytes.slice(offset, offset + CHUNK_PAYLOAD_BYTES));
  }
  if (!chunks.length) chunks.push(new Uint8Array());
  const root = hexToBytes(commitment.metadataRoot);
  if (root.length !== 32) throw new PropertyMetadataError('metadataRoot must be 32 bytes.');
  const header = concatBytes(
    HEADER_MAGIC,
    Uint8Array.of(MEMO_VERSION),
    root,
    uintBytes(commitment.canonicalBytes.length, 4),
    uintBytes(chunks.length, 2),
  );
  return [
    header,
    ...chunks.map((chunk, index) =>
      concatBytes(
        CHUNK_MAGIC,
        Uint8Array.of(MEMO_VERSION),
        uintBytes(index, 2),
        uintBytes(chunks.length, 2),
        chunk,
      ),
    ),
  ];
}

export function buildMetadataReferenceMemo(reference: MetadataMemoReference): Uint8Array {
  const root = hexToBytes(reference.metadataRoot);
  const anchor = hexToBytes(reference.metadataAnchorId);
  if (root.length !== 32 || anchor.length !== 32) {
    throw new PropertyMetadataError('Metadata root and anchor ID must be 32 bytes.');
  }
  return concatBytes(REFERENCE_MAGIC, Uint8Array.of(MEMO_VERSION), root, anchor);
}

export function reconstructMetadataMemos(
  memos: ReadonlyArray<Uint8Array>,
): MetadataCommitment {
  if (memos.length < 2) throw new PropertyMetadataError('Metadata header or chunks are missing.');
  const header = memos[0];
  if (!startsWith(header, HEADER_MAGIC) || header[HEADER_MAGIC.length] !== MEMO_VERSION) {
    throw new PropertyMetadataError('Invalid metadata envelope header.');
  }
  let cursor = HEADER_MAGIC.length + 1;
  const root = header.slice(cursor, cursor + 32);
  cursor += 32;
  const expectedLength = readUint(header.slice(cursor, cursor + 4));
  cursor += 4;
  const expectedCount = readUint(header.slice(cursor, cursor + 2));
  if (expectedLength > MAX_CANONICAL_METADATA_BYTES) {
    throw new PropertyMetadataError('Metadata envelope declares an oversized payload.');
  }
  if (!expectedCount || memos.length !== expectedCount + 1) {
    throw new PropertyMetadataError('Metadata envelope chunk count mismatch.');
  }
  const payloads: Uint8Array[] = [];
  memos.slice(1).forEach((memo, expectedIndex) => {
    if (memo.length > MAX_METADATA_MEMO_BYTES || !startsWith(memo, CHUNK_MAGIC)) {
      throw new PropertyMetadataError('Invalid metadata chunk memo.');
    }
    const versionOffset = CHUNK_MAGIC.length;
    if (memo[versionOffset] !== MEMO_VERSION) {
      throw new PropertyMetadataError('Unsupported metadata chunk version.');
    }
    const actualIndex = readUint(memo.slice(versionOffset + 1, versionOffset + 3));
    const actualCount = readUint(memo.slice(versionOffset + 3, versionOffset + 5));
    if (actualIndex !== expectedIndex) {
      throw new PropertyMetadataError('Metadata chunks are reordered or duplicated.');
    }
    if (actualCount !== expectedCount) {
      throw new PropertyMetadataError('Metadata chunk total does not match the header.');
    }
    payloads.push(memo.slice(versionOffset + 5));
  });
  const canonicalBytes = concatBytes(...payloads);
  if (canonicalBytes.length !== expectedLength) {
    throw new PropertyMetadataError('Metadata payload length mismatch.');
  }
  if (sha256(canonicalBytes).toLowerCase() !== bytesToHex(root).toLowerCase()) {
    throw new PropertyMetadataError('Metadata root mismatch.');
  }
  const canonicalJson = new TextDecoder('utf-8', { fatal: true }).decode(canonicalBytes);
  const parsed = JSON.parse(canonicalJson) as unknown;
  if (canonicalizeJcs(parsed) !== canonicalJson) {
    throw new PropertyMetadataError('Metadata payload is not canonical JSON.');
  }
  return {
    canonicalJson,
    canonicalBytes,
    metadataRoot: bytesToHex(root),
    byteSize: canonicalBytes.length,
  };
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new PropertyMetadataError('Lone UTF-16 surrogates are prohibited.');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new PropertyMetadataError('Lone UTF-16 surrogates are prohibited.');
    }
  }
}

function concatBytes(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function uintBytes(value: number, size: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** (size * 8)) {
    throw new PropertyMetadataError(`Integer ${value} does not fit in ${size} bytes.`);
  }
  const output = new Uint8Array(size);
  let remaining = value;
  for (let index = size - 1; index >= 0; index--) {
    output[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return output;
}

function readUint(bytes: Uint8Array): number {
  return bytes.reduce((value, byte) => value * 256 + byte, 0);
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return value.length >= prefix.length && prefix.every((byte, index) => value[index] === byte);
}
