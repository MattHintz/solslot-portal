import { TestBed } from '@angular/core/testing';

import { ZkPassportProofStoreService, ZkPassportStoredProof } from './zkpassport-proof-store.service';

const VAULT_LAUNCHER_ID = '0x' + '11'.repeat(32);

function proof(overrides: Partial<ZkPassportStoredProof> = {}): ZkPassportStoredProof {
  return {
    vaultLauncherId: VAULT_LAUNCHER_ID,
    vaultSubscope: `vault:${VAULT_LAUNCHER_ID}`,
    identityAttestRoot: '0x' + '22'.repeat(32),
    attestationLeafHash: '0x' + '22'.repeat(32),
    attestationProof: { bitpath: 0, siblings: [] },
    bridgePolicyHash: '0x' + '00'.repeat(32),
    bridgeMessage: '0x' + '33'.repeat(32),
    enrolledAt: 1_700_000_000,
    ...overrides,
  };
}

describe('ZkPassportProofStoreService', () => {
  let service: ZkPassportProofStoreService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ZkPassportProofStoreService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('saves and loads a proof by vault launcher id', () => {
    const saved = service.save(proof());
    expect(service.get(VAULT_LAUNCHER_ID)).toEqual(saved);
  });

  it('normalizes bare hex fields before persistence', () => {
    service.save(
      proof({
        vaultLauncherId: '11'.repeat(32),
        identityAttestRoot: '22'.repeat(32),
        attestationLeafHash: '22'.repeat(32),
        bridgePolicyHash: '00'.repeat(32),
        bridgeMessage: '33'.repeat(32),
        attestationProof: { bitpath: 1, siblings: ['44'.repeat(32)] },
      }),
    );
    const loaded = service.get(VAULT_LAUNCHER_ID);
    expect(loaded?.vaultLauncherId).toBe(VAULT_LAUNCHER_ID);
    expect(loaded?.attestationProof.siblings).toEqual(['0x' + '44'.repeat(32)]);
  });

  it('returns accept-offer proof params for the stored vault proof', () => {
    service.save(proof());
    expect(service.acceptOfferProofParams(VAULT_LAUNCHER_ID)).toEqual({
      identityAttestRoot: '0x' + '22'.repeat(32),
      attestationLeafHash: '0x' + '22'.repeat(32),
      attestationProof: { bitpath: 0, siblings: [] },
    });
  });

  it('returns null when accept-offer proof params are not available', () => {
    expect(service.acceptOfferProofParams(VAULT_LAUNCHER_ID)).toBeNull();
  });

  it('clears a stored proof', () => {
    service.save(proof());
    service.clear(VAULT_LAUNCHER_ID);
    expect(service.get(VAULT_LAUNCHER_ID)).toBeNull();
  });

  it('rejects negative bitpaths', () => {
    expect(() =>
      service.save(proof({ attestationProof: { bitpath: -1, siblings: [] } })),
    ).toThrowError(/bitpath/);
  });
});
