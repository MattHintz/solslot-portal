import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';

@Injectable({ providedIn: 'root' })
export class LegacyProRecallService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AdminSessionService);
  private readonly base = environment.legacyRecallApi.replace(/\/$/, '');

  async search(query: string): Promise<LegacyProRecallResponse> {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      throw new Error('Enter at least 3 characters.');
    }
    const subject = this.session.subject();
    const headers = subject
      ? new HttpHeaders({ 'X-Solslot-Admin-Subject': subject })
      : undefined;
    const params = new HttpParams().set('q', trimmed);
    return firstValueFrom(
      this.http.get<LegacyProRecallResponse>(
        `${this.base}/legacy/pro-vaults/recall`,
        { headers, params },
      ),
    );
  }
}

export interface LegacyProRecallResponse {
  deprecated: true;
  system: 'legacy_pro_accounts_and_pro_vaults';
  query: string;
  records: LegacyProRecallRecord[];
  count: number;
}

export interface LegacyProRecallRecord {
  source: 'redis' | 'stripe_customer' | string;
  id: string;
  deprecated: true;
  data: unknown;
}
