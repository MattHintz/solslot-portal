import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * HTTP client for the Populis faucet API — the single remaining
 * backend dependency after the Phase 9-Hermes-D API-removal pass.
 *
 * **Scope.**  This service handles *only* faucet-funded vault
 * registration, where the backend's role is to (a) issue an
 * EIP-712 challenge bound to a real chain id and faucet-controlled
 * domain, (b) sign a launcher coin spend out of the faucet's hot
 * wallet, and (c) broadcast it to coinset.  Without the faucet,
 * onboarding requires the user to fund their own launcher coin —
 * a non-starter for a public testnet onramp.
 *
 * **Out of scope.**  Admin auth (→ ``AdminWalletAuthService``),
 * mint proposal lifecycle (→ ``MintDraftStorageService``), trust
 * roots (→ ``OnChainStateService``), vault state reads (→
 * ``VaultDiscoveryService`` + ``ChiaSingletonReaderService``), and
 * arbitrary push_tx broadcasting (→ ``CoinsetService.pushTransaction``)
 * all moved to client-side WASM + direct coinset.org reads.
 *
 * The class name retains ``Populis`` (rather than the more accurate
 * ``Faucet``) to avoid a wider rename across the wizard
 * components; only the env field renamed to ``faucetApi``.
 */
@Injectable({ providedIn: 'root' })
export class PopulisApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.faucetApi;

  // NOTE: ``health()`` was removed in the Phase 9-Hermes-D follow-up.
  // The footer's chain-state pill now hits coinset.org's
  // ``get_blockchain_state`` directly (see ``FooterComponent``); we
  // don't need an API liveness probe because every API call site that
  // remains is faucet-related and surfaces its own errors.

  // NOTE: ``getProtocolInfo`` was removed in the Phase 9-Hermes-D
  // API-removal pass.  Operator-config singleton coordinates
  // (launcher_ids, mod_hashes, EIP-712 domain) are now embedded at
  // build time in ``environment.populisProtocol``, and dynamic
  // fields like ``protocol_config_hash`` are derived on chain via
  // ``OnChainStateService.getProtocolInfo`` (singleton replay through
  // coinset.org).  The ``ProtocolInfo`` interface remains here as a
  // shared response shape used by the on-chain shim.

  /** Request a short-lived challenge nonce to be signed by the user's wallet. */
  async requestChallenge(address: string, authType: AuthType): Promise<ChallengeResponse> {
    return firstValueFrom(
      this.http.post<ChallengeResponse>(`${this.base}/auth/challenge`, {
        address,
        auth_type: authType,
      })
    );
  }

  /**
   * Register a new EVM-wallet-backed vault.
   *
   * Backend flow:
   *   1. ecrecover the secp256k1 pubkey from `signature` + the registration digest
   *   2. Compress the pubkey to 33 bytes
   *   3. Select a faucet coin, build + sign the launcher spend
   *   4. push_tx to coinset.org
   *   5. Return vault_launcher_id + vault_full_puzhash + spend_bundle_id
   */
  async registerEvmVault(req: RegisterEvmVaultRequest): Promise<VaultCreationResponse> {
    return firstValueFrom(
      this.http.post<VaultCreationResponse>(`${this.base}/vault/register/evm`, req)
    );
  }

  /** Register a new BLS (Chia-native) vault. */
  async registerChiaVault(req: RegisterChiaVaultRequest): Promise<VaultCreationResponse> {
    return firstValueFrom(
      this.http.post<VaultCreationResponse>(`${this.base}/vault/register/chia`, req)
    );
  }

  // NOTE: ``getVaultState`` and ``findVaultByEvmAddress`` were removed in
  // the Phase 9-Hermes-D follow-up that pulled vault state reads off the
  // API entirely.  All vault discovery + lineage walking now happens
  // client-side via ``VaultDiscoveryService`` (CHIP-22 hint scan against
  // coinset.org) and ``ChiaSingletonReaderService.walkLineage``.  The
  // ``VaultState`` interface remains here for transient back-compat with
  // ``SessionService`` until a follow-up commit moves it to a shared
  // ``models/`` location and deletes the rest of this file's read API.
}

export type AuthType = 'evm' | 'chia_bls' | 'passkey';

export interface HealthResponse {
  ok: boolean;
  network: 'testnet11' | 'mainnet';
  peak_height: number | null;
}

export interface ProtocolInfo {
  network: 'testnet11' | 'mainnet';
  pool_launcher_id: string | null;
  governance_launcher_id: string | null;
  vault_inner_mod_hash: string;
  eip712_domain: {
    name: string;
    version: string;
    /**
     * camelCase to match the API's actual JSON shape (the API uses
     * Pydantic alias mode for EIP-712 fields so the on-the-wire key
     * matches the EIP-712 spec exactly).  Before the A.x type refresh
     * this was incorrectly typed as ``chain_id``; no callers were
     * actually reading it so the fix is a pure correctness change.
     */
    chainId: number;
  };
  eip712_typehash_string: string;
  faucet_address: string | null;
  faucet_balance_mojos: number | null;

  // ── Genesis-deploy state ─────────────────────────────────────────────
  /** True after /admin/deploy/protocol has written a manifest. */
  deployed?: boolean;
  /**
   * Full deployment manifest (populated when ``deployed`` is true).
   * Contains all four Phase-A launcher coin ids + puzzle hashes from
   * the atomic deploy.  Shape mirrors ``populis_protocol`` ProtocolDeploymentPlan.
   */
  deployment_manifest?: {
    pool_launcher_id?: string;
    did_launcher_id?: string;
    tracker_launcher_id?: string;
    pgt_tail_hash?: string;
    pgt_full_puzhash?: string;
    pool_full_puzhash?: string;
    did_full_puzhash?: string;
    tracker_full_puzhash?: string;
    [key: string]: unknown;
  } | null;

  // ── A.3 protocol-config singleton fields ─────────────────────────────
  /**
   * Deterministic hash of (pool_launcher_id, governance_launcher_id,
   * network, protocol_config_version).  When the operator has launched
   * the on-chain singleton, the CREATE_PUZZLE_ANNOUNCEMENT it emits on
   * every update spend carries this exact same hash — frontends can
   * therefore independently verify the operator's published config
   * against on-chain state by walking the singleton lineage on
   * coinset.org and comparing.  ``null`` until both pool + governance
   * launchers are configured.  See SECURITY.md §A.3.
   */
  protocol_config_hash?: string | null;

  /**
   * Launcher coin id of the on-chain protocol-config singleton, when
   * the operator has set ``POPULIS_PROTOCOL_CONFIG_LAUNCHER_ID``.
   * Until Phase 1.5 lands the singleton-lineage indexer, this field
   * is informational: clients can use it to locate the singleton on
   * coinset.org and verify the published content_hash themselves.
   */
  protocol_config_launcher_id?: string | null;

  /**
   * Monotonically increasing version stamped into the singleton's
   * curried state.  Bumped by the operator on every config update.
   */
  protocol_config_version?: number;

  // ── A.4 property-registry singleton fields ───────────────────────────
  /**
   * Launcher coin id of the on-chain property-registry singleton.
   * Off-chain consumers walk this singleton's lineage on coinset.org
   * to discover registered property ids.  Each registration spend proves
   * non-membership against the current REGISTERED_IDS_ROOT, recreates the
   * root, and emits a CREATE_PUZZLE_ANNOUNCEMENT carrying the canonical id.
   * ``null`` until the operator opts in.  See SECURITY.md §A.4.
   */
  property_registry_launcher_id?: string | null;

  /**
   * Tree hash of the uncurried ``property_registry_inner.clsp`` mod
   * — clients use this to verify they're reading the canonical puzzle
   * on-chain (rather than a malicious lookalike).  Static across the
   * deployment; only changes if the puzzle source itself is upgraded.
   */
  property_registry_mod_hash?: string | null;

  // ── A.1 mint-proposal singleton fields ───────────────────────────────
  /**
   * Tree hash of the uncurried ``mint_proposal_inner.clsp`` mod;
   * exposed so clients can identify mint-proposal singletons on
   * coinset.org by uncurrying their inner reveal and comparing this
   * value.  Each individual proposal has its own launcher_id (not
   * exposed here — that's per-proposal, not protocol-level).
   * See SECURITY.md §A.1.
   */
  mint_proposal_mod_hash?: string | null;
}

export interface ChallengeResponse {
  /** 32-byte random nonce, hex-encoded. */
  nonce: string;
  /** Timestamp after which the nonce expires. */
  expires_at: number;
  /**
   * Canonical EIP-712 typed data payload the user should sign with
   * signTypedData_v4.  Only used for `auth_type === 'evm'`.
   */
  typed_data?: Eip712TypedData;
}

export interface Eip712TypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface RegisterEvmVaultRequest {
  /** Checksummed 0x-prefixed Ethereum-style address. */
  address: string;
  /** Challenge nonce previously returned by /auth/challenge. */
  nonce: string;
  /** 65-byte hex (0x-prefixed) signature from signTypedData_v4. */
  signature: string;
}

export interface RegisterChiaVaultRequest {
  /** 48-byte hex BLS G1Element. */
  bls_pubkey: string;
  /** Challenge nonce. */
  nonce: string;
  /** 96-byte hex BLS signature. */
  signature: string;
}

export interface VaultCreationResponse {
  vault_launcher_id: string;
  vault_full_puzhash: string;
  p2_vault_puzhash: string;
  spend_bundle_id: string;
  pushed_at: number;
  auth_type: AuthType;
}

export interface VaultState {
  vault_launcher_id: string;
  vault_full_puzhash: string;
  p2_vault_puzhash: string;
  auth_type: AuthType;
  owner_address: string | null;
  owner_pubkey: string;
  confirmed: boolean;
  confirmed_block_index: number | null;
  current_coin_id: string | null;
  balance: {
    xch_mojos: number;
    deeds: DeedHolding[];
  };
}

export interface DeedHolding {
  launcher_id: string;
  coin_id: string;
  par_value: number;
  asset_class: string;
  property_id: string;
  jurisdiction: string;
}
