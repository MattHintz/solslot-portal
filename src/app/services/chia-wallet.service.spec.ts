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
    TestBed.configureTestingModule({});
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

  it('accepts a string-only signature (older wallet formats)', async () => {
    setConnectedState('goby');
    const mock = installMockWallet('chia', () => SAMPLE_SIG);
    cleanup.push(mock.uninstall);

    const result = await service.signSpendBundle(SAMPLE_COIN_SPENDS);
    expect(result.aggregatedSignature).toBe(SAMPLE_SIG);
    expect(result.coinSpends).toEqual([]);
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

  // ───────────────────────────────────────────────────────────────────
  // Wire format
  // ───────────────────────────────────────────────────────────────────

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
