import type {FinalLaunchReview} from '../services/generation-final-launch.service';

/** A shared link selects a review for comparison, never for authorization. */
export function requireSharedLaunchReview(url: string, review: FinalLaunchReview | null): void {
  const query = new URL(url).searchParams;
  if (!query.has('review') && !query.has('generation')) return;
  if (query.getAll('review').length !== 1 || query.getAll('generation').length !== 1 ||
      !review || query.get('review') !== review.reviewId || query.get('generation') !== review.generationId) {
    throw new Error('This shared launch link is for a different review. Open Setup & launch to review the current release. No signature was requested.');
  }
}

export function launchDeadline(review: FinalLaunchReview): number {
  return Math.min(review.expiresAt, review.releaseExpiresAt);
}

export function launchInstructions(review: FinalLaunchReview, baseURI: string): string {
  const url = new URL('admin/genesis', baseURI);
  url.searchParams.set('generation', review.generationId);
  url.searchParams.set('review', review.reviewId);
  url.hash = 'final-generation-title';
  return [url.href, '',
    'Sign in with your enrolled administrator wallet. Under “Review the launch together,” review all three 10,000-SGT destinations and the exact release.',
    'If your consent is required, click “Open administrator wallet · approve launch” and sign the request in your wallet.',
    'Only the owner and one coadministrator are required. If the page says consent is complete, no additional signature is needed.',
    'This signature records consent only; it sends no transaction. The owner submits the saved launch separately.',
    'Complete before '+new Date(launchDeadline(review)*1000).toISOString()+' (UTC).',
    'Exact review: '+review.reviewId].join('\n');
}

export function consentLabel(review: FinalLaunchReview, slot: number): string {
  if (review.launchComplete) return '10,000 SGT issued · confirmed';
  if (review.approvedSlots.includes(slot)) return 'Launch consent approved';
  if (review.approvedSlots.includes(1) && review.approvedSlots.some(n => n === 2 || n === 3)) {
    return 'No further signature required';
  }
  return slot === 1 ? 'Owner consent required' : 'One coadministrator can approve';
}
