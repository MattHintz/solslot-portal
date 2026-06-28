import { Injectable, inject } from '@angular/core';

import { CoinRecord, CoinsetService } from '../coinset.service';
import { bytesToHex } from '../../utils/chia-hash';
import { environment } from '../../../environments/environment';
import { PgtDriverService } from './pgt-driver.service';

/**
 * Discover the connected voter's free PGT (CAT2) coins by querying
 * coinset.org for every unspent coin at the canonical
 * ``cat_pgt_free_puzzle_hash(voter_inner_puzzle_hash)``.
 *
 * **Where the inputs come from.**
 *
 *   * ``voterInnerPuzzleHash`` is the user's standard p2 puzzle hash
 *     derived from their connected Chia wallet pubkey
 *     (via ``ChiaWalletService.standardPuzzleHash`` or equivalent).
 *   * The PGT TAIL hash is derived from
 *     ``environment.populisProtocol.pgtTailGenesisCoinId`` — the unique
 *     XCH coin id that bootstrapped PGT into circulation.  When this is
 *     empty (PGT not yet issued) we surface
 *     ``DiscoveryResult.kind === 'pgt-not-deployed'`` so the committee
 *     page can render a meaningful placeholder.
 *   * The tracker struct hash is derived from
 *     ``environment.populisProtocol.governanceLauncherId``.  When that's
 *     empty we surface ``'governance-not-deployed'``.
 *
 * **What it returns.**
 *
 *   * ``DiscoveryResult.kind === 'found'`` with a non-empty list of
 *     {@link PgtCoin} — every unspent free PGT coin owned by the voter,
 *     sorted by amount descending (largest first, easier to pick a
 *     coin that covers a vote without splitting).  ``totalMojos``
 *     summarises the holdings.
 *   * ``DiscoveryResult.kind === 'no-coins'`` when discovery succeeded
 *     but the voter holds no free PGT (could be locked, transferred, or
 *     just not issued any).
 *   * ``DiscoveryResult.kind === 'pgt-not-deployed' |
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
export class PgtCoinDiscoveryService {
  private readonly coinset = inject(CoinsetService);
  private readonly pgt = inject(PgtDriverService);

  /**
   * Discover the voter's free PGT coins.  Returns a discriminated-union
   * {@link DiscoveryResult} that the committee page can render directly.
   */
  async discover(args: DiscoverArgs): Promise<DiscoveryResult> {
    const genesisCoinId =
      args.pgtTailGenesisCoinId ??
      environment.populisProtocol.pgtTailGenesisCoinId;
    if (!genesisCoinId) {
      return { kind: 'pgt-not-deployed' };
    }
    const trackerLauncherId =
      args.trackerLauncherId ??
      environment.populisProtocol.governanceLauncherId;
    if (!trackerLauncherId) {
      return { kind: 'governance-not-deployed' };
    }

    const trackerStructHash = this.pgt.trackerStructHash({ trackerLauncherId });
    const pgtTailHash = this.pgt.pgtTailHash(genesisCoinId);
    const pgtFreeInnerHash = this.pgt.pgtFreeInnerHash({
      trackerStructHash,
      voterInnerPuzzleHash: args.voterInnerPuzzleHash,
    });
    const catPgtFreePuzzleHash = this.pgt.catPgtFreePuzzleHash({
      pgtFreeInnerHash,
      pgtTailHash,
    });
    const catPgtFreePuzzleHashHex = bytesToHex(catPgtFreePuzzleHash);

    const records = await this.coinset.getCoinRecordsByPuzzleHash(
      catPgtFreePuzzleHashHex,
      false, // unspent only
    );
    const unspent = records.filter((r) => !r.spent_block_index);
    if (unspent.length === 0) {
      return {
        kind: 'no-coins',
        catPgtFreePuzzleHash: catPgtFreePuzzleHashHex,
      };
    }

    const coins: PgtCoin[] = unspent
      .map((r) => this.toPgtCoin(r))
      .sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));
    const totalMojos = coins.reduce(
      (acc, c) => acc + BigInt(c.amount),
      BigInt(0),
    );
    return {
      kind: 'found',
      catPgtFreePuzzleHash: catPgtFreePuzzleHashHex,
      coins,
      totalMojos,
    };
  }

  /** Convenience: derive the CAT-wrapped PGT free puzzle hash for a voter. */
  catPgtFreePuzzleHashHex(args: {
    voterInnerPuzzleHash: string;
    trackerLauncherId?: string;
    pgtTailGenesisCoinId?: string;
  }): string | null {
    const genesisCoinId =
      args.pgtTailGenesisCoinId ??
      environment.populisProtocol.pgtTailGenesisCoinId;
    if (!genesisCoinId) return null;
    const trackerLauncherId =
      args.trackerLauncherId ??
      environment.populisProtocol.governanceLauncherId;
    if (!trackerLauncherId) return null;
    const trackerStructHash = this.pgt.trackerStructHash({ trackerLauncherId });
    const pgtTailHash = this.pgt.pgtTailHash(genesisCoinId);
    const pgtFreeInnerHash = this.pgt.pgtFreeInnerHash({
      trackerStructHash,
      voterInnerPuzzleHash: args.voterInnerPuzzleHash,
    });
    return bytesToHex(
      this.pgt.catPgtFreePuzzleHash({ pgtFreeInnerHash, pgtTailHash }),
    );
  }

  private toPgtCoin(record: CoinRecord): PgtCoin {
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
  /** Override the configured PGT TAIL genesis coin id (testing only). */
  pgtTailGenesisCoinId?: string;
  /** Override the configured governance tracker launcher id (testing only). */
  trackerLauncherId?: string;
}

export interface PgtCoin {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: number;
  confirmedBlockIndex: number;
}

export type DiscoveryResult =
  | { kind: 'pgt-not-deployed' }
  | { kind: 'governance-not-deployed' }
  | { kind: 'no-coins'; catPgtFreePuzzleHash: string }
  | {
      kind: 'found';
      catPgtFreePuzzleHash: string;
      coins: PgtCoin[];
      totalMojos: bigint;
    };
