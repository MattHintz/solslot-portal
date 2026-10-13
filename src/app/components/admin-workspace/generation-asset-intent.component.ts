import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy,Component,input,computed } from '@angular/core';
import { GovernedBill } from '../../utils/generation-governed-bill';

/** Shared read-only presentation after the service verifies the bill hash. */
@Component({selector:'solslot-generation-asset-intent',standalone:true,imports:[CommonModule],
  changeDetection:ChangeDetectionStrategy.OnPush,
  template:`
    @if(bill().testMint; as m){
      <section class="asset-intent" aria-label="Exact test mint">
        <p class="badge">TEST ONLY · Chia Testnet11</p>
        <h4>{{m.deedCount | number}} unique test SmartDeeds</h4>
        <p>This vote covers the sealed test edition below. It grants no real investment or property rights. Minting and confirmation are separate steps.</p>
        <dl><dt>Collection commitment</dt><dd><code>{{m.collectionId}}</code></dd>
          <dt>Sealed edition commitment</dt><dd><code>{{m.editionHash}}</code></dd></dl>
        <p class="muted">Changing the edition requires a new review and vote. This test edition cannot be promoted into a production mint.</p>
      </section>
    }
    @if(bill().statutes; as s){
      <section class="asset-intent" aria-label="Exact governed economic fact">
        <h4>{{s.recordKind | titlecase}} update</h4>
        <p>Review these exact values before signing. This changes one economic record; it does not change token supply, quorum, identity requirements or the upgrade delay.</p>
        <dl><dt>Record commitment</dt><dd><code>{{s.key}}</code></dd>
          @for(row of factRows(); track row.label){<dt>{{row.label}}</dt><dd>{{row.value}}</dd>}
          <dt>Authority revision</dt><dd>{{s.revision}} → {{s.revision+1}}</dd></dl>
      </section>
    }
    @if(bill().grant; as g){
      <section class="asset-intent" aria-label="Exact SGT allocation">
        <h4>Exact SGT destinations</h4>
        <p>Reserve allocation creates nonvoting escrow first. SGT becomes eligible for the next proposal only after delivery to its holder vault is confirmed. Receipt does not require the private ID check.</p>
        <dl><dt>Reserve input coin</dt><dd><code>{{g.reserveCoinId}}</code></dd></dl>
        <ol>@for(o of g.outputs; track $index){<li><strong>{{o.amount | number}} SGT · {{o.kind===4?'Undelivered recipient escrow':'Nonvoting reserve remainder'}}</strong>
          <span>Owner puzzle commitment</span><code>{{o.ownerPuzzleHash}}</code></li>}</ol>
        <p class="muted">These are exact ownership commitments, not inferred vault addresses. Execution and escrow delivery are separate from this vote.</p>
      </section>
    }
    @if(bill().redemption; as r){
      <section class="asset-intent" aria-label="Exact funded redemption claims">
        <h4>Permanent redemption claims</h4>
        <p>{{r.allocations.length | number}} deed claims · {{r.totalPaymentAmount | number}} payment base units.
          This consumes the exact funded treasury coin and creates permanent claims. There is no withdrawal or expiry path.</p>
        <dl><dt>Treasury input</dt><dd><code>{{r.treasuryCoinId}}</code></dd>
          <dt>Payment CAT identity</dt><dd><code>{{r.paymentAssetId}}</code></dd>
          <dt>Collection</dt><dd><code>{{r.collectionId}}</code></dd>
          <dt>Settlement</dt><dd><code>{{r.settlementId}}</code></dd></dl>
        <ol>@for(row of r.allocations; track row.deedLauncherId){<li>
          <strong>{{row.paymentAmount | number}} base units · {{row.sharePpm / 10000 | number:'1.0-4'}}% share</strong>
          <span>SmartDeed launcher</span><code>{{row.deedLauncherId}}</code>
          <span>Deed commitment</span><code>{{row.deedCommitment}}</code></li>}</ol>
        <p class="muted">A pause can block this new funding. Once funded, these claims remain redeemable during a pause.
          Publication consent, holder voting, funding and each holder’s redemption are separate steps.</p>
      </section>
    }`,
  styles:[`:host{display:block}.asset-intent{margin-block:1rem;padding:1rem;border:1px solid var(--admin-border,#29463b);border-radius:.75rem}
    h4{margin:.5rem 0;font-size:1.1rem}.badge{font-size:.8rem;font-weight:700;letter-spacing:.04em;color:var(--admin-accent,#85dfb0)}
    .muted,dt,li span{color:var(--admin-muted,#abc4b8)}dl{display:grid;gap:.35rem}dd{margin:0 0 .75rem;min-width:0}
    code{display:block;overflow-wrap:anywhere;font-size:.85rem}li{padding:.75rem 0}li span{display:block;margin:.35rem 0}
    ol{padding-left:1.25rem}p{line-height:1.6}`],
})
export class GenerationAssetIntentComponent {
  readonly bill=input.required<GovernedBill>();
  readonly factRows=computed(()=>{
    const s=this.bill().statutes;if(!s)return [];
    const labels={COLLECTION:['Collection','Governed NAV (USD)','Allocation ceiling (USD)','NAV version','Valid from (chain seconds)','Valid until (chain seconds)','Status'],
      ORACLE:['Asset','Price (USD)','Observed at (chain seconds)','Valid until (chain seconds)','Round','Sources commitment','Source count','Haircut (basis points)','Stable minimum (basis points)','Stable maximum (basis points)'],
      ROUTE:['Route','Source chain','Destination chain','Asset','Remote asset','Decimals','Active'],
      LIQUIDITY:['Venue','Chain','Protocol','Factory','Pool','Base asset','Quote asset','Pool code','Active']}[s.recordKind];
    return s.record.slice(1).map((value,index)=>({label:labels[index+1],
      value:((s.recordKind==='COLLECTION' && [1,2].includes(index+1)) || (s.recordKind==='ORACLE' && index===0))?
        new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(Number(value)/1_000_000):String(value)}));
  });
}
