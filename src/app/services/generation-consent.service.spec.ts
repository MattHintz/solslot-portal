import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { computeAddress } from 'ethers';
import { environment } from '../../environments/environment';
import { GenerationConsentService,GenerationConsentReview,GenerationConsentRequest,GenerationConsentSigningError } from './generation-consent.service';
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
    wallet={address:jasmine.createSpy().and.returnValue(computeAddress(c.publicKey)),
      hasInjectedProvider:jasmine.createSpy().and.returnValue(true),connectInjected:jasmine.createSpy(),
      signAuthorityV3ChiaAction:jasmine.createSpy().and.resolveTo('0x'+'11'.repeat(65))};
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
    expect(wallet.connectInjected).not.toHaveBeenCalled();
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
    expect(wallet.connectInjected).not.toHaveBeenCalled();
    expect(wallet.hasInjectedProvider).not.toHaveBeenCalled();
  });
  it('reconnects a disconnected provider after session restoration only on an explicit sign and preserves the exact saved package',async()=>{
    const r=review(),original=structuredClone(r),address=computeAddress(r.challenges[0].publicKey);
    wallet.address.and.returnValue(null);
    wallet.connectInjected.and.callFake(async()=>{wallet.address.and.returnValue(address);return address;});
    const history=service.list();
    http.expectOne(environment.faucetApi+'/admin/generation/consents').flush({generationId:r.generationId,network:'testnet11',reviews:[r]});
    await history;expect(wallet.connectInjected).not.toHaveBeenCalled();expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();
    const pending=service.sign(r);await Promise.resolve();await Promise.resolve();
    expect(wallet.connectInjected).toHaveBeenCalledTimes(1);
    expect(wallet.signAuthorityV3ChiaAction).toHaveBeenCalledOnceWith(r.challenges[0].typedData,{
      coinId:r.challenges[0].coinId,delegatedPuzzleHash:r.challenges[0].delegatedPuzzleHash,compressedPubkey:r.challenges[0].publicKey});
    const call=http.expectOne(environment.faucetApi+'/admin/generation/consents/'+r.packageId+'/sign');
    expect(call.request.headers.get('Authorization')).toBe('Bearer synthetic-jwt');
    expect(call.request.body).toEqual({signature:'0x'+'11'.repeat(65)});
    call.flush({...r,signatures:[{slot:0,signedAt:r.createdAt+10}]});
    const saved=await pending;expect(saved.packageId).toBe(r.packageId);expect(saved.expiresAt).toBe(r.expiresAt);
    expect(r).toEqual(original);
  });
  it('rejects a different account returned by reconnect before requesting any signature',async()=>{
    wallet.address.and.returnValue(null);
    wallet.connectInjected.and.callFake(async()=>{const address=computeAddress(vector.review.challenges[1].publicKey);wallet.address.and.returnValue(address);return address;});
    await expectAsync(service.sign(review())).toBeRejectedWithError(GenerationConsentSigningError,/Expected account:/);
    expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();
    http.expectNone(environment.faucetApi+'/admin/generation/consents/'+vector.review.packageId+'/sign');
  });
  it('does not silently replace a connected wrong account',async()=>{
    wallet.address.and.returnValue(computeAddress(vector.review.challenges[1].publicKey));
    await expectAsync(service.sign(review())).toBeRejectedWithError(GenerationConsentSigningError,/Switch to the administrator account/);
    expect(wallet.connectInjected).not.toHaveBeenCalled();expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();
  });
  for(const change of ['session','generation','deadline'] as const){
    it('rechecks '+change+' after reconnect before requesting a signature',async()=>{
      wallet.address.and.returnValue(null);
      wallet.connectInjected.and.callFake(async()=>{
        const address=computeAddress(vector.review.challenges[0].publicKey);wallet.address.and.returnValue(address);
        if(change==='session')session.authoritySlot=()=>1;
        if(change==='generation')runtime.generationId='0x'+'44'.repeat(32);
        if(change==='deadline')(Date.now as jasmine.Spy).and.returnValue(vector.review.expiresAt*1000);
        return address;
      });
      await expectAsync(service.sign(review())).toBeRejectedWithError(GenerationConsentSigningError,/approval window changed/);
      expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();
      http.expectNone(environment.faucetApi+'/admin/generation/consents/'+vector.review.packageId+'/sign');
    });
  }
  for(const failure of [{error:{code:4001},text:/You declined/},{error:{code:-32002},text:/request is already waiting/}]){
    it('explains a reconnect failure '+failure.error.code+' without requesting a signature or saving consent',async()=>{
      wallet.address.and.returnValue(null);wallet.connectInjected.and.rejectWith(failure.error);
      await expectAsync(service.sign(review())).toBeRejectedWithError(GenerationConsentSigningError,failure.text);
      expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();
      http.expectNone(environment.faucetApi+'/admin/generation/consents/'+vector.review.packageId+'/sign');
    });
  }
  it('gives a reconnect instruction when no injected wallet exists instead of changing the signing method',async()=>{
    wallet.address.and.returnValue(null);wallet.hasInjectedProvider.and.returnValue(false);
    await expectAsync(service.sign(review())).toBeRejectedWithError(GenerationConsentSigningError,/through Vault Connect/);
    expect(wallet.connectInjected).not.toHaveBeenCalled();expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();
  });
  it('explains a pending signature wrapped by the EVM provider and does not save consent',async()=>{
    wallet.signAuthorityV3ChiaAction.and.rejectWith({code:'UNKNOWN_ERROR',info:{error:{code:-32002,message:'provider internals'}}});
    await expectAsync(service.sign(review())).toBeRejectedWithError(GenerationConsentSigningError,/request is already waiting/);
    http.expectNone(environment.faucetApi+'/admin/generation/consents/'+vector.review.packageId+'/sign');
  });
  it('explains a declined signature without including raw wallet error data',async()=>{
    wallet.signAuthorityV3ChiaAction.and.rejectWith({code:'ACTION_REJECTED',message:'raw provider payload'});
    await expectAsync(service.sign(review())).toBeRejectedWithError(GenerationConsentSigningError,/You declined the wallet request/);
    http.expectNone(environment.faucetApi+'/admin/generation/consents/'+vector.review.packageId+'/sign');
  });
  it('rejects a role or wallet mismatch before opening a prompt',async()=>{
    session.authoritySlot=()=>2;await expectAsync(service.sign(review())).toBeRejected();
    expect(wallet.signAuthorityV3ChiaAction).not.toHaveBeenCalled();expect(wallet.connectInjected).not.toHaveBeenCalled();
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
