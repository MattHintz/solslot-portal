import { environment } from '../../environments/environment';
import { validateGenerationBallot } from './generation-ballot-review';
import { GenerationBallotReview } from '../services/generation-ballot.service';
import vector from './generation-holder-ballot.fixture.json';

describe('Native holder ballot review',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:any;
  const review=()=>structuredClone(vector.review) as unknown as GenerationBallotReview;
  beforeEach(()=>{previous={generationId:runtime.generationId,verified:runtime.generationBindingsVerified,bindings:structuredClone(runtime.generationHolderBindings)};
    runtime.generationId=vector.review.generationId;runtime.generationBindingsVerified=true;runtime.generationHolderBindings={...vector.bindings};});
  afterEach(()=>{if(previous.generationId===undefined)delete runtime.generationId;else runtime.generationId=previous.generationId;
    runtime.generationBindingsVerified=previous.verified;runtime.generationHolderBindings=previous.bindings;});
  it('reconstructs native co-sponsorship, custody, exact bill and 15,000-SGT quorum',()=>{
    const r=review(),valid=validateGenerationBallot(r);
    expect(valid.selectedWeight).toBe(20000);expect(valid.requiredVotes).toBe(15000);expect(valid.eligibleSupply).toBe(30000);
    expect(valid.holders.map(h=>h.context.vault.launcherId)).toEqual(r.request.selected.map(s=>s.vaultLauncherId));
    r.holders[0].authorizationHash='0x'+'aa'.repeat(32);expect(valid.holders[0].authorizationHash).not.toBe(r.holders[0].authorizationHash);
  });
  const faults:{[key:string]:(r:any)=>void}={
    generation:r=>r.generationId='0x'+'aa'.repeat(32),network:r=>r.network='mainnet',fee:r=>r.feeCapMojos='1001',
    nonce:r=>r.proposalNonce++,bill:r=>r.proposal.upgrade.sourceManifestHash='0x'+'aa'.repeat(32),
    quorum:r=>r.requiredVotes=500000,supply:r=>r.eligibleSupply=1000000,weight:r=>r.selectedWeight=30000,
    selection:r=>r.request.selected[0].coinId=r.request.selected[1].coinId,
    custody:r=>r.holders[0].context.vault.launcherId=r.holders[1].context.vault.launcherId,
    inputs:r=>r.holders[0].context.holding.current.spentHeight=10,
    reserve:r=>r.holders[0].context.bindings.reserveOwner=r.holders[0].request.outputs[0].owner,
    partial:r=>r.holders[0].request.outputs[0].amount=5000,
    recipient:r=>r.holders[0].request.outputs[0].owner=r.holders[1].request.outputs[0].owner,
    snapshot:r=>r.holders[0].context.selection.snapshotProof[0][1]++,
    root:r=>r.snapshotRoot='0x'+'aa'.repeat(32),proposal:r=>r.holders[0].context.selection.proposalId='0x'+'aa'.repeat(32),
    deadline:r=>r.holders[0].request.expiresAt++,
    approval:r=>r.holders[0].request.typedData.message.spend_case='0x'+'aa'.repeat(32),
    signature:r=>r.signatures=[{coinId:'0x'+'aa'.repeat(32),signedAt:r.createdAt}],
    prematureReady:r=>r.stage='READY',
  };
  for(const [name,fault] of Object.entries(faults))it('rejects altered '+name+' before a wallet prompt',()=>{
    const r=review();fault(r);expect(()=>validateGenerationBallot(r)).toThrow();
  });
  it('requires frozen verified authority bindings rather than server-selected bindings',()=>{
    runtime.generationHolderBindings.ledgerLauncherId='0x'+'aa'.repeat(32);
    expect(()=>validateGenerationBallot(review())).toThrow();runtime.generationHolderBindings={...vector.bindings};runtime.generationBindingsVerified=false;
    expect(()=>validateGenerationBallot(review())).toThrow();
  });
});
