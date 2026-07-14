/**
 * **Types-only module** for legacy Solslot admin desk wire shapes.
 *
 * **Migration history.**  Pre-Hermes-D this file exposed an
 * ``AdminApiService`` class that handled the JWT-based admin login
 * handshake (``/admin/auth/challenge``, ``/admin/auth/login``,
 * ``/admin/auth/refresh``) and the mint-proposal CRUD endpoints
 * (``/admin/mint/*``, ``/admin/committee/*``).  Phase 9-Hermes-D
 * removed every API call from the portal:
 *
 *   * Admin auth \u2192 wallet-signed-message + on-chain MIPS membership
 *     check, in {@link AdminWalletAuthService} + {@link AdminSessionService}.
 *   * Mint proposal DRAFT lifecycle \u2192 browser localStorage, in
 *     {@link MintDraftStorageService}.
 *   * Trust-roots reads \u2192 on-chain singleton replay, in
 *     {@link OnChainStateService}.
 *
 * The class was deleted in the same pass.  Only the wire-shape
 * interfaces remain because they're still useful as canonical types
 * for the on-chain shim ({@link OnChainStateService} returns
 * {@link AdminAuthorityResponse}-shaped data) and the localStorage
 * draft store ({@link MintDraftStorageService} produces
 * {@link MintProposalResponse}-shaped records).  Treating them as
 * types-only avoids breaking every consumer's import.
 */
import { Eip712TypedData } from './solslot-api.service';

/** Eight-state lifecycle \u2014 see solslot_api/mint_proposals.py:ALL_STATES. */
export type MintProposalState =
  | 'DRAFT'
  | 'PROPOSED'
  | 'VOTING'
  | 'PASSED'
  | 'EXECUTED'
  | 'MINTED'
  | 'FAILED'
  | 'CANCELED';

/**
 * Response shape of the legacy ``GET /admin/auth/authority`` endpoint.
 *
 * Today {@link OnChainStateService.getAuthority} returns this same
 * shape, populated from environment constants + on-chain singleton
 * replay rather than an API call.  The Trust Roots page consumes
 * either source identically.
 */
export interface AdminAuthorityResponse {
  enabled: boolean;
  launcher_id: string | null;
  allowlist_pubkey_hashes: string[] | null;
  quorum_m: number | null;
  authority_version: number | null;
  state_hash: string | null;
  phase: '2-informational-only' | string;
  gating_source: 'SOLSLOT_ADMIN_PUBKEY_ALLOWLIST' | string;
  informational_only: boolean;
}

/**
 * Response shape of the legacy ``GET /admin/auth/authority_v2`` endpoint.
 *
 * Today {@link OnChainStateService.getAuthorityV2} returns this same
 * shape; the inner-puzzle curry args (``mips_root_hash``,
 * ``admins_hash``, ``pending_ops_hash``, ``authority_version``)
 * remain ``null`` until the inner-puzzle uncurry helper lands in
 * {@link ChiaSingletonReaderService}.  ``state_hash`` is correctly
 * derived from chain via PROTOCOL_PREFIX announcement replay.
 */
export interface AdminAuthorityV2Response {
  enabled: boolean;
  launcher_id: string | null;
  mips_root_hash: string | null;
  admins_hash: string | null;
  pending_ops_hash: string | null;
  authority_version: number | null;
  state_hash: string | null;
  phase:
    | '1-not-deployed'
    | '2-informational-only'
    | '3-migration-in-progress'
    | '4-gating-source'
    | string;
  gating_source: 'SOLSLOT_ADMIN_PUBKEY_ALLOWLIST' | string;
  informational_only: boolean;
}

export type SmartDeedSecurityStructure =
  | 'entity_ucc'
  | 'real_property_lien'
  | 'deed_of_trust'
  | 'mortgage'
  | 'hybrid'
  | 'contract_only'
  | 'unsecured'
  | 'other';

export type SmartDeedFilingStatus =
  | 'recorded'
  | 'pending'
  | 'intended'
  | 'not_applicable'
  | 'none';

export type SmartDeedSettlementBasis =
  | 'property_sale'
  | 'appraisal_buyout'
  | 'fixed_maturity'
  | 'governance_settlement'
  | 'nav_redemption'
  | 'hybrid'
  | 'other';

export interface SmartDeedTermsMetadata {
  schemaVersion: 'solslot.smartdeed.submission.v2';
  securityStructure: SmartDeedSecurityStructure;
  securityDescription: string;
  obligor: string;
  collateralDescription: string;
  filingStatus: SmartDeedFilingStatus;
  filingReference?: string;
  priorityDescription: string;
  settlementBasis: SmartDeedSettlementBasis;
  settlementDescription: string;
  transferPolicy: string;
  definitiveDocumentsUrl: string;
  documentPackageHash: string;
}

/** Request body for legacy ``POST /admin/mint/propose`` (now: localStorage create). */
export interface ProposeMintRequest {
  par_value: number;
  asset_class: string;
  property_id: string;
  collection_id: string;
  share_ppm: number;
  jurisdiction: string;
  /** 0x-prefixed 32-byte royalty payee puzzle hash. */
  royalty_puzhash: string;
  /** 0\u201310000 basis points. */
  royalty_bps: number;
  /** Minimum SGT-mojos of YES votes for the proposal to pass. */
  quorum_required: number;
  off_chain_metadata?: Record<string, unknown>;
}

/**
 * Mint proposal record.  Today this is the shape
 * {@link MintDraftStorageService} stores in localStorage; on-chain
 * fields are populated when the draft is submitted on chain
 * (Phase B2 follow-up).
 */
export interface MintProposalResponse {
  id: string;
  /** Lowercase 0x-hex Ethereum address of the admin who created the draft. */
  owner_pubkey: string;
  state: MintProposalState;
  par_value: number;
  asset_class: string;
  /** Canonicalised (upper, stripped) per POP-CANON-014. */
  property_id: string;
  /** Canonicalised (upper, stripped) collection identifier for NAV registry pricing. */
  collection_id: string;
  /** Share of the collection NAV in ppm; 1000000 = 100%. */
  share_ppm: number;
  jurisdiction: string;
  royalty_puzhash: string;
  royalty_bps: number;
  computed: {
    smart_deed_inner_puzhash: string | null;
    eve_inner_puzhash: string | null;
    deed_full_puzhash: string | null;
    proposal_hash: string | null;
  };
  on_chain: {
    proposal_tracker_coin_id: string | null;
    sgt_lock_coin_id: string | null;
    deed_launcher_id: string | null;
    published_bundle_id: string | null;
    executed_bundle_id: string | null;
  };
  vote_tally: number;
  quorum_required: number;
  deadline: number | null;
  timestamps: {
    created_at: number;
    published_at: number | null;
    executed_at: number | null;
    minted_at: number | null;
  };
  off_chain_metadata: Record<string, unknown> | null;
}

export interface MintProposalListResponse {
  proposals: MintProposalResponse[];
  count: number;
}

export interface ListMintProposalsOptions {
  state?: MintProposalState;
  /** Lowercase 0x-hex address to filter by proposer. */
  owner?: string;
  limit?: number;
  offset?: number;
}

// Re-exported solely so consumers don't need a separate import for the
// Eip712TypedData shape \u2014 the admin auth flow uses it heavily.
export type { Eip712TypedData };
