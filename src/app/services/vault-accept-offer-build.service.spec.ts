import { TestBed } from '@angular/core/testing';

import { ACCEPT_OFFER_PROTOCOL_VECTOR } from './accept-offer-vector.fixture';
import {
  VAULT_ACCEPT_OFFER_LOWER_BUILDER,
  VaultAcceptOfferBuildRequest,
  VaultAcceptOfferBuildService,
  VaultAcceptOfferBuilderInput,
  VaultAcceptOfferLowerBuilder,
} from './vault-accept-offer-build.service';
import { ZkPassportProofStoreService } from './zkpassport-proof-store.service';
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
      (input: VaultAcceptOfferBuilderInput) => ({
        state: 'AOSP:PROOF_READY',
        unsignedSpendPackage: null,
        builderInput: input,
      }),
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
        deedLauncherId: vector.deedLauncherId,
        tokenAmount: vector.tokenAmount,
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
    expect(result.state).toBe('AOSP:PROOF_READY');
    expect(result.unsignedSpendPackage).toBeNull();
    expect(result.builderInput.identityAttestRoot).toBe(vector.identityAttestRoot);
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

  it('depends on the accept-offer proof boundary instead of the proof store', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ZkPassportAcceptOfferProofService, useValue: proofService },
        { provide: VAULT_ACCEPT_OFFER_LOWER_BUILDER, useValue: lowerBuilder },
        {
          provide: ZkPassportProofStoreService,
          useFactory: () => {
            throw new Error('direct proof store dependency');
          },
        },
      ],
    });

    expect(() => TestBed.inject(VaultAcceptOfferBuildService)).not.toThrow();
  });
});

function request(overrides: Partial<VaultAcceptOfferBuildRequest> = {}): VaultAcceptOfferBuildRequest {
  return {
    vaultLauncherId: vector.vaultLauncherId,
    deedLauncherId: vector.deedLauncherId,
    tokenAmount: vector.tokenAmount,
    poolInnerPuzzleHash: vector.poolInnerPuzzleHash,
    currentTimestamp: vector.currentTimestamp,
    signatureData: vector.signatureData,
    ...overrides,
  };
}
