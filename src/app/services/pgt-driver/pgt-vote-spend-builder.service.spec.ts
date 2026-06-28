import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ChiaWasmService } from '../chia-wasm.service';
import {
  BuildPgtLockArgs,
  BuildTrackerVoteArgs,
  PgtVoteSpendBuilderService,
} from './pgt-vote-spend-builder.service';
import fixture from './pgt-vote-spend.fixtures.json';

describe('PgtVoteSpendBuilderService', () => {
  let service: PgtVoteSpendBuilderService;

  beforeAll(async () => {
    if ((window as unknown as { ChiaSDK?: unknown }).ChiaSDK) {
      return;
    }
    // @ts-ignore — deep-import; types come from chia_wallet_sdk_wasm.d.ts.
    const wasmExports = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
    const response = await fetch('/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm');
    if (!response.ok) {
      throw new Error(
        `WASM asset fetch failed: ${response.status} ${response.statusText}.`,
      );
    }
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, {
      './chia_wallet_sdk_wasm_bg.js': wasmExports as unknown as WebAssembly.ModuleImports,
    });
    const setWasm = (wasmExports as unknown as { __wbg_set_wasm?: (w: WebAssembly.Exports) => void }).__wbg_set_wasm;
    if (typeof setWasm !== 'function') {
      throw new Error('chia_wallet_sdk_wasm_bg.js missing __wbg_set_wasm');
    }
    setWasm(result.instance.exports);
    (window as unknown as { ChiaSDK: unknown }).ChiaSDK = wasmExports;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(ChiaWasmService).probeReady();
    service = TestBed.inject(PgtVoteSpendBuilderService);
  });

  // ──────────────────────────────────────────────────────────────────
  //  PGT lock CoinSpend
  // ──────────────────────────────────────────────────────────────────
  describe('buildPgtLockCoinSpend', () => {
    function lockArgs(): BuildPgtLockArgs {
      const inp = fixture.pgt_lock.inputs;
      return {
        pgtCoin: {
          parentCoinInfo: inp.pgt_coin.parentCoinInfo,
          puzzleHash: inp.pgt_coin.puzzleHash,
          amount: inp.pgt_coin.amount,
        },
        voterInnerPuzzleHex: inp.voter_inner_puzzle_hex,
        voterInnerSolutionHex: inp.voter_inner_solution_hex,
        trackerLauncherId: fixture.constants.tracker_launcher_id,
        pgtTailHash: fixture.constants.pgt_tail_hash,
        lineageProof: {
          parentName: inp.lineage_proof.parent_name ?? undefined,
          innerPuzzleHash: inp.lineage_proof.inner_puzzle_hash ?? undefined,
          amount:
            inp.lineage_proof.amount !== null
              ? inp.lineage_proof.amount
              : undefined,
        },
        proposalHash: inp.proposal_hash,
        deadlineSeconds: inp.deadline_seconds,
      };
    }

    it('produces a coin matching the Python fixture byte-for-byte', () => {
      const result = service.buildPgtLockCoinSpend(lockArgs());
      const expected = fixture.pgt_lock.expected;
      expect(result.coin.parentCoinInfo).toBe(expected.coin.parentCoinInfo);
      expect(result.coin.puzzleHash).toBe(expected.coin.puzzleHash);
      expect(Number(result.coin.amount)).toBe(expected.coin.amount);
    });

    it('produces the Python-canonical puzzle reveal hex', () => {
      const result = service.buildPgtLockCoinSpend(lockArgs());
      expect(result.puzzleReveal).toBe(fixture.pgt_lock.expected.puzzle_reveal_hex);
    });

    it('produces the Python-canonical solution hex', () => {
      const result = service.buildPgtLockCoinSpend(lockArgs());
      expect(result.solution).toBe(fixture.pgt_lock.expected.solution_hex);
    });

    it('rejects mismatched coin puzzle hash', () => {
      const args = lockArgs();
      args.pgtCoin.puzzleHash =
        '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(() => service.buildPgtLockCoinSpend(args)).toThrowError(
        /does not match coin's claimed puzzle hash/,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────
  //  Tracker VOTE CoinSpend
  // ──────────────────────────────────────────────────────────────────
  describe('buildTrackerVoteCoinSpend', () => {
    function voteArgs(): BuildTrackerVoteArgs {
      const inp = fixture.tracker_vote.inputs;
      return {
        trackerCoin: {
          parentCoinInfo: inp.tracker_coin.parentCoinInfo,
          puzzleHash: inp.tracker_coin.puzzleHash,
          amount: inp.tracker_coin.amount,
        },
        trackerInnerPuzzleHex: inp.tracker_inner_puzzle_hex,
        trackerLauncherId: inp.tracker_launcher_id,
        lineageProof: {
          parentName: inp.lineage_proof.parent_name,
          innerPuzzleHash: inp.lineage_proof.inner_puzzle_hash,
          amount: inp.lineage_proof.amount,
        },
        voterInnerPuzzleHash: inp.voter_inner_puzzle_hash,
        additionalVoteAmount: inp.additional_vote_amount,
      };
    }

    it('produces a coin matching the Python fixture byte-for-byte', () => {
      const result = service.buildTrackerVoteCoinSpend(voteArgs());
      const expected = fixture.tracker_vote.expected;
      expect(result.coin.parentCoinInfo).toBe(expected.coin.parentCoinInfo);
      expect(result.coin.puzzleHash).toBe(expected.coin.puzzleHash);
      expect(Number(result.coin.amount)).toBe(expected.coin.amount);
    });

    it('produces the Python-canonical puzzle reveal hex', () => {
      const result = service.buildTrackerVoteCoinSpend(voteArgs());
      expect(result.puzzleReveal).toBe(
        fixture.tracker_vote.expected.puzzle_reveal_hex,
      );
    });

    it('produces the Python-canonical solution hex', () => {
      const result = service.buildTrackerVoteCoinSpend(voteArgs());
      expect(result.solution).toBe(fixture.tracker_vote.expected.solution_hex);
    });

    it('rejects non-positive additionalVoteAmount', () => {
      const args = voteArgs();
      args.additionalVoteAmount = 0;
      expect(() => service.buildTrackerVoteCoinSpend(args)).toThrowError(
        /additionalVoteAmount must be > 0/,
      );
    });

    it('rejects non-32-byte voterInnerPuzzleHash', () => {
      const args = voteArgs();
      args.voterInnerPuzzleHash = '0x1234';
      expect(() => service.buildTrackerVoteCoinSpend(args)).toThrowError(
        /voterInnerPuzzleHash must be 32 bytes/,
      );
    });

    it('rejects mismatched coin puzzle hash', () => {
      const args = voteArgs();
      args.trackerCoin.puzzleHash =
        '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(() => service.buildTrackerVoteCoinSpend(args)).toThrowError(
        /does not match coin's claimed puzzle hash/,
      );
    });
  });
});
