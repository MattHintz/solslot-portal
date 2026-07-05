import { Injectable } from '@angular/core';

import {
  OfferArtifact,
  OfferDetail,
  OfferGatingPolicy,
  OfferListingState,
  OfferTerms,
} from './offer-domain';

const STATIC_OFFER_SOURCE_RECORDS: readonly OfferSourceRecord[] = [
  {
    id: 'testnet-deed-001',
    title: 'Testnet deed offer',
    deedLauncherId: '0x' + '33'.repeat(32),
    state: 'OP:OFFER_READY',
    terms: {
      deedLauncherId: '0x' + '33'.repeat(32),
      tokenAmount: 100_000,
      priceMojos: 1_000_000,
      acceptedAsset: 'XCH',
      expiresAt: null,
    },
    artifact: {
      artifactId: 'testnet-artifact-001',
      deedLauncherId: '0x' + '33'.repeat(32),
      artifactHash: null,
      rawOffer: null,
    },
    gatingPolicy: {
      requiresZkPassport: true,
    },
  },
];

@Injectable({ providedIn: 'root' })
export class OfferSourceService {
  offerById(id: string): OfferDetail | null {
    const record = STATIC_OFFER_SOURCE_RECORDS.find((offer) => offer.id === id);
    return record ? normalizeOfferSourceRecord(record) : null;
  }

  listOffers(): OfferDetail[] {
    return STATIC_OFFER_SOURCE_RECORDS.map(normalizeOfferSourceRecord);
  }
}

export interface OfferSourceRecord {
  id: string;
  title: string;
  deedLauncherId: string;
  state?: OfferListingState;
  terms: OfferTermsSourceRecord;
  artifact?: OfferArtifactSourceRecord | null;
  gatingPolicy?: Partial<OfferGatingPolicy>;
}

export interface OfferTermsSourceRecord {
  deedLauncherId?: string;
  tokenAmount: number;
  priceMojos: number;
  acceptedAsset: string;
  expiresAt?: number | null;
}

export interface OfferArtifactSourceRecord {
  artifactId: string;
  deedLauncherId: string;
  artifactHash?: string | null;
  rawOffer?: string | null;
  poolLauncherId?: string | null;
  poolInnerPuzzleHash?: string | null;
  bridgePolicyHash?: string | null;
  membersMerkleRoot?: string | null;
}

export function normalizeOfferSourceRecord(record: OfferSourceRecord): OfferDetail {
  const id = nonEmpty(record.id, 'offer.id');
  const title = nonEmpty(record.title, 'offer.title');
  const deedLauncherId = bytes32Hex(record.deedLauncherId, 'offer.deedLauncherId');
  const terms = normalizeTerms(record.terms, deedLauncherId);
  const artifact = normalizeArtifact(record.artifact ?? null, deedLauncherId);
  return {
    id,
    title,
    deedLauncherId,
    state: record.state ?? 'OP:OFFER_READY',
    terms,
    artifact,
    gatingPolicy: normalizeGatingPolicy(record.gatingPolicy),
  };
}

function normalizeTerms(record: OfferTermsSourceRecord, deedLauncherId: string): OfferTerms {
  const termsDeedLauncherId = bytes32Hex(
    record.deedLauncherId ?? deedLauncherId,
    'offer.terms.deedLauncherId',
  );
  if (termsDeedLauncherId !== deedLauncherId) {
    throw new Error('offer.terms.deedLauncherId must match offer.deedLauncherId');
  }
  return {
    deedLauncherId: termsDeedLauncherId,
    tokenAmount: positiveInteger(record.tokenAmount, 'offer.terms.tokenAmount'),
    priceMojos: positiveInteger(record.priceMojos, 'offer.terms.priceMojos'),
    acceptedAsset: nonEmpty(record.acceptedAsset, 'offer.terms.acceptedAsset').toUpperCase(),
    expiresAt:
      record.expiresAt === undefined || record.expiresAt === null
        ? null
        : nonNegativeInteger(record.expiresAt, 'offer.terms.expiresAt'),
  };
}

function normalizeArtifact(
  record: OfferArtifactSourceRecord | null,
  deedLauncherId: string,
): OfferArtifact | null {
  if (!record) {
    return null;
  }
  try {
    const artifactDeedLauncherId = bytes32Hex(
      record.deedLauncherId,
      'offer.artifact.deedLauncherId',
    );
    if (artifactDeedLauncherId !== deedLauncherId) {
      return null;
    }
    const artifact: OfferArtifact = {
      artifactId: nonEmpty(record.artifactId, 'offer.artifact.artifactId'),
      deedLauncherId: artifactDeedLauncherId,
      artifactHash: nullableArtifactHash(record.artifactHash, 'offer.artifact.artifactHash'),
      rawOffer: nullableOfferPayload(record.rawOffer, 'offer.artifact.rawOffer'),
    };
    const poolLauncherId = nullableBytes32(record.poolLauncherId, 'offer.artifact.poolLauncherId');
    const poolInnerPuzzleHash = nullableBytes32(record.poolInnerPuzzleHash, 'offer.artifact.poolInnerPuzzleHash');
    const bridgePolicyHash = nullableBytes32(record.bridgePolicyHash, 'offer.artifact.bridgePolicyHash');
    const membersMerkleRoot = nullableBytes32(record.membersMerkleRoot, 'offer.artifact.membersMerkleRoot');
    if (poolLauncherId) artifact.poolLauncherId = poolLauncherId;
    if (poolInnerPuzzleHash) artifact.poolInnerPuzzleHash = poolInnerPuzzleHash;
    if (bridgePolicyHash) artifact.bridgePolicyHash = bridgePolicyHash;
    if (membersMerkleRoot) artifact.membersMerkleRoot = membersMerkleRoot;
    return artifact;
  } catch {
    return null;
  }
}

function normalizeGatingPolicy(policy: Partial<OfferGatingPolicy> | undefined): OfferGatingPolicy {
  return {
    requiresZkPassport: policy?.requiresZkPassport ?? true,
    allowedVaultLauncherIds: policy?.allowedVaultLauncherIds?.map((value, index) =>
      bytes32Hex(value, `offer.gatingPolicy.allowedVaultLauncherIds[${index}]`),
    ),
  };
}

function nonEmpty(value: string, field: string): string {
  const out = String(value ?? '').trim();
  if (!out) {
    throw new Error(`${field} must not be empty`);
  }
  return out;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function bytes32Hex(value: string, field: string): string {
  const normalized = evenHex(value, field);
  if (normalized.length !== 66) {
    throw new Error(`${field} must be 32-byte hex`);
  }
  return normalized;
}

function nullableArtifactHash(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  return bytes32Hex(normalized, field);
}

function nullableBytes32(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return bytes32Hex(value, field);
}

function nullableOfferPayload(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (/^offer[a-z0-9]+$/i.test(trimmed)) {
    return trimmed;
  }
  return evenHex(trimmed, field);
}

function evenHex(value: string, field: string): string {
  const normalized = value.startsWith('0x') || value.startsWith('0X') ? value.toLowerCase() : `0x${value.toLowerCase()}`;
  if (normalized.length < 4 || normalized.length % 2 !== 0 || !/^0x[0-9a-f]+$/.test(normalized)) {
    throw new Error(`${field} must be even-length hex`);
  }
  return normalized;
}
