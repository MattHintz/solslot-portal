import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { Eip712TypedData } from './solslot-api.service';

@Injectable({ providedIn: 'root' })
export class AdminBackendAuthService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.faucetApi;

  requestChallenge(owner: string): Promise<AdminChallengeResponse> {
    return firstValueFrom(
      this.http.post<AdminChallengeResponse>(`${this.base}/admin/auth/challenge`, {
        owner,
        auth_type: 'evm',
      }),
    );
  }

  login(owner: string, nonce: string, signature: string): Promise<AdminLoginResponse> {
    return firstValueFrom(
      this.http.post<AdminLoginResponse>(`${this.base}/admin/auth/login`, {
        owner,
        nonce,
        signature,
        auth_type: 'evm',
      }),
    );
  }

  refresh(jwt: string): Promise<AdminRefreshResponse> {
    return firstValueFrom(
      this.http.post<AdminRefreshResponse>(
        `${this.base}/admin/auth/refresh`,
        {},
        { headers: new HttpHeaders({ Authorization: `Bearer ${jwt}` }) },
      ),
    );
  }
}

export interface AdminChallengeResponse {
  nonce: string;
  expires_at: number;
  typed_data: Eip712TypedData;
}

export interface AdminLoginResponse {
  jwt: string;
  expires_at: number;
  owner: string;
}

export interface AdminRefreshResponse {
  jwt: string;
  expires_at: number;
}
