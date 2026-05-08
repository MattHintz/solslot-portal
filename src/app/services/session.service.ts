import { Injectable, inject, signal, effect } from '@angular/core';
import { VaultState } from './populis-api.service';
import { VaultDiscoveryService } from './vault-discovery.service';

const STORAGE_KEY = 'populis_session_v1';

/**
 * Persists the user's last-known vault binding across page reloads.
 *
 * We store only public data (launcher id + address) — signatures are never
 * retained.  On refresh, we walk chain via {@link VaultDiscoveryService}
 * to recover the live state coin; the Populis API is no longer consulted
 * (Phase 9-Hermes-D follow-up: only coinset + the faucet remain as
 * backend dependencies, and the faucet is funding-only).
 *
 * **Migration note.** Prior to the Hermes-D API-removal pass, this
 * service consulted ``PopulisApiService.getVaultState`` to enrich the
 * synthesized state with XCH balance + deed-list aggregation.  Today
 * those fields are returned as zeros / empty arrays; chain-aware
 * enrichment (querying coinset.org for unspent coins under
 * ``p2_vault_puzhash`` and walking the property-registry singleton
 * for held deeds) lands in a follow-up commit.  See ``vault-state``
 * TODOs below.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly discovery = inject(VaultDiscoveryService);

  readonly session = signal<PersistedSession | null>(this.load());
  readonly vault = signal<VaultState | null>(null);

  constructor() {
    // Persist any updates to localStorage.
    effect(() => {
      const s = this.session();
      if (typeof window === 'undefined') return;
      if (s) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    });
  }

  private load(): PersistedSession | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PersistedSession;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  setEvmSession(address: string, vaultLauncherId: string, compressedPubkey?: string): void {
    this.session.set({
      authType: 'evm',
      address,
      vaultLauncherId,
      compressedPubkey,
      createdAt: Date.now(),
    });
  }

  setChiaSession(pubkey: string, vaultLauncherId: string): void {
    this.session.set({
      authType: 'chia_bls',
      address: pubkey,
      vaultLauncherId,
      compressedPubkey: pubkey,  // BLS: address IS the pubkey
      createdAt: Date.now(),
    });
  }

  clear(): void {
    this.session.set(null);
    this.vault.set(null);
  }

  /**
   * Refresh vault state from chain alone.
   *
   * Walks the singleton lineage forward from the launcher id to locate
   * the live state coin via {@link VaultDiscoveryService}.  Returns
   * ``null`` if the launcher is not on chain (i.e. registration is still
   * in mempool or the launcher id is wrong).
   *
   * **Migration note (Phase 9-Hermes-D follow-up).**  The previous
   * implementation also called ``PopulisApiService.getVaultState`` to
   * enrich the chain-only state with XCH balance + deed list.  That
   * dependency has been removed; the synthesized state now ships with
   * zeroed ``balance.xch_mojos`` and empty ``balance.deeds`` until the
   * chain-aware enrichment lands (TODO):
   *
   *   * **XCH balance** — query
   *     ``CoinsetService.getCoinRecordsByPuzzleHash(p2VaultPuzhash)``
   *     and sum the ``amount`` fields of unspent records.
   *   * **Deeds list** — walk the property-registry singleton lineage
   *     to enumerate deed launchers, filter to those whose current
   *     state coin's puzzle hash equals ``p2VaultPuzhash``.
   *   * **p2_vault_puzhash** — derive client-side via a TS port of
   *     ``populis_protocol.populis_puzzles.vault_driver.puzzle_for_p2_vault``
   *     (same currying pattern AdminAuthorityV2Service uses).
   */
  async refreshVault(): Promise<VaultState | null> {
    const s = this.session();
    if (!s?.vaultLauncherId) return null;

    const onChain = await this.discovery.refreshFromLauncherId(s.vaultLauncherId);
    if (!onChain) {
      // Launcher not on chain (registration mempool-only, or wrong id).
      return null;
    }

    const synthesized: VaultState = {
      vault_launcher_id: onChain.vaultLauncherId,
      vault_full_puzhash: onChain.vaultFullPuzhash,
      // TODO(Phase 9-Hermes-D follow-up): derive client-side via TS port
      // of ``puzzle_for_p2_vault`` (curry of p2_vault.clsp with launcher id).
      p2_vault_puzhash: '',
      auth_type: s.authType,
      owner_address: s.authType === 'evm' ? s.address : null,
      owner_pubkey: s.compressedPubkey ?? '',
      confirmed: onChain.confirmed,
      confirmed_block_index: onChain.confirmedBlockIndex,
      current_coin_id: onChain.currentCoinId,
      // TODO(Phase 9-Hermes-D follow-up): chain-aware balance + deed
      // enrichment via coinset queries (see class-level docstring).
      balance: { xch_mojos: 0, deeds: [] },
    };
    this.vault.set(synthesized);
    return synthesized;
  }
}

export interface PersistedSession {
  authType: 'evm' | 'chia_bls' | 'passkey';
  /** For EVM: checksummed 0x-prefixed address.  For Chia: hex pubkey. */
  address: string;
  vaultLauncherId: string;
  /**
   * Compressed secp256k1 pubkey (33 bytes hex) recovered from the EIP-712
   * signature, or BLS G1 pubkey (48 bytes hex).  Used for chain-only
   * vault discovery via `vaultDiscoveryHint(authType, pubkey)` without
   * touching the backend.
   *
   * Optional for backwards compat with sessions written before chain
   * discovery shipped.
   */
  compressedPubkey?: string;
  createdAt: number;
}
