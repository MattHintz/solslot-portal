import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { Eip712TypedData } from './populis-api.service';

/**
 * Typed HTTP client for the Populis Admin Desk endpoints under
 * `/admin/auth/*`, `/admin/mint/*`, and `/admin/committee/*`.
 *
 * Authentication model (from `populis_api/docs/ADMIN_DESK_DESIGN.md`):
 *   1. POST `/admin/auth/challenge` — server returns a nonce + EIP-712 envelope.
 *   2. User signs the envelope with their EVM wallet.
 *   3. POST `/admin/auth/login` — server verifies the signature, recovers the
 *      pubkey, checks it against `POPULIS_ADMIN_PUBKEY_ALLOWLIST`, and issues
 *      a 15-minute JWT.
 *   4. Subsequent `/admin/mint/*` calls carry `Authorization: Bearer <jwt>`.
 *   5. POST `/admin/auth/refresh` mints a fresh JWT (re-checks live allowlist
 *      per POP-CANON-012; revoked admins are denied).
 *
 * `/admin/committee/*` is INTENTIONALLY public (POP-CANON-013): committee
 * voting is open to any PGT holder, not just allowlisted admins.  The
 * publish-only `/vote` endpoint will (in Step B) carry its authority in the
 * embedded PGT-VOTE signature inside the spend bundle.
 *
 * This service is stateless w.r.t. auth — token storage + refresh scheduling
 * lives in {@link AdminSessionService}.  Endpoints that need a token accept
 * it as a parameter so the session service can wire in retry-on-refresh
 * behaviour without coupling the wire layer to the cache.
 */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.populisApi;

  // ── /admin/auth/* ────────────────────────────────────────────────────────
  /** Step 1: request a fresh challenge nonce + EIP-712 envelope. */
  async requestChallenge(
    owner: string,
    authType: AdminAuthType = 'evm',
  ): Promise<AdminChallengeResponse> {
    return firstValueFrom(
      this.http.post<AdminChallengeResponse>(
        `${this.base}/admin/auth/challenge`,
        { owner, auth_type: authType },
      ),
    );
  }

  /** Step 2: submit the signature, receive a JWT. */
  async submitLogin(req: AdminLoginRequest): Promise<AdminLoginResponse> {
    return firstValueFrom(
      this.http.post<AdminLoginResponse>(`${this.base}/admin/auth/login`, req),
    );
  }

  /** Mint a new JWT with the same subject + auth type, given a still-valid one. */
  async refreshJwt(jwt: string): Promise<AdminRefreshResponse> {
    return firstValueFrom(
      this.http.post<AdminRefreshResponse>(
        `${this.base}/admin/auth/refresh`,
        {},
        { headers: this.bearer(jwt) },
      ),
    );
  }

  /**
   * Read the on-chain admin-authority singleton snapshot (A.2).
   *
   * Public — no JWT required.  Returns a deterministic state hash so
   * third parties can independently verify against on-chain state by
   * walking the singleton lineage on coinset.org (the Trust Roots
   * page does exactly this via {@link ChiaSingletonReaderService}).
   *
   * Per POP-CANON-021, the response includes ``phase``, ``gating_source``,
   * and ``informational_only`` disclaimers so consumers can tell
   * in-band that the published state is NOT the request-time gating
   * source today (Phase 2.5 deferred).
   */
  async getAuthority(): Promise<AdminAuthorityResponse> {
    return firstValueFrom(
      this.http.get<AdminAuthorityResponse>(`${this.base}/admin/auth/authority`),
    );
  }

  /**
   * GET /admin/auth/authority_v2 (Phase 9-Hermes-C transparency endpoint).
   *
   * Returns the on-chain v2 admin-authority singleton's published state:
   * the MIPS root, admins-list hash, pending-ops-list hash, monotonic
   * version, and a derived state_hash.  The singleton is a thin shim
   * delegating to a CHIP-0043 MIPS m-of-n quorum where each admin slot
   * is itself a OneOfN of personal auth methods (BLS, EIP-712 / MetaMask,
   * passkey, ...).
   *
   * Public + unauthenticated by design (matches v1's transparency
   * surface).  Includes the ``phase``, ``gating_source``, and
   * ``informational_only`` disclaimers so consumers can tell in-band
   * that the v2 surface is informational-only until the migration's
   * Phase 4 cuts gating-source over to v2's MIPS quorum.
   */
  async getAuthorityV2(): Promise<AdminAuthorityV2Response> {
    return firstValueFrom(
      this.http.get<AdminAuthorityV2Response>(`${this.base}/admin/auth/authority_v2`),
    );
  }

  /**
   * Compute the canonical Eip712Member leaf hash for an operator's
   * pubkey via the API's deterministic helper (Phase 2.5c).
   *
   * Used by the launch-authority-v2 wizard to populate an admin
   * record's ``leaf_hash`` field when the operator opts to use their
   * connected EVM wallet as the genesis admin.  Goes through the API
   * because chia-wallet-sdk-wasm 0.33 doesn't yet expose the
   * Eip712Member puzzle bytecode (PR #396 adds it but isn't
   * released).  Anyone can call this endpoint — no auth required.
   *
   * The response carries every curry arg the records JSON needs, so
   * callers can copy it whole into ``leaves[i]`` without re-deriving.
   */
  async computeEip712LeafHash(
    body: ComputeLeafHashRequest,
  ): Promise<ComputeLeafHashResponse> {
    return firstValueFrom(
      this.http.post<ComputeLeafHashResponse>(
        `${this.base}/admin/auth/eip712/compute_leaf_hash`,
        body,
      ),
    );
  }

  // ── /admin/mint/* (admin JWT required) ───────────────────────────────────
  /** Create a DRAFT mint proposal owned by the JWT subject. */
  async proposeMint(
    jwt: string,
    body: ProposeMintRequest,
  ): Promise<MintProposalResponse> {
    return firstValueFrom(
      this.http.post<MintProposalResponse>(
        `${this.base}/admin/mint/propose`,
        body,
        { headers: this.bearer(jwt) },
      ),
    );
  }

  /** List proposals.  Filter by state and/or owner pubkey. */
  async listMintProposals(
    jwt: string,
    opts: ListMintProposalsOptions = {},
  ): Promise<MintProposalListResponse> {
    const params: Record<string, string> = {};
    if (opts.state) params['state'] = opts.state;
    if (opts.owner) params['owner'] = opts.owner;
    if (opts.limit !== undefined) params['limit'] = String(opts.limit);
    if (opts.offset !== undefined) params['offset'] = String(opts.offset);
    return firstValueFrom(
      this.http.get<MintProposalListResponse>(`${this.base}/admin/mint`, {
        headers: this.bearer(jwt),
        params,
      }),
    );
  }

  /** Fetch a single proposal by id. */
  async getMintProposal(jwt: string, id: string): Promise<MintProposalResponse> {
    return firstValueFrom(
      this.http.get<MintProposalResponse>(`${this.base}/admin/mint/${id}`, {
        headers: this.bearer(jwt),
      }),
    );
  }

  /** Cancel a DRAFT proposal (no on-chain effect; just flips state). */
  async cancelMintProposal(jwt: string, id: string): Promise<MintProposalResponse> {
    return firstValueFrom(
      this.http.post<MintProposalResponse>(
        `${this.base}/admin/mint/${id}/cancel`,
        {},
        { headers: this.bearer(jwt) },
      ),
    );
  }

  // ── /admin/committee/* (PUBLIC — no JWT, POP-CANON-013) ─────────────────
  /** Open proposals (PROPOSED + VOTING) for committee voters. */
  async listCommitteeProposals(
    opts: { limit?: number; offset?: number } = {},
  ): Promise<MintProposalListResponse> {
    const params: Record<string, string> = {};
    if (opts.limit !== undefined) params['limit'] = String(opts.limit);
    if (opts.offset !== undefined) params['offset'] = String(opts.offset);
    return firstValueFrom(
      this.http.get<MintProposalListResponse>(
        `${this.base}/admin/committee/proposals`,
        { params },
      ),
    );
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  private bearer(jwt: string): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${jwt}` });
  }
}

// ── Wire types (mirror populis_api/admin_auth.py + mint_endpoints.py) ──────
export type AdminAuthType = 'evm' | 'chia_bls';

/** Eight-state lifecycle — see populis_api/mint_proposals.py:ALL_STATES. */
export type MintProposalState =
  | 'DRAFT'
  | 'PROPOSED'
  | 'VOTING'
  | 'PASSED'
  | 'EXECUTING'
  | 'MINTED'
  | 'FAILED'
  | 'CANCELED';

export interface AdminChallengeResponse {
  /** 0x-prefixed 32-byte nonce. */
  nonce: string;
  expires_at: number;
  /** EIP-712 envelope (PopulisAdminLogin primary type). */
  typed_data: Eip712TypedData;
}

export interface AdminLoginRequest {
  owner: string;
  nonce: string;
  /** 65-byte 0x-prefixed signature (r || s || v). */
  signature: string;
  auth_type: AdminAuthType;
}

export interface AdminLoginResponse {
  /** Encoded JWT (HS256, scope=admin, default 15-min TTL). */
  jwt: string;
  expires_at: number;
  /** Lowercase 0x-hex address — the JWT's `sub` claim. */
  owner: string;
}

/**
 * Response shape of `GET /admin/auth/authority` (A.2 transparency endpoint).
 *
 * Mirrors the dict returned by `populis_api/admin_auth.py:admin_authority`.
 * Includes the POP-CANON-021 phase disclaimers (`phase`, `gating_source`,
 * `informational_only`) so consumers can tell in-band that the published
 * BLS quorum state is NOT the request-time gating source today.
 */
export interface AdminAuthorityResponse {
  /** True iff `POPULIS_PROTOCOL_ADMIN_AUTHORITY_PUBKEYS` is non-empty. */
  enabled: boolean;
  /** Coin id (0x-hex bytes32) of the on-chain singleton, when configured. */
  launcher_id: string | null;
  /**
   * sha256 of each allowlisted BLS pubkey (saves bandwidth + adds privacy
   * vs. publishing full 48-byte pubkeys).  The Trust Roots page can
   * recompute these client-side after fetching the on-chain state.
   */
  allowlist_pubkey_hashes: string[] | null;
  /** Minimum signatures required for a rotation spend. */
  quorum_m: number | null;
  /** Monotonic version stamped into the singleton's curried state. */
  authority_version: number | null;
  /**
   * sha256tree(allowlist, quorum_m, authority_version).  Each rotation
   * signer commits to this value via AGG_SIG_ME, and the puzzle emits
   * CREATE_PUZZLE_ANNOUNCEMENT(0x50 || state_hash) on every spend.
   * Trust Roots verification: replay the latest spend on chain via
   * ChiaSingletonReaderService and compare its 0x50-prefixed
   * announcement body against this hash.  Match → published state
   * agrees with on-chain state.  Mismatch → operator drift.
   */
  state_hash: string | null;
  /** POP-CANON-021 disclaimer: see populis_api/admin_auth.py:admin_authority. */
  phase: '2-informational-only' | string;
  gating_source: 'POPULIS_ADMIN_PUBKEY_ALLOWLIST' | string;
  informational_only: boolean;
}

/**
 * Response shape of `GET /admin/auth/authority_v2` (Phase 9-Hermes-C).
 *
 * Mirrors the dict returned by
 * `populis_api/admin_authority_v2.py:build_admin_authority_v2_snapshot`.
 *
 * Unlike v1 (which publishes the full BLS allowlist), v2 publishes only
 * sha256tree HASHES of the admins list and the pending-ops list.  Each
 * admin record is `(admin_id . OneOfN-tree-hash)` so individual auth
 * methods (BLS / EIP-712 pubkeys / passkey credentials) stay private
 * unless the operator chooses to surface them off-chain.  The singleton
 * commits to these hashes via CREATE_PUZZLE_ANNOUNCEMENT(0x50 || state_hash).
 *
 * Trust Roots verification flow:
 *   1. Read /admin/auth/authority_v2 → claimed state_hash.
 *   2. Walk the singleton lineage from launcher_id forward.
 *   3. Replay the latest spend in WASM and read its
 *      PROTOCOL_PREFIX-prefixed announcement body.
 *   4. Compare the announcement body to the claimed state_hash.
 *      Match → published state agrees with on-chain state.
 *      Mismatch → operator drift (or staged migration).
 */
export interface AdminAuthorityV2Response {
  /** True iff at least one v2 setting (launcher_id) is configured. */
  enabled: boolean;
  /** Coin id (0x-hex bytes32) of the on-chain v2 singleton. */
  launcher_id: string | null;
  /** sha256tree of the curried MIPS m_of_n + per-admin OneOfN structure. */
  mips_root_hash: string | null;
  /** sha256tree of the flat `((admin_id . OneOfN-hash) ...)` admins list. */
  admins_hash: string | null;
  /**
   * sha256tree of the flat `((op_kind . pending_op_state) ...)` pending-ops
   * list.  An empty list hashes to a known sentinel
   * (``populis_puzzles.admin_authority_v2_driver.EMPTY_LIST_HASH``).
   */
  pending_ops_hash: string | null;
  /** Monotonic version stamped into the singleton's curried state. */
  authority_version: number | null;
  /**
   * sha256tree(mips_root_hash, admins_hash, pending_ops_hash, authority_version).
   * This is the value the singleton emits as
   * CREATE_PUZZLE_ANNOUNCEMENT(0x50 || state_hash) on every spend; the
   * driver helper `compute_state_hash` produces the same value off-chain.
   */
  state_hash: string | null;
  /**
   * Migration phase indicator:
   *   '1-not-deployed'         — operator hasn't launched v2 yet.
   *   '2-informational-only'   — v2 on-chain but admin desk still gated
   *                              by v1 BLS allowlist (current state).
   *   '3-migration-in-progress' — v1 has emitted MIGRATED_TO_V2.
   *   '4-gating-source'        — admin desk authenticates via v2's MIPS quorum.
   */
  phase:
    | '1-not-deployed'
    | '2-informational-only'
    | '3-migration-in-progress'
    | '4-gating-source'
    | string;
  /** Always 'POPULIS_ADMIN_PUBKEY_ALLOWLIST' until phase 4. */
  gating_source: 'POPULIS_ADMIN_PUBKEY_ALLOWLIST' | string;
  /** True until phase 4 cuts gating-source over to v2's MIPS quorum. */
  informational_only: boolean;
}

export interface AdminRefreshResponse {
  jwt: string;
  expires_at: number;
}

/**
 * Request shape for ``POST /admin/auth/eip712/compute_leaf_hash``.
 *
 * ``network`` is optional — when omitted the API uses its configured
 * ``POPULIS_NETWORK``.  Pass it explicitly when you want the wizard's
 * leaf hash to bind to a specific network regardless of API config.
 */
export interface ComputeLeafHashRequest {
  /** 0x-prefixed 33-byte compressed secp256k1 pubkey. */
  secp256k1_pubkey: string;
  network?: 'testnet11' | 'mainnet';
}

/**
 * Response shape for ``POST /admin/auth/eip712/compute_leaf_hash``.
 *
 * The full curry args are echoed back so callers can copy the entire
 * response into the admin records JSON's ``leaves[i]`` block without
 * re-deriving anything.
 */
export interface ComputeLeafHashResponse {
  /** 0x-prefixed 32-byte tree hash of the curried Eip712Member puzzle. */
  leaf_hash: string;
  /** Echoed pubkey, lowercased + 0x-prefixed. */
  secp256k1_pubkey: string;
  /** 0x-prefixed 32-byte CHIP-0037 type hash (constant). */
  type_hash: string;
  /** 0x-prefixed 34-byte 0x1901 || domain_separator. */
  prefix_and_domain_separator: string;
  /** Echoes the network whose domain separator was used. */
  network: 'testnet11' | 'mainnet';
}

export interface ProposeMintRequest {
  par_value: number;
  asset_class: string;
  property_id: string;
  jurisdiction: string;
  /** 0x-prefixed 32-byte royalty payee puzzle hash. */
  royalty_puzhash: string;
  /** 0–10000 basis points. */
  royalty_bps: number;
  /** Minimum PGT-mojos of YES votes for the proposal to pass. */
  quorum_required: number;
  off_chain_metadata?: Record<string, unknown>;
}

export interface MintProposalResponse {
  id: string;
  owner_pubkey: string;
  state: MintProposalState;
  par_value: number;
  asset_class: string;
  /** Canonicalised (upper, stripped) per POP-CANON-014. */
  property_id: string;
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
    pgt_lock_coin_id: string | null;
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
  /** Lowercase 0x-hex address to filter by proposer (the JWT subject). */
  owner?: string;
  limit?: number;
  offset?: number;
}
