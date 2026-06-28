import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * Thin HTTP client for ``populis_api``'s committee-action forwarder
 * endpoint ``POST /admin/committee/vote`` (Brick 3.5c-3).
 *
 * **Auth model.**  The endpoint is **publish-only** and **not** gated
 * by admin JWT (POP-CANON-013).  Authority comes from the PGT lock
 * announcement embedded in the bundle's coin spends.  The API
 * performs only structural validation (well-formed SpendBundle JSON
 * with ≥1 coin spend) before handing off to coinset.org's mempool,
 * which enforces all semantic rules (signatures, announcements,
 * quorum, deadlines, lineage).
 *
 * **Why not push directly to coinset?**  The same endpoint is used by
 * mint PROPOSE / EXECUTE as well; centralising the publish path
 * through populis_api keeps the network-side rate limits + audit
 * logs in one place.  If populis_api is down, the runner could fall
 * back to direct coinset push (already supported by
 * {@link CoinsetService.pushTx}), but that's left to a future brick.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.faucetApi;

  /**
   * Forward a signed committee-action spend bundle (PROPOSE / VOTE /
   * EXECUTE) to chain via populis_api → coinset.org.
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
      this.http.post<CommitteeVoteApiResponseWire>(
        `${this.base}/admin/committee/vote`,
        body,
      ),
    );
    return {
      pushed: res.pushed,
      status: res.status,
      spendBundleId: res.spend_bundle_id,
      proposalId: res.proposal_id ?? undefined,
    };
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
