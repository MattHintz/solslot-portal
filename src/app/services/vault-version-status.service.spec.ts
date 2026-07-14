import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService, CoinRecord } from './coinset.service';
import { computeCanonicalParamsHash } from './vault-version-detection';
import { VaultVersionRegistryService } from './vault-version-registry.service';
import {
  parseVaultFullPuzzleReveal,
  VaultDescriptor,
  VaultVersionStatusService,
} from './vault-version-status.service';

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
    this.root = reveal ?? buildFakeVaultReveal();
  }
  deserialize(): FakeProgram {
    return this.root;
  }
}

/**
 * Build a fake vault full puzzle reveal.  The canonical params hash is
 * derived from the fixed dummy pool params plus the given bridge policy hash.
 */
function buildFakeVaultReveal(
  vaultInnerModHash = b(0xaf),
  bridgePolicyHash = b(0xdd),
): FakeProgram {
  const innerArgs = makeFakeList([
    makeFakeList([]), // SINGLETON_STRUCT
    makeFakeAtom(hexToBytes(b(0x11))), // OWNER_PUBKEY
    makeFakeAtom(undefined, 3n), // AUTH_TYPE
    makeFakeAtom(hexToBytes(b(0x22))), // MEMBERS_MERKLE_ROOT
    makeFakeAtom(hexToBytes(b(0x33))), // IDENTITY_ATTEST_ROOT
    makeFakeAtom(hexToBytes(bridgePolicyHash)), // ZKPASSPORT_BRIDGE_POLICY_HASH
    makeFakeAtom(hexToBytes(b(0x55))), // POOL_SINGLETON_MOD_HASH
    makeFakeAtom(hexToBytes(b(0x66))), // POOL_SINGLETON_LAUNCHER_ID
    makeFakeAtom(hexToBytes(b(0x77))), // POOL_SINGLETON_LAUNCHER_PUZZLE_HASH
  ]);
  const innerPuzzle = new FakeProgram({
    uncurry: { program: makeFakeAtom(hexToBytes(vaultInnerModHash)), args: innerArgs },
  });
  const fullArgs = makeFakeList([makeFakeList([]), innerPuzzle]);
  return new FakeProgram({
    uncurry: { program: new FakeProgram({}), args: fullArgs },
  });
}

function makeCoinRecord(): CoinRecord {
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

function makeLineage(depth: number, includeSpentParent: boolean): SingletonLineage {
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
      spentBlockIndex: includeSpentParent ? 200 : null,
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
    launcherId: 'vault-launcher-id',
    launcherCoinId: 'launcher-coin-id',
    launcher: makeCoinRecord(),
    nodes,
  };
}

describe('parseVaultFullPuzzleReveal', () => {
  it('extracts the canonical params hash and inner mod hash from a vault reveal', () => {
    const reveal = buildFakeVaultReveal(b(0xaf), b(0xdd));
    const clvm = new FakeClvm(reveal);
    const parsed = parseVaultFullPuzzleReveal(clvm, new Uint8Array(0));
    expect(parsed.vaultInnerModHash).toBe(b(0xaf));
    const expectedCanonical = computeCanonicalParamsHash(b(0x55), b(0x66), b(0x77), b(0xdd));
    expect(parsed.canonicalParamsHash).toBe(expectedCanonical);
  });
});

describe('VaultVersionStatusService', () => {
  let service: VaultVersionStatusService;
  let registry: jasmine.SpyObj<VaultVersionRegistryService>;
  let singleton: jasmine.SpyObj<ChiaSingletonReaderService>;
  let coinset: jasmine.SpyObj<CoinsetService>;
  let wasm: jasmine.SpyObj<ChiaWasmService>;
  let originalRegistryLauncherId: string;

  const registryModHash = b(0x5c);
  const canonicalParamsHash = computeCanonicalParamsHash(b(0x55), b(0x66), b(0x77), b(0xdd));
  const vaultInnerModHash = b(0xaf);

  beforeEach(() => {
    originalRegistryLauncherId = environment.solslotProtocol.vaultVersionRegistryLauncherId;
    environment.solslotProtocol.vaultVersionRegistryLauncherId =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    environment.solslotProtocol.vaultVersionRegistryModHash = registryModHash;

    registry = jasmine.createSpyObj<VaultVersionRegistryService>('VaultVersionRegistryService', ['getCurrentState']);
    singleton = jasmine.createSpyObj<ChiaSingletonReaderService>('ChiaSingletonReaderService', ['walkLineage']);
    coinset = jasmine.createSpyObj<CoinsetService>('CoinsetService', ['getPuzzleAndSolution']);
    wasm = jasmine.createSpyObj<ChiaWasmService>('ChiaWasmService', ['ready', 'sdk']);
    wasm.ready.and.returnValue(true);
    wasm.sdk.and.returnValue({ Clvm: FakeClvm } as any);

    registry.getCurrentState.and.returnValue(
      Promise.resolve({
        vaultInnerModHash,
        canonicalParamsHash,
        vaultVersion: 2,
      }),
    );
    singleton.walkLineage.and.returnValue(Promise.resolve(makeLineage(2, true)));
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

    TestBed.configureTestingModule({
      providers: [
        VaultVersionStatusService,
        { provide: VaultVersionRegistryService, useValue: registry },
        { provide: ChiaSingletonReaderService, useValue: singleton },
        { provide: CoinsetService, useValue: coinset },
        { provide: ChiaWasmService, useValue: wasm },
      ],
    });
    service = TestBed.inject(VaultVersionStatusService);
  });

  afterEach(() => {
    environment.solslotProtocol.vaultVersionRegistryLauncherId = originalRegistryLauncherId;
  });

  it('returns current when vault code and params match the registry', async () => {
    const result = await service.checkVault('vault-launcher-id');
    expect(result).toEqual({ kind: 'current', registryVersion: 2 });
  });

  it('returns outdated(code) when the vault inner mod hash differs', async () => {
    registry.getCurrentState.and.returnValue(
      Promise.resolve({
        vaultInnerModHash: b(0x99),
        canonicalParamsHash,
        vaultVersion: 3,
      }),
    );
    const result = await service.checkVault('vault-launcher-id');
    expect(result).toEqual({ kind: 'outdated', reason: 'code', registryVersion: 3 });
  });

  it('returns outdated(params) when the canonical params hash differs', async () => {
    const differentCanonical = computeCanonicalParamsHash(b(0x55), b(0x66), b(0x77), b(0xee));
    registry.getCurrentState.and.returnValue(
      Promise.resolve({
        vaultInnerModHash,
        canonicalParamsHash: differentCanonical,
        vaultVersion: 3,
      }),
    );
    const result = await service.checkVault('vault-launcher-id');
    expect(result).toEqual({ kind: 'outdated', reason: 'params', registryVersion: 3 });
  });

  it('returns null when the registry is unavailable', async () => {
    registry.getCurrentState.and.returnValue(Promise.resolve(null));
    expect(await service.checkVault('vault-launcher-id')).toBeNull();
  });

  it('returns null when the vault is still at the eve coin', async () => {
    singleton.walkLineage.and.returnValue(Promise.resolve(makeLineage(1, false)));
    expect(await service.checkVault('vault-launcher-id')).toBeNull();
  });

  it('returns null when WASM is not ready', async () => {
    wasm.ready.and.returnValue(false);
    expect(await service.checkVault('vault-launcher-id')).toBeNull();
  });
});
