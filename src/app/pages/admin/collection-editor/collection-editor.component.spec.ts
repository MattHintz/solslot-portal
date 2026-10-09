import { HttpErrorResponse } from '@angular/common/http';
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
    api = jasmine.createSpyObj('CollectionApiService', ['update', 'convertDisplayUnits', 'seal', 'getPresale']);
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

  it('caches an absent presale until its bounded expiry', async () => {
    api.getPresale.and.rejectWith(new HttpErrorResponse({status:404}));
    expect(await (editor as any).loadPresale('COL-TEST')).toBeNull();
    expect(await (editor as any).loadPresale('COL-TEST')).toBeNull();
    expect(api.getPresale).toHaveBeenCalledTimes(1);
    (editor as any).absentPresale.until = 0;
    await (editor as any).loadPresale('COL-TEST');
    expect(api.getPresale).toHaveBeenCalledTimes(2);
  });
  it('does not cache a service outage as an absent presale', async () => {
    api.getPresale.and.rejectWith(new HttpErrorResponse({status:503}));
    await expectAsync((editor as any).loadPresale('COL-TEST')).toBeRejected();
    await expectAsync((editor as any).loadPresale('COL-TEST')).toBeRejected();
    expect(api.getPresale).toHaveBeenCalledTimes(2);
  });

  it('keeps invalid numeric fields editable without calling conversion or save', async () => {
    editor.displayUnits.targetRaiseUsd = '$125,000';
    editor.changed();
    expect(await editor.saveNow()).toBeFalse();
    expect(api.convertDisplayUnits).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(editor.saveError()).toContain('Target raise');
    expect(editor.displayUnits.targetRaiseUsd).toBe('$125,000');
  });
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

  for (const detail of [
    'SOLSLOT_PAYMENT_ORACLE_ROUNDS_PATH is not configured',
    'payment oracle snapshot is unavailable',
    'payment oracle snapshot cannot be read',
    'no live, quorum-authorized oracle round exists for this asset',
  ]) {
    it(`saves dollar values without stale par when ${detail}`, async () => {
      collection.dossier.offering = { targetRaiseMinor: '1000000', parValueMojos: '123' };
      collection.dossier.deedAllocation = [
        { deedId: 'A', sharePpm: 500000, parValueMojos: '61' },
        { deedId: 'B', sharePpm: 500000, parValueMojos: '62' },
      ];
      (editor as any).applyWorkspace(collection);
      api.convertDisplayUnits.and.callFake(async request => {
        if (request.deriveXchPar) throw new HttpErrorResponse({status:422,error:{detail}});
        return {
          moneyMinor: { targetRaise: '7500000' }, percentageBps: {projectedReturn:'1500'},
          ownershipPpm: {'deed.0':500000,'deed.1':500000}, governanceQuorum:'500000',
          xchParMojos:null, xchOracle:null,
        };
      });
      api.update.and.callFake(async (_id, dossier) => ({
        ...collection, state:'DRAFT', revision:8, dossier,
        readiness:{ready:false,issues:[{code:'DOSSIER_INVALID',path:'/offering/parValueMojos',message:'Field required'}]},
      } as CollectionWorkspace));
      editor.displayUnits.targetRaiseUsd = '75000';
      editor.changed();
      expect(await editor.saveNow()).toBeTrue();
      const saved = api.update.calls.mostRecent().args[1];
      expect(saved.offering!.targetRaiseMinor).toBe('7500000');
      expect(saved.offering!.projectedReturnBps).toBe('1500');
      expect(saved.offering!.parValueMojos).toBeUndefined();
      expect(saved.deedAllocation.every(deed => deed.parValueMojos === undefined)).toBeTrue();
      expect(editor.pricingPending()).toBeTrue();
      expect(editor.saveState()).toBe('saved');
      expect(api.convertDisplayUnits.calls.allArgs().map(args => args[0].deriveXchPar)).toEqual([true,false]);
      await editor.saveNow(false,true);
      expect(api.convertDisplayUnits).toHaveBeenCalledTimes(2);
      expect(api.update).toHaveBeenCalledTimes(1);
    });
  }

  for (const error of [
    new HttpErrorResponse({status:422,error:{detail:'oracle signature verification failed'}}),
    new HttpErrorResponse({status:422,error:{detail:'payment oracle snapshot is invalid JSON'}}),
    new HttpErrorResponse({status:401,error:{detail:'SOLSLOT_PAYMENT_ORACLE_ROUNDS_PATH is not configured'}}),
    new HttpErrorResponse({status:0}),
  ]) {
    it(`does not reinterpret unrelated conversion failures as pending pricing (${error.status}: ${error.error?.detail || 'network'})`, async () => {
      api.convertDisplayUnits.and.rejectWith(error);
      editor.displayUnits.targetRaiseUsd = '75000';
      editor.changed();
      expect(await editor.saveNow()).toBeFalse();
      expect(api.convertDisplayUnits).toHaveBeenCalledTimes(1);
      expect(api.update).not.toHaveBeenCalled();
      expect(editor.saveState()).toBe('error');
      expect(editor.displayUnits.targetRaiseUsd).toBe('75000');
    });
  }

  it('does not save when the fallback server conversion fails its signed rules check', async () => {
    api.convertDisplayUnits.and.callFake(async request => {
      throw new HttpErrorResponse({status:request.deriveXchPar ? 422 : 503,error:{detail:request.deriveXchPar
        ? 'SOLSLOT_PAYMENT_ORACLE_ROUNDS_PATH is not configured' : 'Signed genesis economics are not available yet.'}});
    });
    editor.displayUnits.targetRaiseUsd = '75000';
    editor.changed();
    expect(await editor.saveNow()).toBeFalse();
    expect(api.update).not.toHaveBeenCalled();
    expect(editor.saveError()).toContain('Signed genesis economics');
  });

  it('blocks sealing a saved dollar-only draft even if a stale readiness response says ready', async () => {
    collection.dossier.offering = {targetRaiseMinor:'7500000'};
    (editor as any).applyWorkspace(collection);
    await editor.seal();
    expect(api.seal).not.toHaveBeenCalled();
    expect(editor.sealError()).toContain('signed XCH price feed');
    expect(editor.activeSection()).toBe('economics');
  });

  it('refreshes pricing explicitly and requires review of the newly priced revision', async () => {
    collection.dossier.offering = {targetRaiseMinor:'7500000'};
    (editor as any).applyWorkspace(collection);
    api.convertDisplayUnits.and.resolveTo({
      moneyMinor:{targetRaise:'7500000'},percentageBps:{},ownershipPpm:{},governanceQuorum:'500000',
      xchParMojos:{collection:'3000000000000000',deeds:{}},
      xchOracle:{priceUsdMinorPerXch:'2500',validUntil:2000000000,roundHash:'0x'+'a'.repeat(64)},
    });
    api.update.and.callFake(async (_id,dossier) => ({
      ...collection,revision:8,dossier,readiness:{ready:false,issues:[{
        code:'INDEPENDENT_REVIEW_REQUIRED',path:'/review',message:'Approve revision 8',
      }]},
    } as CollectionWorkspace));
    await editor.refreshPricing();
    expect(editor.pricingPending()).toBeFalse();
    expect(api.convertDisplayUnits).toHaveBeenCalledTimes(1);
    expect(api.update.calls.mostRecent().args[1].offering!.parValueMojos).toBe('3000000000000000');
    await editor.seal();
    expect(api.seal).not.toHaveBeenCalled();
    expect(editor.sealError()).toContain('changed fields need approval');
  });
});
