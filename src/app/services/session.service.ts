import { Injectable, inject, signal, effect } from '@angular/core';
import { VaultState } from './solslot-api.service';
import { VaultDiscoveryService } from './vault-discovery.service';
import { ChiaWasmService } from './chia-wasm.service';
import { hexToBytes, bytesToHex } from '../utils/chia-hash';
import { P2_VAULT_PUZZLE_HEX } from './p2-vault.puzzle-hex';
import { environment } from '../../environments/environment';

const SINGLETON_MOD_HASH = '7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
const SINGLETON_LAUNCHER_HASH = 'eff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';

const STORAGE_KEY = 'solslot_session_v2';

/**
 * Persists the user's last-known vault binding across page reloads.
 *
 * We store only public data (launcher id + address) — signatures are never
 * retained.  On refresh, we walk chain via {@link VaultDiscoveryService}
 * to recover the live state coin; the Solslot API is no longer consulted
 * (Phase 9-Hermes-D follow-up: only coinset + the faucet remain as
 * backend dependencies, and the faucet is funding-only).
 *
 * **Migration note.** Prior to the Hermes-D API-removal pass, this
 * service consulted ``SolslotApiService.getVaultState`` to enrich the
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
  private readonly wasm = inject(ChiaWasmService);

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
      const parsed = JSON.parse(raw) as Partial<PersistedSession>;
      if (
        parsed.schemaVersion !== 2 ||
        parsed.protocolVersion !== environment.protocolVersion ||
        parsed.experienceMode !== 'testnet-alpha' ||
        parsed.network !== 'testnet11' ||
        !parsed.authType ||
        !parsed.address ||
        !parsed.vaultLauncherId ||
        typeof parsed.createdAt !== 'number'
      ) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed as PersistedSession;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  setEvmSession(address: string, vaultLauncherId: string, compressedPubkey?: string): void {
    this.session.set({
      schemaVersion: 2,
      protocolVersion: environment.protocolVersion,
      experienceMode: 'testnet-alpha',
      network: 'testnet11',
      authType: 'evm',
      address,
      vaultLauncherId,
      compressedPubkey,
      createdAt: Date.now(),
    });
  }

  setChiaSession(pubkey: string, vaultLauncherId: string): void {
    this.session.set({
      schemaVersion: 2,
      protocolVersion: environment.protocolVersion,
      experienceMode: 'testnet-alpha',
      network: 'testnet11',
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
   * Re-point the active session at a different vault launcher id, preserving
   * the owner identity (auth type / address / pubkey).  Used after a one-click
   * vault upgrade (Brick 6) swaps the user onto their freshly launched vault;
   * the stale vault state is cleared so the next refresh re-discovers the new
   * singleton from chain.
   */
  setVaultLauncherId(vaultLauncherId: string): void {
    const current = this.session();
    if (!current) {
      return;
    }
    this.session.set({ ...current, vaultLauncherId });
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
   * implementation also called ``SolslotApiService.getVaultState`` to
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
   *     ``solslot_protocol.solslot_puzzles.vault_driver.puzzle_for_p2_vault``
   *     (same currying pattern AdminAuthorityV2Service uses).
   */
  private deriveP2VaultPuzhash(vaultLauncherId: string): string {
    try {
      const sdk = this.wasm.sdk() as { Clvm: new () => { deserialize: (b: Uint8Array) => { curry: (args: unknown[]) => { treeHash: () => Uint8Array } }; atom: (b: Uint8Array) => unknown } };
      const clvm = new sdk.Clvm();
      const p2Mod = clvm.deserialize(hexToBytes(P2_VAULT_PUZZLE_HEX));
      const launcherId = hexToBytes(vaultLauncherId.replace(/^0x/, ''));
      const curried = p2Mod.curry([
        clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
        clvm.atom(launcherId),
        clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH)),
      ]);
      return '0x' + bytesToHex(curried.treeHash());
    } catch {
      return '';
    }
  }

  async refreshVault(): Promise<VaultState | null> {
    const s = this.session();
    if (!s?.vaultLauncherId) return null;

    const onChain = await this.discovery.refreshFromLauncherId(s.vaultLauncherId);
    if (!onChain) {
      // Launcher not on chain (registration mempool-only, or wrong id).
      return null;
    }

    const p2VaultPuzhash = this.deriveP2VaultPuzhash(s.vaultLauncherId);

    const synthesized: VaultState = {
      vault_launcher_id: onChain.vaultLauncherId,
      vault_full_puzhash: onChain.vaultFullPuzhash,
      p2_vault_puzhash: p2VaultPuzhash,
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
  schemaVersion: 2;
  protocolVersion: 'solslot-v2';
  experienceMode: 'testnet-alpha';
  network: 'testnet11';
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
   * Optional because not every supported wallet exposes a compressed key.
   */
  compressedPubkey?: string;
  createdAt: number;
}
