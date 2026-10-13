import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { computeAddress } from 'ethers';
import { environment } from '../../environments/environment';
import { GenerationConsentService,GenerationConsentReview,GenerationConsentRequest } from './generation-consent.service';
import { AdminSessionService } from './admin-session.service';
import { EvmWalletService } from './evm-wallet.service';
import { GenerationGovernanceService } from './generation-governance.service';
import vector from '../utils/generation-consent.fixture.json';
import mintVector from '../utils/generation-mint-consent.fixture.json';

describe('Explicit generation approval signatures',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:any,http:HttpTestingController,service:GenerationConsentService,session:any,wallet:any;
  const review=()=>structuredClone(vector.review) as unknown as GenerationConsentReview;
  beforeEach(()=>{
    previous={generationId:runtime.generationId,authority:runtime.adminAuthorityV3LauncherId,identities:runtime.adminAuthorityV3IdentityLauncherIds};
    runtime.generationId=vector.review.generationId;runtime.adminAuthorityV3LauncherId=vector.review.authorityLauncherId;
    runtime.adminAuthorityV3IdentityLauncherIds=[...vector.review.identityLauncherIds];
    const c=vector.review.challenges[0];
    session={requireJwt:()=> 'synthetic-jwt',authoritySlot:()=>0,pubkey:()=>c.publicKey};
    wallet={address:()=>computeAddress(c.publicKey),signAuthorityV3ChiaAction:jasmine.createSpy().and.resolveTo('0x'+'11'.repeat(65))};
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),
      {provide:AdminSessionService,useValue:session},{provide:EvmWalletService,useValue:wallet},
      {provide:GenerationGovernanceService,useValue:{validateReceipt:(v:any)=>v}}]});
    service=TestBed.inject(GenerationConsentService);http=TestBed.inject(HttpTestingController);
    spyOn(Date,'now').and.returnValue((vector.review.createdAt+10)*1000);
  });
  afterEach(()=>{
    http.verify();if(previous.generationId===undefined)delete runtime.generationId;else runtime.generationId=previous.generationId;
    runtime.adminAuthorityV3LauncherId=previous.authority;runtime.adminAuthorityV3IdentityLauncherIds=previous.identities;
  });
  it('prepares without asking a wallet and checks the exact original request',async()=>{
    const r=review(),req=structuredClone(vector.request) as unknown as GenerationConsentRequest;
    const pending=service.prepare(req);
    const call=http.expectOne(environment.faucetApi+'/admin/generation/consents/prepare');
    expect(call.request.headers.get('Authorization')).toBe('Bearer synthetic-jwt');call.flush(r);
    expect((await pending).packageId).toBe(r.packageId);expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();
  });
  it('rejects a different prepared request without asking the wallet',async()=>{
    const req=structuredClone(vector.request) as unknown as GenerationConsentRequest;req.feeCapMojos++;
    const pending=service.prepare(req);http.expectOne(environment.faucetApi+'/admin/generation/consents/prepare').flush(review());
    await expectAsync(pending).toBeRejected();expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();
  });
  it('prepares only the exact saved native mint source without requesting a signature',async()=>{
    const r=structuredClone(mintVector) as unknown as GenerationConsentReview;
    runtime.generationId=r.generationId;runtime.adminAuthorityV3LauncherId=r.authorityLauncherId;
    runtime.adminAuthorityV3IdentityLauncherIds=[...r.identityLauncherIds];
    const req=structuredClone(r.request),pending=service.prepare(req);
    const call=http.expectOne(environment.faucetApi+'/admin/generation/consents/prepare');
    expect(call.request.body.mintReviewId).toBe(r.mintSource?.packageId);
    expect(call.request.body.editionProgram).toBeUndefined();call.flush(r);
    expect((await pending).billHash).toBe(r.mintSource!.billHash);expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();
  });
  it('signs only the assigned exact challenge, then records that signature',async()=>{
    const r=review(),pending=service.sign(r);await Promise.resolve();
    const call=http.expectOne(environment.faucetApi+'/admin/generation/consents/'+r.packageId+'/sign');
    expect(call.request.body.signature).toBe('0x'+'11'.repeat(65));
    call.flush({...r,signatures:[{slot:0,signedAt:r.createdAt+10}]});
    expect((await pending).signatures.length).toBe(1);expect(wallet.signAuthorityV3ChiaAction).toHaveBeenCalledTimes(1);
  });
  it('rejects a role or wallet mismatch before opening a prompt',async()=>{
    session.authoritySlot=()=>2;await expectAsync(service.sign(review())).toBeRejected();
    expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();
  });
  it('keeps a rejected wallet action separate from saving consent',async()=>{
    wallet.signAuthorityV3ChiaAction.and.rejectWith(new Error('user rejection'));
    await expectAsync(service.sign(review())).toBeRejected();
    http.expectNone(environment.faucetApi+'/admin/generation/consents/'+vector.review.packageId+'/sign');
  });
  it('checks generation and wallet again after the prompt',async()=>{
    wallet.signAuthorityV3ChiaAction.and.callFake(async()=>{session.pubkey=()=>vector.review.challenges[1].publicKey;return '0x'+'11'.repeat(65);});
    await expectAsync(service.sign(review())).toBeRejected();
    http.expectNone(environment.faucetApi+'/admin/generation/consents/'+vector.review.packageId+'/sign');
  });
});
