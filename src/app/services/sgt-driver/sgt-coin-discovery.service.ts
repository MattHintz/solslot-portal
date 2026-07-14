import { Injectable, inject } from '@angular/core';

import { CoinRecord, CoinsetService } from '../coinset.service';
import { bytesToHex } from '../../utils/chia-hash';
import { environment } from '../../../environments/environment';
import { SgtDriverService } from './sgt-driver.service';

/**
 * Discover the connected voter's free SGT (CAT2) coins by querying
 * coinset.org for every unspent coin at the canonical
 * ``cat_sgt_free_puzzle_hash(voter_inner_puzzle_hash)``.
 *
 * **Where the inputs come from.**
 *
 *   * ``voterInnerPuzzleHash`` is the user's standard p2 puzzle hash
 *     derived from their connected Chia wallet pubkey
 *     (via ``ChiaWalletService.standardPuzzleHash`` or equivalent).
 *   * The SGT TAIL hash is derived from
 *     ``environment.solslotProtocol.sgtGenesisCoinId`` — the unique
 *     XCH coin id that bootstrapped SGT into circulation.  When this is
 *     empty (SGT not yet issued) we surface
 *     ``DiscoveryResult.kind === 'sgt-not-deployed'`` so the committee
 *     page can render a meaningful placeholder.
 *   * The tracker struct hash is derived from
 *     ``environment.solslotProtocol.governanceLauncherId``.  When that's
 *     empty we surface ``'governance-not-deployed'``.
 *
 * **What it returns.**
 *
 *   * ``DiscoveryResult.kind === 'found'`` with a non-empty list of
 *     {@link SgtCoin} — every unspent free SGT coin owned by the voter,
 *     sorted by amount descending (largest first, easier to pick a
 *     coin that covers a vote without splitting).  ``totalMojos``
 *     summarises the holdings.
 *   * ``DiscoveryResult.kind === 'no-coins'`` when discovery succeeded
 *     but the voter holds no free SGT (could be locked, transferred, or
 *     just not issued any).
 *   * ``DiscoveryResult.kind === 'sgt-not-deployed' |
 *     'governance-not-deployed'`` when one of the env coordinates is
 *     missing.
 *
 * **What this service does NOT do.**
 *
 *   * Derive the voter's inner puzzle hash itself.  Callers pass it in
 *     so the same service can serve standard-p2, p2_delegated, or any
 *     other inner topology the wallet exposes.
 *   * Cache results.  Each call hits coinset.org; the committee page
 *     debounces user actions and refreshes manually.
 */
@Injectable({ providedIn: 'root' })
export class SgtCoinDiscoveryService {
  private readonly coinset = inject(CoinsetService);
  private readonly sgt = inject(SgtDriverService);

  /**
   * Discover the voter's free SGT coins.  Returns a discriminated-union
   * {@link DiscoveryResult} that the committee page can render directly.
   */
  async discover(args: DiscoverArgs): Promise<DiscoveryResult> {
    const genesisCoinId =
      args.sgtGenesisCoinId ??
      environment.solslotProtocol.sgtGenesisCoinId;
    if (!genesisCoinId) {
      return { kind: 'sgt-not-deployed' };
    }
    const trackerLauncherId =
      args.trackerLauncherId ??
      environment.solslotProtocol.governanceLauncherId;
    if (!trackerLauncherId) {
      return { kind: 'governance-not-deployed' };
    }

    const trackerStructHash = this.sgt.trackerStructHash({ trackerLauncherId });
    const sgtTailHash = this.sgt.sgtTailHash(genesisCoinId);
    const sgtFreeInnerHash = this.sgt.sgtFreeInnerHash({
      trackerStructHash,
      voterInnerPuzzleHash: args.voterInnerPuzzleHash,
    });
    const catSgtFreePuzzleHash = this.sgt.catSgtFreePuzzleHash({
      sgtFreeInnerHash,
      sgtTailHash,
    });
    const catSgtFreePuzzleHashHex = bytesToHex(catSgtFreePuzzleHash);

    const records = await this.coinset.getCoinRecordsByPuzzleHash(
      catSgtFreePuzzleHashHex,
      false, // unspent only
    );
    const unspent = records.filter((r) => !r.spent_block_index);
    if (unspent.length === 0) {
      return {
        kind: 'no-coins',
        catSgtFreePuzzleHash: catSgtFreePuzzleHashHex,
      };
    }

    const coins: SgtCoin[] = unspent
      .map((r) => this.toSgtCoin(r))
      .sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));
    const totalMojos = coins.reduce(
      (acc, c) => acc + BigInt(c.amount),
      BigInt(0),
    );
    return {
      kind: 'found',
      catSgtFreePuzzleHash: catSgtFreePuzzleHashHex,
      coins,
      totalMojos,
    };
  }

  /** Convenience: derive the CAT-wrapped SGT free puzzle hash for a voter. */
  catSgtFreePuzzleHashHex(args: {
    voterInnerPuzzleHash: string;
    trackerLauncherId?: string;
    sgtGenesisCoinId?: string;
  }): string | null {
    const genesisCoinId =
      args.sgtGenesisCoinId ??
      environment.solslotProtocol.sgtGenesisCoinId;
    if (!genesisCoinId) return null;
    const trackerLauncherId =
      args.trackerLauncherId ??
      environment.solslotProtocol.governanceLauncherId;
    if (!trackerLauncherId) return null;
    const trackerStructHash = this.sgt.trackerStructHash({ trackerLauncherId });
    const sgtTailHash = this.sgt.sgtTailHash(genesisCoinId);
    const sgtFreeInnerHash = this.sgt.sgtFreeInnerHash({
      trackerStructHash,
      voterInnerPuzzleHash: args.voterInnerPuzzleHash,
    });
    return bytesToHex(
      this.sgt.catSgtFreePuzzleHash({ sgtFreeInnerHash, sgtTailHash }),
    );
  }

  private toSgtCoin(record: CoinRecord): SgtCoin {
    return {
      parentCoinInfo: record.coin.parent_coin_info,
      puzzleHash: record.coin.puzzle_hash,
      amount: record.coin.amount,
      confirmedBlockIndex: record.confirmed_block_index,
    };
  }
}

// ───────────────────────────────────────────────────────────────────────
//  Public shapes
// ───────────────────────────────────────────────────────────────────────

export interface DiscoverArgs {
  /** Voter's inner puzzle hash (0x-hex).  Derived from connected wallet pubkey. */
  voterInnerPuzzleHash: string;
  /** Override the configured SGT TAIL genesis coin id (testing only). */
  sgtGenesisCoinId?: string;
  /** Override the configured governance tracker launcher id (testing only). */
  trackerLauncherId?: string;
}

export interface SgtCoin {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: number;
  confirmedBlockIndex: number;
}

export type DiscoveryResult =
  | { kind: 'sgt-not-deployed' }
  | { kind: 'governance-not-deployed' }
  | { kind: 'no-coins'; catSgtFreePuzzleHash: string }
  | {
      kind: 'found';
      catSgtFreePuzzleHash: string;
      coins: SgtCoin[];
      totalMojos: bigint;
    };
