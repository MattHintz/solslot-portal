import {CommonModule,DOCUMENT} from '@angular/common';
import {ChangeDetectionStrategy,Component,EventEmitter,OnInit,Output,computed,inject,signal} from '@angular/core';
import {GenerationFinalLaunchService,FinalLaunchStatus} from '../../services/generation-final-launch.service';
import {EvmWalletService} from '../../services/evm-wallet.service';
import {AdminStatusRefresh} from '../../services/admin-status-refresh.service';
import {AdminRefreshStatusComponent} from './admin-refresh-status.component';
import {validateFinalLaunch,finalLaunchPayload} from '../../utils/generation-final-launch-review';
import {canonicalConsent} from '../../utils/generation-consent-review';
import {mergeGenerationReceipt} from '../../services/generation-governance.service';
import {consentLabel,launchDeadline,launchInstructions,requireSharedLaunchReview} from '../../utils/launch-coordination';
@Component({selector:'solslot-generation-final-launch',standalone:true,imports:[CommonModule,AdminRefreshStatusComponent],
  providers:[AdminStatusRefresh],templateUrl:'./generation-final-launch.component.html',styleUrl:'./generation-final-launch.component.scss',
  changeDetection:ChangeDetectionStrategy.OnPush})
export class GenerationFinalLaunchComponent implements OnInit {
  private readonly api=inject(GenerationFinalLaunchService);private readonly wallet=inject(EvmWalletService);
  private readonly document=inject(DOCUMENT);
  readonly refresh=inject(AdminStatusRefresh);readonly status=signal<FinalLaunchStatus|null>(null);
  readonly pending=signal<string|null>(null);readonly error=signal<string|null>(null);readonly unavailable=signal(false);
  readonly uncertain=signal(false);readonly review=computed(()=>this.status()?.review);
  readonly linkMismatch=signal(false);readonly instructions=signal<string|null>(null);readonly copyMessage=signal<string|null>(null);
  readonly stages=['Review release','Administrator consent','Submit once','Chain confirmation','Launch complete'];
  readonly currentStage=computed(()=>this.review()?.launchComplete?4:this.status()?.operation?.transactionId?3:this.consentComplete()?2:this.review()?1:0);
  readonly deadline=computed(()=>this.review()?launchDeadline(this.review()!):null);
  readonly remaining=computed(()=>{
    const end=this.deadline();if(!end)return '';
    const seconds=Math.max(0,Math.floor(end-this.refresh.now()/1000));
    return seconds>=3600?`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m remaining`:
      `${Math.floor(seconds/60)}m ${seconds%60}s remaining`;
  });
  readonly nextStep=computed(()=>{
    const s=this.status(),r=this.review();
    if(r?.launchComplete)return {title:'Launch confirmed',body:'All three administrator grants are issued. Next: the governed upgrade rehearsal, then the test property mint.'};
    if(s?.operation?.transactionId)return {title:'Waiting for chain confirmation',body:'The saved transaction is being followed automatically. You can return later; do not create another launch.'};
    if(this.expired())return {title:'Review expired',body:'The saved evidence is retained. The owner must review renewal before any further action.'};
    if(!r)return {title:'Prepare the launch together',body:'Complete the receiving-vault acknowledgements in advance. The owner opens the exact final review when the release and recovery checks are ready.'};
    if(this.consentComplete())return this.owner()?{title:s?.operation?'Submit the saved launch':'Administrator consent is complete',body:'Only the owner continues from here. No additional administrator signatures are needed.'}:
      {title:'Your team’s consent is complete',body:'The owner will prepare and submit the exact launch. You do not need to sign again.'};
    if(r.approvedSlots.includes(s!.assignedSlot))return {title:'Your consent is saved',body:r.approvedSlots.includes(1)?'Waiting for one coadministrator. Share the exact review below.':'Waiting for the owner’s consent. Your saved signature is retained.'};
    return {title:'Your launch consent is needed',body:'Open the assigned administrator wallet shown below and review the launch request. This signature sends no transaction.'};
  });
  readonly mine=computed(()=>this.review()?.recipients.find(r=>r.administratorSlot===this.status()?.assignedSlot));
  readonly owner=computed(()=>this.status()?.assignedSlot===1);
  readonly consentComplete=computed(()=>this.review()?.approvedSlots.includes(1) && this.review()?.approvedSlots.some(n=>n===2||n===3));
  readonly expired=computed(()=>{this.refresh.now();return !!this.review() && this.refresh.now()/1000>=Math.min(this.review()!.expiresAt,this.review()!.releaseExpiresAt);});
  @Output() readonly sessionExpired=new EventEmitter<void>();
  @Output() readonly stateChange=new EventEmitter<FinalLaunchStatus>();
  ngOnInit(){this.refresh.start(async()=>{
    try{this.accept(await this.api.status());this.unavailable.set(false);}
    catch(e){if((e as {status?:number}).status===503 && (e as any).error?.detail?.code==='GENERATION_FINAL_RELEASE_NOT_READY'){
      this.unavailable.set(true);return;}this.report(e);throw e;}
  },()=>this.pending()?'Finish the displayed wallet or launch step; saved status will refresh afterward.':null,
    ()=>!!this.review() && !this.review()!.launchComplete && !this.expired());}
  private accept(value:FinalLaunchStatus){
    const next=validateFinalLaunch(value),old=this.status();
    try{requireSharedLaunchReview(this.document.location.href,next.review);this.linkMismatch.set(false);}
    catch(e){this.linkMismatch.set(true);throw e;}
    if(old?.review && next.review?.reviewId===old.review.reviewId &&
      canonicalConsent(finalLaunchPayload(next.review))!==canonicalConsent(finalLaunchPayload(old.review)))
        throw new Error('The signed launch review changed. Reconcile its original receipt.');
    if(old?.operation && next.operation)next.operation=mergeGenerationReceipt(old.operation,next.operation);
    if(old?.operation && !next.operation)next.operation=old.operation;
    if(old?.review && !next.review)next.review=old.review;
    if(old?.review && next.review?.reviewId===old.review.reviewId)
      next.review.approvedSlots=[...new Set([...old.review.approvedSlots,...next.review.approvedSlots])].sort();
    validateFinalLaunch(next);
    if(old?.review?.reviewId!==next.review?.reviewId){this.instructions.set(null);this.copyMessage.set(null);}
    if(next.operation?.transactionId)this.uncertain.set(false);
    this.status.set(next);this.stateChange.emit(next);this.refresh.updated();
  }
  signerLabel(slot:number):string{return this.review()?consentLabel(this.review()!,slot):'';}
  currentSetupUrl():string{return new URL('admin/genesis',this.document.baseURI).href;}
  async share():Promise<void>{
    const r=this.review();if(!r||r.launchComplete||this.expired()||this.linkMismatch())return;
    const text=launchInstructions(r,this.document.baseURI);this.instructions.set(text);
    try{
      const clipboard=this.document.defaultView?.navigator.clipboard;
      if(!clipboard)throw new Error('Clipboard unavailable');
      await clipboard.writeText(text);this.copyMessage.set('Instructions copied. Send them to the administrator who still needs to approve.');
    }catch{this.copyMessage.set('Select and copy the instructions below.');}
  }
  async createReview(){if(this.pending()||this.linkMismatch()||!this.owner()||this.review()&&!this.expired())return;
    await this.action('Preparing the exact launch review…',async()=>this.accept(await this.api.review()));}
  async sign(){const shown=this.status();if(this.pending()||this.linkMismatch()||this.consentComplete()||!shown?.review||!shown.enabled||this.expired()||shown.review.approvedSlots.includes(shown.assignedSlot))return;
    const displayed=structuredClone(shown);
    await this.action('Open your administrator wallet and approve this launch consent.',async()=>{
      const prompt=await this.api.consent(displayed.review!);
      const signature=await this.wallet.signGenerationLaunch(prompt.typedData,displayed);
      this.accept(await this.api.approve(displayed.review!,signature));});}
  async prepare(){const r=this.review();if(this.pending()||this.linkMismatch()||!r||!this.owner()||!this.consentComplete()||this.expired()||this.status()?.operation)return;
    await this.action('Saving the exact signed launch…',async()=>this.accept(await this.api.prepare(structuredClone(r))));}
  async submit(recover=false){const s=this.status();if(this.pending()||this.linkMismatch()||!s?.review||!s.operation||!this.owner()||this.expired()||this.uncertain()&&!recover||s.operation.transactionId)return;
    const saved=structuredClone(s);
    await this.action('Submitting the saved launch. Confirmation will update automatically…',async()=>{
      try{this.accept(await this.api.submit(saved.review!,saved.operation!));}
      catch(e){this.uncertain.set(true);throw e;}});}
  async download(){const s=this.status();if(this.pending()||!s?.review?.launchComplete||!this.owner())return;
    const review=structuredClone(s.review);
    await this.action('Loading the verified launch evidence…',async()=>{
      const blob=await this.api.readAnchor(review),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='generation-'+review.generationId.slice(2,14)+'-read-anchor.json';
      link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  }
  private async action(label:string,run:()=>Promise<void>){this.pending.set(label);this.error.set(null);
    try{await run();}catch(e){this.report(e);}finally{this.pending.set(null);await this.refresh.refresh();}}
  private report(error:unknown){const e=error as {status?:number;message?:string;error?:{detail?:{message?:string}}};
    if(e.status===401){this.sessionExpired.emit();return;}
    this.error.set(e.error?.detail?.message||e.message||'Check saved launch progress before retrying.');}
}
