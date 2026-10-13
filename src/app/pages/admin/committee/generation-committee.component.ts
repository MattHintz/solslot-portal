import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GenerationGovernanceService, GenerationGovernanceStatus,GenerationOperations,GenerationOperationStatus,
  MaintenanceKind,MaintenanceRequest,GovernedAction,RewardEpochIntent,RewardClaimIntent,RewardProgressIntent,mergeGenerationReceipt } from '../../../services/generation-governance.service';
import { AdminStatusRefresh } from '../../../services/admin-status-refresh.service';
import { AdminRefreshStatusComponent } from '../../../components/admin-workspace/admin-refresh-status.component';
import { GenerationConsentsComponent } from './generation-consents.component';
import { GenerationBallotsComponent } from './generation-ballots.component';
import { GenerationConsentReview } from '../../../services/generation-consent.service';
import { GenerationAssetIntentComponent } from '../../../components/admin-workspace/generation-asset-intent.component';
import { statuteReviewBill,redemptionReviewBill } from '../../../utils/generation-governed-bill';
import { GenerationSolsBatchesComponent } from '../../../components/admin-workspace/generation-sols-batches.component';
import { GenerationRewardsFormComponent } from '../../../components/admin-workspace/generation-rewards-form.component';

@Component({
  selector:'solslot-generation-committee', standalone:true,
  imports:[CommonModule,RouterLink,AdminRefreshStatusComponent,GenerationConsentsComponent,GenerationBallotsComponent,GenerationAssetIntentComponent,GenerationRewardsFormComponent,GenerationSolsBatchesComponent],providers:[AdminStatusRefresh],
  templateUrl:'./generation-committee.component.html',styleUrl:'./generation-committee.component.scss',
  changeDetection:ChangeDetectionStrategy.OnPush,
})
export class GenerationCommitteeComponent implements OnInit {
  private readonly api=inject(GenerationGovernanceService);
  readonly refresh=inject(AdminStatusRefresh);
  readonly status=signal<GenerationGovernanceStatus|null>(null);
  readonly operations=signal<GenerationOperations|null>(null);
  readonly operationsError=signal(false);
  readonly pendingAction=signal<'PREPARING'|'SUBMITTING'|null>(null);
  readonly reviewRequest=signal<MaintenanceRequest|null>(null);
  readonly preparedAction=signal<GenerationOperationStatus|null>(null);
  readonly actionError=signal<string|null>(null);
  readonly selectedStakes=signal<string[]>([]);
  readonly sponsorshipConsent=signal<GenerationConsentReview|null>(null);
  readonly reviewedStakes=computed(()=>{
    const saved=this.preparedAction()?.review;
    return (saved?.kind==='UNLOCK_STAKES'?saved.stakes:null) || this.reviewRequest()?.stakes || null;
  });
  readonly uncertainSubmission=signal<string|null>(null);
  private readonly receipts=new Map<string,GenerationOperationStatus>();
  private remember(op:GenerationOperationStatus):GenerationOperationStatus {
    const next=mergeGenerationReceipt(this.receipts.get(op.operationId),op);
    this.receipts.set(op.operationId,next);return next;
  }
  private setPrepared(op:GenerationOperationStatus):void {this.preparedAction.set(this.remember(op));}

  readonly snapshot=computed(()=>this.status()?.snapshot ?? null);
  readonly redemptionFundingPaused=computed(()=>!!((this.snapshot()?.pauseMask??0)&8));
  readonly reviewedParameters=computed(()=>{
    const saved=this.preparedAction()?.review;
    return (saved?.kind==='APPLY_PARAMETERS' ? saved.parameters : null) || this.reviewRequest()?.parameters || null;
  });
  readonly reviewedStatutes=computed(()=>{
    const saved=this.preparedAction()?.review;
    return (saved?.kind==='APPLY_STATUTES'?saved.statutes:null) || this.reviewRequest()?.statutes || null;
  });
  readonly reviewedStatuteBill=computed(()=>{
    const fact=this.reviewedStatutes();
    return fact?{kind:'STATUTES',billHash:statuteReviewBill(fact).hash,statutes:fact}:null;
  });
  readonly reviewedRedemptionBill=computed(()=>{
    const saved=this.preparedAction()?.review;
    const value=(saved?.kind==='FUND_REDEMPTION'?saved.redemption:null) || this.reviewRequest()?.redemption;
    return value?{kind:'FUND_REDEMPTION',billHash:redemptionReviewBill(value).hash,redemption:value}:null;
  });
  readonly reviewedProof=computed(()=>{
    const saved=this.preparedAction()?.review;
    return (saved?.kind==='PROVE_STATE' ? saved.proof : null) || this.reviewRequest()?.proof || null;
  });
  readonly reviewedReward=computed(()=>{
    const r=this.preparedAction()?.review ?? this.reviewRequest();
    return r?.kind==='CLOSE_REWARD_EPOCH'?r.rewardEpoch:null;
  });
  readonly reviewedClaim=computed(()=>{
    const r=this.preparedAction()?.review ?? this.reviewRequest();
    return r?.kind==='CLAIM_SGT_REWARD'?r.rewardClaim:null;
  });
  readonly isCurrent=computed(()=>{
    const checked=this.status()?.lastCheckedAt;
    const age=checked ? this.refresh.now()-checked*1000 : Infinity;
    return this.status()?.status==='READY' && !this.refresh.error() && age>=0 && age<=90_000;
  });
  readonly votingClosed=computed(()=>{
    const close=this.snapshot()?.proposal?.votingClosesAt;
    return close ? this.refresh.now()>=close*1000 : false;
  });
  readonly headline=computed(()=>{
    if(!this.snapshot()) return this.status()?.status==='NOT_READY' ? 'Complete the generation setup' : 'Checking confirmed governance';
    if(!this.isCurrent()) return 'Showing the last confirmed state';
    const s=this.snapshot()!;
    if(s.proposal) return !s.proposal.openedAt ? 'Confirming the voting window' : this.votingClosed() ? 'Voting window ended' : 'Holder voting is open';
    if(s.delays.length) return 'The on-chain waiting period is in progress';
    if(s.approvedActionCount) return 'A ratified action is awaiting execution';
    return 'Ready for the next proposal';
  });
  ngOnInit():void {
    this.refresh.start(async()=>{
      const [state,operations]=await Promise.allSettled([this.api.status(),this.api.operations()]);
      if(operations.status==='fulfilled'){
        try {
          const next={...operations.value,operations:operations.value.operations.map(op=>this.remember(op))};
          this.operations.set(next);this.operationsError.set(false);
          const current=this.preparedAction();
          if(current){const saved=next.operations.find(op=>op.operationId===current.operationId);if(saved)this.setPrepared(saved);}
          if(next.operations.some(op=>op.operationId===this.uncertainSubmission() && !!op.transactionId))this.uncertainSubmission.set(null);
        } catch {this.operationsError.set(true);}
      }
      else this.operationsError.set(true);
      if(state.status==='fulfilled')this.status.set(state.value);else throw state.reason;
    },()=>this.pendingAction()?'Finishing your reviewed action. Saved progress will refresh afterward.':null,()=>this.operations()?.operations.some(o=>!!o.transactionId && o.stage!=='CONFIRMED') ||
      this.status()?.status!=='NOT_READY' && (!this.isCurrent() || !!this.snapshot()?.active));
  }
  operationLabel(kind:string):string {
    return ({ANCHOR_VOTE:'Confirm voting opening',FINALIZE_VOTE:'Finalize holder vote',RATIFY_UPGRADE:'Start upgrade waiting period',
      ACTIVATE_UPGRADE:'Activate approved code',RATIFY_REOPENING:'Start reopening waiting period',REOPEN_OPERATIONS:'Reopen approved operations',
      OPEN_PROPOSAL:'Open holder vote',CAST_VOTE:'Lock holdings and vote',UNLOCK_STAKES:'Unlock closed voting stakes',
      APPLY_PARAMETERS:'Apply voted parameters',APPLY_STATUTES:'Apply voted economic fact',FUND_REDEMPTION:'Fund permanent redemption claims',
      CLOSE_REWARD_EPOCH:'Fund permanent SGT rewards',ADVANCE_SGT_REWARDS:'Process the next saved reward page',CLAIM_SGT_REWARD:'Receive earned SGT reward',PROVE_STATE:'Prove upgraded state',PAUSE_NEW_OPERATIONS:'Pause reviewed new operations'} as Record<string,string>)[kind] || 'Saved chain action';
  }
  async reviewReward(kind:'CLOSE_REWARD_EPOCH'|'CLAIM_SGT_REWARD'|'ADVANCE_SGT_REWARDS',intent:RewardEpochIntent|RewardClaimIntent|RewardProgressIntent):Promise<void> {
    if(this.pendingAction() || !this.isCurrent() || this.operationsError() || !this.operations()?.available)return;
    const s=this.snapshot()!,a=s.rewardAuthorities?.find(v=>v.statutesLauncherId===intent.statutesLauncherId && v.assetId===intent.assetId);
    if(!a)return;
    const request:MaintenanceRequest={generationId:s.generationId,requestKey:crypto.randomUUID(),kind,
      feeCapMojos:Number(this.operations()!.maximumFeeMojos),expectedInputs:{registry:s.chainEvidence['registry'].coinId,
        governance:s.chainEvidence['governance'].coinId,holdings:s.chainEvidence['holdings'].coinId}};
    if(kind==='CLOSE_REWARD_EPOCH'){
      const epoch=intent as RewardEpochIntent;
      if(epoch.statutesComponentId!==a.statutesComponentId || epoch.valuesHash!==a.valuesHash || epoch.revision!==a.revision ||
        epoch.holdingsRoot!==s.supply.holdingsRoot || epoch.eligibleSupply!==s.supply.distributed || epoch.ledgerSequence!==s.supply.sequence)return;
      request.rewardEpoch=structuredClone(epoch);
      request.expectedInputs.components={[a.statutesComponentId]:s.componentEvidence[a.statutesComponentId].coinId};
    }else if(kind==='ADVANCE_SGT_REWARDS')request.rewardProgress=structuredClone(intent as RewardProgressIntent);
    else request.rewardClaim=structuredClone(intent as RewardClaimIntent);
    this.reviewRequest.set(request);this.preparedAction.set(null);await this.prepareReview();
  }
  selectStake(coinId:string,selected:boolean):void {
    if(this.pendingAction() || !this.snapshot()?.closedStakes.some(c=>c.coinId===coinId))return;
    this.selectedStakes.update(ids=>selected?[...new Set([...ids,coinId])]:ids.filter(id=>id!==coinId));
  }
  async reviewAction(kind:MaintenanceKind,intent?:GovernedAction):Promise<void> {
    if(this.pendingAction() || !this.isCurrent() || this.operationsError() || !this.operations()?.available)return;
    const s=this.snapshot()!;
    const request:MaintenanceRequest={generationId:s.generationId,requestKey:crypto.randomUUID(),kind,
      feeCapMojos:Number(this.operations()!.maximumFeeMojos),expectedInputs:{registry:s.chainEvidence['registry'].coinId,
        governance:s.chainEvidence['governance'].coinId,holdings:s.chainEvidence['holdings'].coinId}};
    if(kind==='RATIFY_UPGRADE' || kind==='ACTIVATE_UPGRADE')request.upgrade=intent?.upgrade;
    if(kind==='ACTIVATE_UPGRADE'){
      request.expectedInputs.components=Object.fromEntries((intent?.upgrade?.changes??[]).filter(c=>s.componentEvidence[c.componentId])
        .map(c=>[c.componentId,s.componentEvidence[c.componentId].coinId]));
    }
    if(kind==='RATIFY_UPGRADE' || kind==='RATIFY_REOPENING')request.proposalId=intent?.proposalId;
    if(kind==='APPLY_PARAMETERS'){
      const parameters=intent?.parameters;
      if(!parameters || !s.componentEvidence[parameters.componentId])return;
      request.parameters=parameters;request.proposalId=intent?.proposalId;
      request.expectedInputs.components={[parameters.componentId]:s.componentEvidence[parameters.componentId].coinId};
    }
    if(kind==='APPLY_STATUTES'){
      const statutes=intent?.statutes;
      const records=statutes && s.statutesWitnesses?.[statutes.componentId]?.[statutes.recordKind];
      if(!statutes || !records || !s.componentEvidence[statutes.componentId])return;
      request.statutes={...statutes,currentRecords:records};request.proposalId=intent?.proposalId;
      request.expectedInputs.components={[statutes.componentId]:s.componentEvidence[statutes.componentId].coinId};
    }
    if(kind==='FUND_REDEMPTION'){
      if(!intent?.redemption || (s.pauseMask&8))return;
      request.redemption=structuredClone(intent.redemption);request.proposalId=intent.proposalId;
    }
    if(kind==='RATIFY_REOPENING')request.scope=intent?.scope;
    if(kind==='PROVE_STATE'){
      if(!s.stateProof.supported)return;
      const {supported,...proof}=s.stateProof;request.proof=proof;
    }
    if(kind==='UNLOCK_STAKES'){
      const ids=this.selectedStakes();
      if(!ids.length || ids.length>32 || ids.some(id=>!s.closedStakes.some(c=>c.coinId===id)))return;
      request.stakes={coinIds:[...ids]};
    }
    this.reviewRequest.set(structuredClone(request));this.preparedAction.set(null);
    await this.prepareReview();
  }
  async prepareReview():Promise<void> {
    const request=this.reviewRequest();if(this.pendingAction() || !request)return;
    this.pendingAction.set('PREPARING');this.actionError.set(null);
    try{this.setPrepared(await this.api.prepare(structuredClone(request)));}
    catch{this.actionError.set('We couldn’t finish preparing this action. Retry this same review to recover any saved progress.');}
    finally{this.pendingAction.set(null);await this.refresh.refresh();}
  }
  async submitReviewed():Promise<void> {
    const review=this.preparedAction();
    if(!review || this.pendingAction() || !this.operations()?.executionEnabled || this.operationsError() || review.transactionId || review.stage!=='PREPARED')return;
    this.pendingAction.set('SUBMITTING');this.actionError.set(null);
    try{this.setPrepared(await this.api.submit(structuredClone(review)));this.uncertainSubmission.set(null);}
    catch{this.uncertainSubmission.set(review.operationId);this.actionError.set('We couldn’t confirm the submission response. Your operation is saved. Check its status below before taking another action.');}
    finally{
      this.pendingAction.set(null);await this.refresh.refresh();

    }
  }
  resumeSaved(op:GenerationOperationStatus):void {
    if(this.pendingAction() || op.kind==='CREATE_RECIPIENT_VAULT')return;
    this.setPrepared(op);this.reviewRequest.set(null);this.actionError.set(null);
  }
  delayReady(when:number):boolean {return this.isCurrent() && this.refresh.now()>=when*1000;}
  operationMessage(op:GenerationOperationStatus):string {
    const errors:Record<string,string>={CHAIN_WAIT_REQUIRED:'The on-chain waiting period is still running. Your reviewed action is saved.',
      CHAIN_WINDOW_EXPIRED:'The review window ended. A fresh review is required before submission.',
      FEE_CAP_EXCEEDED:'The current network fee exceeds the reviewed limit. No higher fee was authorized.',
      INPUT_STATE_CHANGED:'An input changed. Reconcile the saved transaction before reviewing another action.',
      NATIVE_VALIDATION_FAILED:'The network validation failed. The saved action needs operator review.'};
    if(op.errorCode && errors[op.errorCode])return errors[op.errorCode];
    if(op.stage==='CONFIRMED')return `Confirmed in block ${op.confirmedHeight?.toLocaleString()}.`;
    if(op.transactionId)return 'Checking the saved transaction automatically. Keep this page open or return later; do not repeat the action.';
    if(op.errorCode)return 'The network check is unavailable. Your reviewed action is saved and has not been submitted.';
    return 'Prepared for review. This action has not been submitted.';
  }
  proposalLabel(kind:string):string {
    return ({UPGRADE:'Protocol code upgrade',REOPEN:'Reopen paused operations',MINT_TEST_ONLY:'Mint a test collection',
      GRANT:'SGT grant',PARAMETERS:'Protocol parameters',STATUTES:'Governed economic fact',FUND_REDEMPTION:'Fund permanent redemption claims'} as Record<string,string>)[kind] || 'Governance proposal';
  }
}
