import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy,Component,computed,input,output,signal } from '@angular/core';
import { RedemptionIntent,redemptionReviewBill } from '../../utils/generation-governed-bill';

/** Standard preparation form. It never signs, queries, polls or broadcasts. */
@Component({selector:'solslot-generation-redemption-form',standalone:true,imports:[CommonModule],
  changeDetection:ChangeDetectionStrategy.OnPush,
  template:`
    <form (submit)="submit($event)" aria-labelledby="redemption-form-title">
      <h3 id="redemption-form-title">Fund permanent redemption claims</h3>
      <p>Enter the confirmed settlement allocation. Preparation checks the actual treasury input and saves a review for two administrators.
        Holders must then approve the allocation. Funding and individual claims follow as separate chain steps.</p>
      <fieldset [disabled]="disabled()"><legend>Exact funding and settlement</legend>
        <div class="fields">@for(field of fields; track field.key){<label>{{field.label}}
          <input [attr.type]="field.key==='totalPaymentAmount'?'number':'text'" [attr.min]="field.key==='totalPaymentAmount'?1:null"
            [attr.step]="field.key==='totalPaymentAmount'?1:null" autocomplete="off" spellcheck="false"
            [value]="draft()[field.key]" (input)="setField(field.key,$any($event.target).value)" required />
        </label>}</div>
      </fieldset>
      <fieldset [disabled]="disabled()"><legend>Deed allocations</legend>
        <p>Payment amounts use the named CAT’s base units. This form does not infer a dollar amount or ticker from its asset identity.
          Shares must total 1,000,000 ppm (100%); payments must equal the full funded amount.</p>
        @for(row of draft().allocations; track $index; let i=$index){<div class="allocation">
          <h4>Claim {{i+1}}</h4><div class="fields">
            <label>SmartDeed launcher ID<input type="text" autocomplete="off" spellcheck="false" [value]="row.deedLauncherId"
              (input)="setRow(i,'deedLauncherId',$any($event.target).value)" required /></label>
            <label>Deed commitment<input type="text" autocomplete="off" spellcheck="false" [value]="row.deedCommitment"
              (input)="setRow(i,'deedCommitment',$any($event.target).value)" required /></label>
            <label>Share (ppm)<input type="number" min="1" max="1000000" step="1" [value]="row.sharePpm"
              (input)="setRow(i,'sharePpm',$any($event.target).value)" required /></label>
            <label>Payment (base units)<input type="number" min="1" step="1" [value]="row.paymentAmount"
              (input)="setRow(i,'paymentAmount',$any($event.target).value)" required /></label>
          </div><button type="button" [disabled]="draft().allocations.length===1" (click)="remove(i)">Remove claim {{i+1}}</button>
        </div>}
        <button type="button" [disabled]="draft().allocations.length>=100" (click)="add()">Add deed claim</button>
      </fieldset>
      <p role="status">{{valid()?'Allocation reconciles. Review the full commitments before signing.':'Complete the funding commitments and reconcile all shares and payment units.'}}</p>
      <p>Confirmed funding creates permanent claims with no withdrawal or expiry. Already funded claims stay available during a protocol pause.</p>
      <button type="submit" [disabled]="disabled() || !valid()">Prepare redemption publication review</button>
    </form>`,
  styles:[`form{margin-block:1.5rem}fieldset{border:1px solid var(--admin-border,#29463b);border-radius:.75rem;padding:1rem;margin-block:1rem;min-width:0}
    legend,h4{font-weight:700}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}label{display:grid;gap:.5rem;min-width:0}
    input{box-sizing:border-box;width:100%;min-width:0;padding:.75rem;border:1px solid var(--admin-border,#29463b);border-radius:.5rem;
      background:var(--admin-input,#081b14);color:var(--admin-text,#e5f4ec);font:inherit}
    .allocation{border-block-end:1px solid var(--admin-border,#29463b);padding-block:1rem}button{min-height:44px;margin-block:.75rem;padding:.65rem 1rem;
      color:var(--admin-text,#e5f4ec);background:var(--admin-button,#163c2d);border:1px solid var(--admin-border,#29463b);border-radius:.5rem;cursor:pointer}
    button:disabled{opacity:.55;cursor:default}input:focus-visible,button:focus-visible{outline:2px solid var(--admin-accent,#85dfb0);outline-offset:3px}
    p{line-height:1.6}@media(max-width:700px){.fields{grid-template-columns:1fr}}`],
})
export class GenerationRedemptionFormComponent {
  readonly disabled=input(false);
  readonly prepared=output<RedemptionIntent>();
  readonly fields:Array<{key:Exclude<keyof RedemptionIntent,'allocations'>;label:string}>=[
    {key:'treasuryCoinId',label:'Confirmed treasury coin ID'},{key:'treasuryParentId',label:'Treasury parent coin ID'},
    {key:'collectionId',label:'Collection commitment'},{key:'settlementId',label:'Settlement commitment'},
    {key:'paymentAssetId',label:'Payment CAT identity'},{key:'deedLauncherPuzzleHash',label:'Governed deed launcher puzzle hash'},
    {key:'totalPaymentAmount',label:'Total funded payment (base units)'}];
  readonly draft=signal<RedemptionIntent>({treasuryCoinId:'',treasuryParentId:'',collectionId:'',settlementId:'',paymentAssetId:'',
    deedLauncherPuzzleHash:'',totalPaymentAmount:0,allocations:[this.emptyRow()]});
  private emptyRow(){return {deedLauncherId:'',deedCommitment:'',sharePpm:0,paymentAmount:0};}
  private intent():RedemptionIntent {
    const value=structuredClone(this.draft());
    value.allocations.sort((a,b)=>a.deedLauncherId<b.deedLauncherId?-1:1);
    return value;
  }
  readonly valid=computed(()=>{try{redemptionReviewBill(this.intent());return true;}catch{return false;}});
  setField(key:Exclude<keyof RedemptionIntent,'allocations'>,raw:string):void {
    if(this.disabled())return;
    this.draft.update(v=>({...v,[key]:key==='totalPaymentAmount'?Number(raw):raw.trim().toLowerCase()}));
  }
  setRow(index:number,key:keyof RedemptionIntent['allocations'][number],raw:string):void {
    if(this.disabled())return;
    this.draft.update(v=>({...v,allocations:v.allocations.map((row,i)=>i===index?
      {...row,[key]:key==='sharePpm' || key==='paymentAmount'?Number(raw):raw.trim().toLowerCase()}:row)}));
  }
  add():void {if(!this.disabled() && this.draft().allocations.length<100)this.draft.update(v=>({...v,allocations:[...v.allocations,this.emptyRow()]}));}
  remove(index:number):void {if(!this.disabled() && this.draft().allocations.length>1)this.draft.update(v=>({...v,allocations:v.allocations.filter((_,i)=>i!==index)}));}
  submit(event:Event):void {event.preventDefault();if(!this.disabled() && this.valid())this.prepared.emit(this.intent());}
}
