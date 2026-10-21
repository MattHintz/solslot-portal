import { TestBed,fakeAsync,flushMicrotasks,tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { GenerationBallotsComponent } from './generation-ballots.component';
import { GenerationBallotService,GenerationBallotReview,HolderCatalog,GenerationBallotSigningError } from '../../../services/generation-ballot.service';
import { GenerationOperationStatus,HolderBallotOperationReview } from '../../../services/generation-governance.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import { environment } from '../../../../environments/environment';
import vector from '../../../utils/generation-holder-ballot.fixture.json';

describe('Holder voting lifecycle UX',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:any,api:jasmine.SpyObj<GenerationBallotService>,session:any;
  const review=()=>structuredClone(vector.review) as unknown as GenerationBallotReview;
  const confirmed=(r:GenerationBallotReview):GenerationOperationStatus=>({
    generationId:r.generationId,network:r.network,operationId:'0x'+'ab'.repeat(32),kind:r.kind,intentHash:'0x'+'cd'.repeat(32),
    stage:'CONFIRMED',transactionId:'0x'+'ef'.repeat(32),feeCapMojos:r.feeCapMojos,createdAt:r.createdAt,updatedAt:r.createdAt+20,
    lastCheckedAt:r.createdAt+20,errorCode:null,confirmedHeight:12345,nextAction:'NONE',pollAfterSeconds:30,
    review:{generationId:r.generationId,requestKey:`ballot:${r.packageId}`,kind:r.kind,packageId:r.packageId,proposalId:r.proposalId,
      selected:structuredClone(r.request.selected),selectedWeight:r.selectedWeight,snapshotRoot:r.snapshotRoot,
      eligibleSupply:r.eligibleSupply,requiredVotes:r.requiredVotes,votingClosesAt:r.votingClosesAt,feeCapMojos:Number(r.feeCapMojos)}
  });
  const catalog=():HolderCatalog=>{const r=review();return {generationId:r.generationId,network:'testnet11',scope:'FROZEN_GENESIS_ROSTER',checkedAt:r.createdAt+10,
    expectedInputs:r.request.expectedInputs,proposalId:null,snapshotRoot:r.snapshotRoot,eligibleSupply:r.eligibleSupply,votingClosesAt:null,truncated:false,
    holdings:r.holders.map((h,i)=>({coinId:h.request.sgtCoinId,vaultLauncherId:h.context.vault.launcherId,name:'Synthetic administrator '+(i+1),
      ownerPuzzleHash:h.request.outputs[0].owner,amount:h.context.holding.current.coin.amount}))};};
  const create=(available=true)=>{const f=TestBed.createComponent(GenerationBallotsComponent);f.componentRef.setInput('available',available);
    f.componentRef.setInput('isCurrent',true);f.componentRef.setInput('maximumFee','1000');f.detectChanges();return f;};
  beforeEach(()=>{
    previous=runtime.generationId;runtime.generationId=vector.review.generationId;
    sessionStorage.removeItem('solslot_generation_holder_prepare:'+runtime.generationId);
    api=jasmine.createSpyObj('GenerationBallotService',['list','holdings','prepare','sign','assemble']);api.list.and.resolveTo([review()]);api.holdings.and.resolveTo(catalog());
    session={jwt:()=> 'synthetic-jwt',pubkey:()=>vector.review.holders[0].context.owner.publicKey};
    TestBed.configureTestingModule({imports:[GenerationBallotsComponent],providers:[provideRouter([]),{provide:GenerationBallotService,useValue:api},
      {provide:AdminSessionService,useValue:session},{provide:ChiaWalletService,useValue:{connectionKind:()=> 'sage-walletconnect'}}]});
    spyOn(Date,'now').and.returnValue((vector.review.createdAt+10)*1000);
  });
  afterEach(()=>{sessionStorage.removeItem('solslot_generation_holder_prepare:'+runtime.generationId);
    if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;});
  it('shows full recipient vaults, whole-input weight and an assigned action without automatic signatures',fakeAsync(()=>{
    const f=create();flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).toContain(review().holders[0].context.vault.launcherId);
    expect(f.nativeElement.textContent).toContain('15,000 quorum at 50%');expect(f.nativeElement.textContent).toContain('Each selected holding counts in full');
    expect(f.nativeElement.textContent).toContain('Your selected holding');
    expect(f.nativeElement.textContent).toContain(review().proposal.upgrade!.sourceManifestHash);
    expect(f.nativeElement.textContent).toContain(review().proposal.upgrade!.changes[0].newModuleHash);
    expect(f.nativeElement.textContent).toContain('24-hour on-chain wait after ratification');
    expect((f.nativeElement.querySelector('.assigned-action button') as HTMLButtonElement).classList).toContain('primary');
    tick(5000);flushMicrotasks();expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.prepare).not.toHaveBeenCalled();expect(api.sign).not.toHaveBeenCalled();expect(api.assemble).not.toHaveBeenCalled();f.destroy();
  }));
  it('shows assigned requests before selection and repeatedly focuses the review with the current signer first',fakeAsync(()=>{
    const r=review();session.pubkey=()=>r.holders[1].context.owner.publicKey;
    const f=create();flushMicrotasks();f.detectChanges();
    const action=f.nativeElement.querySelector('.your-action a') as HTMLAnchorElement;
    const card=f.nativeElement.querySelector('.review') as HTMLElement;
    expect(action.textContent).toContain('Review 10,000 SGT');
    expect(action.compareDocumentPosition(f.nativeElement.querySelector('.select-holdings')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.querySelector('.assigned-action')!.textContent).toContain(r.holders[1].context.vault.launcherId);
    expect(f.componentInstance.reviews()[0].holders.map(h=>h.request.sgtCoinId)).toEqual(r.holders.map(h=>h.request.sgtCoinId));
    const scroll=spyOn(card,'scrollIntoView');action.click();f.detectChanges();
    expect(document.activeElement).toBe(card);action.click();f.detectChanges();expect(scroll).toHaveBeenCalledTimes(2);
    const modified=new MouseEvent('click',{ctrlKey:true,cancelable:true});f.componentInstance.openReview(modified,r.packageId);
    expect(modified.defaultPrevented).toBeFalse();expect(scroll).toHaveBeenCalledTimes(2);
    expect(api.sign).not.toHaveBeenCalled();expect(api.prepare).not.toHaveBeenCalled();f.destroy();
  }));
  it('separates the sponsorship minimum from an eligible smaller whole-holding vote',fakeAsync(()=>{
    const r=review(),c=catalog();c.holdings[0].amount=4000;api.holdings.and.resolveTo(c);
    const f=create();flushMicrotasks();f.componentRef.setInput('consent',{
      packageId:r.request.consentPackageId,proposalId:r.proposalId,proposal:r.proposal,stage:'READY',
      holdingsRoot:c.snapshotRoot,expiresAt:r.expiresAt,feeCapMojos:r.feeCapMojos});
    f.componentInstance.choose(c.holdings[0].coinId,true);f.detectChanges();
    expect(f.nativeElement.querySelector('#holder-title').textContent).toBe('Help open this proposal');
    expect(f.nativeElement.textContent).toContain('At least 10,000 SGT is needed to open a proposal');
    expect(f.componentInstance.canOpen()).toBeFalse();
    c.proposalId=r.proposalId;c.votingClosesAt=r.createdAt+3600;f.componentInstance.catalog.set({...c});
    f.componentRef.setInput('snapshot',{proposal:{proposalId:r.proposalId,openedAt:r.createdAt}});
    f.detectChanges();
    expect(f.nativeElement.querySelector('#holder-title').textContent).toBe('Vote with your SGT');
    expect(f.nativeElement.textContent).not.toContain('At least 10,000 SGT is needed to open a proposal');
    const buttons=Array.from(f.nativeElement.querySelectorAll('.select-holdings button')) as HTMLButtonElement[];
    expect(buttons.length).toBe(1);expect(buttons[0].textContent).toContain('Review yes vote · 4,000 SGT');
    expect(buttons[0].disabled).toBeFalse();expect(f.componentInstance.coinIds()).toEqual([c.holdings[0].coinId]);
    expect(api.prepare).not.toHaveBeenCalled();expect(api.sign).not.toHaveBeenCalled();f.destroy();
  }));
  it('announces the pending wallet prompt and prevents duplicate signatures or status churn',fakeAsync(()=>{
    const f=create();flushMicrotasks();const r=f.componentInstance.reviews()[0];let resolve!:(v:GenerationBallotReview)=>void;
    api.sign.and.returnValue(new Promise(v=>resolve=v));void f.componentInstance.sign(r,r.holders[0]);void f.componentInstance.sign(r,r.holders[0]);flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Open browser wallet and approve the pending SGT signature request.');
    tick(5000);flushMicrotasks();expect(api.sign).toHaveBeenCalledTimes(1);expect(api.list).toHaveBeenCalledTimes(1);
    resolve({...r,signatures:[{coinId:r.request.selected[0].coinId,signedAt:r.createdAt+10}]});flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Signature recorded');f.destroy();
  }));
  it('names Sage when a BLS prompt is waiting instead of leaving a generic connecting state',fakeAsync(()=>{
    const r=review();r.holders[0].context.owner.authType=1;api.list.and.resolveTo([r]);api.sign.and.returnValue(new Promise(()=>{}));
    const f=create();flushMicrotasks();void f.componentInstance.sign(f.componentInstance.reviews()[0],f.componentInstance.reviews()[0].holders[0]);flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Open Sage and approve the pending SGT signature request.');f.destroy();
  }));
  it('retains a signature after a lost response, stale poll and original deadline',fakeAsync(()=>{
    const f=create();flushMicrotasks();const r=f.componentInstance.reviews()[0],confirmed={...r,signatures:[{coinId:r.request.selected[0].coinId,signedAt:r.createdAt+10}]};
    api.sign.and.rejectWith(new Error('synthetic network loss'));api.list.and.resolveTo([confirmed]);void f.componentInstance.sign(r,r.holders[0]);flushMicrotasks();
    expect(f.componentInstance.signed(f.componentInstance.reviews()[0],r.holders[0])).toBeTrue();
    api.list.and.resolveTo([r]);void f.componentInstance.refresh.refresh();flushMicrotasks();
    expect(f.componentInstance.signed(f.componentInstance.reviews()[0],r.holders[0])).toBeTrue();expect(f.componentInstance.reviews()[0].expiresAt).toBe(r.expiresAt);f.destroy();
  }));
  for(const reason of ['WALLET_PENDING','WALLET_REJECTED','WALLET_UNAVAILABLE','WRONG_ACCOUNT','REVIEW_CHANGED'] as const){
    it('shows actionable '+reason+' feedback from the holder button and preserves the saved review',fakeAsync(()=>{
      const f=create();flushMicrotasks();f.detectChanges();const original=structuredClone(f.componentInstance.reviews()[0]);
      const failure=new GenerationBallotSigningError(reason,original.holders[0].context.owner.address);api.sign.and.rejectWith(failure);
      (f.nativeElement.querySelector('.assigned-action button') as HTMLButtonElement).click();flushMicrotasks();f.detectChanges();
      expect(api.sign).toHaveBeenCalledOnceWith(original,original.holders[0].request.sgtCoinId);
      expect(f.nativeElement.textContent).toContain(failure.message);expect(f.componentInstance.reviews()[0]).toEqual(original);
      expect(f.componentInstance.busy()).toBeNull();expect(api.prepare).not.toHaveBeenCalled();expect(api.assemble).not.toHaveBeenCalled();f.destroy();
    }));
  }
  it('does not render arbitrary provider or HTTP response bodies',fakeAsync(()=>{
    const f=create();flushMicrotasks();const r=f.componentInstance.reviews()[0];api.sign.and.rejectWith(new Error('<html>private upstream payload</html>'));
    void f.componentInstance.sign(r,r.holders[0]);flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('A lost response does not erase a recorded signature');
    expect(f.nativeElement.textContent).not.toContain('private upstream payload');f.destroy();
  }));
  it('loads saved holder reviews immediately when access becomes ready without a fake successful check',fakeAsync(()=>{
    const f=create(false);flushMicrotasks();f.detectChanges();
    expect(api.list).not.toHaveBeenCalled();expect(api.holdings).not.toHaveBeenCalled();expect(f.componentInstance.refresh.lastUpdated()).toBeNull();
    f.componentRef.setInput('available',true);f.detectChanges();flushMicrotasks();f.detectChanges();
    expect(api.list).toHaveBeenCalledTimes(1);expect(api.holdings).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.assignedActions().length).toBe(1);expect(api.sign).not.toHaveBeenCalled();expect(api.prepare).not.toHaveBeenCalled();f.destroy();
  }));
  it('refreshes after a new sign-in without polling or duplicate reads during a pending wallet action',fakeAsync(()=>{
    const key=signal<string|null>(null);session.pubkey=key;
    const f=create();flushMicrotasks();f.detectChanges();expect(api.list).not.toHaveBeenCalled();
    key.set(review().holders[0].context.owner.publicKey);f.detectChanges();flushMicrotasks();f.detectChanges();expect(api.list).toHaveBeenCalledTimes(1);
    let complete!:(r:GenerationBallotReview)=>void;api.sign.and.returnValue(new Promise(resolve=>complete=resolve));
    const r=f.componentInstance.reviews()[0];void f.componentInstance.sign(r,r.holders[0]);flushMicrotasks();f.detectChanges();
    key.set(r.holders[1].context.owner.publicKey);f.detectChanges();flushMicrotasks();f.detectChanges();
    expect(api.list).toHaveBeenCalledTimes(1);expect(api.sign).toHaveBeenCalledTimes(1);
    complete(r);flushMicrotasks();f.detectChanges();flushMicrotasks();f.detectChanges();
    expect(api.list).toHaveBeenCalledTimes(2);expect(api.holdings).toHaveBeenCalledTimes(2);expect(api.sign).toHaveBeenCalledTimes(1);f.destroy();
  }));
  for(const change of ['logout','account','token','generation'] as const){
    it('discards delayed holder reads after '+change+' without marking the old session successful',fakeAsync(()=>{
      const key=signal<string|null>(review().holders[0].context.owner.publicKey),token=signal<string|null>('synthetic-jwt');
      session.pubkey=key;session.jwt=token;let resolveReviews!:(r:GenerationBallotReview[])=>void,resolveCatalog!:(c:HolderCatalog)=>void;
      api.list.and.returnValue(new Promise(resolve=>resolveReviews=resolve));api.holdings.and.returnValue(new Promise(resolve=>resolveCatalog=resolve));
      const f=create();flushMicrotasks();f.detectChanges();expect(api.list).toHaveBeenCalledTimes(1);
      if(change==='logout'){key.set(null);token.set(null);}
      if(change==='account')key.set(review().holders[1].context.owner.publicKey);
      if(change==='token')token.set('replacement-session');
      if(change==='generation')runtime.generationId='0x'+'55'.repeat(32);
      f.detectChanges();flushMicrotasks();expect(api.list).toHaveBeenCalledTimes(1);
      resolveReviews([review()]);resolveCatalog(catalog());flushMicrotasks();
      expect(f.componentInstance.reviews()).toEqual([]);expect(f.componentInstance.catalog()).toBeNull();
      expect(f.componentInstance.refresh.lastUpdated()).toBeNull();expect(f.componentInstance.refresh.error()).not.toBeNull();
      expect(api.sign).not.toHaveBeenCalled();expect(api.prepare).not.toHaveBeenCalled();
      if(change==='account' || change==='token'){
        api.list.and.resolveTo([]);api.holdings.and.resolveTo(catalog());f.detectChanges();flushMicrotasks();f.detectChanges();
        expect(api.list).toHaveBeenCalledTimes(2);expect(api.holdings).toHaveBeenCalledTimes(2);
      }
      f.destroy();
    }));
  }
  it('rejects altered cached deadlines and locally stops expired signature actions',fakeAsync(()=>{
    const f=create();flushMicrotasks();const r=f.componentInstance.reviews()[0];
    api.list.and.resolveTo([{...r,expiresAt:r.expiresAt+100}]);void f.componentInstance.refresh.refresh();flushMicrotasks();
    expect(f.componentInstance.refresh.error()).not.toBeNull();expect(f.componentInstance.reviews()[0].expiresAt).toBe(r.expiresAt);
    f.componentInstance.refresh.now.set(r.expiresAt*1000);void f.componentInstance.sign(r,r.holders[0]);flushMicrotasks();f.detectChanges();
    expect(api.sign).not.toHaveBeenCalled();expect(f.nativeElement.textContent).toContain('Signing window ended');f.destroy();
  }));
  it('selects complete inputs without inventing amounts and preserves selection when the input disappears',fakeAsync(()=>{
    const f=create();flushMicrotasks();const c=catalog();f.componentInstance.choose(c.holdings[0].coinId,true);f.componentInstance.choose(c.holdings[1].coinId,true);
    expect(f.componentInstance.selectedWeight()).toBe(20000);
    api.holdings.and.resolveTo({...c,holdings:[c.holdings[1]]});void f.componentInstance.refresh.refresh();flushMicrotasks();
    expect(f.componentInstance.coinIds().length).toBe(2);expect(f.componentInstance.canPrepare()).toBeFalse();
    expect(api.prepare).not.toHaveBeenCalled();f.destroy();
  }));
  it('limits a whole-holding review to 32 unique inputs without silently dropping any selection',fakeAsync(()=>{
    const c=catalog();c.holdings=Array.from({length:33},(_,i)=>({name:'Synthetic holder '+i,ownerPuzzleHash:c.holdings[0].ownerPuzzleHash,
      coinId:'0x'+(i+1).toString(16).padStart(64,'0'),vaultLauncherId:'0x'+(i+101).toString(16).padStart(64,'0'),amount:100}));
    api.holdings.and.resolveTo(c);const f=create();flushMicrotasks();const component=f.componentInstance;
    c.holdings.slice(0,32).forEach(h=>component.choose(h.coinId,true));component.choose(c.holdings[0].coinId,true);
    expect(component.coinIds().length).toBe(32);expect(component.selectedWeight()).toBe(3200);expect(component.canPrepare()).toBeTrue();
    component.choose(c.holdings[32].coinId,true);
    expect(component.coinIds()).toEqual(c.holdings.slice(0,32).map(h=>h.coinId));expect(component.error()).toContain('32 holdings');
    component.choose(c.holdings[0].coinId,false);component.choose(c.holdings[32].coinId,true);
    expect(component.coinIds().length).toBe(32);expect(component.canPrepare()).toBeTrue();
    component.coinIds.set(c.holdings.map(h=>h.coinId));expect(component.canPrepare()).toBeFalse();
    component.coinIds.set([c.holdings[0].coinId,c.holdings[0].coinId]);expect(component.canPrepare()).toBeFalse();
    expect(api.prepare).not.toHaveBeenCalled();f.destroy();
  }));
  it('keeps native checkbox state aligned at the 32-holding limit and allows deselection',fakeAsync(()=>{
    const c=catalog();c.holdings=Array.from({length:33},(_,i)=>({name:'Synthetic holder '+i,ownerPuzzleHash:c.holdings[0].ownerPuzzleHash,
      coinId:'0x'+(i+1).toString(16).padStart(64,'0'),vaultLauncherId:'0x'+(i+101).toString(16).padStart(64,'0'),amount:100}));
    api.holdings.and.resolveTo(c);const f=create();flushMicrotasks();f.detectChanges();
    const inputs=Array.from(f.nativeElement.querySelectorAll('.holding input')) as HTMLInputElement[];
    inputs.slice(0,32).forEach(input=>{input.click();f.detectChanges();});
    expect(inputs.slice(0,32).every(input=>input.checked && !input.disabled)).toBeTrue();
    expect(inputs[32].disabled).toBeTrue();inputs[32].click();f.detectChanges();
    expect(inputs[32].checked).toBeFalse();expect(f.componentInstance.coinIds()).toEqual(c.holdings.slice(0,32).map(h=>h.coinId));
    expect(f.nativeElement.querySelector('.weight').textContent).toContain('32 holdings selected · 3,200 SGT');
    inputs[0].click();f.detectChanges();expect(inputs[0].checked).toBeFalse();expect(inputs[32].disabled).toBeFalse();
    inputs[32].click();f.detectChanges();
    expect(inputs[32].checked).toBeTrue();expect(inputs[32].disabled).toBeFalse();
    expect(inputs[0].checked).toBeFalse();expect(inputs[0].disabled).toBeTrue();
    expect(f.componentInstance.coinIds()).toEqual(c.holdings.slice(1).map(h=>h.coinId));
    expect(api.prepare).not.toHaveBeenCalled();expect(api.sign).not.toHaveBeenCalled();f.destroy();
  }));
  it('disables competing holdings from a selected vault and re-enables them after deselection',fakeAsync(()=>{
    const c=catalog(),original=c.holdings[0],other=c.holdings[1];
    c.holdings=[original,{...original,coinId:'0x'+'11'.repeat(32)},other];
    api.holdings.and.resolveTo(c);const f=create();flushMicrotasks();f.detectChanges();
    const inputs=Array.from(f.nativeElement.querySelectorAll('.holding input')) as HTMLInputElement[];
    inputs[0].click();f.detectChanges();
    expect(inputs[0].checked).toBeTrue();expect(inputs[0].disabled).toBeFalse();expect(inputs[1].disabled).toBeTrue();
    inputs[1].click();f.detectChanges();expect(inputs[1].checked).toBeFalse();expect(inputs[2].disabled).toBeFalse();
    inputs[2].click();f.detectChanges();expect(inputs[2].checked).toBeTrue();
    inputs[0].click();f.detectChanges();expect(inputs[1].disabled).toBeFalse();inputs[1].click();f.detectChanges();
    expect(inputs[1].checked).toBeTrue();expect(inputs[1].disabled).toBeFalse();
    expect(inputs[0].checked).toBeFalse();expect(inputs[0].disabled).toBeTrue();
    expect(f.componentInstance.coinIds()).toEqual([c.holdings[2].coinId,c.holdings[1].coinId]);
    expect(api.prepare).not.toHaveBeenCalled();expect(api.sign).not.toHaveBeenCalled();f.destroy();
  }));
  it('keeps verified confirmed reviews successful after expiry without changing signing deadlines',fakeAsync(()=>{
    const r=review(),f=create();flushMicrotasks();
    f.componentRef.setInput('operations',[confirmed(r)]);f.componentInstance.refresh.now.set(r.expiresAt*1000);f.detectChanges();
    const card=f.nativeElement.querySelector('.review') as HTMLElement;
    expect(card.classList.contains('expired')).toBeFalse();
    expect(card.textContent).toContain('confirmed in block 12,345');
    expect(card.textContent).not.toContain('Signing window ended');expect(card.querySelector('button')).toBeNull();
    expect(f.componentInstance.expired(r)).toBeTrue();expect(f.componentInstance.reviews()[0].expiresAt).toBe(r.expiresAt);
    void f.componentInstance.sign(r,r.holders[0]);flushMicrotasks();expect(api.sign).not.toHaveBeenCalled();
    f.componentRef.setInput('operations',[]);f.detectChanges();
    expect(card.classList.contains('expired')).toBeTrue();expect(card.textContent).toContain('Signing window ended');f.destroy();
  }));
  it('does not present unconfirmed or mismatched operation receipts as a successful vote',fakeAsync(()=>{
    const r=review(),f=create();flushMicrotasks();f.componentInstance.refresh.now.set(r.expiresAt*1000);
    const mutations:Array<(op:GenerationOperationStatus)=>void>=[
      op=>{op.stage='SUBMITTED';op.confirmedHeight=null;},op=>{op.transactionId=null;},op=>{op.confirmedHeight=0;},
      op=>{op.generationId='0x'+'11'.repeat(32);},
      op=>{(op.review as HolderBallotOperationReview).packageId='0x'+'22'.repeat(32);},
      op=>{(op.review as HolderBallotOperationReview).proposalId='0x'+'33'.repeat(32);},
      op=>{(op.review as HolderBallotOperationReview).snapshotRoot='0x'+'44'.repeat(32);},
      op=>{(op.review as HolderBallotOperationReview).selectedWeight+=1;},
      op=>{(op.review as HolderBallotOperationReview).selected[0].coinId='0x'+'55'.repeat(32);},
      op=>{op.feeCapMojos=String(Number(op.feeCapMojos)+1);}
    ];
    for(const mutate of mutations){
      const receipt=confirmed(r);mutate(receipt);f.componentRef.setInput('operations',[receipt]);f.detectChanges();
      expect(f.componentInstance.confirmedReceipt(r)).toBeUndefined();
      expect(f.nativeElement.querySelector('.review').textContent).toContain('Signing window ended');
    }
    expect(api.sign).not.toHaveBeenCalled();expect(api.assemble).not.toHaveBeenCalled();f.destroy();
  }));
  it('persists a failed preparation key across refresh and retries only the exact request',fakeAsync(()=>{
    const r=review(),req=r.request,key='solslot_generation_holder_prepare:'+r.generationId;sessionStorage.setItem(key,JSON.stringify(req));
    api.list.and.resolveTo([]);const f=create();api.prepare.and.rejectWith(new Error('lost preparation response'));flushMicrotasks();
    void f.componentInstance.retry();flushMicrotasks();expect(api.prepare.calls.mostRecent().args[0]).toEqual(req);
    expect(sessionStorage.getItem(key)).toBe(JSON.stringify(req));expect(f.componentInstance.pending()).toEqual(req);
    f.componentInstance.choose(catalog().holdings[0].coinId,true);expect(f.componentInstance.canPrepare()).toBeFalse();f.destroy();
  }));
  it('pauses hidden-tab polling and refreshes on return without wallet prompts',fakeAsync(()=>{
    let visible=true;spyOnProperty(document,'visibilityState','get').and.callFake(()=>visible?'visible':'hidden');
    const f=create();flushMicrotasks();visible=false;document.dispatchEvent(new Event('visibilitychange'));tick(30000);flushMicrotasks();
    expect(api.list).toHaveBeenCalledTimes(1);visible=true;document.dispatchEvent(new Event('visibilitychange'));flushMicrotasks();
    expect(api.list).toHaveBeenCalledTimes(2);expect(api.sign).not.toHaveBeenCalled();f.destroy();
  }));
  it('shows only the scoped reopening effect before signing',fakeAsync(()=>{
    const r=review();r.proposal={kind:'REOPEN',billHash:r.proposal.billHash,pauseEpoch:2,scope:3};api.list.and.resolveTo([r]);
    const f=create();flushMicrotasks();f.detectChanges();
    const card=f.nativeElement.querySelector('.review');expect(card.textContent).toContain('New proposals');expect(card.textContent).toContain('New mints');
    expect(card.textContent).not.toContain('New offers');expect(card.textContent).toContain('24-hour on-chain wait');
    expect(card.textContent).toContain('funded redemptions and earned claims stay available');
    expect(api.sign).not.toHaveBeenCalled();f.destroy();
  }));
});
