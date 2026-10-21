import { TestBed,fakeAsync,flushMicrotasks,tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { GenerationBallotService,GenerationBallotReview,GenerationBallotSigningError } from './generation-ballot.service';
import { AdminSessionService } from './admin-session.service';
import { EvmWalletService } from './evm-wallet.service';
import { ChiaWalletService } from './chia-wallet.service';
import { GenerationGovernanceService } from './generation-governance.service';
import vector from '../utils/generation-holder-ballot.fixture.json';

describe('Durable holder signature service',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:any,service:GenerationBallotService,http:HttpTestingController,wallet:any,session:any,dateSpy:jasmine.Spy;
  const review=()=>structuredClone(vector.review) as unknown as GenerationBallotReview;
  const base=environment.faucetApi+'/admin/generation/ballots';
  beforeEach(()=>{
    previous={generationId:runtime.generationId,verified:runtime.generationBindingsVerified,bindings:structuredClone(runtime.generationHolderBindings)};
    runtime.generationId=vector.review.generationId;runtime.generationBindingsVerified=true;runtime.generationHolderBindings={...vector.bindings};
    session={requireJwt:()=> 'synthetic-jwt',pubkey:()=>vector.review.holders[0].context.owner.publicKey};
    wallet={address:jasmine.createSpy().and.returnValue(vector.review.holders[0].context.owner.address),
      hasInjectedProvider:jasmine.createSpy().and.returnValue(true),connectInjected:jasmine.createSpy(),
      signGenerationSgt:jasmine.createSpy().and.callFake(async(r:any,c:any,check:()=>Promise<void>)=>{await check();return '0x'+'11'.repeat(65);})};
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),{provide:AdminSessionService,useValue:session},
      {provide:EvmWalletService,useValue:wallet},{provide:ChiaWalletService,useValue:{}},{provide:GenerationGovernanceService,useValue:{validateReceipt:(v:any)=>v}}]});
    service=TestBed.inject(GenerationBallotService);http=TestBed.inject(HttpTestingController);
    dateSpy=spyOn(Date,'now').and.returnValue((vector.review.createdAt+10)*1000);
  });
  afterEach(()=>{http.verify();if(previous.generationId===undefined)delete runtime.generationId;else runtime.generationId=previous.generationId;
    runtime.generationBindingsVerified=previous.verified;runtime.generationHolderBindings=previous.bindings;});
  it('fetches an immutable proof once and polls thin receipts without wallet or assembly actions',fakeAsync(()=>{
    const r=review(),{holders,...summary}=r;let result:GenerationBallotReview[]=[];
    void service.list().then(v=>result=v);http.expectOne(base).flush({generationId:r.generationId,network:'testnet11',reviews:[summary]});flushMicrotasks();
    http.expectOne(base+'/'+r.packageId).flush(r);flushMicrotasks();expect(result[0].packageId).toBe(r.packageId);
    void service.list().then(v=>result=v);http.expectOne(base).flush({generationId:r.generationId,network:'testnet11',reviews:[summary]});flushMicrotasks();
    http.expectNone(base+'/'+r.packageId);expect(wallet.signGenerationSgt).not.toHaveBeenCalled();
    expect(wallet.connectInjected).not.toHaveBeenCalled();
  }));
  it('rechecks the exact inputs around an explicit signature and only records the selected coin',fakeAsync(()=>{
    const r=review(),coin=r.request.selected[0].coinId;let result:any;
    void service.sign(r,coin).then(v=>result=v);flushMicrotasks();
    const check=http.expectOne(base+'/'+r.packageId+'/check-inputs');expect(check.request.body).toEqual({});
    check.flush({generationId:r.generationId,packageId:r.packageId,unchanged:true});flushMicrotasks();
    const call=http.expectOne(base+'/'+r.packageId+'/sign');expect(call.request.body).toEqual({coinId:coin,signature:'0x'+'11'.repeat(65)});
    call.flush({...r,signatures:[{coinId:coin,signedAt:r.createdAt+10}]});flushMicrotasks();expect(result.signatures.length).toBe(1);
    expect(wallet.connectInjected).not.toHaveBeenCalled();expect(wallet.hasInjectedProvider).not.toHaveBeenCalled();
  }));
  it('keeps an input-check failure separate from signature recording',fakeAsync(()=>{
    const r=review();let rejected=false;void service.sign(r,r.request.selected[0].coinId).catch(()=>rejected=true);flushMicrotasks();
    http.expectOne(base+'/'+r.packageId+'/check-inputs').flush({generationId:r.generationId,packageId:r.packageId,unchanged:false});flushMicrotasks();
    expect(rejected).toBeTrue();http.expectNone(base+'/'+r.packageId+'/sign');
  }));
  it('rejects another holder, changed frozen bindings and expired requests before opening the wallet',fakeAsync(()=>{
    const r=review();session.pubkey=()=>r.holders[1].context.owner.publicKey;let failures=0;
    void service.sign(r,r.request.selected[0].coinId).catch(()=>failures++);flushMicrotasks();
    session.pubkey=()=>r.holders[0].context.owner.publicKey;runtime.generationBindingsVerified=false;
    void service.sign(r,r.request.selected[0].coinId).catch(()=>failures++);flushMicrotasks();runtime.generationBindingsVerified=true;
    tick((r.expiresAt-r.createdAt-10)*1000);
    void service.sign(r,r.request.selected[0].coinId).catch(()=>failures++);flushMicrotasks();
    expect(failures).toBe(3);expect(wallet.signGenerationSgt).not.toHaveBeenCalled();
  }));
  it('does not record a signature if the assigned wallet changes during the prompt',fakeAsync(()=>{
    const r=review();wallet.signGenerationSgt.and.callFake(async()=>{session.pubkey=()=>r.holders[1].context.owner.publicKey;return '0x'+'11'.repeat(65);});
    let rejected=false;void service.sign(r,r.request.selected[0].coinId).catch(()=>rejected=true);flushMicrotasks();
    expect(rejected).toBeTrue();http.expectNone(base+'/'+r.packageId+'/sign');
  }));
  it('reconnects after reload only on an explicit sign and submits the exact saved holder approval',fakeAsync(()=>{
    const r=review(),original=structuredClone(r),coin=r.request.selected[0].coinId;let result:any;
    wallet.address.and.returnValue(null);
    wallet.connectInjected.and.callFake(async()=>{wallet.address.and.returnValue(r.holders[0].context.owner.address);});
    void service.sign(r,coin).then(v=>result=v);flushMicrotasks();
    expect(wallet.connectInjected).toHaveBeenCalledTimes(1);
    const check=http.expectOne(base+'/'+r.packageId+'/check-inputs');
    expect(check.request.headers.get('Authorization')).toBe('Bearer synthetic-jwt');
    check.flush({generationId:r.generationId,packageId:r.packageId,unchanged:true});flushMicrotasks();
    expect(wallet.signGenerationSgt).toHaveBeenCalledOnceWith(r.holders[0].request,r.holders[0].context,jasmine.any(Function));
    const call=http.expectOne(base+'/'+r.packageId+'/sign');expect(call.request.body).toEqual({coinId:coin,signature:'0x'+'11'.repeat(65)});
    call.flush({...r,signatures:[{coinId:coin,signedAt:r.createdAt+10}]});flushMicrotasks();
    expect(result.packageId).toBe(r.packageId);expect(result.expiresAt).toBe(r.expiresAt);expect(r).toEqual(original);
  }));
  for(const reconnect of [false,true])it('rejects a wrong '+(reconnect?'reconnected':'connected')+' owner without switching accounts',fakeAsync(()=>{
    const r=review();let error:any;wallet.address.and.returnValue(reconnect?null:r.holders[1].context.owner.address);
    wallet.connectInjected.and.callFake(async()=>{wallet.address.and.returnValue(r.holders[1].context.owner.address);});
    void service.sign(r,r.request.selected[0].coinId).catch(e=>error=e);flushMicrotasks();
    expect(error instanceof GenerationBallotSigningError).toBeTrue();expect(error.reason).toBe('WRONG_ACCOUNT');
    expect(error.message).toContain(r.holders[0].context.owner.address);
    expect(wallet.connectInjected).toHaveBeenCalledTimes(reconnect?1:0);expect(wallet.signGenerationSgt).not.toHaveBeenCalled();
    http.expectNone(base+'/'+r.packageId+'/check-inputs');http.expectNone(base+'/'+r.packageId+'/sign');
  }));
  for(const phase of ['reconnect','signature'] as const)for(const change of ['session','generation','bindings','expiry','expiredSession'] as const){
    it('rejects '+change+' changed during '+phase+' and records no signature',fakeAsync(()=>{
      const r=review();let error:any;
      const mutate=()=>{
        if(change==='session')session.pubkey=()=>r.holders[1].context.owner.publicKey;
        if(change==='generation')runtime.generationId='0x'+'44'.repeat(32);
        if(change==='bindings')runtime.generationBindingsVerified=false;
        if(change==='expiry')tick((r.expiresAt-r.createdAt-10)*1000);
        if(change==='expiredSession')session.requireJwt=()=>{throw new Error('Expired session');};
      };
      if(phase==='reconnect'){
        wallet.address.and.returnValue(null);
        wallet.connectInjected.and.callFake(async()=>{wallet.address.and.returnValue(r.holders[0].context.owner.address);mutate();});
      }else wallet.signGenerationSgt.and.callFake(async()=>{mutate();return '0x'+'11'.repeat(65);});
      void service.sign(r,r.request.selected[0].coinId).catch(e=>error=e);flushMicrotasks();
      expect(error instanceof GenerationBallotSigningError).toBeTrue();expect(error.reason).toBe('REVIEW_CHANGED');
      if(phase==='reconnect')expect(wallet.signGenerationSgt).not.toHaveBeenCalled();
      http.expectNone(base+'/'+r.packageId+'/sign');
    }));
  }
  for(const phase of ['reconnect','signature'] as const)for(const code of [4001,-32002]){
    it('reports '+code+' during '+phase+' with fixed recovery text and no saved signature',fakeAsync(()=>{
      const r=review();let error:any;const rejection={code,message:'<html>upstream private payload</html>'};
      if(phase==='reconnect'){wallet.address.and.returnValue(null);wallet.connectInjected.and.rejectWith(rejection);}
      else wallet.signGenerationSgt.and.rejectWith(rejection);
      void service.sign(r,r.request.selected[0].coinId).catch(e=>error=e);flushMicrotasks();
      expect(error.reason).toBe(code===4001?'WALLET_REJECTED':'WALLET_PENDING');expect(error.message).not.toContain('private payload');
      http.expectNone(base+'/'+r.packageId+'/sign');
    }));
  }
  it('keeps an unavailable injected wallet actionable without replacing it with another transport',fakeAsync(()=>{
    const r=review();let error:any;wallet.address.and.returnValue(null);wallet.hasInjectedProvider.and.returnValue(false);
    void service.sign(r,r.request.selected[0].coinId).catch(e=>error=e);flushMicrotasks();
    expect(error.reason).toBe('WALLET_UNAVAILABLE');expect(error.message).toContain('Vault Connect');
    expect(wallet.connectInjected).not.toHaveBeenCalled();expect(wallet.signGenerationSgt).not.toHaveBeenCalled();
  }));
  it('rechecks the owner after the input response before returning to the signer',fakeAsync(()=>{
    const r=review();let error:any;
    void service.sign(r,r.request.selected[0].coinId).catch(e=>error=e);flushMicrotasks();
    wallet.address.and.returnValue(r.holders[1].context.owner.address);
    http.expectOne(base+'/'+r.packageId+'/check-inputs').flush({generationId:r.generationId,packageId:r.packageId,unchanged:true});flushMicrotasks();
    expect(error.reason).toBe('WRONG_ACCOUNT');http.expectNone(base+'/'+r.packageId+'/sign');
  }));
  it('holds the exact reviewed request stable if the displayed source changes while reconnecting',fakeAsync(()=>{
    const r=review(),original=structuredClone(r),coin=r.request.selected[0].coinId;let complete!:()=>void,result:any;
    wallet.address.and.returnValue(null);wallet.connectInjected.and.returnValue(new Promise<void>(resolve=>complete=resolve));
    void service.sign(r,coin).then(v=>result=v);flushMicrotasks();
    r.request.feeCapMojos++;r.holders[0].request.expiresAt++;r.proposalId='0x'+'66'.repeat(32);
    wallet.address.and.returnValue(original.holders[0].context.owner.address);complete();flushMicrotasks();
    http.expectOne(base+'/'+original.packageId+'/check-inputs').flush({generationId:original.generationId,packageId:original.packageId,unchanged:true});flushMicrotasks();
    expect(wallet.signGenerationSgt).toHaveBeenCalledOnceWith(original.holders[0].request,original.holders[0].context,jasmine.any(Function));
    http.expectOne(base+'/'+original.packageId+'/sign').flush({...original,signatures:[{coinId:coin,signedAt:original.createdAt+10}]});flushMicrotasks();
    expect(result.proposalId).toBe(original.proposalId);expect(result.requestDigest).toBe(original.requestDigest);
  }));
});
