import { HttpClient,HttpHeaders } from '@angular/common/http';
import { Injectable,inject } from '@angular/core';
import { firstValueFrom,timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { EvmWalletService } from './evm-wallet.service';
import { ChiaWalletService } from './chia-wallet.service';
import { GenerationGovernanceService,GenerationOperationStatus,MaintenanceRequest,GovernedAction } from './generation-governance.service';
import { GenerationConsentReview } from './generation-consent.service';
import { GenerationSgtContext,GenerationSgtRequest,snapshotGenerationReview } from '../utils/generation-sgt-review';
import { validateGenerationBallot,validateHolderCatalog } from '../utils/generation-ballot-review';
import { canonicalConsent,validateGenerationConsent } from '../utils/generation-consent-review';

export interface HolderSelection {coinId:string;vaultLauncherId:string;}
export interface HolderBallotRequest extends Omit<MaintenanceRequest,'kind'> {
  kind:'OPEN_PROPOSAL'|'CAST_VOTE';proposalId:string;consentPackageId:string|null;selected:HolderSelection[];
}
export interface HolderRow {context:GenerationSgtContext;request:GenerationSgtRequest;transitionDigest:string;authorizationHash:string;}
export interface GenerationBallotReview {
  generationId:string;network:'testnet11';packageId:string;kind:'OPEN_PROPOSAL'|'CAST_VOTE';request:HolderBallotRequest;requestDigest:string;
  stage:'AWAITING_HOLDER_SIGNATURES'|'READY'|'EXPIRED';createdAt:number;expiresAt:number;proposalId:string;
  proposal:Omit<GovernedAction,'proposalId'>;proposalNonce:number;eligibleSupply:number;requiredVotes:number;selectedWeight:number;
  snapshotRoot:string;votingClosesAt:number|null;feeCapMojos:string;selectionRule:string;holders:HolderRow[];
  signatures:Array<{coinId:string;signedAt:number}>;pollAfterSeconds:number;
}
export interface HolderCatalog {
  generationId:string;network:'testnet11';scope:'FROZEN_GENESIS_ROSTER';checkedAt:number;
  expectedInputs:MaintenanceRequest['expectedInputs'];proposalId:string|null;snapshotRoot:string;eligibleSupply:number;votingClosesAt:number|null;
  holdings:Array<HolderSelection & {name:string;ownerPuzzleHash:string;amount:number}>;truncated:boolean;
}

@Injectable({providedIn:'root'})
export class GenerationBallotService {
  private readonly http=inject(HttpClient);
  private readonly session=inject(AdminSessionService);
  private readonly evm=inject(EvmWalletService);
  private readonly chia=inject(ChiaWalletService);
  private readonly operations=inject(GenerationGovernanceService);
  private readonly base=environment.faucetApi+'/admin/generation/ballots';
  private readonly cache=new Map<string,GenerationBallotReview>();
  private headers(){return new HttpHeaders({Authorization:`Bearer ${this.session.requireJwt()}`});}
  async list():Promise<GenerationBallotReview[]> {
    const value=await firstValueFrom(this.http.get<{generationId:string;network:string;reviews:Array<Omit<GenerationBallotReview,'holders'>>}>(this.base,{headers:this.headers()}).pipe(timeout(20_000)));
    const catalogGeneration=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
    if(value.generationId!==catalogGeneration.generationId || value.network!=='testnet11' || !Array.isArray(value.reviews) || value.reviews.length>50)
      throw new Error('Saved holder reviews belong to another generation.');
    if(value.reviews.some(r=>!/^0x[0-9a-f]{64}$/.test(r.packageId)) || new Set(value.reviews.map(r=>r.packageId)).size!==value.reviews.length)
      throw new Error('Invalid holder package in status response.');
    const reviews=await Promise.all(value.reviews.map(async summary=>{
      const old=this.cache.get(summary.packageId);
      const result=old ? validateGenerationBallot({...summary,holders:old.holders}) : validateGenerationBallot(
        await firstValueFrom(this.http.get<GenerationBallotReview>(`${this.base}/${summary.packageId}`,{headers:this.headers()}).pipe(timeout(20_000))));
      const fixed=(r:Omit<GenerationBallotReview,'holders'>)=>{const {stage,signatures,pollAfterSeconds,...rest}=r;return canonicalConsent(rest);};
      const {holders,...fullSummary}=result;
      if(fixed(fullSummary)!==fixed(summary))throw new Error('Saved holder proof changed. Keep the original review.');
      if(old){const {holders:previous,...oldSummary}=old;if(fixed(oldSummary)!==fixed(summary))throw new Error('Saved holder review changed.');}
      this.cache.set(result.packageId,result);return result;
    }));
    // This is a bounded convenience cache of public proofs, never an authority
    // or a business journal. Retained server evidence is not removed here.
    for(const key of this.cache.keys())if(!reviews.some(r=>r.packageId===key))this.cache.delete(key);
    return reviews;
  }
  async holdings():Promise<HolderCatalog> {
    return validateHolderCatalog(await firstValueFrom(this.http.get<HolderCatalog>(this.base+'/holdings',{headers:this.headers()}).pipe(timeout(20_000))));
  }
  async prepare(source:HolderBallotRequest,consent?:GenerationConsentReview):Promise<GenerationBallotReview> {
    const req=snapshotGenerationReview(source);
    if(req.kind==='OPEN_PROPOSAL'){
      const c=consent && validateGenerationConsent(consent);
      if(!c || c.kind!=='PUBLICATION_APPROVAL' || c.stage!=='READY' || c.packageId!==req.consentPackageId || c.proposalId!==req.proposalId)
        throw new Error('Both exact administrator publication approvals are required.');
    }
    const review=validateGenerationBallot(await firstValueFrom(this.http.post<GenerationBallotReview>(this.base+'/prepare',req,
      {headers:this.headers()}).pipe(timeout(65_000))));
    if(canonicalConsent(review.request)!==canonicalConsent({...req,expectedInputs:{...req.expectedInputs,components:req.expectedInputs.components??{}}}))
      throw new Error('The prepared selection differs from your review.');
    if(consent && (review.proposalId!==consent.proposalId || review.expiresAt!==consent.expiresAt ||
      review.snapshotRoot!==consent.holdingsRoot || review.eligibleSupply!==consent.eligibleSupply ||
      review.proposal.billHash!==consent.billHash || canonicalConsent(review.proposal)!==canonicalConsent(consent.proposal)))
      throw new Error('Holder sponsorship differs from the approved publication.');
    return review;
  }
  async sign(source:GenerationBallotReview,coinId:string):Promise<GenerationBallotReview> {
    const review=validateGenerationBallot(source),row=review.holders.find(r=>r.request.sgtCoinId===coinId),key=this.session.pubkey();
    if(!row || key!==row.context.owner.publicKey || review.stage==='EXPIRED' || review.expiresAt<=Math.floor(Date.now()/1000) ||
      review.signatures.some(s=>s.coinId===coinId))throw new Error('Connect the selected holder wallet and review the saved action.');
    const check=async()=>{
      if(this.session.pubkey()!==key || review.expiresAt<=Math.floor(Date.now()/1000))throw new Error('Wallet or signing window changed.');
      const v=await firstValueFrom(this.http.post<{generationId:string;packageId:string;unchanged:boolean}>(`${this.base}/${review.packageId}/check-inputs`,{},
        {headers:this.headers()}).pipe(timeout(25_000)));
      if(v.generationId!==review.generationId || v.packageId!==review.packageId || v.unchanged!==true)throw new Error('The original confirmed inputs changed.');
    };
    const signature=row.context.owner.authType===3?await this.evm.signGenerationSgt(row.request,row.context,check):
      (await this.chia.signGenerationSgt(row.request,row.context,check)).aggregatedSignature;
    if(this.session.pubkey()!==key || review.expiresAt<=Math.floor(Date.now()/1000))throw new Error('Wallet or signing window changed after the prompt.');
    const result=validateGenerationBallot(await firstValueFrom(this.http.post<GenerationBallotReview>(`${this.base}/${review.packageId}/sign`,{coinId,signature},
      {headers:this.headers()}).pipe(timeout(25_000))));
    if(result.packageId!==review.packageId || result.requestDigest!==review.requestDigest)throw new Error('Returned signature belongs to another review.');
    return result;
  }
  async assemble(review:GenerationBallotReview):Promise<GenerationOperationStatus> {
    validateGenerationBallot(review);
    const op=this.operations.validateReceipt(await firstValueFrom(this.http.post<GenerationOperationStatus>(`${this.base}/${review.packageId}/assemble`,{},
      {headers:this.headers()}).pipe(timeout(65_000))));
    if(op.review?.kind!==review.kind || !('packageId' in op.review) || op.review.packageId!==review.packageId ||
      op.review.proposalId!==review.proposalId || Number(op.feeCapMojos)!==Number(review.feeCapMojos))throw new Error('The saved transaction differs from this holder review.');
    return op;
  }
}
