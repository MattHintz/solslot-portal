import { Injectable, signal, computed } from '@angular/core';
import EthereumProvider from '@walletconnect/ethereum-provider';
import {
  BrowserProvider,
  Eip1193Provider,
  SigningKey,
  TypedDataEncoder,
  computeAddress,
  getAddress,
  getBytes,
} from 'ethers';
import { environment } from '../../environments/environment';
import { Eip712TypedData } from './solslot-api.service';

const WALLET_CONNECT_PROMPT_TIMEOUT_MS = 45_000;
// WalletConnect v2 validates request expiry as 300..604800 seconds.
// Keep the local UX timeout shorter, but publish requests with the protocol minimum.
const WALLET_CONNECT_REQUEST_EXPIRY_SECONDS = 300;
const EVM_SIGNATURE_PROMPT_TIMEOUT_MS = 180_000;
const EVM_WALLETCONNECT_STORAGE_PREFIX = 'solslot-admin-v2';
const EVM_WALLETCONNECT_SIGNING_METHODS = [
  'eth_signTypedData',
  'eth_signTypedData_v4',
];
const EVM_WALLETCONNECT_REQUIRED_CHAIN_ID = environment.eip712ChainId;
const EVM_WALLETCONNECT_KNOWN_RPC_MAP: Record<number, string> = {
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
};
type EvmWalletConnectOptionalChainsMode = 'solslot' | 'none';
export interface EvmWalletConnectOptions {
  optionalChains?: EvmWalletConnectOptionalChainsMode;
  resetSession?: boolean;
}

/**
 * EVM wallet service.
 *
 * Connects to either an injected provider (MetaMask, Coinbase Wallet, Rabby) or
 * to a remote wallet via WalletConnect v2.  Exposes a reactive state signal +
 * helpers for signing the Solslot registration EIP-712 message and recovering
 * the signer's 33-byte compressed secp256k1 public key.
 *
 * The recovered pubkey is what we curry into the vault singleton as OWNER_PUBKEY
 * (AUTH_TYPE_SECP256K1 = 3).  It is purely derived from the signature — the
 * wallet never exposes it directly.
 */
@Injectable({ providedIn: 'root' })
export class EvmWalletService {
  /** Reactive connection state. */
  private readonly _state = signal<EvmState>({ kind: 'disconnected' });
  readonly state = this._state.asReadonly();

  readonly address = computed(() => {
    const s = this._state();
    return s.kind === 'connected' ? s.address : null;
  });
  readonly isConnected = computed(() => this._state().kind === 'connected');
  readonly connectionKind = computed(() => {
    const s = this._state();
    return s.kind === 'connected' ? s.connection : null;
  });

  private eip1193: Eip1193Provider | null = null;
  private wcProvider: EthereumProvider | null = null;
  private wcInitPromise: Promise<EthereumProvider> | null = null;
  private wcOptionalChainsMode: EvmWalletConnectOptionalChainsMode | null = null;
  private wcDebugUnsubscribers: Array<() => void> = [];

  /** True when an injected EVM provider is available (MetaMask, etc.). */
  hasInjectedProvider(): boolean {
    return typeof window !== 'undefined' && !!(window as WindowWithEth).ethereum;
  }

  /**
   * Connect via injected provider (window.ethereum).  Triggers the wallet's
   * permission modal.  Throws on rejection.
   */
  async connectInjected(): Promise<string> {
    const eth = (window as WindowWithEth).ethereum;
    if (!eth) throw new Error('No injected EVM wallet detected (MetaMask, Coinbase, etc.)');

    const accounts = (await withWalletPromptTimeout(
      eth.request({
        method: 'eth_requestAccounts',
      }) as Promise<unknown>,
      WALLET_CONNECT_PROMPT_TIMEOUT_MS,
      'Browser EVM wallet did not respond. Close any stale wallet popup, then retry or use WalletConnect.',
    )) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error('Wallet returned no accounts');
    }
    const address = getAddress(accounts[0]);
    this.eip1193 = eth as unknown as Eip1193Provider;
    this._state.set({ kind: 'connected', address, connection: 'injected' });
    this.bindInjectedEvents(eth);
    return address;
  }

  /**
   * Connect via WalletConnect v2.  Opens the WC QR modal in desktop browsers.
   * Requires `environment.walletConnectProjectId` to be set.
   */
  async connectWalletConnect(options: EvmWalletConnectOptions = {}): Promise<string> {
    const projectId = environment.walletConnectProjectId;
    if (!projectId) {
      throw new Error(
        'WalletConnect projectId is not configured.  Set environment.walletConnectProjectId ' +
          'to a value from https://cloud.walletconnect.com'
      );
    }
    const optionalChainsMode = normalizeOptionalChainsMode(options.optionalChains);
    if (options.resetSession || this.wcOptionalChainsMode !== optionalChainsMode) {
      await this.resetWalletConnectProvider();
      this.clearWalletConnectStorage();
    }

    this.debugWalletConnect('connect:start', {
      optionalChainsMode,
      resetSession: !!options.resetSession,
    });
    try {
      return await this.connectWalletConnectOnce(optionalChainsMode);
    } catch (e) {
      this.debugWalletConnect('connect:error', debugErrorInfo(e));
      if (!isWalletConnectRecoverableError(e)) {
        throw e;
      }
      await this.resetWalletConnectProvider();
      this.clearWalletConnectStorage();
      this.debugWalletConnect('connect:retry-after-clear', { optionalChainsMode });
      try {
        return await this.connectWalletConnectOnce(optionalChainsMode);
      } catch (retryError) {
        this.debugWalletConnect('connect:retry-error', debugErrorInfo(retryError));
        await this.resetWalletConnectProvider();
        this.clearWalletConnectStorage();
        throw new Error(walletConnectRelayErrorMessage(retryError));
      }
    }
  }

  private async connectWalletConnectOnce(
    optionalChainsMode: EvmWalletConnectOptionalChainsMode,
  ): Promise<string> {
    const provider = await this.getOrInitWcProvider(optionalChainsMode);
    this.debugWalletConnect('connect:provider-ready', this.walletConnectSessionDebugInfo());
    await withWalletPromptTimeout(
      provider.connect({ chains: [evmWalletConnectRequiredChainId()] }),
      WALLET_CONNECT_PROMPT_TIMEOUT_MS,
      'WalletConnect did not respond. Close the modal, then retry with a fresh QR code.',
    );
    this.debugWalletConnect('connect:provider-connect-resolved', this.walletConnectSessionDebugInfo());
    const accounts = provider.accounts || [];
    if (accounts.length === 0) {
      throw new Error('WalletConnect returned no accounts');
    }
    const address = getAddress(accounts[0]);
    this.eip1193 = provider as unknown as Eip1193Provider;
    this._state.set({ kind: 'connected', address, connection: 'walletconnect' });
    return address;
  }

  private async getOrInitWcProvider(
    optionalChainsMode: EvmWalletConnectOptionalChainsMode,
  ): Promise<EthereumProvider> {
    if (this.wcProvider) return this.wcProvider;
    if (this.wcInitPromise) return this.wcInitPromise;
    this.wcOptionalChainsMode = optionalChainsMode;

    this.wcInitPromise = EthereumProvider.init({
      projectId: environment.walletConnectProjectId,
      customStoragePrefix: EVM_WALLETCONNECT_STORAGE_PREFIX,
      // The admin surface is bound to the frozen V2 Sepolia artifact. Requiring
      // that chain at session creation prevents a mainnet-only session from
      // appearing connected and failing later at the signature boundary.
      chains: [evmWalletConnectRequiredChainId()],
      methods: EVM_WALLETCONNECT_SIGNING_METHODS,
      optionalChains: evmWalletConnectOptionalChainIds(optionalChainsMode),
      rpcMap: evmWalletConnectRpcMap(optionalChainsMode),
      showQrModal: true,
      optionalMethods: EVM_WALLETCONNECT_SIGNING_METHODS,
      optionalEvents: ['accountsChanged', 'chainChanged'],
      metadata: {
        name: 'Solslot Portal',
        description: 'Solslot Protocol members portal — testnet',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://solslot.com',
        icons: [],
      },
    }).then((p) => {
      this.wcProvider = p;
      p.on('disconnect', () => this.handleDisconnect());
      p.on('accountsChanged', (...args: unknown[]) => {
        const accounts = (args[0] as string[]) ?? [];
        this.debugWalletConnect('event:accountsChanged', {
          accounts: accounts.map(redactAddress),
        });
        if (accounts.length === 0) {
          this.handleDisconnect();
        } else {
          this._state.set({
            kind: 'connected',
            address: getAddress(accounts[0]),
            connection: 'walletconnect',
          });
        }
      });
      p.on('chainChanged', (...args: unknown[]) => {
        this.debugWalletConnect('event:chainChanged', { value: args[0] });
      });
      p.on('display_uri', () => {
        this.debugWalletConnect('event:display_uri', { redacted: true });
      });
      this.bindWalletConnectDebugEvents(p);
      return p;
    });
    return this.wcInitPromise;
  }

  private bindInjectedEvents(eth: InjectedEthereum): void {
    eth.on?.('accountsChanged', (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      if (accounts.length === 0) {
        this.handleDisconnect();
      } else {
        this._state.set({
          kind: 'connected',
          address: getAddress(accounts[0]),
          connection: 'injected',
        });
      }
    });
    eth.on?.('disconnect', () => this.handleDisconnect());
  }

  private handleDisconnect(): void {
    this._state.set({ kind: 'disconnected' });
    this.eip1193 = null;
  }

  async disconnect(): Promise<void> {
    await this.resetWalletConnectProvider();
    try {
      this.clearWalletConnectStorage();
    } catch {}
    this.handleDisconnect();
  }

  private async resetWalletConnectProvider(): Promise<void> {
    const provider = this.wcProvider;
    this.wcDebugUnsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {}
    });
    this.wcDebugUnsubscribers = [];
    this.wcProvider = null;
    this.wcInitPromise = null;
    this.wcOptionalChainsMode = null;
    if (provider) {
      try {
        await provider.disconnect();
      } catch {}
    }
  }

  private clearWalletConnectStorage(): void {
    const stores = [localStorage, sessionStorage];
    for (const s of stores) {
      const toRemove: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && isWalletConnectStorageKey(k)) toRemove.push(k);
      }
      toRemove.forEach((k) => s.removeItem(k));
    }
  }

  /**
   * Sign an EIP-712 typed data payload.  Returns the 65-byte (r,s,v) signature
   * as a 0x-prefixed hex string.
   *
   * `typedData` must be a fully-formed EIP-712 structure matching
   * `SOLSLOT_VAULT_TYPEHASH_STRING` from solslot_puzzles/vault_driver.py:
   *   SolslotVaultSpend(bytes32 spend_case, bytes32 deed_launcher_id, bytes32 vault_coin_id)
   *
   * For vault registration we reuse the same typehash with `spend_case = 0x...REGISTER`
   * and `deed_launcher_id = vault_coin_id = zero_bytes32`.
   *
   * MetaMask enforces that `domain.chainId` equals the wallet's active chain —
   * otherwise it throws "Provided chainId X must match the active chainId Y".
   * We therefore request a network switch to the typed-data domain chain before
   * signing. The signature is never submitted as an Ethereum transaction, so no
   * gas is spent on that EVM chain.
   */
  async signTypedData(typedData: Eip712TypedData): Promise<string> {
    if (!this.eip1193) throw new Error('Not connected');
    const address = this.address();
    if (!address) throw new Error('Not connected');

    const domain = typedData.domain as unknown as {
      name?: string;
      version?: string;
      chainId?: number | string;
    };
    const targetChainId = Number(domain.chainId);
    if (
      domain.name !== environment.eip712Name ||
      domain.version !== environment.eip712Version ||
      targetChainId !== environment.eip712ChainId
    ) {
      throw new Error(
        `Refusing EIP-712 data outside ${environment.eip712Name} v${environment.eip712Version} ` +
          `on Sepolia (${environment.eip712ChainId}).`,
      );
    }
    if (this.connectionKind() === 'walletconnect') {
      return this.signTypedDataViaWalletConnectChain(typedData, address, targetChainId);
    }
    await this.ensureChainId(targetChainId);

    const provider = new BrowserProvider(this.eip1193);
    const signer = await provider.getSigner(address);

    // ethers v6 signTypedData expects (domain, types without EIP712Domain, message).
    const { EIP712Domain: _ignored, ...signingTypes } = typedData.types as Record<
      string,
      Array<{ name: string; type: string }>
    >;
    const signature = await signer.signTypedData(
      typedData.domain as unknown as Record<string, unknown>,
      signingTypes,
      typedData.message
    );
    return signature;
  }

  private async signTypedDataViaWalletConnectChain(
    typedData: Eip712TypedData,
    address: string,
    targetChainId: number,
  ): Promise<string> {
    const chain = formatWalletConnectChainId(targetChainId);
    const provider = this.wcProvider as unknown as WalletConnectDebugProvider | null;
    if (!provider?.signer?.request) {
      throw new Error('WalletConnect provider is not ready. Disconnect and reconnect the wallet.');
    }
    if (!walletConnectSessionSupportsChain(provider, chain)) {
      throw new Error(
        `Tangem/WalletConnect has not approved ${evmChainDisplayName(targetChainId)} (${chain}) ` +
          `for this Solslot Portal session. Delete the stale Solslot Portal WalletConnect ` +
          `session, then reconnect and approve ` +
          `${chain}. This admin login is still only a local EIP-712 signature; it broadcasts ` +
          `nothing and costs no gas.`,
      );
    }

    const payload = JSON.stringify(typedData);
    const timeoutMessage =
      `Tangem/WalletConnect did not return the ${evmChainDisplayName(targetChainId)} ` +
      `typed-data signature. Open Tangem, approve the Solslot Portal request for ${chain}, ` +
      `or delete the stale session and reconnect.`;
    try {
      this.debugWalletConnect('typed-data:walletconnect-chain-request', {
        method: 'eth_signTypedData_v4',
        chain,
        address: redactAddress(address),
      });
      return await withWalletPromptTimeout(
        this.requestWalletConnectChain(
          {
            method: 'eth_signTypedData_v4',
            params: [address, payload],
          },
          chain,
          WALLET_CONNECT_REQUEST_EXPIRY_SECONDS,
        ),
        EVM_SIGNATURE_PROMPT_TIMEOUT_MS,
        timeoutMessage,
      ) as string;
    } catch (e) {
      this.debugWalletConnect('typed-data:walletconnect-chain-error', {
        method: 'eth_signTypedData_v4',
        chain,
        ...debugErrorInfo(e),
      });
      if (!isUnsupportedTypedDataError(e)) throw e;
    }

    this.debugWalletConnect('typed-data:walletconnect-chain-fallback', {
      from: 'eth_signTypedData_v4',
      to: 'eth_signTypedData',
      chain,
      address: redactAddress(address),
    });
    return await withWalletPromptTimeout(
      this.requestWalletConnectChain(
        {
          method: 'eth_signTypedData',
          params: [address, payload],
        },
        chain,
        WALLET_CONNECT_REQUEST_EXPIRY_SECONDS,
      ),
      EVM_SIGNATURE_PROMPT_TIMEOUT_MS,
      timeoutMessage,
    ) as string;
  }

  /**
   * Ensure the active wallet chain equals `targetChainId`.  If not, request
   * a switch via EIP-3326 `wallet_switchEthereumChain`. The portal never adds
   * networks on the operator's behalf; Sepolia must already be available.
   */
  private async ensureChainId(targetChainId: number): Promise<void> {
    if (!this.eip1193) throw new Error('Not connected');
    const hexChain = '0x' + targetChainId.toString(16);
    let currentHex: string | null = null;
    try {
      currentHex = normalizeChainIdHex(
        await this.eip1193.request({ method: 'eth_chainId' }),
      );
    } catch {}
    if (currentHex && currentHex.toLowerCase() === hexChain.toLowerCase()) return;

    try {
      await this.eip1193.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChain }],
      });
      return;
    } catch (err: unknown) {
      const chainLabel = evmChainDisplayName(targetChainId);
      throw new Error(
        `Please switch your wallet to ${chainLabel} (chainId ${targetChainId}) — ` +
          `this Solslot EIP-712 signature is bound to that chain id. ` +
          `This does NOT send any transaction and costs nothing. (${
            (err as Error).message ?? 'switch rejected'
          })`
      );
    }
  }

  /**
   * Recover the 33-byte compressed secp256k1 public key from an EIP-712 signature.
   *
   * This is the value Solslot curries into the vault singleton as OWNER_PUBKEY.
   * We perform it on the client for UX ("your Solslot public key is 0x...") —
   * the backend re-runs the same recovery to authoritatively bind the address
   * to the pubkey before launching the vault.
   */
  recoverCompressedPubkey(typedData: Eip712TypedData, signature: string): string {
    const { EIP712Domain: _ignored, ...signingTypes } = typedData.types as Record<
      string,
      Array<{ name: string; type: string }>
    >;
    const digest = TypedDataEncoder.hash(
      typedData.domain as unknown as Record<string, unknown>,
      signingTypes,
      typedData.message
    );
    const uncompressedHex = SigningKey.recoverPublicKey(digest, signature);
    return compressSecp256k1Pubkey(uncompressedHex);
  }

  private recoverCompressedPubkeyForAddress(
    typedData: Eip712TypedData,
    signature: string,
    expectedAddress: string,
  ): string {
    const { EIP712Domain: _ignored, ...signingTypes } = typedData.types as Record<
      string,
      Array<{ name: string; type: string }>
    >;
    const digest = TypedDataEncoder.hash(
      typedData.domain as unknown as Record<string, unknown>,
      signingTypes,
      typedData.message
    );
    return recoverCompressedPubkeyFromDigestForAddress(digest, signature, expectedAddress);
  }

  /**
   * Sign a deterministic EIP-712 probe and return the recovered compressed
   * secp256k1 public key. This helper remains for admin-record forms that need
   * the wallet public key, but it has no message-signing compatibility path.
   *
   * The probe is structurally distinct from the admin sign-in
   * challenge (different ``primaryType``) so a wallet pop-up can't
   * confuse the two — but uses the configured Solslot EIP-712 chain binding
   * so wallet prompts remain scoped to the same deployment domain.
   *
   * The signature is consumed locally for key recovery. Wallets that cannot
   * approve the frozen V2 Sepolia EIP-712 domain are not eligible admin wallets.
   */
  async recoverFirstAdminPubkey(): Promise<{
    pubkey: string;
    address: string;
  }> {
    const address = this.address();
    if (!address) {
      throw new Error('No wallet connected — connect first.');
    }

    // Build the probe.  ``timestamp`` makes the digest unique per
    // call so a previously-signed probe can't be replayed; the
    // wallet still shows a single-shot signature prompt.
    const probe: Eip712TypedData = {
      domain: {
        name: environment.eip712Name,
        version: environment.eip712Version,
        chainId: environment.eip712ChainId,
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        SolslotAdminKeyProbe: [
          { name: 'address', type: 'address' },
          { name: 'purpose', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
      primaryType: 'SolslotAdminKeyProbe',
      message: {
        address,
        purpose: 'Recover compressed secp256k1 pubkey for admin records',
        timestamp: Date.now(),
      },
    };

    const signature = await withWalletPromptTimeout(
      this.signTypedData(probe),
      EVM_SIGNATURE_PROMPT_TIMEOUT_MS,
      'EVM wallet did not respond to the Sepolia EIP-712 key request. Close any stale wallet prompt, then reconnect and retry.',
    );
    return {
      pubkey: this.recoverCompressedPubkeyForAddress(probe, signature, address),
      address,
    };
  }

  private async requestWalletConnectChain(
    args: { method: string; params?: unknown[] },
    chain: string,
    walletConnectExpirySeconds?: number,
  ): Promise<unknown> {
    const signer = (this.wcProvider as unknown as WalletConnectDebugProvider | null)?.signer;
    if (!signer?.request) {
      throw new Error('WalletConnect provider is not ready. Disconnect and reconnect the wallet.');
    }
    this.debugWalletConnect('provider-request:walletconnect-chain-dispatch', {
      method: args.method,
      chain,
      expirySeconds: walletConnectExpirySeconds ?? null,
      ...this.walletConnectSessionDebugInfo(),
      ...this.walletConnectPendingDebugInfo(),
    });
    try {
      return await signer.request(args, chain, walletConnectExpirySeconds);
    } catch (e) {
      this.debugWalletConnect('provider-request:walletconnect-chain-error', {
        method: args.method,
        chain,
        ...debugErrorInfo(e),
        ...this.walletConnectPendingDebugInfo(),
      });
      throw e;
    }
  }

  private bindWalletConnectDebugEvents(provider: EthereumProvider): void {
    const client = (provider as unknown as WalletConnectDebugProvider).signer?.client;
    if (!client?.on) return;
    const eventNames = [
      'session_request_sent',
      'session_request_expire',
      'session_request',
      'session_request_response',
      'session_update',
      'session_delete',
      'session_event',
    ];
    for (const eventName of eventNames) {
      const listener = (...args: unknown[]) => {
        this.debugWalletConnect(`sign-client:${eventName}`, debugWalletConnectEventArgs(args));
      };
      client.on(eventName, listener);
      this.wcDebugUnsubscribers.push(() => {
        client.removeListener?.(eventName, listener);
      });
    }
  }

  private walletConnectSessionDebugInfo(): Record<string, unknown> {
    const provider = this.wcProvider as unknown as WalletConnectDebugProvider | null;
    const session = provider?.session ?? provider?.signer?.session ?? null;
    return {
      providerChainId: provider?.chainId ?? null,
      providerAccounts: (provider?.accounts ?? []).map(redactAddress),
      topic: redactWalletConnectTopic(session?.topic),
      namespaces: debugWalletConnectNamespaces(session?.namespaces),
    };
  }

  private walletConnectPendingDebugInfo(): Record<string, unknown> {
    const provider = this.wcProvider as unknown as WalletConnectDebugProvider | null;
    const client = provider?.signer?.client ?? null;
    const history = client?.core?.history ?? null;
    const historyPending = readDebugArray(history?.pending);
    const historyValues = readDebugArray(history?.values);
    const pendingRecords = historyValues.filter((record) => {
      const asObj = asRecord(record);
      return asObj && !asObj['response'];
    });
    const walletSidePendingRequests = readPendingSessionRequests(client);
    return {
      pendingHistoryCount: historyPending.length,
      pendingHistory: historyPending.slice(-5).map(debugWalletConnectHistoryItem),
      pendingRecordCount: pendingRecords.length,
      pendingRecords: pendingRecords.slice(-5).map(debugWalletConnectHistoryItem),
      walletSidePendingRequestCount: walletSidePendingRequests.length,
      walletSidePendingRequests: walletSidePendingRequests
        .slice(-5)
        .map(debugWalletConnectHistoryItem),
    };
  }

  private debugWalletConnect(event: string, details: Record<string, unknown> = {}): void {
    evmWalletDebug(event, details);
  }
}

export type EvmState =
  | { kind: 'disconnected' }
  | { kind: 'connected'; address: string; connection: 'injected' | 'walletconnect' };

interface InjectedEthereum {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface WindowWithEth extends Window {
  ethereum?: InjectedEthereum;
}

interface WalletConnectDebugNamespace {
  methods?: string[];
  chains?: string[];
  accounts?: string[];
}

interface WalletConnectDebugSession {
  topic?: string;
  namespaces?: Record<string, WalletConnectDebugNamespace>;
}

interface WalletConnectDebugClient {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  getPendingSessionRequests?: () => unknown[];
  core?: {
    history?: {
      pending?: unknown[];
      values?: unknown[];
    } | null;
  } | null;
}

interface WalletConnectDebugProvider {
  chainId?: number | string;
  accounts?: string[];
  session?: WalletConnectDebugSession | null;
  signer?: {
    session?: WalletConnectDebugSession | null;
    request?: (
      args: { method: string; params?: unknown[] },
      chain?: string,
      expiry?: number,
    ) => Promise<unknown>;
    client?: WalletConnectDebugClient | null;
  } | null;
}

function evmWalletDebug(event: string, details: Record<string, unknown> = {}): void {
  if (typeof console === 'undefined') return;
  console.info('[evm-wallet]', event, sanitizeDebugValue(details));
}

function debugErrorInfo(e: unknown): Record<string, unknown> {
  const record = e && typeof e === 'object' ? e as Record<string, unknown> : {};
  const nestedError = record['error'] && typeof record['error'] === 'object'
    ? record['error'] as Record<string, unknown>
    : null;
  const payload = record['payload'] && typeof record['payload'] === 'object'
    ? record['payload'] as Record<string, unknown>
    : null;
  return {
    name: record['name'] ?? null,
    code: record['code'] ?? null,
    message: errorMessage(e),
    innerCode: nestedError?.['code'] ?? null,
    innerMessage: nestedError?.['message'] ?? null,
    payloadMethod: payload?.['method'] ?? null,
  };
}

function debugWalletConnectEventArgs(args: unknown[]): Record<string, unknown> {
  return {
    argCount: args.length,
    ...summarizeWalletConnectEvent(args[0]),
    args: args.map((arg) => sanitizeDebugValue(arg)),
  };
}

function debugWalletConnectHistoryItem(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const request = asRecord(record?.['request']);
  const params = asRecord(record?.['params']);
  const response = asRecord(record?.['response']);
  const error = asRecord(response?.['error']);
  return {
    topic: redactWalletConnectTopic(record?.['topic'] ?? params?.['topic']),
    id: record?.['id'] ?? request?.['id'] ?? null,
    method: record?.['method'] ?? request?.['method'] ?? null,
    chainId: record?.['chainId'] ?? params?.['chainId'] ?? null,
    expiry: record?.['expiry'] ?? null,
    hasResponse: !!response,
    responseType: response
      ? Object.prototype.hasOwnProperty.call(response, 'result')
        ? 'result'
        : Object.prototype.hasOwnProperty.call(response, 'error')
          ? 'error'
          : 'unknown'
      : null,
    responseCode: error?.['code'] ?? null,
    responseMessage: error?.['message'] ?? null,
  };
}

function summarizeWalletConnectEvent(event: unknown): Record<string, unknown> {
  const record = asRecord(event);
  const request = asRecord(record?.['request']);
  const params = asRecord(record?.['params']);
  const response =
    asRecord(record?.['response']) ??
    asRecord(record?.['jsonRpcResponse']) ??
    asRecord(record?.['result']);
  const error = asRecord(response?.['error']) ?? asRecord(record?.['error']);
  return {
    topic: redactWalletConnectTopic(record?.['topic'] ?? params?.['topic']),
    id: record?.['id'] ?? request?.['id'] ?? response?.['id'] ?? null,
    method: record?.['method'] ?? request?.['method'] ?? null,
    chainId: record?.['chainId'] ?? params?.['chainId'] ?? null,
    expiry: record?.['expiry'] ?? null,
    responseType: response
      ? Object.prototype.hasOwnProperty.call(response, 'result')
        ? 'result'
        : Object.prototype.hasOwnProperty.call(response, 'error')
          ? 'error'
          : 'unknown'
      : null,
    responseCode: error?.['code'] ?? response?.['code'] ?? null,
    responseMessage: error?.['message'] ?? response?.['message'] ?? null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function debugWalletConnectNamespaces(
  namespaces: Record<string, WalletConnectDebugNamespace> | undefined,
): Record<string, unknown> | null {
  if (!namespaces) return null;
  return Object.fromEntries(
    Object.entries(namespaces).map(([key, value]) => [
      key,
      {
        chains: value.chains ?? [],
        methods: value.methods ?? [],
        accountCount: value.accounts?.length ?? 0,
        accounts: (value.accounts ?? []).map(redactWalletConnectAccount),
      },
    ]),
  );
}

function readDebugArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readPendingSessionRequests(client: WalletConnectDebugClient | null): unknown[] {
  try {
    return readDebugArray(client?.getPendingSessionRequests?.());
  } catch {
    return [];
  }
}

function sanitizeDebugValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeDebugString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => sanitizeDebugValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 4) return '[object]';
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
      out[key] = sanitizeDebugValue(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function sanitizeDebugString(value: string): string {
  if (value.startsWith('wc:') || value.includes('symKey=')) {
    return '[redacted walletconnect uri]';
  }
  if (/^0x[0-9a-f]+$/i.test(value) && value.length > 66) {
    return `${value.slice(0, 10)}...${value.slice(-8)} (${Math.trunc((value.length - 2) / 2)} bytes)`;
  }
  if (value.length > 240) {
    return `${value.slice(0, 180)}... (${value.length} chars)`;
  }
  return value;
}

function redactAddress(address: unknown): string {
  if (typeof address !== 'string') return String(address);
  const normalized = address.trim();
  if (normalized.length <= 14) return normalized;
  return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}

function redactWalletConnectAccount(account: string): string {
  const parts = account.split(':');
  if (parts.length < 3) return redactAddress(account);
  return `${parts[0]}:${parts[1]}:${redactAddress(parts.slice(2).join(':'))}`;
}

function redactWalletConnectTopic(topic: unknown): string | null {
  if (typeof topic !== 'string' || !topic) return null;
  return topic.length <= 16 ? topic : `${topic.slice(0, 8)}...${topic.slice(-8)}`;
}

/**
 * Compress a 65-byte uncompressed secp256k1 pubkey (0x04 || X(32) || Y(32))
 * into its 33-byte canonical form (0x02 or 0x03 || X(32)).
 *
 * Input must be 0x-prefixed 130 hex chars (65 bytes) starting with 04.
 */
function compressSecp256k1Pubkey(uncompressedHex: string): string {
  const hex = uncompressedHex.startsWith('0x') ? uncompressedHex.slice(2) : uncompressedHex;
  if (hex.length !== 130 || !hex.startsWith('04')) {
    throw new Error('Expected 65-byte uncompressed secp256k1 pubkey with 0x04 prefix');
  }
  const x = hex.slice(2, 66);
  const y = hex.slice(66, 130);
  const yLastByte = parseInt(y.slice(-2), 16);
  const prefix = yLastByte % 2 === 0 ? '02' : '03';
  return '0x' + prefix + x;
}

function recoverCompressedPubkeyFromDigestForAddress(
  digest: string,
  signature: string,
  expectedAddress: string,
): string {
  const uncompressedHex = SigningKey.recoverPublicKey(getBytes(digest), signature);
  const recoveredAddress = getAddress(computeAddress(uncompressedHex));
  if (recoveredAddress !== getAddress(expectedAddress)) {
    throw new Error('Wallet signature recovered a different EVM address than the connected wallet.');
  }
  return compressSecp256k1Pubkey(uncompressedHex);
}

function formatWalletConnectChainId(chainId: number): string {
  return `eip155:${Math.trunc(chainId)}`;
}

function walletConnectSessionSupportsChain(
  provider: WalletConnectDebugProvider,
  chain: string,
): boolean {
  const namespaces = provider.session?.namespaces ?? provider.signer?.session?.namespaces;
  if (!namespaces) return false;
  return Object.values(namespaces).some((namespace) => {
    if (namespace.chains?.includes(chain)) return true;
    return (namespace.accounts ?? []).some((account) => account.startsWith(`${chain}:`));
  });
}

function isUnsupportedTypedDataError(e: unknown): boolean {
  const message = errorMessage(e).toLowerCase();
  return (
    message.includes('method not found') ||
    message.includes('-32601') ||
    message.includes('eth_signtypeddata') ||
    message.includes('sign typed data') ||
    message.includes('unsupported')
  );
}

function evmWalletConnectRequiredChainId(): number {
  return EVM_WALLETCONNECT_REQUIRED_CHAIN_ID;
}

function walletConnectMethodTimeoutSeconds(): number {
  return WALLET_CONNECT_REQUEST_EXPIRY_SECONDS;
}

function evmWalletConnectStoragePrefix(): string {
  return EVM_WALLETCONNECT_STORAGE_PREFIX;
}

function normalizeOptionalChainsMode(
  mode: EvmWalletConnectOptions['optionalChains'] = 'solslot',
): EvmWalletConnectOptionalChainsMode {
  return mode === 'none' ? 'none' : 'solslot';
}

function evmWalletConnectOptionalChainIds(
  mode: EvmWalletConnectOptions['optionalChains'] = 'solslot',
): number[] {
  const normalizedMode = normalizeOptionalChainsMode(mode);
  if (normalizedMode === 'none') return [];
  return [];
}

function evmWalletConnectRpcMap(
  mode: EvmWalletConnectOptions['optionalChains'] = 'solslot',
): Record<number, string> {
  const rpcMap: Record<number, string> = {};
  for (const chainId of [evmWalletConnectRequiredChainId(), ...evmWalletConnectOptionalChainIds(mode)]) {
    const rpcUrl = EVM_WALLETCONNECT_KNOWN_RPC_MAP[chainId];
    if (rpcUrl) rpcMap[chainId] = rpcUrl;
  }
  return rpcMap;
}

function evmChainDisplayName(chainId: number): string {
  switch (chainId) {
    case 1:
      return 'Ethereum mainnet';
    case 11155111:
      return 'Sepolia';
    case 84532:
      return 'Base Sepolia';
    default:
      return `chain ${chainId}`;
  }
}

function isWalletConnectRecoverableError(e: unknown): boolean {
  const message = errorMessage(e).toLowerCase();
  return (
    message.includes('subscribe') ||
    message.includes('relay') ||
    message.includes('pairing') ||
    message.includes('topic') ||
    message.includes('session')
  );
}

function walletConnectRelayErrorMessage(e: unknown): string {
  const detail = errorMessage(e);
  return (
    'WalletConnect relay connection failed after clearing stale session state. ' +
    'Reload the page and try scanning a fresh QR code. If this repeats, verify ' +
    'environment.walletConnectProjectId in src/environments/environment.ts and ' +
    `that the WalletConnect Cloud project allows this app origin. (${detail})`
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.toString();
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    try {
      return JSON.stringify(e);
    } catch {
      return Object.prototype.toString.call(e);
    }
  }
  return String(e);
}

function withWalletPromptTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== null) clearTimeout(timeoutId);
  });
}

function isWalletConnectStorageKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.startsWith('wc@2:') ||
    lower.startsWith('walletconnect') ||
    lower.includes('@walletconnect') ||
    lower.includes(EVM_WALLETCONNECT_STORAGE_PREFIX)
  );
}

function normalizeChainIdHex(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return '0x' + Math.trunc(value).toString(16);
  }
  if (typeof value === 'bigint') {
    if (value < 0n) return null;
    return '0x' + value.toString(16);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      try {
        return '0x' + BigInt(trimmed).toString(16);
      } catch {
        return trimmed.toLowerCase();
      }
    }
    if (/^[0-9]+$/.test(trimmed)) {
      return '0x' + BigInt(trimmed).toString(16);
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      normalizeChainIdHex(record['chainId']) ??
      normalizeChainIdHex(record['result']) ??
      normalizeChainIdHex(record['id'])
    );
  }
  return null;
}

// Re-export for tests.
export const _internal = {
  compressSecp256k1Pubkey,
  evmWalletConnectOptionalChainIds,
  evmWalletConnectRequiredChainId,
  evmWalletConnectRpcMap,
  evmWalletConnectStoragePrefix,
  normalizeChainIdHex,
  normalizeOptionalChainsMode,
  recoverCompressedPubkeyFromDigestForAddress,
  walletConnectMethodTimeoutSeconds,
  withWalletPromptTimeout,
};
