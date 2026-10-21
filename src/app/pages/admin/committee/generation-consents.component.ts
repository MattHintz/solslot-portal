import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy,Component,computed,effect,inject,input,OnInit,output,signal,untracked } from '@angular/core';
import { GenerationConsentService,GenerationConsentRequest,GenerationConsentReview,GenerationConsentSigningError } from '../../../services/generation-consent.service';
import { GenerationChainSnapshot,GenerationOperationStatus } from '../../../services/generation-governance.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { AdminStatusRefresh } from '../../../services/admin-status-refresh.service';
import { AdminRefreshStatusComponent } from '../../../components/admin-workspace/admin-refresh-status.component';
import { REHEARSAL_SUCCESSOR } from '../../../utils/generation-consent-review';
import { GenerationMintReview,validateMintReview } from '../../../utils/generation-mint-review';
import { GenerationAssetIntentComponent } from '../../../components/admin-workspace/generation-asset-intent.component';
import { deploymentGeneration } from '../../../utils/deployment-generation';
import { governedBillLabel,RedemptionIntent,redemptionReviewBill } from '../../../utils/generation-governed-bill';
import { GenerationRedemptionFormComponent } from '../../../components/admin-workspace/generation-redemption-form.component';

@Component({selector:'solslot-generation-consents',standalone:true,imports:[CommonModule,AdminRefreshStatusComponent,GenerationAssetIntentComponent,GenerationRedemptionFormComponent],
  providers:[AdminStatusRefresh],templateUrl:'./generation-consents.component.html',styleUrl:'./generation-consents.component.scss',
  changeDetection:ChangeDetectionStrategy.OnPush})
export class GenerationConsentsComponent implements OnInit {
  readonly proposalLabel=governedBillLabel;
  private readonly api=inject(GenerationConsentService);
  readonly session=inject(AdminSessionService);
  readonly refresh=inject(AdminStatusRefresh);
  readonly snapshot=input<GenerationChainSnapshot|null>(null);
  readonly isCurrent=input(false);
  readonly available=input(false);
  readonly maximumFee=input('0');
  readonly mintSource=input<GenerationMintReview|null>(null);
  readonly showGeneralActions=input(true);
  readonly preparedPause=output<GenerationOperationStatus>();
  readonly sponsorReview=output<GenerationConsentReview>();
  readonly reviews=signal<GenerationConsentReview[]>([]);
  readonly selected=signal<GenerationConsentReview|null>(null);
  readonly busy=signal<'PREPARING'|'SIGNING'|'SAVING_PAUSE'|null>(null);
  readonly error=signal<string|null>(null);
  readonly request=signal<GenerationConsentRequest|null>(null);
  readonly sourceManifest=signal('');
  readonly coadministrator=signal(1);
  readonly pauseScope=signal(16);
  readonly reopenScope=signal(0);
  readonly scopes=[{mask:1,label:'New proposals'},{mask:2,label:'New mints'},{mask:4,label:'New offers'},
    {mask:8,label:'New unfunded obligations'},{mask:16,label:'Pending upgrade activation'}];
  readonly canPrepare=computed(()=>this.isCurrent() && this.available() && !this.busy());
  readonly canFundRedemption=computed(()=>this.canPrepare() && !!this.snapshot() && !this.snapshot()?.proposal &&
    !((this.snapshot()?.pauseMask??0)&9) && !(this.request() && !this.selected()));
  readonly canUpgrade=computed(()=>this.canPrepare() && !this.snapshot()?.proposal && !this.snapshot()?.pendingUpgrade &&
    this.snapshot()?.stateProof.version===1 && !(this.snapshot()!.pauseMask&1) && /^0x[0-9a-f]{64}$/.test(this.sourceManifest()) && !/^0x0+$/.test(this.sourceManifest()));
  readonly canReopen=computed(()=>!!this.snapshot() && this.canPrepare() && !this.snapshot()?.proposal && !!this.reopenScope() &&
    (this.reopenScope() & ~this.snapshot()!.pauseMask)===0 && !this.snapshot()?.delays.some(d=>d.kind==='EMERGENCY_REOPENING'));
  readonly canMint=computed(()=>{
    const s=this.snapshot(),m=this.mintSource();
    return this.canPrepare() && !!m && !!s && !s.proposal && !s.pendingUpgrade && !(s.pauseMask&3) &&
      !s.approvedActions?.some(a=>a.kind==='MINT_TEST_ONLY' && a.billHash===m.billHash) &&
      !this.reviews().some(r=>r.request.mintReviewId===m.packageId && !this.expired(r) &&
        ['registry','governance','holdings'].every(k=>r.expectedInputs[k as 'registry']===s.chainEvidence[k].coinId)) &&
      s.componentEvidence[m.mintAuthority.componentId]?.coinId===m.mintAuthority.coinId &&
      s.components.some(v=>v.componentId===m.mintAuthority.componentId && v.launcherId===m.mintAuthority.launcherId &&
        v.moduleHash===m.mintAuthority.moduleHash && v.version===m.mintAuthority.version);
  });
  private readonly refreshStarted=signal(false);
  private refreshedSession:{key:string;token:string}|null=null;
  private readonly readyRefresh=effect(()=>{
    const key=this.available()?this.session.pubkey():null,token=key?this.session.jwt():null;
    if(!this.refreshStarted())return;
    if(!key || !token){this.refreshedSession=null;return;}
    if(this.refreshedSession?.key===key && this.refreshedSession.token===token || this.busy() || this.refresh.refreshing())return;
    // Access often becomes ready after this child mounts. Load saved requests
    // immediately, without waiting for the next poll or opening any wallet.
    untracked(()=>{void this.refresh.refresh();});
  });
  private storageKey():string {return 'solslot_generation_consent_prepare:'+deploymentGeneration()+':'+
    (this.showGeneralActions()?'committee':this.mintSource()?.packageId);}
  private restorePending():GenerationConsentRequest|null {
    try{
      const raw=sessionStorage.getItem(this.storageKey());if(!raw || raw.length>65536)return null;
      const r=JSON.parse(raw);
      if(r.generationId!==deploymentGeneration() || !/^[A-Za-z0-9_:-]{1,128}$/.test(r.requestKey) ||
        !['PUBLICATION_APPROVAL','PAUSE_NEW_OPERATIONS'].includes(r.kind) || ![1,2].includes(r.coadministratorSlot) ||
        !Number.isSafeInteger(r.feeCapMojos) || r.feeCapMojos<0 || r.feeCapMojos>1_000_000_000 ||
        (!this.showGeneralActions() && (r.proposalKind!=='MINT_TEST_ONLY' || r.mintReviewId!==this.mintSource()?.packageId)))return null;
      return r;
    }catch{return null;}
  }
  private saveRequest(request:GenerationConsentRequest|null):void {
    this.request.set(request);
    // Public preparation identity only. Signatures and authority stay in the
    // server journal; losing browser storage cannot erase recorded consent.
    try{if(request)sessionStorage.setItem(this.storageKey(),JSON.stringify(request));else sessionStorage.removeItem(this.storageKey());}catch{}
  }
  ngOnInit():void {
    this.request.set(this.restorePending());
    this.refresh.start(async()=>{
      if(!this.available() || !this.session.pubkey() || !this.session.jwt())return;
      const readSession={key:this.session.pubkey()!,token:this.session.jwt()!,generation:deploymentGeneration()};
      this.refreshedSession=readSession;
      const assertReadSession=()=>{
        if(!this.available() || readSession.key!==this.session.pubkey() || readSession.token!==this.session.jwt() ||
          readSession.generation!==deploymentGeneration())throw new Error('The review-loading session changed.');
      };
      const incoming=(await this.api.list()).filter(r=>this.showGeneralActions() || r.request.mintReviewId===this.mintSource()?.packageId);
      assertReadSession();
      // A delayed read may not hide an already-recorded signature. Keep the
      // original immutable package and merge only its saved role receipts.
      const old=new Map(this.reviews().map(r=>[r.packageId,r]));
      const merged=incoming.map(r=>this.merge(old.get(r.packageId),r));
      this.reviews.set(merged);
      const selected=this.selected();if(selected){const found=merged.find(r=>r.packageId===selected.packageId);if(found)this.selected.set(this.merge(selected,found));}
      const pending=this.request(),saved=pending && merged.find(r=>r.requestKey===pending.requestKey);
      if(saved && !this.busy())this.remember(saved);
    },()=>!this.available() || !this.session.pubkey() || !this.session.jwt()?'Sign in to load your saved reviews.':this.busy()?'Finishing your explicit wallet action. Saved approvals will refresh afterward.':null,
      ()=>this.reviews().some(r=>r.stage==='AWAITING_APPROVALS' && !this.expired(r)));
    this.refreshStarted.set(true);
  }
  private merge(old:GenerationConsentReview|undefined,next:GenerationConsentReview):GenerationConsentReview {
    if(!old)return structuredClone(next);
    const immutable=(r:GenerationConsentReview)=>{const {stage,signatures,pollAfterSeconds,...v}=r;return JSON.stringify(v);};
    if(immutable(old)!==immutable(next))throw new Error('A saved approval changed. Keep the original review.');
    const signatures=[...old.signatures];
    for(const row of next.signatures){
      const prior=signatures.find(s=>s.slot===row.slot);
      if(prior && prior.signedAt!==row.signedAt)throw new Error('An approval receipt changed.');
      if(!prior)signatures.push(row);
    }
    signatures.sort((a,b)=>a.slot-b.slot);
    return {...next,signatures,stage:next.stage==='EXPIRED' || old.stage==='EXPIRED'?'EXPIRED':signatures.length===2?'READY':'AWAITING_APPROVALS'};
  }
  private remember(review:GenerationConsentReview):void {
    const prior=this.reviews().find(r=>r.packageId===review.packageId);const next=this.merge(prior,review);
    this.reviews.update(rows=>[next,...rows.filter(r=>r.packageId!==next.packageId)].slice(0,50));this.selected.set(next);
    if(this.request()?.requestKey===next.requestKey)this.saveRequest(null);
  }
  expired(review:GenerationConsentReview):boolean {return review.stage==='EXPIRED' || this.refresh.now()>=review.expiresAt*1000;}
  approved(review:GenerationConsentReview,slot:number):boolean {return review.signatures.some(s=>s.slot===slot);}
  assigned(review:GenerationConsentReview,slot:number):boolean {
    return this.session.authoritySlot()===slot && review.challenges.find(c=>c.slot===slot)?.publicKey===this.session.pubkey();
  }
  role(slot:number):string {return slot===0?'Owner administrator':`Coadministrator ${slot+1}`;}
  includesScope(scope:number|null,mask:number):boolean {return !!(scope!==null && (scope&mask));}
  toggleScope(mask:number,checked:boolean):void {if(!this.busy())this.pauseScope.update(v=>checked?v|mask:v&~mask);}
  toggleReopen(mask:number,checked:boolean):void {if(!this.busy() && this.includesScope(this.snapshot()?.pauseMask??0,mask))this.reopenScope.update(v=>checked?v|mask:v&~mask);}
  async createMint():Promise<void> {
    if(!this.canMint() || this.request() && !this.selected())return;
    const m=validateMintReview(this.mintSource()!),s=this.snapshot()!;
    const req:GenerationConsentRequest={generationId:s.generationId,kind:'PUBLICATION_APPROVAL',proposalKind:'MINT_TEST_ONLY',
      mintReviewId:m.packageId,requestKey:crypto.randomUUID(),feeCapMojos:Number(this.maximumFee()),
      coadministratorSlot:this.coadministrator(),expectedInputs:{registry:s.chainEvidence['registry'].coinId,
        governance:s.chainEvidence['governance'].coinId,holdings:s.chainEvidence['holdings'].coinId,
        components:{[m.mintAuthority.componentId]:m.mintAuthority.coinId}}};
    this.selected.set(null);this.saveRequest(structuredClone(req));await this.prepareSameReview();
  }
  async createRedemption(intent:RedemptionIntent):Promise<void> {
    if(!this.canFundRedemption())return;
    redemptionReviewBill(intent);
    const s=this.snapshot()!;
    const req:GenerationConsentRequest={generationId:s.generationId,kind:'PUBLICATION_APPROVAL',proposalKind:'FUND_REDEMPTION',
      requestKey:crypto.randomUUID(),feeCapMojos:Number(this.maximumFee()),coadministratorSlot:this.coadministrator(),
      expectedInputs:{registry:s.chainEvidence['registry'].coinId,governance:s.chainEvidence['governance'].coinId,
        holdings:s.chainEvidence['holdings'].coinId},redemption:structuredClone(intent)};
    this.selected.set(null);this.saveRequest(structuredClone(req));await this.prepareSameReview();
  }
  async create(kind:'PUBLICATION_APPROVAL'|'PAUSE_NEW_OPERATIONS',proposalKind:'UPGRADE'|'REOPEN'='UPGRADE'):Promise<void> {
    const s=this.snapshot();if(!s || !this.canPrepare() || (kind==='PUBLICATION_APPROVAL' && (proposalKind==='UPGRADE'?!this.canUpgrade():!this.canReopen())) || (kind==='PAUSE_NEW_OPERATIONS' && !this.pauseScope()))return;
    const req:GenerationConsentRequest={generationId:s.generationId,kind,requestKey:crypto.randomUUID(),
      feeCapMojos:Number(this.maximumFee()),coadministratorSlot:this.coadministrator(),
      expectedInputs:{registry:s.chainEvidence['registry'].coinId,governance:s.chainEvidence['governance'].coinId,holdings:s.chainEvidence['holdings'].coinId}};
    if(kind==='PUBLICATION_APPROVAL' && proposalKind==='REOPEN'){
      req.proposalKind='REOPEN';req.scope=this.reopenScope();
    }else if(kind==='PUBLICATION_APPROVAL'){
      req.proposalKind='UPGRADE';req.upgrade={sourceManifestHash:this.sourceManifest(),changes:[{componentId:s.stateProof.componentId,
        oldModuleHash:s.stateProof.moduleHash,newModuleHash:REHEARSAL_SUCCESSOR,nextVersion:2,
        compatibility:s.components.find(c=>c.componentId===s.stateProof.componentId)!.compatibility,transition:'PRESERVE_STATE'}]};
    }else req.scope=this.pauseScope();
    this.selected.set(null);this.saveRequest(structuredClone(req));await this.prepareSameReview();
  }
  async prepareSameReview():Promise<void> {
    const req=this.request();if(!req || this.busy())return;
    this.busy.set('PREPARING');this.error.set(null);
    try{this.remember(await this.api.prepare(structuredClone(req)));}
    catch{this.error.set('We couldn’t finish preparing the review. Retry this same action to recover it. If the inputs changed, refresh the chain and prepare a new review.');}
    finally{this.busy.set(null);await this.refresh.refresh();}
  }
  async sign(review:GenerationConsentReview):Promise<void> {
    if(this.busy() || this.expired(review) || !this.available() || !this.isCurrent())return;
    this.selected.set(structuredClone(review));this.busy.set('SIGNING');this.error.set(null);
    try{this.remember(await this.api.sign(structuredClone(review)));}
    catch(error){this.error.set(error instanceof GenerationConsentSigningError ? error.message :
      'Approval was not completed. Check your wallet, then refresh the saved review before trying again. A lost response does not erase a recorded approval.');}
    finally{this.busy.set(null);await this.refresh.refresh();}
  }
  async reviewPause(review:GenerationConsentReview):Promise<void> {
    if(this.busy() || review.kind!=='PAUSE_NEW_OPERATIONS' || review.stage!=='READY' || this.expired(review))return;
    this.busy.set('SAVING_PAUSE');this.error.set(null);
    try{this.preparedPause.emit(await this.api.preparePause(structuredClone(review)));}
    catch{this.error.set('The exact pause could not be prepared. Its signatures remain saved. Refresh the original review before retrying.');}
    finally{this.busy.set(null);await this.refresh.refresh();}
  }
}
