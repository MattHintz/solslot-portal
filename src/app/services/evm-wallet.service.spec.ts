import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import EthereumProvider from '@walletconnect/ethereum-provider';
import { SigningKey, TypedDataEncoder, computeAddress, hashMessage, toUtf8String } from 'ethers';

import { EvmWalletService, _internal } from './evm-wallet.service';
import { environment } from '../../environments/environment';

describe('EvmWalletService', () => {
  const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  function create(): EvmWalletService {
    TestBed.configureTestingModule({});
    return TestBed.inject(EvmWalletService);
  }

  function fakeProvider(accounts: string[] = [walletAddress]) {
    return {
      accounts,
      connect: jasmine.createSpy('connect').and.resolveTo(),
      disconnect: jasmine.createSpy('disconnect').and.resolveTo(),
      on: jasmine.createSpy('on'),
      request: jasmine.createSpy('request'),
    };
  }

  function personalSignMessageFromParam(param: unknown): string {
    const value = String(param ?? '');
    return value.startsWith('0x') ? toUtf8String(value) : value;
  }

  function adminLoginTypedData(chainId = environment.eip712ChainId) {
    return {
      domain: {
        name: 'Solslot Admin Login',
        version: '1',
        chainId,
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        SolslotAdminLogin: [
          { name: 'address', type: 'address' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'SolslotAdminLogin',
      message: {
        address: walletAddress,
        nonce: '0x' + 'ab'.repeat(32),
      },
    };
  }

  it('retries WalletConnect subscribe failures after clearing stale session storage', async () => {
    localStorage.setItem('wc@2:client:0.3//pairing', 'stale');
    localStorage.setItem('@walletconnect/core:topic', 'stale');
    localStorage.setItem('unrelated', 'keep');
    sessionStorage.setItem('walletconnect', 'stale');
    const first = fakeProvider();
    const second = fakeProvider();
    first.connect.and.rejectWith(new Error('Subscribe error: stale pairing topic'));
    const init = spyOn(EthereumProvider, 'init').and.returnValues(
      Promise.resolve(first as unknown as EthereumProvider),
      Promise.resolve(second as unknown as EthereumProvider),
    );
    const service = create();

    const connected = await service.connectWalletConnect();

    expect(init).toHaveBeenCalledTimes(2);
    expect(first.connect).toHaveBeenCalledOnceWith({
      chains: [_internal.evmWalletConnectRequiredChainId()],
    });
    expect(second.connect).toHaveBeenCalledOnceWith({
      chains: [_internal.evmWalletConnectRequiredChainId()],
    });
    const initArgs = init.calls.argsFor(0)[0] as unknown as {
      chains: number[];
      optionalChains: number[];
      rpcMap: Record<number, string>;
    };
    expect(initArgs.chains).toEqual([1]);
    expect(initArgs.optionalChains).toContain(environment.eip712ChainId);
    expect(initArgs.rpcMap[1]).toBeTruthy();
    expect(first.disconnect).toHaveBeenCalled();
    expect(connected.toLowerCase()).toBe(walletAddress.toLowerCase());
    expect(service.isConnected()).toBeTrue();
    expect(localStorage.getItem('wc@2:client:0.3//pairing')).toBeNull();
    expect(localStorage.getItem('@walletconnect/core:topic')).toBeNull();
    expect(sessionStorage.getItem('walletconnect')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('surfaces an actionable WalletConnect relay error after retry failure', async () => {
    localStorage.setItem('wc@2:client:0.3//pairing', 'stale');
    const first = fakeProvider();
    const second = fakeProvider();
    first.connect.and.rejectWith(new Error('Subscribe error: stale pairing topic'));
    second.connect.and.rejectWith(new Error('relay subscribe failed'));
    spyOn(EthereumProvider, 'init').and.returnValues(
      Promise.resolve(first as unknown as EthereumProvider),
      Promise.resolve(second as unknown as EthereumProvider),
    );
    const service = create();

    await expectAsync(service.connectWalletConnect()).toBeRejectedWithError(
      /WalletConnect relay connection failed after clearing stale session state/,
    );

    expect(second.disconnect).toHaveBeenCalled();
    expect(localStorage.getItem('wc@2:client:0.3//pairing')).toBeNull();
  });

  it('keeps staging EIP-712 chains optional in WalletConnect proposals for mobile wallet compatibility', () => {
    expect(_internal.evmWalletConnectRequiredChainId()).toBe(1);
    expect(_internal.evmWalletConnectOptionalChainIds()).toContain(environment.eip712ChainId);
    expect(_internal.evmWalletConnectOptionalChainIds()).not.toContain(1);
    expect(_internal.evmWalletConnectRpcMap()[1]).toBe('https://cloudflare-eth.com');
  });

  it('normalizes the Solslot optional-chain mode', () => {
    expect(_internal.normalizeOptionalChainsMode('solslot')).toBe('solslot');
    expect(_internal.evmWalletConnectOptionalChainIds('solslot')).toEqual(
      _internal.evmWalletConnectOptionalChainIds(),
    );
  });

  it('can build a Tangem-compatible minimal WalletConnect proposal without optional chains', async () => {
    const provider = fakeProvider();
    const init = spyOn(EthereumProvider, 'init').and.returnValue(
      Promise.resolve(provider as unknown as EthereumProvider),
    );
    const service = create();

    await service.connectWalletConnect({ optionalChains: 'none', resetSession: true });

    const initArgs = init.calls.argsFor(0)[0] as unknown as {
      chains: number[];
      customStoragePrefix: string;
      methods: string[];
      optionalChains: number[];
      optionalMethods: string[];
      rpcMap: Record<number, string>;
    };
    expect(initArgs.chains).toEqual([1]);
    expect(initArgs.customStoragePrefix).toBe(_internal.evmWalletConnectStoragePrefix());
    expect(initArgs.methods).toContain('personal_sign');
    expect(initArgs.methods).toContain('eth_sign');
    expect(initArgs.methods).toContain('eth_signTypedData_v4');
    expect(initArgs.optionalChains).toEqual([]);
    expect(initArgs.optionalMethods).toContain('eth_signTypedData_v4');
    expect(Object.keys(initArgs.rpcMap)).toEqual(['1']);
    expect(provider.connect).toHaveBeenCalledOnceWith({ chains: [1] });
  });

  it('does not retry non-relay wallet errors', async () => {
    const provider = fakeProvider();
    provider.connect.and.rejectWith(new Error('User rejected request'));
    const init = spyOn(EthereumProvider, 'init').and.returnValue(
      Promise.resolve(provider as unknown as EthereumProvider),
    );
    const service = create();

    await expectAsync(service.connectWalletConnect()).toBeRejectedWithError(
      /User rejected request/,
    );

    expect(init).toHaveBeenCalledTimes(1);
    expect(provider.disconnect).not.toHaveBeenCalled();
  });

  it('times out a silent injected wallet prompt so callers can retry another path', fakeAsync(() => {
    const service = create();
    const w = window as unknown as { ethereum?: unknown };
    const previous = w.ethereum;
    w.ethereum = {
      request: jasmine.createSpy('request').and.returnValue(new Promise(() => {})),
      on: jasmine.createSpy('on'),
    };
    let rejected: unknown = null;

    service.connectInjected().catch((e) => {
      rejected = e;
    });
    tick(45_001);
    flushMicrotasks();

    expect(rejected).toEqual(jasmine.any(Error));
    expect((rejected as Error).message).toContain('Browser EVM wallet did not respond');
    expect(service.isConnected()).toBeFalse();
    if (previous === undefined) {
      delete w.ethereum;
    } else {
      w.ethereum = previous;
    }
  }));

  it('normalizes Tangem-style numeric eth_chainId responses', () => {
    expect(_internal.normalizeChainIdHex(1)).toBe('0x1');
    expect(_internal.normalizeChainIdHex(1n)).toBe('0x1');
    expect(_internal.normalizeChainIdHex('1')).toBe('0x1');
    expect(_internal.normalizeChainIdHex('0x01')).toBe('0x1');
    expect(_internal.normalizeChainIdHex({ chainId: 1 })).toBe('0x1');
    expect(_internal.normalizeChainIdHex({ result: '0x1' })).toBe('0x1');
  });

  it('builds a single-line personal_sign probe for mobile WalletConnect wallets', () => {
    const probe = _internal.buildAdminRecordsPersonalSignProbe(walletAddress, 1783340000);

    expect(probe).not.toContain('\n');
    expect(probe).toContain('Solslot Admin Records Probe');
    expect(probe).toContain(`address=${walletAddress}`);
    expect(probe).toContain(`chain_id=${environment.eip712ChainId}`);
    expect(probe).toContain('timestamp=1783340000');
  });

  it('does not request a chain switch when eth_chainId returns a number', async () => {
    const service = create();
    const request = jasmine.createSpy('request').and.callFake((args: { method: string }) => {
      if (args.method === 'eth_chainId') return Promise.resolve(1);
      return Promise.resolve(null);
    });
    const testable = service as unknown as {
      eip1193: { request: typeof request };
      ensureChainId: (targetChainId: number) => Promise<void>;
    };
    testable.eip1193 = { request };

    await testable.ensureChainId(1);

    expect(request).toHaveBeenCalledOnceWith({ method: 'eth_chainId' });
  });

  it('signs WalletConnect admin login typed data on the approved Solslot chain without switching', async () => {
    const service = create();
    const signature = '0x' + '11'.repeat(65);
    const walletConnectRequest = jasmine.createSpy('walletConnectRequest').and.resolveTo(signature);
    const fallbackRequest = jasmine.createSpy('fallbackRequest').and.rejectWith(
      new Error('wallet_switchEthereumChain should not be called'),
    );
    const typedData = adminLoginTypedData();
    const chain = `eip155:${environment.eip712ChainId}`;
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof fallbackRequest };
      wcProvider: unknown;
    };
    testable._state.set({
      kind: 'connected',
      address: walletAddress,
      connection: 'walletconnect',
    });
    testable.eip1193 = { request: fallbackRequest };
    testable.wcProvider = {
      signer: {
        request: walletConnectRequest,
        session: {
          namespaces: {
            eip155: {
              chains: [chain],
              methods: ['eth_signTypedData_v4'],
              accounts: [`${chain}:${walletAddress}`],
            },
          },
        },
      },
    };

    const result = await service.signTypedData(typedData);

    expect(result).toBe(signature);
    expect(walletConnectRequest).toHaveBeenCalledOnceWith(
      {
        method: 'eth_signTypedData_v4',
        params: [walletAddress, JSON.stringify(typedData)],
      },
      chain,
      _internal.walletConnectMethodTimeoutSeconds(),
    );
    expect(fallbackRequest).not.toHaveBeenCalled();
  });

  it('tells Tangem operators to reconnect when WalletConnect did not approve Base Sepolia', async () => {
    const service = create();
    const walletConnectRequest = jasmine.createSpy('walletConnectRequest');
    const fallbackRequest = jasmine.createSpy('fallbackRequest');
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof fallbackRequest };
      wcProvider: unknown;
    };
    testable._state.set({
      kind: 'connected',
      address: walletAddress,
      connection: 'walletconnect',
    });
    testable.eip1193 = { request: fallbackRequest };
    testable.wcProvider = {
      signer: {
        request: walletConnectRequest,
        session: {
          namespaces: {
            eip155: {
              chains: ['eip155:1'],
              methods: ['eth_signTypedData_v4'],
              accounts: [`eip155:1:${walletAddress}`],
            },
          },
        },
      },
    };

    await expectAsync(service.signTypedData(adminLoginTypedData())).toBeRejectedWithError(
      /Tangem\/WalletConnect has not approved Base Sepolia/,
    );
    expect(walletConnectRequest).not.toHaveBeenCalled();
    expect(fallbackRequest).not.toHaveBeenCalled();
  });

  it('signs a WalletConnect admin-login fallback message with eth_sign and recovers the pubkey', async () => {
    const privateKey = '0x' + '51'.repeat(32);
    const address = computeAddress(privateKey);
    const signingKey = new SigningKey(privateKey);
    const expectedPubkey = SigningKey.computePublicKey(privateKey, true);
    const service = create();
    const message = 'Solslot Admin Login | chain_id=84532 | nonce=0xabc | local_only=true';
    const request = jasmine.createSpy('request').and.callFake((args: {
      method: string;
      params?: unknown[];
    }) => {
      if (args.method === 'eth_sign') {
        const signedMessage = toUtf8String(String(args.params?.[1] ?? '0x'));
        return Promise.resolve(signingKey.sign(hashMessage(signedMessage)).serialized);
      }
      return Promise.reject(new Error(`unexpected method ${args.method}`));
    });
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
      wcProvider: { request: typeof request };
    };
    testable._state.set({
      kind: 'connected',
      address,
      connection: 'walletconnect',
    });
    testable.eip1193 = { request };
    testable.wcProvider = { request };

    const proof = await service.signAdminLoginMessage(message);

    expect(proof.method).toBe('eth_sign');
    expect(proof.pubkey).toBe(expectedPubkey);
    expect(proof.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(request).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ method: 'eth_sign' }),
      _internal.walletConnectMethodTimeoutSeconds(),
    );
  });

  it('falls back to personal_sign for WalletConnect admin-login fallback messages', async () => {
    const privateKey = '0x' + '52'.repeat(32);
    const address = computeAddress(privateKey);
    const signingKey = new SigningKey(privateKey);
    const expectedPubkey = SigningKey.computePublicKey(privateKey, true);
    const service = create();
    const message = 'Solslot Admin Login | chain_id=84532 | nonce=0xdef | local_only=true';
    const request = jasmine.createSpy('request').and.callFake((args: {
      method: string;
      params?: unknown[];
    }) => {
      if (args.method === 'eth_sign') {
        return Promise.reject(new Error('unsupported method'));
      }
      if (args.method === 'personal_sign') {
        const signedMessage = personalSignMessageFromParam(args.params?.[0]);
        return Promise.resolve(signingKey.sign(hashMessage(signedMessage)).serialized);
      }
      return Promise.reject(new Error(`unexpected method ${args.method}`));
    });
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
      wcProvider: { request: typeof request };
    };
    testable._state.set({
      kind: 'connected',
      address,
      connection: 'walletconnect',
    });
    testable.eip1193 = { request };
    testable.wcProvider = { request };

    const proof = await service.signAdminLoginMessage(message);

    expect(proof.method).toBe('personal_sign');
    expect(proof.pubkey).toBe(expectedPubkey);
    expect(request.calls.allArgs().map(([args]) => args.method)).toEqual([
      'eth_sign',
      'personal_sign',
    ]);
  });

  it('falls back to personal_sign for admin record pubkey recovery when typed data is unsupported', async () => {
    const privateKey = '0x' + '11'.repeat(32);
    const address = computeAddress(privateKey);
    const signingKey = new SigningKey(privateKey);
    const expectedPubkey = SigningKey.computePublicKey(privateKey, true);
    const service = create();
    const request = jasmine.createSpy('request').and.callFake((args: {
      method: string;
      params?: unknown[];
    }) => {
      if (args.method === 'personal_sign') {
        const message = personalSignMessageFromParam(args.params?.[0]);
        return Promise.resolve(signingKey.sign(hashMessage(message)).serialized);
      }
      return Promise.reject(new Error(`unexpected method ${args.method}`));
    });
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
    };
    testable._state.set({
      kind: 'connected',
      address,
      connection: 'injected',
    });
    testable.eip1193 = { request };
    spyOn(service, 'signTypedData').and.rejectWith({
      code: 'UNKNOWN_ERROR',
      error: { code: -32601, message: 'Method not found' },
      payload: { method: 'eth_signTypedData_v4' },
    });

    const recovered = await service.recoverFirstAdminPubkey();

    expect(recovered.address).toBe(address);
    expect(recovered.pubkey).toBe(expectedPubkey);
    expect(request).toHaveBeenCalled();
    const personalSignCall = request.calls
      .allArgs()
      .find(([args]) => args.method === 'personal_sign');
    expect(personalSignCall).toBeDefined();
    expect(String(personalSignCall?.[0].params?.[1]).toLowerCase()).toBe(
      address.toLowerCase(),
    );
  });

  it('uses eth_sign first for WalletConnect admin record pubkey recovery', async () => {
    const privateKey = '0x' + '44'.repeat(32);
    const address = computeAddress(privateKey);
    const signingKey = new SigningKey(privateKey);
    const expectedPubkey = SigningKey.computePublicKey(privateKey, true);
    const service = create();
    const request = jasmine.createSpy('request').and.callFake((args: {
      method: string;
      params?: unknown[];
    }) => {
      if (args.method === 'eth_sign') {
        const hexMessage = String(args.params?.[1] ?? '0x');
        const message = toUtf8String(hexMessage);
        return Promise.resolve(signingKey.sign(hashMessage(message)).serialized);
      }
      return Promise.reject(new Error(`unexpected method ${args.method}`));
    });
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
    };
    testable._state.set({
      kind: 'connected',
      address,
      connection: 'walletconnect',
    });
    testable.eip1193 = { request };
    spyOn(service, 'signTypedData').and.rejectWith(new Error('typed data should not run'));

    const recovered = await service.recoverFirstAdminPubkey();

    expect(recovered.address).toBe(address);
    expect(recovered.pubkey).toBe(expectedPubkey);
    expect(service.signTypedData).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ method: 'eth_sign' }),
    );
    expect(String(request.calls.argsFor(0)[0].params?.[0]).toLowerCase()).toBe(
      address.toLowerCase(),
    );
    const ethSignPayload = String(request.calls.argsFor(0)[0].params?.[1] ?? '');
    expect(toUtf8String(ethSignPayload)).toContain('Solslot Admin Records Probe');
  });

  it('passes WalletConnect request expiry through the provider for admin record recovery', async () => {
    const privateKey = '0x' + '47'.repeat(32);
    const address = computeAddress(privateKey);
    const signingKey = new SigningKey(privateKey);
    const service = create();
    const request = jasmine.createSpy('request').and.callFake((args: {
      method: string;
      params?: unknown[];
    }) => {
      if (args.method === 'eth_sign') {
        const hexMessage = String(args.params?.[1] ?? '0x');
        const message = toUtf8String(hexMessage);
        return Promise.resolve(signingKey.sign(hashMessage(message)).serialized);
      }
      return Promise.reject(new Error(`unexpected method ${args.method}`));
    });
    const fallbackRequest = jasmine.createSpy('fallbackRequest');
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof fallbackRequest };
      wcProvider: { request: typeof request };
    };
    testable._state.set({
      kind: 'connected',
      address,
      connection: 'walletconnect',
    });
    testable.eip1193 = { request: fallbackRequest };
    testable.wcProvider = { request };

    await service.recoverFirstAdminPubkey();

    expect(request).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ method: 'eth_sign' }),
      _internal.walletConnectMethodTimeoutSeconds(),
    );
    expect(fallbackRequest).not.toHaveBeenCalled();
  });

  it('falls back to typed data when WalletConnect message signing is not approved', async () => {
    const privateKey = '0x' + '45'.repeat(32);
    const address = computeAddress(privateKey);
    const signingKey = new SigningKey(privateKey);
    const expectedPubkey = SigningKey.computePublicKey(privateKey, true);
    const service = create();
    const request = jasmine.createSpy('request').and.callFake((args: {
      method: string;
      params?: unknown[];
    }) => {
      if (args.method === 'personal_sign' || args.method === 'eth_sign') {
        return Promise.reject(new Error('method not approved'));
      }
      if (args.method === 'eth_signTypedData_v4') {
        const typedData = JSON.parse(String(args.params?.[1] ?? '{}'));
        const { EIP712Domain: _ignored, ...types } = typedData.types;
        const digest = TypedDataEncoder.hash(typedData.domain, types, typedData.message);
        return Promise.resolve(signingKey.sign(digest).serialized);
      }
      return Promise.reject(new Error(`unexpected method ${args.method}`));
    });
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
    };
    testable._state.set({
      kind: 'connected',
      address,
      connection: 'walletconnect',
    });
    testable.eip1193 = { request };

    const recovered = await service.recoverFirstAdminPubkey();

    expect(recovered.pubkey).toBe(expectedPubkey);
    expect(request.calls.allArgs().map(([args]) => args.method)).toEqual([
      'eth_sign',
      'personal_sign',
      'eth_signTypedData_v4',
    ]);
  });

  it('falls back to personal_sign when Tangem does not return an eth_sign response', fakeAsync(() => {
    const privateKey = '0x' + '46'.repeat(32);
    const address = computeAddress(privateKey);
    const signingKey = new SigningKey(privateKey);
    const expectedPubkey = SigningKey.computePublicKey(privateKey, true);
    const service = create();
    const request = jasmine.createSpy('request').and.callFake((args: {
      method: string;
      params?: unknown[];
    }) => {
      if (args.method === 'eth_sign') {
        return new Promise(() => {});
      }
      if (args.method === 'personal_sign') {
        const message = personalSignMessageFromParam(args.params?.[0]);
        return Promise.resolve(signingKey.sign(hashMessage(message)).serialized);
      }
      return Promise.reject(new Error(`unexpected method ${args.method}`));
    });
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
    };
    testable._state.set({
      kind: 'connected',
      address,
      connection: 'walletconnect',
    });
    testable.eip1193 = { request };
    const recovered = { pubkey: null as string | null };

    service.recoverFirstAdminPubkey().then((value) => {
      recovered.pubkey = value.pubkey;
    });
    tick(75_001);
    flushMicrotasks();
    flushMicrotasks();

    expect(recovered.pubkey).toBe(expectedPubkey);
    expect(request.calls.allArgs().map(([args]) => args.method)).toEqual([
      'eth_sign',
      'personal_sign',
    ]);
  }));

  it('falls back to personal_sign for admin record pubkey recovery when the wallet cannot switch chains', async () => {
    const privateKey = '0x' + '22'.repeat(32);
    const address = computeAddress(privateKey);
    const signingKey = new SigningKey(privateKey);
    const expectedPubkey = SigningKey.computePublicKey(privateKey, true);
    const service = create();
    const request = jasmine.createSpy('request').and.callFake((args: {
      method: string;
      params?: unknown[];
    }) => {
      if (args.method === 'personal_sign') {
        const message = personalSignMessageFromParam(args.params?.[0]);
        return Promise.resolve(signingKey.sign(hashMessage(message)).serialized);
      }
      return Promise.reject(new Error(`unexpected method ${args.method}`));
    });
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
    };
    testable._state.set({
      kind: 'connected',
      address,
      connection: 'injected',
    });
    testable.eip1193 = { request };
    spyOn(service, 'signTypedData').and.rejectWith(
      new Error(
        `Please switch your wallet to Base Sepolia (chainId ${environment.eip712ChainId}) - unsupported network`,
      ),
    );

    const recovered = await service.recoverFirstAdminPubkey();

    expect(recovered.address).toBe(address);
    expect(recovered.pubkey).toBe(expectedPubkey);
    const personalSignCall = request.calls
      .allArgs()
      .find(([args]) => args.method === 'personal_sign');
    expect(personalSignCall).toBeDefined();
  });

  it('times out a silent typed-data admin-record probe', fakeAsync(() => {
    const service = create();
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: jasmine.Spy };
    };
    testable._state.set({
      kind: 'connected',
      address: walletAddress,
      connection: 'injected',
    });
    testable.eip1193 = { request: jasmine.createSpy('request') };
    spyOn(service, 'signTypedData').and.returnValue(new Promise(() => {}));
    let rejected: unknown = null;

    service.recoverFirstAdminPubkey().catch((e) => {
      rejected = e;
    });
    tick(180_001);
    flushMicrotasks();

    expect(rejected).toEqual(jasmine.any(Error));
    expect((rejected as Error).message).toContain('typed-data signature request');
  }));

  it('times out a fully silent WalletConnect admin-record probe sequence', fakeAsync(() => {
    const service = create();
    const request = jasmine.createSpy('request').and.returnValue(new Promise(() => {}));
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
    };
    testable._state.set({
      kind: 'connected',
      address: walletAddress,
      connection: 'walletconnect',
    });
    testable.eip1193 = { request };
    spyOn(service, 'signTypedData').and.rejectWith(new Error('typed data should not run'));
    let rejected: unknown = null;

    service.recoverFirstAdminPubkey().catch((e) => {
      rejected = e;
    });
    flushMicrotasks();
    tick(75_001);
    flushMicrotasks();
    tick(75_001);
    flushMicrotasks();
    tick(75_001);
    flushMicrotasks();

    expect(rejected).toEqual(jasmine.any(Error));
    expect((rejected as Error).message).toContain('typed-data admin-record probe');
    expect(service.signTypedData).not.toHaveBeenCalled();
    expect(request.calls.allArgs().map(([args]) => args.method)).toEqual([
      'eth_sign',
      'personal_sign',
      'eth_signTypedData_v4',
    ]);
  }));
});
