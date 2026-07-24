import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { BaseSepoliaTransaction } from './evm-wallet.service';
import { Eip712TypedData } from './solslot-api.service';

@Injectable({ providedIn: 'root' })
export class OmnichainOwnershipActivationService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AdminSessionService);
  private readonly base = environment.faucetApi;

  get(): Promise<OwnershipActivationStatus> {
    return firstValueFrom(
      this.http.get<OwnershipActivationStatus>(
        `${this.base}/admin/omnichain/ownership-activation`,
        { headers: this.headers() },
      ),
    );
  }

  sign(signature: string): Promise<OwnershipActivationStatus> {
    return firstValueFrom(
      this.http.post<OwnershipActivationStatus>(
        `${this.base}/admin/omnichain/ownership-activation/sign`,
        { signature },
        { headers: this.headers() },
      ),
    );
  }

  recordBroadcast(transactionHash: string): Promise<OwnershipActivationStatus> {
    return firstValueFrom(
      this.http.post<OwnershipActivationStatus>(
        `${this.base}/admin/omnichain/ownership-activation/broadcast`,
        { transactionHash },
        { headers: this.headers() },
      ),
    );
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${this.session.requireJwt()}`,
    });
  }
}

export type OwnershipActivationState =
  | 'AWAITING_APPROVALS'
  | 'READY_TO_BROADCAST'
  | 'SCHEDULED'
  | 'READY_TO_EXECUTE'
  | 'DONE';

export interface OwnershipSafeApproval {
  role: 'owner_identity' | 'coadmin';
  safe: string;
  allowedSigners: string[];
  messageHash: string;
  typedData: Eip712TypedData;
  signed: boolean;
  signerAddress: string | null;
  signedAt: number | null;
}

export interface OwnershipBroadcastRecord {
  transactionHash: string;
  submittedBy: string;
  submittedAt: number;
  blockNumber: number;
  confirmedAt: number | null;
  confirmations: number;
  minimumConfirmations: number;
}

export interface OwnershipActivationStatus {
  schemaVersion: 1;
  state: OwnershipActivationState;
  packageHash: string;
  sourceSha: string;
  network: 'baseSepolia';
  chainId: 84532;
  phase: 'schedule';
  operationId: string;
  rootSafe: string;
  timelock: string;
  rootSafeTransactionHash: string;
  scheduledFor: number | null;
  approvals: OwnershipSafeApproval[];
  broadcastTransaction: BaseSepoliaTransaction | null;
  broadcast: OwnershipBroadcastRecord | null;
}
