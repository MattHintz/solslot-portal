import { Injectable, signal, computed } from '@angular/core';

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
  private readonly _state = signal<ChiaState>({ kind: 'disconnected' });
  readonly state = this._state.asReadonly();

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

    if (state.connection === 'sage') {
      const sage = (window as WindowWithChia).sage;
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
        parent_coin_info: stripHexPrefix(cs.coin.parentCoinInfo),
        puzzle_hash: stripHexPrefix(cs.coin.puzzleHash),
        amount: typeof cs.coin.amount === 'bigint'
          ? Number(cs.coin.amount)
          : cs.coin.amount,
      },
      puzzle_reveal: stripHexPrefix(cs.puzzleReveal),
      solution: stripHexPrefix(cs.solution),
    }));

    if (state.connection === 'goby') {
      return this.invokeSignCoinSpends(
        (window as WindowWithChia).chia,
        ['signCoinSpends', 'chip0002_signCoinSpends'],
        wireSpends,
      );
    }

    if (state.connection === 'sage') {
      return this.invokeSignCoinSpends(
        (window as WindowWithChia).sage,
        ['chip0002_signCoinSpends', 'chia_signCoinSpends'],
        wireSpends,
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
   * @returns The signed spend bundle ready to combine with our
   *   launcher spend before pushing to coinset.
   */
  async transfer(args: {
    targetPuzzleHash: string;
    amount: number | bigint;
  }): Promise<SignedSpendBundle> {
    const state = this._state();
    if (state.kind !== 'connected') {
      throw new Error('transfer: wallet not connected');
    }
    const amountNum =
      typeof args.amount === 'bigint' ? Number(args.amount) : args.amount;
    if (amountNum < 1) {
      throw new Error('transfer: amount must be >= 1 mojo');
    }
    const targetHashBare = stripHexPrefix(args.targetPuzzleHash);

    if (state.connection === 'goby') {
      return this.invokeTransfer(
        (window as WindowWithChia).chia,
        ['transfer'],
        // Goby's transfer wire format takes amount as number + a
        // "to" address that's typically bech32m, but most builds also
        // accept raw puzzle hashes as a fallback.  We pass the
        // hex puzzle hash directly; if the wallet rejects, the
        // operator will see "invalid recipient" and can fall back
        // to CLI.
        { to: targetHashBare, amount: amountNum },
      );
    }

    if (state.connection === 'sage') {
      return this.invokeTransfer(
        (window as WindowWithChia).sage,
        ['chia_send', 'chip0002_send'],
        { recipient: targetHashBare, amount: amountNum },
      );
    }

    throw new Error(`transfer: unsupported connection: ${state.connection}`);
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

  /** Try each method name in order; return the first successful result. */
  private async invokeSignCoinSpends(
    wallet: ChiaInjected | undefined,
    methods: ReadonlyArray<string>,
    wireSpends: ReadonlyArray<unknown>,
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
        return parseSignCoinSpendsResult(result);
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

  disconnect(): void {
    this._state.set({ kind: 'disconnected' });
  }
}

export type ChiaState =
  | { kind: 'disconnected' }
  | { kind: 'connected'; pubkey: string; connection: 'goby' | 'sage' };

interface ChiaInjected {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
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
