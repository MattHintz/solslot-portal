import { Injectable } from '@angular/core';

import type { MintProposalResponse } from '../admin-api.service';
import { bytesToHex } from '../../utils/chia-hash';
import {
  assetClassToCode,
  canonicalCollectionIdHash,
  canonicalPropertyIdHash,
} from '../../utils/mint-property-id';
import { environment } from '../../../environments/environment';

import type { PublishMintArgs } from './mint-proposal-v2-publish-runner.service';
import { MintPublishService } from './mint-publish.service';

/**
 * Pure assembler that maps an operator's localStorage mint DRAFT plus
 * the protocol deployment context into the
 * {@link PublishMintArgs} shape the
 * {@link MintProposalV2PublishRunnerService.publishMint} runner
 * consumes (Phase 4f sub-brick 4f.1b).
 *
 * **Why this is its own brick.**  ``publishMint`` takes a wide,
 * already-canonical argument bag; building it inline in the
 * mint-detail component would mix three concerns — pulling display
 * fields off the draft, applying protocol canonicalisation rules, and
 * reading protocol coordinates out of ``environment``.  Splitting the
 * deterministic part out keeps it unit-testable without a wallet,
 * WASM, or chain access.
 *
 * **What this service maps from the draft + ``environment``:**
 *   * ``propertyIdCanon`` — ``sha256(upper(trim(property_id)) utf8)``,
 *     mirroring ``property_registry_driver.canonicalise_property_id``.
 *   * ``collectionIdCanon`` — same canonical hash rule for the deed's
 *     Pool Economic V2 collection id.
 *   * ``sharePpm`` — ``draft.share_ppm``; 1_000_000 equals 100%.
 *   * ``parValueMojos`` — straight from ``draft.par_value``; the API
 *     contract defines this as mojos/cents already.
 *   * ``assetClass`` — alpha enum mapping, currently
 *     ``RWA-RE-RES -> 1``; unknown strings are rejected.
 *   * ``jurisdictionHex`` — UTF-8 encoding of ``draft.jurisdiction``.
 *   * ``royaltyPuzhash`` / ``royaltyBps`` — straight off the draft.
 *   * ``quorumThreshold`` — ``draft.quorum_required``.
 *   * the protocol, pool, and ``p2*`` context fields — from
 *     ``environment.solslotProtocol`` (added in 4f.1a, mirroring the
 *     API's ``SOLSLOT_*`` env vars).
 *   * ``propertyRegistryPuzzleHash`` — current A4 property-registry singleton
 *     full puzzle hash; the mint bill commits to this alongside
 *     ``propertyIdCanon``.
 *   * ``firstVoteAmount`` / ``votingWindowSeconds`` — default to
 *     ``environment.solslotProtocol.governanceMinProposalStake`` /
 *     ``governanceVotingWindowSeconds`` when the caller omits them.
 *   * ``proposalId`` — ``draft.id`` (audit correlation only).
 *
 * **What the caller MUST supply:**
 *   * ``ownerMemberHash`` — the Eip712Member leaf hash of the proposer's
 *     EVM key.  Deriving it needs the 33-byte secp256k1 pubkey + WASM
 *     (``Eip712LeafHashService``), neither of which is pure, so it is
 *     supplied by the (WASM-aware) caller.
 *
 * ``govMemberHash`` defaults to 32 zero bytes — the placeholder the
 * Phase-4 fixtures pin (``GOV_MEMBER_HASH = b"\\x00" * 32``).
 *
 * The result is a discriminated union so the component can render a
 * precise reason when args can't be built (e.g. the operator hasn't
 * pinned the protocol context yet) instead of throwing.
 */
@Injectable({ providedIn: 'root' })
export class PublishMintArgsAssemblerService {
  /** 0x-hex of 32 zero bytes — the Phase-4 alpha gov member placeholder. */
  static readonly ZERO_MEMBER_HASH = '0x' + '0'.repeat(64);

  /**
   * Assemble {@link PublishMintArgs} from a draft + caller-supplied
   * owner member hash.  Pure: same inputs always produce the same
   * output; no chain, wallet, or WASM access.
   */
  assemble(input: AssemblePublishArgsInput): AssemblePublishArgsResult {
    const ctx = input.protocolContext ?? defaultProtocolContext();

    // ── Protocol context must be configured ──
    const missing: (keyof MintPublishProtocolContext)[] = [];
    if (!isNonEmpty(ctx.protocolDidSingletonStructHex)) {
      missing.push('protocolDidSingletonStructHex');
    }
    if (!isNonEmpty(ctx.protocolDidPuzhash)) missing.push('protocolDidPuzhash');
    if (!isNonEmpty(ctx.protocolDidInnerPuzhash)) {
      missing.push('protocolDidInnerPuzhash');
    }
    if (!isNonEmpty(ctx.governanceSingletonStructHex)) {
      missing.push('governanceSingletonStructHex');
    }
    if (!isNonEmpty(ctx.poolSingletonLauncherId)) {
      missing.push('poolSingletonLauncherId');
    }
    if (!isNonEmpty(ctx.poolSingletonLauncherPuzzleHash)) {
      missing.push('poolSingletonLauncherPuzzleHash');
    }
    if (!isNonEmpty(ctx.p2PoolModHash)) missing.push('p2PoolModHash');
    if (!isNonEmpty(ctx.p2VaultModHash)) missing.push('p2VaultModHash');
    if (!isNonEmpty(ctx.propertyRegistryPuzzleHash)) {
      missing.push('propertyRegistryPuzzleHash');
    }
    if (missing.length > 0) {
      return { kind: 'missing-protocol-context', missing };
    }

    // ── Canonical draft-derived fields ──
    let propertyIdCanon: string;
    let collectionIdCanon: string;
    let assetClass: bigint;
    try {
      propertyIdCanon = canonicalPropertyIdHash(input.draft.property_id);
    } catch {
      return { kind: 'invalid-input', reason: 'property-id-canon-derive-failed' };
    }
    try {
      collectionIdCanon = canonicalCollectionIdHash(input.draft.collection_id);
    } catch {
      return { kind: 'invalid-input', reason: 'collection-id-canon-derive-failed' };
    }
    let parValueMojos: bigint;
    try {
      parValueMojos = BigInt(input.draft.par_value);
    } catch {
      return { kind: 'invalid-input', reason: 'par-value-must-be-integer' };
    }
    try {
      assetClass = BigInt(assetClassToCode(input.draft.asset_class));
    } catch {
      return { kind: 'invalid-input', reason: 'asset-class-unknown' };
    }
    if (!is32ByteHex(propertyIdCanon)) {
      return { kind: 'invalid-input', reason: 'property-id-canon-must-be-32-bytes' };
    }
    if (!is32ByteHex(collectionIdCanon)) {
      return { kind: 'invalid-input', reason: 'collection-id-canon-must-be-32-bytes' };
    }
    if (!is32ByteHex(ctx.propertyRegistryPuzzleHash)) {
      return {
        kind: 'invalid-input',
        reason: 'property-registry-puzzle-hash-must-be-32-bytes',
      };
    }
    if (parValueMojos <= 0n) {
      return { kind: 'invalid-input', reason: 'par-value-must-be-positive' };
    }
    const sharePpm = input.draft.share_ppm;
    if (!Number.isInteger(sharePpm) || sharePpm <= 0 || sharePpm > 1_000_000) {
      return { kind: 'invalid-input', reason: 'share-ppm-must-be-1-to-1000000' };
    }

    // ── Caller-supplied 32-byte hex fields ──
    if (!is32ByteHex(input.ownerMemberHash)) {
      return { kind: 'invalid-input', reason: 'owner-member-hash-must-be-32-bytes' };
    }
    const govMemberHash = input.govMemberHash ?? PublishMintArgsAssemblerService.ZERO_MEMBER_HASH;
    if (!is32ByteHex(govMemberHash)) {
      return { kind: 'invalid-input', reason: 'gov-member-hash-must-be-32-bytes' };
    }

    // ── Draft-derived fields ──
    if (!is32ByteHex(input.draft.royalty_puzhash)) {
      return { kind: 'invalid-input', reason: 'royalty-puzhash-must-be-32-bytes' };
    }
    const royaltyBps = input.draft.royalty_bps;
    if (!Number.isInteger(royaltyBps) || royaltyBps < 0) {
      return { kind: 'invalid-input', reason: 'royalty-bps-must-be-non-negative-integer' };
    }
    const quorumThreshold = input.draft.quorum_required;
    if (!Number.isInteger(quorumThreshold) || quorumThreshold < 0) {
      return { kind: 'invalid-input', reason: 'quorum-required-must-be-non-negative-integer' };
    }

    // ── Publish-flow inputs (default to env governance mirrors) ──
    const firstVoteAmount =
      input.firstVoteAmount ?? environment.solslotProtocol.governanceMinProposalStake;
    const votingWindowSeconds =
      input.votingWindowSeconds ?? environment.solslotProtocol.governanceVotingWindowSeconds;
    if (BigInt(firstVoteAmount) <= 0n) {
      return { kind: 'invalid-input', reason: 'first-vote-amount-must-be-positive' };
    }
    if (BigInt(votingWindowSeconds) <= 0n) {
      return { kind: 'invalid-input', reason: 'voting-window-must-be-positive' };
    }

    const args: PublishMintArgs = {
      propertyId: input.draft.property_id,
      collectionId: input.draft.collection_id,
      assetClassName: input.draft.asset_class,
      propertyIdCanon,
      collectionIdCanon,
      sharePpm,
      parValueMojos,
      assetClass,
      jurisdictionHex: utf8ToHex(input.draft.jurisdiction),
      royaltyPuzhash: input.draft.royalty_puzhash,
      royaltyBps,
      quorumThreshold,
      ownerMemberHash: input.ownerMemberHash,
      govMemberHash,
      protocolDidSingletonStructHex: ctx.protocolDidSingletonStructHex,
      protocolDidPuzhash: ctx.protocolDidPuzhash,
      protocolDidInnerPuzhash: ctx.protocolDidInnerPuzhash,
      governanceSingletonStructHex: ctx.governanceSingletonStructHex,
      poolSingletonLauncherId: ctx.poolSingletonLauncherId,
      poolSingletonLauncherPuzzleHash: ctx.poolSingletonLauncherPuzzleHash,
      p2PoolModHash: ctx.p2PoolModHash,
      p2VaultModHash: ctx.p2VaultModHash,
      propertyRegistryPuzzleHash: ctx.propertyRegistryPuzzleHash,
      firstVoteAmount,
      votingWindowSeconds,
      ...(input.nowSeconds !== undefined ? { nowSeconds: input.nowSeconds } : {}),
      proposalId: input.draft.id,
    };
    return { kind: 'ok', args };
  }
}

// ─── Public shapes ──────────────────────────────────────────────────────────

/**
 * Protocol deployment coordinates the publish flow curries in.  Mirror
 * of the four ``environment.solslotProtocol`` fields added in 4f.1a;
 * accepted as an explicit override so unit tests don't have to patch the
 * environment module.
 */
export interface MintPublishProtocolContext {
  protocolDidSingletonStructHex: string;
  protocolDidPuzhash: string;
  protocolDidInnerPuzhash: string;
  governanceSingletonStructHex: string;
  poolSingletonLauncherId: string;
  poolSingletonLauncherPuzzleHash: string;
  p2PoolModHash: string;
  p2VaultModHash: string;
  propertyRegistryPuzzleHash: string;
}

export interface AssemblePublishArgsInput {
  /** The operator's localStorage DRAFT (source of the display fields). */
  draft: MintProposalResponse;
  /** Eip712Member leaf hash of the proposer (WASM-derived by the caller). */
  ownerMemberHash: string;
  /** Defaults to 32 zero bytes (Phase-4 alpha placeholder). */
  govMemberHash?: string;
  /** Defaults to ``environment.solslotProtocol.governanceMinProposalStake``. */
  firstVoteAmount?: number | bigint;
  /** Defaults to ``environment.solslotProtocol.governanceVotingWindowSeconds``. */
  votingWindowSeconds?: number | bigint;
  /** Override "now" for deterministic tests; forwarded to the runner. */
  nowSeconds?: number;
  /** Override the env protocol context (testing seam). */
  protocolContext?: MintPublishProtocolContext;
}

export type AssemblePublishArgsResult =
  | { kind: 'ok'; args: PublishMintArgs }
  | {
      kind: 'missing-protocol-context';
      missing: (keyof MintPublishProtocolContext)[];
    }
  | { kind: 'invalid-input'; reason: string };

// ─── Internals ──────────────────────────────────────────────────────────────

function defaultProtocolContext(): MintPublishProtocolContext {
  const p = environment.solslotProtocol;
  return {
    protocolDidSingletonStructHex: p.protocolDidSingletonStructHex,
    protocolDidPuzhash: p.protocolDidPuzhash,
    protocolDidInnerPuzhash: p.protocolDidInnerPuzhash,
    governanceSingletonStructHex: p.governanceSingletonStructHex,
    poolSingletonLauncherId: p.poolLauncherId,
    poolSingletonLauncherPuzzleHash: MintPublishService.SINGLETON_LAUNCHER_HASH,
    p2PoolModHash: p.p2PoolModHash,
    p2VaultModHash: p.p2VaultModHash,
    propertyRegistryPuzzleHash: p.propertyRegistryCurrentPuzzleHash,
  };
}

function isNonEmpty(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** True for a 0x-prefixed lowercase/uppercase 32-byte hex string. */
function is32ByteHex(v: string | null | undefined): boolean {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
}

/** UTF-8 encode a string to 0x-prefixed hex (empty string → ``0x``). */
function utf8ToHex(s: string): string {
  return bytesToHex(new TextEncoder().encode(s));
}
