import { TestBed } from '@angular/core/testing';

import { ChiaWalletService } from './chia-wallet.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinRecord, CoinsetService } from './coinset.service';
import { WalletCoinPickerService } from './wallet-coin-picker.service';

/**
 * Karma specs for {@link WalletCoinPickerService}.
 *
 * The service composes three collaborators (wallet RPC, coinset.org
 * RPC, WASM SDK), so these specs mock all three and assert on the
 * orchestration: did we ask the wallet for an address, decode it via
 * WASM, query coinset for the right puzzle hash, pick the largest
 * coin, and compute its coin id via the WASM ``Coin`` class?
 *
 * No real WASM bootstrap or network call here — those are covered by
 * the ``Eip712LeafHashService`` specs (which use the real WASM).
 * Here we want fast, hermetic logic tests.
 */
describe('WalletCoinPickerService', () => {
  // ── Mock collaborators ───────────────────────────────────────────────

  const fakeBech32Address = 'txch1qqq';
  const fakeHexAddress = 'ab'.repeat(32); // 64 hex chars
  const fakeHexAddressWithPrefix = '0x' + 'cd'.repeat(32);

  // Fake puzzle hash bytes (not real bech32 decoding) — the spec
  // mocks the WASM Address constructor + decode entirely.
  const fakePuzzleHash = new Uint8Array(32).fill(0xab);

  // Fake coin id bytes the spec's Coin mock returns.  We assert the
  // service hex-encodes this verbatim.
  const fakeCoinId = new Uint8Array(32).fill(0xcd);

  let walletSpy: jasmine.SpyObj<ChiaWalletService>;
  let coinsetSpy: jasmine.SpyObj<CoinsetService>;
  let wasmStub: { sdk: () => Record<string, unknown> };
  let coinCtorSpy: jasmine.Spy;
  let addressCtorSpy: jasmine.Spy;
  let addressDecodeSpy: jasmine.Spy;

  beforeEach(() => {
    walletSpy = jasmine.createSpyObj('ChiaWalletService', [
      'getCurrentAddress',
      'filterUnlockedCoinIds',
    ]);
    walletSpy.getCurrentAddress.and.resolveTo(fakeBech32Address);
    walletSpy.filterUnlockedCoinIds.and.callFake(async (coinIds: ReadonlyArray<string>) => [
      ...coinIds,
    ]);

    coinsetSpy = jasmine.createSpyObj('CoinsetService', [
      'getCoinRecordsByPuzzleHash',
    ]);

    addressDecodeSpy = jasmine
      .createSpy('Address.decode')
      .and.returnValue({ puzzleHash: fakePuzzleHash, prefix: 'txch' });

    // Address is BOTH a constructor AND has a static decode method.
    // We expose it as a function (constructor) with .decode attached.
    addressCtorSpy = jasmine.createSpy('Address').and.callFake(function (
      this: { encode: () => string },
      _puzzleHash: Uint8Array,
      prefix: string,
    ) {
      this.encode = () => `${prefix}1encoded`;
    });
    (addressCtorSpy as unknown as { decode: jasmine.Spy }).decode = addressDecodeSpy;

    coinCtorSpy = jasmine.createSpy('Coin').and.callFake(function (
      this: { coinId: () => Uint8Array },
    ) {
      this.coinId = () => fakeCoinId;
    });

    wasmStub = {
      sdk: () => ({
        Address: addressCtorSpy,
        Coin: coinCtorSpy,
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        WalletCoinPickerService,
        { provide: ChiaWalletService, useValue: walletSpy },
        { provide: CoinsetService, useValue: coinsetSpy },
        { provide: ChiaWasmService, useValue: wasmStub },
      ],
    });
  });

  function makeRecord(amount: number, parentByte = 0x11, puzzleByte = 0x22): CoinRecord {
    return {
      coin: {
        parent_coin_info:
          '0x' + parentByte.toString(16).padStart(2, '0').repeat(32),
        puzzle_hash:
          '0x' + puzzleByte.toString(16).padStart(2, '0').repeat(32),
        amount,
      },
      confirmed_block_index: 1,
      spent_block_index: 0,
      coinbase: false,
      timestamp: 1700000000,
    };
  }

  function makeUnsafeAmountRecord(amount: unknown): CoinRecord {
    return {
      ...makeRecord(1),
      coin: {
        ...makeRecord(1).coin,
        amount: amount as number,
      },
    };
  }

  it('Sage path: bech32 wallet address → decode → coinset → largest coin id', async () => {
    coinsetSpy.getCoinRecordsByPuzzleHash.and.resolveTo([
      makeRecord(100),
      makeRecord(999),
      makeRecord(1),
    ]);

    const service = TestBed.inject(WalletCoinPickerService);
    const result = await service.pickLargestUnspentCoinId();

    // Wallet was asked for its address.
    expect(walletSpy.getCurrentAddress).toHaveBeenCalledOnceWith();

    // WASM Address.decode received the bech32 string verbatim.
    expect(addressDecodeSpy).toHaveBeenCalledOnceWith(fakeBech32Address);

    // Coinset got the decoded puzzle hash + include_spent_coins=false.
    const expectedPhHex =
      '0x' + Array.from(fakePuzzleHash, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(coinsetSpy.getCoinRecordsByPuzzleHash).toHaveBeenCalledOnceWith(
      expectedPhHex,
      false,
    );

    expect(coinCtorSpy).toHaveBeenCalledTimes(3);
    expect(coinCtorSpy.calls.allArgs().map((args) => args[2])).toEqual([
      100n,
      999n,
      1n,
    ]);

    // Returned coin id matches the WASM stub's value.
    const expectedCoinIdHex =
      '0x' + Array.from(fakeCoinId, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(result.coinId).toBe(expectedCoinIdHex);
    // Bech32 input is preserved as-is in the display address.
    expect(result.address).toBe(fakeBech32Address);
    expect(result.puzzleHash).toBe(expectedPhHex);
    expect(result.amount).toBe(999n);
  });

  it('filters out wallet-locked coins before picking the largest candidate', async () => {
    coinCtorSpy.and.callFake(function (
      this: { coinId: () => Uint8Array },
      parentCoinInfo: Uint8Array,
    ) {
      this.coinId = () => new Uint8Array(32).fill(parentCoinInfo[0]);
    });
    const largestLockedId = '0x' + '33'.repeat(32);
    const nextLargestUnlockedId = '0x' + '22'.repeat(32);
    walletSpy.filterUnlockedCoinIds.and.resolveTo([nextLargestUnlockedId]);
    coinsetSpy.getCoinRecordsByPuzzleHash.and.resolveTo([
      makeRecord(100, 0x11),
      makeRecord(700, 0x22),
      makeRecord(999, 0x33),
    ]);

    const service = TestBed.inject(WalletCoinPickerService);
    const result = await service.pickLargestUnspentCoinId();

    expect(walletSpy.filterUnlockedCoinIds).toHaveBeenCalledOnceWith([
      '0x' + '11'.repeat(32),
      nextLargestUnlockedId,
      largestLockedId,
    ]);
    expect(result.coinId).toBe(nextLargestUnlockedId);
    expect(result.amount).toBe(700n);
  });

  it('Goby path: bare hex puzzle hash → used directly + encoded to bech32 for display', async () => {
    walletSpy.getCurrentAddress.and.resolveTo(fakeHexAddress);
    coinsetSpy.getCoinRecordsByPuzzleHash.and.resolveTo([makeRecord(500)]);

    const service = TestBed.inject(WalletCoinPickerService);
    const result = await service.pickLargestUnspentCoinId();

    // Address.decode should NOT be called for hex input.
    expect(addressDecodeSpy).not.toHaveBeenCalled();

    // Coinset got the hex bytes verbatim (just 0x-prefixed).
    expect(coinsetSpy.getCoinRecordsByPuzzleHash).toHaveBeenCalledOnceWith(
      '0x' + fakeHexAddress,
      false,
    );

    // The hex was encoded to bech32 for display via the Address constructor.
    expect(addressCtorSpy).toHaveBeenCalled();
    const addrCtorArgs = addressCtorSpy.calls.mostRecent().args;
    expect(addrCtorArgs[1]).toBe('txch'); // testnet11 dev default
    expect(result.address).toBe('txch1encoded');
    expect(result.puzzleHash).toBe('0x' + fakeHexAddress);
    expect(result.amount).toBe(500n);
  });

  it('Goby path: 0x-prefixed hex puzzle hash is also accepted', async () => {
    walletSpy.getCurrentAddress.and.resolveTo(fakeHexAddressWithPrefix);
    coinsetSpy.getCoinRecordsByPuzzleHash.and.resolveTo([makeRecord(7)]);

    const service = TestBed.inject(WalletCoinPickerService);
    const result = await service.pickLargestUnspentCoinId();

    // 0x prefix should be stripped before forming the lookup hex.
    expect(coinsetSpy.getCoinRecordsByPuzzleHash).toHaveBeenCalledOnceWith(
      fakeHexAddressWithPrefix,
      false,
    );
    expect(result.amount).toBe(7n);
  });

  it('can pick directly from an explicit puzzle hash without reading the current address', async () => {
    coinsetSpy.getCoinRecordsByPuzzleHash.and.resolveTo([makeRecord(321)]);

    const service = TestBed.inject(WalletCoinPickerService);
    const result = await service.pickLargestUnspentCoinForPuzzleHash({
      puzzleHash: '0x' + 'ef'.repeat(32),
      displayAddress: 'txch1funding',
    });

    expect(walletSpy.getCurrentAddress).not.toHaveBeenCalled();
    expect(addressDecodeSpy).not.toHaveBeenCalled();
    expect(coinsetSpy.getCoinRecordsByPuzzleHash).toHaveBeenCalledOnceWith(
      '0x' + 'ef'.repeat(32),
      false,
    );
    expect(result.address).toBe('txch1funding');
    expect(result.puzzleHash).toBe('0x' + 'ef'.repeat(32));
    expect(result.amount).toBe(321n);
  });

  it('rejects unrecognised address formats with a clear error', async () => {
    walletSpy.getCurrentAddress.and.resolveTo('not-a-valid-address');
    const service = TestBed.inject(WalletCoinPickerService);
    await expectAsync(service.pickLargestUnspentCoinId()).toBeRejectedWithError(
      /Unrecognised wallet address format/,
    );
  });

  it('throws a clear error when no unspent coins exist', async () => {
    coinsetSpy.getCoinRecordsByPuzzleHash.and.resolveTo([]);
    const service = TestBed.inject(WalletCoinPickerService);
    await expectAsync(service.pickLargestUnspentCoinId()).toBeRejectedWithError(
      /No unspent coins/,
    );
  });

  it('throws a clear error when all chain-unspent coins are wallet-locked', async () => {
    coinsetSpy.getCoinRecordsByPuzzleHash.and.resolveTo([makeRecord(42)]);
    walletSpy.filterUnlockedCoinIds.and.resolveTo([]);
    const service = TestBed.inject(WalletCoinPickerService);
    await expectAsync(service.pickLargestUnspentCoinId()).toBeRejectedWithError(
      /No wallet-unlocked coins/,
    );
  });

  it('propagates wallet errors verbatim', async () => {
    walletSpy.getCurrentAddress.and.rejectWith(new Error('user rejected'));
    const service = TestBed.inject(WalletCoinPickerService);
    await expectAsync(service.pickLargestUnspentCoinId()).toBeRejectedWithError(
      /user rejected/,
    );
  });

  it('throws when WASM is missing required exports', async () => {
    wasmStub = {
      sdk: () => ({
        // Missing Address + Coin entirely.
      }),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        WalletCoinPickerService,
        { provide: ChiaWalletService, useValue: walletSpy },
        { provide: CoinsetService, useValue: coinsetSpy },
        { provide: ChiaWasmService, useValue: wasmStub },
      ],
    });
    const service = TestBed.inject(WalletCoinPickerService);
    await expectAsync(service.pickLargestUnspentCoinId()).toBeRejectedWithError(
      /missing coin helpers/,
    );
  });

  it('handles a single-coin wallet (no comparison needed)', async () => {
    coinsetSpy.getCoinRecordsByPuzzleHash.and.resolveTo([makeRecord(42)]);
    const service = TestBed.inject(WalletCoinPickerService);
    const result = await service.pickLargestUnspentCoinId();
    expect(result.amount).toBe(42n);
    expect(coinCtorSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe coin amounts returned by coinset before coin-id math', async () => {
    coinsetSpy.getCoinRecordsByPuzzleHash.and.resolveTo([
      makeUnsafeAmountRecord(Number.MAX_SAFE_INTEGER + 1),
    ]);
    const service = TestBed.inject(WalletCoinPickerService);
    await expectAsync(service.pickLargestUnspentCoinId()).toBeRejectedWithError(
      /safe integer mojo amount/,
    );
    expect(coinCtorSpy).not.toHaveBeenCalled();
  });
});
