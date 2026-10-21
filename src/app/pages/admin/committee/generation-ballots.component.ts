import { CommonModule,DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy,Component,computed,effect,inject,input,OnInit,output,signal,untracked } from '@angular/core';
import { GenerationBallotService,GenerationBallotReview,HolderBallotRequest,HolderCatalog,HolderRow,GenerationBallotSigningError } from '../../../services/generation-ballot.service';
import { GenerationConsentReview } from '../../../services/generation-consent.service';
import { GenerationChainSnapshot,GenerationOperationStatus } from '../../../services/generation-governance.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import { AdminStatusRefresh } from '../../../services/admin-status-refresh.service';
import { AdminRefreshStatusComponent } from '../../../components/admin-workspace/admin-refresh-status.component';
import { canonicalConsent } from '../../../utils/generation-consent-review';
import { deploymentGeneration } from '../../../utils/deployment-generation';
import { GenerationAssetIntentComponent } from '../../../components/admin-workspace/generation-asset-intent.component';
import { governedBillLabel } from '../../../utils/generation-governed-bill';

@Component({selector:'solslot-generation-ballots',standalone:true,imports:[CommonModule,AdminRefreshStatusComponent,GenerationAssetIntentComponent],providers:[AdminStatusRefresh],
  templateUrl:'./generation-ballots.component.html',styleUrl:'./generation-ballots.component.scss',changeDetection:ChangeDetectionStrategy.OnPush})
export class GenerationBallotsComponent implements OnInit {
  readonly proposalLabel=governedBillLabel;
  private readonly api=inject(GenerationBallotService);
  private readonly document=inject(DOCUMENT);
  readonly session=inject(AdminSessionService);
  private readonly chia=inject(ChiaWalletService);
  readonly refresh=inject(AdminStatusRefresh);
  readonly snapshot=input<GenerationChainSnapshot|null>(null);
  readonly consent=input<GenerationConsentReview|null>(null);
  readonly isCurrent=input(false);
  readonly available=input(false);
  readonly maximumFee=input('0');
  readonly operations=input<GenerationOperationStatus[]>([]);
  readonly prepared=output<GenerationOperationStatus>();
  readonly catalog=signal<HolderCatalog|null>(null);
  readonly reviews=signal<GenerationBallotReview[]>([]);
  readonly selected=signal<GenerationBallotReview|null>(null);
  readonly coinIds=signal<string[]>([]);
  readonly selectionLimit=32;
  readonly busy=signal<'PREPARING'|'SIGNING'|'ASSEMBLING'|null>(null);
  readonly signingWallet=signal('browser wallet');
  readonly error=signal<string|null>(null);
  readonly scopes=[{mask:1,label:'New proposals'},{mask:2,label:'New mints'},{mask:4,label:'New offers'},
    {mask:8,label:'New unfunded obligations'},{mask:16,label:'Pending upgrade activation'}];
  readonly pending=signal<HolderBallotRequest|null>(this.restore());
  readonly assignedActions=computed(()=>this.reviews().flatMap(review=>review.holders
    .filter(row=>this.assigned(row) && !this.signed(review,row) && !this.expired(review) && !this.confirmedReceipt(review)).map(row=>({review,row}))));
  readonly selectedWeight=computed(()=>this.catalog()?.holdings.filter(h=>this.coinIds().includes(h.coinId)).reduce((s,h)=>s+h.amount,0)??0);
  readonly quorum=computed(()=>Math.ceil((this.catalog()?.eligibleSupply??0)/2));
  readonly canSelect=computed(()=>this.available() && this.isCurrent() && !this.busy() && !!this.catalog() &&
    this.refresh.now()-this.catalog()!.checkedAt*1000<=90_000);
  readonly canPrepare=computed(()=>this.canSelect() && !this.pending() && !!this.coinIds().length &&
    this.coinIds().length<=this.selectionLimit && new Set(this.coinIds()).size===this.coinIds().length &&
    this.coinIds().every(id=>this.catalog()!.holdings.some(h=>h.coinId===id)));
  readonly canOpen=computed(()=>this.canPrepare() && this.selectedWeight()>=10000 && !this.snapshot()?.proposal &&
    this.consent()?.stage==='READY' && this.consent()!.expiresAt*1000>this.refresh.now() &&
    this.consent()?.holdingsRoot===this.catalog()?.snapshotRoot);
  readonly canVote=computed(()=>this.canPrepare() && !!this.snapshot()?.proposal?.openedAt &&
    this.catalog()?.proposalId===this.snapshot()?.proposal?.proposalId && !!this.catalog()?.votingClosesAt &&
    this.catalog()!.votingClosesAt!*1000>this.refresh.now());
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
  private storageKey(){return 'solslot_generation_holder_prepare:'+deploymentGeneration();}
  private restore():HolderBallotRequest|null {
    try{const raw=sessionStorage.getItem(this.storageKey());if(!raw || raw.length>16384)return null;
      const r=JSON.parse(raw);return r.generationId===deploymentGeneration() && ['OPEN_PROPOSAL','CAST_VOTE'].includes(r.kind) ? r : null;
    }catch{return null;}
  }
  private savePending(request:HolderBallotRequest|null):void {
    this.pending.set(request);try{if(request)sessionStorage.setItem(this.storageKey(),JSON.stringify(request));else sessionStorage.removeItem(this.storageKey());}catch{/* Server review remains authoritative. */}
  }
  ngOnInit():void {
    this.refresh.start(async()=>{
      if(!this.available() || !this.session.pubkey() || !this.session.jwt())return;
      const readSession={key:this.session.pubkey()!,token:this.session.jwt()!,generation:deploymentGeneration()};
      this.refreshedSession=readSession;
      const assertReadSession=()=>{
        if(!this.available() || readSession.key!==this.session.pubkey() || readSession.token!==this.session.jwt() ||
          readSession.generation!==deploymentGeneration())throw new Error('The review-loading session changed.');
      };
      const results=await Promise.allSettled([this.api.list(),this.api.holdings()]);
      assertReadSession();
      if(results[0].status==='fulfilled'){
        const previous=new Map(this.reviews().map(r=>[r.packageId,r]));
        const reviews=results[0].value.map(r=>this.merge(previous.get(r.packageId),r));this.reviews.set(reviews);
        const selected=this.selected();if(selected){const next=reviews.find(r=>r.packageId===selected.packageId);if(next)this.selected.set(this.merge(selected,next));}
        const pending=this.pending(),saved=pending && reviews.find(r=>r.request.requestKey===pending.requestKey);
        if(saved && !this.busy()){this.remember(saved);this.savePending(null);}
      }else throw results[0].reason;
      if(results[1].status==='fulfilled')this.catalog.set(results[1].value);else throw results[1].reason;
    },()=>!this.available() || !this.session.pubkey() || !this.session.jwt()?'Sign in to load your saved reviews.':this.busy()?'Finishing your explicit holder action. Saved receipts will refresh afterward.':null,
      ()=>!!this.snapshot()?.proposal || this.reviews().some(r=>r.stage==='AWAITING_HOLDER_SIGNATURES' && !this.expired(r)));
    this.refreshStarted.set(true);
  }
  private merge(old:GenerationBallotReview|undefined,next:GenerationBallotReview):GenerationBallotReview {
    if(!old)return structuredClone(next);
    const fixed=(r:GenerationBallotReview)=>{const {stage,signatures,pollAfterSeconds,...rest}=r;return canonicalConsent(rest);};
    if(fixed(old)!==fixed(next))throw new Error('The saved holder review changed. Keep the original action.');
    const signatures=[...old.signatures];for(const s of next.signatures){const previous=signatures.find(v=>v.coinId===s.coinId);
      if(previous && previous.signedAt!==s.signedAt)throw new Error('The original holder signature receipt changed.');if(!previous)signatures.push(s);}
    return {...next,signatures,stage:old.stage==='EXPIRED' || next.stage==='EXPIRED'?'EXPIRED':signatures.length===next.holders.length?'READY':'AWAITING_HOLDER_SIGNATURES'};
  }
  private remember(review:GenerationBallotReview):void {
    const next=this.merge(this.reviews().find(r=>r.packageId===review.packageId),review);
    this.reviews.update(rows=>[next,...rows.filter(r=>r.packageId!==next.packageId)].slice(0,50));this.selected.set(next);
  }
  expired(r:GenerationBallotReview):boolean {return r.stage==='EXPIRED' || this.refresh.now()>=r.expiresAt*1000;}
  confirmedReceipt(r:GenerationBallotReview):GenerationOperationStatus|undefined {
    return this.operations().find(op=>{
      const saved=op.review;
      return !!saved && (saved.kind==='OPEN_PROPOSAL' || saved.kind==='CAST_VOTE') &&
        op.stage==='CONFIRMED' && op.kind===r.kind && op.network===r.network &&
        op.generationId===r.generationId && saved.generationId===r.generationId && saved.kind===r.kind &&
        !!op.transactionId && /^0x[0-9a-f]{64}$/.test(op.transactionId) &&
        Number.isSafeInteger(op.confirmedHeight) && op.confirmedHeight!>0 &&
        saved.packageId===r.packageId && saved.requestKey===`ballot:${r.packageId}` && saved.proposalId===r.proposalId &&
        saved.selectedWeight===r.selectedWeight && saved.snapshotRoot===r.snapshotRoot &&
        saved.eligibleSupply===r.eligibleSupply && saved.requiredVotes===r.requiredVotes && saved.votingClosesAt===r.votingClosesAt &&
        Number(op.feeCapMojos)===Number(r.feeCapMojos) && saved.feeCapMojos===Number(r.feeCapMojos) &&
        canonicalConsent(saved.selected)===canonicalConsent(r.request.selected);
    });
  }
  displayHolders(r:GenerationBallotReview):HolderRow[]{
    const priority=(row:HolderRow)=>Number(this.assigned(row) && !this.signed(r,row));
    return [...r.holders].sort((a,b)=>priority(b)-priority(a));
  }
  signed(r:GenerationBallotReview,row:HolderRow):boolean {return r.signatures.some(s=>s.coinId===row.request.sgtCoinId);}
  assigned(row:HolderRow):boolean {return this.session.pubkey()===row.context.owner.publicKey;}
  walletLabel(row:HolderRow):string {return row.context.owner.authType===3?'browser wallet':this.chia.connectionKind()==='goby'?'Goby':'Sage';}
  openReview(event:Event,packageId:string):void {
    if(event instanceof MouseEvent && (event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey))return;
    const review=this.document.getElementById('holder-review-'+packageId);if(!review)return;
    event.preventDefault();review.scrollIntoView({block:'start'});review.focus({preventScroll:true});
  }
  reviewHref(r:GenerationBallotReview):string {
    const location=this.document.location;
    return (location?location.pathname+location.search:'/genesis-admin/next/committee')+'#holder-review-'+r.packageId;
  }
  includesScope(scope:number|undefined,mask:number):boolean {return typeof scope==='number' && !!(scope&mask);}
  canChoose(holding:HolderCatalog['holdings'][number]):boolean {
    if(!this.canSelect())return false;
    if(this.coinIds().includes(holding.coinId))return true;
    return this.coinIds().length<this.selectionLimit &&
      !this.catalog()!.holdings.some(h=>h.vaultLauncherId===holding.vaultLauncherId && this.coinIds().includes(h.coinId));
  }
  choose(id:string,checked:boolean):void {
    const row=this.catalog()?.holdings.find(h=>h.coinId===id);if(!row || !this.canSelect())return;
    if(checked && this.coinIds().includes(id))return;
    if(checked && this.coinIds().length>=this.selectionLimit){
      this.error.set(`Select up to ${this.selectionLimit} holdings for one action.`);return;
    }
    if(checked && this.coinIds().some(c=>this.catalog()!.holdings.find(h=>h.coinId===c)?.vaultLauncherId===row.vaultLauncherId)){
      this.error.set('Select one complete holding per vault for this action. Other eligible holdings can be selected in a later vote while voting is open.');return;
    }
    this.coinIds.update(ids=>checked?[...ids,id]:ids.filter(c=>c!==id));this.error.set(null);
  }
  async create(kind:'OPEN_PROPOSAL'|'CAST_VOTE'):Promise<void> {
    const c=this.catalog(),consent=this.consent();if(!c || (kind==='OPEN_PROPOSAL'?!this.canOpen():!this.canVote()))return;
    const req:HolderBallotRequest={generationId:c.generationId,requestKey:crypto.randomUUID(),kind,
      proposalId:kind==='OPEN_PROPOSAL'?consent!.proposalId!:c.proposalId!,consentPackageId:kind==='OPEN_PROPOSAL'?consent!.packageId:null,
      expectedInputs:structuredClone(c.expectedInputs),feeCapMojos:kind==='OPEN_PROPOSAL'?Math.min(Number(this.maximumFee()),Number(consent!.feeCapMojos)):Number(this.maximumFee()),
      selected:this.coinIds().map(id=>{const h=c.holdings.find(v=>v.coinId===id)!;return {coinId:id,vaultLauncherId:h.vaultLauncherId};})};
    this.selected.set(null);this.savePending(req);await this.retry();
  }
  async retry():Promise<void> {
    const req=this.pending();if(!req || this.busy())return;
    this.busy.set('PREPARING');this.error.set(null);
    try{this.remember(await this.api.prepare(structuredClone(req),req.kind==='OPEN_PROPOSAL'?this.consent()??undefined:undefined));this.savePending(null);}
    catch{this.error.set('We couldn’t complete preparation. Recover this same review before starting another. Your signatures and prior transactions are retained.');}
    finally{this.busy.set(null);await this.refresh.refresh();}
  }
  async sign(r:GenerationBallotReview,row:HolderRow):Promise<void> {
    if(this.busy() || this.expired(r) || this.signed(r,row) || !this.assigned(row) || !this.available() || !this.isCurrent())return;
    this.selected.set(r);this.signingWallet.set(this.walletLabel(row));this.busy.set('SIGNING');this.error.set(null);
    try{this.remember(await this.api.sign(r,row.request.sgtCoinId));}
    catch(error){this.error.set(error instanceof GenerationBallotSigningError ? error.message :
      'The signature was not completed. Check the pending wallet request, then refresh this saved review. A lost response does not erase a recorded signature.');}
    finally{this.busy.set(null);await this.refresh.refresh();}
  }
  async assemble(r:GenerationBallotReview):Promise<void> {
    if(this.busy() || this.expired(r) || r.stage!=='READY')return;
    this.busy.set('ASSEMBLING');this.error.set(null);
    try{this.prepared.emit(await this.api.assemble(r));}
    catch{this.error.set('The exact transaction could not be prepared. Keep this review and check saved transactions before retrying.');}
    finally{this.busy.set(null);await this.refresh.refresh();}
  }
}
