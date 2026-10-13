import { reconstructGovernedBill,GovernedBill,StatuteIntent,validateStatuteIntent } from './generation-governed-bill';
import { parseClvm } from './strict-clvm';
import vectors from './generation-public-bill.fixture.json';

describe('Independent native governance bill reconstruction',()=>{
  const review=(kind:string)=>structuredClone(vectors.find(v=>v.review.kind===kind)!.review) as GovernedBill;
  for(const v of vectors)it('reconstructs the native '+v.review.kind+' commitment',()=>{
    const r=structuredClone(v.review) as GovernedBill;
    expect(reconstructGovernedBill(r).hash).toBe(parseClvm(v.billClvm).hash);
    expect(reconstructGovernedBill(r).hash).toBe(v.review.billHash);
  });
  const faults:Record<string,[string,(r:any)=>void]>={
    'missing edition':['MINT_TEST_ONLY',r=>delete r.testMint],
    'production purpose':['MINT_TEST_ONLY',r=>r.testMint.purpose='PRODUCTION'],
    'different collection':['MINT_TEST_ONLY',r=>r.testMint.collectionId='0x'+'aa'.repeat(32)],
    'different edition':['MINT_TEST_ONLY',r=>r.testMint.editionHash='0x'+'aa'.repeat(32)],
    'different count':['MINT_TEST_ONLY',r=>r.testMint.deedCount=24],
    'unbounded count':['MINT_TEST_ONLY',r=>r.testMint.deedCount=101],
    'fractional count':['MINT_TEST_ONLY',r=>r.testMint.deedCount=24.5],
    'contradictory effects':['MINT_TEST_ONLY',r=>r.grant=review('GRANT').grant],
    'missing grant':['GRANT',r=>delete r.grant],
    'different reserve input':['GRANT',r=>r.grant.reserveCoinId='0x'+'aa'.repeat(32)],
    'hidden destination':['GRANT',r=>r.grant.outputs.pop()],
    'different owner':['GRANT',r=>r.grant.outputs[0].ownerPuzzleHash='0x'+'aa'.repeat(32)],
    'changed amount':['GRANT',r=>r.grant.outputs[0].amount=10001],
    'holder weight shortcut':['GRANT',r=>r.grant.outputs[0].kind=1],
    'locked allocation':['GRANT',r=>r.grant.outputs[0].kind=2],
    'arbitrary lock':['GRANT',r=>r.grant.outputs[0].lockId='0x'+'aa'.repeat(32)],
    'zero amount':['GRANT',r=>r.grant.outputs[0].amount=0],
    'excess supply':['GRANT',r=>r.grant.outputs[0].amount=50000],
    'duplicate output':['GRANT',r=>r.grant.outputs=[r.grant.outputs[0],r.grant.outputs[0]]],
    'unknown bill':['GRANT',r=>r.kind='GENESIS_GRANT'],
    'reserve hidden in grant':['GRANT',r=>r.parameters=review('PARAMETERS').parameters],
    'swapped fee shares':['PARAMETERS',r=>r.parameters.values.splice(3,2,30,70)],
    'changed reopening scope':['REOPEN',r=>r.scope=1],
    'changed upgrade nonce':['UPGRADE',r=>r.registryNonce++],
    'changed economic key':['STATUTES',r=>r.statutes.key='0x'+'aa'.repeat(32)],
    'changed economic value':['STATUTES',r=>r.statutes.record[1]++],
    'unbounded economic fee':['STATUTES',r=>r.statutes.recordKind='PARAMETER'],
    'legacy pause shortcut':['STATUTES',r=>r.statutes.recordKind='PAUSE'],
    'missing economic root':['STATUTES',r=>delete r.statutes.nextRoot],
  };
  for(const [fault,[kind,change]] of Object.entries(faults))it('rejects '+fault+' before an approval',()=>{
    const r=review(kind);change(r);expect(()=>reconstructGovernedBill(r)).toThrow();
  });
  it('binds any reserve remainder to the frozen reserve owner',()=>{
    const r=review('GRANT');expect(()=>reconstructGovernedBill(r,r.grant!.outputs[1].ownerPuzzleHash)).not.toThrow();
    expect(()=>reconstructGovernedBill(r,'0x'+'aa'.repeat(32))).toThrow();
  });
  it('independently checks the full economic witness before execution',()=>{
    const r=review('STATUTES');const intent:StatuteIntent={...r.statutes!,currentRecords:[]};
    expect(()=>validateStatuteIntent(intent)).not.toThrow();
    const changed=structuredClone(intent);changed.currentRecords=[changed.record];
    expect(()=>validateStatuteIntent(changed)).toThrow();
    const revision=structuredClone(intent);revision.record[3]=2;
    expect(()=>validateStatuteIntent(revision)).toThrow();
  });
});
