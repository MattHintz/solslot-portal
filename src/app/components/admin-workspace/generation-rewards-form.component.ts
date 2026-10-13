import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy,Component,computed,input,output,signal } from '@angular/core';
import { GenerationChainSnapshot,RewardClaimIntent,RewardEpochIntent,RewardProgressIntent } from '../../services/generation-governance.service';

const hash=(s:string)=>/^0x[0-9a-f]{64}$/.test(s)&&s!=='0x'+'0'.repeat(64);

/** Explicit forms only. Refreshing this component never builds or signs. */
@Component({selector:'solslot-generation-rewards-form',standalone:true,imports:[CommonModule],
  changeDetection:ChangeDetectionStrategy.OnPush,
  template:`@if(authority(); as a){
    <section aria-labelledby="rewards-form-title">
      <h3 id="rewards-form-title">SGT rewards</h3>
      <p>Mature fee coins fund permanent rewards for distributed SGT holders. Reserve and undelivered escrow receive no share.
        Complete holdings belonging to the same owner are combined before rounding. Locked holder SGT remains eligible.</p>
      <p>Reward period: {{a.epochSeconds | number}} seconds. The confirmed holdings snapshot supplies {{snapshot()!.supply.distributed | number}} eligible SGT.
        These actions remain available during a pause; they do not change governance or issue more SGT.</p>
      <form (submit)="close($event)"><fieldset [disabled]="disabled()"><legend>Close a funded reward batch</legend>
        <p>Select exact confirmed fee coin IDs from the reward custody inventory. Each selected coin must have completed its on-chain reward period.
          This bounded batch accepts up to 64 complete coins; the native network check must also admit its cost.</p>
        <label>Fee coin IDs, one per line<textarea rows="4" autocomplete="off" spellcheck="false" [value]="feeText()"
          (input)="feeText.set($any($event.target).value)" aria-describedby="reward-fee-count"></textarea></label>
        <p id="reward-fee-count" role="status">{{fees().length}} complete coins selected. {{validFees()?'Ready to check the exact funding.':'Enter distinct, complete nonzero coin IDs.'}}</p>
        <details><summary>Confirmed authority and snapshot</summary><dl>
          <dt>Sols CAT identity</dt><dd><code>{{a.assetId}}</code></dd><dt>Statutes authority</dt><dd><code>{{a.statutesLauncherId}}</code></dd>
          <dt>Parameter revision</dt><dd>{{a.revision}}</dd><dt>Values commitment</dt><dd><code>{{a.valuesHash}}</code></dd>
          <dt>Holder snapshot</dt><dd><code>{{snapshot()!.supply.holdingsRoot}}</code></dd></dl></details>
        <button type="submit" [disabled]="disabled() || !validFees() || !snapshot()!.supply.distributed">Review funded reward batch</button>
      </fieldset></form>
      <form (submit)="advance($event)"><fieldset [disabled]="disabled()"><legend>Continue a larger reward batch</legend>
        <p>Larger holder snapshots use saved pages. Each page checks at most 16 holdings or owners, preserves the funded balance, and needs no holder signature. Refreshing never sends a page.</p>
        <label>Confirmed continuation coin ID<input type="text" autocomplete="off" spellcheck="false" [value]="progressCoin()" (input)="progressCoin.set($any($event.target).value.trim().toLowerCase())" /></label>
        <button type="submit" [disabled]="disabled() || !validProgress()">Review the next reward page</button>
      </fieldset></form>
      <form (submit)="claim($event)"><fieldset [disabled]="disabled()"><legend>Receive an earned reward</legend>
        <p>Use the exact confirmed entitlement. Payment goes to its unchanged recipient vault. Receiving SGT rewards needs no private ID check,
          wallet signature or new governance vote. Funded claims have no expiry.</p>
        <div class="fields">@for(field of claimFields;track field.key){<label>{{field.label}}
          <input [attr.type]="field.key==='amount'?'number':'text'" [attr.min]="field.key==='amount'?1:null" [attr.step]="field.key==='amount'?1:null"
            autocomplete="off" spellcheck="false" [value]="claimDraft()[field.key]" (input)="setClaim(field.key,$any($event.target).value)" required />
        </label>}</div>
        <button type="submit" [disabled]="disabled() || !validClaim()">Review payment to this vault</button>
      </fieldset></form>
    </section>}`,
  styles:[`fieldset{border:1px solid var(--admin-border,#29463b);border-radius:.75rem;padding:1rem;margin-block:1rem;min-width:0}
    label{display:grid;gap:.5rem;min-width:0}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
    input,textarea{box-sizing:border-box;width:100%;min-width:0;padding:.75rem;border:1px solid var(--admin-border,#29463b);border-radius:.5rem;
      background:var(--admin-input,#081b14);color:var(--admin-text,#e5f4ec);font:inherit}textarea{resize:vertical}
    button{min-height:44px;margin-block:.75rem;padding:.65rem 1rem;color:var(--admin-text,#e5f4ec);background:var(--admin-button,#163c2d);
      border:1px solid var(--admin-border,#29463b);border-radius:.5rem;cursor:pointer}button:disabled{opacity:.55;cursor:default}
    input:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--admin-accent,#85dfb0);outline-offset:3px}
    p{line-height:1.6}code{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:minmax(8rem,1fr) minmax(0,2fr);gap:.5rem}dd{margin:0}
    @media(max-width:700px){.fields,dl{grid-template-columns:1fr}}`],
})
export class GenerationRewardsFormComponent {
  readonly snapshot=input<GenerationChainSnapshot|null>(null);
  readonly disabled=input(false);
  readonly epochReviewed=output<RewardEpochIntent>();
  readonly claimReviewed=output<RewardClaimIntent>();
  readonly progressReviewed=output<RewardProgressIntent>();
  readonly progressCoin=signal('');
  readonly validProgress=computed(()=>hash(this.progressCoin()));
  readonly authority=computed(()=>this.snapshot()?.rewardAuthorities?.length===1?this.snapshot()!.rewardAuthorities![0]:null);
  readonly feeText=signal('');
  readonly fees=computed(()=>this.feeText().trim().split(/\s+/).filter(Boolean).map(v=>v.toLowerCase()));
  readonly validFees=computed(()=>this.fees().length>0 && this.fees().length<=64 && this.fees().every(hash) && new Set(this.fees()).size===this.fees().length);
  readonly claimFields:Array<{key:'epochId'|'ownerPuzzleHash'|'amount'|'claimCoinId'|'vaultLauncherId';label:string}>=[
    {key:'claimCoinId',label:'Confirmed earned claim coin ID'},{key:'epochId',label:'Reward batch commitment'},
    {key:'ownerPuzzleHash',label:'Unchanged SGT owner commitment'},{key:'vaultLauncherId',label:'Recipient vault launcher ID'},
    {key:'amount',label:'Exact reward (Sols base units)'}];
  readonly claimDraft=signal({epochId:'',ownerPuzzleHash:'',amount:0,claimCoinId:'',vaultLauncherId:''});
  readonly validClaim=computed(()=>{const v=this.claimDraft();return [v.epochId,v.ownerPuzzleHash,v.claimCoinId,v.vaultLauncherId].every(hash) &&
    Number.isSafeInteger(v.amount) && v.amount>0;});
  setClaim(key:typeof this.claimFields[number]['key'],raw:string):void {
    if(this.disabled())return;this.claimDraft.update(v=>({...v,[key]:key==='amount'?Number(raw):raw.trim().toLowerCase()}));
  }
  close(event:Event):void {
    event.preventDefault();const a=this.authority(),s=this.snapshot();
    if(this.disabled() || !a || !s || !this.validFees() || !s.supply.distributed)return;
    const {epochSeconds,...bindings}=a;
    this.epochReviewed.emit({...bindings,holdingsRoot:s.supply.holdingsRoot,eligibleSupply:s.supply.distributed,
      ledgerSequence:s.supply.sequence,feeCoinIds:[...this.fees()]});
  }
  claim(event:Event):void {
    event.preventDefault();const a=this.authority();if(this.disabled() || !a || !this.validClaim())return;
    this.claimReviewed.emit({assetId:a.assetId,statutesLauncherId:a.statutesLauncherId,...structuredClone(this.claimDraft())});
  }
  advance(event:Event):void {
    event.preventDefault();const a=this.authority();if(this.disabled() || !a || !this.validProgress())return;
    this.progressReviewed.emit({assetId:a.assetId,statutesLauncherId:a.statutesLauncherId,continuationCoinId:this.progressCoin()});
  }
}
