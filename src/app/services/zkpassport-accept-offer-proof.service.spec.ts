import { TestBed } from '@angular/core/testing';

import { ZkPassportProofStoreService, ZkPassportStoredProof } from './zkpassport-proof-store.service';
import {
  ZkPassportAcceptOfferProofService,
  ZkPassportEnrollmentRequiredError,
} from './zkpassport-accept-offer-proof.service';

const VAULT_LAUNCHER_ID = '0x' + '11'.repeat(32);

function proof(overrides: Partial<ZkPassportStoredProof> = {}): ZkPassportStoredProof {
  return {
    vaultLauncherId: VAULT_LAUNCHER_ID,
    vaultSubscope: `vault:${VAULT_LAUNCHER_ID}`,
    identityAttestRoot: '0x' + '22'.repeat(32),
    attestationLeafHash: '0x' + '33'.repeat(32),
    attestationProof: { bitpath: 1, siblings: ['0x' + '44'.repeat(32)] },
    bridgePolicyHash: '0x' + '55'.repeat(32),
    bridgeMessage: '0x' + '66'.repeat(32),
    enrolledAt: 1_700_000_000,
    ...overrides,
  };
}

describe('ZkPassportAcceptOfferProofService', () => {
  let service: ZkPassportAcceptOfferProofService;
  let proofStore: ZkPassportProofStoreService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ZkPassportAcceptOfferProofService);
    proofStore = TestBed.inject(ZkPassportProofStoreService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('injects stored proof params into accept-offer builder input', () => {
    proofStore.save(proof());
    const built = service.withProofParams(VAULT_LAUNCHER_ID, {
      deedLauncherId: '0x' + '77'.repeat(32),
      tokenAmount: 100,
    });
    expect(built).toEqual({
      deedLauncherId: '0x' + '77'.repeat(32),
      tokenAmount: 100,
      identityAttestRoot: '0x' + '22'.repeat(32),
      attestationLeafHash: '0x' + '33'.repeat(32),
      attestationProof: { bitpath: 1, siblings: ['0x' + '44'.repeat(32)] },
    });
  });

  it('passes injected proof params to an accept-offer builder', () => {
    proofStore.save(proof());
    const builder = jasmine.createSpy('acceptOfferBuilder').and.callFake((input: Record<string, unknown>) => ({
      receivedRoot: input['identityAttestRoot'],
      receivedLeaf: input['attestationLeafHash'],
      receivedProof: input['attestationProof'],
    }));
    const result = service.buildWithProof(
      VAULT_LAUNCHER_ID,
      { deedLauncherId: '0x' + '77'.repeat(32) },
      builder,
    );
    expect(builder).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      identityAttestRoot: '0x' + '22'.repeat(32),
      attestationLeafHash: '0x' + '33'.repeat(32),
      attestationProof: { bitpath: 1, siblings: ['0x' + '44'.repeat(32)] },
    }));
    expect(result.receivedRoot).toBe('0x' + '22'.repeat(32));
  });

  it('blocks accept-offer building with an enrollment-required error when proof is missing', () => {
    const builder = jasmine.createSpy('acceptOfferBuilder');
    expect(() =>
      service.buildWithProof(
        VAULT_LAUNCHER_ID,
        { deedLauncherId: '0x' + '77'.repeat(32) },
        builder,
      ),
    ).toThrowError(ZkPassportEnrollmentRequiredError, /enrollment is required/);
    expect(builder).not.toHaveBeenCalled();
  });
});
