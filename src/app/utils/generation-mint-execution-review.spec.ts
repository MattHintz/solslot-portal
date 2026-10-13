import { environment } from '../../environments/environment';
import { GenerationMintReview } from './generation-mint-review';
import { MintExecutionStatus,validateMintExecution } from './generation-mint-execution-review';
import prepared from './generation-mint-execution.fixture.json';
import confirmed from './generation-mint-confirmation.fixture.json';

describe('Exact native mint transaction and initial inventory receipt',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};let previous:string|undefined;
  beforeEach(()=>{previous=runtime.generationId;runtime.generationId=prepared.source.generationId;});
  afterEach(()=>{if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;});
  it('verifies the native prepared batch and all 25 uniquely confirmed outputs',()=>{
    const p=validateMintExecution(prepared.execution as MintExecutionStatus,prepared.source as GenerationMintReview);
    const c=validateMintExecution(confirmed.execution as MintExecutionStatus,confirmed.source as GenerationMintReview);
    expect(p.operation?.stage).toBe('PREPARED');expect(p.inventory.receipt).toBeNull();
    expect(c.inventory.receipt!.deedCount).toBe(25);expect(c.inventory.receipt!.confirmedHeight).toBe(c.operation!.confirmedHeight!);
  });
  const faults:{[name:string]:(v:any)=>void}={
    generation:v=>v.generationId='0x'+'aa'.repeat(32),source:v=>v.sourceReviewId='0x'+'aa'.repeat(32),
    fee:v=>v.operation.feeCapMojos='1001',edition:v=>v.operation.review.mintBill.testMint.editionHash='0x'+'aa'.repeat(32),
    metadata:v=>v.operation.review.metadataRoot='0x'+'aa'.repeat(32),purpose:v=>v.inventory.receipt.purpose='PRODUCTION',
    count:v=>v.inventory.receipt.deedCount=24,block:v=>v.inventory.receipt.confirmedHeight++,
    transaction:v=>v.inventory.receipt.transactionId='0x'+'aa'.repeat(32),
    launcher:v=>v.inventory.receipt.inventory[0].launcherId='0x'+'aa'.repeat(32),
    inventory:v=>v.inventory.receipt.inventory[0].coin.puzzle_hash='0x'+'aa'.repeat(32),
    duplicate:v=>v.inventory.receipt.inventory[1]=v.inventory.receipt.inventory[0],
    partial:v=>v.inventory.receipt.inventory.pop(),early:v=>{v.operation.stage='SUBMITTED';v.operation.confirmedHeight=null;},
    parent:v=>v.operation.review.funding[0].coinId='0x'+'aa'.repeat(32),
  };
  for(const [name,fault] of Object.entries(faults))it('rejects altered '+name+' as mint confirmation',()=>{
    const v=structuredClone(confirmed.execution);fault(v);
    expect(()=>validateMintExecution(v as MintExecutionStatus,confirmed.source as GenerationMintReview)).toThrow();
  });
});
