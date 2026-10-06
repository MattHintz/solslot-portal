import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { AdminSessionService } from '../../../services/admin-session.service';
import { AdminStatusRefresh } from '../../../services/admin-status-refresh.service';
import { CollectionApiService, CollectionWorkspace } from '../../../services/collection-api.service';
import { CollectionMintCoordinatorService } from '../../../services/collection-mint-coordinator.service';
import { PropertyAmendmentService } from '../../../services/property-amendment.service';
import { CollectionEditorComponent } from './collection-editor.component';

describe('CollectionEditor reviewed revision', () => {
  let editor: CollectionEditorComponent;
  let api: jasmine.SpyObj<CollectionApiService>;
  let collection: CollectionWorkspace;

  beforeEach(() => {
    api = jasmine.createSpyObj('CollectionApiService', ['update', 'convertDisplayUnits', 'seal']);
    collection = {
      id: 'COL-TEST', state: 'REVIEW', revision: 7,
      dossier: {
        schemaVersion: 'solslot.property-dossier.v1', collectionId: 'COL-TEST', revision: 7,
        title: 'Reviewed property', offering: { parValueMojos: '123' },
        media: [], documents: [], privateDocuments: [], risks: [], history: [],
        disclosures: [], dataSources: [], diligence: [], deedAllocation: [],
      },
      readiness: { ready: true, issues: [] },
    } as unknown as CollectionWorkspace;
    TestBed.configureTestingModule({ providers: [
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'COL-TEST' } } } },
      { provide: CollectionApiService, useValue: api },
      { provide: AdminSessionService, useValue: { isAuthenticated: () => true } },
      { provide: AdminStatusRefresh, useValue: { start: () => undefined } },
      { provide: CollectionMintCoordinatorService, useValue: { trustedProtocolTreasuryPuzzleHash: () => null } },
      { provide: PropertyAmendmentService, useValue: {} },
    ] });
    editor = TestBed.runInInjectionContext(() => new CollectionEditorComponent());
    (editor as unknown as { applyWorkspace(value: CollectionWorkspace): void }).applyWorkspace(collection);
    api.seal.and.resolveTo({ ...collection, state: 'SEALED' });
  });

  afterEach(() => editor.ngOnDestroy());

  it('skips PUT and oracle conversion for repeated clean forced saves', async () => {
    expect(await editor.saveNow(false, true)).toBeTrue();
    expect(await editor.saveNow(false, true)).toBeTrue();
    expect(api.update).not.toHaveBeenCalled();
    expect(api.convertDisplayUnits).not.toHaveBeenCalled();
    expect(editor.workspace()!.revision).toBe(7);
  });

  it('seals the exact reviewed revision without a preliminary save or repricing', async () => {
    await editor.seal();
    expect(api.update).not.toHaveBeenCalled();
    expect(api.convertDisplayUnits).not.toHaveBeenCalled();
    expect(api.seal).toHaveBeenCalledOnceWith('COL-TEST', 7);
    expect(editor.workspace()!.state).toBe('SEALED');
  });

  it('submits clean content for review without adding form defaults or converting par', async () => {
    editor.workspace.set({ ...collection, state: 'DRAFT' });
    api.update.and.resolveTo(collection);
    await editor.submitForReview();
    expect(api.convertDisplayUnits).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledOnceWith('COL-TEST', collection.dossier, 7, true);
    await editor.submitForReview();
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it('saves genuine edits and stops before wallet sealing when a new review is required', async () => {
    api.convertDisplayUnits.and.resolveTo({
      moneyMinor: {}, percentageBps: {}, ownershipPpm: {}, governanceQuorum: '5000',
      xchParMojos: null, xchOracle: null,
    });
    api.update.and.resolveTo({
      ...collection, revision: 8,
      readiness: { ...collection.readiness, ready: false, issues: [{
        code: 'INDEPENDENT_REVIEW_REQUIRED', path: '/review', message: 'Approve revision 8',
      }] },
    });
    editor.draftModel!.summary = 'Edited project scope';
    editor.changed();
    await editor.seal();
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.convertDisplayUnits).toHaveBeenCalledTimes(1);
    expect(api.seal).not.toHaveBeenCalled();
    expect(editor.sealError()).toContain('changed fields need approval');
  });
});
