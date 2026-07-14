import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AdminGenesisService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.faucetApi;

  async getDeployment(token: string): Promise<GenesisDeploymentStatus> {
    return firstValueFrom(
      this.http.get<GenesisDeploymentStatus>(`${this.base}/admin/deployment`, {
        headers: authHeaders(token),
      }),
    );
  }

  async dryRunProtocolDeploy(
    token: string,
    request: GenesisDeployRequest = {},
  ): Promise<GenesisDeployResponse> {
    return this.deployProtocol(token, { ...request, dry_run: true });
  }

  async deployProtocol(
    token: string,
    request: GenesisDeployRequest = {},
  ): Promise<GenesisDeployResponse> {
    return firstValueFrom(
      this.http.post<GenesisDeployResponse>(`${this.base}/admin/deploy/protocol`, request, {
        headers: authHeaders(token),
      }),
    );
  }
}

export interface GenesisDeployRequest {
  quorum_bps?: number;
  voting_window_seconds?: number;
  sgt_total_supply?: number;
  min_proposal_stake?: number;
  fp_scale?: number;
  min_nav_registry_version?: number;
  initial_pool_status?: number;
  fee_per_spend?: number;
  sgt_coin_id?: string | null;
  pool_coin_id?: string | null;
  did_coin_id?: string | null;
  gov_coin_id?: string | null;
  nav_registry_coin_id?: string | null;
  protocol_config_coin_id?: string | null;
  dry_run?: boolean;
}

export interface GenesisDeployResponse {
  spend_bundle_id: string | null;
  pushed: boolean;
  network: 'testnet11' | 'mainnet' | string;
  manifest: GenesisDeploymentManifest;
}

export interface GenesisDeploymentStatus {
  deployed: boolean;
  network: 'testnet11' | 'mainnet' | string;
  manifest: GenesisDeploymentManifest | null;
}

export type GenesisDeploymentManifest = Record<string, unknown>;

function authHeaders(token: string): HttpHeaders {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('admin genesis: one-shot admin token is required');
  }
  return new HttpHeaders({ Authorization: `Bearer ${trimmed}` });
}
