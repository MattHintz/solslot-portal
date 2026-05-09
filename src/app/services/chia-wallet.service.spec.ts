/**
 * Tests for ``ChiaWalletService.signSpendBundle`` (Phase 9-Hermes-D D-2.3).
 *
 * The method bridges to Goby/Sage's CHIP-0002 ``signCoinSpends`` RPC.
 * We can't run a real wallet in Karma, so each test installs a mock
 * ``window.chia`` (Goby) or ``window.sage`` (Sage) that records the
 * method+params it was called with and returns a canned response in
 * one of the wire shapes wallets in the wild produce.
 *
 * Coverage:
 *   * Happy path Goby — flat ``{ signature, spendBundle: { coin_spends } }``
 *     response shape.
 *   * Happy path Sage — ``{ aggregatedSignature, coinSpends }`` shape.
 *   * Method-name fallback — first method throws "unsupported", second
 *     succeeds.
 *   * User-rejection error surfaces immediately (no fallback).
 *   * Disconnected wallet — clear error.
 *   * Empty coinSpends array — clear error.
 *   * String-only signature reply (older wallets) — accepted.
 */
import { TestBed } from '@angular/core/testing';

import {
  ChiaWalletService,
  SignedSpendBundle,
  UnsignedCoinSpend,
} from './chia-wallet.service';
import { ChiaWasmService } from './chia-wasm.service';

/**
 * Stub WASM SDK that exposes just enough of the ``Address``
 * constructor for the transfer-flow specs to exercise the
 * hex→bech32 encoding path.  Returns a deterministic
 * ``txch1<hex>`` string so tests can assert the recipient format
 * without depending on real bech32m checksum logic.
 */
function makeWasmStub(): Partial<ChiaWasmService> {
  // The transfer flow only uses ``sdk()``, never ``ready``, so we
  // narrow the stub to that surface and cast through ``unknown`` to
  // satisfy ``Partial<ChiaWasmService>``.  A real ``ready`` signal
  // here would require importing Angular's signal API into specs.
  return {
    sdk: () =>
      ({
        Address: class {
          private readonly puzzleHash: Uint8Array;
          private readonly prefix: string;
          constructor(puzzleHash: Uint8Array, prefix: string) {
            this.puzzleHash = puzzleHash;
            this.prefix = prefix;
          }
          encode(): string {
            const hex = Array.from(this.puzzleHash, (b) =>
              b.toString(16).padStart(2, '0'),
            ).join('');
            return `${this.prefix}1${hex}`;
          }
        },
      }) as unknown as ReturnType<ChiaWasmService['sdk']>,
  };
}

interface MockedWalletCall {
  method: string;
  params: unknown;
}

/**
 * Install a mock ``window.chia`` or ``window.sage`` that records calls
 * and returns canned responses.  ``responseFn`` decides what each
 * call returns (or throws); the recorded ``calls`` array lets tests
 * verify the wire-format shape sent to the wallet.
 */
function installMockWallet(
  field: 'chia' | 'sage',
  responseFn: (method: string, params: unknown) => unknown,
): { calls: MockedWalletCall[]; uninstall: () => void } {
  const calls: MockedWalletCall[] = [];
  const w = window as unknown as Record<string, unknown>;
  const previous = w[field];
  w[field] = {
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      calls.push({ method, params });
      const result = responseFn(method, params);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return {
    calls,
    uninstall: () => {
      if (previous === undefined) {
        delete w[field];
      } else {
        w[field] = previous;
      }
    },
  };
}

const SAMPLE_COIN_SPENDS: UnsignedCoinSpend[] = [
  {
    coin: {
      parentCoinInfo: '0x' + 'a1'.repeat(32),
      puzzleHash: '0x' + 'b2'.repeat(32),
      amount: 1n,
    },
    puzzleReveal: '0xff01ff80',
    solution: '0xff8080',
  },
];

const SAMPLE_SIG = '0x' + 'ab'.repeat(96);

describe('ChiaWalletService.signSpendBundle', () => {
  let service: ChiaWalletService;
  let cleanup: Array<() => void> = [];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: ChiaWasmService, useValue: makeWasmStub() }],
    });
    service = TestBed.inject(ChiaWalletService);
    cleanup = [];
  });

  afterEach(() => {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    service.disconnect();
  });

  // Helper to put the service in a connected state without going
  // through a real wallet.  Connection + signing are independent
  // concerns; tests for one shouldn't require the other to work.
  function setConnectedState(connection: 'goby' | 'sage'): void {
    const internal = service as unknown as {
      _state: { set: (s: unknown) => void };
    };
    internal._state.set({
      kind: 'connected',
      pubkey: '0x' + 'cc'.repeat(48),
      connection,
    });
  }

  // ───────────────────────────────────────────────────────────────────
  // Happy paths
  // ───────────────────────────────────────────────────────────────────

  it('Goby: signCoinSpends returns spendBundle-nested coin_spends', async () => {
    setConnectedState('goby');
    const mock = installMockWallet('chia', (method) => {
      expect(method)
        .withContext('Goby should be called with signCoinSpends first')
        .toBe('signCoinSpends');
      return {
        signature: SAMPLE_SIG,
        spendBundle: {
          coin_spends: [
            {
              coin: {
                parent_coin_info: 'a1'.repeat(32),
                puzzle_hash: 'b2'.repeat(32),
                amount: 1,
              },
              puzzle_reveal: 'ff01ff80',
              solution: 'ff8080',
            },
          ],
        },
      };
    });
    cleanup.push(mock.uninstall);

    const result: SignedSpendBundle = await service.signSpendBundle(SAMPLE_COIN_SPENDS);
    expect(result.aggregatedSignature).toBe(SAMPLE_SIG);
    expect(result.coinSpends.length).toBe(1);
    expect(result.coinSpends[0].coin.amount).toBe(1);
    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0].method).toBe('signCoinSpends');
  });

  it('Sage: chip0002_signCoinSpends returns flat coinSpends + aggregatedSignature', async () => {
    setConnectedState('sage');
    const mock = installMockWallet('sage', (method) => {
      expect(method)
        .withContext('Sage should prefer chip0002_signCoinSpends first')
        .toBe('chip0002_signCoinSpends');
      return {
        aggregatedSignature: SAMPLE_SIG,
        coinSpends: [
          {
            coin: {
              parentCoinInfo: 'a1'.repeat(32),
              puzzleHash: 'b2'.repeat(32),
              amount: 1,
            },
            puzzleReveal: 'ff01ff80',
            solution: 'ff8080',
          },
        ],
      };
    });
    cleanup.push(mock.uninstall);

    const result = await service.signSpendBundle(SAMPLE_COIN_SPENDS);
    expect(result.aggregatedSignature).toBe(SAMPLE_SIG);
    expect(result.coinSpends.length).toBe(1);
  });

  it('accepts a string-only signature (Goby docs.goby.app/methods shape)', async () => {
    // Goby's signCoinSpends returns Promise<string> per the docs —
    // we populate coinSpends from the input array since the
    // signature commits to those exact spends anyway.
    setConnectedState('goby');
    const mock = installMockWallet('chia', () => SAMPLE_SIG);
    cleanup.push(mock.uninstall);

    const result = await service.signSpendBundle(SAMPLE_COIN_SPENDS);
    expect(result.aggregatedSignature).toBe(SAMPLE_SIG);
    expect(result.coinSpends.length).toBe(1);
    expect(result.coinSpends[0]).toEqual(SAMPLE_COIN_SPENDS[0]);
  });

  // ───────────────────────────────────────────────────────────────────
  // Method-name fallback
  // ───────────────────────────────────────────────────────────────────

  it('falls back to second method name when first is unsupported (Sage)', async () => {
    setConnectedState('sage');
    // Single mock that throws "method not supported" for the
    // chip0002 form and succeeds on the chia_ form.  installMockWallet's
    // responseFn returns an Error for the wallet to throw — the helper's
    // ``instanceof Error`` check propagates it through wallet.request's
    // promise-rejection path so signSpendBundle can catch + retry.
    const mock = installMockWallet('sage', (method) => {
      if (method === 'chip0002_signCoinSpends') {
        const e = new Error('Unsupported Method');
        (e as unknown as { code: number }).code = 4200;
        return e;
      }
      expect(method).toBe('chia_signCoinSpends');
      return { aggregatedSignature: SAMPLE_SIG, coinSpends: [] };
    });
    cleanup.push(mock.uninstall);

    const result = await service.signSpendBundle(SAMPLE_COIN_SPENDS);
    expect(result.aggregatedSignature).toBe(SAMPLE_SIG);
    expect(mock.calls.length)
      .withContext('Should retry exactly once after first method 4200')
      .toBe(2);
    expect(mock.calls[0].method).toBe('chip0002_signCoinSpends');
    expect(mock.calls[1].method).toBe('chia_signCoinSpends');
  });

  // ───────────────────────────────────────────────────────────────────
  // Error paths
  // ───────────────────────────────────────────────────────────────────

  it('surfaces user-rejection errors immediately (no fallback)', async () => {
    setConnectedState('goby');
    const mock = installMockWallet('chia', () => {
      const e = new Error('User rejected request');
      (e as unknown as { code: number }).code = 4001;
      return e;
    });
    cleanup.push(mock.uninstall);

    await expectAsync(service.signSpendBundle(SAMPLE_COIN_SPENDS)).toBeRejectedWithError(
      /User rejected/,
    );
    // Only ONE method tried — user-rejection ≠ method-not-supported.
    expect(mock.calls.length).toBe(1);
  });

  it('throws a clear error when wallet is disconnected', async () => {
    // No setConnectedState() call — service is in 'disconnected' state.
    await expectAsync(service.signSpendBundle(SAMPLE_COIN_SPENDS)).toBeRejectedWithError(
      /not connected/,
    );
  });

  it('throws a clear error on empty coinSpends array', async () => {
    setConnectedState('goby');
    await expectAsync(service.signSpendBundle([])).toBeRejectedWithError(
      /empty coinSpends/,
    );
  });

  it('rejects unsafe coin spend amounts before wallet serialization', async () => {
    setConnectedState('goby');
    const mock = installMockWallet('chia', () => SAMPLE_SIG);
    cleanup.push(mock.uninstall);

    await expectAsync(
      service.signSpendBundle([
        {
          ...SAMPLE_COIN_SPENDS[0],
          coin: {
            ...SAMPLE_COIN_SPENDS[0].coin,
            amount: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          },
        },
      ]),
    ).toBeRejectedWithError(/safe integer range/);
    expect(mock.calls.length).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────
  // Wire format
  // ───────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────
  // transfer (D-2.6)
  // ───────────────────────────────────────────────────────────────────

  describe('transfer', () => {
    it('Goby: calls "transfer" with bech32 to + assetId + waitForConfirmation=false', async () => {
      setConnectedState('goby');
      const mock = installMockWallet('chia', (method, params) => {
        expect(method).toBe('transfer');
        const p = params as {
          to: string;
          amount: number;
          assetId: string;
          fee: number;
          memos: unknown[];
          waitForConfirmation: boolean;
        };
        // Recipient must be bech32 (testnet11 prefix), not raw hex —
        // Goby rejects hex with "Invalid assetId" (code 4000) /
        // "invalid recipient".  Our stub encodes 32 bytes of 0xaa as
        // ``txch1<hex>``.
        expect(p.to).toBe('txch1' + 'aa'.repeat(32));
        // Empty assetId means native XCH.  Goby requires this field
        // to be present even when sending XCH.
        expect(p.assetId).toBe('');
        expect(p.fee).toBe(0);
        expect(p.memos).toEqual([]);
        expect(p.waitForConfirmation)
          .withContext('must be false so Goby returns the signed bundle')
          .toBe(false);
        expect(p.amount).toBe(1);
        return {
          signature: SAMPLE_SIG,
          spendBundle: { coin_spends: [] },
        };
      });
      cleanup.push(mock.uninstall);

      const result = await service.transfer({
        targetPuzzleHash: '0x' + 'aa'.repeat(32),
        amount: 1,
      });
      expect(result.aggregatedSignature).toBe(SAMPLE_SIG);
    });

    it('Sage: tries chia_send first, falls back to chip0002_send', async () => {
      setConnectedState('sage');
      const mock = installMockWallet('sage', (method) => {
        if (method === 'chia_send') {
          const e = new Error('Unknown method');
          (e as unknown as { code: number }).code = -32601;
          return e;
        }
        expect(method).toBe('chip0002_send');
        return { aggregatedSignature: SAMPLE_SIG, coinSpends: [] };
      });
      cleanup.push(mock.uninstall);

      const result = await service.transfer({
        targetPuzzleHash: 'bb'.repeat(32), // bare hex (no 0x) also accepted
        amount: 1n,
      });
      expect(result.aggregatedSignature).toBe(SAMPLE_SIG);
      expect(mock.calls.length).toBe(2);
    });

    it('rejects auto-broadcast (wallet returned only a tx id)', async () => {
      setConnectedState('goby');
      const mock = installMockWallet('chia', () => ({
        transactionId: '0x' + 'de'.repeat(32),
      }));
      cleanup.push(mock.uninstall);

      await expectAsync(
        service.transfer({
          targetPuzzleHash: '0x' + 'aa'.repeat(32),
          amount: 1,
        }),
      ).toBeRejectedWithError(/auto-broadcasted/);
    });

    it('throws on amount < 1', async () => {
      setConnectedState('goby');
      await expectAsync(
        service.transfer({
          targetPuzzleHash: '0x' + 'aa'.repeat(32),
          amount: 0,
        }),
      ).toBeRejectedWithError(/>= 1 mojo/);
    });

    it('rejects unsafe transfer amounts before wallet RPC', async () => {
      setConnectedState('goby');
      const mock = installMockWallet('chia', () => SAMPLE_SIG);
      cleanup.push(mock.uninstall);

      await expectAsync(
        service.transfer({
          targetPuzzleHash: '0x' + 'aa'.repeat(32),
          amount: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        }),
      ).toBeRejectedWithError(/safe integer range/);
      expect(mock.calls.length).toBe(0);
    });

    it('throws when not connected', async () => {
      await expectAsync(
        service.transfer({
          targetPuzzleHash: '0x' + 'aa'.repeat(32),
          amount: 1,
        }),
      ).toBeRejectedWithError(/not connected/);
    });
  });

  it('strips 0x prefix and uses snake_case in wire format', async () => {
    setConnectedState('goby');
    const mock = installMockWallet('chia', () => ({
      signature: SAMPLE_SIG,
      coinSpends: [],
    }));
    cleanup.push(mock.uninstall);

    await service.signSpendBundle(SAMPLE_COIN_SPENDS);

    const params = mock.calls[0].params as {
      coinSpends: Array<{
        coin: {
          parent_coin_info: string;
          puzzle_hash: string;
          amount: number;
        };
        puzzle_reveal: string;
        solution: string;
      }>;
    };
    expect(params.coinSpends[0].coin.parent_coin_info).toBe('a1'.repeat(32));
    expect(params.coinSpends[0].coin.parent_coin_info.startsWith('0x'))
      .withContext('hex prefix should be stripped before sending to wallet')
      .toBe(false);
    expect(params.coinSpends[0].coin.puzzle_hash).toBe('b2'.repeat(32));
    expect(params.coinSpends[0].coin.amount)
      .withContext('amount should be number for wire format, not bigint')
      .toBe(1);
    expect(params.coinSpends[0].puzzle_reveal).toBe('ff01ff80');
    expect(params.coinSpends[0].solution).toBe('ff8080');
  });
});

// ─────────────────────────────────────────────────────────────────────
// getCurrentAddress
//
// Goby exposes the address as a *property* (``window.chia.selectedAddress``)
// not via an RPC method.  Sage exposes it via ``chia_getCurrentAddress``
// RPC.  These specs pin both code paths so we don't accidentally regress
// to "RPC-only" assumptions.
//
// Reference: solslot's
// ``research/solslot-frontend/slui/src/app/components/connect-wallet-modal/connect-wallet-modal.component.ts:317``
// uses ``chia.selectedAddress`` directly after ``getPublicKeys`` succeeds.
// ─────────────────────────────────────────────────────────────────────

describe('ChiaWalletService.getCurrentAddress', () => {
  let service: ChiaWalletService;
  let cleanup: Array<() => void> = [];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChiaWalletService);
    cleanup = [];
  });

  afterEach(() => {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    service.disconnect();
  });

  function setConnected(connection: 'goby' | 'sage'): void {
    const internal = service as unknown as {
      _state: { set: (s: unknown) => void };
    };
    internal._state.set({
      kind: 'connected',
      pubkey: '0x' + 'cc'.repeat(48),
      connection,
    });
  }

  /**
   * Install a Goby-flavoured mock that exposes ``selectedAddress`` as a
   * property + a stub ``request`` that records calls and either returns
   * a pre-set ``getPublicKeys`` reply OR throws "method unsupported".
   */
  function installGobyMock(args: {
    initialSelectedAddress?: string;
    selectedAddressAfterGetPublicKeys?: string;
    getPublicKeysFails?: boolean;
    rpcGetCurrentAddressReply?: string | object;
  }): { calls: MockedWalletCall[]; uninstall: () => void } {
    const calls: MockedWalletCall[] = [];
    const w = window as unknown as Record<string, unknown>;
    const previous = w['chia'];
    const mock: Record<string, unknown> = {
      isGoby: true,
      selectedAddress: args.initialSelectedAddress,
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        calls.push({ method, params });
        if (method === 'getPublicKeys') {
          if (args.getPublicKeysFails) {
            throw { code: 4001, message: 'User rejected' };
          }
          if (args.selectedAddressAfterGetPublicKeys !== undefined) {
            mock['selectedAddress'] = args.selectedAddressAfterGetPublicKeys;
          }
          return ['0x' + 'aa'.repeat(48)];
        }
        if (
          method === 'chia_getCurrentAddress' ||
          method === 'getCurrentAddress'
        ) {
          if (args.rpcGetCurrentAddressReply !== undefined) {
            return args.rpcGetCurrentAddressReply;
          }
          throw { code: 4004, message: "method doesn't have corresponding handler" };
        }
        throw { code: 4004, message: `unknown method: ${method}` };
      },
    };
    w['chia'] = mock;
    return {
      calls,
      uninstall: () => {
        if (previous === undefined) delete w['chia'];
        else w['chia'] = previous;
      },
    };
  }

  it('Goby: reads selectedAddress property when already populated (no RPC)', async () => {
    setConnected('goby');
    const mock = installGobyMock({
      initialSelectedAddress: 'txch1abc',
    });
    cleanup.push(mock.uninstall);

    const addr = await service.getCurrentAddress();

    expect(addr).toBe('txch1abc');
    expect(mock.calls.length)
      .withContext('Should NOT call request if selectedAddress is already set')
      .toBe(0);
  });

  it('Goby: primes selectedAddress via getPublicKeys when initially empty', async () => {
    setConnected('goby');
    const mock = installGobyMock({
      initialSelectedAddress: undefined,
      selectedAddressAfterGetPublicKeys: 'txch1xyz',
    });
    cleanup.push(mock.uninstall);

    const addr = await service.getCurrentAddress();

    expect(addr).toBe('txch1xyz');
    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0].method).toBe('getPublicKeys');
  });

  it('Goby: surfaces a clear error when getPublicKeys is rejected', async () => {
    setConnected('goby');
    const mock = installGobyMock({
      initialSelectedAddress: undefined,
      getPublicKeysFails: true,
    });
    cleanup.push(mock.uninstall);

    await expectAsync(service.getCurrentAddress()).toBeRejectedWithError(
      /getPublicKeys failed.*User rejected/,
    );
  });

  it('Goby: falls back to RPC when selectedAddress remains empty after getPublicKeys', async () => {
    setConnected('goby');
    const mock = installGobyMock({
      initialSelectedAddress: undefined,
      selectedAddressAfterGetPublicKeys: undefined, // RPC fallback path
      rpcGetCurrentAddressReply: 'txch1rpcfallback',
    });
    cleanup.push(mock.uninstall);

    const addr = await service.getCurrentAddress();

    expect(addr).toBe('txch1rpcfallback');
    const methods = mock.calls.map((c) => c.method);
    expect(methods).toContain('getPublicKeys');
    expect(methods.some((m) => m.includes('getCurrentAddress'))).toBe(true);
  });

  it('Sage: uses chia_getCurrentAddress RPC and accepts string reply', async () => {
    setConnected('sage');
    const mock = installMockWallet('sage', (method) => {
      if (method === 'chia_getCurrentAddress') return 'txch1sage';
      throw { code: 4004, message: 'unknown' };
    });
    cleanup.push(mock.uninstall);

    const addr = await service.getCurrentAddress();
    expect(addr).toBe('txch1sage');
    expect(mock.calls[0].method).toBe('chia_getCurrentAddress');
  });

  it('Sage: accepts {address: ...} object reply shape', async () => {
    setConnected('sage');
    const mock = installMockWallet('sage', (method) => {
      if (method === 'chia_getCurrentAddress') {
        return { address: 'txch1objshape' };
      }
      throw { code: 4004, message: 'unknown' };
    });
    cleanup.push(mock.uninstall);

    const addr = await service.getCurrentAddress();
    expect(addr).toBe('txch1objshape');
  });

  it('throws when not connected', async () => {
    await expectAsync(service.getCurrentAddress()).toBeRejectedWithError(
      /not connected/,
    );
  });

  it('rejects non-Chia bech32 HRPs (e.g. eth1, btc1)', async () => {
    setConnected('sage');
    const mock = installMockWallet('sage', () => 'eth1notchia');
    cleanup.push(mock.uninstall);

    await expectAsync(service.getCurrentAddress()).toBeRejectedWithError(
      /xch1\/txch1 bech32 address/,
    );
  });

  it('accepts mainnet xch1 prefix', async () => {
    setConnected('sage');
    const mock = installMockWallet('sage', () => 'xch1mainnet');
    cleanup.push(mock.uninstall);

    const addr = await service.getCurrentAddress();
    expect(addr).toBe('xch1mainnet');
  });

  it('accepts a 64-char hex puzzle hash (Goby selectedAddress format)', async () => {
    setConnected('goby');
    const mock = installGobyMock({
      initialSelectedAddress: 'ab'.repeat(32), // 64 hex chars, no prefix
    });
    cleanup.push(mock.uninstall);

    const addr = await service.getCurrentAddress();
    expect(addr).toBe('ab'.repeat(32));
  });

  it('accepts a 0x-prefixed hex puzzle hash via Sage RPC', async () => {
    setConnected('sage');
    const mock = installMockWallet('sage', () => '0x' + 'cd'.repeat(32));
    cleanup.push(mock.uninstall);

    const addr = await service.getCurrentAddress();
    expect(addr).toBe('0x' + 'cd'.repeat(32));
  });
});
