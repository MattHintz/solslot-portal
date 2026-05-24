import { Injectable, inject } from '@angular/core';

import { ChiaWalletService } from './chia-wallet.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService, CoinRecord } from './coinset.service';
import { parseMojoAmount } from '../utils/mojo-amount';

/**
 * One-shot helper that picks an unspent coin from the connected
 * Chia wallet's first-derivation receive address.
 *
 * **Why this lives outside the wizard.** Phase 9-Hermes-D's launch
 * wizard isn't the only place that needs a "which coin do I spend?"
 * answer — vault top-ups, mint funding, and admin rotations all
 * reach for the same logic.  We isolate it as a service so each
 * caller stays small and the wallet-bridge / coinset / WASM
 * dependencies don't bleed into UI code.
 *
 * **Pipeline.**
 *   1. Ask the connected wallet (Goby / Sage) for its current
 *      bech32m receive address via
 *      ``ChiaWalletService.getCurrentAddress``.
 *   2. Decode that bech32 → 32-byte puzzle hash via the WASM
 *      ``Address.decode`` helper.
 *   3. Query coinset.org's ``get_coin_records_by_puzzle_hash`` for
 *      unspent coins under that puzzle hash.
 *   4. Compute the canonical coin id of each via the WASM ``Coin``
 *      class's ``coinId()`` (``sha256(parent || puzzle_hash ||
 *      amount_clvm_atom)``).  We deliberately don't open-code this
 *      hash in JS — CLVM atom encoding for the amount has subtle
 *      sign-bit quirks the WASM gets right by construction.
 *   5. Return the coin id of the largest-amount unspent coin.
 *
 * **What we DO NOT do.** We don't reserve / lock the coin.  By the
 * time the operator clicks Submit the wallet may have spent it
 * (e.g. on a competing transaction); the wallet will pick its own
 * coin at sign time anyway.  This helper is a UX nicety to populate
 * the deterministic-preview field with a *plausible* coin id, not a
 * coin-management tool.
 */
@Injectable({ providedIn: 'root' })
export class WalletCoinPickerService {
  private readonly wallet = inject(ChiaWalletService);
  private readonly coinset = inject(CoinsetService);
  private readonly chiaWasm = inject(ChiaWasmService);

  /**
   * Fetch the largest unspent coin under the connected wallet's
   * receive address, returning its 32-byte coin id (0x-prefixed).
   *
   * Throws if:
   *   * the wallet isn't connected;
   *   * the wallet's ``getCurrentAddress`` RPC fails;
   *   * the address doesn't decode (bad HRP / checksum);
   *   * coinset.org reports no unspent coins under that puzzle hash;
   *   * required WASM exports (``Address``, ``Coin``) are missing.
   *
   * @returns ``{ coinId, address, puzzleHash, amount }`` so the
   *   caller can surface debugging info ("we picked coin X under
   *   address Y with N mojos") instead of just an opaque hash.
   */
  async pickLargestUnspentCoinId(): Promise<{
    coinId: string;
    address: string;
    puzzleHash: string;
    amount: bigint;
  }> {
    const sdk = this.chiaWasm.sdk();
    const AddressClass = sdk['Address'] as
      | (new (puzzleHash: Uint8Array, prefix: string) => {
          encode: () => string;
        })
      | undefined;
    const AddressDecode = (sdk['Address'] as
      | { decode?: (encoded: string) => { puzzleHash: Uint8Array; prefix: string } }
      | undefined)?.decode;
    const CoinClass = sdk['Coin'] as
      | (new (
          parentCoinInfo: Uint8Array,
          puzzleHash: Uint8Array,
          amount: bigint,
        ) => { coinId: () => Uint8Array })
      | undefined;
    if (
      typeof AddressDecode !== 'function' ||
      typeof CoinClass !== 'function' ||
      typeof AddressClass !== 'function'
    ) {
      throw new Error(
        'chia-wallet-sdk-wasm is missing coin helpers. ' +
          'Required exports: Address (constructor + decode + encode), ' +
          'Coin (constructor + coinId()).',
      );
    }

    const rawAddress = await this.wallet.getCurrentAddress();

    // Goby's ``chia.selectedAddress`` returns a *hex puzzle hash*
    // (e.g. ``"abc123..."`` 64 chars).  Sage's ``chia_getCurrentAddress``
    // returns a *bech32* address (e.g. ``"txch1..."``).  Accept both.
    // Reference: solslot stores ``chia.selectedAddress`` as
    // ``HEX_WALLET_ADDRESS`` and calls ``toChainAddress(...)`` to
    // convert to bech32 for display.
    const { puzzleHashBytes, displayAddress } = normalizeWalletAddress(
      rawAddress,
      AddressClass,
      AddressDecode,
    );
    const puzzleHashHex = bytesToHex(puzzleHashBytes);

    return this.pickLargestUnspentCoinForPuzzleHash({
      puzzleHash: puzzleHashHex,
      displayAddress,
    });
  }

  async pickLargestUnspentCoinForPuzzleHash(args: {
    puzzleHash: string;
    displayAddress?: string;
  }): Promise<{
    coinId: string;
    address: string;
    puzzleHash: string;
    amount: bigint;
  }> {
    const sdk = this.chiaWasm.sdk();
    const CoinClass = sdk['Coin'] as
      | (new (
          parentCoinInfo: Uint8Array,
          puzzleHash: Uint8Array,
          amount: bigint,
        ) => { coinId: () => Uint8Array })
      | undefined;
    if (typeof CoinClass !== 'function') {
      throw new Error(
        'chia-wallet-sdk-wasm is missing coin helpers. ' +
          'Required export: Coin (constructor + coinId()).',
      );
    }
    const puzzleHashHex = ensure0xHex(args.puzzleHash);
    const displayAddress = args.displayAddress ?? puzzleHashHex;
    const records = await this.coinset.getCoinRecordsByPuzzleHash(
      puzzleHashHex,
      false, // include_spent_coins=false — we only want spendable coins
    );
    if (records.length === 0) {
      throw new Error(
        `No unspent coins at ${displayAddress}.  ` +
          'Send some TXCH/XCH to your wallet first, or pick a different ' +
          'receive address.',
      );
    }

    // Pick the largest-amount coin.  Some wallets shuffle their
    // change across many small coins; using the largest minimises
    // the chance of "coin already spent" by the time the operator
    // clicks Submit.
    const candidates = records.map((record) => {
      const amount = parseMojoAmount(record.coin.amount, 'coin amount');
      const coin = new CoinClass(
        hexToBytes(record.coin.parent_coin_info),
        hexToBytes(record.coin.puzzle_hash),
        amount,
      );
      return {
        record,
        amount,
        coinId: bytesToHex(coin.coinId()),
      };
    });
    const unlockedCoinIds = await this.wallet.filterUnlockedCoinIds(
      candidates.map((candidate) => candidate.coinId),
    );
    const unlockedSet = new Set(
      unlockedCoinIds.map((coinId) => ensure0xHex(coinId).toLowerCase()),
    );
    const spendable = candidates.filter((candidate) =>
      unlockedSet.has(candidate.coinId.toLowerCase()),
    );
    if (spendable.length === 0) {
      throw new Error(
        `No wallet-unlocked coins at ${displayAddress}.  ` +
          'The wallet may have pending or cancelled transactions; wait for ' +
          'the wallet to unlock coins or choose a different wallet.',
      );
    }

    const largest = pickLargest(spendable);
    return {
      coinId: largest.coinId,
      address: displayAddress,
      puzzleHash: ensure0xHex(puzzleHashHex),
      amount: largest.amount,
    };
  }
}

/**
 * Coerce whatever the wallet returned into ``{ puzzleHashBytes, displayAddress }``.
 *
 * Wallet bridges return the address in two distinct formats depending
 * on the bridge:
 *
 *   * **Goby** — ``chia.selectedAddress`` is a *hex puzzle hash*
 *     (64 hex chars, optionally ``0x``-prefixed; never bech32).
 *   * **Sage** — ``chia_getCurrentAddress`` RPC returns *bech32*
 *     (``txch1...`` / ``xch1...``).
 *
 * We accept either + always derive 32 puzzle-hash bytes for the coinset
 * lookup.  The ``displayAddress`` is normalised to bech32 if we can
 * (so the green confirmation always shows the user-friendly form);
 * if the input was hex with no clear network hint we fall back to a
 * ``txch`` prefix (testnet11 is the dev default).
 */
function normalizeWalletAddress(
  raw: string,
  AddressCtor: new (puzzleHash: Uint8Array, prefix: string) => { encode: () => string },
  decodeFn: (encoded: string) => { puzzleHash: Uint8Array; prefix: string },
): { puzzleHashBytes: Uint8Array; displayAddress: string } {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // Bech32 path: starts with a known Chia HRP.
  if (lower.startsWith('xch1') || lower.startsWith('txch1')) {
    const decoded = decodeFn(trimmed);
    return { puzzleHashBytes: decoded.puzzleHash, displayAddress: trimmed };
  }

  // Hex path: 64 hex chars (or 66 with ``0x`` prefix).
  const stripped = lower.startsWith('0x') ? lower.slice(2) : lower;
  if (/^[0-9a-f]{64}$/.test(stripped)) {
    const bytes = hexToBytes(stripped);
    // Encode as bech32 for display.  We can't tell from the bytes
    // alone which network the wallet was using, so default to
    // ``txch`` (testnet11) — this is dev-tooling for v2 admin
    // launches, which always run on testnet11 first.  Mainnet ops
    // can ignore the displayed prefix; the puzzle-hash bytes are
    // what actually drive the coinset lookup.
    let display: string;
    try {
      display = new AddressCtor(bytes, 'txch').encode();
    } catch {
      display = '0x' + stripped;
    }
    return { puzzleHashBytes: bytes, displayAddress: display };
  }

  throw new Error(
    `Unrecognised wallet address format: ${raw} (expected bech32 ` +
      `txch1.../xch1... or 64-char hex puzzle hash)`,
  );
}

/** Pick the unspent coin with the largest mojo amount (ties broken arbitrarily). */
function pickLargest<T extends { amount: bigint }>(records: ReadonlyArray<T>): T {
  let best = records[0];
  for (const r of records.slice(1)) {
    if (r.amount > best.amount) {
      best = r;
    }
  }
  return best;
}

function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (stripped.length % 2 !== 0) {
    throw new Error(`hex string must have even length, got ${stripped.length}`);
  }
  const bytes = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < stripped.length; i += 2) {
    bytes[i / 2] = parseInt(stripped.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return (
    '0x' +
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  );
}

function ensure0xHex(s: string): string {
  return s.startsWith('0x') ? s : '0x' + s;
}
