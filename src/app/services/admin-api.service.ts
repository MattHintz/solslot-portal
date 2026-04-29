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

export interface AdminRefreshResponse {
  jwt: string;
  expires_at: number;
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
