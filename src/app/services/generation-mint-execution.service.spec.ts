import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { GenerationMintExecutionService } from './generation-mint-execution.service';
import { MintExecutionRequest } from './generation-governance.service';
import { GenerationMintReview } from '../utils/generation-mint-review';
import { MintExecutionStatus } from '../utils/generation-mint-execution-review';
import prepared from '../utils/generation-mint-execution.fixture.json';
import confirmed from '../utils/generation-mint-confirmation.fixture.json';

describe('Source-scoped mint submission and durable browser recovery',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:string|undefined,api:GenerationMintExecutionService,http:HttpTestingController;
  const source=()=>structuredClone(prepared.source) as GenerationMintReview;
  const status=()=>structuredClone(prepared.execution) as MintExecutionStatus;
  const base=()=>environment.faucetApi+'/admin/generation/mint-reviews/'+prepared.source.packageId+'/execution';
  beforeEach(()=>{
    previous=runtime.generationId;runtime.generationId=prepared.source.generationId;
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),
      {provide:AdminSessionService,useValue:{requireJwt:()=> 'synthetic-jwt'}}]});
    api=TestBed.inject(GenerationMintExecutionService);http=TestBed.inject(HttpTestingController);
  });
  afterEach(()=>{http.verify();if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;});
  it('polls only cached execution and never triggers preparation or submission',async()=>{
    const pending=api.saved(source()),call=http.expectOne(base());expect(call.request.method).toBe('GET');
    expect(call.request.headers.get('Authorization')).toBe('Bearer synthetic-jwt');call.flush(status());
    expect((await pending).operation?.stage).toBe('PREPARED');
  });
  it('submits only the exact saved operation identity, fee ceiling and source route',async()=>{
    const v=status(),pending=api.submit(source(),v),call=http.expectOne(base()+'/submit');
    expect(call.request.body).toEqual({generationId:v.generationId,operationId:v.operation!.operationId,
      intentHash:v.operation!.intentHash,feeCapMojos:1000});
    call.flush(v);expect((await pending).operation?.operationId).toBe(v.operation!.operationId);
  });
  it('retains an ambiguous dispatch receipt returned with a network error',async()=>{
    const v=status(),pending=api.submit(source(),v),saved={...v,operation:{...v.operation!,stage:'RECONCILING',
      transactionId:confirmed.execution.operation.transactionId,errorCode:'RECONCILIATION_REQUIRED'}};
    http.expectOne(base()+'/submit').flush({detail:{execution:saved}},{status:503,statusText:'Service unavailable'});
    expect((await pending).operation?.transactionId).toBe(saved.operation.transactionId);
  });
  it('keeps confirmed inventory when a delayed cache response loses transaction progress',async()=>{
    const first=api.saved(source());http.expectOne(base()).flush(confirmed.execution);await first;
    const second=api.saved(source());http.expectOne(base()).flush(status());const kept=await second;
    expect(kept.operation?.stage).toBe('CONFIRMED');expect(kept.inventory.receipt?.deedCount).toBe(25);
  });
});
