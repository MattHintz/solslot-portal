import { TestBed } from '@angular/core/testing';

import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService, PuzzleAndSolution } from './coinset.service';
import { GovernanceTrackerReaderService } from './governance-tracker-reader.service';
import { GOVERNANCE_TRACKER_INNER_PUZZLE_HEX } from './pgt-driver/governance-singleton-inner.puzzle-hex';
import { environment } from '../../environments/environment';
import { bytesToHex, hexToBytes } from '../utils/chia-hash';

/**
 * Karma spec for {@link GovernanceTrackerReaderService.getIdleStateProposeInputs}
 * (Phase 4 sub-brick 4d.3a).
 *
 * Uses real `chia-wallet-sdk-wasm` (not the synthetic `FakeClvm` used by
 * the sibling spec) because the new method exercises
 * uncurry/curry/treeHash/serialize paths that the synthetic mock does
 * not implement.
 *
 * Test scenario: construct a 3-coin tracker lineage —
 * ``LAUNCHER → eve(IDLE→PROPOSE) → postEve(OPEN→EXECUTE) → current(IDLE, unspent)`` —
 * where `postEve` has a real singleton-wrapped OPEN-state inner puzzle
 * reveal that uncurries cleanly into 12 immutable + 4 OPEN state args.
 * The reader must reconstruct the current IDLE inner by re-currying the
 * same 12 immutable args with four nil state args, and the resulting
 * full puzzle hash must match the synthetic current coin's claimed
 * puzzle hash.
 */
describe('GovernanceTrackerReaderService.getIdleStateProposeInputs', () => {
  const SINGLETON_LAUNCHER_HASH =
    '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';
  const SINGLETON_MOD_HASH =
    '0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';

  const LAUNCHER_ID = environment.populisProtocol.governanceLauncherId;
  const EVE = '0x' + 'bb'.repeat(32);
  const POST_EVE = '0x' + 'cc'.repeat(32);
  const CURRENT = '0x' + 'dd'.repeat(32);
  const PROPERTY_ID_CANON = '0x' + '04'.repeat(32);
  const PROPERTY_REGISTRY_PH = '0x' + '05'.repeat(32);

  let service: GovernanceTrackerReaderService;
  let reader: jasmine.SpyObj<Pick<ChiaSingletonReaderService, 'walkLineage'>>;
  let coinset: jasmine.SpyObj<Pick<CoinsetService, 'getPuzzleAndSolution'>>;

  beforeAll(async () => {
    if ((window as unknown as { ChiaSDK?: unknown }).ChiaSDK) {
      return;
    }
    // @ts-ignore deep-import; types come from chia_wallet_sdk_wasm.d.ts.
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
    reader = jasmine.createSpyObj('ChiaSingletonReaderService', ['walkLineage']);
    coinset = jasmine.createSpyObj('CoinsetService', ['getPuzzleAndSolution']);

    TestBed.configureTestingModule({
      providers: [
        GovernanceTrackerReaderService,
        { provide: ChiaSingletonReaderService, useValue: reader },
        { provide: CoinsetService, useValue: coinset },
      ],
    });
    TestBed.inject(ChiaWasmService).probeReady();
    service = TestBed.inject(GovernanceTrackerReaderService);
  });

  // ── Null-path: non-IDLE snapshots return null ─────────────────────────

  it('returns null when the launcher is not on chain (NOT_DEPLOYED)', async () => {
    reader.walkLineage.and.resolveTo(null);
    const result = await service.getIdleStateProposeInputs();
    expect(result).toBeNull();
  });

  it('returns null when the launcher has not been spent (NOT_SPENT)', async () => {
    // Lineage with only the launcher and no non-launcher coins → NOT_SPENT.
    reader.walkLineage.and.resolveTo(buildLineageRaw([]));
    const result = await service.getIdleStateProposeInputs();
    expect(result).toBeNull();
  });

  // ── Happy path: post-EXECUTE IDLE state with full lineage ─────────────

  it(
    'reconstructs the IDLE-state tracker inner from the last (OPEN-state) reveal ' +
      'and returns matching lineage + inner hex',
    async () => {
      const sdk = chiaSdk();
      const clvm = new sdk.Clvm();

      // ── 1. Build the 12 immutable curried args (placeholder bytes) ──
      // Any stable values work; the test only verifies the reader
      // preserves them when substituting the trailing 4 state args.
      const immutable = buildImmutableArgs(clvm);

      // ── 2. Build the OPEN-state inner (last 4 args = OPEN state) ──
      const openStateArgs = [
        clvm.atom(hexToBytes('0x' + '01'.repeat(32))), // proposal_hash
        clvm.list([
          clvm.atom(new Uint8Array([0x4d])), // BILL_MINT
          clvm.atom(hexToBytes('0x' + '02'.repeat(32))), // deed_full_ph
          clvm.atom(hexToBytes(PROPERTY_ID_CANON)),
          clvm.atom(hexToBytes(PROPERTY_REGISTRY_PH)),
        ]),
        clvm.int(123_456n), // vote_tally
        clvm.int(1_000_000n), // voting_deadline
      ];
      const trackerMod = clvm.deserialize(
        hexToBytes(GOVERNANCE_TRACKER_INNER_PUZZLE_HEX),
      );
      const openInner = trackerMod.curry([...immutable, ...openStateArgs]);

      // ── 3. Build the IDLE-state inner (last 4 args = nil) ──
      const idleStateArgs = [clvm.nil(), clvm.nil(), clvm.nil(), clvm.nil()];
      const idleInner = trackerMod.curry([...immutable, ...idleStateArgs]);

      // ── 4. Wrap both in the singleton top layer ──
      const singletonStruct = clvm.pair(
        clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
        clvm.pair(
          clvm.atom(hexToBytes(LAUNCHER_ID)),
          clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH)),
        ),
      );
      const topLayerBytes =
        sdk.Constants?.singletonTopLayerV11?.() ??
        sdk.Constants?.singletonTopLayer?.();
      if (!topLayerBytes) {
        throw new Error('singletonTopLayer bytes unavailable');
      }
      const topLayer = clvm.deserialize(topLayerBytes);
      const openFullPuzzle = topLayer.curry([singletonStruct, openInner]);
      const idleFullPuzzle = topLayer.curry([singletonStruct, idleInner]);
      const idleFullPuzzleHash = bytesToHex(idleFullPuzzle.treeHash());

      const openFullPuzzleHex = bytesToHex(openFullPuzzle.serialize());

      // ── 5. Build a real PROPOSE solution for eve and EXECUTE for postEve ──
      const proposeSolution = clvm.list([
        clvm.nil(), // lineage_proof
        clvm.int(1n), // my_amount
        clvm.list([
          clvm.atom(hexToBytes(EVE)),
          clvm.atom(hexToBytes('0x' + '00'.repeat(32))),
          clvm.int(1n),
          clvm.int(BigInt(GovernanceTrackerReaderService.TRK_PROPOSE)),
          clvm.list([
            clvm.atom(hexToBytes('0x' + '01'.repeat(32))), // proposal_hash
            clvm.list([
              clvm.atom(new Uint8Array([0x4d])),
              clvm.atom(hexToBytes('0x' + '02'.repeat(32))),
              clvm.atom(hexToBytes(PROPERTY_ID_CANON)),
              clvm.atom(hexToBytes(PROPERTY_REGISTRY_PH)),
            ]),
            clvm.atom(hexToBytes('0x' + '03'.repeat(32))), // voter_inner_ph
            clvm.int(100_000n), // first_vote
            clvm.int(1_000_000n), // deadline
          ]),
        ]),
      ]);
      const executeSolution = clvm.list([
        clvm.nil(),
        clvm.int(1n),
        clvm.list([
          clvm.atom(hexToBytes(POST_EVE)),
          clvm.atom(hexToBytes('0x' + '00'.repeat(32))),
          clvm.int(1n),
          clvm.int(BigInt(GovernanceTrackerReaderService.TRK_EXECUTE)),
          clvm.nil(),
        ]),
      ]);

      const proposeSolutionHex = bytesToHex(proposeSolution.serialize());
      const executeSolutionHex = bytesToHex(executeSolution.serialize());

      // ── 6. Stub the lineage walk + per-spend puzzle/solution returns ──
      reader.walkLineage.and.resolveTo(
        buildLineageRaw([
          { coinId: EVE, parentCoinId: LAUNCHER_ID, puzzleHash: '0x' + '00'.repeat(32), amount: 1, spentBlockIndex: 5 },
          { coinId: POST_EVE, parentCoinId: EVE, puzzleHash: '0x' + '00'.repeat(32), amount: 1, spentBlockIndex: 7 },
          { coinId: CURRENT, parentCoinId: POST_EVE, puzzleHash: idleFullPuzzleHash, amount: 1, spentBlockIndex: null },
        ]),
      );
      coinset.getPuzzleAndSolution.withArgs(EVE, 5).and.resolveTo({
        coin: { parent_coin_info: LAUNCHER_ID, puzzle_hash: '0x' + '00'.repeat(32), amount: 1 },
        puzzleReveal: '0x80', // unused by readCurrentState's PROPOSE path
        solution: proposeSolutionHex,
      } satisfies PuzzleAndSolution);
      coinset.getPuzzleAndSolution.withArgs(POST_EVE, 7).and.resolveTo({
        coin: { parent_coin_info: EVE, puzzle_hash: '0x' + '00'.repeat(32), amount: 1 },
        puzzleReveal: openFullPuzzleHex,
        solution: executeSolutionHex,
      } satisfies PuzzleAndSolution);

      // ── 7. Call the method ──
      const result = await service.getIdleStateProposeInputs();
      if (!result) {
        fail('Expected IDLE inputs, got null');
        return;
      }

      // ── 8. Verify outputs ──
      expect(result.trackerCoin.parentCoinInfo).toBe(POST_EVE);
      expect(result.trackerCoin.puzzleHash).toBe(idleFullPuzzleHash);
      expect(result.trackerCoin.amount).toBe(1);
      expect(result.trackerLauncherId).toBe(LAUNCHER_ID);
      expect(result.lineageProof.parentName).toBe(EVE);
      expect(result.lineageProof.amount).toBe(1);
      expect(result.lineageProof.innerPuzzleHash).toBe(
        bytesToHex(openInner.treeHash()),
      );

      // The reconstructed IDLE inner hex MUST equal what we serialised
      // directly — i.e. the reader recovered the 12 immutable args
      // byte-for-byte and substituted nil for the 4 state args.
      const reconstructedHex = result.trackerInnerPuzzleHex;
      expect(reconstructedHex).toBe(bytesToHex(idleInner.serialize()));
    },
  );

  it(
    'throws on fresh-launch IDLE (eve unspent, no prior non-launcher spend)',
    async () => {
      // Lineage with the launcher spent and the eve unspent — the
      // state machine applies zero transitions, so the snapshot is
      // IDLE with spendCount=0.  getIdleStateProposeInputs then has
      // an IDLE snapshot but no `lastSpent` non-launcher coin to
      // uncurry, so it throws the documented fresh-launch error.
      reader.walkLineage.and.resolveTo(
        buildLineageRaw([
          {
            coinId: EVE,
            parentCoinId: LAUNCHER_ID,
            puzzleHash: '0x' + '00'.repeat(32),
            amount: 1,
            spentBlockIndex: null,
          },
        ]),
      );
      await expectAsync(
        service.getIdleStateProposeInputs(),
      ).toBeRejectedWithError(/fresh-launch IDLE/);
    },
  );

  // ─── Helpers ────────────────────────────────────────────────────────────

  function chiaSdk(): {
    Clvm: new () => RealClvm;
    Constants?: {
      singletonTopLayerV11?: () => Uint8Array;
      singletonTopLayer?: () => Uint8Array;
    };
  } {
    return TestBed.inject(ChiaWasmService).sdk() as ReturnType<
      typeof chiaSdk
    >;
  }

  function buildImmutableArgs(clvm: RealClvm): RealProgram[] {
    // 12 stable placeholders.  Mix of atom and pair shapes mimics the
    // real tracker curry (which has bytes32 args and a nested
    // pool_singleton_struct pair); the exact bytes don't matter for
    // this test, only that they round-trip through serialize+curry.
    return [
      clvm.atom(hexToBytes(GOVERNANCE_TRACKER_INNER_PUZZLE_HEX_HASH_PLACEHOLDER)),
      clvm.pair(
        clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
        clvm.pair(
          clvm.atom(hexToBytes(LAUNCHER_ID)),
          clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH)),
        ),
      ),
      clvm.atom(hexToBytes('0x' + '10'.repeat(32))), // pgt_free_mod_hash
      clvm.atom(hexToBytes('0x' + '11'.repeat(32))), // pgt_locked_mod_hash
      clvm.atom(hexToBytes('0x' + '12'.repeat(32))), // cat_mod_hash
      clvm.atom(hexToBytes('0x' + '13'.repeat(32))), // pgt_tail_hash
      clvm.atom(hexToBytes('0x' + '14'.repeat(32))), // protocol_did_puzhash
      clvm.pair(
        clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
        clvm.pair(
          clvm.atom(hexToBytes('0x' + '15'.repeat(32))),
          clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH)),
        ),
      ), // pool_singleton_struct
      clvm.int(1000n), // quorum_bps
      clvm.int(86400n), // voting_window_seconds
      clvm.int(1_000_000n), // pgt_total_supply
      clvm.int(10_000n), // min_proposal_stake
    ];
  }

  function buildLineageRaw(
    nodes: Array<{
      coinId: string;
      parentCoinId: string;
      puzzleHash: string;
      amount: number;
      spentBlockIndex: number | null;
    }>,
  ): SingletonLineage {
    return {
      launcherId: LAUNCHER_ID,
      launcherCoinId: LAUNCHER_ID,
      launcher: {
        coin: {
          parent_coin_info: '0x' + '00'.repeat(32),
          puzzle_hash: '0x' + '00'.repeat(32),
          amount: 1,
        },
        coinbase: false,
        confirmed_block_index: 1,
        spent_block_index: 2,
        timestamp: 0,
      },
      nodes: [
        {
          coinId: LAUNCHER_ID,
          parentCoinId: '0x' + '00'.repeat(32),
          puzzleHash: '0x' + '00'.repeat(32),
          amount: 1,
          confirmedBlockIndex: 1,
          spentBlockIndex: 2,
          isLauncher: true,
        },
        ...nodes.map((n, idx) => ({
          coinId: n.coinId,
          parentCoinId: n.parentCoinId,
          puzzleHash: n.puzzleHash,
          amount: n.amount,
          confirmedBlockIndex: 3 + idx,
          spentBlockIndex: n.spentBlockIndex,
          isLauncher: false,
        })),
      ],
    };
  }

  // Placeholder for mod_hash curry arg.  Real value is the tracker
  // MOD's own tree hash; for THIS test any stable 32 bytes work because
  // we only verify the reader preserves it across the round-trip.
  const GOVERNANCE_TRACKER_INNER_PUZZLE_HEX_HASH_PLACEHOLDER =
    '0x52ab762f043036c3c35cb3f3ee952a44292c06d8e903aa6f0b20b125521fe810';
});

// ── Narrow WASM typing ─────────────────────────────────────────────────
interface RealProgram {
  serialize(): Uint8Array;
  treeHash(): Uint8Array;
  curry(args: RealProgram[]): RealProgram;
}
interface RealClvm {
  deserialize(bytes: Uint8Array): RealProgram;
  atom(value: Uint8Array): RealProgram;
  int(value: bigint): RealProgram;
  list(value: RealProgram[]): RealProgram;
  pair(first: RealProgram, rest: RealProgram): RealProgram;
  nil(): RealProgram;
}
