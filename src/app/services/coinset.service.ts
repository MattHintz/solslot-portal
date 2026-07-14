import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { mojoAmountToSafeNumber } from '../utils/mojo-amount';

/**
 * Direct read/write client for coinset.org's Chia full-node RPC.
 *
 * Reads (lineage walks, coin lookups) are the daily-driver use case.
 *
 * Writes (``push_tx``) were originally routed through the Solslot API,
 * but that creates a censorship vector for trust-minimised flows like
 * the v2 admin-authority lifecycle (Phase 9-Hermes-D).  Solslot's
 * frontend (research/solslot-frontend/slui/src/app/services/chia-aggregator.service.ts)
 * proves direct browser → coinset push works in production; we adopt
 * the same pattern for v2 launches + rotations so admins can submit
 * spend bundles even when Solslot is offline or compromised.
 *
 * For non-trust-critical writes (vault registration, mint proposals)
 * the API path is still preferred for rate-limit + audit-log
 * convenience.
 *
 * API docs: https://docs.coinset.org
 */
@Injectable({ providedIn: 'root' })
export class CoinsetService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.coinsetRpc;

  /**
   * Fetch a single coin record by its coin id.  Returns null when the coin
   * has not yet been confirmed by the network (i.e. the launch hasn't been
   * included in a block yet).
   */
  async getCoinRecordByName(coinId: string): Promise<CoinRecord | null> {
    const body = { name: normalizeHex(coinId) };
    const res = await firstValueFrom(
      this.http.post<{ coin_record: CoinRecord | null; success: boolean }>(
        `${this.base}/get_coin_record_by_name`,
        body
      )
    );
    return res.coin_record ?? null;
  }

  /**
   * List all unspent coins under a given puzzle hash.  Used to discover
   * the current state coin of a vault singleton (one unspent odd-amount
   * coin under the full singleton puzzle hash).
   */
  async getCoinRecordsByPuzzleHash(
    puzzleHash: string,
    includeSpent = false
  ): Promise<CoinRecord[]> {
    const body = {
      puzzle_hash: normalizeHex(puzzleHash),
      include_spent_coins: includeSpent,
    };
    const res = await firstValueFrom(
      this.http.post<{ coin_records: CoinRecord[]; success: boolean }>(
        `${this.base}/get_coin_records_by_puzzle_hash`,
        body
      )
    );
    return res.coin_records ?? [];
  }

  async getBlockchainState(): Promise<BlockchainState> {
    const res = await firstValueFrom(
      this.http.post<{ blockchain_state: BlockchainState; success: boolean }>(
        `${this.base}/get_blockchain_state`,
        {}
      )
    );
    return res.blockchain_state;
  }

  /**
   * Find every coin ever created with the given CHIP-22 hint.
   *
   * Used by VaultDiscoveryService to locate a user's vault launcher coin
   * from chain alone — no backend registry required.
   *
   * IMPORTANT: pass `includeSpent=true` for vault discovery; the launcher
   * coin is *always* spent (its spend created the eve singleton), so an
   * `includeSpent=false` query would miss it entirely.
   */
  async getCoinRecordsByHint(
    hint: string,
    includeSpent = true
  ): Promise<CoinRecord[]> {
    const body = {
      hint: normalizeHex(hint),
      include_spent_coins: includeSpent,
    };
    const res = await firstValueFrom(
      this.http.post<{ coin_records: CoinRecord[]; success: boolean }>(
        `${this.base}/get_coin_records_by_hint`,
        body
      )
    );
    return res.coin_records ?? [];
  }

  /**
   * Find every coin ever created by the given parent coin id(s).
   *
   * Used to walk the singleton state chain forward: each singleton spend
   * creates exactly one child (singletons conserve), so iterating from the
   * launcher → eve → state₁ → … → currentState is a deterministic walk.
   */
  async getCoinRecordsByParentIds(
    parentIds: string[],
    includeSpent = true
  ): Promise<CoinRecord[]> {
    const body = {
      parent_ids: parentIds.map(normalizeHex),
      include_spent_coins: includeSpent,
    };
    const res = await firstValueFrom(
      this.http.post<{ coin_records: CoinRecord[]; success: boolean }>(
        `${this.base}/get_coin_records_by_parent_ids`,
        body
      )
    );
    return res.coin_records ?? [];
  }

  /**
   * Fetch the puzzle reveal + solution that consumed a previously-spent
   * coin.  Used by ChiaSingletonReaderService to replay the most recent
   * state transition of an on-chain singleton.
   *
   * The block height parameter is required by coinset.org's RPC because
   * spend records are indexed by the consuming block, not by coin id;
   * callers obtain it from `coin_record.spent_block_index`.
   *
   * Returns null on 404 or if the coin has not actually been spent (the
   * common cause is passing the wrong height).
   */
  async getPuzzleAndSolution(
    coinId: string,
    height: number,
  ): Promise<PuzzleAndSolution | null> {
    const body = {
      coin_id: normalizeHex(coinId),
      height,
    };
    const res = await firstValueFrom(
      this.http.post<{
        coin_solution: PuzzleAndSolutionRaw | null;
        success: boolean;
      }>(`${this.base}/get_puzzle_and_solution`, body)
    );
    const cs = res.coin_solution;
    if (!cs) return null;
    return {
      coin: cs.coin,
      puzzleReveal: normalizeHex(cs.puzzle_reveal),
      solution: normalizeHex(cs.solution),
    };
  }

  /**
   * Broadcast a signed spend bundle directly to coinset.org.
   *
   * This is the trust-minimised submission path for the v2 admin-authority
   * lifecycle: launches + rotations don't depend on the Solslot API
   * being reachable.  Mirrors solslot's
   * ``ChiaAggregatorService.pushTransaction`` pattern.
   *
   * **Wire format.** coinset.org's ``/push_tx`` accepts:
   * ```json
   * {
   *   "spend_bundle": {
   *     "coin_spends": [{ coin, puzzle_reveal, solution }, ...],
   *     "aggregated_signature": "0x..."
   *   }
   * }
   * ```
   *
   * **Response shape.** ``{ success, status?, error? }`` where
   * ``status`` is one of ``SUCCESS``, ``PENDING``, ``FAILED``.  Note
   * that ``success: true`` only means the node *accepted* the bundle
   * — it doesn't guarantee mempool inclusion.  Callers monitoring
   * for confirmation should poll ``getCoinRecordByName`` on a
   * resulting coin id.
   *
   * @param spendBundle The signed bundle (coin spends + aggregated sig).
   * @returns The node's response.  ``success: false`` is surfaced as a
   *   thrown error so the caller doesn't accidentally treat a rejected
   *   submission as accepted.
   */
  async pushTransaction(spendBundle: PushTxSpendBundle): Promise<PushTxResponse> {
    // Wire format: snake_case fields + ``0x``-prefixed hex on every
    // bytes field.  coinset.org's full-node proxy validates with a
    // strict ``bytes32.from_hexstr(..., assert_prefix=True)`` check
    // that rejects bare hex with "bytes object is expected to start
    // with 0x".  Matches solslot's wire format in
    // ``research/solslot-frontend/slui/src/app/services/chia-wallet.service.ts:2937``.
    const wireBundle = {
      coin_spends: spendBundle.coinSpends.map((cs) => ({
        coin: {
          parent_coin_info: normalizeHex(cs.coin.parentCoinInfo),
          puzzle_hash: normalizeHex(cs.coin.puzzleHash),
          amount: mojoAmountToSafeNumber(cs.coin.amount, 'coin amount'),
        },
        puzzle_reveal: normalizeHex(cs.puzzleReveal),
        solution: normalizeHex(cs.solution),
      })),
      aggregated_signature: normalizeHex(spendBundle.aggregatedSignature),
    };
    const body = { spend_bundle: wireBundle };

    let res: PushTxResponseRaw;
    try {
      res = await firstValueFrom(
        this.http.post<PushTxResponseRaw>(`${this.base}/push_tx`, body),
      );
    } catch (err) {
      // coinset.org returns its rejection reasons in the HTTP body
      // even on 4xx responses — Angular's HttpClient buries those
      // in ``HttpErrorResponse.error``.  Surface the body verbatim
      // (incl. the bundle we sent) so operators can diagnose without
      // diving into network tab.
      if (err instanceof HttpErrorResponse) {
        const node = extractCoinsetError(err.error);
        const detail =
          node ?? (typeof err.error === 'string' ? err.error : err.message);
        // Echo the failed bundle to the console so operators can
        // pipe it into ``chia rpc full_node push_tx`` for offline
        // debugging.  Don't include this in the thrown message —
        // bundles are huge — but a single console.error is harmless.
        console.error('[CoinsetService] push_tx rejected with status', err.status, {
          coinsetError: detail,
          bundle: wireBundle,
        });
        throw new Error(
          `pushTransaction rejected (HTTP ${err.status}): ${detail}`,
        );
      }
      throw err;
    }

    if (!res.success) {
      // coinset.org returns a structured error here — surface it
      // verbatim so operators can debug bundle issues offline.
      throw new Error(
        `pushTransaction rejected: ${res.error ?? res.status ?? 'unknown'}`,
      );
    }

    return {
      success: true,
      status: res.status ?? null,
    };
  }
}

/**
 * Decoded `coin_solution` field returned by coinset.org's
 * `/get_puzzle_and_solution`.  The wire format uses snake_case;
 * we normalise to camelCase + drop the 0x prefix-sensitivity inside
 * the service before exposing to callers.
 */
export interface PuzzleAndSolution {
  coin: { parent_coin_info: string; puzzle_hash: string; amount: number };
  /** Hex-encoded serialized CLVM Program (the puzzle that ran). */
  puzzleReveal: string;
  /** Hex-encoded serialized CLVM Program (the solution it ran with). */
  solution: string;
}

interface PuzzleAndSolutionRaw {
  coin: { parent_coin_info: string; puzzle_hash: string; amount: number };
  puzzle_reveal: string;
  solution: string;
}

export interface CoinRecord {
  coin: {
    parent_coin_info: string;
    puzzle_hash: string;
    amount: number;
  };
  confirmed_block_index: number;
  spent_block_index: number;
  coinbase: boolean;
  timestamp: number;
}

export interface BlockchainState {
  peak: { height: number; timestamp: number } | null;
  sync: { synced: boolean; sync_mode: boolean; sync_progress_height?: number };
  network_name: string;
}

function normalizeHex(s: string): string {
  return s.startsWith('0x') ? s : '0x' + s;
}

function stripHexPrefix(s: string): string {
  return s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
}

/**
 * Coinset.org wraps its full-node rejection messages in slightly
 * different shapes depending on the endpoint — sometimes
 * ``{ error: "..." }``, sometimes ``{ message: "..." }``,
 * sometimes the raw full-node error like ``{ status: "FAILED",
 * error: "ASSERT_..." }``.  Walk the most common keys and fall back
 * to the JSON dump.
 */
function extractCoinsetError(body: unknown): string | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const candidates = [
      obj['error'],
      obj['message'],
      obj['detail'],
      obj['reason'],
      obj['status'],
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
    try {
      return JSON.stringify(obj);
    } catch {
      return null;
    }
  }
  return String(body);
}

/**
 * Spend bundle ready to submit to ``/push_tx``.  Identical shape to
 * the ``SignedSpendBundle`` produced by ``ChiaWalletService.signSpendBundle``,
 * but defined here independently so coinset.service.ts has no
 * cross-service runtime dependency.
 */
export interface PushTxSpendBundle {
  coinSpends: ReadonlyArray<{
    coin: {
      parentCoinInfo: string;
      puzzleHash: string;
      amount: number | bigint;
    };
    /** Hex-encoded CLVM puzzle reveal (with or without 0x prefix). */
    puzzleReveal: string;
    /** Hex-encoded CLVM solution (with or without 0x prefix). */
    solution: string;
  }>;
  /** 0x-prefixed (or bare) 96-byte BLS aggregated signature. */
  aggregatedSignature: string;
}

/** Normalised response from ``/push_tx``.  ``success: false`` is
 * surfaced as a thrown error from ``pushTransaction``. */
export interface PushTxResponse {
  success: true;
  /** ``SUCCESS`` (mempool-accepted), ``PENDING`` (waiting on resources),
   * or null when the node didn't surface a status field. */
  status: string | null;
}

/** Raw wire shape of coinset.org's ``/push_tx`` reply. */
interface PushTxResponseRaw {
  success: boolean;
  status?: string;
  error?: string;
}
