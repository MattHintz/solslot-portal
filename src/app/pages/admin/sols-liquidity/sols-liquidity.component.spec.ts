import { AdminSessionService } from '../../../services/admin-session.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  SolsMarketApiService,
  SolsMarketSnapshot,
} from '../../../services/sols-market-api.service';
import { SolsLiquidityComponent } from './sols-liquidity.component';

describe('SolsLiquidityComponent', () => {
  let fixture: ComponentFixture<SolsLiquidityComponent>;
  let component: SolsLiquidityComponent;
  let api: jasmine.SpyObj<Pick<SolsMarketApiService, 'readMarket'>>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('SolsMarketApiService', ['readMarket']);
    api.readMarket.and.resolveTo(snapshot());
    await TestBed.configureTestingModule({
      imports: [SolsLiquidityComponent],
      providers: [
        provideRouter([]),
        { provide: AdminSessionService, useValue: { connectionNotice: () => '', logoutAndRedirect: jasmine.createSpy('logoutAndRedirect') } },
        { provide: SolsMarketApiService, useValue: api },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SolsLiquidityComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders Pool V4 and only active governed venues', () => {
    const text = pageText();

    expect(api.readMarket).toHaveBeenCalledTimes(1);
    expect(text).toContain('SOLS liquidity');
    expect(text).toContain('Pool V4');
    expect(text).toMatch(/Governed venues\s*1/);
    expect(text).toContain('On-chain active');
    expect(component.activeVenues()).toHaveSize(1);
  });

  it('keeps reviewed candidates separate from protocol trust', () => {
    const text = pageText();

    expect(text).toContain('Uniswap V3');
    expect(text).toContain('Aerodrome');
    expect(text).toContain('TibetSwap');
    expect(text).toContain('Community pools are separate from approved Solslot routes');
    expect(text).toContain('It remains community-run');
  });

  it('renders governed values and SOLS units', () => {
    expect(pageText()).toContain('$3.33');
    expect(pageText()).toContain('1.25 SOLS');
    expect(component.formatSols('1250000000000')).toBe('1.25');
    expect(component.formatMicroUsd('3330000')).toBe('$3.33');
  });

  function pageText(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }
});

function snapshot(): SolsMarketSnapshot {
  return {
    schemaVersion: 2,
    network: 'testnet11',
    outcome: 'READY',
    title: 'One SmartDeed swap available',
    body: 'Prices come from the current governed statute.',
    pool: {
      deedCount: 1,
      totalSolsMojos: '1250000000000',
      reserveSolsMojos: '250000000000',
      inventoryNavMicroUsd: '3330000',
    },
    statutes: {
      registryVersion: 2,
      contentHash: b32('01'),
      parametersRoot: b32('02'),
      collectionsRoot: b32('03'),
      oracleRoot: b32('04'),
      routesRoot: b32('05'),
      liquidityRoot: b32('06'),
      pausesRoot: b32('07'),
      parameters: {
        navValiditySeconds: 86_400,
        exchangeFeeBps: 100,
        protocolFeeBps: 30,
        sgtRewardsFeeBps: 70,
      },
      collections: [],
      liquidityVenues: [
        venue(true, '10'),
        venue(false, '20'),
      ],
      pauses: [],
      liveCoinId: b32('08'),
      livePuzzleHash: b32('09'),
      confirmedHeight: 42,
      lineageDepth: 2,
    },
    opportunities: [
      {
        deedId: 'deed-1',
        deedLauncherId: b32('30'),
        deedCoinId: b32('31'),
        collectionId: 'collection-1',
        collectionSlug: 'eastmoreland',
        collectionTitle: '127 Eastmoreland',
        collectionSummary: 'Alpha collection',
        metadataRoot: b32('32'),
        propertyIdCanon: b32('33'),
        collectionIdCanon: b32('34'),
        sharePpm: 10_000,
        parValueMojos: '3330000',
        assetClass: 1,
        collectionNavMicroUsd: '333000000',
        deedValueMicroUsd: '3330000',
        navVersion: 1,
        navValidUntil: 1_900_000_000,
        principalSolsMojos: '1230000000000',
        protocolFeeSolsMojos: '6000000000',
        sgtRewardsFeeSolsMojos: '14000000000',
        totalSolsMojos: '1250000000000',
        chainVerified: true,
        confirmedHeight: 42,
      },
    ],
    verifiedOpportunityCount: 1,
    rejectedCandidateCount: 0,
  };
}

function venue(active: boolean, byte: string) {
  return {
    venueId: b32(byte),
    chainId: b32('40'),
    protocolId: b32('41'),
    factoryId: b32('42'),
    poolId: b32('43'),
    baseAssetId: b32('44'),
    quoteAssetId: b32('45'),
    poolCodeHash: b32('46'),
    active,
  };
}

function b32(byte: string): string {
  return `0x${byte.repeat(32)}`;
}
