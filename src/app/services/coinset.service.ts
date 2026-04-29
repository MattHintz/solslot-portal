import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Direct read-only client for coinset.org's Chia full-node RPC.
 *
 * Writes (push_tx) are routed through the Populis API instead — we want a
 * single place to retry / backoff / log broadcasts, and browsers shouldn't
 * exhaust coinset.org's public rate limit with every user click.
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
