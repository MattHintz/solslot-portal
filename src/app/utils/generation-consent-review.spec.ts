import { environment } from '../../environments/environment';
import { GenerationConsentReview } from '../services/generation-consent.service';
import { validateGenerationConsent } from './generation-consent-review';
import vector from './generation-consent.fixture.json';

describe('Native generation administrator consent review',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:any;
  beforeEach(()=>{
    previous={generationId:runtime.generationId,authority:runtime.adminAuthorityV3LauncherId,identities:runtime.adminAuthorityV3IdentityLauncherIds};
    runtime.generationId=vector.review.generationId;runtime.adminAuthorityV3LauncherId=vector.review.authorityLauncherId;
    runtime.adminAuthorityV3IdentityLauncherIds=[...vector.review.identityLauncherIds];
  });
  afterEach(()=>{
    if(previous.generationId===undefined)delete runtime.generationId;else runtime.generationId=previous.generationId;
    runtime.adminAuthorityV3LauncherId=previous.authority;runtime.adminAuthorityV3IdentityLauncherIds=previous.identities;
  });
  const review=()=>structuredClone(vector.review) as unknown as GenerationConsentReview;
  it('reconstructs the native proposal, exact 24-hour action and both identity signatures',()=>{
    const r=review(),valid=validateGenerationConsent(r);
    expect(valid.proposalId).toBe(r.proposalId);expect(valid.expiresAt-valid.createdAt).toBe(86400);
    expect(valid.requiredVotes).toBe(15000);expect(valid.challenges.map(c=>c.slot)).toEqual([0,1]);
    r.challenges[0].digest='0x'+'22'.repeat(32);expect(valid.challenges[0].digest).not.toBe(r.challenges[0].digest);
  });
  const faults:{[name:string]:(r:any)=>void}={
    generation:r=>r.generationId='0x'+'aa'.repeat(32),authority:r=>r.authorityLauncherId='0x'+'aa'.repeat(32),
    fee:r=>r.feeCapMojos='2000',deadline:r=>r.expiresAt-=86000,coadministrator:r=>r.coadministratorSlot=2,
    quorum:r=>r.requiredVotes=500000,supply:r=>r.eligibleSupply=40000,root:r=>r.holdingsRoot='0x'+'aa'.repeat(32),
    proposal:r=>r.proposalId='0x'+'aa'.repeat(32),target:r=>r.targetPuzzleHash='0x'+'aa'.repeat(32),
    version:r=>r.proposal.upgrade.changes[0].nextVersion=3,source:r=>r.proposal.upgrade.sourceManifestHash='0x'+'aa'.repeat(32),
    identity:r=>r.identityCoins[0].amount=1,identityPuzzle:r=>r.identityCustodies[0]='0x'+'aa'.repeat(32),
    coin:r=>r.challenges[0].coinId='0x'+'aa'.repeat(32),delegate:r=>r.challenges[0].delegatedPuzzleHash='0x'+'aa'.repeat(32),
    network:r=>r.challenges[0].typedData.domain.salt='0x'+'aa'.repeat(32),
    extraField:r=>r.challenges[0].typedData.message['arbitraryAction']='approve',
    signatureRole:r=>r.signatures=[{slot:2,signedAt:r.createdAt}],
    prematurelyReady:r=>r.stage='READY',request:r=>r.request.upgrade.changes[0].newModuleHash='0x'+'aa'.repeat(32),
  };
  for(const [name,fault] of Object.entries(faults))it('rejects altered '+name+' before signing',()=>{
    const r=review();fault(r);expect(()=>validateGenerationConsent(r)).toThrow();
  });
});
