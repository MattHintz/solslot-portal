import { TestBed } from '@angular/core/testing';
import { GenerationRewardsFormComponent } from './generation-rewards-form.component';
import { GenerationChainSnapshot } from '../../services/generation-governance.service';

describe('Explicit protected SGT reward forms',()=>{
  const h=(n:number)=>'0x'+n.toString(16).padStart(2,'0').repeat(32);
  const snapshot=()=>({supply:{holdingsRoot:h(1),distributed:30000,sequence:7},
    rewardAuthorities:[{assetId:h(2),statutesComponentId:h(3),statutesLauncherId:h(4),revision:2,valuesHash:h(5),epochSeconds:86400}]} as GenerationChainSnapshot);
  it('prepares only explicit complete inputs with the confirmed snapshot and preserves the selection on refresh',()=>{
    const f=TestBed.createComponent(GenerationRewardsFormComponent);f.componentRef.setInput('snapshot',snapshot());f.detectChanges();
    const emitted=jasmine.createSpy('epoch');f.componentInstance.epochReviewed.subscribe(emitted);
    f.componentInstance.feeText.set(h(6)+'\n'+h(7));f.detectChanges();
    expect(emitted).not.toHaveBeenCalled();f.componentInstance.close(new Event('submit'));
    expect(emitted.calls.mostRecent().args[0]).toEqual({assetId:h(2),statutesComponentId:h(3),statutesLauncherId:h(4),revision:2,valuesHash:h(5),
      holdingsRoot:h(1),eligibleSupply:30000,ledgerSequence:7,feeCoinIds:[h(6),h(7)]});
    f.componentRef.setInput('snapshot',{...snapshot(),supply:{...snapshot().supply,holdingsRoot:h(8),sequence:8}});f.detectChanges();
    expect(f.componentInstance.fees()).toEqual([h(6),h(7)]);expect(emitted).toHaveBeenCalledTimes(1);
    expect(f.nativeElement.textContent).toContain('Reserve and undelivered escrow receive no share');
  });
  for(const value of ['',h(1)+' '+h(1),'0x'+'00'.repeat(32),Array.from({length:65},(_,i)=>h(i+1)).join('\n')])
    it('rejects missing, duplicated, zero or over-capacity funding: '+value.slice(0,12),()=>{
      const f=TestBed.createComponent(GenerationRewardsFormComponent);f.componentRef.setInput('snapshot',snapshot());f.detectChanges();
      const emitted=jasmine.createSpy('epoch');f.componentInstance.epochReviewed.subscribe(emitted);f.componentInstance.feeText.set(value);
      f.componentInstance.close(new Event('submit'));expect(emitted).not.toHaveBeenCalled();
    });
  it('keeps the exact vault and claim separate from epoch closure and cannot emit while disabled',()=>{
    const f=TestBed.createComponent(GenerationRewardsFormComponent);f.componentRef.setInput('snapshot',snapshot());f.detectChanges();
    const emitted=jasmine.createSpy('claim');f.componentInstance.claimReviewed.subscribe(emitted);
    f.componentInstance.claimDraft.set({claimCoinId:h(9),epochId:h(10),ownerPuzzleHash:h(11),vaultLauncherId:h(12),amount:30});
    f.componentRef.setInput('disabled',true);f.detectChanges();f.componentInstance.claim(new Event('submit'));expect(emitted).not.toHaveBeenCalled();
    f.componentInstance.setClaim('vaultLauncherId',h(13));expect(f.componentInstance.claimDraft().vaultLauncherId).toBe(h(12));
    f.componentRef.setInput('disabled',false);f.detectChanges();f.componentInstance.claim(new Event('submit'));
    expect(emitted.calls.mostRecent().args[0]).toEqual({assetId:h(2),statutesLauncherId:h(4),claimCoinId:h(9),epochId:h(10),ownerPuzzleHash:h(11),vaultLauncherId:h(12),amount:30});
    expect(f.nativeElement.textContent).toContain('Receiving SGT rewards needs no private ID check');
    f.componentInstance.setClaim('amount','9007199254740992');f.componentInstance.claim(new Event('submit'));expect(emitted).toHaveBeenCalledTimes(1);
  });
});
