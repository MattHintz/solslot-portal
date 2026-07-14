import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService, CoinRecord } from './coinset.service';
import {
  parseRegistryFullPuzzleReveal,
  VaultVersionRegistryService,
} from './vault-version-registry.service';

const b = (n: number): string => '0x' + n.toString(16).padStart(2, '0').repeat(32);

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return '0x' + Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function makeFakeAtom(atom?: Uint8Array, int?: bigint): FakeProgram {
  return new FakeProgram({ atom, int });
}

function makeFakeList(items: FakeProgram[]): FakeProgram {
  return new FakeProgram({ listItems: items });
}

class FakeProgram {
  constructor(
    private readonly opts: {
      atom?: Uint8Array;
      int?: bigint;
      treeHash?: Uint8Array;
      listItems?: FakeProgram[];
      uncurry?: { program: FakeProgram; args: FakeProgram };
    },
  ) {}

  toAtom(): Uint8Array {
    if (this.opts.atom) return this.opts.atom;
    if (this.opts.int !== undefined) {
      // CLVM-canonical unsigned int encoding.
      if (this.opts.int === 0n) return new Uint8Array(0);
      const bytes: number[] = [];
      let x = this.opts.int;
      while (x > 0n) {
        bytes.unshift(Number(x & 0xffn));
        x >>= 8n;
      }
      if (bytes[0] & 0x80) bytes.unshift(0);
      return new Uint8Array(bytes);
    }
    throw new Error('not an atom');
  }

  toInt(): bigint {
    if (this.opts.int !== undefined) return this.opts.int;
    const atom = this.toAtom();
    if (atom.length === 0) return 0n;
    let n = 0n;
    for (const byte of atom) {
      n = (n << 8n) | BigInt(byte);
    }
    return n;
  }

  toList(): FakeProgram[] | undefined {
    return this.opts.listItems;
  }

  uncurry(): { program: FakeProgram; args: FakeProgram } | undefined {
    return this.opts.uncurry;
  }

  treeHash(): Uint8Array {
    return this.opts.treeHash ?? this.toAtom();
  }
}

class FakeClvm {
  private readonly root: FakeProgram;
  constructor(reveal?: FakeProgram) {
    this.root =
      reveal ??
      buildFakeRegistryReveal(
        hexToBytes(b(0x5c)),
        {
          vaultInnerModHash: hexToBytes(b(0xaa)),
          canonicalParamsHash: hexToBytes(b(0xbb)),
          vaultVersion: 2n,
        },
      );
  }
  deserialize(): FakeProgram {
    return this.root;
  }
}

function buildFakeRegistryReveal(
  registryModHash: Uint8Array,
  state: { vaultInnerModHash: Uint8Array; canonicalParamsHash: Uint8Array; vaultVersion: bigint },
): FakeProgram {
  const innerArgs = makeFakeList([
    makeFakeAtom(registryModHash),
    makeFakeAtom(hexToBytes(b(0x01))),
    makeFakeAtom(hexToBytes(b(0x02))),
    makeFakeAtom(hexToBytes(b(0x03))),
    makeFakeAtom(hexToBytes(b(0x04))),
    makeFakeAtom(state.vaultInnerModHash),
    makeFakeAtom(state.canonicalParamsHash),
    makeFakeAtom(undefined, state.vaultVersion),
  ]);
  const innerMod = makeFakeAtom(registryModHash);
  const innerPuzzle = new FakeProgram({
    uncurry: { program: innerMod, args: innerArgs },
  });
  const singletonStruct = makeFakeList([makeFakeAtom(hexToBytes(b(0x05)))]);
  const fullArgs = makeFakeList([singletonStruct, innerPuzzle]);
  return new FakeProgram({
    uncurry: { program: new FakeProgram({}), args: fullArgs },
  });
}

describe('parseRegistryFullPuzzleReveal', () => {
  const registryModHash = hexToBytes(b(0x5c));
  const state = {
    vaultInnerModHash: hexToBytes(b(0xaa)),
    canonicalParamsHash: hexToBytes(b(0xbb)),
    vaultVersion: 3n,
  };

  it('recovers the registry state from a valid singleton reveal', () => {
    const reveal = buildFakeRegistryReveal(registryModHash, state);
    const parsed = parseRegistryFullPuzzleReveal(new FakeClvm(reveal), registryModHash, new Uint8Array(0));
    expect(parsed.vaultInnerModHash).toBe(bytesToHex(state.vaultInnerModHash));
    expect(parsed.canonicalParamsHash).toBe(bytesToHex(state.canonicalParamsHash));
    expect(parsed.vaultVersion).toBe(3);
  });

  it('throws when the full puzzle is not curried', () => {
    const bad = new FakeProgram({});
    expect(() => parseRegistryFullPuzzleReveal(new FakeClvm(bad), registryModHash, new Uint8Array(0))).toThrowError(
      /not curried/,
    );
  });

  it('throws when the inner mod hash does not match', () => {
    const reveal = buildFakeRegistryReveal(registryModHash, state);
    const wrongMod = hexToBytes(b(0x99));
    expect(() => parseRegistryFullPuzzleReveal(new FakeClvm(reveal), wrongMod, new Uint8Array(0))).toThrowError(
      /mod hash mismatch/,
    );
  });

  it('throws when the inner puzzle has the wrong number of args', () => {
    const innerArgs = makeFakeList([makeFakeAtom(registryModHash)]); // only 1 arg
    const innerPuzzle = new FakeProgram({
      uncurry: { program: makeFakeAtom(registryModHash), args: innerArgs },
    });
    const fullArgs = makeFakeList([makeFakeList([]), innerPuzzle]);
    const reveal = new FakeProgram({
      uncurry: { program: new FakeProgram({}), args: fullArgs },
    });
    expect(() => parseRegistryFullPuzzleReveal(new FakeClvm(reveal), registryModHash, new Uint8Array(0))).toThrowError(
      /expects 8 curried args/,
    );
  });
});

describe('VaultVersionRegistryService', () => {
  let service: VaultVersionRegistryService;
  let singleton: jasmine.SpyObj<ChiaSingletonReaderService>;
  let coinset: jasmine.SpyObj<CoinsetService>;
  let wasm: jasmine.SpyObj<ChiaWasmService>;

  const registryModHash = hexToBytes(b(0x5c));
  const state = {
    vaultInnerModHash: hexToBytes(b(0xaa)),
    canonicalParamsHash: hexToBytes(b(0xbb)),
    vaultVersion: 2n,
  };

  let originalLauncherId: string;

  beforeEach(() => {
    originalLauncherId = environment.solslotProtocol.vaultVersionRegistryLauncherId;
    environment.solslotProtocol.vaultVersionRegistryLauncherId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    environment.solslotProtocol.vaultVersionRegistryModHash = bytesToHex(registryModHash);
    singleton = jasmine.createSpyObj<ChiaSingletonReaderService>('ChiaSingletonReaderService', ['walkLineage']);
    coinset = jasmine.createSpyObj<CoinsetService>('CoinsetService', ['getPuzzleAndSolution']);
    wasm = jasmine.createSpyObj<ChiaWasmService>('ChiaWasmService', ['ready', 'sdk']);
    wasm.ready.and.returnValue(true);
    wasm.sdk.and.returnValue({ Clvm: FakeClvm } as any);
    TestBed.configureTestingModule({
      providers: [
        VaultVersionRegistryService,
        { provide: ChiaSingletonReaderService, useValue: singleton },
        { provide: CoinsetService, useValue: coinset },
        { provide: ChiaWasmService, useValue: wasm },
      ],
    });
    service = TestBed.inject(VaultVersionRegistryService);
  });

  afterEach(() => {
    environment.solslotProtocol.vaultVersionRegistryLauncherId = originalLauncherId;
  });

  function makeLauncherCoinRecord(): CoinRecord {
    return {
      coin: {
        parent_coin_info: 'parent-of-launcher',
        puzzle_hash: 'launcher-ph',
        amount: 1,
      },
      confirmed_block_index: 100,
      spent_block_index: 101,
      coinbase: false,
      timestamp: 1000,
    };
  }

  function makeLineage(depth: number, includeSpentParents: boolean): SingletonLineage {
    const nodes: SingletonLineage['nodes'] = [
      {
        coinId: 'launcher-coin-id',
        parentCoinId: 'parent-of-launcher',
        puzzleHash: 'launcher-ph',
        amount: 1,
        confirmedBlockIndex: 100,
        spentBlockIndex: 101,
        isLauncher: true,
      },
    ];
    if (depth >= 1) {
      nodes.push({
        coinId: 'eve-coin-id',
        parentCoinId: 'launcher-coin-id',
        puzzleHash: 'eve-ph',
        amount: 1,
        confirmedBlockIndex: 101,
        spentBlockIndex: includeSpentParents ? 200 : null,
        isLauncher: false,
      });
    }
    if (depth >= 2) {
      nodes.push({
        coinId: 'state1-coin-id',
        parentCoinId: 'eve-coin-id',
        puzzleHash: 'state1-ph',
        amount: 1,
        confirmedBlockIndex: 200,
        spentBlockIndex: null,
        isLauncher: false,
      });
    }
    return {
      launcherId: 'reg-launcher-id',
      launcherCoinId: 'launcher-coin-id',
      launcher: makeLauncherCoinRecord(),
      nodes,
    };
  }

  it('returns null when the registry is not found on chain', async () => {
    singleton.walkLineage.and.returnValue(Promise.resolve(null));
    expect(await service.getCurrentState()).toBeNull();
  });

  it('returns null when the registry is still at the eve coin (never spent after launch)', async () => {
    singleton.walkLineage.and.returnValue(Promise.resolve(makeLineage(1, false)));
    expect(await service.getCurrentState()).toBeNull();
  });

  it('returns state when the registry has been spent (non-launcher parent available)', async () => {
    const lineage = makeLineage(2, true);
    singleton.walkLineage.and.returnValue(Promise.resolve(lineage));
    coinset.getPuzzleAndSolution.and.returnValue(
      Promise.resolve({
        coin: {
          parent_coin_info: 'eve-coin-id',
          puzzle_hash: 'eve-ph',
          amount: 1,
        },
        puzzleReveal: '0xdeadbeef',
        solution: '0xcafe',
      }),
    );
    const result = await service.getCurrentState();
    expect(result).not.toBeNull();
    expect(result!.vaultInnerModHash).toBe(bytesToHex(state.vaultInnerModHash));
    expect(result!.canonicalParamsHash).toBe(bytesToHex(state.canonicalParamsHash));
    expect(result!.vaultVersion).toBe(2);
    expect(coinset.getPuzzleAndSolution).toHaveBeenCalledWith('eve-coin-id', 200);
  });

  it('returns null when WASM is not ready', async () => {
    wasm.ready.and.returnValue(false);
    expect(await service.getCurrentState()).toBeNull();
  });

  it('returns null when the parent puzzle reveal is unavailable', async () => {
    singleton.walkLineage.and.returnValue(Promise.resolve(makeLineage(2, true)));
    coinset.getPuzzleAndSolution.and.returnValue(Promise.resolve(null));
    expect(await service.getCurrentState()).toBeNull();
  });

  it('returns null when the WASM SDK has no Clvm export', async () => {
    wasm.sdk.and.returnValue({} as any);
    singleton.walkLineage.and.returnValue(Promise.resolve(makeLineage(2, true)));
    expect(await service.getCurrentState()).toBeNull();
  });
});
