import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { Eip712TypedData } from './solslot-api.service';
import { GenerationOperationStatus, RecipientLaunchReview } from './generation-governance.service';

export interface GenerationRecipient {
  administratorSlot: number; name: string; wallet: string;
  identityAuthority: string; recipientVault: string; recipientPuzzle: string; fundingCoinId:string; amount: number;
  creation:GenerationOperationStatus|null;
  confirmed: boolean; confirmationFresh: boolean; confirmedCoinId: string | null;
  confirmedHeight: number | null; lastCheckedAt: number | null; acknowledgedAt: number | null;
  errorCode: 'NODE_UNAVAILABLE' | 'RECIPIENT_NOT_CONFIRMED' | null;
  stage: 'CHECK_REQUIRED' | 'AWAITING_ACKNOWLEDGEMENT' | 'ACKNOWLEDGED';
}
export interface GenerationRecipientReview {
  generationId: string; network: string; preparationManifest: string; assignedSlot: number;
  holderSupply: number; reserveSupply: number; totalSupply: number; initialQuorum: number;
  recipients: GenerationRecipient[]; recipientPreparationComplete: boolean; genesisAuthorized: false;
  creationAvailable:boolean;maximumFeeMojos:string;
}
export interface RecipientConsentReview {
  generationId: string; preparationManifest: string; recipient: GenerationRecipient;
}
export interface PreparedRecipientConsent extends RecipientConsentReview { typedData: Eip712TypedData; }

@Injectable({providedIn:'root'})
export class GenerationRecipientsService {
  private readonly http=inject(HttpClient);
  private readonly base=`${environment.faucetApi}/admin/launch/generation/recipients`;
  status(): Promise<GenerationRecipientReview> {
    return firstValueFrom(this.http.get<GenerationRecipientReview>(this.base,{withCredentials:true}).pipe(timeout(12000)));
  }
  prepareCreation(body:Omit<RecipientLaunchReview,'kind'|'requestKey'>):Promise<GenerationRecipientReview> {
    return this.post('/creation/prepare',body);
  }
  submitCreation(preparationManifest:string,operation:GenerationOperationStatus):Promise<GenerationRecipientReview> {
    return this.post('/creation/submit',{generationId:operation.generationId,preparationManifest,
      operationId:operation.operationId,intentHash:operation.intentHash,feeCapMojos:Number(operation.feeCapMojos)},45000);
  }
  check(): Promise<GenerationRecipientReview> { return this.post('/check',{}); }
  prepare(): Promise<PreparedRecipientConsent> { return this.post('/acknowledgement/prepare',{}); }
  acknowledge(preparationManifest: string, signature: string): Promise<GenerationRecipientReview> {
    return this.post('/acknowledgement',{preparationManifest,signature});
  }
  private post<T>(path: string,body: unknown,deadline=25000): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.base+path,body,{withCredentials:true}).pipe(timeout(deadline)));
  }
}
