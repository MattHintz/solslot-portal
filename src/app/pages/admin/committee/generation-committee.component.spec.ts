import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { GenerationSolsBatchesService } from '../../../services/generation-sols-batches.service';
import { provideRouter } from '@angular/router';
import { GenerationCommitteeComponent } from './generation-committee.component';
import { GenerationGovernanceService, GenerationGovernanceStatus, validateGenerationStatus,validateGenerationOperations,GenerationOperations,mergeGenerationReceipt } from '../../../services/generation-governance.service';
import { environment } from '../../../../environments/environment';
import { GenerationConsentService } from '../../../services/generation-consent.service';
import { GenerationBallotService } from '../../../services/generation-ballot.service';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import bills from '../../../utils/generation-public-bill.fixture.json';
import { GovernedBill } from '../../../utils/generation-governed-bill';

describe('Generation committee evidence and refresh',()=>{
  const hash=(n:string)=>'0x'+n.repeat(64);
  const runtime=environment.solslotProtocol as {generationId?:string};
  let old:string|undefined,api:jasmine.SpyObj<GenerationGovernanceService>;
  const status=():GenerationGovernanceStatus=>({generationId:hash('a'),network:'testnet11',status:'READY',
    lastCheckedAt:Math.floor(Date.now()/1000),lastAttemptAt:Math.floor(Date.now()/1000),errorCode:null,pollAfterSeconds:30,
    snapshot:{generationId:hash('a'),network:'testnet11',checkedAt:Math.floor(Date.now()/1000),active:false,
      supply:{total:1000000,distributed:30000,reserve:970000,undeliveredEscrow:0,locked:0,nextProposalQuorum:15000,
        holdingsRoot:hash('b'),sequence:0},exchangeFees:null,stateProof:{supported:false,componentId:hash('c'),moduleHash:hash('f'),version:1,stateHash:hash('2')},
      proposal:null,closedProposalCount:0,approvedActionCount:0,closedStakes:[],closedStakeCount:0,closedStakesTruncated:false,
      approvedActions:[],approvedActionsTruncated:false,pendingUpgrade:null,
      components:[{componentId:hash('c'),launcherId:hash('d'),kernelHash:hash('e'),moduleHash:hash('f'),version:1,compatibility:1}],
      pauseMask:0,pauseEpoch:0,delays:[],componentEvidence:{},chainEvidence:Object.fromEntries(['registry','governance','holdings'].map(k=>[k,
        {coinId:hash('1'),confirmedHeight:10,transitions:1}]))}});
  beforeEach(()=>{
    old=runtime.generationId;runtime.generationId=hash('a');
    api=jasmine.createSpyObj('GenerationGovernanceService',['status','operations','prepare','submit']);api.status.and.callFake(async()=>status());
    api.operations.and.resolveTo({generationId:hash('a'),network:'testnet11',available:true,operations:[],pollAfterSeconds:30,
      executionEnabled:false,maximumFeeMojos:'1000'});
    TestBed.configureTestingModule({imports:[GenerationCommitteeComponent],providers:[provideRouter([]),
      {provide:GenerationGovernanceService,useValue:api},
      {provide:GenerationSolsBatchesService,useValue:{desk:async()=>({generationId:hash('a'),orders:[],catalog:null,operations:[]})}},
      {provide:GenerationConsentService,useValue:{list:async()=>[]}},
      {provide:GenerationBallotService,useValue:{list:async()=>[],holdings:async()=>{throw new Error('not launched');}}},
      {provide:ChiaWalletService,useValue:{connectionKind:()=>null}},
      {provide:AdminSessionService,useValue:{authoritySlot:()=>0,pubkey:()=>null}}]});
  });
  afterEach(()=>{TestBed.resetTestingModule();if(old===undefined)delete runtime.generationId;else runtime.generationId=old;});
  it('reviews explicitly selected complete closed stakes during a pause without polling or automatic submission',async()=>{
    const s=status();s.snapshot!.pauseMask=31;s.snapshot!.supply.locked=20000;
    s.snapshot!.closedStakes=[{coinId:hash('3'),ownerPuzzleHash:hash('4'),amount:10000,proposalId:hash('5')},
      {coinId:hash('6'),ownerPuzzleHash:hash('7'),amount:10000,proposalId:hash('5')}];s.snapshot!.closedStakeCount=2;
    expect(validateGenerationStatus(s)).toBe(s);api.status.and.resolveTo(s);
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();await f.whenStable();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Return closed voting stakes');expect(api.prepare).not.toHaveBeenCalled();
    f.componentInstance.selectStake(hash('3'),true);f.componentInstance.selectStake(hash('3'),true);
    f.componentInstance.selectStake(hash('9'),true);expect(f.componentInstance.selectedStakes()).toEqual([hash('3')]);
    api.prepare.and.callFake(async review=>({generationId:hash('a'),network:'testnet11',operationId:hash('8'),
      intentHash:hash('9'),kind:'UNLOCK_STAKES',stage:'PREPARED',transactionId:null,feeCapMojos:'1000',createdAt:1000,
      updatedAt:1000,lastCheckedAt:null,errorCode:null,confirmedHeight:null,nextAction:'REVIEW_OPERATION',pollAfterSeconds:30,review}));
    await f.componentInstance.reviewAction('UNLOCK_STAKES');f.detectChanges();
    expect(api.prepare.calls.mostRecent().args[0].stakes).toEqual({coinIds:[hash('3')]});
    expect(f.nativeElement.textContent).toContain('No owner signature is needed');expect(api.submit).not.toHaveBeenCalled();
    // Background refresh does not rewrite the saved review or prepare another
    // operation, even when a closed holding disappears from the current list.
    api.status.and.resolveTo(status());await f.componentInstance.refresh.refresh();
    expect(f.componentInstance.reviewedStakes()?.coinIds).toEqual([hash('3')]);expect(api.prepare).toHaveBeenCalledTimes(1);
    const bad=structuredClone(s);bad.snapshot!.closedStakes.push(bad.snapshot!.closedStakes[0]);
    expect(()=>validateGenerationStatus(bad)).toThrow();
    const receipt=f.componentInstance.preparedAction()!;
    expect(validateGenerationOperations({generationId:hash('a'),network:'testnet11',available:true,operations:[receipt],
      executionEnabled:false,maximumFeeMojos:'1000',pollAfterSeconds:30}).operations[0]).toBe(receipt);
  });
  it('offers the rehearsal instruction only after activation and reviews the exact current module and state',async()=>{
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();await f.whenStable();f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('Review upgraded state proof');
    await f.componentInstance.reviewAction('PROVE_STATE');expect(api.prepare).not.toHaveBeenCalled();
    const upgraded=status();upgraded.snapshot!.components[0].version=2;
    upgraded.snapshot!.stateProof={...upgraded.snapshot!.stateProof,supported:true,version:2};
    expect(validateGenerationStatus(upgraded)).toBe(upgraded);
    api.status.and.resolveTo(upgraded);await f.componentInstance.refresh.refresh();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Review upgraded state proof');
    api.prepare.and.callFake(async review=>({generationId:hash('a'),network:'testnet11',operationId:hash('3'),
      intentHash:hash('4'),kind:'PROVE_STATE',stage:'PREPARED',transactionId:null,feeCapMojos:'1000',createdAt:1000,
      updatedAt:1000,lastCheckedAt:null,errorCode:null,confirmedHeight:null,nextAction:'REVIEW_OPERATION',pollAfterSeconds:30,review}));
    await f.componentInstance.reviewAction('PROVE_STATE');f.detectChanges();
    const request=api.prepare.calls.mostRecent().args[0];
    expect(request.proof).toEqual({componentId:hash('c'),moduleHash:hash('f'),version:2,stateHash:hash('2')});
    expect(request.expectedInputs.governance).toBe(hash('1'));
    expect(f.nativeElement.textContent).toContain('does not mint, vote, or install code');
    expect(api.submit).not.toHaveBeenCalled();
    const changed=structuredClone(upgraded);changed.snapshot!.stateProof.moduleHash=hash('9');
    expect(()=>validateGenerationStatus(changed)).toThrow();
  });
  it('rejects another generation, reserve quorum and inconsistent voting or activation deadlines',()=>{
    expect(validateGenerationStatus(status()).snapshot!.supply.nextProposalQuorum).toBe(15000);
    const wrong=status();wrong.generationId=hash('b');expect(()=>validateGenerationStatus(wrong)).toThrow();
    const reserve=status();reserve.snapshot!.supply.nextProposalQuorum=500000;expect(()=>validateGenerationStatus(reserve)).toThrow();
    const delay=status();delay.snapshot!.delays=[{kind:'UPGRADE_ACTIVATION',commitment:hash('1'),ticketId:hash('2'),
      ratifiedAt:100,activationNotBefore:1000,confirmedHeight:5,scope:null}];expect(()=>validateGenerationStatus(delay)).toThrow();
    const proposal=status();proposal.snapshot!.proposal={proposalId:hash('1'),...structuredClone(bills[0].review) as GovernedBill,
      eligibleHoldingsRoot:hash('3'),eligibleSupply:30000,requiredVotes:15000,yesWeight:20000,ledgerSequence:0,
      publicationIssuedAt:100,publicationExpiresAt:86500,openedAt:200,votingClosesAt:3800,stage:'VOTING',selectionRule:'Whole eligible coins'};
    expect(validateGenerationStatus(proposal).snapshot!.proposal!.votingClosesAt).toBe(3800);
    proposal.snapshot!.proposal!.votingClosesAt=3900;expect(()=>validateGenerationStatus(proposal)).toThrow();
  });
  it('shows the actual holder quorum and separate governance stages',fakeAsync(()=>{
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();f.detectChanges();
    const text=f.nativeElement.textContent as string;
    expect(text).toContain('15,000');expect(text).toContain('970,000');expect(text).toContain('24 hours to approve publication');
    expect(text).toContain('One hour from confirmed opening');expect(text).toContain('24 hours for upgrades and reopening');
    expect(text).toContain('Paying fees adds no voting weight');
    tick(29999);expect(api.status).toHaveBeenCalledTimes(1);tick(1);flushMicrotasks();expect(api.status).toHaveBeenCalledTimes(2);
    f.destroy();
  }));
  it('polls active status at five seconds and keeps prior balances on a lost response',fakeAsync(()=>{
    const active=status();active.snapshot!.active=true;api.status.and.resolveTo(active);
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();
    api.status.and.rejectWith(new Error('synthetic network loss'));
    tick(5000);flushMicrotasks();f.detectChanges();
    expect(api.status).toHaveBeenCalledTimes(2);expect(f.componentInstance.snapshot()!.supply.distributed).toBe(30000);
    expect(f.nativeElement.textContent).toContain('Showing the last confirmed state');
    expect(f.componentInstance.isCurrent()).toBeFalse();f.destroy();
  }));
  it('shows the confirmed 0.3% SGT and 0.7% protocol split and rejects unbacked fee evidence',fakeAsync(()=>{
    const s=status();s.snapshot!.componentEvidence[hash('c')]={coinId:hash('2'),confirmedHeight:10,transitions:0,stateHash:hash('3')};
    s.snapshot!.exchangeFees={totalBps:100,protocolBps:70,sgtRewardsBps:30,authorityId:hash('c'),revision:0};
    expect(validateGenerationStatus(s)).toBe(s);api.status.and.resolveTo(s);
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();f.detectChanges();
    const text=f.nativeElement.textContent;
    expect(text).toContain('1% total');expect(text).toContain('0.3% to SGT rewards');expect(text).toContain('0.7% to the protocol');
    const bad=structuredClone(s);bad.snapshot!.exchangeFees!.totalBps=101;
    expect(()=>validateGenerationStatus(bad)).toThrow();
    bad.snapshot!.exchangeFees!.totalBps=100;bad.snapshot!.exchangeFees!.authorityId=hash('9');
    expect(()=>validateGenerationStatus(bad)).toThrow();f.destroy();
  }));
  it('pauses hidden-tab requests and refreshes on return without wallet actions',fakeAsync(()=>{
    let visible=true;spyOnProperty(document,'visibilityState','get').and.callFake(()=>visible?'visible':'hidden');
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();
    visible=false;document.dispatchEvent(new Event('visibilitychange'));tick(60000);flushMicrotasks();
    expect(api.status).toHaveBeenCalledTimes(1);
    visible=true;document.dispatchEvent(new Event('visibilitychange'));flushMicrotasks();
    expect(api.status).toHaveBeenCalledTimes(2);f.destroy();
  }));
  const saved=():GenerationOperations=>({generationId:hash('a'),network:'testnet11',available:true,pollAfterSeconds:5,
    executionEnabled:true,maximumFeeMojos:'1000',
    operations:[{generationId:hash('a'),network:'testnet11',operationId:hash('1'),kind:'ACTIVATE_UPGRADE',intentHash:hash('2'),
      stage:'RECONCILING',transactionId:hash('3'),feeCapMojos:'1000',createdAt:100,updatedAt:101,lastCheckedAt:null,
      errorCode:'RECONCILIATION_REQUIRED',confirmedHeight:null,nextAction:'CHECK_SAVED_TRANSACTION',pollAfterSeconds:5}]});
  it('retains a saved transaction on a lost status response and never offers a duplicate submission',fakeAsync(()=>{
    api.operations.and.resolveTo(saved());
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Checking the saved transaction automatically');
    expect(f.nativeElement.textContent).toContain(hash('3'));
    api.operations.and.rejectWith(new Error('temporarily unavailable'));
    tick(5000);flushMicrotasks();f.detectChanges();
    expect(api.operations).toHaveBeenCalledTimes(2);
    expect(f.componentInstance.isCurrent()).toBeTrue(); // Chain evidence remains independently fresh.
    expect(f.nativeElement.textContent).toContain(hash('3'));
    expect(f.nativeElement.textContent).toContain('do not resubmit a transaction');
    f.destroy();
  }));
  it('rejects operation receipt substitution and false confirmation without a transaction',()=>{
    expect(validateGenerationOperations(saved()).operations[0].stage).toBe('RECONCILING');
    const wrong=saved();wrong.operations[0].generationId=hash('f');expect(()=>validateGenerationOperations(wrong)).toThrow();
    const falseSuccess=saved();falseSuccess.operations[0].stage='CONFIRMED';expect(()=>validateGenerationOperations(falseSuccess)).toThrow();
    const missing=saved();missing.operations[0].transactionId=null;expect(()=>validateGenerationOperations(missing)).toThrow();
  });
  const prepared=()=>({...saved().operations[0],stage:'PREPARED' as const,transactionId:null,errorCode:null,
    kind:'FINALIZE_VOTE',nextAction:'REVIEW_SUBMISSION'});
  for(const kind of ['MINT_COLLECTION','ALLOCATE_SGT_GRANT','DELIVER_SGT_GRANT','GENESIS_CORE'])
    it('does not expose an unintegrated '+kind+' receipt for submission',()=>{
      expect(()=>validateGenerationOperations({...saved(),operations:[{...prepared(),kind}]})).toThrow();
    });
  it('preserves the exact voted fee review when resuming a saved parameter action',fakeAsync(()=>{
    const s=status(),action={proposalId:hash('7'),...structuredClone(bills[1].review) as GovernedBill};
    const authority=action.parameters!.componentId;
    s.snapshot!.components.push({...s.snapshot!.components[0],componentId:authority,launcherId:action.parameters!.launcherId});
    s.snapshot!.componentEvidence[authority]={coinId:hash('2'),confirmedHeight:10,transitions:0,stateHash:hash('3')};
    s.snapshot!.approvedActions=[action];s.snapshot!.approvedActionCount=1;
    expect(validateGenerationStatus(s)).toBe(s);api.status.and.resolveTo(s);api.operations.and.resolveTo({...saved(),operations:[]});
    api.prepare.and.callFake(async request=>({...prepared(),kind:request.kind,review:request}));
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();
    f.componentInstance.reviewAction('APPLY_PARAMETERS',action);flushMicrotasks();f.detectChanges();
    const request=api.prepare.calls.mostRecent().args[0];
    expect(request.parameters).toEqual(action.parameters);expect(request.expectedInputs.components).toEqual({[authority]:hash('2')});
    const receipt=f.componentInstance.preparedAction()!;
    expect(validateGenerationOperations({...saved(),operations:[receipt]}).operations[0]).toEqual(receipt);
    f.componentInstance.resumeSaved(receipt);f.detectChanges();
    expect(f.nativeElement.textContent).toContain('0.3% to SGT rewards');expect(f.nativeElement.textContent).toContain('300 seconds');
    expect(api.submit).not.toHaveBeenCalled();
    const changed=structuredClone(receipt);
    if(changed.review?.kind!=='APPLY_PARAMETERS')throw new Error('parameter receipt fixture required');
    changed.review.parameters!.values[3]=30;changed.review.parameters!.values[4]=70;
    expect(()=>mergeGenerationReceipt(receipt,changed)).toThrow();
    delete changed.review;expect(()=>validateGenerationOperations({...saved(),operations:[changed]})).toThrow();f.destroy();
  }));
  it('prepares a saved action for explicit review while deployment submission stays disabled',fakeAsync(()=>{
    api.prepare.and.resolveTo(prepared());
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();
    f.componentInstance.reviewAction('FINALIZE_VOTE');flushMicrotasks();f.detectChanges();
    expect(api.prepare).toHaveBeenCalledTimes(1);expect(api.submit).not.toHaveBeenCalled();
    const request=api.prepare.calls.mostRecent().args[0];
    expect(request.generationId).toBe(hash('a'));expect(request.feeCapMojos).toBe(1000);
    expect(request.expectedInputs.governance).toBe(hash('1'));
    expect(f.nativeElement.textContent).toContain('Chain submission is disabled');
    f.componentInstance.submitReviewed();flushMicrotasks();expect(api.submit).not.toHaveBeenCalled();
    f.destroy();
  }));
  it('ignores double clicks and retries the same request key after a lost prepare response',fakeAsync(()=>{
    let reject!:(reason:unknown)=>void;
    api.prepare.and.returnValue(new Promise((_,no)=>reject=no));
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();
    f.componentInstance.reviewAction('FINALIZE_VOTE');f.componentInstance.reviewAction('FINALIZE_VOTE');
    expect(api.prepare).toHaveBeenCalledTimes(1);
    const original=structuredClone(api.prepare.calls.first().args[0]);
    reject(new Error('lost prepare response'));flushMicrotasks();
    api.prepare.and.resolveTo(prepared());f.componentInstance.prepareReview();flushMicrotasks();
    expect(api.prepare.calls.mostRecent().args[0]).toEqual(original);
    expect(api.submit).not.toHaveBeenCalled();f.destroy();
  }));
  it('submits only the displayed saved intent and follows its exact transaction after a lost response',fakeAsync(()=>{
    api.operations.and.resolveTo({...saved(),operations:[]});api.prepare.and.resolveTo(prepared());
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();
    f.componentInstance.reviewAction('FINALIZE_VOTE');flushMicrotasks();
    const receipt={...saved().operations[0],kind:'FINALIZE_VOTE'};
    api.operations.and.resolveTo({...saved(),operations:[receipt]});
    api.submit.and.rejectWith(new Error('lost broadcast response'));
    f.componentInstance.submitReviewed();f.componentInstance.submitReviewed();flushMicrotasks();f.detectChanges();
    expect(api.submit).toHaveBeenCalledOnceWith(prepared());
    expect(f.componentInstance.preparedAction()!.transactionId).toBe(receipt.transactionId);
    f.componentInstance.submitReviewed();tick(5000);flushMicrotasks();
    expect(api.submit).toHaveBeenCalledTimes(1);expect(api.prepare).toHaveBeenCalledTimes(1);
    expect(f.nativeElement.textContent).toContain('Check its status below');f.destroy();
  }));
  it('resumes a prepared action from history without rebuilding it or reusing a different fee limit',fakeAsync(()=>{
    const op={...prepared(),feeCapMojos:'77'};
    api.operations.and.resolveTo({...saved(),operations:[op]});api.submit.and.resolveTo({...op,stage:'SUBMITTED',transactionId:hash('9')});
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();
    f.componentInstance.resumeSaved(op);f.componentInstance.submitReviewed();flushMicrotasks();
    expect(api.prepare).not.toHaveBeenCalled();expect(api.submit).toHaveBeenCalledOnceWith(op);
    expect(f.componentInstance.preparedAction()!.transactionId).toBe(hash('9'));
    f.componentInstance.resumeSaved(op);f.componentInstance.submitReviewed();flushMicrotasks();
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.operations()!.operations[0].transactionId).toBe(hash('9'));f.destroy();
  }));
  it('advances an open review during polling without regressing confirmation or accepting a replacement',fakeAsync(()=>{
    api.operations.and.resolveTo({...saved(),operations:[prepared()]});
    const f=TestBed.createComponent(GenerationCommitteeComponent);f.detectChanges();flushMicrotasks();
    f.componentInstance.resumeSaved(prepared());
    const confirmed={...prepared(),stage:'CONFIRMED' as const,transactionId:hash('9'),confirmedHeight:20,updatedAt:103};
    api.operations.and.resolveTo({...saved(),operations:[confirmed]});
    tick(30000);flushMicrotasks();expect(f.componentInstance.preparedAction()!.stage).toBe('CONFIRMED');
    api.operations.and.resolveTo({...saved(),operations:[prepared()]});
    tick(30000);flushMicrotasks();expect(f.componentInstance.preparedAction()!.stage).toBe('CONFIRMED');
    expect(()=>mergeGenerationReceipt(confirmed,{...confirmed,transactionId:hash('8')})).toThrow();
    expect(()=>mergeGenerationReceipt(confirmed,{...confirmed,intentHash:hash('8')})).toThrow();
    expect(()=>mergeGenerationReceipt(confirmed,{...confirmed,feeCapMojos:'99'})).toThrow();
    f.destroy();
  }));
  it('rejects upgrade reviews that change state policy or omit exact source commitment',()=>{
    const s=status();s.snapshot!.approvedActionCount=1;
    s.snapshot!.approvedActions=[{proposalId:hash('1'),...structuredClone(bills[0].review) as GovernedBill}];
    expect(validateGenerationStatus(s)).toBe(s);
    const changed=structuredClone(s);(changed.snapshot!.approvedActions[0].upgrade!.changes[0] as any).transition='REPLACE_STATE';
    expect(()=>validateGenerationStatus(changed)).toThrow();
    delete (s.snapshot!.approvedActions[0].upgrade as any).sourceManifestHash;expect(()=>validateGenerationStatus(s)).toThrow();
  });
});
