import {environment} from '../../environments/environment';
import {GenerationSgtContext,GenerationSgtRequest,inspectGenerationSgt,executeGenerationSgtBls} from './generation-sgt-review';
import {initializeVerifiedChiaRuntime,verifiedChiaRuntime} from './verified-chia-runtime';
import original from './generation-custody-vectors/NONE.json';
import stamped from './generation-custody-vectors/STAMP.json';
import rotated from './generation-custody-vectors/BLS_ROTATION.json';
import migrated from './generation-custody-vectors/EVM_ROTATION.json';

// Public reviews exported only after actual native custody transitions in
// test_generation_holder_ballots.py. These contain no wallet signatures.
describe('Current holder custody after confirmed policy transitions',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:string|undefined;
  beforeAll(async()=>{await initializeVerifiedChiaRuntime();});
  beforeEach(()=>{previous=runtime.generationId;runtime.generationId=original.context.generationId;});
  afterEach(()=>{if(previous===undefined)delete runtime.generationId;else runtime.generationId=previous;});
  for(const [name,vector] of Object.entries({original,stamped,rotated,migrated})){
    it('reviews the native '+name+' custody and preserves the whole 10,000-SGT owner',()=>{
      const r=vector.request as GenerationSgtRequest,c=vector.context as GenerationSgtContext;
      const now=r.expiresAt-60;
      const intent=inspectGenerationSgt(r,c,now);
      expect(intent.authorizationHash).toBe(vector.authorizationHash);
      expect(intent.sgtAmount).toBe(10000);
      expect(intent.outputs as GenerationSgtRequest['outputs']).toEqual(r.outputs);
      expect(intent.successorPuzzleHash).toBe(c.vault.current.coin.puzzleHash);
      expect(intent.vaultFeeMojos).toBe(0);
      if(c.owner.authType===1){
        expect(executeGenerationSgtBls(r,c,verifiedChiaRuntime(),now).authorizationHash).toBe(intent.authorizationHash);
      }else{
        expect(intent.signingCoinSpends).toEqual([]);
        expect(intent.vaultTypedData).toEqual(r.typedData);
      }
    });
  }
  for(const [name,vector] of Object.entries({stamped,rotated,migrated})){
    it('rejects stale original '+name+' custody before opening a wallet',()=>{
      const c=structuredClone(vector.context) as GenerationSgtContext,r=vector.request as GenerationSgtRequest;
      c.vault.current=structuredClone(original.context.vault.current);
      expect(()=>inspectGenerationSgt(r,c,r.expiresAt-60)).toThrow();
    });
  }
  it('rejects the previous BLS key after a confirmed rotation',()=>{
    const c=structuredClone(rotated.context) as GenerationSgtContext;
    c.owner=structuredClone(original.context.owner) as GenerationSgtContext['owner'];
    expect(()=>inspectGenerationSgt(rotated.request as GenerationSgtRequest,c,rotated.request.expiresAt-60)).toThrow();
  });
  it('rejects the original identity root after a confirmed stamp',()=>{
    const c=structuredClone(stamped.context) as GenerationSgtContext;
    c.vault.identityRoot=original.context.vault.identityRoot;
    expect(()=>inspectGenerationSgt(stamped.request as GenerationSgtRequest,c,stamped.request.expiresAt-60)).toThrow();
  });
});
