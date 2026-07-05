import { TestBed } from '@angular/core/testing';

import { classifyOfferEligibility } from './offer-domain';
import {
  OfferSourceRecord,
  OfferSourceService,
  normalizeOfferSourceRecord,
} from './offer-source.service';

const DEED_LAUNCHER_ID = '0x' + '33'.repeat(32);
const VAULT_LAUNCHER_ID = '0x' + '11'.repeat(32);

describe('OfferSourceService', () => {
  let service: OfferSourceService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OfferSourceService);
  });

  it('maps source data to the member offer domain model', () => {
    const offer = normalizeOfferSourceRecord(rawOffer());

    expect(offer).toEqual(
      jasmine.objectContaining({
        id: 'offer-1',
        title: 'Vector house offer',
        deedLauncherId: DEED_LAUNCHER_ID,
        state: 'OP:OFFER_READY',
        gatingPolicy: {
          requiresZkPassport: true,
          allowedVaultLauncherIds: [VAULT_LAUNCHER_ID],
        },
      }),
    );
    expect(offer.terms).toEqual({
      deedLauncherId: DEED_LAUNCHER_ID,
      tokenAmount: 250_000,
      priceMojos: 1_500_000,
      acceptedAsset: 'XCH',
      expiresAt: 1_779_120_000,
    });
    expect(offer.artifact).toEqual({
      artifactId: 'artifact-1',
      deedLauncherId: DEED_LAUNCHER_ID,
      artifactHash: '0x' + '44'.repeat(32),
      rawOffer: '0xabcd',
    });
  });

  it('marks malformed offer artifacts unavailable without throwing away offer terms', () => {
    const offer = normalizeOfferSourceRecord(
      rawOffer({
        artifact: {
          artifactId: 'artifact-1',
          deedLauncherId: '0x' + '99'.repeat(32),
          artifactHash: '0x' + '44'.repeat(32),
          rawOffer: '0xabcd',
        },
      }),
    );
    const eligibility = classifyOfferEligibility(offer, {
      walletConnected: true,
      vaultLauncherId: VAULT_LAUNCHER_ID,
      vaultConfirmed: true,
      zkPassportProofConfirmed: true,
    });

    expect(offer.artifact).toBeNull();
    expect(offer.terms.tokenAmount).toBe(250_000);
    expect(eligibility.state).toBe('EM:OFFER_UNAVAILABLE');
    expect(eligibility.reason).toBe('Offer artifact is not available.');
  });

  it('normalizes static testnet source offers', () => {
    const offer = service.offerById('testnet-deed-001');

    expect(offer?.id).toBe('testnet-deed-001');
    expect(offer?.artifact?.artifactId).toBe('testnet-artifact-001');
    expect(service.listOffers().some((item) => item.id === 'testnet-deed-001')).toBeTrue();
  });

  it('accepts protocol API hashes and bech32 Chia offer payloads', () => {
    const offer = normalizeOfferSourceRecord(
      rawOffer({
        artifact: {
          artifactId: 'artifact-1',
          deedLauncherId: DEED_LAUNCHER_ID,
          artifactHash: 'sha256:' + 'ab'.repeat(32),
          rawOffer: 'offer1legacychiaofferid',
        },
      }),
    );

    expect(offer.artifact?.artifactHash).toBe('sha256:' + 'ab'.repeat(32));
    expect(offer.artifact?.rawOffer).toBe('offer1legacychiaofferid');
  });

  it('returns null for unknown offer ids', () => {
    expect(service.offerById('missing-offer')).toBeNull();
  });

  it('rejects malformed core source data loudly', () => {
    expect(() =>
      normalizeOfferSourceRecord(
        rawOffer({
          deedLauncherId: '0x1234',
        }),
      ),
    ).toThrowError(/deedLauncherId/);
  });
});

function rawOffer(overrides: Partial<OfferSourceRecord> = {}): OfferSourceRecord {
  return {
    id: 'offer-1',
    title: 'Vector house offer',
    deedLauncherId: DEED_LAUNCHER_ID,
    state: 'OP:OFFER_READY',
    terms: {
      deedLauncherId: DEED_LAUNCHER_ID,
      tokenAmount: 250_000,
      priceMojos: 1_500_000,
      acceptedAsset: 'xch',
      expiresAt: 1_779_120_000,
    },
    artifact: {
      artifactId: 'artifact-1',
      deedLauncherId: DEED_LAUNCHER_ID,
      artifactHash: '0x' + '44'.repeat(32),
      rawOffer: 'abcd',
    },
    gatingPolicy: {
      requiresZkPassport: true,
      allowedVaultLauncherIds: [VAULT_LAUNCHER_ID.slice(2).toUpperCase()],
    },
    ...overrides,
  };
}
