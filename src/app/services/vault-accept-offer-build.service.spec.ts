import { TestBed } from '@angular/core/testing';

import { ACCEPT_OFFER_PROTOCOL_VECTOR } from './accept-offer-vector.fixture';
import {
  VAULT_ACCEPT_OFFER_LOWER_BUILDER,
  VaultAcceptOfferBuildRequest,
  VaultAcceptOfferBuildService,
  VaultAcceptOfferBuilderInput,
  VaultAcceptOfferLowerBuilder,
  VaultAcceptOfferSpendPackage,
} from './vault-accept-offer-build.service';
import {
  ZkPassportAcceptOfferProofService,
  ZkPassportEnrollmentRequiredError,
} from './zkpassport-accept-offer-proof.service';

const vector = ACCEPT_OFFER_PROTOCOL_VECTOR.inputs;
const proofParams = {
  identityAttestRoot: vector.identityAttestRoot,
  attestationLeafHash: vector.attestationLeafHash,
  attestationProof: vector.attestationProof,
};
const VAULT_FULL_PUZZLE_HASH = '0x6ee104b3af5f13601cdf0381136a18b491d9b3d8202891d8992c59a4a61897e0';
const VAULT_COIN_PARENT = '0x' + '99'.repeat(32);
const VAULT_COIN_ID = '0x0aed9a5f9e58c71bee7738685e4fb77b1b35a06d88372884f3c309a1b34cb642';

describe('VaultAcceptOfferBuildService', () => {
  let service: VaultAcceptOfferBuildService;
  let proofService: jasmine.SpyObj<ZkPassportAcceptOfferProofService>;
  let lowerBuilder: jasmine.Spy<VaultAcceptOfferLowerBuilder>;

  beforeEach(() => {
    proofService = jasmine.createSpyObj<ZkPassportAcceptOfferProofService>(
      'ZkPassportAcceptOfferProofService',
      ['withProofParams'],
    );
    lowerBuilder = jasmine.createSpy('vaultAcceptOfferLowerBuilder').and.callFake(
      (input: VaultAcceptOfferBuilderInput) => packageFor(input),
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: ZkPassportAcceptOfferProofService, useValue: proofService },
        { provide: VAULT_ACCEPT_OFFER_LOWER_BUILDER, useValue: lowerBuilder },
      ],
    });
    service = TestBed.inject(VaultAcceptOfferBuildService);
  });

  it('passes zkPassport proof params into the lower-level accept-offer builder', () => {
    const builderInput: VaultAcceptOfferBuilderInput = {
      ...request(),
      ...proofParams,
      signatureData: null,
    };
    (proofService.withProofParams as jasmine.Spy).and.returnValue(builderInput);

    const result = service.build(request());

    expect(proofService.withProofParams).toHaveBeenCalledOnceWith(
      vector.vaultLauncherId,
      jasmine.objectContaining({
        offer: jasmine.objectContaining({
          deedLauncherId: vector.deedLauncherId,
          terms: jasmine.objectContaining({
            tokenAmount: vector.tokenAmount,
          }),
        }),
        poolInnerPuzzleHash: vector.poolInnerPuzzleHash,
        currentTimestamp: vector.currentTimestamp,
        signatureData: null,
      }),
    );
    expect(lowerBuilder).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        identityAttestRoot: vector.identityAttestRoot,
        attestationLeafHash: vector.attestationLeafHash,
        attestationProof: vector.attestationProof,
      }),
    );
    expect(result.status).toBe('unsigned');
    expect(result.backendSigning).toBeFalse();
    expect(result.identityAttestRoot).toBe(vector.identityAttestRoot);
  });

  it('does not call the lower-level builder when zkPassport proof is missing', () => {
    proofService.withProofParams.and.throwError(
      new ZkPassportEnrollmentRequiredError(vector.vaultLauncherId),
    );

    expect(() => service.build(request())).toThrowError(
      ZkPassportEnrollmentRequiredError,
      /enrollment is required/,
    );
    expect(lowerBuilder).not.toHaveBeenCalled();
  });

});

function request(overrides: Partial<VaultAcceptOfferBuildRequest> = {}): VaultAcceptOfferBuildRequest {
  return {
    vaultLauncherId: vector.vaultLauncherId,
    ownerPubkey: vector.ownerPubkey,
    authType: vector.authType,
    membersMerkleRoot: vector.membersMerkleRoot,
    poolLauncherId: vector.poolLauncherId,
    bridgePolicyHash: '0x' + '00'.repeat(32),
    vaultCoin: {
      parentCoinInfo: VAULT_COIN_PARENT,
      puzzleHash: VAULT_FULL_PUZZLE_HASH,
      amount: vector.vaultAmount,
      coinId: VAULT_COIN_ID,
    },
    lineageProof: {
      parentParentCoinInfo: '0x' + '22'.repeat(32),
      parentInnerPuzzleHash: null,
      parentAmount: 1,
    },
    offer: {
      id: 'offer-vector',
      title: 'Vector offer',
      deedLauncherId: vector.deedLauncherId,
      state: 'OP:OFFER_READY',
      terms: {
        deedLauncherId: vector.deedLauncherId,
        tokenAmount: vector.tokenAmount,
        priceMojos: 1,
        acceptedAsset: 'xch',
        expiresAt: null,
      },
      artifact: {
        artifactId: 'artifact-vector',
        deedLauncherId: vector.deedLauncherId,
        artifactHash: null,
        rawOffer: null,
      },
      gatingPolicy: {
        requiresZkPassport: true,
      },
    },
    poolInnerPuzzleHash: vector.poolInnerPuzzleHash,
    currentTimestamp: vector.currentTimestamp,
    signatureData: vector.signatureData,
    ...overrides,
  };
}

function packageFor(input: VaultAcceptOfferBuilderInput): VaultAcceptOfferSpendPackage {
  return {
    status: 'unsigned',
    backendSigning: false,
    spendCase: '0x61',
    authType: input.authType,
    vaultLauncherId: input.vaultLauncherId,
    offerId: input.offer.id,
    offerArtifactId: input.offer.artifact?.artifactId ?? null,
    deedLauncherId: input.offer.terms.deedLauncherId,
    tokenAmount: input.offer.terms.tokenAmount,
    poolInnerPuzzleHash: input.poolInnerPuzzleHash,
    identityAttestRoot: input.identityAttestRoot,
    attestationLeafHash: input.attestationLeafHash,
    attestationProof: input.attestationProof,
    vaultCoin: { ...input.vaultCoin, coinId: input.vaultCoin.coinId ?? VAULT_COIN_ID },
    vaultInnerPuzzleHash: vector.vaultInnerPuzzleHash,
    vaultFullPuzzleHash: VAULT_FULL_PUZZLE_HASH,
    expectedNextVaultCoin: {
      parentCoinInfo: input.vaultCoin.coinId ?? VAULT_COIN_ID,
      puzzleHash: VAULT_FULL_PUZZLE_HASH,
      amount: input.vaultCoin.amount,
      coinId: '0x' + '88'.repeat(32),
    },
    lineageProof: input.lineageProof,
    acceptOfferInnerSolution: ACCEPT_OFFER_PROTOCOL_VECTOR.expected.serializedSolution,
    acceptOfferInnerSolutionTreeHash: ACCEPT_OFFER_PROTOCOL_VECTOR.expected.solutionTreeHash,
    vaultSignatureData: '0x',
    coinSpends: [],
    unsignedSpendBundle: {
      coinSpends: [],
      aggregatedSignature: null,
    },
  };
}
