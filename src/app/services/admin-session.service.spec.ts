import { environment } from '../../environments/environment';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SigningKey, Wallet } from 'ethers';
import { AdminSessionService } from './admin-session.service';
import { Eip712TypedData } from './solslot-api.service';
import { AdminBackendAuthService } from './admin-backend-auth.service';
import { SolslotProtocolArtifactService } from './solslot-protocol-artifact.service';

describe('AdminSessionService', () => {
  const storageKey = 'solslot_admin_session_v3';
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
    artifact: { artifactHash: string; evmChainId: number; identityChain?: { chainId: number } } | null;
  };

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    artifact = {
      isReady: true,
      failure: '',
      adminRoster: [...roster],
      artifact: { artifactHash, evmChainId: 11155111 },
    };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('isolates new-generation admin signatures, API tokens, and saved sessions', async()=>{
    const runtime=environment.solslotProtocol as {generationId?: string};
    const prior=runtime.generationId, generation='0x'+'cd'.repeat(32);
    const old=await signedEnvelope();
    sessionStorage.setItem(storageKey,JSON.stringify(persisted(old)));
    try {
      runtime.generationId=generation;
      const service=configure();
      expect(service.isAuthenticated()).toBeFalse();
      expect(sessionStorage.getItem(storageKey)).toBeTruthy();
      await expectAsync(service.loginWithWallet({...old,signatureKind:'eip712'})).toBeRejectedWithError(/envelope/);
      const envelope=await signedEnvelope(undefined,11155111,generation);
      await expectAsync(service.loginWithWallet({...envelope,jwt:old.jwt,signatureKind:'eip712'})).toBeRejectedWithError(/API session/);
      await service.loginWithWallet({...envelope,signatureKind:'eip712'});
      expect(service.requireSession().address).toBe(wallet.address.toLowerCase());
      TestBed.resetTestingModule();
      expect(configure().isAuthenticated()).toBeTrue();
      runtime.generationId='0x'+'ef'.repeat(32);
      TestBed.resetTestingModule();
      expect(configure().isAuthenticated()).toBeFalse();
      expect(sessionStorage.getItem(storageKey)).toBeTruthy();
    } finally {if(prior===undefined) delete runtime.generationId; else runtime.generationId=prior;}
  });

  it('persists only a fully verified EIP-712 session', async () => {
    const service = configure();
    const envelope = await signedEnvelope();

    await expectAsync(
      service.loginWithWallet({
        ...envelope,
        signatureKind: 'eip712',
        authoritySlot: 0,
      }),
    ).toBeResolvedTo(wallet.address.toLowerCase());

    expect(service.requireSession().address).toBe(wallet.address.toLowerCase());
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    expect(stored.schemaVersion).toBe(4);
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

  it('keeps an unexpired API session usable after the challenge signing window', async () => {
    const now = Date.now();
    const service = configure();
    const envelope = await signedEnvelope(Math.floor(now / 1000) + 900);
    await service.loginWithWallet({ ...envelope, signatureKind: 'eip712' });
    spyOn(Date, 'now').and.returnValue(now + 11 * 60 * 1000);
    expect(service.requireJwt()).toBe(envelope.jwt);
    TestBed.resetTestingModule();
    expect(configure().requireSession().address).toBe(wallet.address.toLowerCase());
  });

  it('still rejects a stale challenge when establishing a new session', async () => {
    const now = Date.now();
    const envelope = await signedEnvelope(Math.floor(now / 1000) + 900);
    spyOn(Date, 'now').and.returnValue(now + 11 * 60 * 1000);
    await expectAsync(configure().loginWithWallet({ ...envelope, signatureKind: 'eip712' }))
      .toBeRejectedWithError('Administrator login envelope is invalid.');
  });

  it('does not extend the API token expiry when reusing a signed envelope', async () => {
    const now = Date.now();
    const envelope = await signedEnvelope(Math.floor(now / 1000) + 900);
    const service = configure();
    await service.loginWithWallet({ ...envelope, signatureKind: 'eip712' });
    spyOn(Date, 'now').and.returnValue(now + 16 * 60 * 1000);
    expect(() => service.requireSession()).toThrowError('Administrator session expiry is invalid.');
    expect(service.isAuthenticated()).toBeFalse();
  });

  for (const operationalChain of [84532, 8453]) {
    it(`accepts and restores signed logins on operational chain ${operationalChain} with Base identity`, async () => {
      artifact.artifact = { artifactHash, evmChainId: operationalChain, identityChain: { chainId: 8453 } };
      const service = configure();
      const envelope = await signedEnvelope(undefined, operationalChain);
      await expectAsync(service.loginWithWallet({ ...envelope, signatureKind: 'eip712' }))
        .toBeResolvedTo(wallet.address.toLowerCase());
      TestBed.resetTestingModule();
      expect(configure().requireSession().address).toBe(wallet.address.toLowerCase());
    });

    for (const signedChain of [11155111, 84532, 8453].filter(chain => chain !== operationalChain)) {
      it(`rejects a valid chain ${signedChain} signature when the release uses ${operationalChain}`, async () => {
        artifact.artifact = { artifactHash, evmChainId: operationalChain, identityChain: { chainId: 8453 } };
        const envelope = await signedEnvelope(undefined, signedChain);
        const service = configure();
        await expectAsync(service.loginWithWallet({ ...envelope, signatureKind: 'eip712' }))
          .toBeRejectedWithError('Administrator login envelope is invalid.');
        sessionStorage.setItem(storageKey, JSON.stringify(persisted(envelope)));
        TestBed.resetTestingModule();
        expect(configure().isAuthenticated()).toBeFalse();
        expect(sessionStorage.getItem(storageKey)).toBeNull();
      });
    }
  }

  it('invalidates a cached session when the verified operational chain changes', async () => {
    artifact.artifact = { artifactHash, evmChainId: 84532 };
    const service = configure();
    await service.loginWithWallet({ ...await signedEnvelope(undefined, 84532), signatureKind: 'eip712' });
    artifact.artifact = { artifactHash, evmChainId: 8453 };
    expect(() => service.requireSession()).toThrowError('Administrator login envelope is invalid.');
    expect(service.isAuthenticated()).toBeFalse();
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
    await service.loginWithWallet({
      ...envelope,
      signatureKind: 'eip712',
      authoritySlot: 0,
    });
    artifact.adminRoster = roster.slice(1);

    expect(() => service.requireSession()).toThrowError(
      'Administrator key is not in the signed genesis roster.',
    );
    expect(service.isAuthenticated()).toBeFalse();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  for (const status of [0, 503, 429]) {
    it(`retains an unexpired session across transient refresh ${status}`, async () => {
      const service = configure(), envelope = await signedEnvelope();
      await service.loginWithWallet({...envelope, signatureKind: 'eip712'});
      const backend = TestBed.inject(AdminBackendAuthService);
      (backend.refresh as jasmine.Spy).and.rejectWith(new HttpErrorResponse({status}));
      await (service as any).refreshApiSession();
      expect(service.isAuthenticated()).toBeTrue();
      expect(service.requireJwt()).toBe(envelope.jwt);
      expect(service.connectionNotice()).toContain('Reconnecting');
    });
  }
  it('clears a session when the server rejects refresh credentials', async () => {
    const service = configure(), envelope = await signedEnvelope();
    await service.loginWithWallet({...envelope, signatureKind: 'eip712'});
    (TestBed.inject(AdminBackendAuthService).refresh as jasmine.Spy).and.rejectWith(new HttpErrorResponse({status:401}));
    await (service as any).refreshApiSession();
    expect(service.isAuthenticated()).toBeFalse();
  });
  it('never resurrects a session logged out during an in-flight refresh', async () => {
    const service = configure(), envelope = await signedEnvelope();
    await service.loginWithWallet({...envelope, signatureKind: 'eip712'});
    let finish!: (value: any) => void;
    (TestBed.inject(AdminBackendAuthService).refresh as jasmine.Spy).and.returnValue(new Promise(resolve => finish = resolve));
    const refreshing = (service as any).refreshApiSession();
    service.logout();
    finish({jwt: envelope.jwt, expires_at: envelope.expiresAt, authority_slot: 0});
    await refreshing;
    expect(service.isAuthenticated()).toBeFalse();
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
    chainId = 11155111,
    generation: string | null = null,
  ): Promise<{
    address: string;
    pubkey: string;
    expiresAt: number;
    signature: string;
    typedData: Eip712TypedData;
    jwt: string;
    authoritySlot: 0;
  }> {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const typedData: Eip712TypedData = {
      domain: {
        name: 'Solslot Protocol',
        version: '2',
        chainId,
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
    if (generation) {
      typedData.types['SolslotAdminLogin'].push({name:'generationId',type:'bytes32'});
      typedData.message['generationId']=generation;
    }
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
      jwt: unsignedJwt(wallet.address, pubkey, expiresAt, generation),
      authoritySlot: 0,
    };
  }

  function persisted(
    envelope: Awaited<ReturnType<typeof signedEnvelope>>,
  ): Record<string, unknown> {
    return {
      schemaVersion: 4,
      protocolVersion: 'solslot-v2',
      network: 'testnet11',
      signatureKind: 'eip712',
      ...envelope,
    };
  }

  function unsignedJwt(address: string, compressedPubkey: string, expiresAt: number, generation: string | null = null): string {
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: address.toLowerCase(),
      scope: 'admin',
      auth_type: 'evm',
      authority_slot: 0,
      ...(generation ? {generation_id:generation} : {}),
      compressed_pubkey: compressedPubkey.toLowerCase(),
      exp: expiresAt,
    })}.test-signature`;
  }
});
