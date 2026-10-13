import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { CollectionWorkspace } from '../../services/collection-api.service';
import { GenerationCollectionMintComponent } from './generation-collection-mint.component';
import { GenerationMintReviewService } from '../../services/generation-mint-review.service';
import { GenerationMintExecutionService } from '../../services/generation-mint-execution.service';
import { GenerationGovernanceService } from '../../services/generation-governance.service';
import { GenerationConsentService } from '../../services/generation-consent.service';
import { AdminSessionService } from '../../services/admin-session.service';
import prepared from '../../utils/generation-mint-execution.fixture.json';
import confirmed from '../../utils/generation-mint-confirmation.fixture.json';

describe('Native collection mint execution experience',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:string|undefined,mint:jasmine.SpyObj<GenerationMintExecutionService>;
  beforeEach(()=>{
    previous=runtime.generationId;runtime.generationId=prepared.source.generationId;
    mint=jasmine.createSpyObj('mint',['saved','prepare','submit']);mint.saved.and.resolveTo(prepared.execution as any);
    mint.prepare.and.resolveTo(prepared.execution as any);mint.submit.and.resolveTo(confirmed.execution as any);
    TestBed.configureTestingModule({providers:[provideRouter([]),{provide:GenerationMintExecutionService,useValue:mint},
      {provide:GenerationMintReviewService,useValue:{saved:async()=>prepared.source}},
      {provide:GenerationGovernanceService,useValue:{status:async()=>({status:'NOT_READY'}),operations:async()=>({available:false})}},
      {provide:GenerationConsentService,useValue:{list:async()=>[]}},
      {provide:AdminSessionService,useValue:{authoritySlot:()=>0,pubkey:()=>''}}]});
  });
  afterEach(()=>{
    sessionStorage.removeItem('solslot_generation_mint_prepare:'+prepared.source.generationId+':'+prepared.source.request.collectionId);
    if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;
  });
  function component(){
    const f=TestBed.createComponent(GenerationCollectionMintComponent),r=prepared.source;
    f.componentRef.setInput('collection',{id:r.request.collectionId,generationId:r.generationId,revision:r.request.revision,
      metadataRoot:r.request.metadataRoot,draftHash:r.request.previewHash,state:'SEALED',dossier:r.canonicalMetadata} as unknown as CollectionWorkspace);
    f.componentInstance.review.set(r as any);
    f.componentInstance.operations.set({available:true,executionEnabled:true,maximumFeeMojos:'1000'} as any);
    const req=prepared.execution.operation.review;
    f.componentInstance.status.set({status:'READY',lastCheckedAt:Math.floor(Date.now()/1000),snapshot:{proposal:null,pendingUpgrade:null,pauseMask:0,
      approvedActions:[{kind:'MINT_TEST_ONLY',billHash:r.billHash,proposalId:req.proposalId}],
      componentEvidence:{[r.mintAuthority.componentId]:{coinId:r.mintAuthority.coinId}},
      chainEvidence:Object.fromEntries(['registry','governance','holdings'].map(k=>[k,{coinId:req.expectedInputs[k as 'registry']}]))}} as any);
    return f;
  }
  it('prepares without submitting and blocks duplicate clicks during exact preparation',async()=>{
    const f=component();let complete!:(v:any)=>void;mint.prepare.and.returnValue(new Promise(r=>complete=r));
    const first=f.componentInstance.prepareMint();await f.componentInstance.prepareMint();expect(mint.prepare.calls.count()).toBe(1);
    complete(prepared.execution);await first;expect(mint.submit).not.toHaveBeenCalled();expect(f.componentInstance.execution()?.operation?.kind).toBe('MINT_COLLECTION');f.destroy();
  });
  it('keeps the exact review across a failed preparation and recovers it on explicit retry',async()=>{
    const f=component();mint.prepare.and.rejectWith(new Error('lost response'));await f.componentInstance.prepareMint();
    const req=mint.prepare.calls.mostRecent().args[1];mint.prepare.and.resolveTo(prepared.execution as any);
    await f.componentInstance.prepareMint();expect(mint.prepare.calls.mostRecent().args[1]).toEqual(req);expect(mint.submit).not.toHaveBeenCalled();f.destroy();
  });
  it('renders the verified 25-deed inventory without offering another mint',()=>{
    const f=component();f.componentInstance.execution.set(confirmed.execution as any);f.detectChanges();
    expect(f.nativeElement.textContent).toContain('25 test SmartDeeds minted and verified');
    expect(f.nativeElement.textContent).toContain('initial mint evidence');expect(f.nativeElement.textContent).not.toContain('Submit this exact test mint');
    expect(f.componentInstance.step()).toBe(4);expect(mint.prepare).not.toHaveBeenCalled();expect(mint.submit).not.toHaveBeenCalled();f.destroy();
  });
});
