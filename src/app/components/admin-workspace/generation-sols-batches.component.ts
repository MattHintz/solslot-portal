import { CommonModule } from '@angular/common';
import { Component,OnInit,inject,input,signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminStatusRefresh } from '../../services/admin-status-refresh.service';
import { AdminRefreshStatusComponent } from './admin-refresh-status.component';
import { GenerationSolsBatchesService,BatchDesk } from '../../services/generation-sols-batches.service';
import { GenerationOperationStatus,PrimarySolsBatchReview } from '../../services/generation-governance.service';
@Component({selector:'solslot-generation-sols-batches',standalone:true,imports:[CommonModule,FormsModule,AdminRefreshStatusComponent],providers:[AdminStatusRefresh],
  template:`<section class="batch-desk"><p class="eyebrow">Whole offers · Atomic reserve acquisition</p><h2>Sols batch settlement</h2>
    <p>Combine the original signed buyer offers with whole primary SmartDeeds. Payment, actual deed custody, the one 1% fee and Sols delivery must complete together.</p>
    <solslot-admin-refresh-status [state]="refresh" />
    @if(error()){<p class="notice" role="alert">{{error()}}</p>}
    @if(pending()){<p class="notice" role="status"><span class="loader" aria-hidden="true"></span>{{pending()}}. The exact original offers are retained.</p>}
    @if(desk();as d){
      @if(!d.catalog?.ready){<p class="notice">Waiting for confirmed primary inventory, a fresh signed price and open operation scopes. No transaction is prepared by these status checks.</p>}
      @for(match of d.catalog?.suggestedMatches??[];track match.orderIds.join(',')){<p class="notice">A candidate group combines {{match.orderIds.length}} whole offers for {{match.sourceCount}} whole SmartDeeds. Native review still checks each signed minimum.</p><button type="button" (click)="selectMatch(match.orderIds,match.primaryCoinIds)" [disabled]="!!pending() || !!operation() || !current()">Review this suggested group</button>}
      <form (submit)="prepare($event)"><fieldset [disabled]="!!pending() || !!operation() || !current()"><legend>Review an exact matching group</legend>
        <h3>Signed orders</h3>@for(order of d.orders;track order.orderId){<label class="choice"><input type="checkbox" [checked]="orderIds().includes(order.orderId)" (change)="toggleOrder(order.orderId,$any($event.target).checked)" />
          <span><strong>{{order.paymentAmount}} payment base units → minimum {{order.solsAmount}} Sols base units</strong><small>{{order.orderId}}</small><small>Destination: {{order.destinationInnerHash}}</small></span></label>}
        @if(!d.orders.length){<p>No unmatched signed offers.</p>}
        <h3>Whole primary SmartDeeds</h3>@for(item of d.catalog?.inventory??[];track item.inventoryId){<label class="choice"><input type="checkbox" [checked]="primaryIds().includes(item.inventoryId)" (change)="togglePrimary(item.inventoryId,$any($event.target).checked)" />
          <span><strong>{{usd(item.subtotalUsdMinor)}} total, including the 1% route fee</strong><small>Collection: {{item.collectionId}}</small><small>Deed: {{item.deedLauncherId}}</small></span></label>}
        <label class="fee">Maximum network fee (TXCH mojos)<input type="number" name="batchFee" min="0" [max]="maximumFee()" step="1" [(ngModel)]="feeCap" required /></label>
        <label class="fee">Independent delivery validators<select name="batchSigners" [(ngModel)]="signerPair"><option value="0,1">Validators 1 and 2</option><option value="0,2">Validators 1 and 3</option><option value="1,2">Validators 2 and 3</option></select></label>
        <p>{{orderIds().length}} whole orders · {{primaryIds().length}} whole SmartDeeds selected. The minimum Sols amounts and recipient addresses cannot be changed by the matcher.</p>
        <button type="submit" [disabled]="!orderIds().length || !primaryIds().length">Prepare this exact batch for review</button>
      </fieldset></form>
      @if(operation();as op){<div class="review"><h3>Saved settlement · {{op.stage}}</h3><p>The source-scoped authorization includes the primary NFTs, reserve custody and original buyer outputs.</p>
        <dl><dt>Source deeds</dt><dd>{{review()?.primaryCoinIds?.length}}</dd><dt>Buyer orders</dt><dd>{{review()?.orderIds?.length}}</dd><dt>Fee cap</dt><dd>{{op.feeCapMojos}} TXCH mojos</dd><dt>Transaction</dt><dd>{{op.transactionId??'Not submitted'}}</dd><dt>Confirmation</dt><dd>{{op.confirmedHeight?'Block '+op.confirmedHeight:'Pending'}}</dd></dl>
        <p>Signed price window ends {{review()?.expiresAt! * 1000 | date:'medium'}}. Expiry never replaces this transaction automatically.</p>
        @if(op.errorCode){<p class="notice">{{op.errorCode}} · Check the saved transaction before retrying.</p>}
        <details><summary>Exact settlement evidence</summary><p>{{op.intentHash}}</p><p>Primary inputs: {{review()?.primaryCoinIds?.join(', ')}}</p><p>Reserve outputs: {{review()?.backingCoinIds?.join(', ')}}</p></details>
        <button type="button" (click)="submit()" [disabled]="!!pending() || !executionEnabled() || op.stage==='CONFIRMED' || op.stage==='EXPIRED_RECONCILED'">{{op.transactionId?'Reconcile the saved transaction':'Submit this reviewed testnet settlement'}}</button>
        @if(op.stage!=='CONFIRMED' && op.stage!=='EXPIRED_RECONCILED'){<button type="button" (click)="releaseExpired()" [disabled]="!!pending()">Check expiry and return valid offers to matching</button>}
        @if(op.stage==='EXPIRED_RECONCILED'){<p class="notice">The primary node proved this saved transaction cannot execute. Its evidence is preserved. Valid original offers can join a new match.</p><button type="button" (click)="operation.set(null)">Review a new matching group</button>}
      </div>}
      <h3>Saved batches</h3>@for(saved of d.operations;track saved.operationId){<button type="button" class="saved" (click)="open(saved)" [disabled]="!!pending()">{{saved.stage}} · {{saved.operationId}}</button>}
    }
  </section>`,styles:[`:host{display:block}.batch-desk{margin-block:24px;padding:24px;border:1px solid var(--admin-border,#29463b);border-radius:12px;background:var(--admin-card,#0a2117);color:var(--admin-text,#e5f4ec)}h2{font:400 2rem Georgia,serif}p{line-height:1.6}.eyebrow{font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--admin-accent,#85dfb0)}fieldset{border:1px solid var(--admin-border,#29463b);border-radius:8px;padding:20px;min-width:0}.choice{display:flex;gap:12px;align-items:flex-start;padding:14px;border-bottom:1px solid var(--admin-border,#29463b);cursor:pointer}.choice input{margin-top:4px;min-width:20px;min-height:20px}.choice span{min-width:0}.choice small{display:block;overflow-wrap:anywhere;margin-top:6px;color:var(--admin-muted,#a8bcaf)}button{min-height:46px;padding:12px 18px;border:1px solid var(--admin-border,#29463b);border-radius:8px;background:var(--admin-button,#163c2d);color:inherit;font:inherit;cursor:pointer;margin-block:12px}button:disabled{opacity:.55;cursor:default}input:focus-visible,button:focus-visible{outline:2px solid var(--admin-accent,#85dfb0);outline-offset:3px}.fee{display:grid;gap:8px;margin-block:20px}.fee input{padding:12px;background:var(--admin-input,#081b14);border:1px solid var(--admin-border,#29463b);border-radius:8px;color:inherit;max-width:240px}.notice{padding:16px;border-radius:8px;background:var(--admin-input,#081b14)}.saved{display:block;width:100%;overflow-wrap:anywhere;text-align:left}dl{display:grid;grid-template-columns:minmax(90px,1fr) minmax(0,2fr);gap:12px}dd{margin:0;overflow-wrap:anywhere}details{overflow-wrap:anywhere}summary{min-height:44px;cursor:pointer}.loader{display:inline-block;width:16px;height:16px;border:2px solid #29463b;border-top-color:#85dfb0;border-radius:50%;margin-right:10px;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.loader{animation:none}}@media(max-width:600px){.batch-desk{padding:16px}dl{grid-template-columns:1fr}}`]})
export class GenerationSolsBatchesComponent implements OnInit {
  private readonly api=inject(GenerationSolsBatchesService);readonly refresh=inject(AdminStatusRefresh);
  readonly maximumFee=input('0');readonly executionEnabled=input(false);
  readonly desk=signal<BatchDesk|null>(null);readonly operation=signal<GenerationOperationStatus|null>(null);
  readonly orderIds=signal<string[]>([]);readonly primaryIds=signal<string[]>([]);readonly pending=signal('');readonly error=signal('');
  feeCap=0;signerPair='0,1';
  ngOnInit(){this.refresh.start(async()=>{const d=await this.api.desk();this.desk.set(d);const op=this.operation();if(op){const saved=d.operations.find(row=>row.operationId===op.operationId);if(saved)this.operation.set(saved);}},()=>this.pending()||null,()=>!!this.operation()?.transactionId&&this.operation()?.stage!=='CONFIRMED');}
  current(){const c=this.desk()?.catalog;return !!c?.ready&&Date.now()/1000-c.lastCheckedAt<=45&&Date.now()/1000>=c.lastCheckedAt;}
  review(){return this.operation()?.review?.kind==='PRIMARY_SOLS_BATCH'?this.operation()!.review as PrimarySolsBatchReview:null;}
  usd(value:string){const amount=BigInt(value);return '$'+(amount/100n).toLocaleString('en-US')+'.'+(amount%100n).toString().padStart(2,'0');}
  toggleOrder(id:string,on:boolean){this.orderIds.update(ids=>on?Array.from(new Set([...ids,id])).slice(0,32):ids.filter(v=>v!==id));}
  togglePrimary(id:string,on:boolean){this.primaryIds.update(ids=>on?Array.from(new Set([...ids,id])).slice(0,8):ids.filter(v=>v!==id));}
  selectMatch(orders:string[],primaries:string[]){if(this.pending()||this.operation()||!this.current())return;this.orderIds.set([...orders]);this.primaryIds.set([...primaries]);}
  open(op:GenerationOperationStatus){this.operation.set(structuredClone(op));this.error.set('');}
  async prepare(event:Event){event.preventDefault();const d=this.desk(),c=d?.catalog;if(this.pending()||!d||!c||!this.current())return;
    this.pending.set('Checking sources and independent validator approvals');this.error.set('');
    try{if(!Number.isSafeInteger(this.feeCap)||this.feeCap<0||this.feeCap>Number(this.maximumFee()))throw new Error('Review a fee cap within the approved limit.');
      const expiry=Math.min(c.signedPrice.round.validUntil,...d.orders.filter(o=>this.orderIds().includes(o.orderId)&&o.expiresAt!==null).map(o=>o.expiresAt!));
      if(!['0,1','0,2','1,2'].includes(this.signerPair))throw new Error('Choose two distinct delivery validators.');
      this.operation.set(await this.api.prepare(d.generationId,this.orderIds(),{generationId:d.generationId,anchorHash:c.anchorHash,
        primaryCoinIds:this.primaryIds(),signedPrice:c.signedPrice,expiresAt:expiry,signerIndices:this.signerPair.split(',').map(Number),registryCoinId:c.registryCoinId,poolCoinId:c.poolCoinId,statutesCoinId:c.statutesCoinId},this.feeCap));
    }catch(e){this.error.set(e instanceof Error?e.message:'Preparation status is uncertain. Check saved batches before retrying.');}finally{this.pending.set('');void this.refresh.refresh();}}
  async submit(){const op=this.operation();if(!op||this.pending()||!this.executionEnabled()||op.stage==='CONFIRMED'||op.stage==='EXPIRED_RECONCILED')return;
    this.pending.set(op.transactionId?'Reconciling the saved transaction':'Submitting the exact reviewed settlement');this.error.set('');
    try{this.operation.set(await this.api.submit(op));}catch(e){this.error.set(e instanceof Error?e.message:'Submission status is uncertain. Retain this exact receipt.');}finally{this.pending.set('');void this.refresh.refresh();}}
  async releaseExpired(){const op=this.operation();if(!op||this.pending()||['CONFIRMED','EXPIRED_RECONCILED'].includes(op.stage))return;
    this.pending.set('Checking the exact transaction and on-chain expiry');this.error.set('');
    try{this.operation.set(await this.api.releaseExpired(op));}catch(e){this.error.set(e instanceof Error?e.message:'Expiry could not be proven. Original inputs remain reserved.');}finally{this.pending.set('');void this.refresh.refresh();}}
}
