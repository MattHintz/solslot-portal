import {TestBed} from '@angular/core/testing';
import fixture from '../../utils/generation-final-launch.fixture.json';
import {environment} from '../../../environments/environment';
import {GenerationFinalLaunchComponent} from './generation-final-launch.component';
import {FinalLaunchStatus,GenerationFinalLaunchService} from '../../services/generation-final-launch.service';
import {EvmWalletService} from '../../services/evm-wallet.service';
import {finalLaunchTypedData} from '../../utils/generation-final-launch-review';

describe('Final launch assigned UI lifecycle',()=>{
  const runtime=environment.solslotProtocol as {generationId?:string};let old:string|undefined,s:FinalLaunchStatus,api:any,wallet:any;
  beforeEach(()=>{s=structuredClone(fixture) as unknown as FinalLaunchStatus;old=runtime.generationId;runtime.generationId=s.generationId;
    spyOn(Date,'now').and.returnValue((s.review!.issuedAt+1)*1000);
    api=jasmine.createSpyObj('api',['status','review','consent','approve','prepare','submit']);api.status.and.callFake(async()=>structuredClone(s));
    wallet=jasmine.createSpyObj('wallet',['signGenerationLaunch']);wallet.signGenerationLaunch.and.resolveTo('synthetic');
    TestBed.configureTestingModule({imports:[GenerationFinalLaunchComponent],providers:[
      {provide:GenerationFinalLaunchService,useValue:api},{provide:EvmWalletService,useValue:wallet}]});});
  afterEach(()=>{if(old===undefined)delete runtime.generationId;else runtime.generationId=old;});
  async function mount(){const f=TestBed.createComponent(GenerationFinalLaunchComponent);f.detectChanges();await f.whenStable();f.detectChanges();return f;}
  it('polls only cached status and presents full destinations and the 24-hour window',async()=>{
    const f=await mount();expect(f.nativeElement.textContent).toContain(s.review!.recipients[0].recipientVault);
    expect(f.nativeElement.textContent).toContain('24 hours');expect(api.status).toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('0.7% to company revenue');
    expect(f.nativeElement.textContent).toContain('owner plus one other administrator');
    expect(f.nativeElement.textContent).toContain('0.3% to SGT rewards');
    expect(api.review).not.toHaveBeenCalled();expect(api.prepare).not.toHaveBeenCalled();expect(wallet.signGenerationLaunch).not.toHaveBeenCalled();
  });
  it('signs only after the assigned action and uses the previously displayed review',async()=>{
    const f=await mount();api.consent.and.resolveTo({...s,typedData:finalLaunchTypedData(s.review!,1)});
    api.approve.and.resolveTo({...s,review:{...s.review!,approvedSlots:[1]}});
    await f.componentInstance.sign();expect(wallet.signGenerationLaunch).toHaveBeenCalledTimes(1);
    expect(api.approve).toHaveBeenCalledWith(s.review,'synthetic');expect(api.prepare).not.toHaveBeenCalled();
  });
  it('does not let a coadministrator prepare or submit genesis',async()=>{
    s.assignedSlot=2;s.review!.approvedSlots=[1,2];const f=await mount();await f.componentInstance.prepare();await f.componentInstance.submit();
    expect(api.prepare).not.toHaveBeenCalled();expect(api.submit).not.toHaveBeenCalled();
  });
  it('preserves progress and reports an expired prompt without opening a wallet',async()=>{
    (Date.now as jasmine.Spy).and.returnValue(s.review!.expiresAt*1000);const f=await mount();await f.componentInstance.sign();
    expect(f.nativeElement.textContent).toContain('expired');expect(api.consent).not.toHaveBeenCalled();
  });
  it('shows a concrete missing-certificate state without an indefinite loader',async()=>{
    api.status.and.rejectWith({status:503,error:{detail:{code:'GENERATION_FINAL_RELEASE_NOT_READY'}}});
    const f=await mount();expect(f.nativeElement.textContent).toContain('security review and recovery certificate');
    expect(f.componentInstance.pending()).toBeNull();expect(api.review).not.toHaveBeenCalled();
  });
  it('shows one effective deadline and a clear owner-plus-one requirement',async()=>{
    const f=await mount();
    expect(f.componentInstance.deadline()).toBe(Math.min(s.review!.expiresAt,s.review!.releaseExpiresAt));
    expect(f.nativeElement.querySelectorAll('.deadline').length).toBe(1);
    expect(f.nativeElement.textContent).toContain('owner and one coadministrator');
    expect(f.nativeElement.querySelector('[aria-current="step"]').textContent).toContain('Administrator consent');
  });
  it('does not request an unnecessary third signature once the threshold is met',async()=>{
    s.assignedSlot=3;s.review!.approvedSlots=[1,2];const f=await mount();
    await f.componentInstance.sign();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('No further signature required');
    expect(f.nativeElement.textContent).not.toContain('Launch consent waiting');
    expect(api.consent).not.toHaveBeenCalled();expect(wallet.signGenerationLaunch).not.toHaveBeenCalled();
  });
  it('shows confirmed issuance for all three people even after the signing deadline',async()=>{
    s.review!.launchComplete=true;s.review!.confirmedHeight=12345;s.review!.approvedSlots=[1,2];
    (Date.now as jasmine.Spy).and.returnValue((s.review!.expiresAt+100)*1000);
    const f=await mount();await f.componentInstance.sign();
    expect(f.componentInstance.currentStage()).toBe(4);
    expect(f.nativeElement.textContent).toContain('All launch outputs confirmed');
    expect(f.nativeElement.querySelectorAll('.signer-status').length).toBe(3);
    expect(f.nativeElement.textContent).not.toContain('Launch consent waiting');
    expect(f.nativeElement.textContent).not.toContain('This review or its operational evidence expired');
    expect(api.consent).not.toHaveBeenCalled();
  });
  it('provides manual forwarding text if clipboard access is unavailable without starting a wallet action',async()=>{
    const f=await mount();await f.componentInstance.share();
    expect(f.componentInstance.instructions()).toContain(s.review!.reviewId);
    expect(f.componentInstance.instructions()).toContain('no additional signature is needed');
    expect(api.consent).not.toHaveBeenCalled();expect(api.prepare).not.toHaveBeenCalled();
  });
});
