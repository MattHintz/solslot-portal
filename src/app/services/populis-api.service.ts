import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * HTTP client for the Populis FastAPI backend.
 *
 * The backend is the single source of truth for:
 *   - secp256k1 pubkey recovery from signed EIP-712 messages
 *   - Vault launcher bundle assembly (driven by populis_puzzles.vault_driver)
 *   - Faucet-funded launcher payments on testnet11
 *   - push_tx broadcasting (with retries) to coinset.org
 *   - Vault state aggregation (coin records, deeds, offers)
 */
@Injectable({ providedIn: 'root' })
export class PopulisApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.populisApi;

  /** Health check.  Returns `{ ok: true, network: "testnet11" }` when up. */
  async health(): Promise<HealthResponse> {
    return firstValueFrom(this.http.get<HealthResponse>(`${this.base}/health`));
  }

  /** Protocol-wide parameters (pool launcher id, governance id, etc.). */
  async getProtocolInfo(): Promise<ProtocolInfo> {
    return firstValueFrom(this.http.get<ProtocolInfo>(`${this.base}/protocol`));
  }

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

  /** Poll vault confirmation + state (balance, deeds). */
  async getVaultState(launcherId: string): Promise<VaultState> {
    return firstValueFrom(
      this.http.get<VaultState>(`${this.base}/vault/${launcherId}`)
    );
  }

  /** Look up a vault by the owner EVM address. */
  async findVaultByEvmAddress(address: string): Promise<VaultState | null> {
    return firstValueFrom(
      this.http.get<VaultState | null>(`${this.base}/vault/by-evm/${address}`)
    );
  }
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
    chain_id: number;
  };
  eip712_typehash_string: string;
  faucet_address: string | null;
  faucet_balance_mojos: number | null;
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
