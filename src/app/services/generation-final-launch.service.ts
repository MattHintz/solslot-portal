import {sha256} from 'ethers';
import {HttpClient} from '@angular/common/http';
import {Injectable,inject} from '@angular/core';
import {firstValueFrom,timeout} from 'rxjs';
import {environment} from '../../environments/environment';
import {Eip712TypedData} from './solslot-api.service';
import {GenerationOperationStatus} from './generation-governance.service';
export interface FinalLaunchRecipient {administratorSlot:number;name:string;wallet:string;identityAuthority:string;
  recipientVault:string;recipientPuzzle:string;fundingCoinId:string;amount:number;}
export interface FinalLaunchReview {
  generationId:string;network:'testnet11';reviewId:string;preparationManifest:string;artifactHash:string;certificateHash:string;
  assemblyHash:string;issuedAt:number;expiresAt:number;releaseExpiresAt:number;feeCapMojos:number;sourceCommits:Record<string,string>;
  actionEnvelope:string;releaseManifestHash:string;securityReviewHash:string;backupReceiptHash:string;restoreReceiptHash:string;
  recipients:FinalLaunchRecipient[];supply:{total:number;distributed:number;reserve:number;quorum:number};sgtTailHash:string;
  sgtOutputs:Array<{coinId:string;puzzleHash:string;amount:number;kind:string;ownerPuzzleHash:string}>;
  exchangeFees:{totalBps:number;protocolBps:number;sgtRewardsBps:number};readAnchorHash:string;
  expectedOutputs:Array<{parent_coin_info:string;puzzle_hash:string;amount:number}>;
  approvedSlots:number[];launchComplete:boolean;confirmedHeight:number|null;lastCheckedAt:number|null;errorCode:string|null;
}
export interface FinalLaunchStatus {generationId:string;network:'testnet11';assignedSlot:number;enabled:boolean;
  review:FinalLaunchReview|null;operation:GenerationOperationStatus|null;nextAction:string;pollAfterSeconds:number;}
@Injectable({providedIn:'root'})
export class GenerationFinalLaunchService {
  private readonly http=inject(HttpClient);
  private readonly base=`${environment.faucetApi}/admin/launch/generation/final`;
  status():Promise<FinalLaunchStatus>{return firstValueFrom(this.http.get<FinalLaunchStatus>(this.base,{withCredentials:true}).pipe(timeout(12000)));}
  review():Promise<FinalLaunchStatus>{return this.post('/review',{});}
  consent(review:FinalLaunchReview):Promise<FinalLaunchStatus & {typedData:Eip712TypedData}>{return this.post('/consent/prepare',this.identity(review));}
  approve(review:FinalLaunchReview,signature:string):Promise<FinalLaunchStatus>{return this.post('/consent',{...this.identity(review),signature});}
  prepare(review:FinalLaunchReview):Promise<FinalLaunchStatus>{return this.post('/prepare',this.identity(review));}
  submit(review:FinalLaunchReview,op:GenerationOperationStatus):Promise<FinalLaunchStatus>{return this.post('/submit',{
    ...this.identity(review),operationId:op.operationId,intentHash:op.intentHash,feeCapMojos:Number(op.feeCapMojos)},45000);}
  async readAnchor(review:FinalLaunchReview):Promise<Blob>{
    const response=await firstValueFrom(this.http.get(this.base+'/'+review.reviewId+'/read-anchor',
      {withCredentials:true,observe:'response',responseType:'blob'}).pipe(timeout(12000)));
    const blob=response.body;if(!blob || blob.size>2200000 || response.headers.get('X-Content-SHA256')!==review.readAnchorHash ||
      sha256(new Uint8Array(await blob.arrayBuffer()))!==review.readAnchorHash)throw new Error('The downloaded launch evidence differs from its signed commitment.');
    return blob;
  }
  private identity(r:FinalLaunchReview){return {generationId:r.generationId,reviewId:r.reviewId};}
  private post<T>(path:string,body:unknown,ms=35000):Promise<T>{return firstValueFrom(this.http.post<T>(this.base+path,body,{withCredentials:true}).pipe(timeout(ms)));}
}
