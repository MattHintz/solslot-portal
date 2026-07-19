import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';

/**
 * Thin HTTP client for ``solslot_api``'s committee-action forwarder
 * endpoint ``POST /admin/committee/vote`` (Brick 3.5c-3).
 *
 * **Auth model.**  The endpoint is **publish-only** and **not** gated
 * by admin JWT (POP-CANON-013).  Authority comes from the SGT lock
 * announcement embedded in the bundle's coin spends.  The API
 * performs only structural validation (well-formed SpendBundle JSON
 * with ≥1 coin spend) before handing off to coinset.org's mempool,
 * which enforces all semantic rules (signatures, announcements,
 * quorum, deadlines, lineage).
 *
 * **Why not push directly to coinset?**  The same endpoint is used by
 * mint PROPOSE / EXECUTE as well; centralising the publish path
 * through solslot_api keeps the network-side rate limits + audit
 * logs in one place.  If solslot_api is down, the runner could fall
 * back to direct coinset push (already supported by
 * {@link CoinsetService.pushTx}), but that's left to a future brick.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeApiService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AdminSessionService);
  private readonly base = environment.faucetApi;

  /**
   * Forward a signed committee-action spend bundle (PROPOSE / VOTE /
   * EXECUTE) to chain via solslot_api → coinset.org.
   *
   * @param spendBundle  ``SpendBundle.to_json_dict()`` shape:
   *   ``{ coin_spends: [...], aggregated_signature: '0x...' }``.
   * @param proposalId   Optional informational id for server-side
   *   correlation (not used as authority — the bundle's own coin
   *   spends bind the proposal hash on chain).
   *
   * @returns ``{ pushed, status, spendBundleId, proposalId? }``.
   *   ``pushed === false`` means coinset rejected the bundle; the
   *   ``status`` string carries the chain's rejection reason.
   *
   * @throws  ``HttpErrorResponse`` for transport / validation errors.
   */
  async castVote(
    spendBundle: SpendBundleJson,
    proposalId?: string,
  ): Promise<CommitteeVoteApiResponse> {
    const body: { spend_bundle: SpendBundleJson; proposal_id?: string } = {
      spend_bundle: spendBundle,
    };
    if (proposalId) body.proposal_id = proposalId;
    const res = await firstValueFrom(
      this.http.post<CommitteeVoteApiResponseWire>(`${this.base}/admin/committee/vote`, body),
    );
    return {
      pushed: res.pushed,
      status: res.status,
      spendBundleId: res.spend_bundle_id,
      proposalId: res.proposal_id ?? undefined,
    };
  }

  /**
   * Forward a signed MINT-proposal **publish** spend bundle to chain
   * via solslot_api → coinset.org.
   *
   * Mint PROPOSE shares the committee-action forwarder's trust model
   * with VOTE (POP-CANON-013): publish-only, no admin JWT.  Authority
   * comes from the bundle's own coin spends (the tracker IDLE → OPEN
   * transition's announcements + the proposer's SGT-lock stake); the
   * API only structurally validates before handing to the mempool,
   * which enforces every semantic rule.
   *
   * Hits ``POST /admin/committee/propose`` (added server-side in
   * Phase 4e).  Same wire + response shape as {@link castVote} so the
   * UI renders ``status`` identically for either action.
   *
   * @param spendBundle  ``SpendBundle.to_json_dict()`` shape.
   * @param proposalId   Optional informational correlation id (the
   *   localStorage draft id); not used as authority.
   * @param proposalMetadata  Optional server-side re-derivation guard
   *   inputs (Brick 4e.2d).  When present, the API re-runs
   *   ``mint_publish_driver.build_mint_publish_artifacts`` and rejects
   *   the bundle (HTTP 400) if its on-chain commitments drift from the
   *   canonical computation.  Absence preserves the publish-only
   *   forwarder path for callers that predate the guard.
   *
   * @returns ``{ pushed, status, spendBundleId, proposalId? }``.
   * @throws  ``HttpErrorResponse`` for transport / validation errors.
   */
  async publishProposal(
    spendBundle: SpendBundleJson,
    proposalId: string,
    proposalMetadata: PublishProposalMetadataJson,
  ): Promise<CommitteeVoteApiResponse> {
    const body: {
      spend_bundle: SpendBundleJson;
      proposal_id: string;
      proposal_metadata: PublishProposalMetadataJson;
    } = {
      spend_bundle: spendBundle,
      proposal_id: proposalId,
      proposal_metadata: proposalMetadata,
    };
    const res = await firstValueFrom(
      this.http.post<CommitteeVoteApiResponseWire>(`${this.base}/admin/committee/propose`, body, {
        headers: this.adminHeaders(),
      }),
    );
    return {
      pushed: res.pushed,
      status: res.status,
      spendBundleId: res.spend_bundle_id,
      proposalId: res.proposal_id ?? undefined,
    };
  }

  /** Submit the canonical five-spend MINT execution bundle. */
  async executeProposal(
    spendBundle: SpendBundleJson,
    proposalId: string,
  ): Promise<CommitteeVoteApiResponse> {
    const res = await firstValueFrom(
      this.http.post<CommitteeVoteApiResponseWire>(
        `${this.base}/admin/committee/execute`,
        {
          spend_bundle: spendBundle,
          proposal_id: proposalId,
        },
        { headers: this.adminHeaders() },
      ),
    );
    return {
      pushed: res.pushed,
      status: res.status,
      spendBundleId: res.spend_bundle_id,
      proposalId: res.proposal_id ?? undefined,
    };
  }

  private adminHeaders(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.session.requireJwt()}` });
  }
}

// ── Wire shapes ──────────────────────────────────────────────────────────

/**
 * SpendBundle in ``chia_rs.SpendBundle.to_json_dict()`` shape.  The
 * runner builds this from the wallet-signed CoinSpends.
 */
export interface SpendBundleJson {
  coin_spends: Array<{
    coin: { parent_coin_info: string; puzzle_hash: string; amount: number };
    puzzle_reveal: string;
    solution: string;
  }>;
  aggregated_signature: string;
}

/**
 * Per-proposal metadata for the server-side re-derivation guard
 * (``PublishProposalMetadataRequest`` in ``solslot_api``, Brick 4e.2c.3).
 *
 * All ``*_hash`` / ``*_puzhash`` / ``property_id_canon`` fields are
 * 0x-prefixed hex of exactly 32 bytes.  ``jurisdiction`` is hex of the
 * UTF-8 encoded jurisdiction code (e.g. ``US-TX`` → ``0x55532d5458``).
 * The integer fields are plain JSON numbers (the API uses Python
 * arbitrary-precision ``int``; the runner narrows ``bigint`` inputs to
 * ``number`` for JSON serialisation, matching the bundle's coin-amount
 * precision compromise).
 */
export interface PublishProposalMetadataJson {
  property_id: string;
  collection_id: string;
  asset_class_name: string;
  property_id_canon: string;
  collection_id_canon: string;
  share_ppm: number;
  property_registry_coin_id: string;
  property_registry_puzzle_hash: string;
  par_value_mojos: number;
  asset_class: number;
  jurisdiction: string;
  royalty_puzhash: string;
  royalty_bps: number;
  quorum_threshold: number;
  owner_member_hash: string;
  gov_member_hash: string;
  voting_deadline: number;
  metadata_root?: string;
  metadata_anchor_id?: string;
}

interface CommitteeVoteApiResponseWire {
  pushed: boolean;
  status: string;
  spend_bundle_id: string;
  proposal_id?: string | null;
}

export interface CommitteeVoteApiResponse {
  pushed: boolean;
  status: string;
  spendBundleId: string;
  proposalId?: string;
}
