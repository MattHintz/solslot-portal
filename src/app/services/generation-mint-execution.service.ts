import { HttpClient,HttpHeaders } from '@angular/common/http';
import { Injectable,inject } from '@angular/core';
import { firstValueFrom,timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { MintExecutionRequest,MintExecutionReview,mergeGenerationReceipt } from './generation-governance.service';
import { GenerationMintReview,validateMintReview } from '../utils/generation-mint-review';
import { MintExecutionStatus,validateMintExecution } from '../utils/generation-mint-execution-review';
import { canonicalConsent } from '../utils/generation-consent-review';

@Injectable({providedIn:'root'})
export class GenerationMintExecutionService {
  private readonly http=inject(HttpClient);
  private readonly session=inject(AdminSessionService);
  private readonly base=environment.faucetApi+'/admin/generation/mint-reviews';
  private readonly cache=new Map<string,MintExecutionStatus>();
  private headers(){return new HttpHeaders({Authorization:`Bearer ${this.session.requireJwt()}`});}
  private remember(raw:MintExecutionStatus,source:GenerationMintReview):MintExecutionStatus {
    const next=validateMintExecution(raw,source),old=this.cache.get(source.packageId);
    if(old?.operation){
      if(next.operation)next.operation=mergeGenerationReceipt(old.operation,next.operation);
      else next.operation=structuredClone(old.operation);
    }
    if(old?.inventory.receipt){
      if(next.inventory.receipt && canonicalConsent(old.inventory.receipt)!==canonicalConsent(next.inventory.receipt))
        throw new Error('Confirmed inventory evidence changed. Retain the original receipt.');
      next.inventory=structuredClone(old.inventory);
    }
    const valid=validateMintExecution(next,source);this.cache.set(source.packageId,valid);
    if(this.cache.size>50)this.cache.delete(this.cache.keys().next().value!);
    return structuredClone(valid);
  }
  async saved(source:GenerationMintReview):Promise<MintExecutionStatus> {
    const s=validateMintReview(source);
    return this.remember(await firstValueFrom(this.http.get<MintExecutionStatus>(`${this.base}/${s.packageId}/execution`,
      {headers:this.headers()}).pipe(timeout(20_000))),s);
  }
  async prepare(source:GenerationMintReview,request:MintExecutionRequest):Promise<MintExecutionStatus> {
    const s=validateMintReview(source),req=structuredClone(request);
    if(req.generationId!==s.generationId || req.sourceReviewId!==s.packageId)throw new Error('Review the exact sealed batch.');
    const v=this.remember(await firstValueFrom(this.http.post<MintExecutionStatus>(`${this.base}/${s.packageId}/execution/prepare`,req,
      {headers:this.headers()}).pipe(timeout(65_000))),s);
    const r=v.operation?.review as MintExecutionReview|undefined;
    if(!r || r.proposalId!==req.proposalId || r.feeCapMojos!==req.feeCapMojos ||
      canonicalConsent(r.expectedInputs)!==canonicalConsent({...req.expectedInputs,components:req.expectedInputs.components??{}}))
      throw new Error('Prepared mint differs from your exact review.');
    return v;
  }
  async submit(source:GenerationMintReview,status:MintExecutionStatus):Promise<MintExecutionStatus> {
    const s=validateMintReview(source),v=validateMintExecution(status,s),op=v.operation;
    if(!op)throw new Error('Prepare the exact mint first.');
    const body={generationId:s.generationId,operationId:op.operationId,intentHash:op.intentHash,feeCapMojos:Number(op.feeCapMojos)};
    let returned:MintExecutionStatus;
    try{returned=await firstValueFrom(this.http.post<MintExecutionStatus>(`${this.base}/${s.packageId}/execution/submit`,body,
      {headers:this.headers()}).pipe(timeout(45_000)));}
    catch(error:any){
      if(!error?.error?.detail?.execution)throw error;
      returned=error.error.detail.execution; // Preserve even an ambiguous dispatch receipt.
    }
    const result=this.remember(returned,s);
    if(result.operation?.operationId!==op.operationId || result.operation?.intentHash!==op.intentHash)
      throw new Error('Returned mint differs from the saved transaction.');
    return result;
  }
}
