/**
 * Tests for ``RecoveryAnchorBroadcastService`` (Path A brick R1).
 *
 * The service stitches three pieces together:
 *
 *   * Validates the publish-intent + create-coin-preview agree
 *     (the API canonicalises but the caller may have stitched them
 *     from separate fetches).
 *   * Builds a standard wallet spend locally that creates the 1-mojo
 *     marker coin with the two recovery anchor memos, then asks the
 *     connected wallet to sign that spend via signCoinSpends.
 *   * Walks the signed bundle for the ``CREATE_COIN(marker_ph, 1,
 *     [tag_memo, payload_memo])`` condition, derives the marker
 *     coin id, then pushes to coinset.org.
 *
 * The WASM SDK and wallet bridges aren't available in Karma, so
 * we inject stubs that return canned ``Program``-like objects with
 * just enough of the ``toAtom`` / ``toList`` / ``run`` surface for
 * the production code to walk.  Coverage:
 *
 *   * Happy path — wallet returns a bundle whose only spend emits
 *     the expected CREATE_COIN with our memos; service derives the
 *     marker coin id and pushes.
 *   * Mismatched payload/tag/memo hashes between intent + preview
 *     are caught before the wallet is asked to sign.
 *   * Wrong opcode or amount in the preview is rejected.
 *   * Wallet returns a bundle without our memos — service refuses
 *     to push (signed bundle is never broadcast).
 *   * Wallet returns an empty coinSpends array — clear error.
 *   * Multiple CREATE_COIN conditions in one spend — service picks
 *     the matching one and ignores change outputs.
 */
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import {
  BootstrapRecoveryAnchorCreateCoinPreviewResponse,
  BootstrapRecoveryAnchorPublishIntentResponse,
} from './admin-bootstrap.service';
import { ChiaWalletService, SignedSpendBundle } from './chia-wallet.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService, PushTxResponse } from './coinset.service';
import { RecoveryAnchorBroadcastService } from './recovery-anchor-broadcast.service';
import { WalletCoinPickerService } from './wallet-coin-picker.service';

const MARKER_PH = '0x' + 'ef'.repeat(32);
const TAG_MEMO_UTF8 = 'SOLSLOT_BOOTSTRAP_V2';
const PAYLOAD_MEMO_UTF8 =
  '{"admin_authority_v2_launcher_id":"0x' +
  '88'.repeat(32) +
  '","admin_records_hash":"sha256:' +
  '11'.repeat(32) +
  '","authority_version":1,"bootstrap_manifest_hash":"sha256:' +
  '22'.repeat(32) +
  '","network":"testnet11","portal_runtime_config_hash":"sha256:' +
  '33'.repeat(32) +
  '","tag":"SOLSLOT_BOOTSTRAP_V2","version":2}';
const TAG_MEMO_HEX =
  '0x' +
  Array.from(new TextEncoder().encode(TAG_MEMO_UTF8), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
const PAYLOAD_MEMO_HEX =
  '0x' +
  Array.from(new TextEncoder().encode(PAYLOAD_MEMO_UTF8), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
const PAYLOAD_HASH = 'sha256:' + 'aa'.repeat(32);

const FUNDING_PARENT = '0x' + '01'.repeat(32);
const FUNDING_PH = '0x' + '02'.repeat(32);
const FUNDING_AMOUNT = 1_000_000n;
const PUZZLE_REVEAL = '0xff01ff80';
const SOLUTION = '0xff8080';
const PUBKEY = '0x' + '03'.repeat(48);

const VALID_INTENT: BootstrapRecoveryAnchorPublishIntentResponse = {
  network: 'testnet11',
  marker_coin_amount_mojos: 1,
  admin_authority_v2_launcher_id: '0x' + '88'.repeat(32),
  authority_version: 1,
  bootstrap_manifest_hash: 'sha256:' + '22'.repeat(32),
  portal_runtime_config_hash: 'sha256:' + '33'.repeat(32),
  admin_records_hash: 'sha256:' + '11'.repeat(32),
  tag_memo_utf8: TAG_MEMO_UTF8,
  tag_memo_hex: TAG_MEMO_HEX,
  payload_memo_json: {
    version: 2,
    tag: TAG_MEMO_UTF8,
    network: 'testnet11',
    admin_authority_v2_launcher_id: '0x' + '88'.repeat(32),
    authority_version: 1,
    bootstrap_manifest_hash: 'sha256:' + '22'.repeat(32),
    portal_runtime_config_hash: 'sha256:' + '33'.repeat(32),
    admin_records_hash: 'sha256:' + '11'.repeat(32),
  },
  payload_memo_utf8: PAYLOAD_MEMO_UTF8,
  payload_memo_hex: PAYLOAD_MEMO_HEX,
  memos_hex: [TAG_MEMO_HEX, PAYLOAD_MEMO_HEX],
  payload_hash: PAYLOAD_HASH,
};

const VALID_PREVIEW: BootstrapRecoveryAnchorCreateCoinPreviewResponse = {
  condition_opcode: 51,
  marker_puzzle_hash: MARKER_PH,
  marker_coin_amount_mojos: 1,
  tag_memo_hex: TAG_MEMO_HEX,
  payload_memo_hex: PAYLOAD_MEMO_HEX,
  memos_hex: [TAG_MEMO_HEX, PAYLOAD_MEMO_HEX],
  condition_hex: [51, MARKER_PH, 1, [TAG_MEMO_HEX, PAYLOAD_MEMO_HEX]],
  payload_hash: PAYLOAD_HASH,
};

interface FakeProgram {
  toAtom?: () => Uint8Array;
  toList?: () => FakeProgram[];
  run?: (solution: FakeProgram, cost: number, mempool: boolean) => { value: FakeProgram };
}

function atom(bytes: Uint8Array): FakeProgram {
  return { toAtom: () => bytes };
}

function list(items: FakeProgram[]): FakeProgram {
  return { toList: () => items };
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Build a CLVM-condition-shaped FakeProgram for one CREATE_COIN
 * condition.  ``memos`` may be ``null`` to omit the 4th element
 * (legacy 3-field CREATE_COIN), or an array of memo byte strings.
 */
function createCoinCondition(args: {
  puzzleHash: Uint8Array;
  amount: number;
  memos: Uint8Array[] | null;
}): FakeProgram {
  const fields: FakeProgram[] = [
    atom(new Uint8Array([51])),
    atom(args.puzzleHash),
    atom(new Uint8Array([args.amount])),
  ];
  if (args.memos !== null) {
    fields.push(list(args.memos.map((m) => atom(m))));
  }
  return list(fields);
}

/**
 * Stub WASM SDK exposing Clvm + Coin in just enough shape for the
 * recovery anchor service's bundle-walking code path.  ``conditions``
 * is the canned ``puzzle.run(solution).value`` that every
 * ``deserialize().run()`` call will return.
 */
function makeWasmStub(conditions: FakeProgram): Partial<ChiaWasmService> {
  let lastCoinSpend:
    | {
        coin: {
          parentCoinInfo: Uint8Array;
          puzzleHash: Uint8Array;
          amount: bigint;
          coinId: () => Uint8Array;
        };
        puzzleReveal: Uint8Array;
        solution: Uint8Array;
      }
    | null = null;

  class FakeCoin {
    constructor(
      readonly parentCoinInfo: Uint8Array,
      readonly puzzleHash: Uint8Array,
      readonly amount: bigint,
    ) {}
    coinId(): Uint8Array {
      // Deterministic, easy-to-assert coin id derivation:
      // sha256-shaped 32 bytes packing parent[0], puzhash[0], amount-low.
      // Real chia would sha256(parent || ph || amount_atom); the
      // service treats the result as opaque so any bijective
      // function works for tests.
      const out = new Uint8Array(32);
      out[0] = this.parentCoinInfo[0] ?? 0;
      out[1] = this.puzzleHash[0] ?? 0;
      out[2] = Number(this.amount & 0xffn);
      return out;
    }
  }

  return {
    sdk: () =>
      ({
        Clvm: class {
          atom(bytes: Uint8Array): FakeProgram {
            return atom(bytes);
          }
          list(items: FakeProgram[]): FakeProgram {
            return list(items);
          }
          createCoin(
            puzzleHash: Uint8Array,
            amount: bigint,
            memos: FakeProgram | undefined,
          ): FakeProgram {
            return list([
              atom(new Uint8Array([51])),
              atom(puzzleHash),
              atom(new Uint8Array([Number(amount)])),
              memos ?? list([]),
            ]);
          }
          delegatedSpend(_conditions: FakeProgram[]): FakeProgram {
            return {};
          }
          spendStandardCoin(
            coin: FakeCoin,
            _syntheticKey: unknown,
            _innerSpend: FakeProgram,
          ): void {
            lastCoinSpend = {
              coin,
              puzzleReveal: hexToBytes(PUZZLE_REVEAL),
              solution: hexToBytes(SOLUTION),
            };
          }
          coinSpends(): Array<NonNullable<typeof lastCoinSpend>> {
            return lastCoinSpend ? [lastCoinSpend] : [];
          }
          deserialize(_bytes: Uint8Array): FakeProgram {
            return {
              run: (_solution, _cost, _mempool) => ({ value: conditions }),
            };
          }
        },
        Coin: FakeCoin,
        PublicKey: {
          fromBytes: (bytes: Uint8Array) => bytes,
        },
        standardPuzzleHash: (_syntheticKey: unknown) => hexToBytes(FUNDING_PH),
      }) as unknown as ReturnType<ChiaWasmService['sdk']>,
  };
}

function makeWalletStub(
  bundle: SignedSpendBundle | Error,
): jasmine.SpyObj<ChiaWalletService> {
  const spy = jasmine.createSpyObj<ChiaWalletService>('ChiaWalletService', [
    'signSpendBundle',
  ], {
    pubkey: signal(PUBKEY).asReadonly(),
  });
  if (bundle instanceof Error) {
    spy.signSpendBundle.and.rejectWith(bundle);
  } else {
    spy.signSpendBundle.and.resolveTo(bundle);
  }
  return spy;
}

function makeCoinsetStub(
  result: PushTxResponse | Error,
): jasmine.SpyObj<CoinsetService> {
  const spy = jasmine.createSpyObj<CoinsetService>('CoinsetService', [
    'pushTransaction',
    'getCoinRecordByName',
  ]);
  spy.getCoinRecordByName.and.resolveTo({
    coin: {
      parent_coin_info: FUNDING_PARENT,
      puzzle_hash: FUNDING_PH,
      amount: Number(FUNDING_AMOUNT),
    },
    coinbase: false,
    confirmed_block_index: 1,
    spent_block_index: 0,
    timestamp: 0,
  });
  if (result instanceof Error) {
    spy.pushTransaction.and.rejectWith(result);
  } else {
    spy.pushTransaction.and.resolveTo(result);
  }
  return spy;
}

function makeCoinPickerStub(): jasmine.SpyObj<WalletCoinPickerService> {
  const spy = jasmine.createSpyObj<WalletCoinPickerService>('WalletCoinPickerService', [
    'pickLargestUnspentCoinForPuzzleHash',
  ]);
  spy.pickLargestUnspentCoinForPuzzleHash.and.resolveTo({
    coinId: '0x' + '99'.repeat(32),
    address: 'txch1test',
    puzzleHash: FUNDING_PH,
    amount: FUNDING_AMOUNT,
  });
  return spy;
}

function makeBundle(args: {
  conditions?: FakeProgram;
  coinSpends?: SignedSpendBundle['coinSpends'];
}): { bundle: SignedSpendBundle; conditions: FakeProgram } {
  const conditions =
    args.conditions ??
    list([
      createCoinCondition({
        puzzleHash: hexToBytes(MARKER_PH),
        amount: 1,
        memos: [hexToBytes(TAG_MEMO_HEX), hexToBytes(PAYLOAD_MEMO_HEX)],
      }),
    ]);
  const coinSpends: SignedSpendBundle['coinSpends'] = args.coinSpends ?? [
    {
      coin: {
        parentCoinInfo: FUNDING_PARENT,
        puzzleHash: FUNDING_PH,
        amount: FUNDING_AMOUNT,
      },
      puzzleReveal: PUZZLE_REVEAL,
      solution: SOLUTION,
    },
  ];
  return {
    bundle: {
      coinSpends,
      aggregatedSignature: '0x' + 'ab'.repeat(96),
    },
    conditions,
  };
}

describe('RecoveryAnchorBroadcastService', () => {
  let service: RecoveryAnchorBroadcastService;
  let wallet: jasmine.SpyObj<ChiaWalletService>;
  let coinset: jasmine.SpyObj<CoinsetService>;
  let coinPicker: jasmine.SpyObj<WalletCoinPickerService>;

  function setupTestBed(args: {
    bundle: SignedSpendBundle | Error;
    conditions: FakeProgram;
    pushResult: PushTxResponse | Error;
  }): void {
    wallet = makeWalletStub(args.bundle);
    coinset = makeCoinsetStub(args.pushResult);
    coinPicker = makeCoinPickerStub();
    TestBed.configureTestingModule({
      providers: [
        { provide: ChiaWalletService, useValue: wallet },
        { provide: CoinsetService, useValue: coinset },
        { provide: ChiaWasmService, useValue: makeWasmStub(args.conditions) },
        { provide: WalletCoinPickerService, useValue: coinPicker },
      ],
    });
    service = TestBed.inject(RecoveryAnchorBroadcastService);
  }

  // ───────────────────────────────────────────────────────────────────
  // Happy path
  // ───────────────────────────────────────────────────────────────────

  it('broadcasts a valid marker coin and returns the derived marker coin id', async () => {
    const { bundle, conditions } = makeBundle({});
    setupTestBed({
      bundle,
      conditions,
      pushResult: { success: true, status: 'SUCCESS' },
    });

    const result = await service.broadcastMarkerCoin({
      publishIntent: VALID_INTENT,
      createCoinPreview: VALID_PREVIEW,
    });

    // The service selected a wallet coin under the connected standard
    // puzzle hash, built a local marker CREATE_COIN spend, then asked
    // the wallet only for a signature.
    expect(coinPicker.pickLargestUnspentCoinForPuzzleHash)
      .toHaveBeenCalledOnceWith({ puzzleHash: FUNDING_PH });
    expect(wallet.signSpendBundle).toHaveBeenCalledTimes(1);

    // push_tx was called with the wallet-signed bundle verbatim.
    expect(coinset.pushTransaction).toHaveBeenCalledOnceWith({
      coinSpends: bundle.coinSpends,
      aggregatedSignature: bundle.aggregatedSignature,
    });

    expect(result.markerPuzzleHash).toBe(MARKER_PH);
    expect(result.markerCoinAmountMojos).toBe(1);
    expect(result.tagMemoUtf8).toBe(TAG_MEMO_UTF8);
    expect(result.payloadMemoUtf8).toBe(PAYLOAD_MEMO_UTF8);
    expect(result.payloadHash).toBe(PAYLOAD_HASH);
    expect(result.pushStatus).toBe('SUCCESS');
    expect(result.signedSpendBundle).toBe(bundle);

    // Funding coin id derives from FUNDING_PARENT[0]=0x01, FUNDING_PH[0]=0x02,
    // amount=FUNDING_AMOUNT lowbyte = 0x40. Marker coin id from funding[0]
    // (the funding coin's id[0]=0x01), marker_ph[0]=0xef, amount=1.
    expect(result.fundingCoinId.slice(0, 8)).toBe('0x010240');
    expect(result.markerCoinId.slice(0, 8)).toBe('0x01ef01');
  });

  it('picks the matching CREATE_COIN even when the spend emits change outputs too', async () => {
    const conditions = list([
      // Change output back to the wallet.  Wrong puzzle hash; service
      // must walk past this and pick the marker condition below.
      createCoinCondition({
        puzzleHash: hexToBytes(FUNDING_PH),
        amount: 0xee,
        memos: null,
      }),
      // Our marker condition.
      createCoinCondition({
        puzzleHash: hexToBytes(MARKER_PH),
        amount: 1,
        memos: [hexToBytes(TAG_MEMO_HEX), hexToBytes(PAYLOAD_MEMO_HEX)],
      }),
    ]);
    const { bundle } = makeBundle({ conditions });
    setupTestBed({
      bundle,
      conditions,
      pushResult: { success: true, status: 'SUCCESS' },
    });

    const result = await service.broadcastMarkerCoin({
      publishIntent: VALID_INTENT,
      createCoinPreview: VALID_PREVIEW,
    });
    expect(result.markerCoinId.slice(0, 8)).toBe('0x01ef01');
    expect(coinset.pushTransaction).toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────
  // Pre-flight validation (no wallet RPC, no push_tx)
  // ───────────────────────────────────────────────────────────────────

  it('rejects intent/preview pairs with mismatched payload_hash before signing', async () => {
    const { bundle, conditions } = makeBundle({});
    setupTestBed({
      bundle,
      conditions,
      pushResult: { success: true, status: 'SUCCESS' },
    });
    const driftedPreview = { ...VALID_PREVIEW, payload_hash: 'sha256:' + 'ff'.repeat(32) };

    await expectAsync(
      service.broadcastMarkerCoin({
        publishIntent: VALID_INTENT,
        createCoinPreview: driftedPreview,
      }),
    ).toBeRejectedWithError(/payload_hash does not match/);

    expect(wallet.signSpendBundle).not.toHaveBeenCalled();
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('rejects mismatched tag_memo_hex', async () => {
    const { bundle, conditions } = makeBundle({});
    setupTestBed({
      bundle,
      conditions,
      pushResult: { success: true, status: 'SUCCESS' },
    });
    const drifted = { ...VALID_PREVIEW, tag_memo_hex: '0x' + 'ff'.repeat(20) };

    await expectAsync(
      service.broadcastMarkerCoin({
        publishIntent: VALID_INTENT,
        createCoinPreview: drifted,
      }),
    ).toBeRejectedWithError(/tag_memo_hex does not match/);
    expect(wallet.signSpendBundle).not.toHaveBeenCalled();
  });

  it('rejects mismatched payload_memo_hex', async () => {
    const { bundle, conditions } = makeBundle({});
    setupTestBed({
      bundle,
      conditions,
      pushResult: { success: true, status: 'SUCCESS' },
    });
    const drifted = { ...VALID_PREVIEW, payload_memo_hex: '0x' + 'ff'.repeat(40) };

    await expectAsync(
      service.broadcastMarkerCoin({
        publishIntent: VALID_INTENT,
        createCoinPreview: drifted,
      }),
    ).toBeRejectedWithError(/payload_memo_hex does not match/);
    expect(wallet.signSpendBundle).not.toHaveBeenCalled();
  });

  it('rejects previews with the wrong opcode or amount', async () => {
    const { bundle, conditions } = makeBundle({});
    setupTestBed({
      bundle,
      conditions,
      pushResult: { success: true, status: 'SUCCESS' },
    });

    await expectAsync(
      service.broadcastMarkerCoin({
        publishIntent: VALID_INTENT,
        createCoinPreview: { ...VALID_PREVIEW, condition_opcode: 60 },
      }),
    ).toBeRejectedWithError(/only CREATE_COIN/);
    await expectAsync(
      service.broadcastMarkerCoin({
        publishIntent: VALID_INTENT,
        createCoinPreview: { ...VALID_PREVIEW, marker_coin_amount_mojos: 1000 },
      }),
    ).toBeRejectedWithError(/marker coin must be 1 mojo/);
    expect(wallet.signSpendBundle).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────
  // Post-sign / pre-push safety
  // ───────────────────────────────────────────────────────────────────

  it('refuses to push if the wallet stripped our memos (3-field CREATE_COIN)', async () => {
    const conditions = list([
      createCoinCondition({
        puzzleHash: hexToBytes(MARKER_PH),
        amount: 1,
        memos: null, // wallet dropped memos
      }),
    ]);
    const { bundle } = makeBundle({ conditions });
    setupTestBed({
      bundle,
      conditions,
      pushResult: { success: true, status: 'SUCCESS' },
    });

    await expectAsync(
      service.broadcastMarkerCoin({
        publishIntent: VALID_INTENT,
        createCoinPreview: VALID_PREVIEW,
      }),
    ).toBeRejectedWithError(/aborting before push_tx/);

    // Wallet was asked to sign, but push_tx was never invoked.
    expect(wallet.signSpendBundle).toHaveBeenCalled();
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('refuses to push if the wallet reordered the memos', async () => {
    const conditions = list([
      createCoinCondition({
        puzzleHash: hexToBytes(MARKER_PH),
        amount: 1,
        memos: [hexToBytes(PAYLOAD_MEMO_HEX), hexToBytes(TAG_MEMO_HEX)], // swapped
      }),
    ]);
    const { bundle } = makeBundle({ conditions });
    setupTestBed({
      bundle,
      conditions,
      pushResult: { success: true, status: 'SUCCESS' },
    });

    await expectAsync(
      service.broadcastMarkerCoin({
        publishIntent: VALID_INTENT,
        createCoinPreview: VALID_PREVIEW,
      }),
    ).toBeRejectedWithError(/aborting before push_tx/);
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('throws on an empty signed bundle', async () => {
    const { conditions } = makeBundle({});
    setupTestBed({
      bundle: { coinSpends: [], aggregatedSignature: '0x' + 'aa'.repeat(96) },
      conditions,
      pushResult: { success: true, status: 'SUCCESS' },
    });

    await expectAsync(
      service.broadcastMarkerCoin({
        publishIntent: VALID_INTENT,
        createCoinPreview: VALID_PREVIEW,
      }),
    ).toBeRejectedWithError(/no coin spends/);
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────
  // Push error propagation
  // ───────────────────────────────────────────────────────────────────

  it('surfaces coinset push_tx rejections verbatim', async () => {
    const { bundle, conditions } = makeBundle({});
    setupTestBed({
      bundle,
      conditions,
      pushResult: new Error('pushTransaction rejected: DOUBLE_SPEND_DETECTED'),
    });

    await expectAsync(
      service.broadcastMarkerCoin({
        publishIntent: VALID_INTENT,
        createCoinPreview: VALID_PREVIEW,
      }),
    ).toBeRejectedWithError(/DOUBLE_SPEND_DETECTED/);
    expect(coinset.pushTransaction).toHaveBeenCalled();
  });

  it('surfaces wallet rejections without invoking push_tx', async () => {
    const { conditions } = makeBundle({});
    setupTestBed({
      bundle: new Error('User rejected request'),
      conditions,
      pushResult: { success: true, status: 'SUCCESS' },
    });

    await expectAsync(
      service.broadcastMarkerCoin({
        publishIntent: VALID_INTENT,
        createCoinPreview: VALID_PREVIEW,
      }),
    ).toBeRejectedWithError(/User rejected/);
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });
});
