import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  ChiaSingletonReaderService,
  ReplayedSpend,
  SingletonLineage,
  SingletonLineageNode,
} from '../chia-singleton-reader.service';
import { ChiaWasmService } from '../chia-wasm.service';
import { CoinRecord } from '../coinset.service';
import { bytesToHex, coinId, hexToBytes } from '../../utils/chia-hash';
import { MintPublishSpendBuilderService } from './mint-publish-spend-builder.service';
import fixture from './mint-publish.fixtures.json';
import { PropertyRegistryRegistrationMaterialService } from './property-registry-registration-material.service';

describe('PropertyRegistryRegistrationMaterialService', () => {
  let service: PropertyRegistryRegistrationMaterialService;
  let spendBuilder: MintPublishSpendBuilderService;
  let wasm: ChiaWasmService;
  let singleton: jasmine.SpyObj<
    Pick<ChiaSingletonReaderService, 'walkLineage' | 'replayLatestSpend'>
  >;

  const section = fixture.property_registry_registration;
  const inputs = section.inputs;
  const expected = section.expected;
  const launcherParent = '0x' + 'e1'.repeat(32);
  const nextPropertyId = '0x' + 'b2'.repeat(32);

  beforeAll(async () => {
    if ((window as unknown as { ChiaSDK?: unknown }).ChiaSDK) {
      return;
    }
    // @ts-ignore - deep-import; types come from chia_wallet_sdk_wasm.d.ts.
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
    const setWasm = (
      wasmExports as unknown as {
        __wbg_set_wasm?: (w: WebAssembly.Exports) => void;
      }
    ).__wbg_set_wasm;
    if (typeof setWasm !== 'function') {
      throw new Error('chia_wallet_sdk_wasm_bg.js missing __wbg_set_wasm');
    }
    setWasm(result.instance.exports);
    (window as unknown as { ChiaSDK: unknown }).ChiaSDK = wasmExports;
  });

  beforeEach(() => {
    singleton = jasmine.createSpyObj('ChiaSingletonReaderService', [
      'walkLineage',
      'replayLatestSpend',
    ]);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ChiaSingletonReaderService, useValue: singleton },
      ],
    });
    wasm = TestBed.inject(ChiaWasmService);
    wasm.probeReady();
    spendBuilder = TestBed.inject(MintPublishSpendBuilderService);
    service = TestBed.inject(PropertyRegistryRegistrationMaterialService);
  });

  it('builds fresh/eve registry material from the env-pinned GOV pubkey', async () => {
    const innerHex = spendBuilder.makePropertyRegistryInnerPuzzleHex({
      govPubkey: inputs.gov_pubkey,
      registeredIds: [],
    });
    const currentPuzzleHash = singletonFullPuzzleHash(
      wasm,
      innerHex,
      inputs.registry_launcher_id,
    );
    const lineage = makeLineage([
      launcherNode(inputs.registry_launcher_id),
      node({
        coinId: coinId(inputs.registry_launcher_id, currentPuzzleHash, 1),
        parentCoinId: inputs.registry_launcher_id,
        puzzleHash: currentPuzzleHash,
        amount: 1,
        confirmedBlockIndex: 20,
        spentBlockIndex: null,
        isLauncher: false,
      }),
    ]);
    singleton.walkLineage.and.resolveTo(lineage);

    const result = await service.build({
      registryLauncherId: inputs.registry_launcher_id,
      registryGovPubkey: inputs.gov_pubkey,
      propertyIdCanon: inputs.property_id_canon,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(singleton.replayLatestSpend).not.toHaveBeenCalled();
    expect(result.registeredIds).toEqual([]);
    expect(result.registryInnerPuzzleHex).toBe(innerHex);
    expect(result.propertyRegistryPuzzleHash).toBe(currentPuzzleHash);
    expect(result.spend.coin.parentCoinInfo).toBe(inputs.registry_launcher_id);
    expect(result.spend.coin.puzzleHash).toBe(currentPuzzleHash);
    expect(result.spend.announcementId).toBe(
      spendBuilder.propertyRegistryAnnouncementId({
        propertyRegistryPuzzleHash: currentPuzzleHash,
        propertyIdCanon: inputs.property_id_canon,
      }),
    );
  });

  it('rejects a fresh/eve registry when the GOV pubkey is not configured', async () => {
    const innerHex = spendBuilder.makePropertyRegistryInnerPuzzleHex({
      govPubkey: inputs.gov_pubkey,
      registeredIds: [],
    });
    const currentPuzzleHash = singletonFullPuzzleHash(
      wasm,
      innerHex,
      inputs.registry_launcher_id,
    );
    singleton.walkLineage.and.resolveTo(makeLineage([
      launcherNode(inputs.registry_launcher_id),
      node({
        coinId: coinId(inputs.registry_launcher_id, currentPuzzleHash, 1),
        parentCoinId: inputs.registry_launcher_id,
        puzzleHash: currentPuzzleHash,
        amount: 1,
        confirmedBlockIndex: 20,
        spentBlockIndex: null,
        isLauncher: false,
      }),
    ]));

    const result = await service.build({
      registryLauncherId: inputs.registry_launcher_id,
      propertyIdCanon: inputs.property_id_canon,
    });

    expect(result.kind).toBe('material-build-failed');
    if (result.kind === 'ok') return;
    expect(result.error).toContain('propertyRegistryGovPubkey');
  });

  it('reconstructs non-eve registry material from the latest on-chain spend', async () => {
    const replayNode = spentRegistryNode();
    const registeredIds = [inputs.property_id_canon, ...inputs.registered_ids];
    const currentInnerHex = spendBuilder.makePropertyRegistryInnerPuzzleHex({
      govPubkey: inputs.gov_pubkey,
      registeredIds,
    });
    const currentPuzzleHash = singletonFullPuzzleHash(
      wasm,
      currentInnerHex,
      inputs.registry_launcher_id,
    );
    const current = node({
      coinId: coinId(replayNode.coinId, currentPuzzleHash, inputs.registry_coin.amount),
      parentCoinId: replayNode.coinId,
      puzzleHash: currentPuzzleHash,
      amount: inputs.registry_coin.amount,
      confirmedBlockIndex: 30,
      spentBlockIndex: null,
      isLauncher: false,
    });
    const lineage = makeLineage([
      launcherNode(inputs.registry_launcher_id),
      replayNode,
      current,
    ]);
    singleton.walkLineage.and.resolveTo(lineage);
    singleton.replayLatestSpend.and.resolveTo(replay(replayNode));

    const result = await service.build({
      registryLauncherId: inputs.registry_launcher_id,
      propertyIdCanon: nextPropertyId,
    });

    expect(singleton.replayLatestSpend).toHaveBeenCalledWith(lineage);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.registeredIds).toEqual(registeredIds);
    expect(result.registryInnerPuzzleHex).toBe(currentInnerHex);
    expect(result.propertyRegistryPuzzleHash).toBe(currentPuzzleHash);
    expect(result.spend.coin.parentCoinInfo).toBe(replayNode.coinId);
    expect(result.spend.coin.puzzleHash).toBe(currentPuzzleHash);
    expect(result.spend.announcementId).toBe(
      spendBuilder.propertyRegistryAnnouncementId({
        propertyRegistryPuzzleHash: currentPuzzleHash,
        propertyIdCanon: nextPropertyId,
      }),
    );
  });

  it('rejects non-eve material when the reconstructed full puzzle hash does not match the current coin', async () => {
    const replayNode = spentRegistryNode();
    const lineage = makeLineage([
      launcherNode(inputs.registry_launcher_id),
      replayNode,
      node({
        coinId: '0x' + 'c3'.repeat(32),
        parentCoinId: replayNode.coinId,
        puzzleHash: '0x' + '00'.repeat(32),
        amount: inputs.registry_coin.amount,
        confirmedBlockIndex: 30,
        spentBlockIndex: null,
        isLauncher: false,
      }),
    ]);
    singleton.walkLineage.and.resolveTo(lineage);
    singleton.replayLatestSpend.and.resolveTo(replay(replayNode));

    const result = await service.build({
      registryLauncherId: inputs.registry_launcher_id,
      propertyIdCanon: nextPropertyId,
    });

    expect(result.kind).toBe('material-build-failed');
    if (result.kind === 'ok') return;
    expect(result.error).toContain('Reconstructed property registry full puzzle hash');
  });

  function spentRegistryNode(): SingletonLineageNode {
    return node({
      coinId: coinId(
        inputs.registry_coin.parentCoinInfo,
        inputs.registry_coin.puzzleHash,
        inputs.registry_coin.amount,
      ),
      parentCoinId: inputs.registry_coin.parentCoinInfo,
      puzzleHash: inputs.registry_coin.puzzleHash,
      amount: inputs.registry_coin.amount,
      confirmedBlockIndex: 25,
      spentBlockIndex: 26,
      isLauncher: false,
    });
  }

  function replay(replayNode: SingletonLineageNode): ReplayedSpend {
    return {
      node: replayNode,
      puzzleAndSolution: {
        coin: {
          parent_coin_info: inputs.registry_coin.parentCoinInfo,
          puzzle_hash: inputs.registry_coin.puzzleHash,
          amount: inputs.registry_coin.amount,
        },
        puzzleReveal: expected.puzzle_reveal_hex,
        solution: expected.solution_hex,
      },
      conditions: {
        createPuzzleAnnouncements: [],
        createCoins: [],
        costMojos: 0n,
      },
    };
  }

  function makeLineage(nodes: SingletonLineageNode[]): SingletonLineage {
    return {
      launcherId: inputs.registry_launcher_id,
      launcherCoinId: inputs.registry_launcher_id,
      launcher: coinRecord({
        parentCoinInfo: launcherParent,
        puzzleHash: MintPublishSpendBuilderService.SINGLETON_LAUNCHER_HASH,
        amount: 1,
        confirmedBlockIndex: 10,
        spentBlockIndex: 11,
      }),
      nodes,
    };
  }
});

function launcherNode(launcherId: string): SingletonLineageNode {
  return node({
    coinId: launcherId,
    parentCoinId: '0x' + 'e1'.repeat(32),
    puzzleHash: MintPublishSpendBuilderService.SINGLETON_LAUNCHER_HASH,
    amount: 1,
    confirmedBlockIndex: 10,
    spentBlockIndex: 11,
    isLauncher: true,
  });
}

function node(args: SingletonLineageNode): SingletonLineageNode {
  return args;
}

function coinRecord(args: {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: number;
  confirmedBlockIndex: number;
  spentBlockIndex: number;
}): CoinRecord {
  return {
    coin: {
      parent_coin_info: args.parentCoinInfo,
      puzzle_hash: args.puzzleHash,
      amount: args.amount,
    },
    confirmed_block_index: args.confirmedBlockIndex,
    spent_block_index: args.spentBlockIndex,
    coinbase: false,
    timestamp: 0,
  };
}

function singletonFullPuzzleHash(
  wasm: ChiaWasmService,
  innerPuzzleHex: string,
  launcherId: string,
): string {
  const sdk = wasm.sdk() as {
    Clvm: new () => ClvmShape;
    Constants: {
      singletonTopLayerV11?: () => Uint8Array;
      singletonTopLayer?: () => Uint8Array;
    };
  };
  const singletonBytes =
    sdk.Constants.singletonTopLayerV11?.() ?? sdk.Constants.singletonTopLayer?.();
  if (!singletonBytes) {
    throw new Error('singleton top layer is unavailable');
  }
  const clvm = new sdk.Clvm();
  const singletonStruct = clvm.pair(
    clvm.atom(hexToBytes(MintPublishSpendBuilderService.SINGLETON_MOD_HASH)),
    clvm.pair(
      clvm.atom(hexToBytes(launcherId)),
      clvm.atom(hexToBytes(MintPublishSpendBuilderService.SINGLETON_LAUNCHER_HASH)),
    ),
  );
  return bytesToHex(
    clvm.deserialize(singletonBytes)
      .curry([
        singletonStruct,
        clvm.deserialize(hexToBytes(innerPuzzleHex)),
      ])
      .treeHash(),
  );
}

interface ProgramShape {
  treeHash(): Uint8Array;
  curry(args: ProgramShape[]): ProgramShape;
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  atom(value: Uint8Array): ProgramShape;
  pair(first: ProgramShape, rest: ProgramShape): ProgramShape;
}
