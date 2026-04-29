import { Injectable, inject, signal, effect } from '@angular/core';
import { PopulisApiService, VaultState } from './populis-api.service';
import { VaultDiscoveryService } from './vault-discovery.service';

const STORAGE_KEY = 'populis_session_v1';

/**
 * Persists the user's last-known vault binding across page reloads.
 *
 * We store only public data (launcher id + address) — signatures are never
 * retained.  On refresh, we try chain discovery first (no backend needed),
 * falling back to the backend only for richer data (balance/deeds aggregation).
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(PopulisApiService);
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
   * Refresh vault state — chain-first, backend-fallback.
   *
   * Strategy:
   *   1. Walk chain from the launcher id to find the current state coin.
   *      This is the source of truth and works even if the backend is down.
   *   2. Try to enrich with backend data (balance, deeds) — but if the
   *      backend doesn't know this launcher (e.g. its in-memory registry
   *      was wiped on restart), keep the chain-only minimal state.
   */
  async refreshVault(): Promise<VaultState | null> {
    const s = this.session();
    if (!s?.vaultLauncherId) return null;

    // Step 1: chain-only walk for the live state coin.
    const onChain = await this.discovery.refreshFromLauncherId(s.vaultLauncherId);

    // Step 2: try the backend for richer data; fall back to chain-only on 404.
    let backendState: VaultState | null = null;
    try {
      backendState = await this.api.getVaultState(s.vaultLauncherId);
    } catch (e: unknown) {
      const msg = (e as { status?: number; message?: string })?.message ?? '';
      const status = (e as { status?: number })?.status;
      if (status !== 404 && !msg.includes('404')) {
        throw e;
      }
      // 404 is expected when the backend's in-memory registry doesn't know
      // this vault (chain-discovered vaults, or after a backend restart).
    }

    if (backendState) {
      // Backend knows the vault — prefer its enriched view (balance, deeds).
      // But if chain reports a newer state coin, prefer the chain's coin id.
      if (onChain && onChain.currentCoinId !== backendState.current_coin_id) {
        backendState = { ...backendState, current_coin_id: onChain.currentCoinId };
      }
      this.vault.set(backendState);
      return backendState;
    }

    if (onChain) {
      // Chain-only fallback: synthesize a minimal VaultState.  Balance and
      // deeds are zero — surfacing them would require additional chain
      // queries (p2_vault holdings) which can be added later.
      const synthesized: VaultState = {
        vault_launcher_id: onChain.vaultLauncherId,
        vault_full_puzhash: onChain.vaultFullPuzhash,
        p2_vault_puzhash: '',  // TODO: derive client-side from launcher id
        auth_type: s.authType,
        owner_address: s.authType === 'evm' ? s.address : null,
        owner_pubkey: s.compressedPubkey ?? '',
        confirmed: onChain.confirmed,
        confirmed_block_index: onChain.confirmedBlockIndex,
        current_coin_id: onChain.currentCoinId,
        balance: { xch_mojos: 0, deeds: [] },
      };
      this.vault.set(synthesized);
      return synthesized;
    }

    // Neither backend nor chain know about this launcher — vault doesn't exist.
    return null;
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
