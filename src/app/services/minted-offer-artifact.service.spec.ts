import { TestBed } from '@angular/core/testing';

import {
  MINTED_OFFER_ARTIFACT_SCHEMA_VERSION,
  MintedOfferArtifactInput,
  MintedOfferArtifactService,
  planMintedOfferArtifact,
} from './minted-offer-artifact.service';

const DEED_LAUNCHER_ID = '0x' + '44'.repeat(32);
const VAULT_LAUNCHER_ID = '0x' + '55'.repeat(32);
const TREASURY_PUZZLE_HASH = '0x' + '66'.repeat(32);

describe('MintedOfferArtifactService', () => {
  let service: MintedOfferArtifactService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MintedOfferArtifactService);
  });

  it('turns a minted proposal into an API-shaped offer-ready artifact', () => {
    const plan = service.planFromMint(mintedInput());

    expect(plan.schemaVersion).toBe(MINTED_OFFER_ARTIFACT_SCHEMA_VERSION);
    expect(plan.generationAuthority).toBe('admin-api');
    expect(plan.protocolArtifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(plan.protocolArtifact).toEqual(
      jasmine.objectContaining({
        version: 2,
        kind: 'solslot_protocol_offer',
        network: 'testnet11',
        paymentTerms: {
          currency: 'XCH',
          amount: 1_500_000,
          quantity: 1,
          protocolTreasuryPuzhash: TREASURY_PUZZLE_HASH,
        },
      }),
    );
    expect(plan.protocolArtifact.protocol).toEqual(
      jasmine.objectContaining({
        instanceId: 'solslot-staging',
        purchaseIntentId: 'pi_minted_001',
        rail: 'chia',
        deedLauncherId: DEED_LAUNCHER_ID,
        propertyId: 'solslot-property-51',
        collectionId: 'col1mergedcollection',
        sharePpm: 125_000,
        vaultLauncherId: VAULT_LAUNCHER_ID,
        zkPassportRequired: true,
        currentState: 'zk_verified',
        expiresAt: 1_779_120_000,
      }),
    );
    expect(plan.protocolArtifact.metadata['solslotPropertyReference']).toEqual({
      propertyId: '51',
      propertyShareId: 51,
      nftId: 'nft1legacyshare',
      collectionId: 'col1mergedcollection',
      retiredOfferGroupId: 9,
      retiredOfferIds: [74],
    });
    expect(plan.offer).toEqual(
      jasmine.objectContaining({
        id: 'mp_001',
        title: 'Minted merged Solslot deed',
        deedLauncherId: DEED_LAUNCHER_ID,
        state: 'OP:OFFER_READY',
      }),
    );
    expect(plan.offer.terms).toEqual({
      deedLauncherId: DEED_LAUNCHER_ID,
      tokenAmount: 250_000,
      priceMojos: 1_500_000,
      acceptedAsset: 'XCH',
      expiresAt: 1_779_120_000,
    });
    expect(plan.offer.artifact).toEqual({
      artifactId: 'protocol-offer:pi_minted_001',
      deedLauncherId: DEED_LAUNCHER_ID,
      artifactHash: plan.protocolArtifactHash,
      rawOffer: null,
    });
    expect(plan.offer.gatingPolicy).toEqual({
      requiresZkPassport: true,
      allowedVaultLauncherIds: [VAULT_LAUNCHER_ID],
    });
  });

  it('produces stable hashes for the same canonical artifact fields', () => {
    const first = planMintedOfferArtifact(mintedInput());
    const second = planMintedOfferArtifact(mintedInput());

    expect(second.protocolArtifactHash).toBe(first.protocolArtifactHash);
  });

  it('blocks a minted proposal without a deed launcher id from becoming offer-ready', () => {
    expect(() =>
      planMintedOfferArtifact(
        mintedInput({
          deedLauncherId: null,
        }),
      ),
    ).toThrowError(/deed launcher id/);
  });

  it('blocks non-minted proposals before emitting an offer artifact', () => {
    expect(() =>
      planMintedOfferArtifact(
        mintedInput({
          proposalState: 'EXECUTED',
        }),
      ),
    ).toThrowError(/state MINTED/);
  });
});

function mintedInput(overrides: Partial<MintedOfferArtifactInput> = {}): MintedOfferArtifactInput {
  return {
    proposalId: 'mp_001',
    proposalState: 'MINTED',
    instanceId: 'solslot-staging',
    purchaseIntentId: 'pi_minted_001',
    rail: 'chia',
    title: 'Minted merged Solslot deed',
    deedLauncherId: DEED_LAUNCHER_ID,
    propertyId: 'solslot-property-51',
    collectionId: 'col1mergedcollection',
    sharePpm: 125_000,
    vaultLauncherId: VAULT_LAUNCHER_ID,
    paymentTerms: {
      currency: 'xch',
      amount: 1_500_000,
      quantity: 1,
      protocolTreasuryPuzhash: TREASURY_PUZZLE_HASH,
    },
    tokenAmount: 250_000,
    expiresAt: 1_779_120_000,
    currentState: 'zk_verified',
    issuedAt: 1_777_000_000,
    network: 'testnet11',
    gatingPolicy: {
      requiresZkPassport: true,
      allowedVaultLauncherIds: [VAULT_LAUNCHER_ID],
    },
    solslotPropertyReference: {
      propertyId: '51',
      propertyShareId: 51,
      nftId: 'nft1legacyshare',
      collectionId: 'col1mergedcollection',
      retiredOfferGroupId: 9,
      retiredOfferIds: [74],
    },
    ...overrides,
  };
}
