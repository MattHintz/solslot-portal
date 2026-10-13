import { HttpClient,HttpHeaders } from '@angular/common/http';
import { Injectable,inject } from '@angular/core';
import { firstValueFrom,timeout } from 'rxjs';
import { computeAddress,sha256,toUtf8Bytes } from 'ethers';
import { environment } from '../../environments/environment';
import { Eip712TypedData } from './solslot-api.service';
import { AdminSessionService } from './admin-session.service';
import { EvmWalletService } from './evm-wallet.service';
import { GovernedAction,MaintenanceRequest,GenerationOperationStatus,GenerationGovernanceService } from './generation-governance.service';
import { canonicalConsent,validateGenerationConsent } from '../utils/generation-consent-review';
import { snapshotGenerationReview } from '../utils/generation-sgt-review';
import { deploymentGeneration } from '../utils/deployment-generation';
import { GenerationMintReview } from '../utils/generation-mint-review';

type Coin={parent_coin_info:string;puzzle_hash:string;amount:number};
export interface GenerationConsentReview {
  generationId:string;network:'testnet11';packageId:string;requestKey:string;requestDigest:string;
  kind:'PUBLICATION_APPROVAL'|'PAUSE_NEW_OPERATIONS';stage:'AWAITING_APPROVALS'|'READY'|'EXPIRED';
  request:GenerationConsentRequest;
  createdAt:number;issuedAt:number;expiresAt:number;feeCapMojos:string;coadministratorSlot:number;
  authorityLauncherId:string;authorityCoinId:string;authorityCoin:Coin;authorityPuzzleHash:string;authorityInnerHash:string;
  sourceManifestHash:string;authorityVersion:number;authorityDelegatedHash:string;targetPuzzleHash:string;
  identityLauncherIds:string[];identityCoins:Coin[];identityCustodies:string[];identityPuzzles:string[];
  governanceNonce:number;proposalId:string|null;proposal:(Omit<GovernedAction,'proposalId'>)|null;billHash:string|null;
  eligibleSupply:number;eligibleTotal:number;requiredVotes:number|null;holdingsRoot:string;pauseEpoch:number;scope:number|null;
  expectedInputs:MaintenanceRequest['expectedInputs'];
  mintSource?:GenerationMintReview;
  signatures:Array<{slot:number;signedAt:number}>;
  challenges:Array<{slot:number;coinId:string;delegatedPuzzleHash:string;digest:string;publicKey:string;typedData:Eip712TypedData}>;
  pollAfterSeconds:number;
}
export interface GenerationConsentRequest extends Omit<MaintenanceRequest,'kind'> {
  kind:'PUBLICATION_APPROVAL'|'PAUSE_NEW_OPERATIONS';coadministratorSlot:number;
  proposalKind?:'UPGRADE'|'PARAMETERS'|'STATUTES'|'REOPEN'|'MINT_TEST_ONLY'|'FUND_REDEMPTION';
  mintReviewId?:string;
}

@Injectable({providedIn:'root'})
export class GenerationConsentService {
  private readonly http=inject(HttpClient);
  private readonly session=inject(AdminSessionService);
  private readonly wallet=inject(EvmWalletService);
  private readonly governance=inject(GenerationGovernanceService);
  private readonly base=environment.faucetApi+'/admin/generation/consents';
  private headers(){return new HttpHeaders({Authorization:`Bearer ${this.session.requireJwt()}`});}
  async list():Promise<GenerationConsentReview[]> {
    const value=await firstValueFrom(this.http.get<{generationId:string;network:string;reviews:GenerationConsentReview[]}>(this.base,{headers:this.headers()}).pipe(timeout(20_000)));
    if(value.generationId!==deploymentGeneration() || value.network!=='testnet11' || !Array.isArray(value.reviews) || value.reviews.length>50)
      throw new Error('Approval history belongs to another generation.');
    return value.reviews.map(validateGenerationConsent);
  }
  async prepare(request:GenerationConsentRequest):Promise<GenerationConsentReview> {
    request=snapshotGenerationReview(request);
    const expected={generationId:request.generationId,requestKey:request.requestKey,kind:request.kind,
      coadministratorSlot:request.coadministratorSlot,expectedInputs:{...request.expectedInputs,components:request.expectedInputs.components??{}},
      feeCapMojos:request.feeCapMojos,proposalKind:request.proposalKind??null,upgrade:request.upgrade??null,
      parameters:request.parameters??null,scope:request.scope??null,
      ...(request.statutes ? {statutes:request.statutes} : {}),
      ...(request.redemption ? {redemption:request.redemption} : {}),
      ...(request.mintReviewId ? {mintReviewId:request.mintReviewId} : {})};
    const review=validateGenerationConsent(await firstValueFrom(this.http.post<GenerationConsentReview>(this.base+'/prepare',request,
      {headers:this.headers()}).pipe(timeout(65_000))));
    if(review.requestKey!==request.requestKey || review.kind!==request.kind || review.coadministratorSlot!==request.coadministratorSlot ||
      review.requestDigest!==sha256(toUtf8Bytes(canonicalConsent(expected))) ||
      Number(review.feeCapMojos)!==request.feeCapMojos || ['registry','governance','holdings'].some(k=>
        review.expectedInputs[k as 'registry']!==request.expectedInputs[k as 'registry']) ||
      JSON.stringify(review.expectedInputs.components??{})!==JSON.stringify(request.expectedInputs.components??{}))
      throw new Error('Prepared approval differs from your selected action.');
    return review;
  }
  async sign(source:GenerationConsentReview):Promise<GenerationConsentReview> {
    const review=validateGenerationConsent(source),slot=this.session.authoritySlot(),key=this.session.pubkey();
    const challenge=review.challenges.find(c=>c.slot===slot);
    if(!challenge || challenge.publicKey!==key || this.wallet.address()?.toLowerCase()!==computeAddress(challenge.publicKey).toLowerCase() ||
      review.stage==='EXPIRED' || review.expiresAt<=Math.floor(Date.now()/1000) || review.signatures.some(s=>s.slot===slot))
      throw new Error('Open the assigned administrator wallet and review its current approval.');
    const signature=await this.wallet.signAuthorityV3ChiaAction(challenge.typedData,{coinId:challenge.coinId,
      delegatedPuzzleHash:challenge.delegatedPuzzleHash,compressedPubkey:challenge.publicKey});
    if(this.session.authoritySlot()!==slot || this.session.pubkey()!==key || deploymentGeneration()!==review.generationId ||
      this.wallet.address()?.toLowerCase()!==computeAddress(challenge.publicKey).toLowerCase() || review.expiresAt<=Math.floor(Date.now()/1000))
      throw new Error('The wallet, generation or approval window changed. Review the saved action again.');
    const value=validateGenerationConsent(await firstValueFrom(this.http.post<GenerationConsentReview>(
      `${this.base}/${review.packageId}/sign`,{signature},{headers:this.headers()}).pipe(timeout(25_000))));
    if(value.packageId!==review.packageId)throw new Error('Returned approval differs from the saved review.');
    return value;
  }
  async preparePause(review:GenerationConsentReview):Promise<GenerationOperationStatus> {
    validateGenerationConsent(review);
    const op=await firstValueFrom(this.http.post<GenerationOperationStatus>(`${this.base}/${review.packageId}/prepare-pause`,{},
      {headers:this.headers()}).pipe(timeout(45_000)));
    // Shared operation validation and identity-preserving receipt checks.
    return this.governance.validateReceipt(op);
  }
}
