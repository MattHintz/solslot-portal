import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { AdminWalletAuthService } from './admin-wallet-auth.service';

/**
 * Tests for the wallet-signed admin auth verifier.
 *
 * Coverage:
 *   * EIP-712 envelope shape (domain, types, primaryType, message).
 *   * Nonce generation (length + prefix + uniqueness).
 *   * Membership verification \u2014 the env-address-allowlist path
 *     (the MIPS-root path requires WASM and is exercised by the
 *     end-to-end Eip712LeafHashService spec instead).
 *   * Failure-mode branches: ``no-admins-configured``,
 *     ``address-not-in-allowlist``, and the precedence rule that
 *     the MIPS root check is consulted first when pinned.
 *
 * Each test mutates ``environment.populisProtocol`` directly and
 * resets it on teardown so cases don't leak state across the suite.
 */
describe('AdminWalletAuthService', () => {
  // Sample identity pair (test fixture only \u2014 no on-chain meaning).
  const SAMPLE_ADDRESS = '0x0e61d3bb1148bdd802f747caea112333d156626a';
  const SAMPLE_PUBKEY =
    '0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

  let service: AdminWalletAuthService;
  let originalConfig: typeof environment.populisProtocol;

  beforeEach(() => {
    originalConfig = { ...environment.populisProtocol };
    TestBed.configureTestingModule({});
    service = TestBed.inject(AdminWalletAuthService);
  });

  afterEach(() => {
    // Reset env mutations so other specs see the original values.
    Object.assign(environment.populisProtocol, originalConfig);
  });

  describe('buildLoginTypedData', () => {
    it('produces the canonical PopulisAdminLogin envelope', () => {
      const expiresAt = 1_700_000_000;
      const nonce =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const td = service.buildLoginTypedData(expiresAt, nonce);

      expect(td.primaryType).toBe('PopulisAdminLogin');
      expect(td.domain).toEqual({
        name: 'Populis Admin Login',
        version: '1',
        chainId: environment.eip712ChainId,
      });
      expect(td.types['PopulisAdminLogin']).toEqual([
        { name: 'app', type: 'string' },
        { name: 'nonce', type: 'bytes32' },
        { name: 'expires_at', type: 'uint256' },
      ]);
      expect(td.message).toEqual({
        app: 'Populis Admin Login',
        nonce,
        expires_at: expiresAt,
      });
    });
  });

  describe('newNonce', () => {
    it('returns a 0x-prefixed 32-byte hex string', () => {
      const n = service.newNonce();
      expect(n).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('produces unique values across calls', () => {
      // 1000 nonces from a CSPRNG should never collide \u2014 if they do,
      // the RNG is broken and we want this test to fail loudly.
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) seen.add(service.newNonce());
      expect(seen.size).toBe(1000);
    });
  });

  describe('defaultExpiresAt', () => {
    it('returns now + SESSION_TTL_SECONDS, in unix-seconds', () => {
      const before = Math.floor(Date.now() / 1_000);
      const expiresAt = service.defaultExpiresAt();
      const after = Math.floor(Date.now() / 1_000);
      // Allow a 1-second window for clock movement during the call.
      expect(expiresAt).toBeGreaterThanOrEqual(
        before + AdminWalletAuthService.SESSION_TTL_SECONDS,
      );
      expect(expiresAt).toBeLessThanOrEqual(
        after + AdminWalletAuthService.SESSION_TTL_SECONDS,
      );
    });
  });

  describe('verifyMembership \u2014 env address allowlist path', () => {
    beforeEach(() => {
      // Force the env-allowlist path by clearing any pinned MIPS root.
      environment.populisProtocol.adminAuthorityV2MipsRootHash = '';
    });

    it('returns ok when the address is in the allowlist', () => {
      environment.populisProtocol.adminAuthorityV2AdminAddresses = [SAMPLE_ADDRESS];
      const r = service.verifyMembership({
        address: SAMPLE_ADDRESS,
        pubkey: SAMPLE_PUBKEY,
      });
      expect(r.ok).toBeTrue();
      if (r.ok) {
        expect(r.strategy).toBe('address-allowlist');
        expect(r.address).toBe(SAMPLE_ADDRESS);
        expect(r.pubkey).toBe(SAMPLE_PUBKEY);
      }
    });

    it('matches case-insensitively + with/without 0x prefix', () => {
      environment.populisProtocol.adminAuthorityV2AdminAddresses = [
        SAMPLE_ADDRESS.toUpperCase().replace('0X', '0x'),
      ];
      // Caller's input is bare hex; verifier should still accept and
      // echo back the canonical 0x-prefixed lowercase form.
      const bare = SAMPLE_ADDRESS.slice(2).toUpperCase();
      const r = service.verifyMembership({
        address: bare,
        pubkey: SAMPLE_PUBKEY,
      });
      expect(r.ok).toBeTrue();
      if (r.ok) expect(r.address).toBe(SAMPLE_ADDRESS);
    });

    it('returns address-not-in-allowlist when missing', () => {
      environment.populisProtocol.adminAuthorityV2AdminAddresses = [
        '0xdeadbeef'.padEnd(42, '0'),
      ];
      const r = service.verifyMembership({
        address: SAMPLE_ADDRESS,
        pubkey: SAMPLE_PUBKEY,
      });
      expect(r.ok).toBeFalse();
      if (!r.ok) {
        expect(r.reason).toBe('address-not-in-allowlist');
        expect(r.message).toContain(SAMPLE_ADDRESS);
      }
    });

    it('returns no-admins-configured when both sources are empty', () => {
      environment.populisProtocol.adminAuthorityV2AdminAddresses = [];
      const r = service.verifyMembership({
        address: SAMPLE_ADDRESS,
        pubkey: SAMPLE_PUBKEY,
      });
      expect(r.ok).toBeFalse();
      if (!r.ok) {
        expect(r.reason).toBe('no-admins-configured');
        expect(r.message).toContain('environment.ts');
      }
    });
  });

  describe('verifyMembership \u2014 MIPS root precedence', () => {
    it('falls through to the allowlist when MIPS root is empty', () => {
      environment.populisProtocol.adminAuthorityV2MipsRootHash = '';
      environment.populisProtocol.adminAuthorityV2AdminAddresses = [SAMPLE_ADDRESS];
      const r = service.verifyMembership({
        address: SAMPLE_ADDRESS,
        pubkey: SAMPLE_PUBKEY,
      });
      expect(r.ok).toBeTrue();
      if (r.ok) expect(r.strategy).toBe('address-allowlist');
    });

    it('uses MIPS root when pinned (allowlist is ignored even if matching)', () => {
      // Pin an obviously-wrong MIPS root.  The verifier won't fall
      // through to the allowlist \u2014 a pinned root is authoritative
      // and a mismatch is fail-closed.  WASM may or may not be
      // ready in the karma harness; either way the result must be
      // not-ok with reason in {mips-root-mismatch, wasm-error}.
      environment.populisProtocol.adminAuthorityV2MipsRootHash =
        '0x' + '11'.repeat(32);
      environment.populisProtocol.adminAuthorityV2AdminAddresses = [SAMPLE_ADDRESS];
      const r = service.verifyMembership({
        address: SAMPLE_ADDRESS,
        pubkey: SAMPLE_PUBKEY,
      });
      expect(r.ok).toBeFalse();
      if (!r.ok) {
        expect(['mips-root-mismatch', 'wasm-error']).toContain(r.reason);
      }
    });
  });
});
