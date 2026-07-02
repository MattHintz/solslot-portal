import { TestBed } from '@angular/core/testing';

import {
  PoolEconomicsV2ActionPreviewService,
  type PoolV2ActionPreviewArgs,
} from './pool-economics-v2-action-preview.service';
import {
  POOL_SPEND_V2_RESERVE_ACQUISITION,
  POOL_SPEND_V2_SPECIFIC_DEED_SWAP,
  POOL_SPEND_V2_TRUE_REDEMPTION,
  POOL_V2_MAX_UNSIGNED_BUNDLE_COIN_SPENDS,
  POOL_V2_MAX_WITNESS_COIN_SPENDS,
} from './pool-economics-v2-spend-builder.service';

describe('PoolEconomicsV2ActionPreviewService', () => {
  let service: PoolEconomicsV2ActionPreviewService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PoolEconomicsV2ActionPreviewService);
  });

  it('previews specific deed swap witness requirements', () => {
    const preview = service.specificDeedSwap(baseArgs());

    expect(preview.spendCase).toBe(POOL_SPEND_V2_SPECIFIC_DEED_SWAP);
    expect(preview.requiredAnnouncements.map((a) => a.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_settlement',
    ]);
    expect(preview.tokenOutputCount).toBe(3);
    expect(preview.tokenAuthorizationCount).toBe(0);
    expect(preview.tokenSettlementPaymentMessage).toMatch(/^0x[0-9a-f]{64}$/);
    expect(preview.requiredWitnessCoinSpends).toBe(3);
    expect(preview.maxWitnessCoinSpends).toBe(POOL_V2_MAX_WITNESS_COIN_SPENDS);
    expect(preview.unsignedBundleCoinSpendLimit).toBe(
      POOL_V2_MAX_UNSIGNED_BUNDLE_COIN_SPENDS,
    );
  });

  it('previews true redemption as deed plus token melt authorization', () => {
    const preview = service.trueRedemption(baseArgs());

    expect(preview.spendCase).toBe(POOL_SPEND_V2_TRUE_REDEMPTION);
    expect(preview.requiredAnnouncements.map((a) => a.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_authorization',
    ]);
    expect(preview.tokenOutputCount).toBe(0);
    expect(preview.tokenAuthorizationCount).toBe(1);
    expect(preview.tokenSettlementPaymentMessage).toBeNull();
    expect(preview.requiredWitnessCoinSpends).toBe(3);
  });

  it('previews reserve acquisition with reserve payment and mint authorization', () => {
    const preview = service.reserveAcquisition(baseArgs());

    expect(preview.spendCase).toBe(POOL_SPEND_V2_RESERVE_ACQUISITION);
    expect(preview.requiredAnnouncements.map((a) => a.role)).toEqual([
      'nav_evidence',
      'deed',
      'token_settlement',
      'token_authorization',
    ]);
    expect(preview.tokenOutputCount).toBe(1);
    expect(preview.tokenAuthorizationCount).toBe(1);
    expect(preview.requiredWitnessCoinSpends).toBe(4);
  });
});

function baseArgs(): PoolV2ActionPreviewArgs {
  return {
    state: {
      totalNavLockedMojos: 1_000_000_000n,
      deedCount: 4n,
      totalPoolTokenSupply: 1_000_000_000n,
      treasuryReserveTokens: 200_000_000n,
    },
    collectionNavMojos: 1_000_000_000n,
    sharePpm: 250_000n,
    sellerTokenPrice: 300_000_000n,
  };
}
