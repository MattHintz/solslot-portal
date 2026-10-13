import { TestBed } from '@angular/core/testing';
import { GenerationRecipientsComponent } from './generation-recipients.component';
import { GenerationRecipientsService, GenerationRecipientReview } from '../../services/generation-recipients.service';
import { EvmWalletService } from '../../services/evm-wallet.service';
import { environment } from '../../../environments/environment';
import fixture from '../../utils/recipient-acknowledgement.fixture.json';
import { GenerationOperationStatus } from '../../services/generation-governance.service';

describe('Native recipient preparation',()=>{
  const runtime=environment.solslotProtocol as {generationId?:string};
  let old:string|undefined,api:jasmine.SpyObj<GenerationRecipientsService>,wallet:jasmine.SpyObj<EvmWalletService>;
  const state=()=>({generationId:fixture.review.generationId,preparationManifest:fixture.review.preparationManifest,
    network:'testnet11',assignedSlot:1,holderSupply:30000,reserveSupply:970000,totalSupply:1000000,initialQuorum:15000,
    recipientPreparationComplete:false,genesisAuthorized:false,creationAvailable:true,maximumFeeMojos:'100',
    recipients:[1,2,3].map(i=>({...fixture.review.recipient,administratorSlot:i,name:`Test administrator ${i}`,
      fundingCoinId:'0x'+String(i).repeat(64),creation:null}))} as GenerationRecipientReview);
  const operation=():GenerationOperationStatus=>({generationId:fixture.review.generationId,network:'testnet11',
    operationId:'0x'+'44'.repeat(32),kind:'CREATE_RECIPIENT_VAULT',intentHash:'0x'+'55'.repeat(32),stage:'PREPARED',
    transactionId:null,feeCapMojos:'100',createdAt:1000,updatedAt:1000,lastCheckedAt:null,errorCode:null,
    confirmedHeight:null,nextAction:'REVIEW_OPERATION',pollAfterSeconds:30,
    review:{generationId:fixture.review.generationId,preparationManifest:fixture.review.preparationManifest,
      administratorSlot:1,fundingCoinId:state().recipients[0].fundingCoinId,recipientVault:fixture.review.recipient.recipientVault,
      recipientPuzzle:fixture.review.recipient.recipientPuzzle,feeCapMojos:100,kind:'CREATE_RECIPIENT_VAULT',
      requestKey:`recipient:${fixture.review.preparationManifest}:1`}});
  const unconfirmed=(op:GenerationOperationStatus|null=null)=>{
    const value=state();value.recipients[0]={...value.recipients[0],confirmed:false,confirmationFresh:false,
      confirmedCoinId:null,confirmedHeight:null,stage:'CHECK_REQUIRED',creation:op};return value;
  };
  beforeEach(()=>{
    old=runtime.generationId;runtime.generationId=fixture.review.generationId;
    api=jasmine.createSpyObj('GenerationRecipientsService',['status','check','prepare','acknowledge','prepareCreation','submitCreation']);
    wallet=jasmine.createSpyObj('EvmWalletService',['signRecipientAcknowledgement']);
    api.status.and.resolveTo(state());api.check.and.resolveTo(state());
    api.prepare.and.resolveTo(fixture as any);api.acknowledge.and.resolveTo(state());
    wallet.signRecipientAcknowledgement.and.resolveTo('test-signature');
    TestBed.configureTestingModule({imports:[GenerationRecipientsComponent],providers:[
      {provide:GenerationRecipientsService,useValue:api},{provide:EvmWalletService,useValue:wallet}]});
  });
  afterEach(()=>{TestBed.resetTestingModule();if(old===undefined)delete runtime.generationId;else runtime.generationId=old;});
  async function mount(){const f=TestBed.createComponent(GenerationRecipientsComponent);f.detectChanges();await f.whenStable();f.detectChanges();return f;}
  it('shows full destinations, exact amounts and only the signed-in administrator action',async()=>{
    const f=await mount(),text=f.nativeElement.textContent as string;
    expect(text).toContain(fixture.review.recipient.recipientVault);
    expect(text).toContain(fixture.review.recipient.recipientPuzzle);
    expect(text).toContain('970,000 SGT');expect(text).toContain('15,000 SGT');
    expect(f.nativeElement.querySelectorAll('article .actions').length).toBe(1);
    expect(text).toContain('No private ID check is required');
    expect(api.check).not.toHaveBeenCalled();expect(wallet.signRecipientAcknowledgement).not.toHaveBeenCalled();
  });
  it('coalesces double clicks and preserves the displayed destination during wallet review',async()=>{
    const f=await mount();let resolve!:(s:string)=>void;
    wallet.signRecipientAcknowledgement.and.returnValue(new Promise(r=>resolve=r));
    const first=f.componentInstance.acknowledge();await Promise.resolve();
    await f.componentInstance.acknowledge();
    expect(api.prepare).toHaveBeenCalledTimes(1);
    const captured=wallet.signRecipientAcknowledgement.calls.mostRecent().args[1];
    f.componentInstance.review.set({...state(),preparationManifest:'0x'+'99'.repeat(32)});
    expect(captured.preparationManifest).toBe(fixture.review.preparationManifest);
    resolve('test-signature');await first;
    expect(api.acknowledge).toHaveBeenCalledOnceWith(fixture.review.preparationManifest,'test-signature');
  });
  it('retains confirmed progress and offers retry after wallet rejection',async()=>{
    const f=await mount();wallet.signRecipientAcknowledgement.and.rejectWith(new Error('Request rejected in wallet'));
    await f.componentInstance.acknowledge();f.detectChanges();
    expect(f.componentInstance.pending()).toBeNull();expect(f.componentInstance.mine()?.confirmed).toBeTrue();
    expect(f.nativeElement.textContent).toContain('Request rejected in wallet');
    expect(api.acknowledge).not.toHaveBeenCalled();
  });
  it('shows separate review and submit actions without creating anything during polling',async()=>{
    api.status.and.resolveTo(unconfirmed());
    const f=await mount();
    expect(f.nativeElement.textContent).toContain('Review my vault creation');
    expect(api.prepareCreation).not.toHaveBeenCalled();expect(api.submitCreation).not.toHaveBeenCalled();
    const prepared=unconfirmed(operation());api.prepareCreation.and.resolveTo(prepared);api.status.and.resolveTo(prepared);
    await f.componentInstance.prepareCreation();f.detectChanges();
    expect(api.prepareCreation).toHaveBeenCalledOnceWith({generationId:fixture.review.generationId,
      preparationManifest:fixture.review.preparationManifest,administratorSlot:1,fundingCoinId:state().recipients[0].fundingCoinId,
      recipientVault:fixture.review.recipient.recipientVault,recipientPuzzle:fixture.review.recipient.recipientPuzzle,feeCapMojos:100});
    expect(f.nativeElement.textContent).toContain('Create this receiving vault');
    expect(f.nativeElement.textContent).toContain('100 mojos');
    expect(api.submitCreation).not.toHaveBeenCalled();expect(wallet.signRecipientAcknowledgement).not.toHaveBeenCalled();
  });
  it('coalesces creation clicks and recovers the exact saved action after a lost submit response',async()=>{
    const op=operation();api.status.and.resolveTo(unconfirmed(op));
    const f=await mount();let reject!:(reason:Error)=>void;
    api.submitCreation.and.returnValue(new Promise((_,r)=>reject=r));
    const first=f.componentInstance.submitCreation();await f.componentInstance.submitCreation();
    expect(api.submitCreation).toHaveBeenCalledTimes(1);
    const submitted={...op,transactionId:'0x'+'66'.repeat(32),stage:'RECONCILING' as const,updatedAt:1001,errorCode:'RECONCILIATION_REQUIRED'};
    api.status.and.resolveTo(unconfirmed(submitted));reject(new Error('Response lost'));
    await first;f.detectChanges();
    expect(f.componentInstance.mine()?.creation?.transactionId).toBe(submitted.transactionId);
    expect(f.nativeElement.textContent).toContain('checking the saved transaction automatically');
    api.status.and.resolveTo(unconfirmed(op));await f.componentInstance.refresh.refresh();
    expect(f.componentInstance.mine()?.creation?.transactionId).toBe(submitted.transactionId);
    await f.componentInstance.submitCreation();expect(api.submitCreation).toHaveBeenCalledTimes(1);
  });
  it('rejects a saved launch assigned to another recipient and keeps the displayed destination',async()=>{
    api.status.and.resolveTo(unconfirmed());const f=await mount();
    const wrong=operation();wrong.review={...wrong.review! as any,recipientVault:'0x'+'99'.repeat(32)};
    api.prepareCreation.and.resolveTo(unconfirmed(wrong));
    await f.componentInstance.prepareCreation();f.detectChanges();
    expect(f.componentInstance.mine()?.creation).toBeNull();expect(api.submitCreation).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('saved launch does not match this recipient');
  });
  it('keeps creation disabled when release gates are closed',async()=>{
    api.status.and.resolveTo({...unconfirmed(),creationAvailable:false,maximumFeeMojos:'0'});
    const f=await mount();await f.componentInstance.prepareCreation();
    expect(api.prepareCreation).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('Creation opens after the reviewed deployment');
  });
});
