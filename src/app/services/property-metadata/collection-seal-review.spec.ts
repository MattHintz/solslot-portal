import { CollectionWorkspace } from '../collection-api.service';
import { buildCollectionSealReview, sealCollectionId } from './collection-seal-review';
import { sealFixture } from './collection-seal-review.fixture';

describe('Exact collection sealing review', () => {
  it('describes any bound property and separates base economics, fees and unresolved facts', () => {
    const {item, workspace} = sealFixture();
    const review = buildCollectionSealReview(item, workspace);
    const value = (label: string) => review.fields.find(field => field.label === label)?.value;
    expect(review.workspace.dossier.title).toBe('Example House — Testnet Edition');
    expect(value('Target raise / recap')).toBe('USD 75,000.00');
    expect(value('Base amount per SmartDeed')).toBe('USD 3,000.00 before fee');
    expect(value('SmartDeed allocation')).toBe('25 planned SmartDeeds · 4% each');
    expect(value('Fee')).toBe('1%');
    expect(value('FSRE terms')).toBe('15% participation based on market value');
    expect(value('Outside term')).toBe('14 months');
    expect(value('Projected timing')).toBe('10–12 months (projection)');
    expect(value('To-be-built appraisal')).toContain('user-confirmed; report details unresolved');
    expect(value('Builder')).toBe('Not appointed');
    expect(JSON.stringify(review.fields)).not.toContain('PRIVATE TITLE');
  });

  for (const change of [
    (w: CollectionWorkspace) => { w.id = 'OTHER'; },
    (w: CollectionWorkspace) => { w.dossier.collectionId = 'OTHER'; },
    (w: CollectionWorkspace) => { w.revision++; },
    (w: CollectionWorkspace) => { w.dossier.revision++; },
    (w: CollectionWorkspace) => { w.generationId = 'OTHER'; },
    (w: CollectionWorkspace) => { w.readiness.ready = false; },
    (w: CollectionWorkspace) => { w.readiness.metadataRoot = null; },
    (w: CollectionWorkspace) => { w.state = 'SEALED'; },
  ]) {
    it('refuses mismatched, unavailable or already changed property evidence', () => {
      const {item, workspace} = sealFixture(); change(workspace);
      expect(() => buildCollectionSealReview(item, workspace)).toThrowError();
    });
  }

  it('never treats a test-only edition as production', () => {
    const {item, workspace} = sealFixture(); item.network = 'mainnet';
    expect(() => buildCollectionSealReview(item, workspace)).toThrowError(/network and generation/);
  });

  it('rejects ambiguous request paths, methods, queries, bodies and revisions', () => {
    for (const binding of [
      {path: '/admin/collections/OTHER/amendments'}, {method: 'GET'}, {ifMatch: '"14"'},
      {query: [['override', '1']]}, {body: {title: 'Different property'}}, {body: []},
    ]) {
      const {item} = sealFixture(); Object.assign(item.requestBinding, binding);
      expect(sealCollectionId(item)).toBeNull();
    }
  });

  it('does not invent zero amounts or equal prices for mixed allocations', () => {
    const {item, workspace} = sealFixture();
    delete workspace.dossier.offering!.targetRaiseMinor;
    delete workspace.dossier.offering!.royaltyBps;
    workspace.dossier.deedAllocation[0].sharePpm = 20000;
    const review = buildCollectionSealReview(item, workspace);
    expect(review.fields.find(field => field.label === 'Target raise / recap')?.value).toBe('Not supplied');
    expect(review.fields.find(field => field.label === 'Fee')?.value).toBe('Not supplied');
    expect(review.fields.find(field => field.label === 'Base amount per SmartDeed')?.value).toBe('See individual allocations in preview');
  });

  it('explains the exact treasury correction but never applies that claim to later edits', () => {
    const {item,workspace}=sealFixture();
    workspace.dossier.offering!.royaltyPuzhash='0x'+'af'.repeat(32);
    workspace.retainedSeals=[{revision:12,metadataRoot:'0x'+'ac'.repeat(32),canonicalByteSize:100,sealedAt:1,
      correction:{nextRevision:13,previousTreasury:'0x'+'ad'.repeat(32),treasury:workspace.dossier.offering!.royaltyPuzhash,correctedAt:2}}];
    const fields=buildCollectionSealReview(item,workspace).fields;
    expect(fields.find(f=>f.label==='Fee destination · protocol treasury')?.value).toBe(workspace.dossier.offering!.royaltyPuzhash);
    expect(fields.find(f=>f.label==='Change since the previous seal')?.value).toContain('Fee rate, dollar terms, saved price and files are unchanged');
    workspace.retainedSeals[0].correction.nextRevision=12;
    expect(buildCollectionSealReview(item,workspace).fields.some(f=>f.label==='Change since the previous seal')).toBeFalse();
  });

  it('can read a completed seal only from that exact sealed revision', () => {
    const {item, workspace} = sealFixture(); item.status = 'consumed'; workspace.state = 'SEALED';
    workspace.metadataRoot = workspace.readiness.metadataRoot;
    expect(buildCollectionSealReview(item, workspace).metadataRoot).toBe(workspace.metadataRoot!);
    workspace.revision++;
    expect(() => buildCollectionSealReview(item, workspace)).toThrowError(/revision/);
  });
});
