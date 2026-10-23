import { HttpErrorResponse } from '@angular/common/http';
import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
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
    api = jasmine.createSpyObj('CollectionApiService', ['update', 'convertDisplayUnits', 'seal', 'getPresale', 'applyTestPricing', 'get', 'featureStatus', 'profiles', 'createPresale', 'cancelPresale']);
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
      { provide: AdminSessionService, useValue: { isAuthenticated: () => true, subject: () => 'owner' } },
      { provide: AdminStatusRefresh, useValue: { start: () => undefined } },
      { provide: CollectionMintCoordinatorService, useValue: { trustedProtocolTreasuryPuzzleHash: () => null } },
      { provide: PropertyAmendmentService, useValue: {} },
    ] });
    editor = TestBed.runInInjectionContext(() => new CollectionEditorComponent());
    (editor as unknown as { applyWorkspace(value: CollectionWorkspace): void }).applyWorkspace(collection);
    api.seal.and.resolveTo({ ...collection, state: 'SEALED' });
  });

  afterEach(() => editor.ngOnDestroy());

  function arrangeReload(state: CollectionWorkspace['state'] = 'DRAFT'): void {
    collection = {...collection, state, ownerSubject: 'owner', deeds: [], metadataVersions: []} as CollectionWorkspace;
    api.get.and.resolveTo(collection);
    api.featureStatus.and.resolveTo({metadataEnabled: true} as any);
    api.profiles.and.resolveTo({} as any);
    editor.workspace.set(null);
    editor.draftModel = null;
    editor.loading.set(true);
  }

  for (const state of ['DRAFT', 'REVIEW', 'SEALED'] as const) {
    it(`opens a ${state} property without requesting unavailable reservations or creating a revision`, async () => {
      arrangeReload(state);
      api.getPresale.and.rejectWith(new HttpErrorResponse({status: 403, error: '<html>Forbidden</html>'}));
      await editor.reload();
      expect(editor.workspace()?.id).toBe('COL-TEST');
      expect(editor.loadError()).toBeNull();
      expect(editor.loading()).toBeFalse();
      expect(api.getPresale).not.toHaveBeenCalled();
      expect(api.update).not.toHaveBeenCalled();
      expect(api.convertDisplayUnits).not.toHaveBeenCalled();
    });
  }

  it('shows the published property before a slow reservation response arrives', fakeAsync(() => {
    arrangeReload('PUBLISHED');
    let reject!: (error: unknown) => void;
    api.getPresale.and.returnValue(new Promise((_resolve, fail) => reject = fail));
    const done = jasmine.createSpy('reload resolved');
    editor.reload().then(done);
    flushMicrotasks();
    expect(editor.workspace()?.id).toBe('COL-TEST');
    expect(editor.loading()).toBeFalse();
    expect(editor.presaleBusy()).toBeTrue();
    expect(editor.presaleStatusLoaded()).toBeFalse();
    reject(new HttpErrorResponse({status: 503}));
    flushMicrotasks();
    expect(done).toHaveBeenCalled();
    expect(editor.loadError()).toBeNull();
    expect(editor.presaleError()).toContain('Reservation status is unavailable');
  }));

  for (const status of [0, 401, 403, 503]) {
    it(`keeps property access but disables reservation writes after a ${status} reservation failure`, async () => {
      arrangeReload('PUBLISHED');
      api.getPresale.and.rejectWith(new HttpErrorResponse({status, error: '<html>Unavailable</html>'}));
      await editor.reload();
      expect(editor.workspace()?.id).toBe('COL-TEST');
      expect(editor.loadError()).toBeNull();
      expect(editor.presaleError()).not.toContain('<html>');
      expect(editor.presaleStatusLoaded()).toBeFalse();
      await editor.createPresale();
      expect(api.createPresale).not.toHaveBeenCalled();
      expect(editor.canLaunchPresale({} as any)).toBeFalse();
    });
  }

  it('retries failed reservations without duplicating in-flight reads and only enables actions after success', async () => {
    arrangeReload('PUBLISHED');
    api.getPresale.and.rejectWith(new HttpErrorResponse({status: 403}));
    await editor.reload();
    let finish!: (error: unknown) => void;
    api.getPresale.and.returnValue(new Promise((_resolve, reject) => finish = reject));
    const retry = editor.refreshPresale();
    await editor.refreshPresale();
    expect(api.getPresale).toHaveBeenCalledTimes(2);
    finish(new HttpErrorResponse({status: 404}));
    await retry;
    expect(editor.presaleStatusLoaded()).toBeTrue();
    expect(editor.presaleError()).toBeNull();
    expect(editor.presale()).toBeNull();
  });

  it('does not hide an authentication failure on the property itself', async () => {
    arrangeReload();
    api.get.and.rejectWith(new HttpErrorResponse({status: 401}));
    await expectAsync(editor.reload()).toBeRejected();
    expect(editor.workspace()).toBeNull();
    expect(editor.loadError()).toContain('Sign in again');
    expect(api.getPresale).not.toHaveBeenCalled();
  });

  function testEdition(): void {
    collection.ownerSubject = 'owner';
    collection.dossier.purpose = 'TEST_ONLY';
    collection.dossier.schemaVersion = 'solslot.testnet-property-dossier.v1';
    collection.dossier.pricingRoundHash = '0x'+'a1'.repeat(32);
    collection.dossier.offering = {targetRaiseMinor:'7500000',parValueMojos:'1000000',royaltyBps:'100'};
    collection.dossier.deedAllocation = [{deedId:'ONE',sharePpm:1000000,parValueMojos:'1000000'}];
    (editor as any).applyWorkspace(collection);
    api.convertDisplayUnits.and.callFake(async request => ({
      moneyMinor: {targetRaise: request.money['targetRaise'] === '80000' ? '8000000' : '7500000'},
      percentageBps: {technologyFee:'100'}, ownershipPpm:{'deed.0':1000000}, governanceQuorum:null,
      xchParMojos:null,xchOracle:null,
    }));
    api.update.and.callFake(async (_id,dossier) => ({...collection,revision:8,dossier}));
  }

  it('preserves test-edition pricing and its receipt when a note changes', async () => {
    testEdition();
    editor.draftModel!.summary = 'Clarified the project notes';
    editor.changed();
    expect(await editor.saveNow()).toBeTrue();
    expect(api.convertDisplayUnits.calls.mostRecent().args[0].deriveXchPar).toBeFalse();
    const saved=api.update.calls.mostRecent().args[1];
    expect(saved.offering!.parValueMojos).toBe('1000000');
    expect(saved.offering!.governanceQuorum).toBeUndefined();
    expect(saved.deedAllocation[0].parValueMojos).toBe('1000000');
    expect(saved.pricingRoundHash).toBe(collection.dossier.pricingRoundHash);
    expect(api.applyTestPricing).not.toHaveBeenCalled();
  });

  it('offers an unresolved declaration for every required test-edition property detail', () => {
    testEdition();
    const required: Record<string, string[]> = {
      valuation: ['asOfDate', 'currency', 'method', 'source'],
      capital: ['debtBalanceMinor', 'debtRateBps', 'currency'],
      operations: ['occupancyStatus', 'monthlyGrossRentMinor', 'annualOperatingExpenseMinor', 'currency'],
      legal: ['issuerLegalName', 'securityStructure', 'collateralSummary', 'filingStatus', 'transferPolicy'],
    };
    const paths = editor.unknownChoices().map(choice => choice.path);
    for (const [section, fields] of Object.entries(required)) {
      for (const field of fields) expect(paths).withContext(`${section}/${field}`).toContain(`/${section}/${field}`);
    }
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('saves an unknown appraisal method without inventing a method or changing signed pricing', async () => {
    testEdition();
    editor.addUnknown();
    const choice = editor.unknownChoices().find(item => item.label === 'Appraisal method')!;
    expect(choice).toBeDefined();
    editor.draftModel!.unknownFields![0] = {
      path: choice.path, status: 'UNKNOWN',
      reason: 'The appraisal method has not been verified from the controlling report.',
    };
    editor.changed();
    expect(await editor.saveNow()).toBeTrue();
    const saved = api.update.calls.mostRecent().args[1];
    expect(saved.unknownFields).toEqual(editor.draftModel!.unknownFields);
    expect(saved.valuation?.method).toBeUndefined();
    expect(saved.pricingRoundHash).toBe(collection.dossier.pricingRoundHash);
    expect(saved.offering?.parValueMojos).toBe('1000000');
    expect(saved.offering?.targetRaiseMinor).toBe('7500000');
    expect(api.applyTestPricing).not.toHaveBeenCalled();
    expect(api.convertDisplayUnits.calls.mostRecent().args[0].deriveXchPar).toBeFalse();
  });

  it('clears test-edition price commitments when the dollar economics change', async () => {
    testEdition();editor.displayUnits.targetRaiseUsd='80000';editor.changed();
    expect(await editor.saveNow()).toBeTrue();
    const saved=api.update.calls.mostRecent().args[1];
    expect(saved.offering!.targetRaiseMinor).toBe('8000000');
    expect(saved.offering!.parValueMojos).toBeUndefined();
    expect(saved.pricingRoundHash).toBeUndefined();
    expect(editor.pricingPending()).toBeTrue();
  });

  it('applies a test price explicitly once and prevents duplicate clicks while waiting', async () => {
    testEdition();
    let finish!: (value:CollectionWorkspace)=>void;
    api.applyTestPricing.and.returnValue(new Promise(resolve=>finish=resolve));
    const first=editor.refreshPricing();
    await editor.refreshPricing();
    expect(api.applyTestPricing).toHaveBeenCalledOnceWith(collection);
    expect(editor.saveState()).toBe('saving');
    finish({...collection,revision:8});await first;
    expect(editor.saveState()).toBe('saved');
    expect(api.update).not.toHaveBeenCalled();
    expect(api.convertDisplayUnits).not.toHaveBeenCalled();
  });

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
  it('does not change metadata simply by displaying missing diligence', () => {
    const before = JSON.stringify(editor.draftModel);
    const previousSaveState = editor.saveState();
    expect(editor.diligenceValue('missing-title')).toBe('');
    expect(editor.diligenceDate('missing-title')).toBe('');
    expect(editor.diligenceUnit('missing-title')).toBe('');
    expect(JSON.stringify(editor.draftModel)).toBe(before);
    expect(editor.saveState()).toBe(previousSaveState);
  });

  it('preserves test-only scope and the single FSRE source through form saves', async () => {
    collection.dossier.schemaVersion = 'solslot.testnet-property-dossier.v1';
    collection.dossier.purpose = 'TEST_ONLY';
    collection.dossier.generationId = '0x'+'a1'.repeat(32);
    collection.dossier.fsreTerms = {structure:'FSRE', returnBasis:'MARKET_VALUE', participationBps:1500,
      outsideTermMonths:14, projectedMonthsMin:10, projectedMonthsMax:12};
    (editor as any).applyWorkspace(collection);
    api.convertDisplayUnits.and.resolveTo({moneyMinor:{targetRaise:'7500000'}, percentageBps:{projectedReturn:'1500'},
      ownershipPpm:{}, governanceQuorum:'500000', xchParMojos:null, xchOracle:null});
    api.update.and.callFake(async (_id, dossier) => ({...collection, dossier, revision:8}));
    editor.draftModel!.summary = 'Explicit test edition'; editor.changed();
    expect(await editor.saveNow()).toBeTrue();
    const saved = api.update.calls.mostRecent().args[1];
    expect(saved.schemaVersion).toBe('solslot.testnet-property-dossier.v1');
    expect(saved.generationId).toBe(collection.dossier.generationId);
    expect(saved.fsreTerms!.participationBps).toBe(1500);
    expect(saved.offering!.projectedReturnBps).toBeUndefined();
    expect(saved.offering!.governanceQuorum).toBeUndefined();
  });

  it('adds references for newly required canonical diligence only on a classification edit', () => {
    editor.draftModel!.purpose = 'TEST_ONLY';
    editor.draftModel!.classification = {assetClass:'RWA-RE-RES', projectStage:'ground-up', programOverlays:[]};
    editor.profiles.set({assetClasses:[{id:'RWA-RE-RES',subtypes:[]}],
      diligence:{common:['debt'],byAssetClass:{'RWA-RE-RES':['building-details']},
        byProjectStage:{'ground-up':['as-completed-valuation']},byProgramOverlay:{}}} as any);
    const previous = JSON.stringify(editor.draftModel);
    expect(editor.requiredDiligenceKeys()).toEqual(['as-completed-valuation','building-details','debt']);
    expect(editor.canonicalDiligenceSection('debt')).toBe('economics');
    expect(JSON.stringify(editor.draftModel)).toBe(previous);
    editor.classificationChanged();
    expect(editor.draftModel!.diligence).toEqual([
      {key:'as-completed-valuation',references:['/valuation','/valuationBasis','/valuationEvidence'],evidenceAssetIds:[]},
      {key:'building-details',references:['/property'],evidenceAssetIds:[]},
      {key:'debt',references:['/capital'],evidenceAssetIds:[]},
    ]);
    expect(editor.saveState()).toBe('dirty');
    editor.classificationChanged();
    expect(editor.draftModel!.diligence.length).toBe(3);
  });

  it('keeps conflicting diligence visible for validation instead of silently erasing it', () => {
    editor.draftModel!.purpose = 'TEST_ONLY';
    editor.draftModel!.classification = {assetClass:'RWA-RE-RES', projectStage:'ground-up', programOverlays:[]};
    editor.profiles.set({assetClasses:[{id:'RWA-RE-RES',subtypes:[]}],
      diligence:{common:['debt'],byAssetClass:{},byProjectStage:{},byProgramOverlay:{}}} as any);
    editor.draftModel!.diligence = [{key:'debt',value:'Conflicting copied value',evidenceAssetIds:[]}];
    editor.classificationChanged();
    expect(editor.draftModel!.diligence[0].value).toBe('Conflicting copied value');
    expect(editor.draftModel!.diligence[0].references).toBeUndefined();
  });

});
