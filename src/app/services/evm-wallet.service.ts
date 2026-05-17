import { Injectable, signal, computed } from '@angular/core';
import EthereumProvider from '@walletconnect/ethereum-provider';
import {
  BrowserProvider,
  Eip1193Provider,
  SigningKey,
  TypedDataEncoder,
  getAddress,
  getBytes,
  hashMessage,
  hexlify,
  toBeHex,
  toUtf8Bytes,
} from 'ethers';
import { environment } from '../../environments/environment';
import { Eip712TypedData } from './populis-api.service';

/**
 * EVM wallet service.
 *
 * Connects to either an injected provider (MetaMask, Coinbase Wallet, Rabby) or
 * to a remote wallet via WalletConnect v2.  Exposes a reactive state signal +
 * helpers for signing the Populis registration EIP-712 message and recovering
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

    const accounts = (await eth.request({
      method: 'eth_requestAccounts',
    })) as string[];
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
  async connectWalletConnect(): Promise<string> {
    const projectId = environment.walletConnectProjectId;
    if (!projectId) {
      throw new Error(
        'WalletConnect projectId is not configured.  Set environment.walletConnectProjectId ' +
          'to a value from https://cloud.walletconnect.com'
      );
    }

    try {
      return await this.connectWalletConnectOnce();
    } catch (e) {
      if (!isWalletConnectRecoverableError(e)) {
        throw e;
      }
      await this.resetWalletConnectProvider();
      this.clearWalletConnectStorage();
      try {
        return await this.connectWalletConnectOnce();
      } catch (retryError) {
        await this.resetWalletConnectProvider();
        this.clearWalletConnectStorage();
        throw new Error(walletConnectRelayErrorMessage(retryError));
      }
    }
  }

  private async connectWalletConnectOnce(): Promise<string> {
    const provider = await this.getOrInitWcProvider();
    await provider.connect({ chains: [environment.eip712ChainId] });
    const accounts = provider.accounts || [];
    if (accounts.length === 0) {
      throw new Error('WalletConnect returned no accounts');
    }
    const address = getAddress(accounts[0]);
    this.eip1193 = provider as unknown as Eip1193Provider;
    this._state.set({ kind: 'connected', address, connection: 'walletconnect' });
    return address;
  }

  private async getOrInitWcProvider(): Promise<EthereumProvider> {
    if (this.wcProvider) return this.wcProvider;
    if (this.wcInitPromise) return this.wcInitPromise;

    this.wcInitPromise = EthereumProvider.init({
      projectId: environment.walletConnectProjectId,
      // chainId=1 matches the Populis EIP-712 domain chainId.  This is a typed-data
      // attestation only; it is never submitted as an Ethereum transaction.
      chains: [environment.eip712ChainId],
      optionalChains: [],
      rpcMap: { 1: 'https://cloudflare-eth.com' },
      showQrModal: true,
      optionalMethods: [
        'personal_sign',
        'eth_signTypedData',
        'eth_signTypedData_v4',
      ],
      optionalEvents: ['accountsChanged', 'chainChanged'],
      metadata: {
        name: 'Populis Portal',
        description: 'Populis Protocol members portal — testnet',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://populis.xyz',
        icons: [],
      },
    }).then((p) => {
      this.wcProvider = p;
      p.on('disconnect', () => this.handleDisconnect());
      p.on('accountsChanged', (...args: unknown[]) => {
        const accounts = (args[0] as string[]) ?? [];
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
    this.wcProvider = null;
    this.wcInitPromise = null;
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
   * `POPULIS_VAULT_TYPEHASH_STRING` from populis_puzzles/vault_driver.py:
   *   PopulisVaultSpend(bytes32 spend_case, bytes32 deed_launcher_id, bytes32 vault_coin_id)
   *
   * For vault registration we reuse the same typehash with `spend_case = 0x...REGISTER`
   * and `deed_launcher_id = vault_coin_id = zero_bytes32`.
   *
   * MetaMask enforces that `domain.chainId` equals the wallet's active chain —
   * otherwise it throws "Provided chainId X must match the active chainId Y".
   * Populis binds its domain to chainId=1 (maximum EVM-wallet compatibility,
   * and the Chialisp puzzle has its domain separator baked for chainId=1).
   * We therefore request a network switch to Ethereum mainnet before signing
   * if the wallet is on a different chain.  This is cheap and reversible —
   * the signature is never submitted as an Ethereum transaction, so no gas is
   * spent and no risk on mainnet.
   */
  async signTypedData(typedData: Eip712TypedData): Promise<string> {
    if (!this.eip1193) throw new Error('Not connected');
    const address = this.address();
    if (!address) throw new Error('Not connected');

    const domainChainIdRaw = (typedData.domain as unknown as { chainId?: number | string })
      .chainId;
    const targetChainId = Number(domainChainIdRaw ?? 1);
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

  /**
   * Ensure the active wallet chain equals `targetChainId`.  If not, request
   * a switch via EIP-3326 `wallet_switchEthereumChain`.  On error 4902
   * ("unrecognized chain") we fall back to `wallet_addEthereumChain` for
   * Ethereum mainnet — the only chain we ever auto-add, since we only
   * target chainId=1.
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
      const code = (err as { code?: number }).code;
      if (code === 4902 && targetChainId === 1) {
        // Unknown chain — add mainnet and try again.
        await this.eip1193.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexChain,
              chainName: 'Ethereum Mainnet',
              rpcUrls: ['https://cloudflare-eth.com'],
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              blockExplorerUrls: ['https://etherscan.io'],
            },
          ],
        });
        return;
      }
      throw new Error(
        `Please switch your wallet to Ethereum mainnet (chainId 1) — ` +
          `Populis EIP-712 signatures are bound to that chain id. ` +
          `This does NOT send any transaction and costs nothing. (${
            (err as Error).message ?? 'switch rejected'
          })`
      );
    }
  }

  /**
   * Recover the 33-byte compressed secp256k1 public key from an EIP-712 signature.
   *
   * This is the value Populis curries into the vault singleton as OWNER_PUBKEY.
   * We perform it on the client for UX ("your Populis public key is 0x...") —
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

  /**
   * Sign a deterministic EIP-712 probe and return the recovered
   * compressed secp256k1 pubkey.  Used by the launch-authority-v2
   * wizard to populate an admin record's leaf metadata when the
   * operator opts to be the genesis admin.
   *
   * The probe is structurally distinct from the admin sign-in
   * challenge (different ``primaryType``) so a wallet pop-up can't
   * confuse the two — but uses the same chainId=1 binding so it
   * works under the existing wallet-side Populis domain trust.
   *
   * The signature is NEVER submitted on chain or to the API — it's
   * consumed locally for pubkey recovery only.
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
        name: 'Populis Admin Records Probe',
        version: '1',
        chainId: environment.eip712ChainId,
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        AdminRecordsProbe: [
          { name: 'address', type: 'address' },
          { name: 'purpose', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
      primaryType: 'AdminRecordsProbe',
      message: {
        address,
        purpose: 'Recover compressed secp256k1 pubkey for admin records',
        timestamp: Math.floor(Date.now() / 1000),
      },
    };

    let pubkey: string;
    try {
      const signature = await this.signTypedData(probe);
      pubkey = this.recoverCompressedPubkey(probe, signature);
    } catch (e) {
      if (!isUnsupportedTypedDataError(e)) {
        throw e;
      }
      const message = buildAdminRecordsPersonalSignProbe(address, probe.message['timestamp']);
      const signature = await this.personalSign(message, address);
      pubkey = recoverCompressedPubkeyFromDigest(hashMessage(message), signature);
    }
    return { pubkey, address };
  }

  private async personalSign(message: string, address: string): Promise<string> {
    if (!this.eip1193) throw new Error('Not connected');
    const hexMessage = hexlify(toUtf8Bytes(message));
    return (await this.eip1193.request({
      method: 'personal_sign',
      params: [hexMessage, address],
    })) as string;
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

function recoverCompressedPubkeyFromDigest(digest: string, signature: string): string {
  const uncompressedHex = SigningKey.recoverPublicKey(getBytes(digest), signature);
  return compressSecp256k1Pubkey(uncompressedHex);
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

function buildAdminRecordsPersonalSignProbe(address: string, timestamp: unknown): string {
  return [
    'Populis Admin Records Probe',
    '',
    'Purpose: Recover compressed secp256k1 pubkey for admin records',
    `Address: ${address}`,
    `Chain ID: ${environment.eip712ChainId}`,
    `Timestamp: ${String(timestamp)}`,
    '',
    'This signature is used only locally by the portal and is not stored or submitted on chain.',
  ].join('\n');
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

function isWalletConnectStorageKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.startsWith('wc@2:') ||
    lower.startsWith('walletconnect') ||
    lower.includes('@walletconnect')
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
  buildAdminRecordsPersonalSignProbe,
  compressSecp256k1Pubkey,
  normalizeChainIdHex,
};

// Prevent dead-code elimination of imports used only for their side effects
// (hexlify/toBeHex currently unused but kept available for upcoming spend flows).
void hexlify;
void toBeHex;
