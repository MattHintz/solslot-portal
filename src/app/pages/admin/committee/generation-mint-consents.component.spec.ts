import { TestBed,fakeAsync,flushMicrotasks } from '@angular/core/testing';
import { environment } from '../../../../environments/environment';
import { GenerationConsentsComponent } from './generation-consents.component';
import { GenerationConsentService,GenerationConsentReview } from '../../../services/generation-consent.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import vector from '../../../utils/generation-mint-consent.fixture.json';
import upgrade from '../../../utils/generation-consent.fixture.json';

describe('Sealed edition administrator actions in the native property flow',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:string|undefined,api:jasmine.SpyObj<GenerationConsentService>;
  const review=()=>structuredClone(vector) as unknown as GenerationConsentReview;
  beforeEach(()=>{
    previous=runtime.generationId;runtime.generationId=vector.generationId;
    api=jasmine.createSpyObj('consents',['list','prepare','sign','preparePause']);
    api.list.and.resolveTo([structuredClone(upgrade.review) as any,review()]);
    api.prepare.and.rejectWith(new Error('synthetic lost response'));
    TestBed.configureTestingModule({providers:[{provide:GenerationConsentService,useValue:api},
      {provide:AdminSessionService,useValue:{jwt:()=> 'synthetic-jwt',authoritySlot:()=>0,pubkey:()=>vector.challenges[0].publicKey}}]});
    spyOn(Date,'now').and.returnValue((vector.createdAt+10)*1000);
  });
  afterEach(()=>{
    sessionStorage.removeItem('solslot_generation_consent_prepare:'+vector.generationId+':'+vector.mintSource.packageId);
    if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;
  });
  function component(){
    const f=TestBed.createComponent(GenerationConsentsComponent),r=review(),m=r.mintSource!;
    f.componentRef.setInput('mintSource',m);f.componentRef.setInput('showGeneralActions',false);
    f.componentRef.setInput('available',true);f.componentRef.setInput('isCurrent',true);f.componentRef.setInput('maximumFee','1000');
    f.componentRef.setInput('snapshot',{generationId:r.generationId,proposal:null,pendingUpgrade:null,pauseMask:0,
      components:[m.mintAuthority],componentEvidence:{[m.mintAuthority.componentId]:{coinId:m.mintAuthority.coinId}},
      chainEvidence:Object.fromEntries(['registry','governance','holdings'].map(k=>[k,{coinId:r.expectedInputs[k as 'registry']}]))});
    return f;
  }
  it('shows only this edition with its exact source and prominent assigned approval',fakeAsync(()=>{
    const f=component();f.detectChanges();flushMicrotasks();f.detectChanges();
    expect(f.componentInstance.reviews().length).toBe(1);expect(f.componentInstance.reviews()[0].mintSource?.packageId).toBe(vector.mintSource.packageId);
    expect(f.nativeElement.textContent).toContain(vector.mintSource.canonicalMetadata.title);
    expect(f.nativeElement.textContent).toContain('25 deeds');expect(f.nativeElement.textContent).toContain('Approve publication in wallet');
    expect(f.nativeElement.textContent).toContain('Approve test SmartDeed mint publication');expect(f.nativeElement.textContent).not.toContain('mint_test_only');
    expect(f.nativeElement.textContent).not.toContain('Governed upgrade rehearsal');expect(api.sign).not.toHaveBeenCalled();f.destroy();
  }));
  it('saves one exact source request and recovers it after response loss without a wallet prompt',fakeAsync(()=>{
    api.list.and.resolveTo([]);const f=component();f.detectChanges();flushMicrotasks();void f.componentInstance.createMint();
    void f.componentInstance.createMint();flushMicrotasks();f.detectChanges();
    const req=structuredClone(api.prepare.calls.mostRecent().args[0]);
    expect(api.prepare.calls.count()).toBe(1);expect(req.mintReviewId).toBe(vector.mintSource.packageId);
    expect(req.proposalKind).toBe('MINT_TEST_ONLY');expect(req.expectedInputs.components).toEqual(vector.request.expectedInputs.components);
    expect(req.feeCapMojos).toBe(1000);expect(f.nativeElement.textContent).toContain('Recover this saved review');
    void f.componentInstance.prepareSameReview();flushMicrotasks();expect(api.prepare.calls.mostRecent().args[0]).toEqual(req);
    expect(api.sign).not.toHaveBeenCalled();expect(api.preparePause).not.toHaveBeenCalled();f.destroy();
  }));
  it('blocks a paused mint, pending vote or upgrade, and stale mint input',fakeAsync(()=>{
    const f=component();f.detectChanges();flushMicrotasks();const base=f.componentInstance.snapshot()!;
    for(const mutation of [{pauseMask:2},{proposal:{billHash:vector.billHash}},{pendingUpgrade:{}},
        {approvedActions:[{kind:'MINT_TEST_ONLY',billHash:vector.billHash}]},
        {componentEvidence:{[vector.mintSource.mintAuthority.componentId]:{coinId:'0x'+'aa'.repeat(32)}}}]){
      f.componentRef.setInput('snapshot',{...base,...mutation});f.detectChanges();
      expect(f.componentInstance.canMint()).toBeFalse();void f.componentInstance.createMint();flushMicrotasks();
    }
    expect(api.prepare).not.toHaveBeenCalled();expect(api.sign).not.toHaveBeenCalled();f.destroy();
  }));
  it('recovers the same public preparation identity after a page refresh without auto-signing',fakeAsync(()=>{
    api.list.and.resolveTo([]);const first=component();first.detectChanges();flushMicrotasks();
    void first.componentInstance.createMint();flushMicrotasks();const request=structuredClone(api.prepare.calls.mostRecent().args[0]);
    first.destroy();const next=component();next.detectChanges();flushMicrotasks();
    expect(next.componentInstance.request()).toEqual(request);expect(api.prepare.calls.count()).toBe(1);
    void next.componentInstance.prepareSameReview();flushMicrotasks();expect(api.prepare.calls.mostRecent().args[0]).toEqual(request);
    expect(api.sign).not.toHaveBeenCalled();next.destroy();
  }));
  it('retains a saved review while preventing signatures against stale source or chain context',fakeAsync(()=>{
    const f=component();f.detectChanges();flushMicrotasks();f.componentRef.setInput('isCurrent',false);f.detectChanges();
    const r=f.componentInstance.reviews()[0];void f.componentInstance.sign(r);flushMicrotasks();
    expect(f.componentInstance.reviews()[0].packageId).toBe(vector.packageId);expect(api.sign).not.toHaveBeenCalled();
    const button=[...f.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(button.find(b=>b.textContent?.includes('Approve publication in wallet'))?.disabled).toBeTrue();f.destroy();
  }));
});
