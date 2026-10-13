import { TestBed } from '@angular/core/testing';
import { GenerationAssetIntentComponent } from './generation-asset-intent.component';
import { GovernedBill } from '../../utils/generation-governed-bill';
import vectors from '../../utils/generation-public-bill.fixture.json';

describe('Exact mint and grant review presentation',()=>{
  beforeEach(()=>TestBed.configureTestingModule({imports:[GenerationAssetIntentComponent]}));
  it('shows test purpose, exact deed count and unchanged sealed edition in the review',()=>{
    const f=TestBed.createComponent(GenerationAssetIntentComponent),bill=vectors.find(v=>v.review.kind==='MINT_TEST_ONLY')!.review as GovernedBill;
    f.componentRef.setInput('bill',bill);f.detectChanges();const text=f.nativeElement.textContent;
    expect(text).toContain('25 unique test SmartDeeds');expect(text).toContain('TEST ONLY');
    expect(text).toContain(bill.testMint!.collectionId);expect(text).toContain(bill.testMint!.editionHash);
    expect(text).toContain('no real investment or property rights');expect(text).toContain('new review and vote');
    expect(f.nativeElement.querySelector('button')).toBeNull();f.destroy();
  });
  it('shows every full ownership commitment and separates allocation from delivery and voting eligibility',()=>{
    const f=TestBed.createComponent(GenerationAssetIntentComponent),bill=vectors.find(v=>v.review.kind==='GRANT')!.review as GovernedBill;
    f.componentRef.setInput('bill',bill);f.detectChanges();const text=f.nativeElement.textContent;
    expect(text).toContain(bill.grant!.reserveCoinId);expect(text).toContain('10,000 SGT');expect(text).toContain('960,000 SGT');
    for(const output of bill.grant!.outputs)expect(text).toContain(output.ownerPuzzleHash);
    expect(text).toContain('Undelivered recipient escrow');expect(text).toContain('Nonvoting reserve remainder');
    expect(text).toContain('Receipt does not require the private ID check');expect(text).toContain('not inferred vault addresses');
    expect(f.nativeElement.querySelector('button')).toBeNull();f.destroy();
  });
  it('presents governed monetary facts in dollars with their exact key and revision',()=>{
    const f=TestBed.createComponent(GenerationAssetIntentComponent),bill=vectors.find(v=>v.review.kind==='STATUTES')!.review as GovernedBill;
    f.componentRef.setInput('bill',bill);f.detectChanges();const text=f.nativeElement.textContent;
    expect(text).toContain('Governed NAV (USD)');expect(text).toContain('$75,000');
    expect(text).toContain(bill.statutes!.key);expect(text).toContain('0 → 1');
    expect(text).toContain('does not change token supply, quorum');f.destroy();
  });
});
