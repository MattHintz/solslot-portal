import { Injectable } from '@angular/core';
import { sha256 } from 'ethers';

import type { MintProposalState } from './admin-api.service';
import type { OfferDetail, OfferGatingPolicy } from './offer-domain';
import {
  normalizeOfferSourceRecord,
  type OfferSourceRecord,
} from './offer-source.service';

export type MintedOfferGenerationAuthority =
  | 'protocol-driver'
  | 'admin-api'
  | 'portal-driven';

export type MintedOfferProposalState = MintProposalState | 'OP:MINTED';
export type ProtocolOfferRail = 'chia' | 'base_usdc' | 'stripe';
export type ProtocolPurchaseIntentState =
  | 'created'
  | 'zk_verified'
  | 'artifact_ready'
  | 'payment_pending'
  | 'paid'
  | 'protocol_verified'
  | 'finalized'
  | 'failed'
  | 'expired'
  | 'refund_pending'
  | 'manual_review';

export const MINTED_OFFER_ARTIFACT_SCHEMA_VERSION = 'populis-minted-offer-artifact-v1';
export const MINTED_OFFER_GENERATION_AUTHORITY: MintedOfferGenerationAuthority = 'admin-api';

@Injectable({ providedIn: 'root' })
export class MintedOfferArtifactService {
  planFromMint(input: MintedOfferArtifactInput): MintedOfferArtifactPlan {
    return planMintedOfferArtifact(input);
  }
}

export interface MintedOfferArtifactInput {
  proposalId: string;
  proposalState: MintedOfferProposalState;
  instanceId: string;
  purchaseIntentId: string;
  rail: ProtocolOfferRail;
  title: string;
  deedLauncherId?: string | null;
  propertyId: string;
  collectionId: string;
  sharePpm: number;
  vaultLauncherId: string;
  paymentTerms: ProtocolOfferPaymentTerms;
  tokenAmount?: number;
  expiresAt: number;
  gatingPolicy?: Partial<OfferGatingPolicy>;
  artifactId?: string | null;
  rawOffer?: string | null;
  currentState?: ProtocolPurchaseIntentState;
  issuedAt?: number;
  network?: string;
  metadata?: Record<string, unknown>;
  solslotPropertyReference?: SolslotPropertyReference;
  poolLauncherId?: string | null;
  poolInnerPuzzleHash?: string | null;
  bridgePolicyHash?: string | null;
  membersMerkleRoot?: string | null;
  protocolConfigLauncherId?: string | null;
  vaultVersionRegistryLauncherId?: string | null;
}

export interface MintedOfferArtifactPlan {
  schemaVersion: typeof MINTED_OFFER_ARTIFACT_SCHEMA_VERSION;
  generationAuthority: MintedOfferGenerationAuthority;
  protocolArtifact: ProtocolOfferArtifact;
  protocolArtifactHash: string;
  sourceRecord: OfferSourceRecord;
  offer: OfferDetail;
}

export interface ProtocolOfferPaymentTerms {
  currency: string;
  amount: number;
  quantity?: number;
  paymentPuzzleHash?: string | null;
  protocolTreasuryPuzhash?: string | null;
}

export interface SolslotPropertyReference {
  propertyId?: string | number;
  propertyShareId?: number;
  nftId?: string;
  collectionId?: string;
  retiredOfferGroupId?: number | null;
  retiredOfferIds?: readonly number[];
}

export interface ProtocolOfferArtifact {
  version: 1;
  kind: 'solslot_protocol_offer';
  network: string;
  protocol: {
    instanceId: string;
    purchaseIntentId: string;
    rail: ProtocolOfferRail;
    deedLauncherId: string;
    propertyId: string;
    collectionId: string;
    sharePpm: number;
    vaultLauncherId: string;
    zkPassportRequired: true;
    currentState: ProtocolPurchaseIntentState;
    expiresAt: number;
    rawOffer?: string;
  };
  paymentTerms: {
    currency: string;
    amount: number;
    quantity: number;
    paymentPuzzleHash?: string;
    protocolTreasuryPuzhash?: string;
  };
  metadata: Record<string, unknown>;
  issuedAt: number;
  poolLauncherId?: string;
  poolInnerPuzzleHash?: string;
  bridgePolicyHash?: string;
  membersMerkleRoot?: string;
  protocolConfigLauncherId?: string;
  vaultVersionRegistryLauncherId?: string;
}

export function planMintedOfferArtifact(input: MintedOfferArtifactInput): MintedOfferArtifactPlan {
  if (!isMintedState(input.proposalState)) {
    throw new Error('minted offer artifact requires proposal state MINTED');
  }

  const proposalId = nonEmpty(input.proposalId, 'proposalId');
  const deedLauncherId = nonEmpty(
    input.deedLauncherId ?? '',
    'deed launcher id',
  );
  const purchaseIntentId = nonEmpty(input.purchaseIntentId, 'purchase intent id');
  const artifactId = nonEmpty(
    input.artifactId ?? `protocol-offer:${purchaseIntentId}`,
    'offer artifact id',
  );
  const paymentTerms = normalizePaymentTerms(input.paymentTerms);
  const expiresAt = positiveInteger(input.expiresAt, 'expiresAt');
  const sharePpm = positiveInteger(input.sharePpm, 'sharePpm');
  if (sharePpm > 1_000_000) {
    throw new Error('sharePpm must be no more than 1000000');
  }

  const protocolArtifact = buildProtocolOfferArtifact({
    ...input,
    proposalId,
    deedLauncherId,
    purchaseIntentId,
    paymentTerms,
    sharePpm,
    expiresAt,
  });
  const protocolArtifactHash = contentHash(protocolArtifact);

  const baseRecord: OfferSourceRecord = {
    id: proposalId,
    title: input.title,
    deedLauncherId,
    state: 'OP:OFFER_READY',
    terms: {
      deedLauncherId,
      tokenAmount: input.tokenAmount ?? paymentTerms.quantity,
      priceMojos: paymentTerms.amount,
      acceptedAsset: paymentTerms.currency,
      expiresAt,
    },
    artifact: {
      artifactId,
      deedLauncherId,
      artifactHash: protocolArtifactHash,
      rawOffer: input.rawOffer ?? null,
      poolLauncherId: input.poolLauncherId ?? null,
      poolInnerPuzzleHash: input.poolInnerPuzzleHash ?? null,
      bridgePolicyHash: input.bridgePolicyHash ?? null,
      membersMerkleRoot: input.membersMerkleRoot ?? null,
    },
    gatingPolicy: {
      requiresZkPassport: input.gatingPolicy?.requiresZkPassport ?? true,
      allowedVaultLauncherIds: input.gatingPolicy?.allowedVaultLauncherIds,
    },
  };

  const offerWithoutHash = normalizeOfferSourceRecord(baseRecord);
  if (!offerWithoutHash.artifact) {
    throw new Error('minted offer artifact could not be normalized');
  }

  const sourceRecord = sourceRecordFromOffer(offerWithoutHash, protocolArtifactHash);
  const offer = normalizeOfferSourceRecord(sourceRecord);
  if (!offer.artifact) {
    throw new Error('minted offer artifact hash could not be normalized');
  }

  return {
    schemaVersion: MINTED_OFFER_ARTIFACT_SCHEMA_VERSION,
    generationAuthority: MINTED_OFFER_GENERATION_AUTHORITY,
    protocolArtifact,
    protocolArtifactHash,
    sourceRecord,
    offer,
  };
}

function isMintedState(state: MintedOfferProposalState): boolean {
  return state === 'MINTED' || state === 'OP:MINTED';
}

function sourceRecordFromOffer(offer: OfferDetail, artifactHash: string): OfferSourceRecord {
  if (!offer.artifact) {
    throw new Error('offer artifact is required');
  }
  return {
    id: offer.id,
    title: offer.title,
    deedLauncherId: offer.deedLauncherId,
    state: 'OP:OFFER_READY',
    terms: {
      deedLauncherId: offer.terms.deedLauncherId,
      tokenAmount: offer.terms.tokenAmount,
      priceMojos: offer.terms.priceMojos,
      acceptedAsset: offer.terms.acceptedAsset,
      expiresAt: offer.terms.expiresAt,
    },
    artifact: {
      artifactId: offer.artifact.artifactId,
      deedLauncherId: offer.artifact.deedLauncherId,
      artifactHash,
      rawOffer: offer.artifact.rawOffer,
      poolLauncherId: offer.artifact.poolLauncherId,
      poolInnerPuzzleHash: offer.artifact.poolInnerPuzzleHash,
      bridgePolicyHash: offer.artifact.bridgePolicyHash,
      membersMerkleRoot: offer.artifact.membersMerkleRoot,
    },
    gatingPolicy: {
      requiresZkPassport: offer.gatingPolicy.requiresZkPassport,
      allowedVaultLauncherIds: offer.gatingPolicy.allowedVaultLauncherIds,
    },
  };
}

function buildProtocolOfferArtifact(
  input: Omit<MintedOfferArtifactInput, 'deedLauncherId' | 'paymentTerms' | 'sharePpm' | 'expiresAt'> & {
    proposalId: string;
    deedLauncherId: string;
    purchaseIntentId: string;
    paymentTerms: Required<Pick<ProtocolOfferPaymentTerms, 'currency' | 'amount' | 'quantity'>> &
      Pick<ProtocolOfferPaymentTerms, 'paymentPuzzleHash' | 'protocolTreasuryPuzhash'>;
    sharePpm: number;
    expiresAt: number;
  },
): ProtocolOfferArtifact {
  const metadata: Record<string, unknown> = {
    source: 'populis-portal',
    offerGenerationAuthority: MINTED_OFFER_GENERATION_AUTHORITY,
    schemaVersion: MINTED_OFFER_ARTIFACT_SCHEMA_VERSION,
    proposalId: input.proposalId,
    ...(input.metadata ?? {}),
  };
  if (input.solslotPropertyReference) {
    metadata['solslotPropertyReference'] = input.solslotPropertyReference;
  }

  const artifact: ProtocolOfferArtifact = {
    version: 1,
    kind: 'solslot_protocol_offer',
    network: nonEmpty(input.network ?? 'portal-local', 'network'),
    protocol: {
      instanceId: nonEmpty(input.instanceId, 'instance id'),
      purchaseIntentId: input.purchaseIntentId,
      rail: input.rail,
      deedLauncherId: input.deedLauncherId,
      propertyId: nonEmpty(input.propertyId, 'property id'),
      collectionId: nonEmpty(input.collectionId, 'collection id'),
      sharePpm: input.sharePpm,
      vaultLauncherId: nonEmpty(input.vaultLauncherId, 'vault launcher id'),
      zkPassportRequired: true,
      currentState: input.currentState ?? 'zk_verified',
      expiresAt: input.expiresAt,
    },
    paymentTerms: {
      currency: input.paymentTerms.currency,
      amount: input.paymentTerms.amount,
      quantity: input.paymentTerms.quantity,
    },
    metadata,
    issuedAt: input.issuedAt ?? Math.floor(Date.now() / 1000),
  };
  if (input.rawOffer) {
    artifact.protocol.rawOffer = input.rawOffer;
  }
  if (input.paymentTerms.paymentPuzzleHash) {
    artifact.paymentTerms.paymentPuzzleHash = input.paymentTerms.paymentPuzzleHash;
  }
  if (input.paymentTerms.protocolTreasuryPuzhash) {
    artifact.paymentTerms.protocolTreasuryPuzhash = input.paymentTerms.protocolTreasuryPuzhash;
  }
  if (input.poolLauncherId) {
    artifact.poolLauncherId = input.poolLauncherId;
  }
  if (input.poolInnerPuzzleHash) {
    artifact.poolInnerPuzzleHash = input.poolInnerPuzzleHash;
  }
  if (input.bridgePolicyHash) {
    artifact.bridgePolicyHash = input.bridgePolicyHash;
  }
  if (input.membersMerkleRoot) {
    artifact.membersMerkleRoot = input.membersMerkleRoot;
  }
  if (input.protocolConfigLauncherId) {
    artifact.protocolConfigLauncherId = input.protocolConfigLauncherId;
  }
  if (input.vaultVersionRegistryLauncherId) {
    artifact.vaultVersionRegistryLauncherId = input.vaultVersionRegistryLauncherId;
  }
  return artifact;
}

function normalizePaymentTerms(
  terms: ProtocolOfferPaymentTerms,
): Required<Pick<ProtocolOfferPaymentTerms, 'currency' | 'amount' | 'quantity'>> &
  Pick<ProtocolOfferPaymentTerms, 'paymentPuzzleHash' | 'protocolTreasuryPuzhash'> {
  return {
    currency: nonEmpty(terms.currency, 'payment terms currency').toUpperCase(),
    amount: positiveInteger(terms.amount, 'payment terms amount'),
    quantity: positiveInteger(terms.quantity ?? 1, 'payment terms quantity'),
    paymentPuzzleHash: terms.paymentPuzzleHash ?? null,
    protocolTreasuryPuzhash: terms.protocolTreasuryPuzhash ?? null,
  };
}

function contentHash(value: unknown): string {
  const digest = sha256(new TextEncoder().encode(stableJson(value)));
  return `sha256:${digest.slice(2)}`;
}

function nonEmpty(value: string, field: string): string {
  const out = String(value ?? '').trim();
  if (!out) {
    throw new Error(`${field} is required before a minted proposal can become offer-ready`);
  }
  return out;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function stableJson(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(',')}}`;
}
