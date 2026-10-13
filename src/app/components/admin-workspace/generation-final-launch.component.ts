import {CommonModule} from '@angular/common';
import {ChangeDetectionStrategy,Component,EventEmitter,OnInit,Output,computed,inject,signal} from '@angular/core';
import {GenerationFinalLaunchService,FinalLaunchStatus} from '../../services/generation-final-launch.service';
import {EvmWalletService} from '../../services/evm-wallet.service';
import {AdminStatusRefresh} from '../../services/admin-status-refresh.service';
import {AdminRefreshStatusComponent} from './admin-refresh-status.component';
import {validateFinalLaunch,finalLaunchPayload} from '../../utils/generation-final-launch-review';
import {canonicalConsent} from '../../utils/generation-consent-review';
import {mergeGenerationReceipt} from '../../services/generation-governance.service';
@Component({selector:'solslot-generation-final-launch',standalone:true,imports:[CommonModule,AdminRefreshStatusComponent],
  providers:[AdminStatusRefresh],templateUrl:'./generation-final-launch.component.html',styleUrl:'./generation-final-launch.component.scss',
  changeDetection:ChangeDetectionStrategy.OnPush})
export class GenerationFinalLaunchComponent implements OnInit {
  private readonly api=inject(GenerationFinalLaunchService);private readonly wallet=inject(EvmWalletService);
  readonly refresh=inject(AdminStatusRefresh);readonly status=signal<FinalLaunchStatus|null>(null);
  readonly pending=signal<string|null>(null);readonly error=signal<string|null>(null);readonly unavailable=signal(false);
  readonly uncertain=signal(false);readonly review=computed(()=>this.status()?.review);
  readonly mine=computed(()=>this.review()?.recipients.find(r=>r.administratorSlot===this.status()?.assignedSlot));
  readonly owner=computed(()=>this.status()?.assignedSlot===1);
  readonly consentComplete=computed(()=>this.review()?.approvedSlots.includes(1) && this.review()?.approvedSlots.some(n=>n===2||n===3));
  readonly expired=computed(()=>{this.refresh.now();return !!this.review() && this.refresh.now()/1000>=Math.min(this.review()!.expiresAt,this.review()!.releaseExpiresAt);});
  @Output() readonly sessionExpired=new EventEmitter<void>();
  ngOnInit(){this.refresh.start(async()=>{
    try{this.accept(await this.api.status());this.unavailable.set(false);}
    catch(e){if((e as {status?:number}).status===503 && (e as any).error?.detail?.code==='GENERATION_FINAL_RELEASE_NOT_READY'){
      this.unavailable.set(true);return;}this.report(e);throw e;}
  },()=>this.pending()?'Finish the displayed wallet or launch step; saved status will refresh afterward.':null,
    ()=>!!this.review() && !this.review()!.launchComplete && !this.expired());}
  private accept(value:FinalLaunchStatus){
    const next=validateFinalLaunch(value),old=this.status();
    if(old?.review && next.review?.reviewId===old.review.reviewId &&
      canonicalConsent(finalLaunchPayload(next.review))!==canonicalConsent(finalLaunchPayload(old.review)))
        throw new Error('The signed launch review changed. Reconcile its original receipt.');
    if(old?.operation && next.operation)next.operation=mergeGenerationReceipt(old.operation,next.operation);
    if(old?.operation && !next.operation)next.operation=old.operation;
    if(old?.review && !next.review)next.review=old.review;
    if(old?.review && next.review?.reviewId===old.review.reviewId)
      next.review.approvedSlots=[...new Set([...old.review.approvedSlots,...next.review.approvedSlots])].sort();
    validateFinalLaunch(next);
    if(next.operation?.transactionId)this.uncertain.set(false);
    this.status.set(next);this.refresh.updated();
  }
  async createReview(){if(this.pending()||!this.owner()||this.review()&&!this.expired())return;
    await this.action('Preparing the exact launch review…',async()=>this.accept(await this.api.review()));}
  async sign(){const shown=this.status();if(this.pending()||!shown?.review||!shown.enabled||this.expired()||shown.review.approvedSlots.includes(shown.assignedSlot))return;
    const displayed=structuredClone(shown);
    await this.action('Open your administrator wallet and approve this launch consent.',async()=>{
      const prompt=await this.api.consent(displayed.review!);
      const signature=await this.wallet.signGenerationLaunch(prompt.typedData,displayed);
      this.accept(await this.api.approve(displayed.review!,signature));});}
  async prepare(){const r=this.review();if(this.pending()||!r||!this.owner()||!this.consentComplete()||this.expired()||this.status()?.operation)return;
    await this.action('Saving the exact signed launch…',async()=>this.accept(await this.api.prepare(structuredClone(r))));}
  async submit(recover=false){const s=this.status();if(this.pending()||!s?.review||!s.operation||!this.owner()||this.expired()||this.uncertain()&&!recover||s.operation.transactionId)return;
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
