import { TestBed } from '@angular/core/testing';
import EthereumProvider from '@walletconnect/ethereum-provider';
import { SigningKey, hashMessage, toUtf8String } from 'ethers';

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
    expect(first.connect).toHaveBeenCalledOnceWith({ chains: [environment.eip712ChainId] });
    expect(second.connect).toHaveBeenCalledOnceWith({ chains: [environment.eip712ChainId] });
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

  it('normalizes Tangem-style numeric eth_chainId responses', () => {
    expect(_internal.normalizeChainIdHex(1)).toBe('0x1');
    expect(_internal.normalizeChainIdHex(1n)).toBe('0x1');
    expect(_internal.normalizeChainIdHex('1')).toBe('0x1');
    expect(_internal.normalizeChainIdHex('0x01')).toBe('0x1');
    expect(_internal.normalizeChainIdHex({ chainId: 1 })).toBe('0x1');
    expect(_internal.normalizeChainIdHex({ result: '0x1' })).toBe('0x1');
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

  it('falls back to personal_sign for admin record pubkey recovery when typed data is unsupported', async () => {
    const privateKey = '0x' + '11'.repeat(32);
    const signingKey = new SigningKey(privateKey);
    const expectedPubkey = SigningKey.computePublicKey(privateKey, true);
    const service = create();
    const request = jasmine.createSpy('request').and.callFake((args: {
      method: string;
      params?: unknown[];
    }) => {
      if (args.method === 'personal_sign') {
        const hexMessage = String(args.params?.[0] ?? '0x');
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
      address: walletAddress,
      connection: 'walletconnect',
    });
    testable.eip1193 = { request };
    spyOn(service, 'signTypedData').and.rejectWith({
      code: 'UNKNOWN_ERROR',
      error: { code: -32601, message: 'Method not found' },
      payload: { method: 'eth_signTypedData_v4' },
    });

    const recovered = await service.recoverFirstAdminPubkey();

    expect(recovered.address).toBe(walletAddress);
    expect(recovered.pubkey).toBe(expectedPubkey);
    expect(request).toHaveBeenCalled();
    const personalSignCall = request.calls
      .allArgs()
      .find(([args]) => args.method === 'personal_sign');
    expect(personalSignCall).toBeDefined();
    expect(String(personalSignCall?.[0].params?.[1]).toLowerCase()).toBe(
      walletAddress.toLowerCase(),
    );
  });
});
