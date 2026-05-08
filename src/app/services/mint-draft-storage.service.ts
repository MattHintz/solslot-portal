import { Injectable } from '@angular/core';
import {
  MintProposalResponse,
  MintProposalState,
  ProposeMintRequest,
} from './admin-api.service';

const STORAGE_KEY = 'populis_mint_drafts_v1';

/**
 * Browser-local storage for ``DRAFT``-state mint proposals.
 *
 * **Why this exists.** Phase 9-Hermes-D's API-removal pass moved the
 * portal off every Populis-API read.  Mint-proposal drafts used to
 * live in the API's database (``POST /admin/mint/propose`` →
 * ``GET /admin/mint/{id}`` round-trip); this service replaces that
 * with browser ``localStorage`` so admins can iterate on drafts
 * without ever touching the API.
 *
 * **Lifecycle.**  Drafts stay in localStorage for as long as the
 * admin keeps the browser profile.  Once a draft is submitted on
 * chain (Phase B2 follow-up: build the proposal-tracker singleton
 * launch spend in WASM and push via coinset), it transitions to the
 * ``PROPOSED`` state and is read from chain via
 * ``ChiaSingletonReaderService.walkLineage``; the localStorage
 * record stays for back-reference but is no longer the source of
 * truth.  Admins can ``cancel()`` a draft at any time (sets state to
 * ``CANCELLED``); cancelled drafts are kept for audit but filtered
 * out of the dashboard's default view.
 *
 * **Owner-scoping.** Every draft carries an ``owner_pubkey`` field
 * matching the {@link AdminSessionService.subject} that created it.
 * {@link list} filters by owner so each admin only sees their own
 * drafts.  The committee desk (cross-admin visibility) does NOT
 * use this service; it walks chain for ``PROPOSED``+ proposals.
 *
 * **Persistence guarantees.** Storage writes are synchronous
 * (``localStorage.setItem``); concurrent tab edits race the last
 * write.  This is acceptable for the draft workflow because admins
 * generally only edit one draft at a time and the on-chain submit
 * is the trust boundary, not the off-chain draft store.
 *
 * **No JWT involvement.** This service has no network calls; it's
 * purely browser-side.  All other admin-desk components currently
 * still take a ``jwt`` parameter for back-compat with the API but
 * Phase C will remove that surface entirely (replacing JWT auth
 * with wallet-signed messages + on-chain MIPS verification).
 */
@Injectable({ providedIn: 'root' })
export class MintDraftStorageService {
  /**
   * Create a new ``DRAFT`` proposal under the supplied owner.
   *
   * Computed and on-chain fields are left null/empty — they're
   * populated when the operator submits the draft on chain in a
   * follow-up Phase B2 commit (build proposal-tracker launch spend
   * in WASM, push via coinset, walk lineage to extract
   * ``proposal_tracker_coin_id``).
   */
  create(req: ProposeMintRequest, ownerPubkey: string): MintProposalResponse {
    const id = newId();
    const now = nowSeconds();
    const proposal: MintProposalResponse = {
      id,
      owner_pubkey: ownerPubkey,
      state: 'DRAFT' as MintProposalState,
      par_value: req.par_value,
      asset_class: req.asset_class,
      property_id: req.property_id,
      jurisdiction: req.jurisdiction,
      royalty_puzhash: req.royalty_puzhash,
      royalty_bps: req.royalty_bps,
      computed: {
        // TODO(Phase B2): compute via WASM at on-chain submit time.
        // The puzzle hashes are deterministic functions of the curry
        // args (par_value, asset_class, property_id, jurisdiction,
        // royalty_puzhash, royalty_bps), but until the smart-deed
        // puzzle bytecode is bundled into the portal we leave them
        // null — the dashboard renders "—" placeholders.
        smart_deed_inner_puzhash: null,
        eve_inner_puzhash: null,
        deed_full_puzhash: null,
        proposal_hash: null,
      },
      on_chain: {
        proposal_tracker_coin_id: null,
        pgt_lock_coin_id: null,
        deed_launcher_id: null,
        published_bundle_id: null,
        executed_bundle_id: null,
      },
      vote_tally: 0,
      quorum_required: req.quorum_required,
      deadline: null,
      timestamps: {
        created_at: now,
        published_at: null,
        executed_at: null,
        minted_at: null,
      },
      off_chain_metadata: req.off_chain_metadata ?? null,
    };
    const all = this.loadAll();
    all[id] = proposal;
    this.persist(all);
    return proposal;
  }

  /**
   * List drafts visible to a given owner.  Pass ``null`` for
   * ``ownerPubkey`` to list every draft in storage (admin debug
   * use; the dashboard always passes the active subject).
   *
   * Cancelled drafts are included so the dashboard's "show
   * cancelled" toggle works; callers should filter by state if they
   * want only active drafts.  Sorted by ``timestamps.created_at``
   * descending (newest first).
   */
  list(ownerPubkey: string | null): MintProposalResponse[] {
    const all = this.loadAll();
    const records = Object.values(all);
    const filtered =
      ownerPubkey === null
        ? records
        : records.filter(
            (r) =>
              r.owner_pubkey.toLowerCase() === ownerPubkey.toLowerCase(),
          );
    return filtered.sort(
      (a, b) => b.timestamps.created_at - a.timestamps.created_at,
    );
  }

  /** Look up a single draft by id; returns null if not in storage. */
  get(id: string): MintProposalResponse | null {
    const all = this.loadAll();
    return all[id] ?? null;
  }

  /**
   * Mark a draft as ``CANCELED``.  Only ``DRAFT``-state proposals
   * can be cancelled this way (matches the API's
   * ``cancel_eligibility`` rule).  Returns the updated record, or
   * null when the id isn't in storage.  Throws when the proposal
   * is past DRAFT (already on chain — operator must spend the
   * tracker coin to mark it cancelled, not just edit localStorage).
   */
  cancel(id: string): MintProposalResponse | null {
    const all = this.loadAll();
    const existing = all[id];
    if (!existing) return null;
    if (existing.state !== 'DRAFT') {
      throw new Error(
        `Proposal ${id} is in state ${existing.state}; only DRAFT proposals ` +
          'can be cancelled via the local storage path.  Published proposals ' +
          'must be cancelled by spending their tracker coin on chain.',
      );
    }
    const updated: MintProposalResponse = { ...existing, state: 'CANCELED' };
    all[id] = updated;
    this.persist(all);
    return updated;
  }

  /**
   * Permanently delete a draft.  Distinct from cancel — used to
   * remove abandoned drafts that the admin doesn't want to keep
   * for audit.  Returns true if a record was removed.
   */
  delete(id: string): boolean {
    const all = this.loadAll();
    if (!(id in all)) return false;
    delete all[id];
    this.persist(all);
    return true;
  }

  /**
   * Reset every draft for testing / admin debug.  Not exposed in
   * the UI today; kept here so the unit-test suite can run with a
   * predictable starting state.
   */
  clearAll(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  }

  // ── Private storage I/O ───────────────────────────────────────────────
  private loadAll(): Record<string, MintProposalResponse> {
    if (typeof window === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, MintProposalResponse>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      // Corrupt storage — surface as empty so callers don't crash.
      // The next persist() rewrites it to a valid JSON object.
      localStorage.removeItem(STORAGE_KEY);
      return {};
    }
  }

  private persist(all: Record<string, MintProposalResponse>): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }
}

/**
 * Generate a draft id.  Uses ``crypto.randomUUID`` when available
 * (every modern browser + Node 14.17+) and falls back to a
 * timestamp-derived string for older environments — both are
 * collision-safe within a single browser profile (the only scope
 * that matters for localStorage).
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
