import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import EthereumProvider from '@walletconnect/ethereum-provider';
import { SigningKey, TypedDataEncoder, computeAddress } from 'ethers';

import { environment } from '../../environments/environment';
import { EvmWalletService, _internal } from './evm-wallet.service';

describe('EvmWalletService', () => {
  const originalOperationalChain = environment.eip712ChainId;
  const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';

  afterEach(() => {
    environment.eip712ChainId = originalOperationalChain;
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

  function safeMessageTypedData(
    safe = '0x73a282e829dF5b7E12824a53F54c2FB6f07D13a5',
  ) {
    return {
      domain: {
        chainId: 84532,
        verifyingContract: safe,
      },
      types: {
        SafeMessage: [{ name: 'message', type: 'bytes' }],
      },
      primaryType: 'SafeMessage',
      message: {
        message: '0x1901' + '11'.repeat(64),
      },
    };
  }

  function safeTransactionTypedData(
    safe = '0x73a282e829dF5b7E12824a53F54c2FB6f07D13a5',
  ) {
    return {
      domain: {
        chainId: 84532,
        verifyingContract: safe,
      },
      types: {
        SafeTx: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'operation', type: 'uint8' },
          { name: 'safeTxGas', type: 'uint256' },
          { name: 'baseGas', type: 'uint256' },
          { name: 'gasPrice', type: 'uint256' },
          { name: 'gasToken', type: 'address' },
          { name: 'refundReceiver', type: 'address' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      primaryType: 'SafeTx',
      message: {
        to: '0xb7e02C216A2B3aF0cC4Ad8808fA169f2F0B19724',
        value: 0,
        data: '0x6a761202',
        operation: 0,
        safeTxGas: 0,
        baseGas: 0,
        gasPrice: 0,
        gasToken: '0x0000000000000000000000000000000000000000',
        refundReceiver: '0x0000000000000000000000000000000000000000',
        nonce: 4,
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
    expect(initArgs.optionalChains).toEqual([84532, 8453]);
    expect(initArgs.methods).toEqual(['eth_signTypedData', 'eth_signTypedData_v4']);
    expect(initArgs.rpcMap[environment.eip712ChainId]).toBeTruthy();
    expect(initArgs.rpcMap[84532]).toBe('https://sepolia.base.org');
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

  it('supports Base mainnet and legacy Base Sepolia WalletConnect chains', () => {
    expect(_internal.evmWalletConnectRequiredChainId()).toBe(environment.eip712ChainId);
    expect(_internal.evmWalletConnectOptionalChainIds('solslot')).toEqual([84532, 8453]);
    expect(_internal.evmWalletConnectOptionalChainIds('none')).toEqual([]);
    expect(_internal.evmWalletConnectRpcMap()).toEqual({
      [environment.eip712ChainId]: 'https://ethereum-sepolia-rpc.publicnode.com',
      84532: 'https://sepolia.base.org',
      8453: 'https://mainnet.base.org',
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

  for (const authorityChain of [84532, 8453]) it(`signs only the exact Base SafeMessage through its approved namespace on ${authorityChain}`, async () => {
    environment.eip712ChainId = authorityChain;
    const service = create();
    const signature = '0x' + '11'.repeat(64) + '1b';
    const request = jasmine.createSpy('request').and.resolveTo(signature);
    const typedData = safeMessageTypedData();
    typedData.domain.chainId = authorityChain;
    const chain = `eip155:${authorityChain}`;
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
              chains: [chain],
              methods: ['eth_signTypedData_v4'],
              accounts: [`${chain}:${walletAddress}`],
            },
          },
        },
      },
    };

    expect(await service.signSafeMessage(typedData, typedData.domain.verifyingContract)).toBe(
      signature,
    );
    expect(request).toHaveBeenCalledOnceWith(
      {
        method: 'eth_signTypedData_v4',
        params: [walletAddress, JSON.stringify(typedData)],
      },
      chain,
      _internal.walletConnectMethodTimeoutSeconds(),
    );

    request.calls.reset();
    const crossed = {...typedData, domain: {...typedData.domain, chainId: authorityChain === 8453 ? 84532 : 8453}};
    await expectAsync(service.signSafeMessage(crossed, typedData.domain.verifyingContract)).toBeRejected();
    expect(request).not.toHaveBeenCalled();

    const altered = {
      ...typedData,
      message: { message: typedData.message.message, target: walletAddress },
    };
    await expectAsync(
      service.signSafeMessage(altered, typedData.domain.verifyingContract),
    ).toBeRejectedWithError(/Refusing altered Base authority SafeMessage/);
  });

  for (const authorityChain of [84532, 8453]) it(`signs only an exact zero-value Authority V3 Identity Safe transaction on ${authorityChain}`, async () => {
    environment.eip712ChainId = authorityChain;
    const service = create();
    const signature = '0x' + '12'.repeat(64) + '1b';
    const request = jasmine.createSpy('request').and.resolveTo(signature);
    const typedData = safeTransactionTypedData();
    typedData.domain.chainId = authorityChain;
    const chain = `eip155:${authorityChain}`;
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
              chains: [chain],
              methods: ['eth_signTypedData_v4'],
              accounts: [`${chain}:${walletAddress}`],
            },
          },
        },
      },
    };

    expect(
      await service.signAuthorityV3SafeTransaction(typedData, {
        safe: typedData.domain.verifyingContract,
        transaction: typedData.message,
      }),
    ).toBe(signature);

    const altered = {
      ...typedData,
      message: { ...typedData.message, value: 1 },
    };
    await expectAsync(
      service.signAuthorityV3SafeTransaction(altered, {
        safe: typedData.domain.verifyingContract,
        transaction: typedData.message,
      }),
    ).toBeRejectedWithError(/Refusing altered Authority V3 Identity Safe/);
  });

  for (const authorityChain of [84532, 8453]) it(`broadcasts only a byte-exact zero-value Base transaction on ${authorityChain}`, async () => {
    environment.eip712ChainId = authorityChain;
    const service = create();
    const transactionHash = '0x' + '99'.repeat(32);
    const request = jasmine.createSpy('request').and.resolveTo(transactionHash);
    const chain = `eip155:${authorityChain}`;
    const to = '0xb7e02C216A2B3aF0cC4Ad8808fA169f2F0B19724';
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
              chains: [chain],
              methods: ['eth_sendTransaction'],
              accounts: [`${chain}:${walletAddress}`],
            },
          },
        },
      },
    };

    expect(
      await service.sendBaseSepoliaTransaction({
        chainId: authorityChain,
        to,
        value: '0x0',
        data: '0x6a761202',
      }),
    ).toBe(transactionHash);
    expect(request).toHaveBeenCalledOnceWith(
      {
        method: 'eth_sendTransaction',
        params: [
          {
            from: walletAddress,
            to,
            value: '0x0',
            data: '0x6a761202',
          },
        ],
      },
      chain,
      _internal.walletConnectMethodTimeoutSeconds(),
    );

    await expectAsync(
      service.sendBaseSepoliaTransaction({
        chainId: authorityChain,
        to,
        value: '0x1',
        data: '0x6a761202',
      }),
    ).toBeRejectedWithError(/Refusing an altered Base authority protocol transaction/);
  });

  it('refuses typed data outside the allowed Solslot Sepolia domains', async () => {
    const service = create();
    const request = jasmine.createSpy('request');
    const testable = service as unknown as {
      _state: { set: (state: unknown) => void };
      eip1193: { request: typeof request };
    };
    testable._state.set({ kind: 'connected', address: walletAddress, connection: 'injected' });
    testable.eip1193 = { request };

    await expectAsync(service.signTypedData(adminLoginTypedData(1))).toBeRejectedWithError(
      /Refusing unrecognized Solslot EIP-712 data on chain 11155111/,
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

describe('Server-selected launch signing boundary', () => {
  const hash=(byte:string)=>'0x'+byte.repeat(32);
  const domainFields=[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'}];
  function plan():any { return {domain:{name:'Solslot Protocol',version:'2',chainId:84532},primaryType:'SolslotGenesisPlan',
    types:{EIP712Domain:domainFields,SolslotGenesisPlan:[{name:'ceremonyId',type:'bytes32'},{name:'rosterHash',type:'bytes32'},
      {name:'planHash',type:'bytes32'},{name:'network',type:'string'},{name:'expiresAt',type:'uint64'}]},
    message:{ceremonyId:hash('11'),rosterHash:hash('22'),planHash:hash('33'),network:'testnet11',expiresAt:1900000000}}; }
  const binding={ceremonyId:hash('11'),evmChainId:84532,planHash:hash('33')};
  function service() { TestBed.configureTestingModule({}); const s=TestBed.inject(EvmWalletService);
    const sign=spyOn<any>(s,'signTypedDataOnChain').and.resolveTo('synthetic-signature');return {s,sign}; }
  it('signs only the exact server-selected Base Sepolia plan through its narrow signer',async()=>{
    const {s,sign}=service();const data=plan();await s.signLaunchCeremony(data,binding);expect(sign).toHaveBeenCalledOnceWith(data,84532);
  });
  for(const change of ['chain','ceremony','plan','domain','primary','extra','expired']) it(`rejects altered ${change} before wallet dispatch`,async()=>{
    const {s,sign}=service();const data=plan();
    if(change==='chain')data.domain.chainId=11155111;
    if(change==='ceremony')data.message.ceremonyId=hash('55');
    if(change==='plan')data.message.planHash=hash('56');
    if(change==='domain')data.domain.name='Unrelated';
    if(change==='primary')data.primaryType='SolslotAdminLogin';
    if(change==='extra')data.message.extra='x';
    if(change==='expired')data.message.expiresAt=1;
    await expectAsync(s.signLaunchCeremony(data,binding)).toBeRejected();expect(sign).not.toHaveBeenCalled();
  });
});
