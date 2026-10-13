import { environment } from '../../environments/environment';
import { GenerationConsentReview } from '../services/generation-consent.service';
import { validateGenerationConsent } from './generation-consent-review';
import vector from './generation-statutes-consent.fixture.json';

describe('Native canonical economic fact consent',()=>{
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
  it('reconstructs the native fact and both exact administrator requests',()=>{
    const valid=validateGenerationConsent(review());
    expect(valid.proposal?.kind).toBe('STATUTES');expect(valid.requiredVotes).toBe(15000);
    expect(valid.expiresAt-valid.createdAt).toBe(86400);expect(valid.challenges.map(c=>c.slot)).toEqual([0,1]);
  });
  const faults:Record<string,(r:any)=>void>={
    value:r=>r.proposal.statutes.record[1]++,
    recordKind:r=>r.proposal.statutes.recordKind='PAUSE',
    scope:r=>r.request.scope=31,
    witness:r=>r.request.statutes.currentRecords=[r.request.statutes.record],
    omittedInput:r=>r.expectedInputs.components={},
    key:r=>r.proposal.statutes.key='0x'+'aa'.repeat(32),
    revision:r=>r.proposal.statutes.revision++,
    destination:r=>r.proposal.statutes.launcherId='0x'+'aa'.repeat(32),
  };
  for(const [name,change] of Object.entries(faults))it('rejects changed '+name+' before signing',()=>{
    const r=review();change(r);expect(()=>validateGenerationConsent(r)).toThrow();
  });
});
