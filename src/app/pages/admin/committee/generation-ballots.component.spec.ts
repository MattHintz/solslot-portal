import { TestBed,fakeAsync,flushMicrotasks,tick } from '@angular/core/testing';
import { GenerationBallotsComponent } from './generation-ballots.component';
import { GenerationBallotService,GenerationBallotReview,HolderCatalog } from '../../../services/generation-ballot.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import { environment } from '../../../../environments/environment';
import vector from '../../../utils/generation-holder-ballot.fixture.json';

describe('Holder voting lifecycle UX',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:any,api:jasmine.SpyObj<GenerationBallotService>,session:any;
  const review=()=>structuredClone(vector.review) as unknown as GenerationBallotReview;
  const catalog=():HolderCatalog=>{const r=review();return {generationId:r.generationId,network:'testnet11',scope:'FROZEN_GENESIS_ROSTER',checkedAt:r.createdAt+10,
    expectedInputs:r.request.expectedInputs,proposalId:null,snapshotRoot:r.snapshotRoot,eligibleSupply:r.eligibleSupply,votingClosesAt:null,truncated:false,
    holdings:r.holders.map((h,i)=>({coinId:h.request.sgtCoinId,vaultLauncherId:h.context.vault.launcherId,name:'Synthetic administrator '+(i+1),
      ownerPuzzleHash:h.request.outputs[0].owner,amount:h.context.holding.current.coin.amount}))};};
  const create=()=>{const f=TestBed.createComponent(GenerationBallotsComponent);f.componentRef.setInput('available',true);
    f.componentRef.setInput('isCurrent',true);f.componentRef.setInput('maximumFee','1000');f.detectChanges();return f;};
  beforeEach(()=>{
    previous=runtime.generationId;runtime.generationId=vector.review.generationId;
    sessionStorage.removeItem('solslot_generation_holder_prepare:'+runtime.generationId);
    api=jasmine.createSpyObj('GenerationBallotService',['list','holdings','prepare','sign','assemble']);api.list.and.resolveTo([review()]);api.holdings.and.resolveTo(catalog());
    session={pubkey:()=>vector.review.holders[0].context.owner.publicKey};
    TestBed.configureTestingModule({imports:[GenerationBallotsComponent],providers:[{provide:GenerationBallotService,useValue:api},
      {provide:AdminSessionService,useValue:session},{provide:ChiaWalletService,useValue:{connectionKind:()=> 'sage-walletconnect'}}]});
    spyOn(Date,'now').and.returnValue((vector.review.createdAt+10)*1000);
  });
  afterEach(()=>{sessionStorage.removeItem('solslot_generation_holder_prepare:'+runtime.generationId);
    if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;});
  it('shows full recipient vaults, whole-input weight and an assigned action without automatic signatures',fakeAsync(()=>{
    const f=create();flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).toContain(review().holders[0].context.vault.launcherId);
    expect(f.nativeElement.textContent).toContain('15,000 quorum at 50%');expect(f.nativeElement.textContent).toContain('Each holder keeps custody');
    expect(f.nativeElement.textContent).toContain('Your selected holding');
    expect(f.nativeElement.textContent).toContain(review().proposal.upgrade!.sourceManifestHash);
    expect(f.nativeElement.textContent).toContain(review().proposal.upgrade!.changes[0].newModuleHash);
    expect(f.nativeElement.textContent).toContain('24-hour on-chain wait after ratification');
    expect((f.nativeElement.querySelector('.assigned-action button') as HTMLButtonElement).classList).toContain('primary');
    tick(5000);flushMicrotasks();expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.prepare).not.toHaveBeenCalled();expect(api.sign).not.toHaveBeenCalled();expect(api.assemble).not.toHaveBeenCalled();f.destroy();
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
  it('persists a failed preparation key across refresh and retries only the exact request',fakeAsync(()=>{
    const r=review(),req=r.request,key='solslot_generation_holder_prepare:'+r.generationId;sessionStorage.setItem(key,JSON.stringify(req));
    api.list.and.resolveTo([]);const f=create();api.prepare.and.rejectWith(new Error('lost preparation response'));flushMicrotasks();
    void f.componentInstance.retry();flushMicrotasks();expect(api.prepare.calls.mostRecent().args[0]).toEqual(req);
    expect(sessionStorage.getItem(key)).toBe(JSON.stringify(req));expect(f.componentInstance.pending()).toEqual(req);f.destroy();
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
