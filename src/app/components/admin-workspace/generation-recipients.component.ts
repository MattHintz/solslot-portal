import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, OnInit, Output, computed, inject, input, signal } from '@angular/core';
import { GenerationRecipientsService, GenerationRecipientReview, RecipientConsentReview } from '../../services/generation-recipients.service';
import { EvmWalletService } from '../../services/evm-wallet.service';
import { AdminStatusRefresh } from '../../services/admin-status-refresh.service';
import { AdminRefreshStatusComponent } from './admin-refresh-status.component';
import { deploymentGeneration } from '../../utils/deployment-generation';
import { GenerationOperationStatus, mergeGenerationReceipt, validateGenerationOperations } from '../../services/generation-governance.service';

@Component({
  selector:'solslot-generation-recipients',standalone:true,
  imports:[CommonModule,AdminRefreshStatusComponent],providers:[AdminStatusRefresh],
  templateUrl:'./generation-recipients.component.html',styleUrl:'./generation-recipients.component.scss',
  changeDetection:ChangeDetectionStrategy.OnPush,
})
export class GenerationRecipientsComponent implements OnInit {
  readonly issuedHeight=input<number|null>(null);
  private readonly api=inject(GenerationRecipientsService);
  readonly wallet=inject(EvmWalletService);
  readonly refresh=inject(AdminStatusRefresh);
  readonly review=signal<GenerationRecipientReview|null>(null);
  readonly pending=signal<'CHECKING'|'SIGNING'|'SAVING'|'PREPARING'|'SUBMITTING'|null>(null);
  readonly error=signal<string|null>(null);
  readonly mine=computed(()=>this.review()?.recipients.find(r=>r.administratorSlot===this.review()?.assignedSlot));
  readonly uncertainCreation=signal<string|null>(null);
  private readonly receipts=new Map<string,GenerationOperationStatus>();
  @Output() readonly sessionExpired=new EventEmitter<void>();

  ngOnInit(): void {
    this.refresh.start(async()=>{
      try{this.accept(await this.api.status());}
      catch(error){if((error as {status?:number}).status===401)this.sessionExpired.emit();throw error;}
    },
      ()=>this.pending()?'Finishing your reviewed launch step. Saved progress will refresh afterward.':null,
      ()=>!this.issuedHeight() && !!this.review() && !this.review()!.recipientPreparationComplete);
  }
  private accept(value: GenerationRecipientReview): void {
    if(value.generationId!==deploymentGeneration() || value.network!=='testnet11' ||
      value.recipients.length!==3 || value.holderSupply!==30000 || value.reserveSupply!==970000 ||
      value.totalSupply!==1000000 || value.initialQuorum!==15000 ||
      ![1,2,3].includes(value.assignedSlot) ||
      value.recipients.some((r,i)=>r.administratorSlot!==i+1 || r.amount!==10000 ||
        ![r.fundingCoinId,r.recipientVault,r.recipientPuzzle,r.identityAuthority].every(v=>/^0x[0-9a-f]{64}$/.test(v))))
      throw new Error('The recipient review does not match this Testnet generation.');
    value=structuredClone(value);
    validateGenerationOperations({generationId:value.generationId,network:'testnet11',available:true,
      operations:value.recipients.flatMap(r=>r.creation?[r.creation]:[]),executionEnabled:value.creationAvailable,
      maximumFeeMojos:value.maximumFeeMojos,pollAfterSeconds:5});
    const previous=this.review();
    if(previous?.preparationManifest===value.preparationManifest && value.recipients.some((r,i)=>{
      const p=previous.recipients[i];return p.recipientVault!==r.recipientVault || p.recipientPuzzle!==r.recipientPuzzle ||
        p.fundingCoinId!==r.fundingCoinId || p.wallet!==r.wallet;
    }))throw new Error('A destination changed without a new frozen preparation.');
    for(const recipient of value.recipients){
      const known=previous?.preparationManifest===value.preparationManifest ? previous.recipients[recipient.administratorSlot-1].creation : null;
      const op=recipient.creation || known;
      if(!op)continue;
      const r=op.review;
      if(r?.kind!=='CREATE_RECIPIENT_VAULT' || r.administratorSlot!==recipient.administratorSlot ||
        r.preparationManifest!==value.preparationManifest || r.recipientVault!==recipient.recipientVault ||
        r.recipientPuzzle!==recipient.recipientPuzzle || r.fundingCoinId!==recipient.fundingCoinId)
          throw new Error('The saved launch does not match this recipient.');
      recipient.creation=mergeGenerationReceipt(this.receipts.get(op.operationId),op);
      this.receipts.set(op.operationId,recipient.creation);
      if(recipient.creation.transactionId && this.uncertainCreation()===op.operationId)this.uncertainCreation.set(null);
    }
    this.review.set(value);this.refresh.updated();
  }
  async prepareCreation():Promise<void> {
    const state=this.review(),recipient=this.mine();
    if(this.issuedHeight() || this.pending() || !state?.creationAvailable || !recipient || recipient.confirmed || recipient.creation)return;
    this.pending.set('PREPARING');this.error.set(null);
    try{this.accept(await this.api.prepareCreation({generationId:state.generationId,preparationManifest:state.preparationManifest,
      administratorSlot:recipient.administratorSlot,fundingCoinId:recipient.fundingCoinId,
      recipientVault:recipient.recipientVault,recipientPuzzle:recipient.recipientPuzzle,feeCapMojos:Number(state.maximumFeeMojos)}));}
    catch(error){this.report(error);}
    finally{this.pending.set(null);await this.refresh.refresh();}
  }
  async submitCreation():Promise<void> {
    const state=this.review(),op=this.mine()?.creation;
    if(this.issuedHeight() || this.pending() || !state?.creationAvailable || !op || op.transactionId || op.stage!=='PREPARED')return;
    const saved=structuredClone(op),manifest=state.preparationManifest;
    this.pending.set('SUBMITTING');this.error.set(null);
    try{this.accept(await this.api.submitCreation(manifest,saved));this.uncertainCreation.set(null);}
    catch(error){this.uncertainCreation.set(saved.operationId);this.report(error);}
    finally{this.pending.set(null);await this.refresh.refresh();}
  }
  async check(): Promise<void> {
    if(this.issuedHeight() || this.pending())return;
    this.pending.set('CHECKING');this.error.set(null);
    try{this.accept(await this.api.check());}
    catch(error){this.report(error);}
    finally{this.pending.set(null);}
  }
  async acknowledge(): Promise<void> {
    if(this.issuedHeight() || this.pending() || !this.review() || !this.mine()?.confirmed || this.mine()?.acknowledgedAt)return;
    // Capture what was displayed BEFORE preparing a request. Background reads
    // or a changed manifest cannot replace the destination while signing.
    const displayed: RecipientConsentReview=structuredClone({generationId:this.review()!.generationId,
      preparationManifest:this.review()!.preparationManifest,recipient:this.mine()!});
    this.pending.set('SIGNING');this.error.set(null);
    try{
      const prepared=await this.api.prepare();
      const signature=await this.wallet.signRecipientAcknowledgement(prepared.typedData,displayed);
      this.pending.set('SAVING');
      this.accept(await this.api.acknowledge(displayed.preparationManifest,signature));
    }catch(error){this.report(error);}
    finally{this.pending.set(null);}
  }
  private report(error: unknown): void {
    const e=error as {status?:number;message?:string;error?:{detail?:{message?:string}}};
    if(e.status===401){this.sessionExpired.emit();return;}
    this.error.set(e.error?.detail?.message || e.message || 'This step could not finish. Your saved progress is retained.');
  }
}
