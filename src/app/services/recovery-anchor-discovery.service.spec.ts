import { TestBed } from '@angular/core/testing';
import { sha256 } from 'ethers';

import { ChiaWasmService } from './chia-wasm.service';
import { CoinRecord, CoinsetService, PuzzleAndSolution } from './coinset.service';
import {
  RECOVERY_ANCHOR_TAG,
  RecoveryAnchorDiscoveryService,
} from './recovery-anchor-discovery.service';
import { bytesToHex, coinId, hexToBytes } from '../utils/chia-hash';

const TAG_MEMO_HEX = bytesToHex(new TextEncoder().encode(RECOVERY_ANCHOR_TAG));
const MARKER_PH = '0x' + 'ef'.repeat(32);
const PARENT_COIN_ID = '0x' + '12'.repeat(32);
const PAYLOAD_MEMO_UTF8 =
  '{"admin_authority_v2_launcher_id":"0x' +
  '88'.repeat(32) +
  '","admin_records_hash":"sha256:' +
  '11'.repeat(32) +
  '","authority_version":1,"bootstrap_manifest_hash":"sha256:' +
  '22'.repeat(32) +
  '","network":"testnet11","portal_runtime_config_hash":"sha256:' +
  '33'.repeat(32) +
  '","tag":"POPULIS_BOOTSTRAP_V1","version":1}';
const PAYLOAD_MEMO_HEX = bytesToHex(new TextEncoder().encode(PAYLOAD_MEMO_UTF8));
const PAYLOAD_HASH = `sha256:${sha256(new TextEncoder().encode(PAYLOAD_MEMO_UTF8)).slice(2)}`;

interface FakeProgram {
  toAtom?: () => Uint8Array;
  toList?: () => FakeProgram[];
  run?: (solution: FakeProgram, cost: number, mempool: boolean) => { value: FakeProgram };
}

function atom(bytes: Uint8Array | number[]): FakeProgram {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return { toAtom: () => value };
}

function list(items: FakeProgram[]): FakeProgram {
  return { toList: () => items };
}

function puzzleReturning(conditions: FakeProgram): FakeProgram {
  return { run: () => ({ value: conditions }) };
}

function createCoinCondition(args: {
  puzzleHash: string;
  amount: number;
  memos: [string, string] | null;
}): FakeProgram {
  const fields = [atom([51]), atom(hexToBytes(args.puzzleHash)), atom([args.amount])];
  if (args.memos !== null) {
    fields.push(list([atom(hexToBytes(args.memos[0])), atom(hexToBytes(args.memos[1]))]));
  }
  return list(fields);
}

function markerRecord(overrides: Partial<CoinRecord> = {}): CoinRecord {
  return {
    coin: {
      parent_coin_info: PARENT_COIN_ID,
      puzzle_hash: MARKER_PH,
      amount: 1,
    },
    confirmed_block_index: 123,
    spent_block_index: 0,
    coinbase: false,
    timestamp: 1_700_000_000,
    ...overrides,
  };
}

function parentSpend(): PuzzleAndSolution {
  return {
    coin: {
      parent_coin_info: '0x' + '01'.repeat(32),
      puzzle_hash: '0x' + '02'.repeat(32),
      amount: 1_000_000,
    },
    puzzleReveal: '0xff01ff80',
    solution: '0xff8080',
  };
}

function makeWasmStub(conditions: FakeProgram): Pick<ChiaWasmService, 'sdk'> {
  let deserializeCalls = 0;
  class FakeClvm {
    deserialize(): FakeProgram {
      deserializeCalls += 1;
      return deserializeCalls % 2 === 1 ? puzzleReturning(conditions) : list([]);
    }
  }
  return { sdk: () => ({ Clvm: FakeClvm }) } as Pick<ChiaWasmService, 'sdk'>;
}

function setup(args: {
  candidates: CoinRecord[];
  conditions: FakeProgram;
  parentSpend?: PuzzleAndSolution | null;
}): { service: RecoveryAnchorDiscoveryService; coinset: jasmine.SpyObj<CoinsetService> } {
  const coinset = jasmine.createSpyObj<CoinsetService>('CoinsetService', [
    'getCoinRecordsByHint',
    'getPuzzleAndSolution',
  ]);
  coinset.getCoinRecordsByHint.and.resolveTo(args.candidates);
  coinset.getPuzzleAndSolution.and.resolveTo(
    Object.prototype.hasOwnProperty.call(args, 'parentSpend')
      ? args.parentSpend ?? null
      : parentSpend(),
  );

  TestBed.configureTestingModule({
    providers: [
      { provide: CoinsetService, useValue: coinset },
      { provide: ChiaWasmService, useValue: makeWasmStub(args.conditions) },
    ],
  });
  return { service: TestBed.inject(RecoveryAnchorDiscoveryService), coinset };
}

describe('RecoveryAnchorDiscoveryService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('discovers validated recovery anchors from marker coin parent spends', async () => {
    const record = markerRecord();
    const conditions = list([
      createCoinCondition({
        puzzleHash: '0x' + 'aa'.repeat(32),
        amount: 1,
        memos: null,
      }),
      createCoinCondition({
        puzzleHash: MARKER_PH,
        amount: 1,
        memos: [TAG_MEMO_HEX, PAYLOAD_MEMO_HEX],
      }),
    ]);
    const { service, coinset } = setup({ candidates: [record], conditions });

    const report = await service.discoverAnchors();

    expect(coinset.getCoinRecordsByHint).toHaveBeenCalledOnceWith(TAG_MEMO_HEX, true);
    expect(coinset.getPuzzleAndSolution).toHaveBeenCalledOnceWith(PARENT_COIN_ID, 123);
    expect(report.scannedCandidateCount).toBe(1);
    expect(report.rejectedCandidates).toEqual([]);
    expect(report.anchors.length).toBe(1);
    expect(report.anchors[0].markerCoinId).toBe(
      coinId(PARENT_COIN_ID, MARKER_PH, 1),
    );
    expect(report.anchors[0].payloadHash).toBe(PAYLOAD_HASH);
    expect(report.anchors[0].bootstrapRecoveryAnchor.network).toBe('testnet11');
    expect(report.anchors[0].bootstrapRecoveryAnchor.admin_authority_v2_launcher_id).toBe(
      '0x' + '88'.repeat(32),
    );
  });

  it('returns rejected candidates when the parent spend does not carry a valid anchor payload', async () => {
    const badPayloadHex = bytesToHex(new TextEncoder().encode('{"tag":"wrong"}'));
    const conditions = list([
      createCoinCondition({
        puzzleHash: MARKER_PH,
        amount: 1,
        memos: [TAG_MEMO_HEX, badPayloadHex],
      }),
    ]);
    const { service } = setup({ candidates: [markerRecord()], conditions });

    const report = await service.discoverAnchors();

    expect(report.anchors).toEqual([]);
    expect(report.rejectedCandidates.length).toBe(1);
    expect(report.rejectedCandidates[0].reason).toContain('version must be 1');
  });

  it('filters discovered anchors by network and admin authority launcher id', async () => {
    const conditions = list([
      createCoinCondition({
        puzzleHash: MARKER_PH,
        amount: 1,
        memos: [TAG_MEMO_HEX, PAYLOAD_MEMO_HEX],
      }),
    ]);
    const { service } = setup({ candidates: [markerRecord()], conditions });

    const matching = await service.discoverAnchors({
      network: 'testnet11',
      adminAuthorityV2LauncherId: '0x' + '88'.repeat(32),
    });
    const wrongNetwork = await service.discoverAnchors({ network: 'mainnet' });
    const wrongLauncher = await service.discoverAnchors({
      adminAuthorityV2LauncherId: '0x' + '99'.repeat(32),
    });

    expect(matching.anchors.length).toBe(1);
    expect(wrongNetwork.anchors).toEqual([]);
    expect(wrongLauncher.anchors).toEqual([]);
  });

  it('rejects candidates whose parent spend cannot be fetched', async () => {
    const conditions = list([
      createCoinCondition({
        puzzleHash: MARKER_PH,
        amount: 1,
        memos: [TAG_MEMO_HEX, PAYLOAD_MEMO_HEX],
      }),
    ]);
    const { service } = setup({
      candidates: [markerRecord()],
      conditions,
      parentSpend: null,
    });

    const report = await service.discoverAnchors();

    expect(report.anchors).toEqual([]);
    expect(report.rejectedCandidates[0].reason).toContain('parent spend');
  });

  it('sorts newest anchors first and honors the limit', async () => {
    const oldRecord = markerRecord({ confirmed_block_index: 100, timestamp: 1000 });
    const newRecord = markerRecord({
      coin: {
        parent_coin_info: '0x' + '34'.repeat(32),
        puzzle_hash: MARKER_PH,
        amount: 1,
      },
      confirmed_block_index: 200,
      timestamp: 2000,
    });
    const conditions = list([
      createCoinCondition({
        puzzleHash: MARKER_PH,
        amount: 1,
        memos: [TAG_MEMO_HEX, PAYLOAD_MEMO_HEX],
      }),
    ]);
    const { service } = setup({ candidates: [oldRecord, newRecord], conditions });

    const report = await service.discoverAnchors({ limit: 1 });

    expect(report.anchors.length).toBe(1);
    expect(report.anchors[0].parentCoinId).toBe('0x' + '34'.repeat(32));
  });
});
