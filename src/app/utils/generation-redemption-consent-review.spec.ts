import { environment } from '../../environments/environment';
import { GenerationConsentReview } from '../services/generation-consent.service';
import { validateGenerationConsent } from './generation-consent-review';
import { reconstructGovernedBill,redemptionReviewBill } from './generation-governed-bill';
import { parseClvm } from './strict-clvm';
import vector from './generation-redemption-consent.fixture.json';

describe('Native permanent redemption review',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:any;
  const review=()=>structuredClone(vector.review) as unknown as GenerationConsentReview;
  beforeEach(()=>{
    previous={generationId:runtime.generationId,authority:runtime.adminAuthorityV3LauncherId,identities:runtime.adminAuthorityV3IdentityLauncherIds};
    runtime.generationId=vector.review.generationId;runtime.adminAuthorityV3LauncherId=vector.review.authorityLauncherId;
    runtime.adminAuthorityV3IdentityLauncherIds=[...vector.review.identityLauncherIds];
  });
  afterEach(()=>{
    if(previous.generationId===undefined)delete runtime.generationId;else runtime.generationId=previous.generationId;
    runtime.adminAuthorityV3LauncherId=previous.authority;runtime.adminAuthorityV3IdentityLauncherIds=previous.identities;
  });
  it('reconstructs the native funding bill and both exact signature challenges',()=>{
    const r=validateGenerationConsent(review());
    expect(reconstructGovernedBill(r.proposal!).hash).toBe(parseClvm(vector.billClvm).hash);
    expect(redemptionReviewBill(r.proposal!.redemption!).hash).toBe(r.billHash!);
    expect(r.requiredVotes).toBe(15000);expect(r.expiresAt-r.createdAt).toBe(86400);
    expect(r.challenges.map(v=>v.slot)).toEqual([0,1]);
    expect(r.proposal!.redemption!.allocations[1].deedLauncherId).toMatch(/^0xc8/);
  });
  const faults:Record<string,(r:any)=>void>={
    source:r=>r.proposal.redemption.treasuryCoinId='0x'+'aa'.repeat(32),
    parent:r=>r.proposal.redemption.treasuryParentId='0x'+'aa'.repeat(32),
    asset:r=>r.proposal.redemption.paymentAssetId='0x'+'aa'.repeat(32),
    collection:r=>r.proposal.redemption.collectionId='0x'+'aa'.repeat(32),
    settlement:r=>r.proposal.redemption.settlementId='0x'+'aa'.repeat(32),
    total:r=>r.proposal.redemption.totalPaymentAmount++,
    claim:r=>r.proposal.redemption.allocations[0].paymentAmount++,
    shares:r=>r.proposal.redemption.allocations[0].sharePpm--,
    launcher:r=>r.proposal.redemption.deedLauncherPuzzleHash='0x'+'aa'.repeat(32),
    commitment:r=>r.proposal.redemption.allocations[0].deedCommitment='0x'+'aa'.repeat(32),
    duplicate:r=>r.proposal.redemption.allocations[1].deedLauncherId=r.proposal.redemption.allocations[0].deedLauncherId,
    order:r=>r.proposal.redemption.allocations.reverse(),
    'different requested allocation':r=>r.request.redemption.allocations[0].deedCommitment='0x'+'aa'.repeat(32),
    'hidden grant':r=>r.proposal.grant={reserveCoinId:'0x'+'aa'.repeat(32),outputs:[]},
    'extra affected input':r=>r.expectedInputs.components={['0x'+'aa'.repeat(32)]:'0x'+'bb'.repeat(32)},
  };
  for(const [name,change] of Object.entries(faults))it('rejects changed '+name+' before opening a wallet',()=>{
    const r=review();change(r);expect(()=>validateGenerationConsent(r)).toThrow();
  });
});
