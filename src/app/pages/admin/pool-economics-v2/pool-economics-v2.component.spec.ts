import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  PoolEconomicsV2ChainStateService,
  type PoolV2ChainStateEvidence,
} from '../../../services/pool-economics-v2-chain-state.service';
import {
  PoolEconomicsV2ComposeDryRunService,
  type PoolV2ComposeDryRunResult,
} from '../../../services/pool-economics-v2-compose-dry-run.service';
import {
  PoolEconomicsV2DeedWitnessService,
  type PoolV2DeedWitnessEvidence,
} from '../../../services/pool-economics-v2-deed-witness.service';
import {
  PoolEconomicsV2ExecutionRunnerService,
  type PoolV2ExecutionBundle,
  type PoolV2ExecutionKind,
} from '../../../services/pool-economics-v2-execution-runner.service';
import {
  PoolEconomicsV2SpendBuilderService,
  type PoolV2RequiredAnnouncement,
} from '../../../services/pool-economics-v2-spend-builder.service';
import {
  PoolEconomicsV2NavRegistryChainStateService,
  type CollectionNavRegistryEvidence,
} from '../../../services/pool-economics-v2-nav-registry-chain-state.service';
import {
  PoolEconomicsV2TokenAuthorizationService,
  type PoolV2TokenAuthorizationMaterial,
} from '../../../services/pool-economics-v2-token-authorization.service';
import { PoolEconomicsV2Component } from './pool-economics-v2.component';

describe('PoolEconomicsV2Component', () => {
  let fixture: ComponentFixture<PoolEconomicsV2Component>;
  let component: PoolEconomicsV2Component;
  let chainState: jasmine.SpyObj<Pick<PoolEconomicsV2ChainStateService, 'readCurrentState'>>;
  let composeDryRun: jasmine.SpyObj<
    Pick<
      PoolEconomicsV2ComposeDryRunService,
      'specificDeedSwap' | 'trueRedemption' | 'reserveAcquisition'
    >
  >;
  let executionRunner: jasmine.SpyObj<
    Pick<
      PoolEconomicsV2ExecutionRunnerService,
      | 'composeSpecificDeedSwap'
      | 'composeTrueRedemption'
      | 'composeReserveAcquisition'
      | 'submitSignaturelessBundle'
    >
  >;
  let spendBuilder: jasmine.SpyObj<
    Pick<
      PoolEconomicsV2SpendBuilderService,
      | 'buildSpecificDeedSwapCoinSpend'
      | 'buildTrueRedemptionCoinSpend'
      | 'buildReserveAcquisitionCoinSpend'
      | 'describePoolV2RequiredAnnouncements'
    >
  >;
  let navRegistry: jasmine.SpyObj<
    Pick<PoolEconomicsV2NavRegistryChainStateService, 'readCollectionNav'>
  >;
  let deedWitness: jasmine.SpyObj<
    Pick<PoolEconomicsV2DeedWitnessService, 'buildRedeemWitness' | 'buildDepositWitness'>
  >;
  let tokenAuthorization: jasmine.SpyObj<
    Pick<
      PoolEconomicsV2TokenAuthorizationService,
      'buildForAuthorization' | 'buildTokenAuthorizationCoinSpend'
    >
  >;

  beforeEach(async () => {
    chainState = jasmine.createSpyObj('PoolEconomicsV2ChainStateService', ['readCurrentState']);
    chainState.readCurrentState.and.resolveTo(confirmedEvidence());
    composeDryRun = jasmine.createSpyObj('PoolEconomicsV2ComposeDryRunService', [
      'specificDeedSwap',
      'trueRedemption',
      'reserveAcquisition',
    ]);
    composeDryRun.specificDeedSwap.and.returnValue(dryRunResult('specific-deed-swap', 6, 4, 3));
    composeDryRun.trueRedemption.and.returnValue(dryRunResult('true-redemption', 7, 4, 3));
    composeDryRun.reserveAcquisition.and.returnValue(dryRunResult('reserve-acquisition', 8, 5, 4));
    executionRunner = jasmine.createSpyObj('PoolEconomicsV2ExecutionRunnerService', [
      'composeSpecificDeedSwap',
      'composeTrueRedemption',
      'composeReserveAcquisition',
      'submitSignaturelessBundle',
    ]);
    executionRunner.composeSpecificDeedSwap.and.returnValue(executionBundle('specific-deed-swap', 6, 4, 3));
    executionRunner.composeTrueRedemption.and.returnValue(executionBundle('true-redemption', 7, 4, 3));
    executionRunner.composeReserveAcquisition.and.returnValue(executionBundle('reserve-acquisition', 8, 5, 4));
    executionRunner.submitSignaturelessBundle.and.resolveTo({ success: true, status: 'SUCCESS' });
    spendBuilder = jasmine.createSpyObj('PoolEconomicsV2SpendBuilderService', [
      'buildSpecificDeedSwapCoinSpend',
      'buildTrueRedemptionCoinSpend',
      'buildReserveAcquisitionCoinSpend',
      'describePoolV2RequiredAnnouncements',
    ]);
    spendBuilder.buildSpecificDeedSwapCoinSpend.and.returnValue(poolSpendBuild() as any);
    spendBuilder.buildTrueRedemptionCoinSpend.and.returnValue(poolSpendBuild() as any);
    spendBuilder.buildReserveAcquisitionCoinSpend.and.returnValue(poolSpendBuild() as any);
    spendBuilder.describePoolV2RequiredAnnouncements.and.returnValue(tokenSettlementRequirements());
    navRegistry = jasmine.createSpyObj('PoolEconomicsV2NavRegistryChainStateService', [
      'readCollectionNav',
    ]);
    navRegistry.readCollectionNav.and.resolveTo(confirmedNavEvidence());
    deedWitness = jasmine.createSpyObj('PoolEconomicsV2DeedWitnessService', [
      'buildRedeemWitness',
      'buildDepositWitness',
    ]);
    deedWitness.buildRedeemWitness.and.resolveTo(confirmedDeedWitness());
    deedWitness.buildDepositWitness.and.resolveTo(confirmedDepositDeedWitness());
    tokenAuthorization = jasmine.createSpyObj('PoolEconomicsV2TokenAuthorizationService', [
      'buildForAuthorization',
      'buildTokenAuthorizationCoinSpend',
    ]);
    tokenAuthorization.buildForAuthorization.and.returnValue(tokenTailMaterial());
    tokenAuthorization.buildTokenAuthorizationCoinSpend.and.returnValue(tokenCatSpendBuild() as any);

    await TestBed.configureTestingModule({
      imports: [PoolEconomicsV2Component],
      providers: [
        provideRouter([]),
        { provide: PoolEconomicsV2ChainStateService, useValue: chainState },
        { provide: PoolEconomicsV2ComposeDryRunService, useValue: composeDryRun },
        { provide: PoolEconomicsV2ExecutionRunnerService, useValue: executionRunner },
        { provide: PoolEconomicsV2SpendBuilderService, useValue: spendBuilder },
        { provide: PoolEconomicsV2NavRegistryChainStateService, useValue: navRegistry },
        { provide: PoolEconomicsV2DeedWitnessService, useValue: deedWitness },
        { provide: PoolEconomicsV2TokenAuthorizationService, useValue: tokenAuthorization },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PoolEconomicsV2Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads live Pool V2 chain evidence without applying it to manual inputs', () => {
    const text = pageText();

    expect(chainState.readCurrentState).toHaveBeenCalledTimes(1);
    expect(text).toContain('Live Pool Economic V2 state confirmed.');
    expect(text).toContain('V2_SPECIFIC_DEED_SWAP');
    expect(component.totalNavLockedMojosInput).toBe('1000000000');
  });

  it('applies confirmed chain state into the quote inputs on command', () => {
    component.applyChainState();
    fixture.detectChanges();

    expect(component.totalNavLockedMojosInput).toBe('900000000');
    expect(component.deedCountInput).toBe('3');
    expect(component.totalPoolTokenSupplyInput).toBe('1000000000');
    expect(component.treasuryReserveTokensInput).toBe('100000000');
  });

  it('renders separate swap, redemption, and acquisition economics', () => {
    const text = pageText();

    expect(text).toContain('Swap for deed');
    expect(text).toContain('Redeem and burn');
    expect(text).toContain('Reserve acquisition');
    expect(text).toContain('Buyer pays');
    expect(text).toContain('202,000,000');
    expect(text).toContain('Burn amount');
    expect(text).toContain('200,000,000');
  });

  it('renders bundle-builder previews for the three Pool V2 actions', () => {
    const text = pageText();

    expect(text).toContain('Builder preview');
    expect(text).toMatch(/Spend case\s*6/);
    expect(text).toMatch(/Spend case\s*7/);
    expect(text).toMatch(/Spend case\s*8/);
    expect(text).toMatch(/nav_evidence\s*puzzle_create/);
    expect(text).toMatch(/deed\s*coin_create/);
    expect(text).toMatch(/token_settlement\s*puzzle_create/);
    expect(text).toMatch(/token_authorization\s*puzzle_assert/);
    expect(text).toMatch(/Witness spends\s*4\s*\/\s*4/);
  });

  it('runs a compose dry-run and renders the witness summary', () => {
    component.runAcquisitionComposeDryRun();
    fixture.detectChanges();
    const text = pageText();

    expect(composeDryRun.reserveAcquisition).toHaveBeenCalledTimes(1);
    expect(text).toContain('Compose dry-run passed: 5 coin spends, 4 witnesses.');
    expect(text).toContain('nav_evidence, deed, token_settlement, token_authorization');
  });

  it('surfaces compose dry-run failures', () => {
    composeDryRun.specificDeedSwap.and.throwError('missing nav_evidence witness');

    component.runSwapComposeDryRun();
    fixture.detectChanges();

    expect(pageText()).toContain('missing nav_evidence witness');
  });

  it('preflights a pasted execution package through the execution runner', () => {
    component.executionPackageText = executionPackageJson();

    component.preflightExecutionPackage();
    fixture.detectChanges();
    const text = pageText();

    expect(executionRunner.composeSpecificDeedSwap).toHaveBeenCalledTimes(1);
    expect(text).toContain('Execution preflight passed: 4 coin spends, 3 witnesses.');
    expect(text).toContain('nav_evidence, deed, token_settlement');
  });

  it('prefills an execution package from confirmed chain evidence', () => {
    component.executionKindInput = 'true-redemption';

    component.prefillExecutionPackage();
    fixture.detectChanges();
    const draft = JSON.parse(component.executionPackageText) as Record<string, any>;

    expect(draft['pool'].poolLauncherId).toBe(b32('aa'));
    expect(draft['pool'].poolCoin.coinId).toBe(b32('bb'));
    expect(draft['pool'].poolInnerPuzzleHex).toBe('0x01');
    expect(draft['pool'].lineageProof.innerPuzzleHash).toBe(b32('ee'));
    expect(draft['state'].totalNavLockedMojos).toBe('900000000');
    expect(draft['state'].treasuryReserveTokens).toBe('100000000');
    expect(draft['sharePpm']).toBe(component.sharePpmInput);
    expect(draft['navEvidence'].navValueMojos).toBe(component.collectionNavMojosInput);
    expect(draft['vaultLauncherId']).toBe('');
    expect(draft['tokenCoinId']).toBe('');
    expect(draft['witnesses'].tokenAuthorizationSpends).toEqual([]);
    expect(pageText()).toContain('Prefill from chain');
  });

  it('reads NAV registry evidence and includes the evidence spend in the package draft', async () => {
    component.collectionIdCanonInput = b32('31');

    await component.refreshNavRegistryEvidence();
    component.prefillExecutionPackage();
    fixture.detectChanges();
    const draft = JSON.parse(component.executionPackageText) as Record<string, any>;

    expect(navRegistry.readCollectionNav).toHaveBeenCalledOnceWith({ collectionIdCanon: b32('31') });
    expect(component.collectionNavMojosInput).toBe('123456789');
    expect(draft['collectionIdCanon']).toBe(b32('31'));
    expect(draft['navEvidence']).toEqual({
      registryCoinId: b32('71'),
      registryPuzzleHash: b32('72'),
      collectionIdCanon: b32('31'),
      navValueMojos: '123456789',
      collectionNavRoot: b32('73'),
      registryVersion: '9',
    });
    expect(draft['witnesses'].navEvidenceSpend.coin.parentCoinInfo).toBe(b32('81'));
    expect(draft['witnesses'].navEvidenceSpend.coin.amount).toBe('1');
    expect(pageText()).toContain('NAV 123456789 mojos');
  });

  it('builds a deed witness and includes the live deed spend in the package draft', async () => {
    component.executionKindInput = 'specific-deed-swap';
    component.collectionIdCanonInput = b32('31');
    component.sharePpmInput = '250000';
    component.deedLauncherIdInput = b32('90');
    component.destinationVaultLauncherIdInput = b32('91');
    component.launcherPuzzleHashInput = b32('93');
    component.deedInnerPuzzleHexInput = '0xff80';

    await component.buildDeedWitness();
    component.prefillExecutionPackage();
    fixture.detectChanges();
    const draft = JSON.parse(component.executionPackageText) as Record<string, any>;

    expect(deedWitness.buildRedeemWitness).toHaveBeenCalledOnceWith({
      deedLauncherId: b32('90'),
      deedInnerPuzzleHex: '0xff80',
      pool: confirmedEvidence().poolContext,
      vaultLauncherId: b32('91'),
      launcherPuzzleHash: b32('93'),
      collectionIdCanon: b32('31'),
      sharePpm: '250000',
    });
    expect(draft['deedId']).toBe(b32('92'));
    expect(draft['buyerVaultLauncherId']).toBe(b32('91'));
    expect(draft['launcherPuzzleHash']).toBe(b32('93'));
    expect(draft['collectionIdCanon']).toBe(b32('31'));
    expect(draft['sharePpm']).toBe('250000');
    expect(draft['witnesses'].deedSpend.coin.parentCoinInfo).toBe(b32('94'));
    expect(pageText()).toContain('Build deed witness');
    expect(pageText()).toContain('deed 0x92929292');
  });

  it('builds a reserve acquisition deed deposit witness into the package draft', async () => {
    component.executionKindInput = 'reserve-acquisition';
    component.collectionIdCanonInput = b32('31');
    component.sharePpmInput = '250000';
    component.deedLauncherIdInput = b32('90');
    component.propertyIdCanonInput = b32('a1');
    component.parValueMojosInput = '1000000000';
    component.assetClassInput = '1';
    component.launcherPuzzleHashInput = b32('93');
    component.deedInnerPuzzleHexInput = '0xff80';

    await component.buildDeedWitness();
    component.prefillExecutionPackage();
    fixture.detectChanges();
    const draft = JSON.parse(component.executionPackageText) as Record<string, any>;

    expect(deedWitness.buildDepositWitness).toHaveBeenCalledOnceWith({
      deedLauncherId: b32('90'),
      deedInnerPuzzleHex: '0xff80',
      pool: confirmedEvidence().poolContext,
      launcherPuzzleHash: b32('93'),
      propertyIdCanon: b32('a1'),
      parValueMojos: '1000000000',
      assetClass: '1',
      collectionIdCanon: b32('31'),
      sharePpm: '250000',
    });
    expect(draft['deedId']).toBe(b32('a2'));
    expect(draft['propertyIdCanon']).toBe(b32('a1'));
    expect(draft['parValueMojos']).toBe('1000000000');
    expect(draft['assetClass']).toBe('1');
    expect(draft['collectionIdCanon']).toBe(b32('31'));
    expect(draft['sharePpm']).toBe('250000');
    expect(draft['witnesses'].deedSpend.coin.parentCoinInfo).toBe(b32('a4'));
    expect(pageText()).toContain('deed 0xa2a2a2a2');
    expect(pageText()).toContain('pool deposit');
  });

  it('describes token witness requirements and applies pasted token settlement spends', () => {
    component.executionPackageText = executionPackageJson();
    component.tokenSettlementPuzzleHashInput = b32('43');
    component.tokenSettlementSpendText = JSON.stringify(coinSpend('44'));
    component.tokenAuthorizationSpendsText = '[]';

    component.describeTokenWitnessRequirements();
    fixture.detectChanges();
    expect(spendBuilder.buildSpecificDeedSwapCoinSpend).toHaveBeenCalledTimes(1);
    expect(spendBuilder.describePoolV2RequiredAnnouncements).toHaveBeenCalledWith(
      jasmine.objectContaining({ tokenSettlementPuzzleHash: b32('43') }),
    );
    expect(pageText()).toContain('1 settlement witness, 0 token authorization witness(es).');
    expect(pageText()).toContain('token_settlement');

    component.applyTokenWitnesses();
    fixture.detectChanges();
    const draft = JSON.parse(component.executionPackageText) as Record<string, any>;

    expect(draft['witnesses'].tokenSettlementPuzzleHash).toBe(b32('43'));
    expect(draft['witnesses'].tokenSettlementSpend.coin.parentCoinInfo).toBe(b32('44'));
    expect(draft['witnesses'].tokenAuthorizationSpends).toEqual([]);
    expect(pageText()).toContain('Applied 1 settlement witness and 0 token authorization witness(es).');
  });

  it('rejects token witness over-count before mutating the package', () => {
    component.executionPackageText = executionPackageJson();
    component.tokenSettlementPuzzleHashInput = b32('43');
    component.tokenSettlementSpendText = JSON.stringify(coinSpend('44'));
    component.tokenAuthorizationSpendsText = JSON.stringify([coinSpend('45')]);
    const before = component.executionPackageText;

    component.applyTokenWitnesses();
    fixture.detectChanges();

    expect(component.executionPackageText).toBe(before);
    expect(pageText()).toContain('expected 0 token authorization spend(s), got 1');
  });

  it('builds token TAIL material for a true redemption token authorization', () => {
    const auth = {
      mintOrMelt: -1,
      tokenCoinId: b32('46'),
      amount: 123n,
      announcementMessage: b32('47'),
    };
    const material = tokenTailMaterial({
      tokenCoinId: auth.tokenCoinId,
      amount: auth.amount,
      announcementMessage: auth.announcementMessage,
      expectedPuzzleAnnouncementId: b32('48'),
    });
    spendBuilder.buildTrueRedemptionCoinSpend.and.returnValue(
      poolSpendBuild({ tokenAuthorizations: [auth] }) as any,
    );
    spendBuilder.describePoolV2RequiredAnnouncements.and.returnValue([
      ...tokenSettlementRequirements().slice(0, 2),
      {
        role: 'token_authorization',
        kind: 'puzzle_assert',
        sourceId: auth.tokenCoinId,
        message: auth.announcementMessage,
        announcementId: material.expectedPuzzleAnnouncementId,
      },
    ]);
    tokenAuthorization.buildForAuthorization.and.returnValue(material);
    component.executionKindInput = 'true-redemption';
    component.executionPackageText = trueRedemptionExecutionPackageJson();

    component.buildTokenTailMaterial();
    fixture.detectChanges();

    expect(tokenAuthorization.buildForAuthorization).toHaveBeenCalledWith(
      jasmine.objectContaining({
        tokenCoinId: auth.tokenCoinId,
        mintOrMelt: -1,
        amount: auth.amount,
      }),
    );
    expect(component.tokenTailMaterialText).toContain('"tailPuzzleHash":');
    expect(component.tokenTailMaterialText).toContain(material.expectedPuzzleAnnouncementId);
    expect(pageText()).toContain('TAIL 0x49494949...49494949 asserts 0x48484848...48484848');
  });

  it('builds a token CAT authorization spend into tokenAuthorizationSpends JSON', () => {
    const auth = {
      mintOrMelt: -1,
      tokenCoinId: b32('46'),
      amount: 123n,
      announcementMessage: b32('47'),
    };
    const build = tokenCatSpendBuild({
      material: tokenTailMaterial({
        tokenCoinId: auth.tokenCoinId,
        amount: auth.amount,
        announcementMessage: auth.announcementMessage,
        expectedPuzzleAnnouncementId: b32('48'),
      }),
    });
    spendBuilder.buildTrueRedemptionCoinSpend.and.returnValue(
      poolSpendBuild({ tokenAuthorizations: [auth] }) as any,
    );
    spendBuilder.describePoolV2RequiredAnnouncements.and.returnValue([
      {
        role: 'token_authorization',
        kind: 'puzzle_assert',
        sourceId: auth.tokenCoinId,
        message: auth.announcementMessage,
        announcementId: b32('48'),
      },
    ]);
    tokenAuthorization.buildTokenAuthorizationCoinSpend.and.returnValue(build as any);
    component.executionKindInput = 'true-redemption';
    component.executionPackageText = trueRedemptionExecutionPackageJson();
    component.tokenAuthorizationCoinText = JSON.stringify({
      parentCoinInfo: b32('70'),
      puzzleHash: b32('71'),
      amount: '123',
      coinId: auth.tokenCoinId,
    });
    component.tokenAuthorizationLineageText = JSON.stringify({
      parentName: b32('72'),
      innerPuzzleHash: b32('73'),
      amount: '123',
    });
    component.tokenAuthorizationInnerPuzzleHex = '0x01';
    component.tokenAuthorizationInnerSolutionHex = '0x80';

    component.buildTokenAuthorizationSpend();
    fixture.detectChanges();

    expect(tokenAuthorization.buildTokenAuthorizationCoinSpend).toHaveBeenCalledWith(
      jasmine.objectContaining({
        tokenInnerPuzzleHex: '0x01',
        tokenInnerSolutionHex: '0x80',
        mintOrMelt: -1,
        amount: 123n,
      }),
    );
    expect(component.tokenAuthorizationSpendsText).toContain('"puzzleReveal": "0x51"');
    expect(component.tokenTailMaterialText).toContain('"tailPuzzleHash":');
    expect(pageText()).toContain('CAT 0x51515151...51515151 delta -123 child 0');
  });

  it('submits the preflighted execution bundle through coinset on command', async () => {
    component.executionPackageText = executionPackageJson();
    component.preflightExecutionPackage();

    await component.submitExecutionBundle();
    fixture.detectChanges();

    expect(executionRunner.submitSignaturelessBundle).toHaveBeenCalledTimes(1);
    expect(pageText()).toContain('Submitted: SUCCESS');
  });

  it('surfaces execution package parse failures', () => {
    component.executionPackageText = '';

    component.preflightExecutionPackage();
    fixture.detectChanges();

    expect(executionRunner.composeSpecificDeedSwap).not.toHaveBeenCalled();
    expect(pageText()).toContain('execution package JSON is required');
  });

  it('shows reserve-first acquisition shortfall without hiding the reserve payment', () => {
    const text = pageText();

    expect(text).toContain('Seller receives reserve tokens');
    expect(text).toContain('200,000,000');
    expect(text).toContain('Fresh mint shortfall');
    expect(text).toContain('100,000,000');
  });

  it('surfaces invalid reserve accounting in the quote panels', () => {
    component.treasuryReserveTokensInput = '1000000001';
    fixture.detectChanges();

    expect(pageText()).toContain('treasuryReserveTokens cannot exceed totalPoolTokenSupply');
  });

  function pageText(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }
});

function confirmedEvidence(): Extract<PoolV2ChainStateEvidence, { kind: 'confirmed' }> {
  return {
    kind: 'confirmed',
    launcherId: b32('aa'),
    liveCoinId: b32('bb'),
    livePuzzleHash: b32('cc'),
    confirmedBlockIndex: 42,
    lineageDepth: 3,
    latestSpendCoinId: b32('dd'),
    latestSpentBlockIndex: 41,
    spendCase: 6,
    spendCaseLabel: 'V2_SPECIFIC_DEED_SWAP',
    previousState: {
      poolStatus: 1n,
      totalNavLockedMojos: 1000000000n,
      deedCount: 4n,
      totalPoolTokenSupply: 1000000000n,
      treasuryReserveTokens: 0n,
    },
    state: {
      poolStatus: 1n,
      totalNavLockedMojos: 900000000n,
      deedCount: 3n,
      totalPoolTokenSupply: 1000000000n,
      treasuryReserveTokens: 100000000n,
    },
    rebuiltFullPuzzleHash: b32('cc'),
    poolContext: {
      poolLauncherId: b32('aa'),
      poolCoin: {
        parentCoinInfo: b32('dd'),
        puzzleHash: b32('cc'),
        amount: '1',
        coinId: b32('bb'),
      },
      poolInnerPuzzleHex: '0x01',
      lineageProof: {
        parentName: b32('ab'),
        innerPuzzleHash: b32('ee'),
        amount: '1',
      },
    },
  };
}

function confirmedNavEvidence(): CollectionNavRegistryEvidence {
  return {
    kind: 'confirmed-present',
    registryLauncherId: b32('70'),
    collectionIdCanon: b32('31'),
    registryCoinId: b32('71'),
    registryPuzzleHash: b32('72'),
    navValueMojos: 123456789n,
    collectionNavRoot: b32('73'),
    registryVersion: 9n,
    entries: [{ collectionIdCanon: b32('31'), navValueMojos: 123456789n }],
    confirmedBlockIndex: 99,
    lineageDepth: 4,
    latestSpendCoinId: b32('74'),
    latestSpentBlockIndex: 98,
    navEvidence: {
      registryCoinId: b32('71'),
      registryPuzzleHash: b32('72'),
      collectionIdCanon: b32('31'),
      navValueMojos: 123456789n,
      collectionNavRoot: b32('73'),
      registryVersion: 9n,
    },
    navEvidenceSpend: {
      coin: {
        parentCoinInfo: b32('81'),
        puzzleHash: b32('72'),
        amount: 1n,
      },
      puzzleReveal: '0x01',
      solution: '0x80',
    },
  };
}

function confirmedDeedWitness(): PoolV2DeedWitnessEvidence {
  return {
    kind: 'confirmed-redeem',
    deedLauncherId: b32('90'),
    deedCoinId: b32('92'),
    deedPuzzleHash: b32('95'),
    deedInnerPuzzleHash: b32('96'),
    previousInnerPuzzleHash: b32('97'),
    p2VaultPuzzleHash: b32('98'),
    vaultLauncherId: b32('91'),
    launcherPuzzleHash: b32('93'),
    propertyIdCanon: b32('a1'),
    parValueMojos: 1000000000n,
    assetClass: 1n,
    collectionIdCanon: b32('31'),
    sharePpm: 250000n,
    deedCommitment: b32('9b'),
    deedMessage: b32('99'),
    deedSpend: {
      coin: {
        parentCoinInfo: b32('94'),
        puzzleHash: b32('95'),
        amount: 1n,
      },
      puzzleReveal: '0x01',
      solution: '0x80',
    },
    confirmedBlockIndex: 101,
    lineageDepth: 4,
    latestSpendCoinId: b32('9a'),
    latestSpentBlockIndex: 100,
  };
}

function confirmedDepositDeedWitness(): PoolV2DeedWitnessEvidence {
  return {
    kind: 'confirmed-deposit',
    deedLauncherId: b32('90'),
    deedCoinId: b32('a2'),
    deedPuzzleHash: b32('a5'),
    deedInnerPuzzleHash: b32('a6'),
    previousInnerPuzzleHash: b32('a7'),
    launcherPuzzleHash: b32('93'),
    propertyIdCanon: b32('a1'),
    parValueMojos: 1000000000n,
    assetClass: 1n,
    collectionIdCanon: b32('31'),
    sharePpm: 250000n,
    deedCommitment: b32('ab'),
    deedMessage: b32('a9'),
    deedSpend: {
      coin: {
        parentCoinInfo: b32('a4'),
        puzzleHash: b32('a5'),
        amount: 1n,
      },
      puzzleReveal: '0x01',
      solution: '0x80',
    },
    confirmedBlockIndex: 101,
    lineageDepth: 4,
    latestSpendCoinId: b32('aa'),
    latestSpentBlockIndex: 100,
  };
}

function tokenSettlementRequirements(): PoolV2RequiredAnnouncement[] {
  return [
    {
      role: 'nav_evidence',
      kind: 'puzzle_create',
      sourceId: b32('32'),
      message: b32('52'),
    },
    {
      role: 'deed',
      kind: 'coin_create',
      sourceId: b32('30'),
      message: b32('53'),
    },
    {
      role: 'token_settlement',
      kind: 'puzzle_create',
      sourceId: b32('43'),
      message: b32('54'),
    },
  ];
}

function poolSpendBuild(overrides: { tokenAuthorizations?: unknown[] } = {}): Record<string, unknown> {
  return {
    spendCase: 6,
    actionTag: 0,
    innerSolutionHex: '0x80',
    spec: {
      actionTag: 0,
      poolActionMessage: b32('50'),
      requiredNavEvidenceMessage: b32('52'),
      deedMessage: b32('53'),
      tokenOutputs: [],
      tokenAuthorizations: overrides.tokenAuthorizations ?? [],
    },
    poolCoinId: b32('23'),
    poolInnerPuzzleHash: b32('25'),
    poolFullPuzzleHash: b32('22'),
    poolPuzzleReveal: '0x01',
    poolFullSolutionHex: '0x80',
    coinSpend: coinSpend('23'),
    unsignedSpendBundle: { coinSpends: [coinSpend('23')], aggregatedSignature: null },
  };
}

function b32(byte: string): string {
  return `0x${byte.repeat(32)}`;
}

function dryRunResult(
  kind: PoolV2ComposeDryRunResult['kind'],
  spendCase: number,
  coinSpendCount: number,
  witnessCoinSpendCount: number,
): PoolV2ComposeDryRunResult {
  const roles: PoolV2ComposeDryRunResult['requiredAnnouncements'][number]['role'][] =
    witnessCoinSpendCount === 4
      ? ['nav_evidence', 'deed', 'token_settlement', 'token_authorization']
      : spendCase === 7
        ? ['nav_evidence', 'deed', 'token_authorization']
        : ['nav_evidence', 'deed', 'token_settlement'];
  return {
    kind,
    label: kind,
    spendCase,
    actionTag: 0,
    coinSpendCount,
    witnessCoinSpendCount,
    maxWitnessCoinSpends: 4,
    unsignedBundleCoinSpendLimit: 5,
    aggregatedSignature: null,
    requiredAnnouncements: roles.map((role) => ({
      role,
      kind: role === 'deed' ? 'coin_create' : role === 'token_authorization' ? 'puzzle_assert' : 'puzzle_create',
      sourceId: b32('01'),
      message: b32('02'),
    })),
    witnessSummary: roles.map((role) => ({
      role,
      coinId: b32('03'),
      puzzleHash: b32('04'),
      cost: 1n,
    })),
  };
}

function executionBundle(
  kind: PoolV2ExecutionKind,
  spendCase: number,
  coinSpendCount: number,
  witnessCoinSpendCount: number,
): PoolV2ExecutionBundle<any> {
  const roles: PoolV2ExecutionBundle<any>['requiredAnnouncements'][number]['role'][] =
    witnessCoinSpendCount === 4
      ? ['nav_evidence', 'deed', 'token_settlement', 'token_authorization']
      : spendCase === 7
        ? ['nav_evidence', 'deed', 'token_authorization']
        : ['nav_evidence', 'deed', 'token_settlement'];
  const coinSpends = Array.from({ length: coinSpendCount }, (_, index) => coinSpend(`0${index}`.slice(-2)));
  return {
    kind,
    label: kind,
    spendCase,
    actionTag: 0,
    poolSpend: {} as PoolV2ExecutionBundle<any>['poolSpend'],
    requiredAnnouncements: roles.map((role) => ({
      role,
      kind: role === 'deed' ? 'coin_create' : role === 'token_authorization' ? 'puzzle_assert' : 'puzzle_create',
      sourceId: b32('11'),
      message: b32('12'),
    })),
    witnessSummary: roles.map((role) => ({
      role,
      coinId: b32('13'),
      puzzleHash: b32('14'),
      cost: 1n,
    })),
    coinSpends,
    unsignedSpendBundle: {
      coinSpends,
      aggregatedSignature: null,
    },
    signaturelessSpendBundle: {
      coinSpends,
      aggregatedSignature: '0x' + 'c0' + '00'.repeat(95),
    },
  };
}

function executionPackageJson(): string {
  return JSON.stringify({
    pool: {
      poolLauncherId: b32('20'),
      poolCoin: {
        parentCoinInfo: b32('21'),
        puzzleHash: b32('22'),
        amount: '1',
        coinId: b32('23'),
      },
      poolInnerPuzzleHex: '0x01',
      lineageProof: {
        parentName: b32('24'),
        innerPuzzleHash: b32('25'),
        amount: '1',
      },
    },
    deedId: b32('30'),
    deedLauncherId: b32('2f'),
    propertyIdCanon: b32('2e'),
    parValueMojos: '123000',
    assetClass: '1',
    collectionIdCanon: b32('31'),
    sharePpm: '250000',
    navEvidence: {
      registryCoinId: b32('32'),
      registryPuzzleHash: b32('33'),
      collectionIdCanon: b32('31'),
      navValueMojos: '1000000000',
      collectionNavRoot: b32('34'),
      registryVersion: '1',
    },
    buyerVaultLauncherId: b32('35'),
    launcherPuzzleHash: b32('36'),
    treasuryReservePuzhash: b32('37'),
    protocolTreasuryPuzhash: b32('38'),
    governanceRewardsPuzhash: b32('39'),
    governanceRewardsRoot: b32('3a'),
    witnesses: {
      navEvidenceSpend: coinSpend('41'),
      deedSpend: coinSpend('42'),
      tokenSettlementPuzzleHash: b32('43'),
      tokenSettlementSpend: coinSpend('44'),
    },
  });
}

function trueRedemptionExecutionPackageJson(): string {
  return JSON.stringify({
    pool: {
      poolLauncherId: b32('20'),
      poolCoin: {
        parentCoinInfo: b32('21'),
        puzzleHash: b32('22'),
        amount: '1',
        coinId: b32('23'),
      },
      poolInnerPuzzleHex: '0x01',
      lineageProof: {
        parentName: b32('24'),
        innerPuzzleHash: b32('25'),
        amount: '1',
      },
    },
    deedId: b32('30'),
    deedLauncherId: b32('2f'),
    propertyIdCanon: b32('2e'),
    parValueMojos: '123000',
    assetClass: '1',
    collectionIdCanon: b32('31'),
    sharePpm: '250000',
    navEvidence: {
      registryCoinId: b32('32'),
      registryPuzzleHash: b32('33'),
      collectionIdCanon: b32('31'),
      navValueMojos: '1000000000',
      collectionNavRoot: b32('34'),
      registryVersion: '1',
    },
    vaultLauncherId: b32('35'),
    launcherPuzzleHash: b32('36'),
    tokenCoinId: b32('46'),
    witnesses: {
      navEvidenceSpend: coinSpend('41'),
      deedSpend: coinSpend('42'),
      tokenAuthorizationSpends: [],
    },
  });
}

function tokenTailMaterial(
  overrides: Partial<PoolV2TokenAuthorizationMaterial> = {},
): PoolV2TokenAuthorizationMaterial {
  return {
    tailPuzzleHash: b32('49'),
    tailPuzzleReveal: '0xff',
    tailSolution: '0x80',
    poolFullPuzzleHash: b32('22'),
    poolInnerPuzzleHash: b32('25'),
    poolCoinId: b32('23'),
    tokenCoinId: b32('46'),
    mintOrMelt: -1,
    amount: 123n,
    announcementMessage: b32('47'),
    expectedPuzzleAnnouncementId: b32('48'),
    assertedPuzzleAnnouncementIds: [b32('48')],
    assertedCoinIds: [b32('46')],
    ...overrides,
  };
}

function tokenCatSpendBuild(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const material =
    (overrides['material'] as PoolV2TokenAuthorizationMaterial | undefined) ?? tokenTailMaterial();
  return {
    material,
    coinSpend: {
      coin: {
        parentCoinInfo: b32('50'),
        puzzleHash: b32('51'),
        amount: 123n,
      },
      puzzleReveal: '0x51',
      solution: '0x52',
    },
    tokenInnerPuzzleHash: b32('53'),
    tokenFullPuzzleHash: b32('51'),
    tokenCoinId: material.tokenCoinId,
    childTokenAmount: 0n,
    extraDelta: -123n,
    ...overrides,
  };
}

function coinSpend(byte: string) {
  return {
    coin: {
      parentCoinInfo: b32(byte),
      puzzleHash: b32('aa'),
      amount: 1,
    },
    puzzleReveal: '0x01',
    solution: '0x80',
  };
}
