import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SigningKey, Wallet } from 'ethers';
import { AdminSessionService } from './admin-session.service';
import { Eip712TypedData } from './solslot-api.service';
import { AdminBackendAuthService } from './admin-backend-auth.service';
import { SolslotProtocolArtifactService } from './solslot-protocol-artifact.service';

describe('AdminSessionService', () => {
  const storageKey = 'solslot_admin_session_v2';
  const artifactHash = `0x${'ab'.repeat(32)}`;
  const wallet = new Wallet(`0x${'01'.repeat(32)}`);
  const secondWallet = new Wallet(`0x${'02'.repeat(32)}`);
  const thirdWallet = new Wallet(`0x${'03'.repeat(32)}`);
  const pubkey = SigningKey.computePublicKey(wallet.privateKey, true);
  const roster = [
    pubkey,
    SigningKey.computePublicKey(secondWallet.privateKey, true),
    SigningKey.computePublicKey(thirdWallet.privateKey, true),
  ];

  let artifact: {
    isReady: boolean;
    failure: string;
    adminRoster: string[];
    artifact: { artifactHash: string } | null;
  };

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    artifact = {
      isReady: true,
      failure: '',
      adminRoster: [...roster],
      artifact: { artifactHash },
    };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('persists only a fully verified EIP-712 session', async () => {
    const service = configure();
    const envelope = await signedEnvelope();

    await expectAsync(
      service.loginWithWallet({
        ...envelope,
        signatureKind: 'eip712',
      }),
    ).toBeResolvedTo(wallet.address.toLowerCase());

    expect(service.requireSession().address).toBe(wallet.address.toLowerCase());
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    expect(stored.schemaVersion).toBe(3);
    expect(stored.protocolVersion).toBe('solslot-v2');
    expect(stored.network).toBe('testnet11');
    expect(stored.signatureKind).toBe('eip712');
    expect(stored.signedMessage).toBeUndefined();
  });

  it('restores the same verified session after a hard refresh', async () => {
    const envelope = await signedEnvelope();
    sessionStorage.setItem(storageKey, JSON.stringify(persisted(envelope)));

    const service = configure();

    expect(service.isAuthenticated()).toBeTrue();
    expect(service.subject()).toBe(wallet.address.toLowerCase());
    expect(service.requireSession().pubkey).toBe(pubkey.toLowerCase());
  });

  it('rejects a cached envelope with a different API scope', async () => {
    const envelope = await signedEnvelope();
    envelope.typedData.message['scope'] = 'viewer';
    sessionStorage.setItem(storageKey, JSON.stringify(persisted(envelope)));

    const service = configure();

    expect(service.isAuthenticated()).toBeFalse();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('rejects a cached signer removed from the signed roster', async () => {
    const envelope = await signedEnvelope();
    sessionStorage.setItem(storageKey, JSON.stringify(persisted(envelope)));
    artifact.adminRoster = roster.slice(1);

    const service = configure();

    expect(service.isAuthenticated()).toBeFalse();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('rejects expired and overlong cached sessions', async () => {
    const expired = await signedEnvelope(Math.floor(Date.now() / 1_000) - 1);
    sessionStorage.setItem(storageKey, JSON.stringify(persisted(expired)));
    expect(configure().isAuthenticated()).toBeFalse();

    TestBed.resetTestingModule();
    const overlong = await signedEnvelope(
      Math.floor(Date.now() / 1_000) + AdminSessionService.MAX_SESSION_SECONDS + 60,
    );
    sessionStorage.setItem(storageKey, JSON.stringify(persisted(overlong)));
    expect(configure().isAuthenticated()).toBeFalse();
  });

  it('ignores all pre-V2 and localStorage administrator state', () => {
    localStorage.setItem('SOLSLOT_ADMIN_SESSION', '{"kind":"authenticated"}');
    localStorage.setItem('solslot_admin_session_v1', '{"kind":"authenticated"}');

    const service = configure();

    expect(service.isAuthenticated()).toBeFalse();
    expect(localStorage.length).toBe(2);
  });

  it('invalidates an active session if its signer leaves the verified roster', async () => {
    const service = configure();
    const envelope = await signedEnvelope();
    await service.loginWithWallet({ ...envelope, signatureKind: 'eip712' });
    artifact.adminRoster = roster.slice(1);

    expect(() => service.requireSession()).toThrowError(
      'Administrator key is not in the signed genesis roster.',
    );
    expect(service.isAuthenticated()).toBeFalse();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  function configure(): AdminSessionService {
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: SolslotProtocolArtifactService, useValue: artifact },
        {
          provide: AdminBackendAuthService,
          useValue: { refresh: jasmine.createSpy('refresh') },
        },
      ],
    });
    return TestBed.inject(AdminSessionService);
  }

  async function signedEnvelope(
    expiresAt = Math.floor(Date.now() / 1_000) + 3_600,
  ): Promise<{
    address: string;
    pubkey: string;
    expiresAt: number;
    signature: string;
    typedData: Eip712TypedData;
    jwt: string;
  }> {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const typedData: Eip712TypedData = {
      domain: {
        name: 'Solslot Protocol',
        version: '2',
        chainId: 11155111,
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        SolslotAdminLogin: [
          { name: 'owner', type: 'address' },
          { name: 'nonce', type: 'bytes32' },
          { name: 'issuedAt', type: 'uint256' },
          { name: 'authType', type: 'string' },
          { name: 'scope', type: 'string' },
        ],
      },
      primaryType: 'SolslotAdminLogin',
      message: {
        owner: wallet.address,
        nonce: `0x${'12'.repeat(32)}`,
        issuedAt,
        authType: 'evm',
        scope: 'admin',
      },
    };
    const signature = await wallet.signTypedData(
      typedData.domain,
      { SolslotAdminLogin: typedData.types['SolslotAdminLogin'] },
      typedData.message,
    );
    return {
      address: wallet.address,
      pubkey,
      expiresAt,
      signature,
      typedData,
      jwt: unsignedJwt(wallet.address, expiresAt),
    };
  }

  function persisted(
    envelope: Awaited<ReturnType<typeof signedEnvelope>>,
  ): Record<string, unknown> {
    return {
      schemaVersion: 3,
      protocolVersion: 'solslot-v2',
      network: 'testnet11',
      signatureKind: 'eip712',
      ...envelope,
    };
  }

  function unsignedJwt(address: string, expiresAt: number): string {
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: address.toLowerCase(),
      scope: 'admin',
      auth_type: 'evm',
      exp: expiresAt,
    })}.test-signature`;
  }
});
