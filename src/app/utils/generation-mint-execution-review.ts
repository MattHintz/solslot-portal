import { sha256,toUtf8Bytes } from 'ethers';
import { GenerationOperationStatus,MintExecutionReview,validateGenerationOperations } from '../services/generation-governance.service';
import { GenerationMintReview,validateMintReview } from './generation-mint-review';
import { snapshotGenerationReview } from './generation-sgt-review';
import { canonicalConsent } from './generation-consent-review';
import { coinId } from './chia-hash';

export interface MintInventoryReceipt {schemaVersion:1;generationId:string;network:'testnet11';purpose:'TEST_ONLY';
  sourceReviewId:string;operationId:string;transactionId:string;confirmedHeight:number;observedAt:number;
  metadataRoot:string;editionHash:string;deedCount:number;
  inventory:Array<{launcherId:string;coinId:string;coin:{parent_coin_info:string;puzzle_hash:string;amount:number}}>;}
export interface MintExecutionStatus {generationId:string;network:'testnet11';sourceReviewId:string;operation:GenerationOperationStatus|null;
  inventory:{receipt:MintInventoryReceipt|null;lastCheckedAt:number|null;errorCode:string|null};pollAfterSeconds:number;}
const check=(ok:unknown)=>{if(!ok)throw new Error('Mint progress differs from the exact saved source or transaction.');};
const hash=(v:unknown):v is string=>typeof v==='string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const safe=(v:unknown):v is number=>typeof v==='number' && Number.isSafeInteger(v) && v>0;

export function validateMintExecution(raw:MintExecutionStatus,source:GenerationMintReview):MintExecutionStatus {
  const s=validateMintReview(source),v=snapshotGenerationReview(raw);
  check(v.generationId===s.generationId && v.network==='testnet11' && v.sourceReviewId===s.packageId &&
    [5,30].includes(v.pollAfterSeconds) && v.inventory &&
    (v.inventory.lastCheckedAt===null || safe(v.inventory.lastCheckedAt)) &&
    [null,'MINT_INVENTORY_NOT_CONFIRMED','PRIMARY_NODE_UNAVAILABLE'].includes(v.inventory.errorCode));
  const op=v.operation;
  if(op){
    validateGenerationOperations({generationId:s.generationId,network:'testnet11',available:true,operations:[op],
      executionEnabled:false,maximumFeeMojos:'0',pollAfterSeconds:5});
    const r=op.review as MintExecutionReview;
    check(op.kind==='MINT_COLLECTION' && r.sourceReviewId===s.packageId && r.collectionId===s.request.collectionId &&
      r.metadataRoot===s.request.metadataRoot && r.previewHash===s.request.previewHash && r.mintBill.billHash===s.billHash &&
      r.mintBill.testMint?.collectionId===s.collectionCommitment && r.mintBill.testMint?.editionHash===s.editionHash &&
      canonicalConsent(r.expectedInputs.components)===canonicalConsent({[s.mintAuthority.componentId]:s.mintAuthority.coinId}) &&
      canonicalConsent(r.funding)===canonicalConsent(s.funding.map(f=>({coinId:f.coinId,launcherId:f.launcherId,inventoryCoinId:f.inventoryCoinId}))));
  }
  const receipt=v.inventory.receipt;
  if(receipt){
    check(op?.stage==='CONFIRMED' && receipt.schemaVersion===1 && receipt.generationId===s.generationId &&
      receipt.network==='testnet11' && receipt.purpose==='TEST_ONLY' && receipt.sourceReviewId===s.packageId &&
      receipt.operationId===op.operationId && receipt.transactionId===op.transactionId && receipt.confirmedHeight===op.confirmedHeight &&
      safe(receipt.observedAt) && receipt.metadataRoot===s.request.metadataRoot && receipt.editionHash===s.editionHash &&
      receipt.deedCount===s.funding.length && receipt.inventory.length===s.funding.length && v.inventory.errorCode===null);
    receipt.inventory.forEach((r,i)=>{
      const f=s.funding[i];check(r.launcherId===f.launcherId && r.coinId===f.inventoryCoinId &&
        r.coin.amount===1 && r.coin.parent_coin_info===r.launcherId && hash(r.coin.puzzle_hash) &&
        coinId(r.coin.parent_coin_info,r.coin.puzzle_hash,1)===r.coinId);
    });
    check(new Set(receipt.inventory.map(r=>r.coinId)).size===receipt.deedCount);
  }
  return v;
}
