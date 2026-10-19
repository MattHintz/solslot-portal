import { TestBed,fakeAsync,flushMicrotasks,tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { GenerationBallotService,GenerationBallotReview } from './generation-ballot.service';
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
    wallet={signGenerationSgt:jasmine.createSpy().and.callFake(async(r:any,c:any,check:()=>Promise<void>)=>{await check();return '0x'+'11'.repeat(65);})};
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
  }));
  it('rechecks the exact inputs around an explicit signature and only records the selected coin',fakeAsync(()=>{
    const r=review(),coin=r.request.selected[0].coinId;let result:any;
    void service.sign(r,coin).then(v=>result=v);flushMicrotasks();
    const check=http.expectOne(base+'/'+r.packageId+'/check-inputs');expect(check.request.body).toEqual({});
    check.flush({generationId:r.generationId,packageId:r.packageId,unchanged:true});flushMicrotasks();
    const call=http.expectOne(base+'/'+r.packageId+'/sign');expect(call.request.body).toEqual({coinId:coin,signature:'0x'+'11'.repeat(65)});
    call.flush({...r,signatures:[{coinId:coin,signedAt:r.createdAt+10}]});flushMicrotasks();expect(result.signatures.length).toBe(1);
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
});
