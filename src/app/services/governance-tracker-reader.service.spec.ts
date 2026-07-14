import { TestBed } from '@angular/core/testing';

import {
  ClvmNode,
  DecodedBill,
  GovernanceTrackerReaderService,
  TrackerStateSnapshot,
} from './governance-tracker-reader.service';
import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService, PuzzleAndSolution } from './coinset.service';
import { environment } from '../../environments/environment';

// ─── Synthetic CLVM helpers ─────────────────────────────────────────────
// We build a fake Program tree from plain JS values so the service's
// decoder can be exercised without touching the real WASM SDK.  The
// shape mirrors what chia-wallet-sdk-wasm exposes:
//   .first() / .rest()   → walk pairs
//   .toAtom() / .toInt() → terminal accessors

type Sym = { __atom?: Uint8Array; __int?: bigint; __list?: Sym[]; __nil?: true };

function atom(bytes: Uint8Array): Sym {
  return { __atom: bytes };
}
function int(value: bigint | number): Sym {
  return { __int: typeof value === 'bigint' ? value : BigInt(value) };
}
function nil(): Sym {
  return { __nil: true };
}
function list(items: Sym[]): Sym {
  return { __list: items };
}

function symToNode(s: Sym): ClvmNode {
  if (s.__list) {
    return listNode(s.__list);
  }
  if (s.__nil) {
    return atomNode(new Uint8Array());
  }
  if (s.__atom) {
    return atomNode(s.__atom);
  }
  if (typeof s.__int === 'bigint') {
    return intNode(s.__int);
  }
  throw new Error('symToNode: unknown sym');
}

function atomNode(bytes: Uint8Array): ClvmNode {
  return {
    first(): ClvmNode {
      throw new Error('first() on atom');
    },
    rest(): ClvmNode {
      throw new Error('rest() on atom');
    },
    toAtom(): Uint8Array {
      return bytes;
    },
    toInt(): bigint {
      // Big-endian, signed, like CLVM.  Tests only feed positive ints
      // sized to one byte (spend_case) so simple decode is fine.
      if (bytes.length === 0) return 0n;
      let n = 0n;
      for (const b of bytes) n = (n << 8n) | BigInt(b);
      return n;
    },
    treeHash: notImplementedClvm,
    serialize: notImplementedClvm,
    curry: notImplementedClvm,
    uncurry: notImplementedClvm,
  };
}

function intNode(value: bigint): ClvmNode {
  const bytes = (() => {
    if (value === 0n) return new Uint8Array();
    const out: number[] = [];
    let v = value;
    while (v > 0n) {
      out.push(Number(v & 0xffn));
      v >>= 8n;
    }
    return Uint8Array.from(out.reverse());
  })();
  return {
    first(): ClvmNode {
      throw new Error('first() on int');
    },
    rest(): ClvmNode {
      throw new Error('rest() on int');
    },
    toAtom(): Uint8Array {
      return bytes;
    },
    toInt(): bigint {
      return value;
    },
    treeHash: notImplementedClvm,
    serialize: notImplementedClvm,
    curry: notImplementedClvm,
    uncurry: notImplementedClvm,
  };
}

function listNode(items: Sym[]): ClvmNode {
  // CLVM lists are right-nested pairs terminated by nil.
  // (a b c) == (a . (b . (c . ())))
  const tail = items.slice(1);
  return {
    first(): ClvmNode {
      if (items.length === 0) throw new Error('first() on nil');
      return symToNode(items[0]);
    },
    rest(): ClvmNode {
      if (items.length === 0) throw new Error('rest() on nil');
      return listNode(tail);
    },
    toAtom(): Uint8Array | null {
      // A non-empty pair has no atom representation.  Return null so the
      // service treats absent atoms safely.
      return items.length === 0 ? new Uint8Array() : null;
    },
    toInt(): bigint {
      throw new Error('toInt() on pair');
    },
    treeHash: notImplementedClvm,
    serialize: notImplementedClvm,
    curry: notImplementedClvm,
    uncurry: notImplementedClvm,
  };
}

function notImplementedClvm(): never {
  throw new Error(
    'ClvmNode method not implemented in this synthetic test fixture — ' +
      'only first/rest/toAtom/toInt are mocked because the existing tests ' +
      'exercise solution decoding, not curry/treeHash paths.',
  );
}

// ─── Test fixtures ──────────────────────────────────────────────────────

const LAUNCHER = '0x' + 'aa'.repeat(32);
const EVE = '0x' + 'bb'.repeat(32);
const POST_PROPOSE = '0x' + 'cc'.repeat(32);
const POST_VOTE = '0x' + 'dd'.repeat(32);
const POST_EXECUTE = '0x' + 'ee'.repeat(32);

const PROPOSAL_HASH = '0x' + '01'.repeat(32);
const DEED_PH = '0x' + '02'.repeat(32);
const VOTER_PH = '0x' + '03'.repeat(32);
const PROPERTY_ID_CANON = '0x' + '04'.repeat(32);
const PROPERTY_REGISTRY_PH = '0x' + '05'.repeat(32);

const VOTING_DEADLINE_SECONDS = 1_000_000n;
const FIRST_VOTE_AMOUNT = 100_000n;
const ADDITIONAL_VOTE_AMOUNT = 450_000n;

function bytes(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Uint8Array.from(
    { length: stripped.length / 2 },
    (_, i) => parseInt(stripped.slice(i * 2, i * 2 + 2), 16),
  );
}

/**
 * Build the synthetic CLVM tree for a singleton-wrapped tracker
 * solution.  The on-chain shape is:
 *
 *   (lineage_proof  my_amount  inner_solution)
 *   inner_solution = (my_id  my_inner_ph  my_amount  spend_case  params)
 */
function singletonSolution(spendCase: number, params: Sym): Sym {
  return list([
    nil(), // lineage_proof (irrelevant for decoder)
    int(1), // my_amount (outer)
    list([
      atom(bytes(EVE)), // my_id
      atom(bytes(LAUNCHER)), // my_inner_puzzlehash
      int(1), // my_amount (inner)
      int(spendCase),
      params,
    ]),
  ]);
}

function buildLineage(spent: Array<{ coinId: string; spentBlockIndex: number | null }>): SingletonLineage {
  return {
    launcherId: LAUNCHER,
    launcherCoinId: LAUNCHER,
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
        coinId: LAUNCHER,
        parentCoinId: '0x' + '00'.repeat(32),
        puzzleHash: '0x' + '00'.repeat(32),
        amount: 1,
        confirmedBlockIndex: 1,
        spentBlockIndex: 2,
        isLauncher: true,
      },
      ...spent.map((s, idx) => ({
        coinId: s.coinId,
        parentCoinId: idx === 0 ? LAUNCHER : spent[idx - 1].coinId,
        puzzleHash: '0x' + '00'.repeat(32),
        amount: 1,
        confirmedBlockIndex: 3 + idx,
        spentBlockIndex: s.spentBlockIndex,
        isLauncher: false,
      })),
    ],
  };
}

describe('GovernanceTrackerReaderService', () => {
  let service: GovernanceTrackerReaderService;
  let reader: jasmine.SpyObj<Pick<ChiaSingletonReaderService, 'walkLineage'>>;
  let coinset: jasmine.SpyObj<Pick<CoinsetService, 'getPuzzleAndSolution'>>;
  let wasm: jasmine.SpyObj<Pick<ChiaWasmService, 'ready' | 'sdk'>>;

  /** Map from solution hex → synthetic CLVM tree.  Tests register the
   *  trees they want the service to "deserialize" so we don't need to
   *  produce real CLVM bytes. */
  let solutionTrees: Map<string, Sym>;
  const originalGovernanceLauncherId = environment.solslotProtocol.governanceLauncherId;

  beforeEach(() => {
    environment.solslotProtocol.governanceLauncherId = LAUNCHER;
    reader = jasmine.createSpyObj('ChiaSingletonReaderService', ['walkLineage']);
    coinset = jasmine.createSpyObj('CoinsetService', ['getPuzzleAndSolution']);
    wasm = jasmine.createSpyObj('ChiaWasmService', ['ready', 'sdk']);
    wasm.ready.and.returnValue(true);
    solutionTrees = new Map();

    class FakeClvm {
      deserialize(b: Uint8Array): ClvmNode {
        const hex =
          '0x' +
          Array.from(b)
            .map((x) => x.toString(16).padStart(2, '0'))
            .join('');
        const tree = solutionTrees.get(hex);
        if (!tree) {
          throw new Error(`No fake tree registered for solution ${hex}`);
        }
        return symToNode(tree);
      }
    }
    wasm.sdk.and.returnValue({ Clvm: FakeClvm });

    TestBed.configureTestingModule({
      providers: [
        GovernanceTrackerReaderService,
        { provide: ChiaSingletonReaderService, useValue: reader },
        { provide: CoinsetService, useValue: coinset },
        { provide: ChiaWasmService, useValue: wasm },
      ],
    });
    service = TestBed.inject(GovernanceTrackerReaderService);
  });

  afterEach(() => {
    environment.solslotProtocol.governanceLauncherId = originalGovernanceLauncherId;
  });

  function registerSolution(coinId: string, blockIndex: number, hex: string, tree: Sym): void {
    solutionTrees.set(hex, tree);
    coinset.getPuzzleAndSolution
      .withArgs(coinId, blockIndex)
      .and.resolveTo({
        coin: {
          parent_coin_info: '0x' + '00'.repeat(32),
          puzzle_hash: '0x' + '00'.repeat(32),
          amount: 1,
        },
        puzzleReveal: '0x80',
        solution: hex,
      } satisfies PuzzleAndSolution);
  }

  // ── NOT_DEPLOYED / NOT_SPENT branches ───────────────────────────────

  it('returns NOT_DEPLOYED when the launcher record is missing from chain', async () => {
    reader.walkLineage.and.resolveTo(null);
    const snap = await service.readCurrentState();
    expect(snap.kind).toBe('NOT_DEPLOYED');
    if (snap.kind === 'NOT_DEPLOYED') {
      expect(snap.reason).toBe('launcher-not-on-chain');
    }
  });

  it('returns NOT_SPENT when the launcher exists but the eve has not yet been created', async () => {
    reader.walkLineage.and.resolveTo(buildLineage([]));
    const snap = await service.readCurrentState();
    expect(snap.kind).toBe('NOT_SPENT');
    if (snap.kind === 'NOT_SPENT') {
      expect(snap.launcherId).toBe(LAUNCHER);
    }
  });

  // ── IDLE: eve coin unspent ─────────────────────────────────────────

  it('returns IDLE when the eve coin is present and unspent', async () => {
    reader.walkLineage.and.resolveTo(
      buildLineage([{ coinId: EVE, spentBlockIndex: null }]),
    );
    const snap = await service.readCurrentState();
    expect(snap.kind).toBe('IDLE');
    if (snap.kind === 'IDLE') {
      expect(snap.spendCount).toBe(0);
      // Quorum: 5000 bps × 1_000_000 / 10000 = 500_000.
      expect(snap.quorumRequired).toBe(500_000n);
    }
  });

  // ── OPEN: eve spent with PROPOSE, child unspent ────────────────────

  it('decodes a PROPOSE MINT bill into an OPEN snapshot before the deadline', async () => {
    // Eve was spent with a TRK_PROPOSE for a MINT bill; the child is unspent.
    const tree = singletonSolution(
      GovernanceTrackerReaderService.TRK_PROPOSE,
      list([
        atom(bytes(PROPOSAL_HASH)),
        list([
          atom(Uint8Array.from([GovernanceTrackerReaderService.BILL_MINT])),
          atom(bytes(DEED_PH)),
          atom(bytes(PROPERTY_ID_CANON)),
          atom(bytes(PROPERTY_REGISTRY_PH)),
        ]),
        atom(bytes(VOTER_PH)),
        int(FIRST_VOTE_AMOUNT),
        int(VOTING_DEADLINE_SECONDS),
      ]),
    );
    registerSolution(EVE, 5, '0xdead01', tree);
    reader.walkLineage.and.resolveTo(
      buildLineage([
        { coinId: EVE, spentBlockIndex: 5 },
        { coinId: POST_PROPOSE, spentBlockIndex: null },
      ]),
    );

    // Pretend "now" is before the deadline.
    const snap = await service.readCurrentState(Number(VOTING_DEADLINE_SECONDS) - 60);
    expectOpen(snap, {
      kind: 'OPEN',
      voteTally: FIRST_VOTE_AMOUNT,
      bill: {
        kind: 'MINT',
        deedFullPuzzleHash: DEED_PH,
        propertyIdCanon: PROPERTY_ID_CANON,
        propertyRegistryPuzzleHash: PROPERTY_REGISTRY_PH,
      },
    });
  });

  // ── AWAITING_EXECUTE: deadline passed, quorum met ─────────────────

  it('buckets as AWAITING_EXECUTE when deadline has passed and quorum met', async () => {
    const propose = singletonSolution(
      GovernanceTrackerReaderService.TRK_PROPOSE,
      list([
        atom(bytes(PROPOSAL_HASH)),
        list([
          atom(Uint8Array.from([GovernanceTrackerReaderService.BILL_FREEZE])),
          int(0),
        ]),
        atom(bytes(VOTER_PH)),
        int(FIRST_VOTE_AMOUNT),
        int(VOTING_DEADLINE_SECONDS),
      ]),
    );
    const vote = singletonSolution(
      GovernanceTrackerReaderService.TRK_VOTE,
      list([atom(bytes(VOTER_PH)), int(ADDITIONAL_VOTE_AMOUNT)]),
    );
    registerSolution(EVE, 5, '0xdead02', propose);
    registerSolution(POST_PROPOSE, 6, '0xdead03', vote);
    reader.walkLineage.and.resolveTo(
      buildLineage([
        { coinId: EVE, spentBlockIndex: 5 },
        { coinId: POST_PROPOSE, spentBlockIndex: 6 },
        { coinId: POST_VOTE, spentBlockIndex: null },
      ]),
    );

    const snap = await service.readCurrentState(Number(VOTING_DEADLINE_SECONDS) + 60);
    expectOpen(snap, {
      kind: 'AWAITING_EXECUTE',
      voteTally: FIRST_VOTE_AMOUNT + ADDITIONAL_VOTE_AMOUNT,
      bill: { kind: 'FREEZE', newPoolStatus: 0 },
    });
  });

  // ── AWAITING_EXPIRE: deadline passed, no quorum ───────────────────

  it('buckets as AWAITING_EXPIRE when deadline has passed but quorum is unmet', async () => {
    const propose = singletonSolution(
      GovernanceTrackerReaderService.TRK_PROPOSE,
      list([
        atom(bytes(PROPOSAL_HASH)),
        list([
          atom(Uint8Array.from([GovernanceTrackerReaderService.BILL_FREEZE])),
          int(1),
        ]),
        atom(bytes(VOTER_PH)),
        // Tally far below the 500_000 quorum.
        int(50_000n),
        int(VOTING_DEADLINE_SECONDS),
      ]),
    );
    registerSolution(EVE, 5, '0xdead04', propose);
    reader.walkLineage.and.resolveTo(
      buildLineage([
        { coinId: EVE, spentBlockIndex: 5 },
        { coinId: POST_PROPOSE, spentBlockIndex: null },
      ]),
    );

    const snap = await service.readCurrentState(Number(VOTING_DEADLINE_SECONDS) + 60);
    expectOpen(snap, {
      kind: 'AWAITING_EXPIRE',
      voteTally: 50_000n,
      bill: { kind: 'FREEZE', newPoolStatus: 1 },
    });
  });

  // ── IDLE after EXECUTE ─────────────────────────────────────────────

  it('returns IDLE after an EXECUTE spend resets the tracker', async () => {
    const propose = singletonSolution(
      GovernanceTrackerReaderService.TRK_PROPOSE,
      list([
        atom(bytes(PROPOSAL_HASH)),
        list([
          atom(Uint8Array.from([GovernanceTrackerReaderService.BILL_MINT])),
          atom(bytes(DEED_PH)),
          atom(bytes(PROPERTY_ID_CANON)),
          atom(bytes(PROPERTY_REGISTRY_PH)),
        ]),
        atom(bytes(VOTER_PH)),
        int(FIRST_VOTE_AMOUNT),
        int(VOTING_DEADLINE_SECONDS),
      ]),
    );
    const exec = singletonSolution(GovernanceTrackerReaderService.TRK_EXECUTE, nil());
    registerSolution(EVE, 5, '0xdead05', propose);
    registerSolution(POST_PROPOSE, 7, '0xdead06', exec);
    reader.walkLineage.and.resolveTo(
      buildLineage([
        { coinId: EVE, spentBlockIndex: 5 },
        { coinId: POST_PROPOSE, spentBlockIndex: 7 },
        { coinId: POST_EXECUTE, spentBlockIndex: null },
      ]),
    );

    const snap = await service.readCurrentState();
    expect(snap.kind).toBe('IDLE');
    if (snap.kind === 'IDLE') {
      expect(snap.spendCount).toBe(2);
    }
  });

  // ── Bill decoders: SETTLE + VAULT_VERSION + UNKNOWN ────────────────

  it('decodes a SETTLE bill', () => {
    const billOp = list([
      atom(Uint8Array.from([GovernanceTrackerReaderService.BILL_SETTLE])),
      atom(bytes('0x' + '0a'.repeat(32))),
      int(1_234_567n),
      int(42n),
      atom(bytes('0x' + '0d'.repeat(32))),
    ]);
    const bill = service.decodeBill(symToNode(billOp));
    expect(bill.kind).toBe('SETTLE');
    if (bill.kind === 'SETTLE') {
      expect(bill.splitxchRoot).toBe('0x' + '0a'.repeat(32));
      expect(bill.totalAmount).toBe(1_234_567n);
      expect(bill.numDeeds).toBe(42n);
      expect(bill.deedReleasesHash).toBe('0x' + '0d'.repeat(32));
    }
  });

  it('decodes a VAULT_VERSION bill', () => {
    const billOp = list([
      atom(Uint8Array.from([GovernanceTrackerReaderService.BILL_VAULT_VERSION])),
      atom(bytes('0x' + '0b'.repeat(32))),
      atom(bytes('0x' + '0c'.repeat(32))),
      int(2n),
    ]);
    const bill = service.decodeBill(symToNode(billOp));
    expect(bill.kind).toBe('VAULT_VERSION');
    if (bill.kind === 'VAULT_VERSION') {
      expect(bill.newVaultInnerModHash).toBe('0x' + '0b'.repeat(32));
      expect(bill.newCanonicalParamsHash).toBe('0x' + '0c'.repeat(32));
      expect(bill.newVaultVersion).toBe(2n);
    }
  });

  it('decodes an unknown bill tag without throwing', () => {
    const billOp = list([atom(Uint8Array.from([0x5a /* 'Z' */])), nil()]);
    const bill = service.decodeBill(symToNode(billOp));
    expect(bill.kind).toBe('UNKNOWN');
    if (bill.kind === 'UNKNOWN') {
      expect(bill.tagHex).toBe('0x5a');
    }
  });

  // ── Defensive: missing on-chain spend record ───────────────────────

  it('throws if a spent coin has no puzzle/solution available on chain', async () => {
    reader.walkLineage.and.resolveTo(
      buildLineage([{ coinId: EVE, spentBlockIndex: 5 }]),
    );
    coinset.getPuzzleAndSolution.and.resolveTo(null);
    await expectAsync(service.readCurrentState()).toBeRejectedWithError(
      /missing puzzle\/solution/,
    );
  });

  // ─── Helpers ─────────────────────────────────────────────────────────

  function expectOpen(
    snap: TrackerStateSnapshot,
    expected: {
      kind: 'OPEN' | 'AWAITING_EXECUTE' | 'AWAITING_EXPIRE';
      voteTally: bigint;
      bill: DecodedBill;
    },
  ): void {
    expect(snap.kind).toBe(expected.kind);
    if (snap.kind !== 'OPEN' && snap.kind !== 'AWAITING_EXECUTE' && snap.kind !== 'AWAITING_EXPIRE') {
      fail(`expected open-bucket snapshot, got ${snap.kind}`);
      return;
    }
    expect(snap.voteTally).toBe(expected.voteTally);
    expect(snap.bill.kind).toBe(expected.bill.kind);
    if (expected.bill.kind === 'MINT' && snap.bill.kind === 'MINT') {
      expect(snap.bill.deedFullPuzzleHash).toBe(expected.bill.deedFullPuzzleHash);
      expect(snap.bill.propertyIdCanon).toBe(expected.bill.propertyIdCanon);
      expect(snap.bill.propertyRegistryPuzzleHash).toBe(
        expected.bill.propertyRegistryPuzzleHash,
      );
    }
    if (expected.bill.kind === 'FREEZE' && snap.bill.kind === 'FREEZE') {
      expect(snap.bill.newPoolStatus).toBe(expected.bill.newPoolStatus);
    }
    expect(snap.proposalHash).toBe(PROPOSAL_HASH);
    expect(snap.votingDeadlineSeconds).toBe(VOTING_DEADLINE_SECONDS);
    expect(snap.quorumRequired).toBe(
      (BigInt(environment.solslotProtocol.governanceQuorumBps) *
        BigInt(environment.solslotProtocol.governanceSgtTotalSupply)) /
        10000n,
    );
  }
});
