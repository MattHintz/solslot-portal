import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { Eip712TypedData } from './solslot-api.service';
import { EvmWalletService } from './evm-wallet.service';

export type AdminOperationName =
  | 'bridge.top-up'
  | 'collection.amend'
  | 'collection.seal'
  | 'mint.cancel'
  | 'mint.execute'
  | 'mint.publish'
  | 'presale.create'
  | 'presale.launch';

export interface AdminRequestBindingV1 {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query: Array<[string, string]>;
  body: unknown;
  ifMatch?: string;
}

export interface AdminOperationApproval {
  schemaVersion: 1;
  operationId: string;
  status: 'pending' | 'approved' | 'consumed';
  operation: AdminOperationName;
  payloadHash: string;
  revision: number;
  expiresAt: number;
  authorityLauncherId: string;
  network: 'testnet11' | 'mainnet';
  nonce: string;
  requestBinding: AdminRequestBindingV1;
  signatures: Array<{ adminIndex: number; signerAddress: string; signedAt: number }>;
  typedData: Eip712TypedData;
}

export class PendingAdminApprovalError extends Error {
  constructor(readonly approval: AdminOperationApproval) {
    super(
      `Owner-plus-one approval ${approval.operationId} is waiting for the other required administrator. Open Admin Approvals on the second administrator's session.`,
    );
    this.name = 'PendingAdminApprovalError';
  }
}

@Injectable({ providedIn: 'root' })
export class AdminOperationApprovalService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AdminSessionService);
  private readonly wallet = inject(EvmWalletService);
  private readonly base = environment.faucetApi;

  async prepareAndSign(input: {
    operation: AdminOperationName;
    revision: number;
    binding: AdminRequestBindingV1;
  }): Promise<AdminOperationApproval> {
    const prepared = await firstValueFrom(
      this.http.post<AdminOperationApproval>(
        `${this.base}/admin/auth/operations/prepare`,
        {
          operation: input.operation,
          revision: input.revision,
          expiresInSeconds: 600,
          requestBinding: input.binding,
        },
        { headers: this.authHeaders() },
      ),
    );
    return this.sign(prepared.operationId, prepared.typedData);
  }

  get(operationId: string): Promise<AdminOperationApproval> {
    return firstValueFrom(
      this.http.get<AdminOperationApproval>(
        `${this.base}/admin/auth/operations/${encodeURIComponent(operationId)}`,
        { headers: this.authHeaders() },
      ),
    );
  }

  async sign(
    operationId: string,
    typedData?: Eip712TypedData,
  ): Promise<AdminOperationApproval> {
    const current = typedData ? undefined : await this.get(operationId);
    const signature = await this.wallet.signTypedData(typedData ?? current!.typedData);
    return firstValueFrom(
      this.http.post<AdminOperationApproval>(
        `${this.base}/admin/auth/operations/${encodeURIComponent(operationId)}/sign`,
        { signature },
        { headers: this.authHeaders() },
      ),
    );
  }

  async execute<T = unknown>(approval: AdminOperationApproval): Promise<T> {
    if (approval.status !== 'approved') {
      throw new Error('This operation does not yet have slot 0 plus one coadmin.');
    }
    const binding = approval.requestBinding;
    let headers = this.authHeaders().set(
      'X-Solslot-Admin-Operation-Id',
      approval.operationId,
    );
    if (binding.ifMatch) headers = headers.set('If-Match', binding.ifMatch);
    let params = new HttpParams();
    for (const [key, value] of binding.query) params = params.append(key, value);
    return firstValueFrom(
      this.http.request<T>(binding.method, `${this.base}${binding.path}`, {
        body: binding.body,
        headers,
        params,
      }),
    );
  }

  async prepareSignAndRequireSecond(input: {
    operation: AdminOperationName;
    revision: number;
    binding: AdminRequestBindingV1;
  }): Promise<never> {
    const approval = await this.prepareAndSign(input);
    throw new PendingAdminApprovalError(approval);
  }

  private authHeaders(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.session.requireJwt()}` });
  }
}
