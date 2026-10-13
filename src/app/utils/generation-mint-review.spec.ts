import { sha256,toUtf8Bytes } from 'ethers';
import { environment } from '../../environments/environment';
import { canonicalizeJcs } from '../services/property-metadata/property-metadata.service';
import { GenerationMintReview,validateMintReview } from './generation-mint-review';
import fixture from './generation-mint-review.fixture.json';

describe('Native sealed batch review reconstruction',()=>{
  let original:string|undefined;
  const protocol=environment.solslotProtocol as typeof environment.solslotProtocol & {generationId?:string};
  beforeEach(()=>{original=protocol.generationId;protocol.generationId=fixture.generationId;});
  afterEach(()=>protocol.generationId=original);
  const review=()=>structuredClone(fixture) as GenerationMintReview;
  function recommit(r:GenerationMintReview):void {const {packageId,...document}=r;r.packageId=sha256(toUtf8Bytes(canonicalizeJcs(document)));}
  it('checks the native 25-deed edition, bill, sealed economics and fixed launcher IDs',()=>{
    const r=validateMintReview(review());expect(r.funding.length).toBe(25);expect(r.publicationReady).toBeFalse();
    expect(r.canonicalMetadata.offering.targetRaiseMinor).toBe('7500000');expect(r.purpose).toBe('TEST_ONLY');
  });
  const faults:Record<string,(r:any)=>void>={
    'old generation':r=>r.generationId='0x'+'ff'.repeat(32),
    'production purpose':r=>r.purpose='PRODUCTION',
    'unimplemented publication enabled':r=>r.publicationReady=true,
    'missing funding':r=>r.funding.pop(),
    'duplicate parent':r=>r.funding[1]=r.funding[0],
    'different parent':r=>r.funding[0].coinId='0x'+'ff'.repeat(32),
    'different funding amount':r=>r.funding[0].coin.amount++,
    'predicted launcher changed':r=>r.funding[0].launcherId='0x'+'ff'.repeat(32),
    'unconfirmed parent':r=>r.funding[0].confirmedHeight=0,
    'different revision':r=>r.request.revision++,
    'different preview':r=>r.request.previewHash='0x'+'ff'.repeat(32),
    'different bill':r=>r.billHash='0x'+'ff'.repeat(32),
    'different collection':r=>r.collectionCommitment='0x'+'ff'.repeat(32),
    'different edition':r=>r.editionHash='0x'+'ff'.repeat(32),
    'different metadata':r=>r.canonicalMetadata.summary='Silently rewritten',
    'private references exposed':r=>r.canonicalMetadata.privateDocuments=[],
    'hidden allocation':r=>r.canonicalMetadata.deedAllocation.pop(),
    'wrong royalty':r=>r.canonicalMetadata.offering.royaltyBps='99',
  };
  for(const [fault,change] of Object.entries(faults))it('rejects '+fault+' even with a recomputed package checksum',()=>{
    const r=review();change(r);recommit(r);expect(()=>validateMintReview(r)).toThrow();
  });
  it('retains a detached immutable review after API objects change',()=>{
    const source=review(),checked=validateMintReview(source);source.funding.pop();expect(checked.funding.length).toBe(25);
  });
});
