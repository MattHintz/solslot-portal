import { AdminOperationApproval } from '../admin-operation-approval.service';
import { CollectionWorkspace } from '../collection-api.service';

export interface CollectionSealReview {
  operationId: string;
  payloadHash: string;
  metadataRoot: string;
  workspace: CollectionWorkspace;
  fields: Array<{ label: string; value: string }>;
}

/** A seal signs a collection ID and exact If-Match revision, not a free-form title.
 * Never substitute the latest draft for the revision named by the request. */
export function sealCollectionId(item: AdminOperationApproval): string | null {
  const binding = item.requestBinding;
  const match = /^\/admin\/collections\/([A-Za-z0-9_-]+)\/seal$/.exec(binding.path);
  return item.operation === 'collection.seal' && binding.method === 'POST' && match &&
    Number.isSafeInteger(item.revision) && item.revision > 0 &&
    binding.ifMatch === `"${item.revision}"` && binding.query.length === 0 &&
    !!binding.body && typeof binding.body === 'object' && !Array.isArray(binding.body) &&
    Object.keys(binding.body).length === 0 ? match[1] : null;
}

export function buildCollectionSealReview(item: AdminOperationApproval, workspace: CollectionWorkspace): CollectionSealReview {
  const id = sealCollectionId(item);
  const draft = workspace.dossier;
  if (!id || workspace.id !== id || draft.collectionId !== id ||
      workspace.revision !== item.revision || draft.revision !== item.revision) {
    throw new Error('This request no longer matches the saved property revision. Ask the preparer for a new approval.');
  }
  const testOnly = draft.purpose === 'TEST_ONLY';
  if (testOnly && (item.network !== 'testnet11' || draft.network !== 'testnet11' ||
      !workspace.generationId || workspace.generationId !== draft.generationId)) {
    throw new Error('The test edition does not match this approval’s network and generation.');
  }
  const consumed = item.sealExecution?.state === 'confirmed' ||
    (item.status === 'consumed' && item.sealExecution?.state !== 'retry_required');
  const root = consumed ? workspace.metadataRoot : workspace.readiness.metadataRoot;
  if (!draft.title?.trim() || !root || !/^0x[0-9a-f]{64}$/i.test(root) ||
      (!consumed && (!['DRAFT', 'REVIEW'].includes(workspace.state) || !workspace.readiness.ready)) ||
      (consumed && !['SEALED', 'PUBLISHED'].includes(workspace.state))) {
    throw new Error('The complete property review is unavailable or its checks have changed. Open the property review before signing.');
  }
  const team = draft.projectTeam;
  const offering = draft.offering;
  const address = draft.property?.address;
  const allocation = draft.deedAllocation;
  const equalShare = allocation.length > 0 && allocation.every(deed => deed.sharePpm === allocation[0].sharePpm)
    ? allocation[0].sharePpm : undefined;
  const terms = draft.fsreTerms;
  const correction = workspace.retainedSeals?.find(seal =>
    seal.correction.nextRevision === workspace.revision && seal.correction.treasury === offering?.royaltyPuzhash);
  const fields = [
    { label: 'Property', value: [address?.line1, address?.line2, address?.city, address?.region,
      address?.postalCode, address?.country].filter(Boolean).join(', ') || 'Not supplied' },
    { label: 'Sponsor', value: team?.sponsor.legalName || 'Not supplied' },
    { label: 'Builder', value: team?.builderStatus === 'not-appointed' ? 'Not appointed' :
      team?.builderStatus === 'not-applicable' ? 'Not applicable' :
      (team?.builderIsSponsor ? team.sponsor.legalName : team?.builder?.legalName) || 'Not supplied' },
    { label: 'Jurisdiction', value: offering?.jurisdiction || 'Not supplied' },
    { label: 'Target raise / recap', value: minorMoney(offering?.targetRaiseMinor, offering?.currency) },
    { label: 'SmartDeed allocation', value: `${allocation.length} planned SmartDeeds${equalShare === undefined ?
      ' · individual allocations in preview' : ` · ${equalShare / 10_000}% each`}` },
    { label: 'Base amount per SmartDeed', value: allocationAmount(offering?.targetRaiseMinor, offering?.currency, equalShare) },
    { label: 'Fee', value: basisPoints(offering?.royaltyBps) },
    { label: 'Fee destination · protocol treasury', value: offering?.royaltyPuzhash || 'Not supplied' },
    ...(correction ? [{ label: 'Change since the previous seal', value:
      `Fee destination corrected for this protocol generation. Fee rate, dollar terms, saved price and files are unchanged. Sealed revision ${correction.revision} is retained; this revision requires fresh approval.` }] : []),
    { label: terms ? 'FSRE terms' : 'Projected return', value: terms ?
      `${basisPoints(terms.participationBps)} participation based on market value` : basisPoints(offering?.projectedReturnBps) },
    { label: 'Outside term', value: months(terms?.outsideTermMonths ?? offering?.termMonths) },
    { label: 'Projected timing', value: terms?.projectedMonthsMin !== undefined && terms.projectedMonthsMax !== undefined
      ? `${terms.projectedMonthsMin}–${terms.projectedMonthsMax} months (projection)` : 'Not supplied' },
    { label: draft.valuationBasis === 'TO_BE_BUILT' ? 'To-be-built appraisal' : 'Valuation',
      value: `${minorMoney(draft.valuation?.marketValueMinor, draft.valuation?.currency)}${
        draft.valuationEvidence === 'USER_CONFIRMED' ? ' · user-confirmed; report details unresolved' : ''}` },
    { label: 'Public preview assets', value: `${draft.media.length} images/media · ${draft.documents.length} documents` },
    { label: 'Private originals', value: `${draft.privateDocuments.length} retained privately; excluded from public metadata` },
  ];
  return { operationId: item.operationId, payloadHash: item.payloadHash, metadataRoot: root, workspace, fields };
}

function minorMoney(value?: string, currency?: string): string {
  if (!value || !/^\d+$/.test(value) || !currency) return 'Not supplied';
  const minor = BigInt(value);
  return `${currency} ${(minor / 100n).toLocaleString('en-US')}.${String(minor % 100n).padStart(2, '0')}`;
}

function allocationAmount(target: string | undefined, currency: string | undefined, share: number | undefined): string {
  if (!target || !/^\d+$/.test(target) || share === undefined || !Number.isSafeInteger(share)) return 'See individual allocations in preview';
  const numerator = BigInt(target) * BigInt(share);
  return numerator % 1_000_000n === 0n ? `${minorMoney(String(numerator / 1_000_000n), currency)} before fee` : 'See individual allocations in preview';
}

function basisPoints(value?: string | number): string {
  return value !== undefined && /^\d+$/.test(String(value)) ? `${Number(value) / 100}%` : 'Not supplied';
}

function months(value?: string | number): string {
  return value !== undefined && /^\d+$/.test(String(value)) ? `${value} months` : 'Not supplied';
}
