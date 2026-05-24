import { Injectable, signal, computed, inject } from '@angular/core';
import SignClient from '@walletconnect/sign-client';

import { ChiaWasmService } from './chia-wasm.service';
import { environment } from '../../environments/environment';
import { mojoAmountToSafeNumber } from '../utils/mojo-amount';

type WalletConnectSignClient = Awaited<ReturnType<typeof SignClient.init>>;
interface ChiaWalletConnectSession {
  topic: string;
}

/**
 * Chia wallet service.
 *
 * Supports the two most common injected-wallet bridges:
 *   - Goby   — `window.chia` (and `window.goby` alias)
 *   - Sage   — `window.sage` (v2 API + WalletConnect Chia namespace)
 *
 * Returns the user's master BLS public key (48-byte G1 element) which will
 * be curried into the vault singleton as OWNER_PUBKEY (AUTH_TYPE_BLS = 1).
 *
 * For signing we request `signMessage` against the Populis registration
 * challenge.  The backend then re-verifies the BLS signature and launches
 * the vault.
 */
@Injectable({ providedIn: 'root' })
export class ChiaWalletService {
  private readonly chiaWasm = inject(ChiaWasmService);
  private readonly _state = signal<ChiaState>({ kind: 'disconnected' });
  private readonly _sageWalletConnectUri = signal<string | null>(null);
  private sageWcClient: WalletConnectSignClient | null = null;
  private sageWcInitPromise: Promise<WalletConnectSignClient> | null = null;
  private sageWcSession: ChiaWalletConnectSession | null = null;
  private sageWcBridge: ChiaInjected | null = null;
  readonly state = this._state.asReadonly();
  readonly sageWalletConnectUri = this._sageWalletConnectUri.asReadonly();

  readonly isConnected = computed(() => this._state().kind === 'connected');
  readonly pubkey = computed(() => {
    const s = this._state();
    return s.kind === 'connected' ? s.pubkey : null;
  });
  readonly connectionKind = computed(() => {
    const s = this._state();
    return s.kind === 'connected' ? s.connection : null;
  });

  hasGoby(): boolean {
    return typeof window !== 'undefined' && !!(window as WindowWithChia).chia;
  }

  hasSage(): boolean {
    return typeof window !== 'undefined' && !!(window as WindowWithChia).sage;
  }

  hasSageWalletConnect(): boolean {
    return true;
  }

  /** Connect to Goby (browser extension). */
  async connectGoby(): Promise<string> {
    const goby = (window as WindowWithChia).chia;
    if (!goby) throw new Error('Goby wallet extension not detected');

    const connected = await goby.request({ method: 'connect' });
    if (!connected) throw new Error('Goby connect rejected');

    const pubkey = (await goby.request({
      method: 'getPublicKeys',
      params: { limit: 1 },
    })) as string[];
    if (!pubkey || pubkey.length === 0) {
      throw new Error('Goby returned no public keys');
    }
    const blsHex = normalizeHex(pubkey[0]);
    this._state.set({ kind: 'connected', pubkey: blsHex, connection: 'goby' });
    return blsHex;
  }

  /** Connect to Sage (browser + WC bridge). */
  async connectSage(): Promise<string> {
    const sage = (window as WindowWithChia).sage;
    if (!sage) throw new Error('Sage wallet not detected');

    const accounts = (await sage.request({
      method: 'chia_getPublicKeys',
      params: {},
    })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error('Sage returned no public keys');
    }
    const blsHex = normalizeHex(accounts[0]);
    this._state.set({ kind: 'connected', pubkey: blsHex, connection: 'sage' });
    return blsHex;
  }

  async connectSageWalletConnect(): Promise<string> {
    if (!environment.walletConnectProjectId) {
      throw new Error(
        'WalletConnect projectId is not configured. Set environment.walletConnectProjectId ' +
          'to connect Sage through WalletConnect.',
      );
    }
    const client = await this.getOrInitSageWalletConnectClient();
    const chainId = chiaWalletConnectChainId();
    const { uri, approval } = await client.connect({
      optionalNamespaces: {
        chia: {
          methods: [
            'chip0002_getPublicKeys',
            'chia_getPublicKeys',
            'chia_getAddress',
            'chia_getCurrentAddress',
            'chip0002_getCurrentAddress',
            'chip0002_signCoinSpends',
            'chia_signCoinSpends',
            'chia_filterUnlockedCoins',
            'chip0002_filterUnlockedCoins',
            'filterUnlockedCoins',
            'chia_signMessageByAddress',
          ],
          chains: [chainId],
          events: [],
        },
      },
    });
    this._sageWalletConnectUri.set(uri ?? null);
    try {
      this.sageWcSession = await approval();
      this.sageWcBridge = this.makeSageWalletConnectBridge(client, this.sageWcSession, chainId);
      const keys = (await this.sageWcBridge.request({
        method: 'chip0002_getPublicKeys',
        params: {},
      })) as string[];
      if (!keys || keys.length === 0) {
        throw new Error('Sage WalletConnect returned no public keys');
      }
      const blsHex = normalizeHex(keys[0]);
      this._state.set({
        kind: 'connected',
        pubkey: blsHex,
        connection: 'sage-walletconnect',
      });
      return blsHex;
    } finally {
      this._sageWalletConnectUri.set(null);
    }
  }

  /**
   * Sign an arbitrary message with the user's master BLS key.
   *
   * Returns a 96-byte BLS signature, hex-encoded.  The backend verifies it
   * against the Populis registration challenge + the reported pubkey.
   */
  async signMessage(message: string): Promise<string> {
    const state = this._state();
    if (state.kind !== 'connected') throw new Error('Not connected');

    if (state.connection === 'goby') {
      const goby = (window as WindowWithChia).chia;
      if (!goby) throw new Error('Goby no longer available');
      const sig = (await goby.request({
        method: 'signMessageByAddress',
        params: { message },
      })) as { signature: string };
      return normalizeHex(sig.signature);
    }

    if (state.connection === 'sage' || state.connection === 'sage-walletconnect') {
      const sage = this.getSageBridge();
      if (!sage) throw new Error('Sage no longer available');
      const sig = (await sage.request({
        method: 'chia_signMessageByAddress',
        params: { message },
      })) as { signature: string };
      return normalizeHex(sig.signature);
    }

    throw new Error(`Unsupported Chia connection: ${state.connection}`);
  }

  /**
   * Ask the connected wallet to sign a list of unsigned coin spends.
   *
   * **Why this exists.** Phase 9-Hermes-D's WASM-first launch flow
   * needs the operator's existing Chia wallet (Goby / Sage) to sign
   * exactly one funding-coin spend; the launcher-coin spend that
   * follows is permissionless.  Rather than pull the user's private
   * key into browser memory (the solslot-style pattern, which adds
   * XSS-exfiltration risk), we ask the wallet to sign via its
   * standard CHIP-0002 RPC and combine the returned signature with
   * the launcher spend client-side.
   *
   * **Method naming defence.** Goby exposes ``signCoinSpends`` on
   * ``window.chia.request``.  Sage exposes both
   * ``chia_signCoinSpends`` and ``chip0002_signCoinSpends`` on
   * ``window.sage.request``; the chip0002 form is the standardised
   * name and what newer Sage builds prefer.  We try the prefixed
   * variants first and fall back to the bare name so this stays
   * resilient against either wallet renaming the method.
   *
   * @param coinSpends Unsigned coin spends to feed to the wallet.
   *   Each spend's coin must be owned by the connected wallet
   *   (otherwise the wallet will reject — its job is to know what
   *   it controls).
   * @returns A ``SignedSpendBundle`` containing the original spends
   *   plus the aggregated BLS signature the wallet produced.
   */
  async signSpendBundle(
    coinSpends: ReadonlyArray<UnsignedCoinSpend>,
  ): Promise<SignedSpendBundle> {
    const state = this._state();
    if (state.kind !== 'connected') {
      throw new Error('signSpendBundle: wallet not connected');
    }
    if (coinSpends.length === 0) {
      throw new Error('signSpendBundle: empty coinSpends array');
    }

    // Wallet wire format: snake_case fields, hex-encoded values.  Both
    // Goby and Sage's CHIP-0002 implementations use this exact shape;
    // see https://chialisp.com/chips/chip-0002 for the canonical spec.
    const wireSpends = coinSpends.map((cs) => ({
      coin: {
        parent_coin_info: normalizeHex(cs.coin.parentCoinInfo),
        puzzle_hash: normalizeHex(cs.coin.puzzleHash),
        amount: mojoAmountToSafeNumber(cs.coin.amount, 'coin amount'),
      },
      puzzle_reveal: normalizeHex(cs.puzzleReveal),
      solution: normalizeHex(cs.solution),
    }));

    if (state.connection === 'goby') {
      return this.invokeSignCoinSpends(
        (window as WindowWithChia).chia,
        ['signCoinSpends', 'chip0002_signCoinSpends'],
        wireSpends,
        coinSpends,
      );
    }

    if (state.connection === 'sage' || state.connection === 'sage-walletconnect') {
      return this.invokeSignCoinSpends(
        this.getSageBridge(),
        ['chip0002_signCoinSpends', 'chia_signCoinSpends'],
        wireSpends,
        coinSpends,
      );
    }

    throw new Error(`signSpendBundle: unsupported connection: ${state.connection}`);
  }

  /**
   * Ask the connected wallet to send ``amount`` mojos to ``targetPuzzleHash``
   * and return the SIGNED spend bundle without auto-broadcasting it.
   *
   * **Why not just signCoinSpends?**  Constructing the funding coin
   * spend ourselves requires synthetic-key derivation from the
   * operator's master pubkey + the standard p2_delegated puzzle
   * reveal — both ~1-day implementation chunks per wallet variant
   * (Goby v0.x / Sage / chia-blockchain wallet).  The wallet's
   * native ``transfer`` (Goby) / ``chia_send`` (Sage) RPCs do all
   * that lifting internally; we just need them to RETURN the signed
   * bundle rather than auto-broadcast.
   *
   * **Auto-broadcast detection.**  Some wallet builds auto-broadcast
   * the funding spend without giving us a chance to combine it with
   * our launcher spend.  ``parseTransferResult`` detects this and
   * surfaces an actionable error so the operator can use a CLI
   * fallback or a wallet that supports the manual flow.
   *
   * Currently undocumented in CHIP-0002; we pull the specific
   * method names from the same conventions Goby and Sage use for
   * ``transfer`` in their respective dApp-bridge implementations.
   *
   * @param targetPuzzleHash 0x-prefixed 32-byte hex (where the mojos go).
   * @param amount Mojos to send (1 for a singleton launcher coin).
   * @param memos Optional UTF-8 strings to attach as memos on the
   *   ``CREATE_COIN`` condition.  Used by the bootstrap recovery
   *   anchor broadcast flow to embed the ``POPULIS_BOOTSTRAP_V1`` tag
   *   + canonical-JSON payload on a small marker coin so any future
   *   recovery scanner can find the deployment's coordinates on chain.
   *   Pure-ASCII strings only (Goby + Sage both treat memos as UTF-8;
   *   the recovery anchor's canonical JSON is ASCII by construction).
   *   Defaults to no memos.
   * @returns The signed spend bundle ready to combine with our
   *   launcher spend before pushing to coinset.
   */
  async transfer(args: {
    targetPuzzleHash: string;
    amount: number | bigint;
    memos?: ReadonlyArray<string>;
  }): Promise<SignedSpendBundle> {
    const state = this._state();
    if (state.kind !== 'connected') {
      throw new Error('transfer: wallet not connected');
    }
    const amountNum = mojoAmountToSafeNumber(args.amount, 'transfer amount');
    if (amountNum < 1) {
      throw new Error('transfer: amount must be >= 1 mojo');
    }
    const targetHashBare = stripHexPrefix(args.targetPuzzleHash);
    const memos: string[] = args.memos ? [...args.memos] : [];

    if (state.connection === 'goby') {
      // Goby's ``transfer`` wire format strictly requires:
      //   * ``to``: **bech32m** address (NOT hex).  Goby rejects hex
      //     with "invalid recipient" — we explicitly encode here.
      //   * ``assetId``: empty string for native XCH; 64-char hex for
      //     CAT.  Goby rejects payloads without this field with
      //     "Invalid assetId" (code 4000) even when sending XCH.
      //   * ``waitForConfirmation``: ``false`` so Goby returns the
      //     signed bundle instead of auto-broadcasting (we need to
      //     combine it with our launcher spend before submission).
      //   * ``memos``: UTF-8 strings the wallet will atomise into the
      //     ``CREATE_COIN`` condition (empty array by default).
      const toBech32 = this.encodePuzzleHashAsBech32(targetHashBare);
      return this.invokeTransfer(
        (window as WindowWithChia).chia,
        ['transfer'],
        {
          to: toBech32,
          amount: amountNum,
          assetId: '',
          fee: 0,
          memos,
          waitForConfirmation: false,
        },
      );
    }

    if (state.connection === 'sage' || state.connection === 'sage-walletconnect') {
      return this.invokeTransfer(
        this.getSageBridge(),
        ['chia_send', 'chip0002_send'],
        { recipient: targetHashBare, amount: amountNum, memos },
      );
    }

    throw new Error(`transfer: unsupported connection: ${state.connection}`);
  }

  /**
   * Encode a 32-byte hex puzzle hash as a bech32m address using the
   * WASM ``Address`` constructor.
   *
   * The HRP is selected from ``environment.chiaNetwork``:
   *   * ``testnet11`` → ``txch``
   *   * ``mainnet``   → ``xch``
   *
   * Used by the Goby transfer path because Goby's ``transfer`` RPC
   * rejects raw hex with "invalid recipient" / "Invalid assetId"
   * errors.  Sage's ``chia_send`` accepts both, so this helper is
   * Goby-only for now.
   *
   * Throws if WASM isn't ready or the input isn't 64 hex chars.
   */
  private encodePuzzleHashAsBech32(puzzleHashHex: string): string {
    const sdk = this.chiaWasm.sdk();
    const AddressCtor = sdk['Address'] as
      | (new (puzzleHash: Uint8Array, prefix: string) => { encode: () => string })
      | undefined;
    if (typeof AddressCtor !== 'function') {
      throw new Error(
        'transfer: WASM Address constructor unavailable — cannot encode ' +
          'recipient as bech32 for Goby.  Check ChiaWasmService.ready().',
      );
    }
    const stripped = puzzleHashHex.startsWith('0x')
      ? puzzleHashHex.slice(2)
      : puzzleHashHex;
    if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
      throw new Error(
        `transfer: targetPuzzleHash must be 32 bytes hex, got: ${puzzleHashHex}`,
      );
    }
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
    }
    const prefix = environment.chiaNetwork === 'mainnet' ? 'xch' : 'txch';
    return new AddressCtor(bytes, prefix).encode();
  }

  /**
   * Ask the connected wallet for its current receive address (bech32m
   * ``txch1...`` / ``xch1...``).
   *
   * **Why this exists.** Phase 9-Hermes-D's launch wizard needs the
   * operator's wallet address so it can query coinset.org for an
   * unspent coin to use as the funding-coin id in the deterministic
   * preview.  Without this RPC we'd ask the operator to copy-paste
   * a coin id out of their wallet UI manually.
   *
   * **Method naming defence.** Goby exposes ``getCurrentAddress`` on
   * ``window.chia.request``.  Sage exposes ``chia_getCurrentAddress``
   * (and possibly ``chip0002_getCurrentAddress`` in newer builds).
   * Mirrors the fallback pattern used by ``transfer`` and
   * ``signSpendBundle`` so we stay resilient to wallet renames.
   *
   * **Return shape.** Both wallets return either a bare bech32 string
   * or ``{ address: string }``; we normalise to the bare string and
   * surface a clear error on anything else.
   *
   * @returns Bech32m-encoded receive address (``txch1...`` on testnet11,
   *   ``xch1...`` on mainnet).
   */
  async getCurrentAddress(): Promise<string> {
    const state = this._state();
    if (state.kind !== 'connected') {
      throw new Error('getCurrentAddress: wallet not connected');
    }

    if (state.connection === 'goby') {
      const goby = (window as WindowWithChia).chia;
      // Goby exposes the current address as a *property*
      // (``chia.selectedAddress``), not via an RPC method —
      // ``getCurrentAddress`` returns "method doesn't have
      // corresponding handler" (code 4004).  Mirror solslot's
      // pattern: read the property if populated, otherwise prime it
      // by calling ``getPublicKeys`` (which Goby populates the
      // address as a side effect of) and read again.
      if (goby?.selectedAddress) {
        return goby.selectedAddress;
      }
      try {
        await goby?.request({ method: 'getPublicKeys', params: { limit: 1 } });
      } catch (err) {
        throw new Error(
          `getCurrentAddress: getPublicKeys failed (needed to populate ` +
            `chia.selectedAddress): ${formatErrorMessage(err)}`,
        );
      }
      if (goby?.selectedAddress) {
        return goby.selectedAddress;
      }
      // Last resort: try the RPC.  Newer Goby builds may add it; the
      // bare ``chia_getCurrentAddress`` is the most likely name since
      // it's what WalletConnect uses.
      return this.invokeGetAddress(
        goby,
        ['chia_getCurrentAddress', 'getCurrentAddress'],
      );
    }

    if (state.connection === 'sage') {
      return this.invokeGetAddress(
        (window as WindowWithChia).sage,
        ['chia_getCurrentAddress', 'chip0002_getCurrentAddress'],
      );
    }

    if (state.connection === 'sage-walletconnect') {
      return this.invokeGetAddress(
        this.getSageBridge(),
        ['chia_getAddress', 'chia_getCurrentAddress', 'chip0002_getCurrentAddress'],
      );
    }

    throw new Error(`getCurrentAddress: unsupported connection: ${state.connection}`);
  }

  async filterUnlockedCoinIds(coinIds: ReadonlyArray<string>): Promise<string[]> {
    const state = this._state();
    if (state.kind !== 'connected') {
      throw new Error('filterUnlockedCoinIds: wallet not connected');
    }
    const normalized = coinIds.map(normalizeHex);
    if (normalized.length === 0) return [];

    if (state.connection === 'goby') {
      return this.invokeFilterUnlockedCoins(
        (window as WindowWithChia).chia,
        ['filterUnlockedCoins'],
        normalized,
      );
    }

    if (state.connection === 'sage' || state.connection === 'sage-walletconnect') {
      return this.invokeFilterUnlockedCoins(
        this.getSageBridge(),
        ['chia_filterUnlockedCoins', 'chip0002_filterUnlockedCoins', 'filterUnlockedCoins'],
        normalized.map(stripHexPrefix),
      );
    }

    throw new Error(`filterUnlockedCoinIds: unsupported connection: ${state.connection}`);
  }

  /** Try each method name in order; return the first successful address. */
  private async invokeGetAddress(
    wallet: ChiaInjected | undefined,
    methods: ReadonlyArray<string>,
  ): Promise<string> {
    if (!wallet) {
      throw new Error('getCurrentAddress: wallet bridge no longer available');
    }
    let lastError: unknown = null;
    for (const method of methods) {
      try {
        const result = await wallet.request({ method, params: {} });
        return parseGetAddressResult(result);
      } catch (err: unknown) {
        if (isMethodNotSupportedError(err)) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      `getCurrentAddress: wallet rejected all method names tried (${methods.join(', ')}). ` +
        `Last error: ${formatErrorMessage(lastError)}`,
    );
  }

  /** Try each method name in order; return the first successful transfer result. */
  private async invokeTransfer(
    wallet: ChiaInjected | undefined,
    methods: ReadonlyArray<string>,
    params: unknown,
  ): Promise<SignedSpendBundle> {
    if (!wallet) {
      throw new Error('transfer: wallet bridge no longer available');
    }
    let lastError: unknown = null;
    for (const method of methods) {
      try {
        const result = await wallet.request({ method, params });
        return parseTransferResult(result);
      } catch (err: unknown) {
        if (isMethodNotSupportedError(err)) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      `transfer: wallet rejected all method names tried (${methods.join(', ')}). ` +
        `Last error: ${formatErrorMessage(lastError)}`,
    );
  }

  private async invokeFilterUnlockedCoins(
    wallet: ChiaInjected | undefined,
    methods: ReadonlyArray<string>,
    coinIds: ReadonlyArray<string>,
  ): Promise<string[]> {
    if (!wallet) {
      throw new Error('filterUnlockedCoinIds: wallet bridge no longer available');
    }
    let lastError: unknown = null;
    for (const method of methods) {
      try {
        const result = await wallet.request({
          method,
          params: { coinNames: [...coinIds] },
        });
        return parseStringArrayResult(result, 'filterUnlockedCoinIds').map(normalizeHex);
      } catch (err: unknown) {
        if (isMethodNotSupportedError(err)) {
          lastError = err;
          continue;
        }
        const result = await wallet.request({
          method,
          params: { coinNames: coinIds.map(stripHexPrefix) },
        });
        return parseStringArrayResult(result, 'filterUnlockedCoinIds').map(normalizeHex);
      }
    }
    if (lastError) return [...coinIds];
    return [...coinIds];
  }

  /**
   * Try each method name in order; return the first successful result.
   *
   * **Goby's wire contract (per docs.goby.app/methods).**  Goby's
   * ``signCoinSpends`` returns ``Promise<string>`` — JUST the
   * aggregated signature, not the echoed coin spends.  When the
   * parser detects this string-only shape it returns
   * ``{ coinSpends: [], aggregatedSignature: ... }`` — but the caller
   * needs the spends to combine with downstream spends + serialise
   * for ``push_tx``.  We fix this here by reusing the
   * ``inputCoinSpends`` we just sent to the wallet (the wallet
   * cryptographically commits to those exact spends via the
   * aggregated signature; substituting any other spends would
   * invalidate the bundle anyway).
   */
  private async invokeSignCoinSpends(
    wallet: ChiaInjected | undefined,
    methods: ReadonlyArray<string>,
    wireSpends: ReadonlyArray<unknown>,
    inputCoinSpends: ReadonlyArray<UnsignedCoinSpend>,
  ): Promise<SignedSpendBundle> {
    if (!wallet) {
      throw new Error('signSpendBundle: wallet bridge no longer available');
    }
    let lastError: unknown = null;
    for (const method of methods) {
      try {
        const result = await wallet.request({
          method,
          params: { coinSpends: wireSpends },
        });
        const parsed = parseSignCoinSpendsResult(result);
        // String-only / no-spend replies (Goby's documented shape) get
        // their coin spends populated from what we sent in.  The
        // signature commits to these specific spends, so this is safe
        // and saves us a round-trip serialisation.
        if (parsed.coinSpends.length === 0 && inputCoinSpends.length > 0) {
          return {
            coinSpends: [...inputCoinSpends],
            aggregatedSignature: parsed.aggregatedSignature,
          };
        }
        return parsed;
      } catch (err: unknown) {
        // Method-not-supported errors typically come back with a code
        // like 4200 or a message containing "method"/"unsupported".
        // Other errors (user rejection, network) we surface immediately.
        if (isMethodNotSupportedError(err)) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      `signSpendBundle: wallet rejected all method names tried (${methods.join(', ')}). ` +
        `Last error: ${formatErrorMessage(lastError)}`,
    );
  }

  private async getOrInitSageWalletConnectClient(): Promise<WalletConnectSignClient> {
    if (this.sageWcClient) return this.sageWcClient;
    if (this.sageWcInitPromise) return this.sageWcInitPromise;
    this.sageWcInitPromise = SignClient.init({
      projectId: environment.walletConnectProjectId,
      relayUrl: 'wss://relay.walletconnect.com',
      metadata: {
        name: 'Populis Portal',
        description: 'Populis genesis admin-authority launch',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://populis.xyz',
        icons: [],
      },
    }).then((client) => {
      this.sageWcClient = client;
      client.on('session_delete', () => {
        if (this._state().kind === 'connected') {
          const state = this._state();
          if (state.kind === 'connected' && state.connection === 'sage-walletconnect') {
            this.disconnect();
          }
        }
      });
      return client;
    });
    return this.sageWcInitPromise;
  }

  private makeSageWalletConnectBridge(
    client: WalletConnectSignClient,
    session: ChiaWalletConnectSession,
    chainId: string,
  ): ChiaInjected {
    return {
      request: ({ method, params }: { method: string; params?: unknown }) =>
        client.request({
          topic: session.topic,
          chainId,
          request: {
            method,
            params: params ?? {},
          },
        }),
    };
  }

  private getSageBridge(): ChiaInjected | undefined {
    const state = this._state();
    if (state.kind !== 'connected') return undefined;
    if (state.connection === 'sage-walletconnect') return this.sageWcBridge ?? undefined;
    return (window as WindowWithChia).sage;
  }

  disconnect(): void {
    this._state.set({ kind: 'disconnected' });
    this.sageWcSession = null;
    this.sageWcBridge = null;
    this._sageWalletConnectUri.set(null);
  }
}

export type ChiaState =
  | { kind: 'disconnected' }
  | {
      kind: 'connected';
      pubkey: string;
      connection: 'goby' | 'sage' | 'sage-walletconnect';
    };

interface ChiaInjected {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  /**
   * Goby exposes the connected wallet's current receive address as a
   * **property** on ``window.chia``, not via an RPC method.  Populated
   * after ``getPublicKeys`` (or ``connect``) succeeds.  Format is
   * bech32m (``txch1...`` / ``xch1...``).  Sage does NOT expose this
   * property — it requires the ``chia_getCurrentAddress`` RPC.
   *
   * Reference: solslot's
   * ``research/solslot-frontend/slui/src/app/components/connect-wallet-modal/connect-wallet-modal.component.ts:317``
   * uses ``chia.selectedAddress`` directly after a successful
   * ``getPublicKeys`` round-trip.
   */
  selectedAddress?: string;
  isGoby?: boolean;
}

interface WindowWithChia extends Window {
  chia?: ChiaInjected;
  goby?: ChiaInjected;
  sage?: ChiaInjected;
}

/**
 * Wire-format coin tuple.  ``parentCoinInfo`` and ``puzzleHash`` are
 * 0x-prefixed (or bare) hex strings; ``amount`` accepts either bigint
 * or number for ergonomics (CHIP-0002's wire format uses number, so
 * we coerce internally).
 */
export interface CoinSpec {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: number | bigint;
}

/**
 * Unsigned coin spend handed to the wallet for signing.  The wallet
 * must hold the private key controlling ``coin``; otherwise the call
 * fails with a wallet-side rejection.
 */
export interface UnsignedCoinSpend {
  coin: CoinSpec;
  /** Hex-encoded puzzle reveal (CLVM bytecode). */
  puzzleReveal: string;
  /** Hex-encoded solution (CLVM bytecode). */
  solution: string;
}

/**
 * Result of a successful ``signSpendBundle`` call.  The wallet returns
 * the original spends plus an aggregated BLS signature covering every
 * AGG_SIG_ME / AGG_SIG_UNSAFE condition the puzzles emit.
 *
 * Callers combine this signature with any unsigned spends they
 * constructed locally (e.g. the singleton launcher spend, which is
 * permissionless and needs no signature) to form the full SpendBundle
 * for ``coinset.org/push_tx``.
 */
export interface SignedSpendBundle {
  /** The same spends that were submitted to the wallet (echoed back). */
  coinSpends: ReadonlyArray<UnsignedCoinSpend>;
  /** 0x-prefixed 96-byte BLS aggregated signature (192 hex chars). */
  aggregatedSignature: string;
}

function normalizeHex(s: string): string {
  return s.startsWith('0x') ? s : '0x' + s;
}

function stripHexPrefix(s: string): string {
  return s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
}

function chiaWalletConnectChainId(): string {
  return environment.chiaNetwork === 'mainnet' ? 'chia:mainnet' : 'chia:testnet';
}

/**
 * Decode the wallet's ``signCoinSpends`` reply into a uniform shape.
 *
 * Goby returns ``{ signature: '0x...', spendBundle: { coin_spends: [...] } }``;
 * Sage returns ``{ aggregatedSignature: '0x...', coinSpends: [...] }``;
 * older builds may even return just the raw signature string.  We
 * normalise into our ``SignedSpendBundle`` shape and surface a clear
 * error if nothing recognisable is present.
 */
function parseSignCoinSpendsResult(raw: unknown): SignedSpendBundle {
  if (typeof raw === 'string') {
    return {
      coinSpends: [],
      aggregatedSignature: normalizeHex(raw),
    };
  }
  if (raw === null || typeof raw !== 'object') {
    throw new Error(
      `signSpendBundle: wallet returned unexpected shape: ${JSON.stringify(raw)}`,
    );
  }
  const obj = raw as Record<string, unknown>;

  // Try common signature field names.
  const sig =
    (obj['aggregatedSignature'] as string | undefined) ??
    (obj['aggregated_signature'] as string | undefined) ??
    (obj['signature'] as string | undefined);
  if (typeof sig !== 'string' || sig.length === 0) {
    throw new Error(
      'signSpendBundle: wallet response missing aggregatedSignature/signature field',
    );
  }

  // Try common spend-list field names.  Some wallets nest under
  // spendBundle: { coin_spends: [...] }; we flatten if so.
  const spends =
    (obj['coinSpends'] as ReadonlyArray<unknown> | undefined) ??
    (obj['coin_spends'] as ReadonlyArray<unknown> | undefined) ??
    (() => {
      const sb = obj['spendBundle'] ?? obj['spend_bundle'];
      if (sb && typeof sb === 'object') {
        const sbObj = sb as Record<string, unknown>;
        return (
          (sbObj['coinSpends'] as ReadonlyArray<unknown> | undefined) ??
          (sbObj['coin_spends'] as ReadonlyArray<unknown> | undefined)
        );
      }
      return undefined;
    })();

  return {
    coinSpends: (spends ?? []).map(parseWireCoinSpend),
    aggregatedSignature: normalizeHex(sig),
  };
}

/**
 * Decode the wallet's ``transfer``/``chia_send`` reply.  Same defensive
 * normalisation as ``parseSignCoinSpendsResult`` but with stricter
 * checking that we got a full signed bundle (not just a transaction id).
 *
 * Reasons to reject auto-broadcast:
 * * Genesis launch needs the funding spend to be combined with the
 *   launcher spend in the SAME spend bundle (atomicity — without it
 *   the launcher coin briefly exists as a permissionless 1-mojo coin
 *   that any observer can spend).
 * * If the wallet auto-broadcasts, we can't tack on the launcher spend
 *   afterward — it'd be a separate transaction that the network might
 *   reject if a competing claim landed first.
 */
function parseTransferResult(raw: unknown): SignedSpendBundle {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(
      `transfer: wallet returned unexpected shape: ${JSON.stringify(raw)}`,
    );
  }
  const obj = raw as Record<string, unknown>;

  // Detect the auto-broadcast case: wallet broadcasted itself and only
  // gave us a tx id.  Surface a clear error so the operator can
  // configure their wallet for the manual flow.
  if (
    !obj['spendBundle'] &&
    !obj['spend_bundle'] &&
    !obj['coinSpends'] &&
    !obj['coin_spends'] &&
    (obj['transactionId'] || obj['txId'] || obj['transaction_id'])
  ) {
    throw new Error(
      'transfer: wallet auto-broadcasted the funding spend instead of ' +
        'returning the signed bundle.  Genesis launch requires atomicity ' +
        '(funding + launcher spends in one bundle), so this path cannot be ' +
        'used.  Configure your wallet to support manual sign-and-return, ' +
        'or use a wallet that exposes signCoinSpends directly.',
    );
  }

  // Reuse the signCoinSpends parser for the happy path.
  return parseSignCoinSpendsResult(raw);
}

/**
 * Decode the wallet's ``getCurrentAddress`` reply.
 *
 * Wallets in the wild return the address in two distinct formats:
 *
 *   * **Bech32m** — ``txch1...`` (testnet11) / ``xch1...`` (mainnet).
 *     Sage's ``chia_getCurrentAddress`` RPC returns this.
 *   * **Hex puzzle hash** — 64 hex chars (optionally ``0x``-prefixed).
 *     Some Goby builds expose this via the ``selectedAddress``
 *     property + RPC fallback.
 *
 * Both are valid; downstream consumers (e.g.
 * ``WalletCoinPickerService.normalizeWalletAddress``) decide whether
 * to bech32-decode or hex-decode based on the prefix.
 *
 * Reply shape: bare string OR ``{ address: "..." }`` / ``{ addr: "..." }``.
 */
function parseGetAddressResult(raw: unknown): string {
  let addr: string | null = null;
  if (typeof raw === 'string') {
    addr = raw;
  } else if (raw !== null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const candidate = obj['address'] ?? obj['addr'];
    if (typeof candidate === 'string') {
      addr = candidate;
    }
  }
  if (!addr) {
    throw new Error(
      `getCurrentAddress: wallet returned unexpected shape: ${JSON.stringify(raw)}`,
    );
  }
  const trimmed = addr.trim();
  const lower = trimmed.toLowerCase();
  const isBech32 = lower.startsWith('xch1') || lower.startsWith('txch1');
  const stripped = lower.startsWith('0x') ? lower.slice(2) : lower;
  const isHex32 = /^[0-9a-f]{64}$/.test(stripped);
  if (!isBech32 && !isHex32) {
    throw new Error(
      `getCurrentAddress: expected xch1/txch1 bech32 address or 64-char ` +
        `hex puzzle hash, got: ${addr}`,
    );
  }
  return trimmed;
}

function parseStringArrayResult(raw: unknown, label: string): string[] {
  const candidate =
    Array.isArray(raw)
      ? raw
      : raw !== null && typeof raw === 'object'
        ? ((raw as Record<string, unknown>)['coin_ids'] ??
          (raw as Record<string, unknown>)['coinIds'] ??
          (raw as Record<string, unknown>)['coin_names'] ??
          (raw as Record<string, unknown>)['coinNames'])
        : raw;
  if (
    !Array.isArray(candidate) ||
    candidate.some((item) => typeof item !== 'string')
  ) {
    throw new Error(`${label}: wallet returned unexpected shape: ${JSON.stringify(raw)}`);
  }
  return candidate as string[];
}

function parseWireCoinSpend(raw: unknown): UnsignedCoinSpend {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('signSpendBundle: malformed coin spend in wallet response');
  }
  const cs = raw as Record<string, unknown>;
  const coin = (cs['coin'] ?? {}) as Record<string, unknown>;
  return {
    coin: {
      parentCoinInfo: normalizeHex(
        (coin['parent_coin_info'] ?? coin['parentCoinInfo']) as string,
      ),
      puzzleHash: normalizeHex(
        (coin['puzzle_hash'] ?? coin['puzzleHash']) as string,
      ),
      amount:
        typeof coin['amount'] === 'bigint'
          ? (coin['amount'] as bigint)
          : Number(coin['amount']),
    },
    puzzleReveal: normalizeHex(
      (cs['puzzle_reveal'] ?? cs['puzzleReveal']) as string,
    ),
    solution: normalizeHex((cs['solution'] ?? cs['solution_hex']) as string),
  };
}

/**
 * Heuristic detection of "method not supported" errors so the caller
 * can fall back to an alternate method name.  EIP-1193 / WC errors
 * use code 4200 for "Unsupported Method"; some wallets just stuff
 * the message field with "unsupported" or "unknown method".
 */
function isMethodNotSupportedError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const obj = err as Record<string, unknown>;
  if (obj['code'] === 4200 || obj['code'] === -32601) return true;
  const msg = String(obj['message'] ?? '').toLowerCase();
  return (
    msg.includes('unsupported method') ||
    msg.includes('unknown method') ||
    msg.includes('method not found') ||
    msg.includes('not supported')
  );
}

function formatErrorMessage(err: unknown): string {
  if (err === null || err === undefined) return '<no error>';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    return String(obj['message'] ?? JSON.stringify(obj));
  }
  return String(err);
}
