import { TestBed } from '@angular/core/testing';
import { SigningKey, Wallet } from 'ethers';
import { AdminWalletAuthService } from './admin-wallet-auth.service';
import { SolslotProtocolArtifactService } from './solslot-protocol-artifact.service';

describe('AdminWalletAuthService', () => {
  const wallet = new Wallet(`0x${'01'.repeat(32)}`);
  const otherWallet = new Wallet(`0x${'02'.repeat(32)}`);
  const pubkey = SigningKey.computePublicKey(wallet.privateKey, true);
  const otherPubkey = SigningKey.computePublicKey(otherWallet.privateKey, true);

  let service: AdminWalletAuthService;
  let artifact: {
    isReady: boolean;
    failure: string;
    adminRoster: string[];
    artifact: { artifactHash: string } | null;
  };

  beforeEach(() => {
    artifact = {
      isReady: true,
      failure: '',
      adminRoster: [pubkey, otherPubkey, `0x03${'44'.repeat(32)}`],
      artifact: { artifactHash: `0x${'ab'.repeat(32)}` },
    };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SolslotProtocolArtifactService,
          useValue: artifact,
        },
      ],
    });
    service = TestBed.inject(AdminWalletAuthService);
  });

  it('produces the canonical SolslotAdminLogin envelope', () => {
    const expiresAt = 1_700_000_000;
    const nonce = `0x${'12'.repeat(32)}`;
    const typedData = service.buildLoginTypedData(expiresAt, nonce);

    expect(typedData.primaryType).toBe('SolslotAdminLogin');
    expect(typedData.domain).toEqual({
      name: 'Solslot Protocol',
      version: '2',
      chainId: 11155111,
    });
    expect(typedData.message).toEqual({
      app: 'Solslot Admin Login',
      artifactHash: `0x${'ab'.repeat(32)}`,
      nonce,
      expires_at: expiresAt,
    });
    expect(typedData.types['SolslotAdminLogin']).toEqual([
      { name: 'app', type: 'string' },
      { name: 'artifactHash', type: 'bytes32' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'expires_at', type: 'uint256' },
    ]);
  });

  it('generates unique 32-byte nonces', () => {
    const values = new Set(Array.from({ length: 100 }, () => service.newNonce()));
    expect(values.size).toBe(100);
    for (const value of values) expect(value).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('accepts a connected key that is in the signed artifact roster', () => {
    const result = service.verifyMembership({
      address: wallet.address,
      pubkey,
    });

    expect(result.ok).toBeTrue();
    if (result.ok) {
      expect(result.strategy).toBe('signed-artifact-roster');
      expect(result.address).toBe(wallet.address.toLowerCase());
      expect(result.pubkey).toBe(pubkey.toLowerCase());
    }
  });

  it('rejects a key that does not derive the connected address', () => {
    const result = service.verifyMembership({
      address: wallet.address,
      pubkey: otherPubkey,
    });

    expect(result.ok).toBeFalse();
    if (!result.ok) expect(result.reason).toBe('identity-mismatch');
  });

  it('rejects a valid connected key that is absent from the roster', () => {
    artifact.adminRoster = [otherPubkey, `0x03${'44'.repeat(32)}`, `0x02${'55'.repeat(32)}`];
    const result = service.verifyMembership({
      address: wallet.address,
      pubkey,
    });

    expect(result.ok).toBeFalse();
    if (!result.ok) expect(result.reason).toBe('pubkey-not-in-roster');
  });

  it('fails closed before the signed artifact is verified', () => {
    artifact.isReady = false;
    artifact.failure = 'artifact signature quorum is unavailable';
    const result = service.verifyMembership({
      address: wallet.address,
      pubkey,
    });

    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.reason).toBe('artifact-unavailable');
      expect(result.message).toContain('signature quorum');
    }
  });
});
