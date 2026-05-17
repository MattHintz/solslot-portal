import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { Eip712TypedData } from './populis-api.service';

@Injectable({ providedIn: 'root' })
export class AdminRosterUpdateService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.faucetApi;

  async prepare(
    token: string,
    request: AdminRosterUpdatePrepareRequest,
  ): Promise<AdminRosterUpdatePrepareResponse> {
    return firstValueFrom(
      this.http.post<AdminRosterUpdatePrepareResponse>(
        `${this.base}/admin/auth/authority_v2/roster_update/prepare`,
        request,
        { headers: authHeaders(token) },
      ),
    );
  }

  async requestAdminChallenge(owner: string): Promise<AdminChallengeResponse> {
    return firstValueFrom(
      this.http.post<AdminChallengeResponse>(
        `${this.base}/admin/auth/challenge`,
        { owner, auth_type: 'evm' },
      ),
    );
  }

  async loginAdmin(request: AdminLoginRequest): Promise<AdminLoginResponse> {
    return firstValueFrom(
      this.http.post<AdminLoginResponse>(
        `${this.base}/admin/auth/login`,
        request,
      ),
    );
  }

  async lookupLiveSingleton(token: string): Promise<AdminAuthorityV2LiveSingletonLookup> {
    return firstValueFrom(
      this.http.get<AdminAuthorityV2LiveSingletonLookup>(
        `${this.base}/admin/auth/authority_v2/live_singleton`,
        { headers: authHeaders(token) },
      ),
    );
  }
}

export interface AdminChallengeResponse {
  nonce: string;
  expires_at: number;
  typed_data: Eip712TypedData;
}

export interface AdminLoginRequest {
  owner: string;
  nonce: string;
  signature: string;
  auth_type: 'evm';
}

export interface AdminLoginResponse {
  jwt: string;
  expires_at: number;
  owner: string;
}

export interface AdminAuthorityV2LiveSingletonCoin {
  coin_id: string;
  parent_coin_info: string;
  puzzle_hash: string;
  amount: number;
  confirmed_block_index?: number | null;
  spent_block_index?: number | null;
}

export interface AdminAuthorityV2LiveSingletonLookup {
  lookup_status: string;
  launcher_id: string;
  expected_inner_puzzle_hash: string;
  expected_full_puzzle_hash: string;
  expected_amount: number;
  candidates_found: number;
  selected_coin: AdminAuthorityV2LiveSingletonCoin | null;
  lineage_verification_status: string;
}

export interface AdminRosterUpdatePrepareRequest {
  updated_admin_records: Record<string, unknown>;
  new_mips_root_hash: string;
  new_authority_version: number;
  current_authority_version?: number;
  current_mips_root_hash?: string;
  current_admins_hash?: string;
  current_pending_ops_hash?: string;
}

export interface AdminRosterUpdatePrepareResponse {
  submission_status: string;
  activation_status: string;
  launcher_id: string;
  current_authority_version: number;
  new_authority_version: number;
  current_admin_count: number;
  new_admin_count: number;
  new_admin_slot_index: number;
  new_threshold: number;
  current_mips_root_hash: string;
  current_admins_hash: string;
  current_pending_ops_hash: string;
  new_mips_root_hash: string;
  new_admins_hash: string;
  new_pending_ops_hash: string;
  new_state_hash: string;
  roster_update_binding_hash: string;
  spend_intent: AdminRosterUpdateSpendIntent;
  missing_for_live_submission: string[];
}

export interface AdminRosterUpdateSpendIntent {
  kind: string;
  spend_tag: number;
  spend_name: string;
  launcher_id: string;
  current_state_hash: string;
  new_state_hash: string;
  roster_update_binding_hash: string;
  validation_scope: string;
}

function authHeaders(token: string): HttpHeaders {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('A short-lived API admin bearer token is required for optional A.5 API checks.');
  }
  return new HttpHeaders({ Authorization: `Bearer ${trimmed}` });
}
