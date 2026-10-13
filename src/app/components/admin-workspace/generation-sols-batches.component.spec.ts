import { TestBed,fakeAsync,flushMicrotasks,tick } from '@angular/core/testing';
import { GenerationSolsBatchesComponent } from './generation-sols-batches.component';
import { GenerationSolsBatchesService } from '../../services/generation-sols-batches.service';

const h=(n:string)=>'0x'+n.repeat(64),gen=h('1'),id=h('2');
const op:any={generationId:gen,network:'testnet11',operationId:id,kind:'PRIMARY_SOLS_BATCH',intentHash:h('3'),stage:'PREPARED',
  transactionId:null,feeCapMojos:'100',createdAt:1,updatedAt:1,lastCheckedAt:null,confirmedHeight:null,errorCode:null,
  review:{kind:'PRIMARY_SOLS_BATCH',expiresAt:2000000000,primaryCoinIds:[h('4')],orderIds:[h('5')],backingCoinIds:[h('6')]}};
const desk=()=>({generationId:gen,orders:[{orderId:h('5'),generationId:gen,paymentAmount:'303000',solsAmount:'900900',destinationInnerHash:h('7'),expiresAt:null}],
  operations:[],catalog:{generationId:gen,ready:true,lastCheckedAt:Math.floor(Date.now()/1000),inventory:[{inventoryId:h('4'),currentCoinId:h('4'),
    deedLauncherId:h('8'),collectionId:h('9'),baseUsdMinor:'300000',subtotalUsdMinor:'303000'}],signedPrice:{round:{validUntil:Math.floor(Date.now()/1000)+600}},
    anchorHash:h('a'),registryCoinId:h('b'),poolCoinId:h('c'),statutesCoinId:h('d'),
    suggestedMatches:[{orderIds:[h('5')],primaryCoinIds:[h('4')],sourceCount:1,stage:'CANDIDATE_REQUIRES_NATIVE_REVIEW'}]}});

describe('Generation original-offer batch review',()=>{
  let api:any;
  beforeEach(()=>{api=jasmine.createSpyObj('batch',['desk','prepare','submit','releaseExpired']);api.desk.and.callFake(async()=>desk());
    api.prepare.and.resolveTo(op);api.submit.and.resolveTo({...op,stage:'SUBMITTED',transactionId:h('e')});
    api.releaseExpired.and.resolveTo({...op,stage:'EXPIRED_RECONCILED'});
    TestBed.configureTestingModule({imports:[GenerationSolsBatchesComponent],providers:[{provide:GenerationSolsBatchesService,useValue:api}]});});

  it('polls cached matching and shows exact recipients without preparing or submitting',fakeAsync(()=>{
    const f=TestBed.createComponent(GenerationSolsBatchesComponent);f.detectChanges();flushMicrotasks();f.detectChanges();
    expect(f.nativeElement.textContent).toContain(h('7'));expect(f.nativeElement.textContent).toContain('$3,030.00');
    expect(f.nativeElement.textContent).toContain('Native review still checks each signed minimum');
    tick(30000);flushMicrotasks();expect(api.desk.calls.count()).toBe(2);
    expect(api.prepare).not.toHaveBeenCalled();expect(api.submit).not.toHaveBeenCalled();f.destroy();
  }));

  it('uses the full signed price window and the selected independent pair',fakeAsync(()=>{
    const f=TestBed.createComponent(GenerationSolsBatchesComponent);f.componentRef.setInput('maximumFee','100');f.detectChanges();flushMicrotasks();
    const c=f.componentInstance;c.selectMatch([h('5')],[h('4')]);c.signerPair='1,2';c.feeCap=100;
    c.prepare(new Event('submit'));flushMicrotasks();
    const args=api.prepare.calls.mostRecent().args;expect(args[2].signerIndices).toEqual([1,2]);
    expect(args[2].expiresAt).toBe(c.desk()!.catalog!.signedPrice.round.validUntil);
    expect(args[3]).toBe(100);expect(api.submit).not.toHaveBeenCalled();f.destroy();
  }));

  it('blocks duplicate preparation and exposes expiry reconciliation without repricing',fakeAsync(()=>{
    const f=TestBed.createComponent(GenerationSolsBatchesComponent);f.componentRef.setInput('maximumFee','100');f.detectChanges();flushMicrotasks();
    const c=f.componentInstance;c.selectMatch([h('5')],[h('4')]);c.feeCap=100;
    let resolve!:(value:any)=>void;api.prepare.and.returnValue(new Promise(r=>resolve=r));
    c.prepare(new Event('submit'));c.prepare(new Event('submit'));expect(api.prepare.calls.count()).toBe(1);
    resolve(op);flushMicrotasks();c.releaseExpired();flushMicrotasks();f.detectChanges();
    expect(api.releaseExpired.calls.mostRecent().args[0].operationId).toBe(id);
    expect(c.operation()?.stage).toBe('EXPIRED_RECONCILED');expect(api.prepare.calls.count()).toBe(1);expect(api.submit).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('Valid original offers can join a new match');f.destroy();
  }));

  it('keeps large amounts exact and preserves usable controls at narrow widths',fakeAsync(()=>{
    const f=TestBed.createComponent(GenerationSolsBatchesComponent);f.detectChanges();flushMicrotasks();f.detectChanges();
    expect(f.componentInstance.usd('900719925474099301')).toBe('$9,007,199,254,740,993.01');
    const root=f.nativeElement as HTMLElement;
    for(const width of [320,390,768,1440]){root.style.width=width+'px';expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      expect(Array.from(root.querySelectorAll('button')).every(b=>b.getBoundingClientRect().height>=44)).toBeTrue();}
    f.destroy();
  }));
});
