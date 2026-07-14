import {
  classifyVaultVersion,
  computeCanonicalParamsHash,
  computeContentHash,
  isVaultCurrent,
  RegistryState,
} from './vault-version-detection';

/**
 * Cross-language pin: every hash here is the EXACT value produced by
 * ``solslot_puzzles.vault_version_registry_driver`` in Python.  If the portal
 * and protocol ever diverge, outdated detection silently breaks — so these
 * vectors are the contract.
 *
 * Generated with (from solslot_protocol, that venv):
 *   compute_canonical_params_hash(0x71*32, 0x72*32, 0x73*32, 0x74*32)
 *   compute_content_hash(0xc3*32, 0xd4*32, 1)
 */
describe('vault-version-detection', () => {
  // 32-byte hex of a single repeated byte.
  const b = (n: number): string =>
    '0x' + n.toString(16).padStart(2, '0').repeat(32);

  describe('computeCanonicalParamsHash (Python cross-language vectors)', () => {
    it('matches the Python gold vector for 0x71/0x72/0x73/0x74', () => {
      expect(computeCanonicalParamsHash(b(0x71), b(0x72), b(0x73), b(0x74))).toBe(
        '0x63a6166002ebbce06bcd7043edf7a3c580b8ecdc63c65ab2960f06ed70bf8a4f',
      );
    });

    it('is order-sensitive (swapping two params changes the hash)', () => {
      expect(computeCanonicalParamsHash(b(0x72), b(0x71), b(0x73), b(0x74))).not.toBe(
        computeCanonicalParamsHash(b(0x71), b(0x72), b(0x73), b(0x74)),
      );
    });

    it('changes when any single param changes', () => {
      const base = computeCanonicalParamsHash(b(0x71), b(0x72), b(0x73), b(0x74));
      expect(computeCanonicalParamsHash(b(0x99), b(0x72), b(0x73), b(0x74))).not.toBe(base);
      expect(computeCanonicalParamsHash(b(0x71), b(0x99), b(0x73), b(0x74))).not.toBe(base);
      expect(computeCanonicalParamsHash(b(0x71), b(0x72), b(0x99), b(0x74))).not.toBe(base);
      expect(computeCanonicalParamsHash(b(0x71), b(0x72), b(0x73), b(0x99))).not.toBe(base);
    });

    it('rejects a non-32-byte param', () => {
      expect(() => computeCanonicalParamsHash('0x71', b(0x72), b(0x73), b(0x74))).toThrowError();
    });
  });

  describe('computeContentHash (Python cross-language vector)', () => {
    it('matches the Python gold vector for 0xc3/0xd4/version 1', () => {
      expect(computeContentHash(b(0xc3), b(0xd4), 1)).toBe(
        '0xd52cc295fb4b637ce08d5f0ed6c7dde73827add04dfb094571ef8bbd45c57b57',
      );
    });

    it('changes with the version (replay/downgrade guard)', () => {
      expect(computeContentHash(b(0xc3), b(0xd4), 2)).not.toBe(
        computeContentHash(b(0xc3), b(0xd4), 1),
      );
    });
  });

  describe('isVaultCurrent / classifyVaultVersion', () => {
    const registry: RegistryState = {
      vaultInnerModHash: b(0xaa),
      canonicalParamsHash: b(0xbb),
      vaultVersion: 3,
    };

    it('is CURRENT only when both code and params match', () => {
      expect(isVaultCurrent(registry, b(0xaa), b(0xbb))).toBeTrue();
      expect(isVaultCurrent(registry, b(0xaa), b(0x00))).toBeFalse();
      expect(isVaultCurrent(registry, b(0x00), b(0xbb))).toBeFalse();
    });

    it('comparison is case-insensitive / 0x-prefix tolerant', () => {
      expect(isVaultCurrent(registry, 'AA'.repeat(32), '0xBB'.repeat(1) + 'bb'.repeat(31))).toBeTrue();
    });

    it('classifies the divergence reason', () => {
      expect(classifyVaultVersion(registry, b(0xaa), b(0xbb))).toEqual({
        kind: 'current',
        registryVersion: 3,
      });
      // Params drift — e.g. the bridge-policy-hash bug.
      expect(classifyVaultVersion(registry, b(0xaa), b(0xcc))).toEqual({
        kind: 'outdated',
        reason: 'params',
        registryVersion: 3,
      });
      // Code drift — a new vault module.
      expect(classifyVaultVersion(registry, b(0xcc), b(0xbb))).toEqual({
        kind: 'outdated',
        reason: 'code',
        registryVersion: 3,
      });
      // Both.
      expect(classifyVaultVersion(registry, b(0xcc), b(0xdd))).toEqual({
        kind: 'outdated',
        reason: 'both',
        registryVersion: 3,
      });
    });
  });
});
