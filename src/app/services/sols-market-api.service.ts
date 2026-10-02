import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SolsMarketApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.faucetApi.replace(/\/$/, '');

  readMarket(): Promise<SolsMarketSnapshot> {
    return firstValueFrom(
      this.http.get<SolsMarketSnapshot>(`${this.base}/sols/market`, {
        withCredentials: true,
      }).pipe(timeout(20_000)),
    );
  }
}

export type SolsMarketOutcome = 'READY' | 'WAITING' | 'PAUSED' | 'LOCKED';

export interface SolsMarketOpportunity {
  deedId: string;
  deedLauncherId: string;
  deedCoinId: string;
  collectionId: string;
  collectionSlug: string;
  collectionTitle: string;
  collectionSummary?: string | null;
  metadataRoot: string;
  propertyIdCanon: string;
  collectionIdCanon: string;
  sharePpm: number;
  parValueMojos: string;
  assetClass: number;
  collectionNavMicroUsd: string;
  deedValueMicroUsd: string;
  navVersion: number;
  navValidUntil: number;
  principalSolsMojos: string;
  protocolFeeSolsMojos: string;
  sgtRewardsFeeSolsMojos: string;
  totalSolsMojos: string;
  chainVerified: true;
  confirmedHeight: number;
}

export interface SolsMarketSnapshot {
  schemaVersion: 2;
  network: 'testnet11';
  asset?: {
    symbol: 'SOLS';
    name: 'Sols';
    tailHash: string;
    purpose: 'secondary-smartdeed-swaps-only';
  };
  outcome: SolsMarketOutcome;
  title: string;
  body: string;
  pool: Record<string, unknown> | null;
  statutes: SolsStatutesSnapshot | null;
  navRegistry?: Record<string, unknown> | null;
  opportunities: SolsMarketOpportunity[];
  verifiedOpportunityCount: number;
  rejectedCandidateCount: number;
  provider?: Record<string, unknown>;
}

export interface SolsLiquidityVenue {
  venueId: string;
  chainId: string;
  protocolId: string;
  factoryId: string;
  poolId: string;
  baseAssetId: string;
  quoteAssetId: string;
  poolCodeHash: string;
  active: boolean;
}

export interface SolsStatutesSnapshot {
  registryVersion: number;
  contentHash: string;
  parametersRoot: string;
  collectionsRoot: string;
  oracleRoot: string;
  routesRoot: string;
  liquidityRoot: string;
  pausesRoot: string;
  parameters: {
    navValiditySeconds: number;
    exchangeFeeBps: number;
    protocolFeeBps: number;
    sgtRewardsFeeBps: number;
  };
  collections: Array<Record<string, unknown>>;
  liquidityVenues: SolsLiquidityVenue[];
  pauses: Array<Record<string, unknown>>;
  liveCoinId: string;
  livePuzzleHash: string;
  confirmedHeight: number;
  lineageDepth: number;
}
