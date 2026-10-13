import { TestBed } from '@angular/core/testing';
import { GenerationRedemptionFormComponent } from './generation-redemption-form.component';
import { RedemptionIntent } from '../../utils/generation-governed-bill';
import vector from '../../utils/generation-redemption-consent.fixture.json';

describe('Standard permanent redemption form',()=>{
  const intent=()=>structuredClone(vector.review.proposal.redemption) as RedemptionIntent;
  beforeEach(()=>TestBed.configureTestingModule({imports:[GenerationRedemptionFormComponent]}));
  it('starts with an explicit incomplete form and no executable action',()=>{
    const f=TestBed.createComponent(GenerationRedemptionFormComponent);f.detectChanges();
    expect(f.componentInstance.valid()).toBeFalse();
    expect(f.nativeElement.querySelector('button[type=submit]').disabled).toBeTrue();
    expect(f.nativeElement.querySelectorAll('label').length).toBe(11);
    expect(f.nativeElement.textContent).toContain('does not infer a dollar amount or ticker');
  });
  it('reconciles standard fields, canonicalizes complete rows and emits only on submit',()=>{
    const f=TestBed.createComponent(GenerationRedemptionFormComponent),c=f.componentInstance;
    let emitted:RedemptionIntent|undefined;c.prepared.subscribe(v=>emitted=v);
    const expected=intent();c.draft.set({...expected,allocations:[...expected.allocations].reverse()});f.detectChanges();
    expect(c.valid()).toBeTrue();expect(emitted).toBeUndefined();
    c.submit(new Event('submit'));expect(emitted).toEqual(expected);
    c.setRow(0,'paymentAmount','1');expect(emitted).toEqual(expected);expect(c.valid()).toBeFalse();
  });
  it('does not emit or change preparation fields while the parent action is busy or paused',()=>{
    const f=TestBed.createComponent(GenerationRedemptionFormComponent),c=f.componentInstance;
    c.draft.set(intent());f.componentRef.setInput('disabled',true);f.detectChanges();
    let emitted=false;c.prepared.subscribe(()=>emitted=true);
    const before=structuredClone(c.draft());c.submit(new Event('submit'));c.add();c.remove(0);
    c.setField('totalPaymentAmount','1');c.setRow(0,'sharePpm','1');
    expect(c.draft()).toEqual(before);expect(emitted).toBeFalse();
    expect(f.nativeElement.querySelector('button[type=submit]').disabled).toBeTrue();
  });
  for(const fault of ['shares','amount','duplicate','fractional','zero'])it('disables an unreconciled '+fault+' allocation',()=>{
    const f=TestBed.createComponent(GenerationRedemptionFormComponent),c=f.componentInstance,v=intent();
    if(fault==='shares')v.allocations[0].sharePpm--;
    else if(fault==='amount')v.totalPaymentAmount++;
    else if(fault==='duplicate')v.allocations[1].deedLauncherId=v.allocations[0].deedLauncherId;
    else if(fault==='fractional')v.allocations[0].paymentAmount+=.5;
    else v.paymentAssetId='0x'+'00'.repeat(32);
    c.draft.set(v);expect(c.valid()).toBeFalse();
  });
});
