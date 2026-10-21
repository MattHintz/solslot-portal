import { TestBed,fakeAsync,flushMicrotasks,tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { GenerationConsentsComponent } from './generation-consents.component';
import { GenerationConsentService,GenerationConsentReview,GenerationConsentSigningError } from '../../../services/generation-consent.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { environment } from '../../../../environments/environment';
import vector from '../../../utils/generation-consent.fixture.json';

describe('Saved administrator consent UX',()=>{
  let api:jasmine.SpyObj<GenerationConsentService>,session:any;
  const review=()=>structuredClone(vector.review) as unknown as GenerationConsentReview;
  const confirmed=(r:GenerationConsentReview,slot:number)=>({...r,signatures:[...r.signatures,{slot,signedAt:r.createdAt+10}],
    stage:r.signatures.length===1?'READY' as const:'AWAITING_APPROVALS' as const});
  const create=(available=true)=>{
    const f=TestBed.createComponent(GenerationConsentsComponent);f.componentRef.setInput('available',available);
    f.componentRef.setInput('isCurrent',true);f.componentRef.setInput('maximumFee','1000');f.detectChanges();return f;
  };
  beforeEach(()=>{
    const r=review();api=jasmine.createSpyObj('GenerationConsentService',['list','prepare','sign','preparePause']);api.list.and.resolveTo([r]);
    session={jwt:()=> 'synthetic-jwt',authoritySlot:()=>0,pubkey:()=>r.challenges[0].publicKey};
    TestBed.configureTestingModule({imports:[GenerationConsentsComponent],providers:[provideRouter([]),
      {provide:GenerationConsentService,useValue:api},{provide:AdminSessionService,useValue:session}]});
    spyOn(Date,'now').and.returnValue((r.createdAt+10)*1000);
  });
  it('makes the assigned wallet action prominent and polls without asking for a signature',fakeAsync(()=>{
    const f=create();flushMicrotasks();f.detectChanges();
    const buttons=[...f.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons.find(b=>b.textContent?.includes('Approve publication in wallet'))?.classList).toContain('primary');
    expect(f.nativeElement.textContent).toContain('Your assigned action');expect(f.nativeElement.textContent).toContain('Approve by');
    expect(f.nativeElement.textContent).toContain('24 hours');expect(f.nativeElement.textContent).toContain('15,000 required');
    tick(5000);flushMicrotasks();expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.sign).not.toHaveBeenCalled();expect(api.prepare).not.toHaveBeenCalled();expect(api.preparePause).not.toHaveBeenCalled();f.destroy();
  }));
  it('announces the wallet prompt, blocks duplicate clicks and pauses reads during signing',fakeAsync(()=>{
    let complete!:(r:GenerationConsentReview)=>void;
    api.sign.and.returnValue(new Promise(resolve=>complete=resolve));
    const f=create();flushMicrotasks();const r=f.componentInstance.reviews()[0];
    void f.componentInstance.sign(r);void f.componentInstance.sign(r);flushMicrotasks();f.detectChanges();
    expect(api.sign).toHaveBeenCalledTimes(1);expect(f.nativeElement.textContent).toContain('Open your administrator wallet and approve the pending signature request.');
    expect(f.nativeElement.querySelector('button.primary').disabled).toBeTrue();
    tick(5000);flushMicrotasks();expect(api.list).toHaveBeenCalledTimes(1);
    complete(confirmed(r,0));flushMicrotasks();f.detectChanges();
    expect(f.componentInstance.busy()).toBeNull();expect(f.nativeElement.textContent).toContain('Approval recorded');
    expect(api.list).toHaveBeenCalledTimes(2);f.destroy();
  }));
  it('keeps recorded consent after a lost signing response and a stale cached response',fakeAsync(()=>{
    const f=create();flushMicrotasks();const r=f.componentInstance.reviews()[0];
    api.sign.and.rejectWith(new Error('synthetic lost response'));api.list.and.resolveTo([confirmed(r,0)]);
    void f.componentInstance.sign(r);flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('A lost response does not erase a recorded approval');
    expect(f.componentInstance.approved(f.componentInstance.reviews()[0],0)).toBeTrue();
    api.list.and.resolveTo([r]);void f.componentInstance.refresh.refresh();flushMicrotasks();
    expect(f.componentInstance.approved(f.componentInstance.reviews()[0],0)).toBeTrue();
    expect(f.componentInstance.reviews()[0].expiresAt).toBe(r.expiresAt);expect(api.sign).toHaveBeenCalledTimes(1);f.destroy();
  }));
  for(const failure of [
    new GenerationConsentSigningError('WALLET_PENDING'),
    new GenerationConsentSigningError('WALLET_REJECTED'),
    new GenerationConsentSigningError('WRONG_ACCOUNT','0x1234'),
  ]){
    it('shows actionable '+failure.reason+' feedback from the actual approval button and keeps the saved review',fakeAsync(()=>{
      const f=create();flushMicrotasks();f.detectChanges();const original=structuredClone(f.componentInstance.reviews()[0]);
      api.sign.and.rejectWith(failure);
      const button=([...f.nativeElement.querySelectorAll('button')] as HTMLButtonElement[])
        .find(b=>b.textContent?.includes('Approve publication in wallet'))!;
      button.click();flushMicrotasks();f.detectChanges();
      expect(api.sign).toHaveBeenCalledOnceWith(original);
      expect(f.nativeElement.textContent).toContain(failure.message);
      expect(f.nativeElement.textContent).not.toContain('Approval was not completed.');
      expect(f.componentInstance.reviews()[0]).toEqual(original);expect(f.componentInstance.busy()).toBeNull();
      expect(button.disabled).toBeFalse();expect(api.prepare).not.toHaveBeenCalled();f.destroy();
    }));
  }
  it('does not render arbitrary provider or HTTP error text',fakeAsync(()=>{
    const f=create();flushMicrotasks();api.sign.and.rejectWith(new Error('<html>private upstream payload</html>'));
    void f.componentInstance.sign(f.componentInstance.reviews()[0]);flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('A lost response does not erase a recorded approval');
    expect(f.nativeElement.textContent).not.toContain('private upstream payload');f.destroy();
  }));
  it('loads saved approvals immediately when access becomes ready without a fake successful check',fakeAsync(()=>{
    const f=create(false);flushMicrotasks();f.detectChanges();
    expect(api.list).not.toHaveBeenCalled();expect(f.componentInstance.refresh.lastUpdated()).toBeNull();
    f.componentRef.setInput('available',true);f.detectChanges();flushMicrotasks();f.detectChanges();
    expect(api.list).toHaveBeenCalledTimes(1);expect(f.componentInstance.reviews().length).toBe(1);
    expect(api.sign).not.toHaveBeenCalled();expect(api.prepare).not.toHaveBeenCalled();expect(api.preparePause).not.toHaveBeenCalled();f.destroy();
  }));
  it('refreshes after a new sign-in without polling or duplicate reads during a pending wallet action',fakeAsync(()=>{
    const key=signal<string|null>(null);session.pubkey=key;
    const f=create();flushMicrotasks();f.detectChanges();expect(api.list).not.toHaveBeenCalled();
    key.set(review().challenges[0].publicKey);f.detectChanges();flushMicrotasks();f.detectChanges();expect(api.list).toHaveBeenCalledTimes(1);
    let complete!:(r:GenerationConsentReview)=>void;api.sign.and.returnValue(new Promise(resolve=>complete=resolve));
    const r=f.componentInstance.reviews()[0];void f.componentInstance.sign(r);flushMicrotasks();f.detectChanges();
    key.set(r.challenges[1].publicKey);f.detectChanges();flushMicrotasks();f.detectChanges();
    expect(api.list).toHaveBeenCalledTimes(1);expect(api.sign).toHaveBeenCalledTimes(1);
    complete(r);flushMicrotasks();f.detectChanges();flushMicrotasks();f.detectChanges();
    expect(api.list).toHaveBeenCalledTimes(2);expect(api.sign).toHaveBeenCalledTimes(1);f.destroy();
  }));
  for(const change of ['logout','account','token','generation'] as const){
    it('discards delayed approval reads after '+change+' without marking the old session successful',fakeAsync(()=>{
      const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string},oldGeneration=runtime.generationId;
      const key=signal<string|null>(review().challenges[0].publicKey),token=signal<string|null>('synthetic-jwt');
      session.pubkey=key;session.jwt=token;let resolveReviews!:(r:GenerationConsentReview[])=>void;
      api.list.and.returnValue(new Promise(resolve=>resolveReviews=resolve));
      const f=create();flushMicrotasks();f.detectChanges();expect(api.list).toHaveBeenCalledTimes(1);
      if(change==='logout'){key.set(null);token.set(null);}
      if(change==='account')key.set(review().challenges[1].publicKey);
      if(change==='token')token.set('replacement-session');
      if(change==='generation')runtime.generationId='0x'+'55'.repeat(32);
      f.detectChanges();flushMicrotasks();expect(api.list).toHaveBeenCalledTimes(1);
      resolveReviews([review()]);flushMicrotasks();
      expect(f.componentInstance.reviews()).toEqual([]);expect(f.componentInstance.refresh.lastUpdated()).toBeNull();
      expect(f.componentInstance.refresh.error()).not.toBeNull();expect(api.sign).not.toHaveBeenCalled();expect(api.prepare).not.toHaveBeenCalled();
      if(change==='account' || change==='token'){
        api.list.and.resolveTo([]);f.detectChanges();flushMicrotasks();f.detectChanges();expect(api.list).toHaveBeenCalledTimes(2);
      }
      f.destroy();if(oldGeneration===undefined)delete runtime.generationId;else runtime.generationId=oldGeneration;
    }));
  }
  it('preserves the review and exposes a refresh failure instead of accepting changed commitments',fakeAsync(()=>{
    const f=create();flushMicrotasks();const r=f.componentInstance.reviews()[0];
    api.list.and.resolveTo([{...r,expiresAt:r.expiresAt+100}]);void f.componentInstance.refresh.refresh();flushMicrotasks();f.detectChanges();
    expect(f.componentInstance.reviews()[0].expiresAt).toBe(r.expiresAt);expect(f.componentInstance.refresh.error()).not.toBeNull();
    expect(f.nativeElement.textContent).toContain('Previous results are still shown');f.destroy();
  }));
  it('disables expired approval locally and cannot revive a saved expiry on a stale poll',fakeAsync(()=>{
    const f=create();flushMicrotasks();const r=f.componentInstance.reviews()[0];
    f.componentInstance.refresh.now.set(r.expiresAt*1000);f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Review expired');expect(f.nativeElement.textContent).not.toContain('Approve publication in wallet');
    void f.componentInstance.sign(r);flushMicrotasks();expect(api.sign).not.toHaveBeenCalled();
    api.list.and.resolveTo([{...r,stage:'EXPIRED'}]);void f.componentInstance.refresh.refresh();flushMicrotasks();
    api.list.and.resolveTo([r]);void f.componentInstance.refresh.refresh();flushMicrotasks();
    expect(f.componentInstance.reviews()[0].stage).toBe('EXPIRED');f.destroy();
  }));
  it('does not show another administrator a signing button and identifies the next holder step',fakeAsync(()=>{
    const r=review();session.authoritySlot=()=>2;session.pubkey=()=>r.challenges[0].publicKey;
    api.list.and.resolveTo([confirmed(confirmed(r,0),1)]);
    const f=create();flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('Approve publication in wallet');
    expect(f.nativeElement.textContent).toContain('holders sponsor the proposal with at least 10,000 SGT');
    expect(f.nativeElement.textContent).toContain('These approvals add no voting weight');
    expect(api.preparePause).not.toHaveBeenCalled();f.destroy();
  }));
  it('offers recovery of a failed new review even when an older review was selected',fakeAsync(()=>{
    const f=create();flushMicrotasks();f.componentInstance.selected.set(review());
    f.componentRef.setInput('snapshot',{generationId:vector.review.generationId,stateProof:{version:1},pauseMask:0,chainEvidence:Object.fromEntries(
      ['registry','governance','holdings'].map(k=>[k,{coinId:vector.request.expectedInputs[k as keyof typeof vector.request.expectedInputs]}]))});
    api.prepare.and.rejectWith(new Error('synthetic network loss'));
    void f.componentInstance.create('PAUSE_NEW_OPERATIONS');flushMicrotasks();f.detectChanges();
    const exact=structuredClone(api.prepare.calls.mostRecent().args[0]);
    expect(f.componentInstance.selected()).toBeNull();expect(f.nativeElement.textContent).toContain('Recover this saved review');
    void f.componentInstance.prepareSameReview();flushMicrotasks();
    expect(api.prepare.calls.mostRecent().args[0]).toEqual(exact);f.destroy();
  }));
  it('stops hidden-tab reads and refreshes on return without another wallet action',fakeAsync(()=>{
    let visible=true;spyOnProperty(document,'visibilityState','get').and.callFake(()=>visible?'visible':'hidden');
    const f=create();flushMicrotasks();visible=false;document.dispatchEvent(new Event('visibilitychange'));tick(60000);flushMicrotasks();
    expect(api.list).toHaveBeenCalledTimes(1);visible=true;document.dispatchEvent(new Event('visibilitychange'));flushMicrotasks();
    expect(api.list).toHaveBeenCalledTimes(2);expect(api.sign).not.toHaveBeenCalled();f.destroy();
  }));
  it('allows a scoped reopening review while proposals are paused and keeps the upgrade blocked',fakeAsync(()=>{
    const f=create();flushMicrotasks();
    const snapshot:any={generationId:vector.review.generationId,stateProof:{version:1},pauseMask:3,delays:[],chainEvidence:Object.fromEntries(
      ['registry','governance','holdings'].map(k=>[k,{coinId:vector.request.expectedInputs[k as keyof typeof vector.request.expectedInputs]}]))};
    f.componentRef.setInput('snapshot',snapshot);f.detectChanges();
    f.componentInstance.sourceManifest.set('0x'+'44'.repeat(32));
    f.componentInstance.toggleReopen(1,true);f.componentInstance.toggleReopen(16,true);
    expect(f.componentInstance.reopenScope()).toBe(1);expect(f.componentInstance.canReopen()).toBeTrue();
    expect(f.componentInstance.canUpgrade()).toBeFalse();
    api.prepare.and.rejectWith(new Error('synthetic lost response'));
    void f.componentInstance.create('PUBLICATION_APPROVAL','REOPEN');flushMicrotasks();f.detectChanges();
    const req=api.prepare.calls.mostRecent().args[0];expect(req.proposalKind).toBe('REOPEN');expect(req.scope).toBe(1);
    expect(req.upgrade).toBeUndefined();expect({...req.expectedInputs,components:{}}).toEqual(vector.request.expectedInputs);
    expect(f.nativeElement.textContent).toContain('Holders can vote on reopening even while new proposals are paused');
    expect(api.sign).not.toHaveBeenCalled();
    f.componentRef.setInput('snapshot',{...snapshot,delays:[{kind:'EMERGENCY_REOPENING'}]});f.detectChanges();
    expect(f.componentInstance.canReopen()).toBeFalse();
    f.componentRef.setInput('snapshot',null);f.detectChanges();expect(f.componentInstance.canReopen()).toBeFalse();f.destroy();
  }));
});
