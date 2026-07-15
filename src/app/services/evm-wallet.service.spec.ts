import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import EthereumProvider from '@walletconnect/ethereum-provider';
import { SigningKey, TypedDataEncoder, computeAddress } from 'ethers';

import { environment } from '../../environments/environment';
import { EvmWalletService, _internal } from './evm-wallet.service';

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

  function adminLoginTypedData(chainId = environment.eip712ChainId) {
    return {
      domain: {
        name: environment.eip712Name,
        version: environment.eip712Version,
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

  it('retries WalletConnect relay failures after clearing stale session state', async () => {
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
      chains: [environment.eip712ChainId],
    });
    expect(second.connect).toHaveBeenCalledOnceWith({
      chains: [environment.eip712ChainId],
    });
    const initArgs = init.calls.argsFor(0)[0] as unknown as {
      chains: number[];
      methods: string[];
      optionalChains: number[];
      rpcMap: Record<number, string>;
    };
    expect(initArgs.chains).toEqual([environment.eip712ChainId]);
    expect(initArgs.optionalChains).toEqual([]);
    expect(initArgs.methods).toEqual(['eth_signTypedData', 'eth_signTypedData_v4']);
    expect(initArgs.rpcMap[environment.eip712ChainId]).toBeTruthy();
    expect(first.disconnect).toHaveBeenCalled();
    expect(connected.toLowerCase()).toBe(walletAddress.toLowerCase());
    expect(service.isConnected()).toBeTrue();
    expect(localStorage.getItem('wc@2:client:0.3//pairing')).toBeNull();
    expect(localStorage.getItem('@walletconnect/core:topic')).toBeNull();
    expect(sessionStorage.getItem('walletconnect')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('surfaces an actionable WalletConnect relay error after retry failure', async () => {
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
  });

  it('does not retry a user rejection', async () => {
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

  it('uses a fresh V2 WalletConnect namespace and requires Sepolia with typed data only', async () => {
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
    expect(initArgs.chains).toEqual([environment.eip712ChainId]);
    expect(initArgs.customStoragePrefix).toBe('solslot-admin-v2');
    expect(initArgs.methods).toEqual(['eth_signTypedData', 'eth_signTypedData_v4']);
    expect(initArgs.methods).not.toContain('personal_sign');
    expect(initArgs.methods).not.toContain('eth_sign');
    expect(initArgs.optionalChains).toEqual([]);
    expect(initArgs.optionalMethods).toEqual(initArgs.methods);
    expect(Object.keys(initArgs.rpcMap)).toEqual([String(environment.eip712ChainId)]);
    expect(provider.connect).toHaveBeenCalledOnceWith({
      chains: [environment.eip712ChainId],
    });
  });

  it('keeps both WalletConnect proposal modes on the one frozen V2 chain', () => {
    expect(_internal.evmWalletConnectRequiredChainId()).toBe(environment.eip712ChainId);
    expect(_internal.evmWalletConnectOptionalChainIds('solslot')).toEqual([]);
    expect(_internal.evmWalletConnectOptionalChainIds('none')).toEqual([]);
    expect(_internal.evmWalletConnectRpcMap()).toEqual({
      [environment.eip712ChainId]: 'https://ethereum-sepolia-rpc.publicnode.com',
    });
  });

  it('times out a silent injected-wallet connection prompt', fakeAsync(() => {
    const service = create();
    const target = window as unknown as { ethereum?: unknown };
    const previous = target.ethereum;
    target.ethereum = {
      request: jasmine.createSpy('request').and.returnValue(new Promise(() => {})),
      on: jasmine.createSpy('on'),
    };
    let rejected: unknown = null;

    service.connectInjected().catch((error) => {
      rejected = error;
    });
    tick(45_001);
    flushMicrotasks();

    expect(rejected).toEqual(jasmine.any(Error));
    expect((rejected as Error).message).toContain('Browser EVM wallet did not respond');
    expect(service.isConnected()).toBeFalse();
    if (previous === undefined) delete target.ethereum;
    else target.ethereum = previous;
  }));

  it('normalizes numeric and wrapped chain identifiers', () => {
    expect(_internal.normalizeChainIdHex(1)).toBe('0x1');
    expect(_internal.normalizeChainIdHex(1n)).toBe('0x1');
    expect(_internal.normalizeChainIdHex('11155111')).toBe('0xaa36a7');
    expect(_internal.normalizeChainIdHex({ result: '0xaa36a7' })).toBe('0xaa36a7');
  });

  it('signs typed data through the approved Sepolia WalletConnect namespace', async () => {
    const service = create();
    const signature = '0x' + '11'.repeat(65);
    const walletConnectRequest = jasmine.createSpy('walletConnectRequest').and.resolveTo(signature);
    const fallbackRequest = jasmine.createSpy('fallbackRequest');
    const typedData = adminLoginTypedData();
    const chain = `eip155:${environment.eip712ChainId}`;
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof fallbackRequest };
      wcProvider: unknown;
    };
    testable._state.set({ kind: 'connected', address: walletAddress, connection: 'walletconnect' });
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

    expect(await service.signTypedData(typedData)).toBe(signature);
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

  it('rejects a stale WalletConnect session that did not approve Sepolia', async () => {
    const service = create();
    const request = jasmine.createSpy('request');
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
      wcProvider: unknown;
    };
    testable._state.set({ kind: 'connected', address: walletAddress, connection: 'walletconnect' });
    testable.eip1193 = { request };
    testable.wcProvider = {
      signer: {
        request,
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
      /has not approved Sepolia/,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses typed data outside the frozen Solslot V2 Sepolia domain', async () => {
    const service = create();
    const request = jasmine.createSpy('request');
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
    };
    testable._state.set({ kind: 'connected', address: walletAddress, connection: 'injected' });
    testable.eip1193 = { request };

    await expectAsync(service.signTypedData(adminLoginTypedData(1))).toBeRejectedWithError(
      /Refusing EIP-712 data outside Solslot Protocol v2 on Sepolia/,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('recovers an admin public key from EIP-712 only', async () => {
    const privateKey = '0x' + '45'.repeat(32);
    const address = computeAddress(privateKey);
    const signingKey = new SigningKey(privateKey);
    const expectedPubkey = SigningKey.computePublicKey(privateKey, true);
    const service = create();
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: jasmine.Spy };
    };
    testable._state.set({ kind: 'connected', address, connection: 'injected' });
    testable.eip1193 = { request: jasmine.createSpy('request') };
    const signer = spyOn(service, 'signTypedData').and.callFake(async (typedData) => {
      expect(typedData.primaryType).toBe('SolslotAdminKeyProbe');
      expect(typedData.domain).toEqual(
        jasmine.objectContaining({
          name: environment.eip712Name,
          version: environment.eip712Version,
          chainId: environment.eip712ChainId,
        }),
      );
      const { EIP712Domain: _ignored, ...types } = typedData.types;
      return signingKey.sign(
        TypedDataEncoder.hash(typedData.domain, types, typedData.message),
      ).serialized;
    });

    const recovered = await service.recoverFirstAdminPubkey();

    expect(recovered).toEqual({ address, pubkey: expectedPubkey });
    expect(signer).toHaveBeenCalledTimes(1);
  });

  it('rejects a key probe signed by a different wallet', async () => {
    const connectedKey = '0x' + '46'.repeat(32);
    const otherKey = new SigningKey('0x' + '47'.repeat(32));
    const address = computeAddress(connectedKey);
    const service = create();
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: jasmine.Spy };
    };
    testable._state.set({ kind: 'connected', address, connection: 'injected' });
    testable.eip1193 = { request: jasmine.createSpy('request') };
    spyOn(service, 'signTypedData').and.callFake(async (typedData) => {
      const { EIP712Domain: _ignored, ...types } = typedData.types;
      return otherKey.sign(
        TypedDataEncoder.hash(typedData.domain, types, typedData.message),
      ).serialized;
    });

    await expectAsync(service.recoverFirstAdminPubkey()).toBeRejectedWithError(
      /recovered a different EVM address/,
    );
  });

  it('times out a silent EIP-712 key probe without trying message signing', fakeAsync(() => {
    const service = create();
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: jasmine.Spy };
    };
    testable._state.set({ kind: 'connected', address: walletAddress, connection: 'injected' });
    testable.eip1193 = { request: jasmine.createSpy('request') };
    spyOn(service, 'signTypedData').and.returnValue(new Promise(() => {}));
    let rejected: unknown = null;

    service.recoverFirstAdminPubkey().catch((error) => {
      rejected = error;
    });
    tick(180_001);
    flushMicrotasks();

    expect(rejected).toEqual(jasmine.any(Error));
    expect((rejected as Error).message).toContain('Sepolia EIP-712 key request');
    expect(testable.eip1193.request).not.toHaveBeenCalled();
  }));
});
