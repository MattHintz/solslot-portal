import { TestBed } from '@angular/core/testing';

import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService, PuzzleAndSolution } from './coinset.service';

const H1 = '0x' + '11'.repeat(32);
const H2 = '0x' + '22'.repeat(32);
const H3 = '0x' + '33'.repeat(32);

function bytes(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Uint8Array.from({ length: stripped.length / 2 }, (_, i) => parseInt(stripped.slice(i * 2, i * 2 + 2), 16));
}

function lineage(): SingletonLineage {
  return {
    launcherId: H1,
    launcherCoinId: H1,
    launcher: {
      coin: {
        parent_coin_info: H2,
        puzzle_hash: H3,
        amount: 1,
      },
      confirmed_block_index: 10,
      spent_block_index: 20,
      coinbase: false,
      timestamp: 0,
    },
    nodes: [
      {
        coinId: H1,
        parentCoinId: H2,
        puzzleHash: H3,
        amount: 1,
        confirmedBlockIndex: 10,
        spentBlockIndex: 20,
        isLauncher: true,
      },
      {
        coinId: H2,
        parentCoinId: H1,
        puzzleHash: H3,
        amount: 1,
        confirmedBlockIndex: 21,
        spentBlockIndex: null,
        isLauncher: false,
      },
    ],
  };
}

describe('ChiaSingletonReaderService', () => {
  let service: ChiaSingletonReaderService;
  let coinset: jasmine.SpyObj<Pick<CoinsetService, 'getPuzzleAndSolution'>>;
  let wasm: jasmine.SpyObj<Pick<ChiaWasmService, 'ready' | 'sdk'>>;

  beforeEach(() => {
    coinset = jasmine.createSpyObj('CoinsetService', ['getPuzzleAndSolution']);
    coinset.getPuzzleAndSolution.and.resolveTo({
      coin: {
        parent_coin_info: H2,
        puzzle_hash: H3,
        amount: 1,
      },
      puzzleReveal: '0xff80',
      solution: '0xff80',
    } satisfies PuzzleAndSolution);
    wasm = jasmine.createSpyObj('ChiaWasmService', ['ready', 'sdk']);
    wasm.ready.and.returnValue(true);

    TestBed.configureTestingModule({
      providers: [
        ChiaSingletonReaderService,
        { provide: CoinsetService, useValue: coinset },
        { provide: ChiaWasmService, useValue: wasm },
      ],
    });
    service = TestBed.inject(ChiaSingletonReaderService);
  });

  it('reads legacy protocol-prefix announcements as the state hash tail', async () => {
    const stateHash = bytes(H1);
    setAnnouncementBody(Uint8Array.from([ChiaSingletonReaderService.PROTOCOL_PREFIX, ...stateHash]));

    const actual = await service.readLatestProtocolStateHash(lineage());

    expect(actual).toEqual(stateHash);
    expect(coinset.getPuzzleAndSolution).toHaveBeenCalledOnceWith(H1, 20);
  });

  it('reads admin-authority v2 tagged announcements as the final 32-byte state hash', async () => {
    const stateHash = bytes(H2);
    setAnnouncementBody(Uint8Array.from([ChiaSingletonReaderService.PROTOCOL_PREFIX, 0x07, ...stateHash]));

    const actual = await service.readLatestProtocolStateHash(lineage());

    expect(actual).toEqual(stateHash);
  });

  function setAnnouncementBody(body: Uint8Array): void {
    class FakeClvm {
      deserialize(): { run: () => { value: { toList: () => unknown[] }; cost: bigint } } {
        return {
          run: () => ({
            value: {
              toList: () => [
                {
                  parseCreatePuzzleAnnouncement: () => ({ message: body }),
                },
              ],
            },
            cost: 1n,
          }),
        };
      }
    }
    wasm.sdk.and.returnValue({ Clvm: FakeClvm });
  }
});
