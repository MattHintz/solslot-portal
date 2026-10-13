import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { GenerationGovernanceService,MaintenanceRequest,GenerationOperationStatus } from './generation-governance.service';
import { AdminSessionService } from './admin-session.service';
import vector from '../utils/generation-redemption-consent.fixture.json';

describe('Exact generation operation preparation response',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:string|undefined,http:HttpTestingController,service:GenerationGovernanceService;
  const request=():MaintenanceRequest=>({generationId:vector.review.generationId,requestKey:'exact-funding',kind:'FUND_REDEMPTION',
    feeCapMojos:1000,expectedInputs:structuredClone(vector.request.expectedInputs),proposalId:vector.review.proposalId,
    redemption:structuredClone(vector.review.proposal.redemption)});
  const receipt=(r:MaintenanceRequest):GenerationOperationStatus=>({generationId:r.generationId,network:'testnet11',
    operationId:'0x'+'ab'.repeat(32),kind:r.kind,intentHash:'0x'+'ac'.repeat(32),stage:'PREPARED',transactionId:null,
    feeCapMojos:String(r.feeCapMojos),createdAt:100,updatedAt:100,lastCheckedAt:null,errorCode:null,confirmedHeight:null,
    nextAction:'REVIEW_AND_SUBMIT',pollAfterSeconds:30,review:{...structuredClone(r),expectedInputs:{...r.expectedInputs,components:r.expectedInputs.components??{}},
      proposalId:r.proposalId??null,upgrade:null,scope:null,parameters:null,proof:null,stakes:null} as unknown as MaintenanceRequest});
  beforeEach(()=>{
    previous=runtime.generationId;runtime.generationId=vector.review.generationId;
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),
      {provide:AdminSessionService,useValue:{requireJwt:()=> 'synthetic-jwt'}}]});
    service=TestBed.inject(GenerationGovernanceService);http=TestBed.inject(HttpTestingController);
  });
  afterEach(()=>{http.verify();if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;});
  it('accepts only the selected exact native intent without a wallet request',async()=>{
    const r=request(),pending=service.prepare(r);
    http.expectOne(environment.faucetApi+'/admin/generation/operations/prepare').flush(receipt(r));
    expect((await pending).review?.kind).toBe('FUND_REDEMPTION');
  });
  for(const fault of ['claim','source','proposal','request-key','input'])it('rejects a well-formed substituted '+fault+' response',async()=>{
    const r=request(),pending=service.prepare(r),changed=structuredClone(r);
    if(fault==='claim')changed.redemption!.allocations[0].deedCommitment='0x'+'ff'.repeat(32);
    else if(fault==='source')changed.redemption!.treasuryCoinId='0x'+'ff'.repeat(32);
    else if(fault==='proposal')changed.proposalId='0x'+'ff'.repeat(32);
    else if(fault==='request-key')changed.requestKey='different-action';
    else changed.expectedInputs.governance='0x'+'ff'.repeat(32);
    http.expectOne(environment.faucetApi+'/admin/generation/operations/prepare').flush(receipt(changed));
    await expectAsync(pending).toBeRejectedWithError('Prepared action differs from your exact review.');
  });
  it('copies selected fields before awaiting the response',async()=>{
    const r=request(),original=structuredClone(r),pending=service.prepare(r);
    r.redemption!.allocations[0].deedCommitment='0x'+'ff'.repeat(32);
    const call=http.expectOne(environment.faucetApi+'/admin/generation/operations/prepare');
    expect(call.request.body.redemption).toEqual(original.redemption);call.flush(receipt(original));
    expect((await pending).review?.kind).toBe('FUND_REDEMPTION');
  });
  for(const kind of ['CLOSE_REWARD_EPOCH','CLAIM_SGT_REWARD'] as const){
    const rewardRequest=():MaintenanceRequest=>{
      const h=(n:number)=>'0x'+n.toString(16).padStart(2,'0').repeat(32);
      const base={generationId:vector.review.generationId,requestKey:'exact-reward',kind,feeCapMojos:1000,
        expectedInputs:{...structuredClone(vector.request.expectedInputs),components:kind==='CLOSE_REWARD_EPOCH'?{[h(3)]:h(9)}:{}}};
      return kind==='CLOSE_REWARD_EPOCH'?{...base,rewardEpoch:{assetId:h(2),statutesComponentId:h(3),statutesLauncherId:h(4),revision:0,
        valuesHash:h(5),holdingsRoot:h(6),eligibleSupply:30000,ledgerSequence:0,feeCoinIds:[h(7)]}}:
        {...base,rewardClaim:{assetId:h(2),statutesLauncherId:h(4),epochId:h(5),ownerPuzzleHash:h(6),amount:30,claimCoinId:h(7),vaultLauncherId:h(8)}};
    };
    it('accepts the exact '+kind+' review without a wallet action',async()=>{
      const r=rewardRequest(),pending=service.prepare(r);
      http.expectOne(environment.faucetApi+'/admin/generation/operations/prepare').flush(receipt(r));
      expect((await pending).kind).toBe(kind);
    });
    for(const fault of ['asset','source','allocation','authority'])it('rejects '+fault+' substitution in '+kind,async()=>{
      const r=rewardRequest(),pending=service.prepare(r),changed=structuredClone(r),h='0x'+'ff'.repeat(32);
      if(changed.rewardEpoch){
        const v=changed.rewardEpoch;
        if(fault==='asset')v.assetId=h;else if(fault==='source')v.feeCoinIds=[h];
        else if(fault==='allocation')v.holdingsRoot=h;else v.valuesHash=h;
      }else{
        const v=changed.rewardClaim!;
        if(fault==='asset')v.assetId=h;else if(fault==='source')v.claimCoinId=h;
        else if(fault==='allocation')v.vaultLauncherId=h;else v.statutesLauncherId=h;
      }
      http.expectOne(environment.faucetApi+'/admin/generation/operations/prepare').flush(receipt(changed));
      await expectAsync(pending).toBeRejectedWithError('Prepared action differs from your exact review.');
    });
  }
});
