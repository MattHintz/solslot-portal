import { Injectable, inject } from '@angular/core';
import { CoinsetService, CoinRecord } from './coinset.service';
import { coinId, vaultDiscoveryHint, hexToBytes, AUTH_TYPE_SECP256K1, AUTH_TYPE_BLS } from '../utils/chia-hash';

/**
 * Pure on-chain vault discovery.
 *
 * Given a user's pubkey + auth type, walks chain to find their existing
 * vault singleton without consulting the backend at all.  This is the core
 * of Solslot's "create-once, never-touch-the-backend-again" login flow.
 *
 * Algorithm:
 *
 *   1. Compute hint = sha256("solslot-vault-discovery-v2" || authType || pubkey)
 *      Same formula the faucet used at registration time
 *      (see solslot_puzzles/vault_driver.py:vault_discovery_hint).
 *
 *   2. Query coinset.org `get_coin_records_by_hint(hint, includeSpent=true)`.
 *      Returns the launcher coin (always spent — its spend created the eve
 *      singleton).
 *
 *   3. From the launcher, find its child via `get_coin_records_by_parent_ids`.
 *      The child is the eve singleton.
 *
 *   4. Walk forward: for each coin, find its (single) child until we hit
 *      an unspent coin — that's the current vault state.
 *
 * If step 2 returns nothing, the user has no vault yet and the caller
 * should route to /create-vault.
 */
@Injectable({ providedIn: 'root' })
export class VaultDiscoveryService {
  private readonly coinset = inject(CoinsetService);

  /**
   * Look up an EVM-vault by the user's compressed secp256k1 pubkey.
   *
   * Returns the discovered vault state, or `null` if no launcher exists
   * for this pubkey on chain.
   */
  async discoverEvmVault(compressedPubkey: string): Promise<DiscoveredVault | null> {
    return this.discover(AUTH_TYPE_SECP256K1, compressedPubkey);
  }

  /**
   * Look up a BLS-vault by the user's 48-byte G1 pubkey.
   */
  async discoverChiaVault(blsPubkey: string): Promise<DiscoveredVault | null> {
    return this.discover(AUTH_TYPE_BLS, blsPubkey);
  }

  private async discover(
    authType: number,
    pubkeyHex: string
  ): Promise<DiscoveredVault | null> {
    const pubkeyBytes = hexToBytes(pubkeyHex);
    const hint = vaultDiscoveryHint(authType, pubkeyBytes);

    // Step 1: find the launcher by its hint.
    const candidates = await this.coinset.getCoinRecordsByHint(hint, /* includeSpent */ true);
    if (candidates.length === 0) {
      return null;
    }

    // Filter to only launcher coins (puzzle hash = SINGLETON_LAUNCHER_HASH).
    // The CHIP-22 hint is sha256-collision-resistant, so in practice this
    // returns either 0 or 1 launcher.  If a user re-registered, multiple
    // launchers could share the same hint — pick the most recent that has
    // a confirmed vault descendant.
    const SINGLETON_LAUNCHER_HASH = '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';
    const launchers = candidates.filter(
      (c) => normalizeHex(c.coin.puzzle_hash) === SINGLETON_LAUNCHER_HASH
    );
    if (launchers.length === 0) {
      return null;
    }

    // Pick the most recent launcher (highest confirmed_block_index).
    launchers.sort((a, b) => b.confirmed_block_index - a.confirmed_block_index);

    // Try each launcher in order until we find one whose chain walks to an
    // unspent coin (the live vault).  Older launchers may have been
    // superseded if the user registered multiple times.
    for (const launcher of launchers) {
      const vault = await this.walkSingletonChain(launcher);
      if (vault) {
        return vault;
      }
    }
    return null;
  }

  /**
   * Walk forward from a known launcher id to find its current state coin.
   *
   * Used by SessionService.refreshVault() to refresh vault state without
   * needing the pubkey or backend — given just the launcher id, we can
   * always re-derive the live coin from chain.
   */
  async refreshFromLauncherId(launcherId: string): Promise<DiscoveredVault | null> {
    const launcher = await this.coinset.getCoinRecordByName(launcherId);
    if (!launcher) {
      return null;
    }
    return this.walkSingletonChain(launcher);
  }

  /**
   * Walk a singleton chain from launcher → eve → state₁ → … → currentState.
   *
   * Each singleton spend creates exactly one child (singletons conserve),
   * so this is a deterministic linear walk: at each level, query
   * get_coin_records_by_parent_ids and recurse on the (single) child.
   *
   * Returns null if the launcher has no child yet (registration is still
   * in mempool, not confirmed) — the caller should treat this as "vault
   * not yet ready" rather than "vault doesn't exist".
   */
  private async walkSingletonChain(launcher: CoinRecord): Promise<DiscoveredVault | null> {
    const launcherCoinId = coinId(
      launcher.coin.parent_coin_info,
      launcher.coin.puzzle_hash,
      launcher.coin.amount
    );

    let current = launcher;
    let currentId = launcherCoinId;
    let depth = 0;
    const MAX_DEPTH = 10000; // safety bound; vaults shouldn't have this many spends

    while (depth < MAX_DEPTH) {
      const children = await this.coinset.getCoinRecordsByParentIds(
        [currentId],
        /* includeSpent */ true
      );
      if (children.length === 0) {
        // Unspent leaf reached — but the launcher itself can't be the leaf
        // (it must be spent for any vault to exist).  If depth=0 here, the
        // launcher hasn't been spent yet.
        if (depth === 0) {
          return null;
        }
        // Otherwise current is the live vault.
        return this.toDiscoveredVault(current, currentId, launcher, launcherCoinId);
      }

      const child = children[0];
      const childId = coinId(
        child.coin.parent_coin_info,
        child.coin.puzzle_hash,
        child.coin.amount
      );
      if (child.spent_block_index === 0 || child.spent_block_index === null) {
        // Child is unspent — this is the current state coin.
        return this.toDiscoveredVault(child, childId, launcher, launcherCoinId);
      }
      current = child;
      currentId = childId;
      depth++;
    }
    throw new Error(`Singleton chain walk exceeded MAX_DEPTH (${MAX_DEPTH})`);
  }

  private toDiscoveredVault(
    coin: CoinRecord,
    coinIdHex: string,
    launcher: CoinRecord,
    launcherIdHex: string
  ): DiscoveredVault {
    return {
      vaultLauncherId: launcherIdHex,
      vaultFullPuzhash: normalizeHex(coin.coin.puzzle_hash),
      currentCoinId: coinIdHex,
      confirmed: true,
      confirmedBlockIndex: coin.confirmed_block_index,
      launcherConfirmedBlockIndex: launcher.confirmed_block_index,
    };
  }
}

export interface DiscoveredVault {
  /** The vault's permanent on-chain identity (launcher coin id). */
  vaultLauncherId: string;
  /** The current state coin's puzzle hash (changes after each vault spend). */
  vaultFullPuzhash: string;
  /** The current unspent state coin id — what subsequent spends consume. */
  currentCoinId: string;
  /** True iff a confirmed unspent state coin was found. */
  confirmed: boolean;
  /** Block index at which the current state was confirmed. */
  confirmedBlockIndex: number;
  /** Block index at which the launcher itself was confirmed. */
  launcherConfirmedBlockIndex: number;
}

function normalizeHex(s: string): string {
  return s.startsWith('0x') ? s.toLowerCase() : '0x' + s.toLowerCase();
}
