import { HttpClient,HttpHeaders } from '@angular/common/http';
import { Injectable,inject } from '@angular/core';
import { firstValueFrom,timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { deploymentGeneration } from '../utils/deployment-generation';
import { GenerationOperationStatus,validateGenerationOperations,mergeGenerationReceipt } from './generation-governance.service';
export interface BatchOrder {generationId:string;orderId:string;paymentAsset:string|null;paymentAmount:string;solsAmount:string;destinationInnerHash:string;expiresAt:number|null;stage:string;}
export interface BatchInventory {inventoryId:string;currentCoinId:string;deedLauncherId:string;collectionId:string;baseUsdMinor:string;subtotalUsdMinor:string;}
export interface BatchCatalogue {generationId:string;ready:boolean;lastCheckedAt:number;errorCode:string|null;inventory:BatchInventory[];signedPrice:any;
  anchorHash:string;registryCoinId:string;poolCoinId:string;statutesCoinId:string;
  suggestedMatches?:Array<{orderIds:string[];primaryCoinIds:string[];paymentAmount:string;sourceCount:number;stage:'CANDIDATE_REQUIRES_NATIVE_REVIEW'}>;}
export interface BatchDesk {generationId:string;orders:BatchOrder[];catalog:BatchCatalogue|null;operations:GenerationOperationStatus[];}
const hash=(v:string)=>/^0x[0-9a-f]{64}$/.test(v);
@Injectable({providedIn:'root'})
export class GenerationSolsBatchesService {
  private readonly http=inject(HttpClient);private readonly session=inject(AdminSessionService);
  private readonly base=environment.faucetApi+'/admin/generation/sols-batches';
  private readonly receipts=new Map<string,GenerationOperationStatus>();
  private headers(){return new HttpHeaders({Authorization:'Bearer '+this.session.requireJwt()});}
  private remember(raw:GenerationOperationStatus){
    const generation=deploymentGeneration();if(!generation || raw.generationId!==generation || raw.kind!=='PRIMARY_SOLS_BATCH')throw new Error('The batch belongs to another generation.');
    validateGenerationOperations({generationId:generation,network:'testnet11',available:true,executionEnabled:false,maximumFeeMojos:raw.feeCapMojos,operations:[raw],pollAfterSeconds:30});
    const next=mergeGenerationReceipt(this.receipts.get(raw.operationId),raw);this.receipts.set(next.operationId,next);return next;
  }
  async desk():Promise<BatchDesk>{
    const value=await firstValueFrom(this.http.get<BatchDesk>(this.base+'/orders',{headers:this.headers()}).pipe(timeout(20000)));
    const gen=deploymentGeneration();if(!gen || value.generationId!==gen || !Array.isArray(value.orders) || value.orders.length>512 ||
      value.orders.some(row=>row.generationId!==gen || !hash(row.orderId) || !hash(row.destinationInnerHash)))throw new Error('Order history does not match the confirmed generation.');
    if(value.catalog && (value.catalog.generationId!==gen || !Array.isArray(value.catalog.inventory) || value.catalog.inventory.length>100 ||
      value.catalog.inventory.some(row=>![row.inventoryId,row.currentCoinId,row.deedLauncherId,row.collectionId].every(hash))))throw new Error('Primary inventory evidence changed.');
    return {...value,operations:value.operations.map(row=>this.remember(row))};
  }
  async prepare(generationId:string,orderIds:string[],claim:unknown,feeCapMojos:number){
    const body=structuredClone({generationId,orderIds,claim,feeCapMojos});
    if(generationId!==deploymentGeneration() || !orderIds.length || orderIds.length>32 || orderIds.some(id=>!hash(id)))throw new Error('Review the selected original orders.');
    return this.remember(await firstValueFrom(this.http.post<GenerationOperationStatus>(this.base+'/prepare',body,{headers:this.headers()}).pipe(timeout(95000))));
  }
  async submit(operation:GenerationOperationStatus){
    const reviewed=this.remember(operation);
    if(reviewed.stage==='CONFIRMED')return reviewed;
    if(reviewed.stage==='EXPIRED_RECONCILED')throw new Error('This price window expired. Prepare a fresh match from the retained original orders.');
    return this.remember(await firstValueFrom(this.http.post<GenerationOperationStatus>(this.base+'/submit',{
      generationId:reviewed.generationId,operationId:reviewed.operationId,intentHash:reviewed.intentHash,feeCapMojos:Number(reviewed.feeCapMojos)},
      {headers:this.headers()}).pipe(timeout(65000))));
  }
  async releaseExpired(operation:GenerationOperationStatus){
    const reviewed=this.remember(operation);
    return this.remember(await firstValueFrom(this.http.post<GenerationOperationStatus>(this.base+'/release-expired',{
      generationId:reviewed.generationId,operationId:reviewed.operationId,intentHash:reviewed.intentHash,feeCapMojos:Number(reviewed.feeCapMojos)},
      {headers:this.headers()}).pipe(timeout(65000))));
  }
}
