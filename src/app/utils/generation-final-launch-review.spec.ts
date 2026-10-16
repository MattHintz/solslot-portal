import fixture from './generation-final-launch.fixture.json';
import {FinalLaunchStatus} from '../services/generation-final-launch.service';
import {environment} from '../../environments/environment';
import {EvmWalletService} from '../services/evm-wallet.service';
import {finalLaunchHash,finalLaunchPayload,finalLaunchTypedData,validateFinalLaunch,validateFinalLaunchSignature} from './generation-final-launch-review';

describe('Exact native final launch review',()=>{
  const data=()=>structuredClone(fixture) as unknown as FinalLaunchStatus;
  const runtime=environment.solslotProtocol as {generationId?:string};let previous:string|undefined;
  beforeEach(()=>{previous=runtime.generationId;runtime.generationId=data().generationId;spyOn(Date,'now').and.returnValue((data().review!.issuedAt+1)*1000);});
  afterEach(()=>{if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;});
  it('verifies the Python-generated review hash and native three grants',()=>{
    const s=validateFinalLaunch(data());expect(finalLaunchHash(finalLaunchPayload(s.review!))).toBe(s.review!.reviewId);
    expect(s.review!.sgtOutputs.map(o=>o.amount)).toEqual([10000,10000,10000,970000]);
    const typed=finalLaunchTypedData(s.review!,1);
    expect(validateFinalLaunchSignature(typed,s,s.review!.recipients[0].wallet)).toEqual(typed);
  });
  for(const field of ['generationId','preparationManifest','artifactHash','certificateHash','assemblyHash','releaseManifestHash',
    'securityReviewHash','backupReceiptHash','restoreReceiptHash','readAnchorHash','feeCapMojos','issuedAt','expiresAt']){
    it('rejects changed displayed '+field,()=>{
      const s=data(),r=s.review! as any;r[field]=typeof r[field]==='number'?r[field]+1:'0x'+'12'.repeat(32);
      expect(()=>validateFinalLaunch(s)).toThrow();
    });
  }
  for(const field of ['reviewId','preparationManifest','artifactHash','certificateHash','assemblyHash','administratorSlot','issuedAt','expiresAt','feeCapMojos']){
    it('rejects changed wallet '+field,()=>{
      const s=data(),typed=finalLaunchTypedData(s.review!,1);
      (typed.message as any)[field]=typeof typed.message[field]==='number'?Number(typed.message[field])+1:'0x'+'12'.repeat(32);
      expect(()=>validateFinalLaunchSignature(typed,s,s.review!.recipients[0].wallet)).toThrow();
    });
  }
  it('rejects a substituted destination even when a response recomputes its hash',()=>{
    const s=data();s.review!.recipients[0].recipientPuzzle='0x'+'12'.repeat(32);
    s.review!.reviewId=finalLaunchHash(finalLaunchPayload(s.review!));expect(()=>validateFinalLaunch(s)).toThrow();
  });
  it('requires the assigned wallet and an unexpired 24-hour consent',()=>{
    const s=data(),t=finalLaunchTypedData(s.review!,1);
    expect(()=>validateFinalLaunchSignature(t,s,s.review!.recipients[1].wallet)).toThrow();
    (Date.now as jasmine.Spy).and.returnValue(s.review!.expiresAt*1000);expect(()=>validateFinalLaunchSignature(t,s,s.review!.recipients[0].wallet)).toThrow();
  });
  for(const fault of ['wallet-revenue','backing-alias','single-admin','standing-budget','server-key','unbounded-fee']){
    it('rejects changed custody policy even with a recomputed review hash: '+fault,()=>{
      const s=data(),v=s.review!.custody.companyRevenue;
      if(fault==='wallet-revenue')v.custodyPuzzleHash='0x'+'12'.repeat(32);
      if(fault==='backing-alias')s.review!.custody.nonwithdrawableBacking=v.custodyPuzzleHash;
      if(fault==='single-admin')(v as any).policy='SINGLE_ADMIN';
      if(fault==='standing-budget')v.standingWithdrawalBudget=true;
      if(fault==='server-key')v.serverSpendingKey=true;
      if(fault==='unbounded-fee')v.maxNetworkFeeMojos++;
      s.review!.reviewId=finalLaunchHash(finalLaunchPayload(s.review!));
      expect(()=>validateFinalLaunch(s)).toThrow();
    });
  }
  it('detects a wallet change after the exact prompt is signed',async()=>{
    const s=data(),t=finalLaunchTypedData(s.review!,1),address=s.review!.recipients[0].wallet;
    const service=Object.create(EvmWalletService.prototype);let current=address;
    Object.assign(service,{eip1193:{},address:()=>current});
    const sign=spyOn<any>(service,'signTypedDataOnChain').and.callFake(async()=>{current=s.review!.recipients[1].wallet;return 'synthetic';});
    await expectAsync(service.signGenerationLaunch(t,s)).toBeRejected();expect(sign).toHaveBeenCalledTimes(1);
  });
});
