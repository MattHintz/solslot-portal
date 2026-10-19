import fixture from './generation-final-launch.fixture.json';
import {FinalLaunchStatus} from '../services/generation-final-launch.service';
import {consentLabel,launchDeadline,launchInstructions,requireSharedLaunchReview} from './launch-coordination';

describe('Exact shared launch coordination',()=>{
  const review=()=>structuredClone(fixture).review as unknown as NonNullable<FinalLaunchStatus['review']>;
  it('uses the earlier operational deadline rather than overstating the signing window',()=>{
    const r=review();r.releaseExpiresAt=r.expiresAt-300;
    expect(launchDeadline(r)).toBe(r.releaseExpiresAt);
    expect(launchInstructions(r,'https://solslot.com/genesis-admin/next/')).toContain(new Date(r.releaseExpiresAt*1000).toISOString());
  });
  it('shares only the exact review and generation, without invitation or authentication parameters',()=>{
    const r=review(),text=launchInstructions(r,'https://solslot.com/genesis-admin/next/?invite=private-value#private-fragment');
    const url=new URL(text.split('\n')[0]);
    expect(url.pathname).toBe('/genesis-admin/next/admin/genesis');
    expect(url.searchParams.get('review')).toBe(r.reviewId);
    expect(url.searchParams.get('generation')).toBe(r.generationId);
    expect(text).not.toContain('private-value');expect(text).not.toContain('private-fragment');
    expect(()=>requireSharedLaunchReview(url.href,r)).not.toThrow();
  });
  it('rejects stale, foreign, incomplete and duplicate review selectors',()=>{
    const r=review(),base='https://solslot.com/genesis-admin/next/?';
    for(const query of [`review=${r.reviewId}`,`generation=${r.generationId}`,
      `review=stale&generation=${r.generationId}`,`review=${r.reviewId}&generation=foreign`,
      `review=${r.reviewId}&review=${r.reviewId}&generation=${r.generationId}`]) {
      expect(()=>requireSharedLaunchReview(base+query,r)).toThrowError(/different review/);
    }
    expect(()=>requireSharedLaunchReview(base+`review=${r.reviewId}&generation=${r.generationId}`,null)).toThrow();
  });
  it('allows normal setup navigation without a shared-review selector',()=>{
    expect(()=>requireSharedLaunchReview('https://solslot.com/genesis-admin/next/',null)).not.toThrow();
  });
  it('does not tell a third administrator to sign after owner-plus-one is complete',()=>{
    const r=review();r.approvedSlots=[1,2];
    expect(consentLabel(r,3)).toBe('No further signature required');
    r.approvedSlots=[2,3];expect(consentLabel(r,1)).toBe('Owner consent required');
  });
  it('distinguishes confirmed grants from consent history for every recipient',()=>{
    const r=review();r.launchComplete=true;r.approvedSlots=[1,2];
    for(const slot of [1,2,3])expect(consentLabel(r,slot)).toBe('10,000 SGT issued · confirmed');
  });
});
