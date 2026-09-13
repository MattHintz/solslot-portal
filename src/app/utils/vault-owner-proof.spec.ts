import { canonicalOwnedVaultHash, vaultRootCandidates } from './vault-owner-proof';
import { VAULT_OWNER_API_VECTORS } from './vault-owner-api.fixture';

describe('Canonical vault owner commitment', () => {
  for (const vector of VAULT_OWNER_API_VECTORS) {
    it('matches the Python protocol for auth ' + vector.owner.authType + ' and root ' + vector.identityRoot.slice(2, 6), () => {
      expect(canonicalOwnedVaultHash(vector.launcherId, vector.owner, vector.coordinates, vector.identityRoot)).toBe(vector.expectedHash);
    });
  }

  it('binds owner, authentication, launcher, identity root and deployment coordinates', () => {
    const v = VAULT_OWNER_API_VECTORS[0];
    const changed = '0x' + '88'.repeat(32);
    const hashes = [
      canonicalOwnedVaultHash(changed, v.owner, v.coordinates, v.identityRoot),
      canonicalOwnedVaultHash(v.launcherId, { authType: 1, publicKey: '0x' + '55'.repeat(48) }, v.coordinates, v.identityRoot),
      canonicalOwnedVaultHash(v.launcherId, VAULT_OWNER_API_VECTORS[4].owner, v.coordinates, v.identityRoot),
      canonicalOwnedVaultHash(v.launcherId, v.owner, { ...v.coordinates, poolLauncherId: changed }, v.identityRoot),
      canonicalOwnedVaultHash(v.launcherId, v.owner, { ...v.coordinates, bridgePolicyHash: changed }, v.identityRoot),
      canonicalOwnedVaultHash(v.launcherId, v.owner, v.coordinates, changed),
    ];
    hashes.forEach((hash) => expect(hash).not.toBe(v.expectedHash));
  });

  it('extracts candidate atoms from proper and equivalent length encodings', () => {
    const root = '99'.repeat(32);
    expect(vaultRootCandidates('0xffa0' + root + '80')).toEqual(['0x' + root]);
    expect(vaultRootCandidates('0xc020' + root)).toEqual(['0x' + root]);
    expect(vaultRootCandidates('0x80')).toEqual([]);
  });

  it('rejects malformed, trailing, oversize and deeply nested serialized data', () => {
    for (const input of ['0x', '0xff', '0xa099', '0x8080', '0xfe', '0x' + '80'.repeat(65537),
                        '0x' + 'ff'.repeat(513) + '80'.repeat(514)]) {
      expect(() => vaultRootCandidates(input)).toThrow();
    }
  });

  it('rejects missing, cross-type and unsupported owner key encodings', () => {
    const v = VAULT_OWNER_API_VECTORS[0];
    for (const owner of [
      { authType: 3, publicKey: v.owner.publicKey },
      { authType: 1, publicKey: '' },
      { authType: 7, publicKey: v.owner.publicKey },
      { authType: 3, publicKey: '0x04' + '11'.repeat(32) },
    ]) {
      expect(() => canonicalOwnedVaultHash(v.launcherId, owner as any, v.coordinates, v.identityRoot)).toThrow();
    }
  });
});

