import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { UnsignedCoinSpend } from './chia-wallet.service';
import { Eip712TypedData } from './solslot-api.service';

export interface MintPublicationContext {
  contextHash: string;
  trackerLauncherId: string;
  trackerCoin: { parentCoinInfo: string; puzzleHash: string; amount: string };
  trackerInnerPuzzleHex: string;
  lineageProof: { parentName: string; innerPuzzleHash?: string; amount: string };
  proposalEvidenceHex: string;
  parameters: string[];
  votingDeadline: number;
}

export interface MintStakeRequest {
  contextHash: string;
  proposalHash: string;
  vaultLauncherId: string;
  stakeAmount: string;
  votingDeadline: number;
  operationHash?: string;
  vaultOwnerAuthorization?: string;
}

export interface MintStakePackage extends MintStakeRequest {
  operationHash: string;
  vaultCoinId: string;
  vaultAuthType: 'chia_bls' | 'evm';
  vaultTypedData: Eip712TypedData | null;
  sgtCoinId: string;
  sgtCoin: { parentCoinInfo: string; puzzleHash: string; amount: string };
  voterInnerPuzzleHash: string;
  lockedInnerPuzzleHash: string;
  availableSgtAmounts: string[];
  signingCoinSpends: UnsignedCoinSpend[];
  evmOwnerAuthorized: boolean;
}

@Injectable({ providedIn: 'root' })
export class MintPublicationApiService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AdminSessionService);
  private readonly base = `${environment.faucetApi}/admin/mint/publication`;

  context(): Promise<MintPublicationContext> {
    return firstValueFrom(this.http.post<MintPublicationContext>(`${this.base}/context`, {},
      { headers: this.headers() }));
  }

  stake(body: MintStakeRequest): Promise<MintStakePackage> {
    return firstValueFrom(this.http.post<MintStakePackage>(`${this.base}/stake`, body,
      { headers: this.headers(), withCredentials: true }));
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.session.requireJwt()}` });
  }
}
