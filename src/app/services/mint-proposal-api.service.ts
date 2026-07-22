import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  MintProposalListResponse,
  MintProposalResponse,
  ProposeMintRequest,
} from './admin-api.service';
import { AdminSessionService } from './admin-session.service';

/** Shared API source for proposal lifecycle records created by a collection. */
@Injectable({ providedIn: 'root' })
export class MintProposalApiService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AdminSessionService);
  private readonly base = environment.faucetApi;

  list(options?: { state?: string; owner?: string; limit?: number; offset?: number }): Promise<MintProposalListResponse> {
    let params = '';
    if (options) {
      const parts: string[] = [];
      if (options.state) parts.push(`state=${encodeURIComponent(options.state)}`);
      if (options.owner) parts.push(`owner=${encodeURIComponent(options.owner)}`);
      if (options.limit !== undefined) parts.push(`limit=${options.limit}`);
      if (options.offset !== undefined) parts.push(`offset=${options.offset}`);
      if (parts.length) params = `?${parts.join('&')}`;
    }
    return firstValueFrom(
      this.http.get<MintProposalListResponse>(`${this.base}/admin/mint${params}`, {
        headers: this.headers(),
      }),
    );
  }

  propose(body: ProposeMintRequest): Promise<MintProposalResponse> {
    return firstValueFrom(
      this.http.post<MintProposalResponse>(`${this.base}/admin/mint/propose`, body, {
        headers: this.headers(),
      }),
    );
  }

  get(proposalId: string): Promise<MintProposalResponse> {
    return firstValueFrom(
      this.http.get<MintProposalResponse>(
        `${this.base}/admin/mint/${encodeURIComponent(proposalId)}`,
        { headers: this.headers() },
      ),
    );
  }

  cancel(proposalId: string): Promise<MintProposalResponse> {
    return firstValueFrom(
      this.http.post<MintProposalResponse>(
        `${this.base}/admin/mint/${encodeURIComponent(proposalId)}/cancel`,
        {},
        { headers: this.headers() },
      ),
    );
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.session.requireJwt()}` });
  }
}
