import { HttpClient,HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { deploymentGeneration } from '../utils/deployment-generation';
import { AdminSessionService } from './admin-session.service';
import { canonicalConsent } from '../utils/generation-consent-review';
import { GovernedBill,ParameterIntent,UpgradeIntent,StatuteIntent,RedemptionIntent,redemptionReviewBill,reconstructGovernedBill,validateStatuteIntent } from '../utils/generation-governed-bill';
export type {ParameterIntent,UpgradeIntent,TestMintIntent,GrantIntent,StatuteIntent,RedemptionIntent} from '../utils/generation-governed-bill';

export interface GenerationOperationStatus {
  generationId:string;network:'testnet11';operationId:string;kind:string;intentHash:string;
  stage:'PREPARED'|'DISPATCHING'|'RECONCILING'|'SUBMITTED'|'CONFIRMED'|'EXPIRED_RECONCILED';transactionId:string|null;
  feeCapMojos:string;createdAt:number;updatedAt:number;lastCheckedAt:number|null;
  errorCode:string|null;confirmedHeight:number|null;nextAction:string;pollAfterSeconds:number;
  review?:MaintenanceRequest|RecipientLaunchReview|ScopedPauseReview|HolderBallotOperationReview|MintExecutionReview|FinalLaunchOperationReview|PrimarySolsBatchReview|null;
}
/** Once a transaction is known, stale cache responses may never make it submit-able again. */
export function mergeGenerationReceipt(previous:GenerationOperationStatus|undefined, incoming:GenerationOperationStatus):GenerationOperationStatus {
  if(!previous)return structuredClone(incoming);
  if(previous.generationId!==incoming.generationId || previous.operationId!==incoming.operationId ||
    previous.kind!==incoming.kind || previous.intentHash!==incoming.intentHash ||
    previous.feeCapMojos!==incoming.feeCapMojos || previous.createdAt!==incoming.createdAt ||
    (previous.review && incoming.review && JSON.stringify(previous.review)!==JSON.stringify(incoming.review)) ||
    (previous.transactionId && incoming.transactionId && previous.transactionId!==incoming.transactionId) ||
    (previous.confirmedHeight && incoming.confirmedHeight && previous.confirmedHeight!==incoming.confirmedHeight))
      throw new Error('Saved action identity changed. Reconcile the original receipt.');
  if(previous.stage==='CONFIRMED' || previous.stage==='EXPIRED_RECONCILED' || (previous.transactionId && !incoming.transactionId) ||
    previous.updatedAt>incoming.updatedAt)return structuredClone(previous);
  return structuredClone(previous.review ? {...incoming,review:previous.review} : incoming);
}

export interface GenerationOperations {
  generationId:string;network:'testnet11';available:boolean;operations:GenerationOperationStatus[];pollAfterSeconds:number;
  executionEnabled:boolean;maximumFeeMojos:string;
}

export interface MintExecutionRequest {generationId:string;sourceReviewId:string;proposalId:string;
  expectedInputs:MaintenanceRequest['expectedInputs'];feeCapMojos:number;}
export interface MintExecutionReview extends MintExecutionRequest {kind:'MINT_COLLECTION';requestKey:string;collectionId:string;
  mintBill:GovernedBill;metadataRoot:string;previewHash:string;
  funding:Array<{coinId:string;launcherId:string;inventoryCoinId:string}>;}

export interface PrimarySolsBatchReview {generationId:string;kind:'PRIMARY_SOLS_BATCH';requestKey:string;
  feeCapMojos:number;batchCommitment:string;primaryCoinId:string;primaryCoinIds:string[];orderIds:string[];
  backingCoinId:string;backingCoinIds:string[];paymentAmount:string;issuanceBackingMojos:string;feeAllocations:string[];
  expiresAt:number;priceRoundHash:string;buyers:Array<{orderId:string;destinationInnerHash:string;paymentAmount:string;minimumSolsAmount:string}>;}
export interface GovernedAction extends GovernedBill {proposalId:string;}
export type MaintenanceKind='ANCHOR_VOTE'|'FINALIZE_VOTE'|'RATIFY_UPGRADE'|'ACTIVATE_UPGRADE'|'RATIFY_REOPENING'|'REOPEN_OPERATIONS'|'APPLY_PARAMETERS'|'APPLY_STATUTES'|'FUND_REDEMPTION'|'CLOSE_REWARD_EPOCH'|'ADVANCE_SGT_REWARDS'|'CLAIM_SGT_REWARD'|'PROVE_STATE'|'UNLOCK_STAKES';
export interface RewardAuthority {assetId:string;statutesComponentId:string;statutesLauncherId:string;revision:number;valuesHash:string;epochSeconds:number;}
export interface RewardEpochIntent extends Omit<RewardAuthority,'epochSeconds'> {holdingsRoot:string;eligibleSupply:number;ledgerSequence:number;feeCoinIds:string[];}
export interface RewardClaimIntent {assetId:string;statutesLauncherId:string;epochId:string;ownerPuzzleHash:string;amount:number;claimCoinId:string;vaultLauncherId:string;}
export interface RewardProgressIntent {assetId:string;statutesLauncherId:string;continuationCoinId:string;}
export interface StateProofIntent {componentId:string;moduleHash:string;version:number;stateHash:string;}
export interface StakeUnlockIntent {coinIds:string[];}
export interface ClosedStake {coinId:string;ownerPuzzleHash:string;amount:number;proposalId:string;}
export interface MaintenanceRequest {generationId:string;requestKey:string;kind:MaintenanceKind;
  expectedInputs:{registry:string;governance:string;holdings:string;components?:Record<string,string>};feeCapMojos:number;
  proposalId?:string;upgrade?:UpgradeIntent;parameters?:ParameterIntent;statutes?:StatuteIntent;redemption?:RedemptionIntent;rewardEpoch?:RewardEpochIntent;rewardClaim?:RewardClaimIntent;rewardProgress?:RewardProgressIntent;scope?:number;proof?:StateProofIntent;stakes?:StakeUnlockIntent;}
export interface FinalLaunchOperationReview {generationId:string;kind:'INITIALIZE_GENERATION';requestKey:string;reviewId:string;certificateHash:string;preparationManifest:string;artifactHash:string;feeCapMojos:number;}
export interface RecipientLaunchReview {generationId:string;preparationManifest:string;administratorSlot:number;
  fundingCoinId:string;recipientVault:string;recipientPuzzle:string;feeCapMojos:number;
  kind:'CREATE_RECIPIENT_VAULT';requestKey:string;}
export interface ScopedPauseReview {generationId:string;requestKey:string;kind:'PAUSE_NEW_OPERATIONS';
  packageId:string;scope:number;pauseEpoch:number;feeCapMojos:number;}
export interface HolderBallotOperationReview {generationId:string;requestKey:string;kind:'OPEN_PROPOSAL'|'CAST_VOTE';
  packageId:string;proposalId:string;selected:Array<{coinId:string;vaultLauncherId:string}>;
  selectedWeight:number;snapshotRoot:string;eligibleSupply:number;requiredVotes:number;votingClosesAt:number|null;feeCapMojos:number;}

function validParameterIntent(p:ParameterIntent|undefined):boolean {
  const hash=(v:string)=>/^0x[0-9a-f]{64}$/.test(v),uint=(v:number)=>Number.isSafeInteger(v)&&v>=0;
  if(!p || !hash(p.componentId) || !hash(p.launcherId) || !hash(p.previousValuesHash) || !uint(p.revision) ||
    !Array.isArray(p.values) || p.values.length!==6 || !p.values.every(uint))return false;
  const [nav,oracle,total,protocol,sgt,epoch]=p.values;
  return nav>=60 && nav<=2592000 && oracle>=30 && oracle<=3600 && total<=100 && protocol+sgt===total && epoch>=60 && epoch<=2592000;
}

export function validateGenerationOperations(value:GenerationOperations):GenerationOperations {
  const hash=(v:string)=>/^0x[0-9a-f]{64}$/.test(v),integer=(v:number)=>Number.isSafeInteger(v)&&v>=0;
  const invalid=()=>{throw new Error('Saved operations do not match the reviewed generation.');};
  const generation=deploymentGeneration();
  if(!generation || value.generationId!==generation || value.network!=='testnet11' || typeof value.available!=='boolean' ||
      typeof value.executionEnabled!=='boolean' || !/^\d{1,10}$/.test(value.maximumFeeMojos) || BigInt(value.maximumFeeMojos)>1000000000n ||
      !Array.isArray(value.operations) || value.operations.length>50 || (!value.available && value.operations.length))invalid();
  for(const op of value.operations){
    if(op.kind==='PRIMARY_SOLS_BATCH'){
      const r=op.review;
      const units=(v:string)=>typeof v==='string' && /^\d{1,20}$/.test(v) && BigInt(v)<2n**64n;
      if(!r || r.kind!=='PRIMARY_SOLS_BATCH' || !/^sols-batch:[0-9a-f]{64}$/.test(r.requestKey) ||
        ![r.batchCommitment,r.primaryCoinId,r.backingCoinId].every(hash) ||
        !Array.isArray(r.orderIds) || r.orderIds.length<1 || r.orderIds.length>32 ||
        !Array.isArray(r.primaryCoinIds) || r.primaryCoinIds.length<1 || r.primaryCoinIds.length>8 ||
        !Array.isArray(r.backingCoinIds) || r.backingCoinIds.length!==r.primaryCoinIds.length ||
        [r.orderIds,r.primaryCoinIds,r.backingCoinIds].some(ids=>ids.some(id=>!hash(id)) || new Set(ids).size!==ids.length) ||
        r.primaryCoinIds[0]!==r.primaryCoinId || r.backingCoinIds[0]!==r.backingCoinId ||
        !units(r.paymentAmount) || !units(r.issuanceBackingMojos) || !Array.isArray(r.feeAllocations) ||
        r.feeAllocations.length!==3 || r.feeAllocations.some(v=>!units(v)) ||
        r.feeAllocations.reduce((sum,v)=>sum+BigInt(v),0n)!==BigInt(r.paymentAmount) ||
        !integer(r.expiresAt) || !r.expiresAt || !hash(r.priceRoundHash) || !Array.isArray(r.buyers) ||
        r.buyers.length!==r.orderIds.length || r.buyers.some((buyer,i)=>buyer.orderId!==r.orderIds[i] ||
          !hash(buyer.destinationInnerHash) || !units(buyer.paymentAmount) || !units(buyer.minimumSolsAmount)) ||
        r.buyers.reduce((sum,buyer)=>sum+BigInt(buyer.paymentAmount),0n)!==BigInt(r.paymentAmount))invalid();
    }
    if(op.kind==='MINT_COLLECTION'){
      const r=op.review;
      if(!r || r.kind!=='MINT_COLLECTION' || r.generationId!==generation || !hash(r.sourceReviewId) || !hash(r.proposalId) ||
        r.requestKey!==`mint:${r.sourceReviewId}` || !/^[A-Za-z0-9_-]{1,128}$/.test(r.collectionId) ||
        !hash(r.metadataRoot) || !hash(r.previewHash) || r.mintBill.kind!=='MINT_TEST_ONLY' ||
        r.feeCapMojos!==Number(op.feeCapMojos) || !Array.isArray(r.funding) || r.funding.length!==r.mintBill.testMint?.deedCount ||
        r.funding.some(f=>![f.coinId,f.launcherId,f.inventoryCoinId].every(hash)) ||
        ['coinId','launcherId','inventoryCoinId'].some(k=>new Set(r.funding.map(f=>f[k as 'coinId'])).size!==r.funding.length) ||
        !r.expectedInputs || ![r.expectedInputs.registry,r.expectedInputs.governance,r.expectedInputs.holdings].every(hash) ||
        Object.keys(r.expectedInputs.components??{}).length!==1 ||
        !Object.entries(r.expectedInputs.components??{}).every(([k,v])=>hash(k)&&hash(v)))invalid();
      reconstructGovernedBill((r as MintExecutionReview).mintBill);
    }
    if(op.review && (op.review.generationId!==op.generationId || op.review.kind!==op.kind ||
      String(op.review.feeCapMojos)!==op.feeCapMojos))invalid();
    if(op.kind==='APPLY_PARAMETERS' && (op.review?.kind!=='APPLY_PARAMETERS' || !validParameterIntent(op.review.parameters) || !hash(op.review.proposalId!)))invalid();
    if(op.kind==='APPLY_STATUTES'){
      const r=op.review;
      if(!r || r.kind!=='APPLY_STATUTES' || !r.statutes || !hash(r.proposalId!))invalid();
      validateStatuteIntent((r as MaintenanceRequest).statutes!);
    }
    if(op.kind==='FUND_REDEMPTION'){
      const r=op.review;
      if(!r || r.kind!=='FUND_REDEMPTION' || !r.redemption || !hash(r.proposalId!))invalid();
      redemptionReviewBill((r as MaintenanceRequest).redemption!);
    }
    if(op.kind==='CLOSE_REWARD_EPOCH' || op.kind==='CLAIM_SGT_REWARD'){
      const r=op.review as MaintenanceRequest;
      if(!r || r.kind!==op.kind || r.generationId!==generation || r.feeCapMojos!==Number(op.feeCapMojos) ||
        !r.expectedInputs || ![r.expectedInputs.registry,r.expectedInputs.governance,r.expectedInputs.holdings].every(hash) ||
        r.proposalId || r.upgrade || r.parameters || r.statutes || r.redemption || r.scope!==null && r.scope!==undefined || r.proof || r.stakes)invalid();
      if(op.kind==='CLOSE_REWARD_EPOCH'){
        const v=r.rewardEpoch;
        if(!v || r.rewardClaim || ![v.assetId,v.statutesComponentId,v.statutesLauncherId,v.valuesHash,v.holdingsRoot].every(hash) ||
          !integer(v.revision) || !integer(v.ledgerSequence) || !integer(v.eligibleSupply) || !v.eligibleSupply || v.eligibleSupply>1000000 ||
          !Array.isArray(v.feeCoinIds) || !v.feeCoinIds.length || v.feeCoinIds.length>64 || !v.feeCoinIds.every(hash) ||
          new Set(v.feeCoinIds).size!==v.feeCoinIds.length || Object.keys(r.expectedInputs.components??{}).length!==1 ||
          !hash(r.expectedInputs.components?.[v.statutesComponentId]!))invalid();
      }else{
        const v=r.rewardClaim;
        if(!v || r.rewardEpoch || ![v.assetId,v.statutesLauncherId,v.epochId,v.ownerPuzzleHash,v.claimCoinId,v.vaultLauncherId].every(hash) ||
          !integer(v.amount) || !v.amount || Object.keys(r.expectedInputs.components??{}).length)invalid();
      }
    }
    if(op.kind==='PROVE_STATE'){
      const r=op.review;
      if(!r || r.kind!=='PROVE_STATE' || !r.proof || !integer(r.proof.version) || r.proof.version<2 ||
        ![r.proof.componentId,r.proof.moduleHash,r.proof.stateHash].every(hash))invalid();
    }
    if(op.kind==='ADVANCE_SGT_REWARDS'){
      const r=op.review;
      if(!r || r.kind!=='ADVANCE_SGT_REWARDS' || !r.rewardProgress || r.rewardEpoch || r.rewardClaim ||
        ![r.rewardProgress.assetId,r.rewardProgress.statutesLauncherId,r.rewardProgress.continuationCoinId].every(hash) ||
        !r.expectedInputs || ![r.expectedInputs.registry,r.expectedInputs.governance,r.expectedInputs.holdings].every(hash) ||
        Object.keys(r.expectedInputs.components??{}).length)invalid();
    }
    if(op.kind==='UNLOCK_STAKES'){
      const r=op.review,ids=r?.kind==='UNLOCK_STAKES'?r.stakes?.coinIds:null;
      if(!ids || !Array.isArray(ids) || ids.length<1 || ids.length>32 || !ids.every(hash) || new Set(ids).size!==ids.length)invalid();
    }
    if(op.kind==='INITIALIZE_GENERATION'){
      const r=op.review;
      if(!r || r.kind!=='INITIALIZE_GENERATION' || ![r.reviewId,r.certificateHash,r.preparationManifest,r.artifactHash].every(hash) ||
        r.requestKey!==`launch:${r.preparationManifest}`)invalid();
    }
    if(op.kind==='CREATE_RECIPIENT_VAULT'){
      const r=op.review;
      if(!r || r.kind!=='CREATE_RECIPIENT_VAULT' || ![1,2,3].includes(r.administratorSlot) ||
        ![r.preparationManifest,r.fundingCoinId,r.recipientVault,r.recipientPuzzle].every(hash) ||
        r.requestKey!==`recipient:${r.preparationManifest}:${r.administratorSlot}`)invalid();
    }
    if(op.kind==='PAUSE_NEW_OPERATIONS'){
      const r=op.review;
      if(!r || r.kind!=='PAUSE_NEW_OPERATIONS' || !hash(r.packageId) || !integer(r.pauseEpoch) ||
        !integer(r.scope) || r.scope<1 || r.scope>31 || r.requestKey!==`pause:${r.packageId}`)invalid();
    }
    if(op.kind==='OPEN_PROPOSAL' || op.kind==='CAST_VOTE'){
      const r=op.review;
      if(!r || (r.kind!=='OPEN_PROPOSAL' && r.kind!=='CAST_VOTE') || r.kind!==op.kind ||
        ![r.packageId,r.proposalId,r.snapshotRoot].every(hash) || r.requestKey!==`ballot:${r.packageId}` ||
        !integer(r.eligibleSupply) || !r.eligibleSupply || r.eligibleSupply>1_000_000 || r.requiredVotes!==Math.ceil(r.eligibleSupply/2) ||
        !integer(r.selectedWeight) || !r.selectedWeight || r.selectedWeight>r.eligibleSupply ||
        !Array.isArray(r.selected) || !r.selected.length || r.selected.length>32 ||
        r.selected.some(c=>!hash(c.coinId)||!hash(c.vaultLauncherId)) || new Set(r.selected.map(c=>c.coinId)).size!==r.selected.length ||
        new Set(r.selected.map(c=>c.vaultLauncherId)).size!==r.selected.length ||
        (r.kind==='OPEN_PROPOSAL'?r.votingClosesAt!==null || r.selectedWeight<10000:!integer(r.votingClosesAt!) || !r.votingClosesAt))invalid();
    }
    if(op.generationId!==generation || op.network!=='testnet11' || !hash(op.operationId) || !hash(op.intentHash) ||
      !['ANCHOR_VOTE','FINALIZE_VOTE','RATIFY_UPGRADE','ACTIVATE_UPGRADE','RATIFY_REOPENING','REOPEN_OPERATIONS',
        'OPEN_PROPOSAL','CAST_VOTE','UNLOCK_STAKES','APPLY_PARAMETERS','APPLY_STATUTES','FUND_REDEMPTION','CLOSE_REWARD_EPOCH','ADVANCE_SGT_REWARDS','CLAIM_SGT_REWARD','CREATE_RECIPIENT_VAULT','INITIALIZE_GENERATION','PROVE_STATE','PAUSE_NEW_OPERATIONS','MINT_COLLECTION','PRIMARY_SOLS_BATCH'].includes(op.kind) ||
      !['PREPARED','DISPATCHING','RECONCILING','SUBMITTED','CONFIRMED','EXPIRED_RECONCILED'].includes(op.stage) ||
      !/^\d{1,10}$/.test(op.feeCapMojos) || BigInt(op.feeCapMojos)>1000000000n ||
      !integer(op.createdAt) || !integer(op.updatedAt) || op.updatedAt<op.createdAt ||
      (op.lastCheckedAt!==null && !integer(op.lastCheckedAt)) ||
      (op.stage==='PREPARED' ? op.transactionId!==null : op.stage==='EXPIRED_RECONCILED' ? !!op.transactionId&&!hash(op.transactionId) : !op.transactionId || !hash(op.transactionId)) ||
      (op.stage==='CONFIRMED' ? !op.confirmedHeight || !integer(op.confirmedHeight) : op.confirmedHeight!==null))invalid();
  }
  if(new Set(value.operations.map(o=>o.operationId)).size!==value.operations.length)invalid();
  return value;
}

export interface HolderProposal extends GovernedBill {
  proposalId: string; kind: string; billHash: string; eligibleHoldingsRoot: string;
  eligibleSupply: number; requiredVotes: number; yesWeight: number; ledgerSequence: number;
  publicationIssuedAt: number; publicationExpiresAt: number;
  openedAt: number | null; votingClosesAt: number | null;
  stage: 'VOTING' | 'CONFIRMING_OPENING'; selectionRule: string;
}
export interface GenerationChainSnapshot {
  generationId: string; network: 'testnet11'; checkedAt: number; active: boolean;
  supply: { total: number; distributed: number; reserve: number; undeliveredEscrow: number;
    locked: number; nextProposalQuorum: number | null; holdingsRoot: string; sequence: number; };
  exchangeFees:{totalBps:number;protocolBps:number;sgtRewardsBps:number;authorityId:string;revision:number}|null;
  stateProof:StateProofIntent & {supported:boolean};
  closedStakes:ClosedStake[];closedStakeCount:number;closedStakesTruncated:boolean;
  proposal: HolderProposal | null; closedProposalCount: number; approvedActionCount: number;
  approvedActions:GovernedAction[];approvedActionsTruncated:boolean;pendingUpgrade:GovernedAction|null;
  components: Array<{componentId: string; launcherId: string; kernelHash: string; moduleHash: string; version: number; compatibility: number}>;
  pauseMask: number; pauseEpoch: number;
  delays: Array<{kind: 'UPGRADE_ACTIVATION' | 'EMERGENCY_REOPENING'; commitment: string; ticketId: string;
    ratifiedAt: number; activationNotBefore: number; confirmedHeight: number; scope: number | null}>;
  componentEvidence: Record<string,{coinId:string;confirmedHeight:number;transitions:number;stateHash:string}>;
  statutesWitnesses?:Record<string,Record<string,Array<Array<number|string>>>>;
  rewardAuthorities?:RewardAuthority[];
  chainEvidence: Record<string, {coinId: string; confirmedHeight: number; transitions: number}>;
}
export interface GenerationGovernanceStatus {
  generationId: string; network: 'testnet11'; status: 'NOT_READY' | 'RECONCILING' | 'READY' | 'STALE' | 'ERROR';
  lastCheckedAt: number | null; lastAttemptAt: number | null; errorCode: string | null;
  snapshot: GenerationChainSnapshot | null; pollAfterSeconds: number;
}

/** Display validation only. Wallet authorization must still verify native spends. */
export function validateGenerationStatus(value: GenerationGovernanceStatus): GenerationGovernanceStatus {
  const generation = deploymentGeneration();
  const uint = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const hash = (v: string) => /^0x[0-9a-f]{64}$/.test(v);
  const invalid = () => { throw new Error('Governance status does not match the reviewed Testnet generation.'); };
  if (!generation || value.generationId !== generation || value.network !== 'testnet11' ||
      !['NOT_READY','RECONCILING','READY','STALE','ERROR'].includes(value.status)) invalid();
  const s = value.snapshot;
  if (!s) { if (value.status === 'READY') invalid(); return value; }
  if (s.generationId !== generation || s.network !== 'testnet11' || s.checkedAt !== value.lastCheckedAt || !uint(s.checkedAt)) invalid();
  const supply = s.supply;
  if (!supply || ![supply.total,supply.distributed,supply.reserve,supply.undeliveredEscrow,supply.locked,supply.sequence].every(uint) ||
      supply.total !== 1_000_000 || supply.distributed + supply.reserve + supply.undeliveredEscrow !== supply.total ||
      supply.locked > supply.distributed || !hash(supply.holdingsRoot) ||
      supply.nextProposalQuorum !== (supply.distributed ? Math.ceil(supply.distributed / 2) : null)) invalid();
  if (!uint(s.pauseMask) || s.pauseMask >= 32 || !uint(s.pauseEpoch)) invalid();
  if (!s.components.length || s.components.some(c => !hash(c.componentId) || !hash(c.launcherId) || !hash(c.kernelHash) ||
      !hash(c.moduleHash) || !uint(c.version) || c.version < 1 || !uint(c.compatibility) || c.compatibility < 1)) invalid();
  for (const key of ['registry','governance','holdings']) {
    const c = s.chainEvidence[key];
    if (!c || !hash(c.coinId) || !uint(c.confirmedHeight) || !c.confirmedHeight || !uint(c.transitions)) invalid();
  }
  if(!s.componentEvidence || typeof s.componentEvidence!=='object' || Array.isArray(s.componentEvidence) ||
    Object.entries(s.componentEvidence).some(([id,c])=>!hash(id) || !s.components.some(registered=>registered.componentId===id) ||
      !hash(c.coinId) || !hash(c.stateHash) || !uint(c.confirmedHeight) || !c.confirmedHeight || !uint(c.transitions)))invalid();
  if(s.rewardAuthorities && (!Array.isArray(s.rewardAuthorities) || s.rewardAuthorities.length>1 || s.rewardAuthorities.some(v=>
    ![v.assetId,v.statutesComponentId,v.statutesLauncherId,v.valuesHash].every(hash) || !uint(v.revision) ||
    !uint(v.epochSeconds) || v.epochSeconds<60 || v.epochSeconds>2592000 || !s.componentEvidence[v.statutesComponentId] ||
    !s.components.some(c=>c.componentId===v.statutesComponentId && c.launcherId===v.statutesLauncherId))))invalid();
  if(s.exchangeFees!==null){
    const fee=s.exchangeFees;
    if(!fee || ![fee.totalBps,fee.protocolBps,fee.sgtRewardsBps,fee.revision].every(uint) ||
      fee.totalBps>100 || fee.protocolBps+fee.sgtRewardsBps!==fee.totalBps || !hash(fee.authorityId) ||
      !s.componentEvidence[fee.authorityId])invalid();
  }
  const proof=s.stateProof,component=s.components.find(c=>c.componentId===proof?.componentId);
  if(!proof || typeof proof.supported!=='boolean' || ![proof.componentId,proof.moduleHash,proof.stateHash].every(hash) ||
    !uint(proof.version) || !component || component.moduleHash!==proof.moduleHash || component.version!==proof.version ||
    (proof.supported && proof.version<2))invalid();
  if(!Array.isArray(s.closedStakes) || s.closedStakes.length>32 || !uint(s.closedStakeCount) ||
    typeof s.closedStakesTruncated!=='boolean' || s.closedStakeCount<s.closedStakes.length ||
    (!s.closedStakesTruncated && s.closedStakeCount!==s.closedStakes.length) ||
    new Set(s.closedStakes.map(c=>c.coinId)).size!==s.closedStakes.length ||
    s.closedStakes.some(c=>![c.coinId,c.ownerPuzzleHash,c.proposalId].every(hash) || !uint(c.amount) || !c.amount) ||
    s.closedStakes.reduce((total,c)=>total+c.amount,0)>supply.locked)invalid();
  if (s.proposal) {
    const p = s.proposal;
    reconstructGovernedBill(p,environment.solslotProtocol.generationHolderBindings.reserveOwner);
    if (!hash(p.proposalId) || !hash(p.billHash) || !hash(p.eligibleHoldingsRoot) ||
        ![p.eligibleSupply,p.requiredVotes,p.yesWeight,p.ledgerSequence,p.publicationIssuedAt,p.publicationExpiresAt].every(uint) ||
        !p.eligibleSupply || p.eligibleSupply > supply.total || p.requiredVotes !== Math.ceil(p.eligibleSupply / 2) ||
        p.yesWeight > p.eligibleSupply || p.publicationExpiresAt - p.publicationIssuedAt !== 86400 ||
        (p.openedAt === null ? p.votingClosesAt !== null : (!uint(p.openedAt) || !p.openedAt || p.votingClosesAt !== p.openedAt + 3600))) invalid();
  }
  if (s.delays.some(d => !hash(d.commitment) || !hash(d.ticketId) || !uint(d.ratifiedAt) || !d.ratifiedAt ||
      !uint(d.confirmedHeight) || !d.confirmedHeight || d.activationNotBefore !== d.ratifiedAt + 86400)) invalid();
  if(!Array.isArray(s.approvedActions) || s.approvedActions.length>32 || typeof s.approvedActionsTruncated!=='boolean' ||
      s.approvedActionCount<s.approvedActions.length || (!s.approvedActionsTruncated && s.approvedActionCount!==s.approvedActions.length))invalid();
  for(const action of [...s.approvedActions,...(s.pendingUpgrade?[s.pendingUpgrade]:[])]){
    if(!hash(action.proposalId))invalid();
    reconstructGovernedBill(action,environment.solslotProtocol.generationHolderBindings.reserveOwner);
  }
  if(s.pendingUpgrade && (s.pendingUpgrade.kind!=='UPGRADE' || !s.delays.some(d=>d.kind==='UPGRADE_ACTIVATION')))invalid();
  return value;
}

@Injectable({providedIn:'root'})
export class GenerationGovernanceService {
  private readonly http = inject(HttpClient);
  private readonly session=inject(AdminSessionService);
  async status(): Promise<GenerationGovernanceStatus> {
    const value = await firstValueFrom(this.http.get<GenerationGovernanceStatus>(
      `${environment.faucetApi}/committee/generation/status`).pipe(timeout(20_000)));
    return validateGenerationStatus(value);
  }
  async operations():Promise<GenerationOperations> {
    return validateGenerationOperations(await firstValueFrom(this.http.get<GenerationOperations>(
      `${environment.faucetApi}/admin/generation/operations`,{headers:new HttpHeaders({Authorization:`Bearer ${this.session.requireJwt()}`})})
      .pipe(timeout(20_000))));
  }
  private headers():HttpHeaders {return new HttpHeaders({Authorization:`Bearer ${this.session.requireJwt()}`});}
  validateReceipt(value:GenerationOperationStatus):GenerationOperationStatus {
    return validateGenerationOperations({generationId:deploymentGeneration()!,network:'testnet11',available:true,
      executionEnabled:false,maximumFeeMojos:'0',operations:[value],pollAfterSeconds:5}).operations[0];
  }
  async prepare(request:MaintenanceRequest):Promise<GenerationOperationStatus> {
    request=structuredClone(request);
    const expected={generationId:request.generationId,requestKey:request.requestKey,kind:request.kind,
      expectedInputs:{...request.expectedInputs,components:request.expectedInputs.components??{}},feeCapMojos:request.feeCapMojos,
      proposalId:request.proposalId??null,upgrade:request.upgrade??null,scope:request.scope??null,
      parameters:request.parameters??null,proof:request.proof??null,stakes:request.stakes??null,
      ...(request.statutes?{statutes:request.statutes}:{}),...(request.redemption?{redemption:request.redemption}:{}),
      ...(request.rewardEpoch?{rewardEpoch:request.rewardEpoch}:{}),...(request.rewardClaim?{rewardClaim:request.rewardClaim}:{}),
      ...(request.rewardProgress?{rewardProgress:request.rewardProgress}:{})};
    const value=this.validateReceipt(await firstValueFrom(this.http.post<GenerationOperationStatus>(
      `${environment.faucetApi}/admin/generation/operations/prepare`,request,{headers:this.headers()}).pipe(timeout(45_000))));
    if(value.kind!==request.kind || Number(value.feeCapMojos)!==request.feeCapMojos ||
      canonicalConsent(value.review)!==canonicalConsent(expected))throw new Error('Prepared action differs from your exact review.');
    return value;
  }
  async submit(review:GenerationOperationStatus):Promise<GenerationOperationStatus> {
    if(review.kind==='PRIMARY_SOLS_BATCH')throw new Error('Open the saved Sols batch receipt to reconcile or submit its exact settlement.');
    if(review.kind==='MINT_COLLECTION')throw new Error('Open the exact collection batch to submit its source-bound mint.');
    const value=this.validateReceipt(await firstValueFrom(this.http.post<GenerationOperationStatus>(
      `${environment.faucetApi}/admin/generation/operations/${review.operationId}/submit`,
      {generationId:review.generationId,intentHash:review.intentHash,feeCapMojos:Number(review.feeCapMojos)},
      {headers:this.headers()}).pipe(timeout(45_000))));
    if(value.operationId!==review.operationId || value.intentHash!==review.intentHash || value.feeCapMojos!==review.feeCapMojos)
      throw new Error('The returned receipt differs from the saved action. Check confirmation before continuing.');
    return value;
  }
}
