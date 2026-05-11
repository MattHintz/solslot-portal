import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AdminBootstrapService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.faucetApi;

  async startBootstrapSession(token: string): Promise<BootstrapChallengeResponse> {
    return firstValueFrom(
      this.http.post<BootstrapChallengeResponse>(`${this.base}/admin/bootstrap/challenge`, null, {
        headers: authHeaders(token),
        withCredentials: true,
      }),
    );
  }

  async getBootstrapStatus(): Promise<BootstrapStatusResponse> {
    return firstValueFrom(
      this.http.get<BootstrapStatusResponse>(`${this.base}/admin/bootstrap/status`, {
        withCredentials: true,
      }),
    );
  }

  async finalizeBootstrap(request: BootstrapFinalizeRequest): Promise<BootstrapFinalizeResponse> {
    return firstValueFrom(
      this.http.post<BootstrapFinalizeResponse>(
        `${this.base}/admin/bootstrap/finalize`,
        request,
        {
          withCredentials: true,
        },
      ),
    );
  }

  async verifyRecoveryArtifacts(
    request: BootstrapRecoveryAnchorVerifyRequest,
  ): Promise<BootstrapRecoveryAnchorVerifyResponse> {
    return firstValueFrom(
      this.http.post<BootstrapRecoveryAnchorVerifyResponse>(
        `${this.base}/admin/bootstrap/recovery-anchor/verify`,
        request,
      ),
    );
  }

  async getRecoveryAnchorPublishIntent(): Promise<BootstrapRecoveryAnchorPublishIntentResponse> {
    return firstValueFrom(
      this.http.get<BootstrapRecoveryAnchorPublishIntentResponse>(
        `${this.base}/admin/bootstrap/recovery-anchor/publish-intent`,
        {
          withCredentials: true,
        },
      ),
    );
  }

  async createRecoveryAnchorCoinPreview(
    request: BootstrapRecoveryAnchorCreateCoinPreviewRequest,
  ): Promise<BootstrapRecoveryAnchorCreateCoinPreviewResponse> {
    return firstValueFrom(
      this.http.post<BootstrapRecoveryAnchorCreateCoinPreviewResponse>(
        `${this.base}/admin/bootstrap/recovery-anchor/create-coin-preview`,
        request,
        {
          withCredentials: true,
        },
      ),
    );
  }
}

export interface BootstrapChallengeResponse {
  unlocked: boolean;
  expires_at: number;
}

export interface BootstrapStatusResponse {
  locked: boolean;
  authenticated: boolean;
  expires_at?: number | null;
}

export interface BootstrapFinalizeRequest {
  admin_records: Record<string, unknown>;
  admin_authority_launcher_id: string;
  admins_hash: string;
  mips_root: string;
  read_only_api_url?: string | null;
  read_only_coinset_url?: string | null;
}

export interface BootstrapFinalizeResponse {
  locked: boolean;
  bootstrap_manifest: BootstrapManifestArtifact;
  portal_runtime_config: PortalRuntimeConfigArtifact;
  bootstrap_recovery_anchor: BootstrapRecoveryAnchorArtifact;
}

export interface AdminAuthorityV2ManifestArtifact {
  launcher_id: string;
  admins_hash: string;
  mips_root: string;
  authority_version: number;
  [key: string]: unknown;
}

export interface AdminAuthorityV2RuntimeArtifact extends AdminAuthorityV2ManifestArtifact {
  admin_records_hash: string;
}

export interface BootstrapManifestArtifact {
  version: number;
  network: string;
  protocol: Record<string, unknown>;
  admin_authority_v2: AdminAuthorityV2ManifestArtifact;
  artifact_hashes: Record<string, string>;
  [key: string]: unknown;
}

export interface PortalRuntimeConfigArtifact {
  version: number;
  network: string;
  protocol: Record<string, unknown>;
  admin_authority_v2: AdminAuthorityV2RuntimeArtifact;
  read_only_api_url?: string | null;
  read_only_coinset_url?: string | null;
  [key: string]: unknown;
}

export interface BootstrapRecoveryAnchorArtifact {
  version: number;
  tag: string;
  network: string;
  admin_authority_v2_launcher_id: string;
  authority_version: number;
  bootstrap_manifest_hash: string;
  portal_runtime_config_hash: string;
  admin_records_hash: string;
  [key: string]: unknown;
}

export interface BootstrapRecoveryAnchorVerifyRequest {
  bootstrap_recovery_anchor: BootstrapRecoveryAnchorArtifact;
  bootstrap_manifest: BootstrapManifestArtifact;
  portal_runtime_config: PortalRuntimeConfigArtifact;
  admin_records: Record<string, unknown>;
  deployment_manifest?: Record<string, unknown> | null;
  live_admin_authority_v2?: AdminAuthorityV2ManifestArtifact | null;
}

export interface BootstrapRecoveryAnchorVerifyResponse {
  verified: boolean;
  deployment_manifest_verified: boolean;
  live_authority_verified: boolean;
  network?: string | null;
  admin_authority_v2_launcher_id?: string | null;
  admins_hash?: string | null;
  mips_root?: string | null;
  authority_version?: number | null;
  bootstrap_manifest_hash?: string | null;
  portal_runtime_config_hash?: string | null;
  admin_records_hash?: string | null;
  deployment_manifest_hash?: string | null;
  error?: string | null;
}

export interface BootstrapRecoveryAnchorPublishIntentResponse {
  network: string;
  marker_coin_amount_mojos: number;
  admin_authority_v2_launcher_id: string;
  authority_version: number;
  bootstrap_manifest_hash: string;
  portal_runtime_config_hash: string;
  admin_records_hash: string;
  tag_memo_utf8: string;
  tag_memo_hex: string;
  payload_memo_json: BootstrapRecoveryAnchorArtifact;
  payload_memo_utf8: string;
  payload_memo_hex: string;
  memos_hex: string[];
  payload_hash: string;
}

export interface BootstrapRecoveryAnchorCreateCoinPreviewRequest {
  marker_puzzle_hash: string;
}

export interface BootstrapRecoveryAnchorCreateCoinPreviewResponse {
  condition_opcode: number;
  marker_puzzle_hash: string;
  marker_coin_amount_mojos: number;
  tag_memo_hex: string;
  payload_memo_hex: string;
  memos_hex: string[];
  condition_hex: [number, string, number, [string, string]];
  payload_hash: string;
}

function authHeaders(token: string): HttpHeaders {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('admin bootstrap: one-shot admin token is required');
  }
  return new HttpHeaders({ Authorization: `Bearer ${trimmed}` });
}
