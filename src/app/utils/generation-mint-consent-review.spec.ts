import { getBytes,sha256,toUtf8Bytes } from 'ethers';
import { environment } from '../../environments/environment';
import { GenerationConsentReview } from '../services/generation-consent.service';
import { canonicalConsent,validateGenerationConsent } from './generation-consent-review';
import { canonicalizeJcs } from '../services/property-metadata/property-metadata.service';
import vector from './generation-mint-consent.fixture.json';

describe('Native sealed test mint publication consent',()=>{
  const runtime=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  let previous:any;
  beforeEach(()=>{
    previous={generationId:runtime.generationId,authority:runtime.adminAuthorityV3LauncherId,identities:runtime.adminAuthorityV3IdentityLauncherIds};
    runtime.generationId=vector.generationId;runtime.adminAuthorityV3LauncherId=vector.authorityLauncherId;
    runtime.adminAuthorityV3IdentityLauncherIds=[...vector.identityLauncherIds];
  });
  afterEach(()=>{
    if(previous.generationId===undefined)delete runtime.generationId;else runtime.generationId=previous.generationId;
    runtime.adminAuthorityV3LauncherId=previous.authority;runtime.adminAuthorityV3IdentityLauncherIds=previous.identities;
  });
  const review=()=>structuredClone(vector) as unknown as GenerationConsentReview;
  it('independently reconstructs the exact native 25-deed source and both publication challenges',()=>{
    const r=validateGenerationConsent(review());
    expect(r.proposal?.testMint?.deedCount).toBe(25);expect(r.requiredVotes).toBe(15000);
    expect(r.expiresAt-r.createdAt).toBe(86400);expect(r.mintSource?.canonicalMetadata.offering.targetRaiseMinor).toBe('7500000');
    expect(r.request.mintReviewId).toBe(r.mintSource!.packageId);expect(r.billHash).toBe(r.mintSource!.billHash);
  });
  const faults:{[key:string]:(r:any)=>void}={
    source:r=>delete r.mintSource,edition:r=>r.mintSource.editionHash='0x'+'aa'.repeat(32),
    funding:r=>r.mintSource.funding[0].coinId='0x'+'aa'.repeat(32),
    preview:r=>r.mintSource.request.previewHash='0x'+'aa'.repeat(32),
    economics:r=>r.mintSource.canonicalMetadata.offering.targetRaiseMinor='7600000',
    denomination:r=>r.proposal.testMint.deedCount=26,purpose:r=>r.mintSource.canonicalMetadata.purpose='PRODUCTION',
    sourceRequest:r=>r.request.mintReviewId='0x'+'aa'.repeat(32),
    authority:r=>r.expectedInputs.components[r.mintSource.mintAuthority.componentId]='0x'+'aa'.repeat(32),
    extraAuthority:r=>r.expectedInputs.components['0x'+'aa'.repeat(32)]='0x'+'bb'.repeat(32),
    fee:r=>r.feeCapMojos='1001',network:r=>r.mintSource.network='mainnet',
  };
  for(const [name,fault] of Object.entries(faults))it('rejects substituted '+name+' before any wallet prompt',()=>{
    const r=review();fault(r);expect(()=>validateGenerationConsent(r)).toThrow();
  });
  it('rejects a rehashed counterfeit funding package even with a matching HTTP request digest',()=>{
    const r=review(),source=r.mintSource!;source.funding[0].coinId='0x'+'aa'.repeat(32);
    const {packageId,...document}=source;source.packageId=sha256(toUtf8Bytes(canonicalizeJcs(document)));
    r.request.mintReviewId=source.packageId;r.requestDigest=sha256(toUtf8Bytes(canonicalConsent(r.request)));
    expect(getBytes(source.packageId).length).toBe(32);expect(()=>validateGenerationConsent(r)).toThrow();
  });
});
