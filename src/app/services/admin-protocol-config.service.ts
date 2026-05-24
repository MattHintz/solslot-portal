import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AdminProtocolConfigService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.faucetApi;

  async finalizeProtocolConfig(
    token: string,
    launcherId: string,
  ): Promise<ProtocolConfigFinalizeResponse> {
    return firstValueFrom(
      this.http.post<ProtocolConfigFinalizeResponse>(
        `${this.base}/admin/protocol-config/finalize`,
        { launcher_id: launcherId },
        { headers: authHeaders(token) },
      ),
    );
  }
}

export interface ProtocolConfigFinalizeResponse {
  updated: boolean;
  env_file_path: string;
  previous_protocol_config_launcher_id: string | null;
  protocol_config_launcher_id: string;
  protocol_config_hash: string | null;
  protocol_config_version: number;
  network: string;
}

function authHeaders(token: string): HttpHeaders {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('admin protocol config: one-shot admin token is required');
  }
  return new HttpHeaders({ Authorization: `Bearer ${trimmed}` });
}
