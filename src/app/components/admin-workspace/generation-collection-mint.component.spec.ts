import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { CollectionWorkspace } from '../../services/collection-api.service';
import { GenerationMintReviewService } from '../../services/generation-mint-review.service';
import { AdminStatusRefresh } from '../../services/admin-status-refresh.service';
import { GenerationCollectionMintComponent } from './generation-collection-mint.component';
import fixture from '../../utils/generation-mint-review.fixture.json';
import { GenerationGovernanceService } from '../../services/generation-governance.service';
import { GenerationConsentService } from '../../services/generation-consent.service';
import { AdminSessionService } from '../../services/admin-session.service';
import { provideRouter } from '@angular/router';
import { GenerationMintExecutionService } from '../../services/generation-mint-execution.service';

describe('One sealed test batch in the native collection editor',()=>{
  let api:jasmine.SpyObj<GenerationMintReviewService>,original:string|undefined;
  let refresh:any;
  const protocol=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  beforeEach(()=>{
    original=protocol.generationId;protocol.generationId=fixture.generationId;
    api=jasmine.createSpyObj('mint review',['saved','prepare']);api.saved.and.resolveTo(null);api.prepare.and.resolveTo(structuredClone(fixture) as any);
    refresh={start:()=>undefined,refresh:async()=>undefined};
    TestBed.configureTestingModule({providers:[provideRouter([]),{provide:GenerationMintReviewService,useValue:api},{provide:AdminStatusRefresh,useValue:refresh},
      {provide:GenerationGovernanceService,useValue:{status:async()=>({status:'NOT_READY'}),operations:async()=>({available:false})}},
      {provide:GenerationConsentService,useValue:{list:async()=>[]}},
      {provide:GenerationMintExecutionService,useValue:{saved:async()=>({operation:null,inventory:{receipt:null}})}},
      {provide:AdminSessionService,useValue:{authoritySlot:()=>0,pubkey:()=>''}}]});
  });
  afterEach(()=>protocol.generationId=original);
  function component(){
    const f=TestBed.createComponent(GenerationCollectionMintComponent);
    // This suite exercises the real template as well as action behavior.
    f.componentRef.setInput('collection',{id:fixture.request.collectionId,generationId:fixture.generationId,
      revision:fixture.request.revision,metadataRoot:fixture.request.metadataRoot,draftHash:fixture.request.previewHash,
      state:'SEALED',dossier:fixture.canonicalMetadata} as unknown as CollectionWorkspace);
    return f;
  }
  it('prepares one batch and renders allocation, predicted outputs and separate next steps',async()=>{
    const f=component();await f.componentInstance.prepare();f.detectChanges();
    const text=f.nativeElement.textContent;expect(text).toContain('25 unique SmartDeeds');expect(text).toContain('$75,000');
    expect(text).toContain('No wallet prompt or transaction');expect(text).toContain('predicted outputs');
    expect(api.prepare.calls.count()).toBe(1);expect(f.componentInstance.review()?.publicationReady).toBeFalse();
    expect(text).toContain('Prepare exact test mint publication');expect(text).toContain('Mint execution is disabled');f.destroy();
  });
  it('blocks duplicate clicks while preparing and never requests a signature',async()=>{
    const f=component();let resolve!:(v:any)=>void;
    api.prepare.and.returnValue(new Promise(r=>resolve=r));const first=f.componentInstance.prepare();
    await f.componentInstance.prepare();expect(api.prepare.calls.count()).toBe(1);
    resolve(structuredClone(fixture));await first;
  });
  it('recovers the identical request after a lost response',async()=>{
    const f=component();api.prepare.and.rejectWith(new Error('response lost'));
    await f.componentInstance.prepare();const first=api.prepare.calls.mostRecent().args[0];
    api.prepare.and.resolveTo(structuredClone(fixture) as any);await f.componentInstance.prepare();
    expect(api.prepare.calls.mostRecent().args[0]).toEqual(first);expect(f.componentInstance.review()?.packageId).toBe(fixture.packageId);
  });
  it('blocks a draft, old generation and production edition',async()=>{
    const f=component(),base=f.componentInstance.collection();
    for(const mutation of [{state:'DRAFT'},{generationId:'0x'+'ff'.repeat(32)},{dossier:{...base.dossier,purpose:undefined}}]){
      f.componentRef.setInput('collection',{...base,...mutation});await f.componentInstance.prepare();
    }
    api.prepare.and.stub();expect(api.prepare.calls.count()).toBe(0);
  });
});
