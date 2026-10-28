import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy,Component,computed,inject,input,OnInit,signal } from '@angular/core';
import { CollectionWorkspace } from '../../services/collection-api.service';
import { GenerationMintReviewService } from '../../services/generation-mint-review.service';
import { GenerationMintReview,MintReviewRequest } from '../../utils/generation-mint-review';
import { deploymentGeneration } from '../../utils/deployment-generation';
import { AdminStatusRefresh } from '../../services/admin-status-refresh.service';
import { AdminRefreshStatusComponent } from './admin-refresh-status.component';
import { uint64 } from '../../utils/strict-clvm';
import { RouterLink } from '@angular/router';
import { GenerationGovernanceService,GenerationGovernanceStatus,GenerationOperations,GenerationOperationStatus,mergeGenerationReceipt } from '../../services/generation-governance.service';
import { GenerationConsentsComponent } from '../../pages/admin/committee/generation-consents.component';
import { GenerationBallotsComponent } from '../../pages/admin/committee/generation-ballots.component';
import { GenerationConsentReview } from '../../services/generation-consent.service';
import { GenerationMintExecutionService } from '../../services/generation-mint-execution.service';
import { MintExecutionStatus } from '../../utils/generation-mint-execution-review';
import { MintExecutionRequest } from '../../services/generation-governance.service';

@Component({selector:'solslot-generation-collection-mint',standalone:true,imports:[CommonModule,RouterLink,AdminRefreshStatusComponent,GenerationConsentsComponent,GenerationBallotsComponent],
  providers:[AdminStatusRefresh],changeDetection:ChangeDetectionStrategy.OnPush,
  template:`
  <section class="batch" aria-labelledby="test-batch-title" [attr.aria-busy]="busy()">
    <p class="eyebrow">Testnet11 · one collection batch</p><h3 id="test-batch-title">Review the sealed test mint</h3>
    <p>Prepare the entire allocation once. Administrator consent, holder voting, mint submission and confirmed inventory are separate steps.</p>
    <ol class="steps" aria-label="Mint lifecycle"><li [class.current]="step()===1">1. Sealed batch review</li><li [class.current]="step()===2">2. Administrator approvals</li><li [class.current]="step()===3">3. Holder vote</li><li [class.current]="step()===4">4. Mint and confirm</li></ol>
    <solslot-admin-refresh-status [state]="refresh" />
    @if(busy()){<p class="wait" role="status"><span class="spinner" aria-hidden="true"></span>Checking your sealed edition and saving its exact launcher funding…</p>}
    @if(error()){<p class="notice" role="status">{{error()}}</p>}
    @if(review(); as r){
      <div class="review" aria-label="Saved batch review">
        <span class="badge">TEST ONLY · no real investment or property rights</span>
        <h4>{{r.canonicalMetadata.title}}</h4>
        <p>{{r.funding.length}} unique SmartDeeds · {{usd(r.canonicalMetadata.offering.targetRaiseMinor)}} total recap</p>
        <p>Dollar terms and sealed XCH par remain fixed for this review. A live display price cannot rewrite them.</p>
        <ul class="allocations">@for(deed of r.canonicalMetadata.deedAllocation; track deed.deedId){
          <li><strong>{{deed.deedId}}</strong><span>{{deed.sharePpm/10000 | number:'1.0-4'}}% · {{allocationUsd(r,deed.sharePpm)}}</span></li>
        }</ul>
        <p>Technology fee: {{r.canonicalMetadata.offering.royaltyBps/100 | number:'1.0-2'}}%. Sponsor and builder remain separate in the sealed property record.</p>
        <div class="next"><strong>{{execution()?.inventory?.receipt ? "Mint confirmed. Inventory verified." : step()===4 ? "Vote passed. Continue the exact saved mint below." : step()===3 ? "Holder voting and confirmation" : "Batch saved. Administrator approval is next."}}</strong>@if(step()<3){<p>{{r.nextAction}}</p>}
          @if(step()<3){<p>Preparation sends no transaction. Both administrators approve this exact sealed edition before holders vote.</p>}</div>
        <details><summary>Sealed source and fixed launcher funding</summary>
          <dl><dt>Saved package</dt><dd><code>{{r.packageId}}</code></dd><dt>Metadata root · revision {{r.request.revision}}</dt><dd><code>{{r.request.metadataRoot}}</code></dd>
            <dt>Edition commitment</dt><dd><code>{{r.editionHash}}</code></dd><dt>Mint authority</dt><dd><code>{{r.mintAuthority.launcherId}}</code></dd></dl>
          <p>These confirmed parents are held for this edition. Deed launchers and inventory below are predicted outputs, {{execution()?.inventory?.receipt ? "verified in the confirmed mint below." : "pending mint confirmation."}}</p>
          @for(f of r.funding; track f.coinId){<dl><dt>Confirmed funding coin · block {{f.confirmedHeight | number}}</dt><dd><code>{{f.coinId}}</code></dd>
            <dt>Predicted deed launcher</dt><dd><code>{{f.launcherId}}</code></dd><dt>Predicted inventory coin</dt><dd><code>{{f.inventoryCoinId}}</code></dd></dl>}
        </details>
      </div>
      <details [open]="step()<4"><summary>{{step()>=4 ? "Completed approvals and voting" : "Administrator approval and holder voting"}}</summary>
      @if(step()<4){<solslot-generation-consents [mintSource]="r" [showGeneralActions]="false" [snapshot]="status()?.snapshot ?? null"
        [isCurrent]="isCurrent() && reviewMatchesSource()" [available]="!!operations()?.available && reviewMatchesSource()" [maximumFee]="operations()?.maximumFeeMojos ?? '0'"
        (sponsorReview)="sponsorship.set($event)" />
      @if(sponsorship(); as s){<solslot-generation-ballots [consent]="s" [snapshot]="status()?.snapshot ?? null"
        [isCurrent]="isCurrent() && reviewMatchesSource()" [available]="!!operations()?.available && reviewMatchesSource()" [maximumFee]="operations()?.maximumFeeMojos ?? '0'"
        (prepared)="preparedVote.set($event)" />}
      @if(preparedVote(); as v){<div class="next" role="status"><strong>{{v.stage==='CONFIRMED'?'Confirmed':'Saved'}} {{v.kind==='OPEN_PROPOSAL'?'proposal opening':'holder vote'}}.</strong>
        <p>Follow this exact saved transaction in the committee desk. A confirmed opening starts the voting clock.</p>
        <code>{{v.operationId}}</code><a routerLink="/committee">Open committee desk →</a></div>}
      }@else{<p>Administrator consent and the holder vote are complete. Their saved evidence remains in the committee history.</p><a routerLink="/committee">View recorded vote →</a>}
      </details>
      <section class="mint-execution" aria-labelledby="batch-execution-title">
        <h4 id="batch-execution-title">Mint and confirm this entire batch</h4>
        @if(executionBusy()){<p class="wait" role="status"><span class="spinner" aria-hidden="true"></span>{{executionBusy()==='PREPARING'?'Checking the passed vote and saving the exact mint…':'Submitting the saved mint. Confirmation updates automatically…'}}</p>}
        @if(execution()?.inventory?.receipt; as receipt){
          <div class="next" role="status"><strong>✓ {{receipt.deedCount}} test SmartDeeds minted and verified</strong>
            <p>Confirmed in block {{receipt.confirmedHeight | number}}. Every unique inventory output matches this sealed edition.</p>
            <p>This is initial mint evidence. Customer delivery and subsequent holdings are separate.</p>
            @if(status()?.snapshot?.closedStakeCount){<a routerLink="/committee">Return closed voting stakes →</a>}@else{<p>Voting stakes have been returned.</p>}
            <details><summary>Confirmed inventory ({{receipt.deedCount}})</summary>@for(row of receipt.inventory; track row.coinId){
              <dl><dt>SmartDeed launcher</dt><dd><code>{{row.launcherId}}</code></dd><dt>Initial inventory coin</dt><dd><code>{{row.coinId}}</code></dd></dl>}</details>
          </div>
        }@else if(execution()?.operation; as op){
          <p class="wait" role="status">@if(op.transactionId){<span class="spinner" aria-hidden="true"></span>}{{mintMessage()}}</p>
          <p>Maximum network fee: {{op.feeCapMojos}} mojos · existing test fee fund. No new wallet signature is requested for this voted mint.</p>
          <details><summary>Exact saved mint</summary><dl><dt>Operation</dt><dd><code>{{op.operationId}}</code></dd>
            <dt>Transaction</dt><dd><code>{{op.transactionId ?? 'Not submitted'}}</code></dd><dt>Reviewed intent</dt><dd><code>{{op.intentHash}}</code></dd></dl></details>
          @if(!op.transactionId && op.stage==='PREPARED'){<button class="primary" type="button" [disabled]="!!executionBusy() || !operations()?.executionEnabled || !reviewMatchesSource()" (click)="submitMint()">Submit this exact test mint</button>}
          @if(execution()?.inventory?.errorCode){<p class="notice">Inventory verification is temporarily unavailable. The original transaction is retained and checks continue automatically.</p>}
        }@else{
          <p>A passed, closed holder vote is required. Preparing the mint fixes its transaction; submission is a separate action.</p>
          <button type="button" class="primary" [disabled]="!!executionBusy() || (!executionRequest() && !canMint())" (click)="prepareMint()">{{executionRequest()?'Recover this exact mint review':'Review mint transaction'}}</button>
          @if(!operations()?.executionEnabled){<p class="notice">Mint execution is disabled for this deployment. Your batch and approvals remain saved.</p>}
        }
      </section>
    }@else{
      <p>Preparation checks the saved preview, independent review, signed pricing and current mint authority. It reserves one confirmed launcher parent per deed.</p>
      <button type="button" class="primary" [disabled]="!canPrepare()" (click)="prepare()">{{request()?'Recover this saved batch':'Prepare test mint review'}}</button>
      @if(!sourceReady()){<p class="notice">This sealed edition must belong to the active Testnet generation before review preparation is available.</p>}
    }
  </section>`,
  styles:[`:host{display:block}.batch{padding:1.5rem;border:1px solid var(--admin-border,#29463b);border-radius:1rem}
    .eyebrow,.badge{font-size:.8rem;font-weight:700;letter-spacing:.04em}h3{font-size:1.6rem;margin:.4rem 0}h4{font-size:1.2rem}
    p{line-height:1.6}.steps{display:flex;flex-wrap:wrap;list-style:none;gap:.7rem;padding:0}.steps li{padding:.65rem;border:1px solid var(--admin-border,#29463b);border-radius:.5rem}
    .current,.next{background:var(--admin-surface,#102b22)}.next,.notice{padding:1rem;border-radius:.65rem}.allocations{list-style:none;padding:0;max-height:20rem;overflow:auto}
    .allocations li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem;padding:.6rem 0;border-bottom:1px solid var(--admin-border,#29463b)}
    .primary{background:var(--admin-accent,#85dfb0);color:var(--admin-bg,#071c14);padding:.85rem 1.2rem;border:0;border-radius:.5rem;font-weight:700;cursor:pointer}
    button:disabled{opacity:.6;cursor:default}.wait{display:flex;align-items:center;gap:.7rem}.spinner{width:1rem;height:1rem;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 1s linear infinite}
    details{margin-top:1rem}dl{margin:1rem 0}dd{margin:.35rem 0 .8rem}code{overflow-wrap:anywhere;font-size:.8rem}@keyframes spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.spinner{animation:none}}`],
})
export class GenerationCollectionMintComponent implements OnInit {
  private readonly api=inject(GenerationMintReviewService);
  private readonly governance=inject(GenerationGovernanceService);
  private readonly mint=inject(GenerationMintExecutionService);
  readonly refresh=inject(AdminStatusRefresh);
  readonly collection=input.required<CollectionWorkspace>();
  readonly review=signal<GenerationMintReview|null>(null);
  readonly busy=signal(false);
  readonly error=signal<string|null>(null);
  readonly request=signal<MintReviewRequest|null>(null);
  readonly status=signal<GenerationGovernanceStatus|null>(null);
  readonly operations=signal<GenerationOperations|null>(null);
  readonly sponsorship=signal<GenerationConsentReview|null>(null);
  readonly preparedVote=signal<GenerationOperationStatus|null>(null);
  readonly execution=signal<MintExecutionStatus|null>(null);
  readonly executionBusy=signal<'PREPARING'|'SUBMITTING'|null>(null);
  readonly executionRequest=signal<MintExecutionRequest|null>(null);
  readonly step=computed(()=>{
    const r=this.review(),s=this.status()?.snapshot;if(!r)return 1;
    if(this.execution()?.operation)return 4;
    if(s?.approvedActions.some(a=>a.kind==='MINT_TEST_ONLY' && a.billHash===r.billHash))return 4;
    if(s?.proposal?.billHash===r.billHash || this.sponsorship() || this.preparedVote())return 3;
    return 2;
  });
  readonly isCurrent=computed(()=>this.status()?.status==='READY' && !!this.status()?.lastCheckedAt &&
    this.refresh.now()-this.status()!.lastCheckedAt!*1000>=0 && this.refresh.now()-this.status()!.lastCheckedAt!*1000<=90_000);
  readonly reviewMatchesSource=computed(()=>{
    const r=this.review(),c=this.collection();return !!r && this.sourceReady() && r.request.collectionId===c.id &&
      r.request.revision===c.revision && r.request.metadataRoot===c.metadataRoot && r.request.previewHash===c.draftHash;
  });
  readonly sourceReady=computed(()=>{
    const c=this.collection();return c.generationId===deploymentGeneration() && !!deploymentGeneration() &&
      c.dossier.purpose==='TEST_ONLY' && ['SEALED','PUBLISHED'].includes(c.state) && !!c.metadataRoot && !!c.draftHash;
  });
  readonly canPrepare=computed(()=>this.sourceReady() && !this.busy() && !this.review());
  readonly canMint=computed(()=>{
    const r=this.review(),s=this.status()?.snapshot;
    return !!r && !!s && this.reviewMatchesSource() && this.isCurrent() && !!this.operations()?.executionEnabled &&
      !s.proposal && !s.pendingUpgrade && !(s.pauseMask&2) && !this.execution()?.operation &&
      s.approvedActions.some(a=>a.kind==='MINT_TEST_ONLY' && a.billHash===r.billHash) &&
      s.componentEvidence[r.mintAuthority.componentId]?.coinId===r.mintAuthority.coinId;
  });
  usd(minor:string):string {
    const value=uint64(minor);return '$'+(value/100n).toLocaleString('en-US')+'.'+(value%100n).toString().padStart(2,'0');
  }
  allocationUsd(review:GenerationMintReview,share:number):string {
    return this.usd((uint64(review.canonicalMetadata.offering.targetRaiseMinor)*BigInt(share)/1_000_000n).toString());
  }
  private remember(value:GenerationMintReview):void {
    const c=this.collection();if(value.generationId!==c.generationId || value.request.collectionId!==c.id ||
      value.request.revision!==c.revision || value.request.metadataRoot!==c.metadataRoot || value.request.previewHash!==c.draftHash)
      throw new Error('Saved mint source differs from the current sealed property revision.');
    const prior=this.review();if(prior && prior.packageId!==value.packageId)throw new Error('Saved mint batch changed. Retain the original review.');
    this.review.set(structuredClone(value));
  }
  ngOnInit():void {
    try{
      const raw=sessionStorage.getItem(this.executionStorageKey());
      if(raw && raw.length<=16384){const v=JSON.parse(raw);if(v.generationId===deploymentGeneration())this.executionRequest.set(v);}
    }catch{}
    this.refresh.start(async()=>{
      if(!this.sourceReady())return;
      const results=await Promise.allSettled([this.api.saved(this.collection().id),this.governance.status(),this.governance.operations()]);
      if(results[0].status==='fulfilled'){
        if(results[0].value)this.remember(results[0].value);
        else if(this.review())throw new Error('The saved batch is temporarily unavailable. Keep the original review.');
      }
      if(results[1].status==='fulfilled')this.status.set(results[1].value);
      if(results[2].status==='fulfilled'){
        this.operations.set(results[2].value);
        const previous=this.preparedVote(),next=previous && results[2].value.operations?.find(v=>v.operationId===previous.operationId);
        if(next)this.preparedVote.set(mergeGenerationReceipt(previous!,next));
      }
      else this.operations.set(null); // Cached source stays visible; actions fail closed.
      for(const result of results)if(result.status==='rejected')throw result.reason;
      const source=this.review();if(source){
        const value=await this.mint.saved(source);this.execution.set(value);
        if(value.operation)this.saveExecutionRequest(null);
      }
    },()=>this.busy() || this.executionBusy()?'Finishing your explicit batch action. Saved progress will refresh afterward.':null,
      ()=>!!this.status()?.snapshot?.proposal || !!this.preparedVote() && this.preparedVote()?.stage!=='CONFIRMED' ||
        !!this.execution()?.operation?.transactionId && !this.execution()?.inventory.receipt);
  }
  private executionStorageKey():string {return 'solslot_generation_mint_prepare:'+deploymentGeneration()+':'+this.collection().id;}
  private saveExecutionRequest(request:MintExecutionRequest|null):void {
    this.executionRequest.set(request);try{
      if(request)sessionStorage.setItem(this.executionStorageKey(),JSON.stringify(request));else sessionStorage.removeItem(this.executionStorageKey());
    }catch{}
  }
  async prepareMint():Promise<void> {
    const r=this.review(),s=this.status()?.snapshot;if(!r || !s || this.executionBusy() || (!this.executionRequest() && !this.canMint()))return;
    const approved=s.approvedActions.find(a=>a.kind==='MINT_TEST_ONLY' && a.billHash===r.billHash);
    const req=this.executionRequest() ?? {generationId:r.generationId,sourceReviewId:r.packageId,proposalId:approved!.proposalId,
      feeCapMojos:Number(this.operations()!.maximumFeeMojos),expectedInputs:{registry:s.chainEvidence['registry'].coinId,
        governance:s.chainEvidence['governance'].coinId,holdings:s.chainEvidence['holdings'].coinId,
        components:{[r.mintAuthority.componentId]:r.mintAuthority.coinId}}};
    this.saveExecutionRequest(structuredClone(req));this.executionBusy.set('PREPARING');this.error.set(null);
    try{this.execution.set(await this.mint.prepare(r,req));this.saveExecutionRequest(null);}
    catch{this.error.set('The mint review could not finish. Recover this exact review before starting another. Your sealed source and funding remain saved.');}
    finally{this.executionBusy.set(null);await this.refresh.refresh();}
  }
  async submitMint():Promise<void> {
    const r=this.review(),v=this.execution();
    if(!r || !v?.operation || this.executionBusy() || !this.operations()?.executionEnabled || !this.reviewMatchesSource())return;
    this.executionBusy.set('SUBMITTING');this.error.set(null);
    try{this.execution.set(await this.mint.submit(r,v));}
    catch{this.error.set('Submission status could not be confirmed. Keep the original mint; automatic checks will recover saved progress. Do not prepare a replacement.');}
    finally{this.executionBusy.set(null);await this.refresh.refresh();}
  }
  mintMessage():string {
    const v=this.execution(),op=v?.operation;if(!op)return 'Waiting for the exact passed vote.';
    if(op.errorCode==='FEE_CAP_EXCEEDED')return 'The network fee is above the approved ceiling. This batch is saved; retry this same mint when fees fit.';
    if(op.stage==='CONFIRMED')return 'Transaction confirmed. Verifying every initial inventory output automatically…';
    if(op.transactionId)return 'Your exact mint is saved. Checking Chia confirmation automatically…';
    if(op.errorCode)return 'The network check did not complete. Your exact reviewed mint is retained.';
    return 'Ready to submit the entire sealed batch. No SmartDeeds exist until confirmation.';
  }
  async prepare():Promise<void> {
    if(!this.canPrepare())return;
    const c=this.collection();
    const req=this.request()??{generationId:c.generationId!,collectionId:c.id,revision:c.revision,metadataRoot:c.metadataRoot!,previewHash:c.draftHash!};
    this.request.set(structuredClone(req));this.busy.set(true);this.error.set(null);
    try{this.remember(await this.api.prepare(structuredClone(req)));}
    catch(error){
      const detail=(error as {error?:{detail?:{code?:string}}})?.error?.detail;
      if(detail?.code==='GENERATION_MINT_TREASURY_MISMATCH'){
        this.request.set(null);
        this.error.set('The sealed fee destination belongs to another generation. Use Create corrected revision in the property workspace, then review and seal the correction. No mint batch or funding holds were saved.');
      }else this.error.set('We couldn’t finish the sealed batch review. Recover this same batch to keep its original funding. If the source or funding changed, an operator must reconcile it before preparing a replacement.');
    }
    finally{this.busy.set(false);await this.refresh.refresh();}
  }
}
