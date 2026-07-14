import { TestBed } from '@angular/core/testing';

import { MintProposalResponse } from '../admin-api.service';
import { ChiaSingletonReaderService, ReplayedSpend, SingletonLineage, SingletonLineageNode } from '../chia-singleton-reader.service';
import { ChiaWasmService } from '../chia-wasm.service';
import { CoinsetService } from '../coinset.service';
import {
  GovernanceTrackerReaderService,
  TrackerStateSnapshot,
} from '../governance-tracker-reader.service';
import { hexToBytes } from '../../utils/chia-hash';
import { canonicalPropertyIdHash } from '../../utils/mint-property-id';

import {
  ClvmShape,
  decodeMintProposalTransitionSpend,
  expectedMintProposalDraftFullPuzzleHash,
  MintProposalChainStateService,
  ProgramShape,
} from './mint-proposal-chain-state.service';
import { MintProposalV2Service } from './mint-proposal-v2.service';
import { PropertyRegistryChainStateService } from './property-registry-chain-state.service';

describe('MintProposalChainStateService', () => {
  let service: MintProposalChainStateService;
  let singleton: jasmine.SpyObj<
    Pick<ChiaSingletonReaderService, 'walkLineage' | 'replayLatestSpend'>
  >;
  let wasm: jasmine.SpyObj<Pick<ChiaWasmService, 'sdk'>>;
  let coinset: jasmine.SpyObj<Pick<CoinsetService, 'getCoinRecordByName'>>;
  let tracker: jasmine.SpyObj<Pick<GovernanceTrackerReaderService, 'readCurrentState'>>;
  let propertyRegistry: jasmine.SpyObj<
    Pick<PropertyRegistryChainStateService, 'checkProperty'>
  >;

  const launcherId = b32('11');
  const launcherCoinId = b32('12');
  const eveInnerPuzhash = b32('22');
  const propertyIdCanon = canonicalPropertyIdHash('TX-AUSTIN-001');
  const propertyRegistryPuzzleHash = b32('77');
  const expectedFullPuzzleHash = expectedMintProposalDraftFullPuzzleHash(
    launcherId,
    eveInnerPuzhash,
  );

  beforeEach(() => {
    singleton = jasmine.createSpyObj('ChiaSingletonReaderService', [
      'walkLineage',
      'replayLatestSpend',
    ]);
    wasm = jasmine.createSpyObj('ChiaWasmService', ['sdk']);
    wasm.sdk.and.returnValue({ Clvm: FakeClvm });
    coinset = jasmine.createSpyObj('CoinsetService', ['getCoinRecordByName']);
    tracker = jasmine.createSpyObj('GovernanceTrackerReaderService', ['readCurrentState']);
    tracker.readCurrentState.and.resolveTo(matchingTrackerState());
    propertyRegistry = jasmine.createSpyObj('PropertyRegistryChainStateService', [
      'checkProperty',
    ]);
    propertyRegistry.checkProperty.and.resolveTo({
      kind: 'confirmed-present',
      registryLauncherId: b32('88'),
      propertyIdCanon,
      propertyRegistryPuzzleHash,
      registeredIds: [propertyIdCanon],
      registryVersion: 1,
      confirmedBlockIndex: 104,
      lineageDepth: 2,
    });
    TestBed.configureTestingModule({
      providers: [
        MintProposalChainStateService,
        { provide: ChiaSingletonReaderService, useValue: singleton },
        { provide: ChiaWasmService, useValue: wasm },
        { provide: CoinsetService, useValue: coinset },
        { provide: GovernanceTrackerReaderService, useValue: tracker },
        { provide: PropertyRegistryChainStateService, useValue: propertyRegistry },
      ],
    });
    service = TestBed.inject(MintProposalChainStateService);
  });

  it('reports a local-only draft when no proposal singleton launcher is stored', async () => {
    const result = await service.check({
      ...proposal(),
      on_chain: {
        ...proposal().on_chain,
        proposal_tracker_coin_id: null,
      },
    });

    expect(result).toEqual({
      kind: 'local-only',
      reason: 'missing-proposal-launcher-id',
    });
    expect(singleton.walkLineage).not.toHaveBeenCalled();
  });

  it('reports unconfirmed when the stored launcher is not on chain yet', async () => {
    singleton.walkLineage.and.resolveTo(null);

    const result = await service.check(proposal());

    expect(singleton.walkLineage).toHaveBeenCalledOnceWith(launcherId);
    expect(result).toEqual({
      kind: 'unconfirmed',
      stage: 'launcher-not-found',
      launcherId,
    });
  });

  it('confirms the local PROPOSED mirror against the expected DRAFT-v0 live singleton puzzle hash', async () => {
    singleton.walkLineage.and.resolveTo(
      lineage({
        livePuzzleHash: expectedFullPuzzleHash,
        liveCoinId: b32('33'),
      }),
    );

    const result = await service.check(proposal());

    expect(result).toEqual({
      kind: 'confirmed-draft',
      launcherId,
      liveCoinId: b32('33'),
      livePuzzleHash: expectedFullPuzzleHash,
      expectedPuzzleHash: expectedFullPuzzleHash,
      proposalPuzzleState: 'DRAFT',
      stateVersion: 0,
      confirmedBlockIndex: 101,
      lineageDepth: 1,
      tracker: {
        kind: 'bound',
        trackerState: 'OPEN',
        proposalHash: b32('53'),
        votingDeadlineSeconds: 1_700_000_678n,
        voteTally: 12_345n,
        quorumRequired: 50_000n,
        billKind: 'MINT',
        deedFullPuzzleHash: b32('52'),
        propertyIdCanon,
        propertyRegistryPuzzleHash,
      },
      propertyRegistry: {
        kind: 'confirmed-present',
        registryLauncherId: b32('88'),
        propertyIdCanon,
        propertyRegistryPuzzleHash,
        registeredIds: [propertyIdCanon],
        registryVersion: 1,
        confirmedBlockIndex: 104,
        lineageDepth: 2,
      },
    });
  });

  it('attaches drift evidence when the tracker is open for a different proposal hash', async () => {
    singleton.walkLineage.and.resolveTo(
      lineage({
        livePuzzleHash: expectedFullPuzzleHash,
        liveCoinId: b32('33'),
      }),
    );
    tracker.readCurrentState.and.resolveTo({
      ...matchingTrackerState(),
      proposalHash: b32('99'),
    });

    const result = await service.check(proposal());

    expect(result.kind).toBe('confirmed-draft');
    if (result.kind === 'confirmed-draft') {
      expect(result.tracker).toEqual({
        kind: 'mismatch',
        reason: 'proposal-hash',
        trackerState: 'OPEN',
        expectedProposalHash: b32('53'),
        liveProposalHash: b32('99'),
        expectedDeadlineSeconds: 1_700_000_678n,
        liveDeadlineSeconds: 1_700_000_678n,
      });
    }
  });

  it('attaches confirmed/unspent SGT lock coin evidence when the stored lock id exists on chain', async () => {
    const sgtLockCoinId = b32('66');
    singleton.walkLineage.and.resolveTo(
      lineage({
        livePuzzleHash: expectedFullPuzzleHash,
        liveCoinId: b32('33'),
      }),
    );
    coinset.getCoinRecordByName.and.resolveTo({
      coin: {
        parent_coin_info: b32('70'),
        puzzle_hash: b32('71'),
        amount: 10_000,
      },
      confirmed_block_index: 103,
      spent_block_index: 0,
      coinbase: false,
      timestamp: 1_700_000_200,
    });

    const result = await service.check(proposalWithSgtLock(sgtLockCoinId));

    expect(coinset.getCoinRecordByName).toHaveBeenCalledOnceWith(sgtLockCoinId);
    expect(result.kind).toBe('confirmed-draft');
    if (result.kind === 'confirmed-draft') {
      expect(result.sgtLock).toEqual({
        kind: 'confirmed-unspent',
        coinId: sgtLockCoinId,
        parentCoinId: b32('70'),
        puzzleHash: b32('71'),
        amount: 10_000,
        confirmedBlockIndex: 103,
      });
    }
  });

  it('attaches pending SGT lock coin evidence when the stored lock id is not on chain yet', async () => {
    const sgtLockCoinId = b32('67');
    singleton.walkLineage.and.resolveTo(
      lineage({
        livePuzzleHash: expectedFullPuzzleHash,
        liveCoinId: b32('33'),
      }),
    );
    coinset.getCoinRecordByName.and.resolveTo(null);

    const result = await service.check(proposalWithSgtLock(sgtLockCoinId));

    expect(result.kind).toBe('confirmed-draft');
    if (result.kind === 'confirmed-draft') {
      expect(result.sgtLock).toEqual({
        kind: 'unconfirmed',
        coinId: sgtLockCoinId,
      });
    }
  });

  it('flags drift when the live singleton puzzle hash no longer matches the stored DRAFT-v0 hash', async () => {
    singleton.walkLineage.and.resolveTo(
      lineage({
        livePuzzleHash: b32('44'),
        liveCoinId: b32('45'),
      }),
    );

    const result = await service.check(proposal());

    expect(result).toEqual({
      kind: 'mismatch',
      launcherId,
      liveCoinId: b32('45'),
      livePuzzleHash: b32('44'),
      expectedPuzzleHash: expectedFullPuzzleHash,
      confirmedBlockIndex: 101,
      lineageDepth: 1,
      reason: 'live-puzzle-hash-differs-from-local-published-draft',
    });
  });

  it('confirms a spent DRAFT coin that emitted a valid APPROVE transition to the live child puzzle hash', async () => {
    const replayProbe = replayForTransition([]);
    const decoded = decodeMintProposalTransitionSpend(
      new FakeClvm(),
      replayProbe,
      launcherId,
    );
    const replay = replayForTransition([
      hexToBytes(decoded.transitionAnnouncement),
    ]);
    singleton.walkLineage.and.resolveTo(
      transitionedLineage({
        previousPuzzleHash: expectedFullPuzzleHash,
        livePuzzleHash: decoded.expectedFullPuzzleHash,
        liveCoinId: b32('46'),
      }),
    );
    singleton.replayLatestSpend.and.resolveTo(replay);

    const result = await service.check(proposal());

    expect(result).toEqual({
      kind: 'confirmed-transition',
      launcherId,
      liveCoinId: b32('46'),
      livePuzzleHash: decoded.expectedFullPuzzleHash,
      expectedPuzzleHash: decoded.expectedFullPuzzleHash,
      previousPuzzleState: 'DRAFT',
      previousStateVersion: 0,
      proposalPuzzleState: 'APPROVED',
      stateVersion: 1,
      transitionCase: 'APPROVE',
      transitionCaseCode: MintProposalV2Service.TRANSITION_APPROVE,
      transitionAnnouncement: decoded.transitionAnnouncement,
      confirmedBlockIndex: 102,
      spentBlockIndex: 101,
      lineageDepth: 2,
      propertyRegistry: {
        kind: 'confirmed-present',
        registryLauncherId: b32('88'),
        propertyIdCanon,
        propertyRegistryPuzzleHash,
        registeredIds: [propertyIdCanon],
        registryVersion: 1,
        confirmedBlockIndex: 104,
        lineageDepth: 2,
      },
    });
  });

  function proposal(): MintProposalResponse {
    return {
      id: 'mint-draft-1',
      owner_pubkey: '0x1111111111111111111111111111111111111111',
      state: 'PROPOSED',
      par_value: 125_000,
      asset_class: 'RWA-RE-RES',
      property_id: 'TX-AUSTIN-001',
      collection_id: 'TX-AUSTIN-SFR',
      share_ppm: 1_000_000,
      jurisdiction: 'US-TX',
      royalty_puzhash: b32('40'),
      royalty_bps: 250,
      computed: {
        smart_deed_inner_puzhash: b32('50'),
        eve_inner_puzhash: eveInnerPuzhash,
        deed_full_puzhash: b32('52'),
        proposal_hash: b32('53'),
      },
      on_chain: {
        proposal_tracker_coin_id: launcherId,
        sgt_lock_coin_id: null,
        deed_launcher_id: b32('55'),
        published_bundle_id: b32('60'),
        executed_bundle_id: null,
      },
      vote_tally: 0,
      quorum_required: 5000,
      deadline: 1_700_000_678,
      timestamps: {
        created_at: 1_700_000_000,
        published_at: 1_700_000_100,
        executed_at: null,
        minted_at: null,
      },
      off_chain_metadata: {
        publish_context: {
          property_registry_puzzle_hash: propertyRegistryPuzzleHash,
        },
      },
    };
  }

  function proposalWithSgtLock(sgtLockCoinId: string): MintProposalResponse {
    return {
      ...proposal(),
      on_chain: {
        ...proposal().on_chain,
        sgt_lock_coin_id: sgtLockCoinId,
      },
    };
  }

  function matchingTrackerState(): Extract<
    TrackerStateSnapshot,
    { kind: 'OPEN' | 'AWAITING_EXECUTE' | 'AWAITING_EXPIRE' }
  > {
    return {
      kind: 'OPEN',
      proposalHash: b32('53'),
      bill: {
        kind: 'MINT',
        deedFullPuzzleHash: b32('52'),
        propertyIdCanon,
        propertyRegistryPuzzleHash,
      },
      voteTally: 12_345n,
      votingDeadlineSeconds: 1_700_000_678n,
      quorumRequired: 50_000n,
      spendCount: 1,
      lastSpendBlockIndex: 101,
    };
  }

  function lineage(args: {
    livePuzzleHash: string;
    liveCoinId: string;
  }): SingletonLineage {
    return {
      launcherId,
      launcherCoinId,
      launcher: {} as SingletonLineage['launcher'],
      nodes: [
        {
          coinId: launcherCoinId,
          parentCoinId: b32('01'),
          puzzleHash: b32('02'),
          amount: 1,
          confirmedBlockIndex: 100,
          spentBlockIndex: 100,
          isLauncher: true,
        },
        {
          coinId: args.liveCoinId,
          parentCoinId: launcherCoinId,
          puzzleHash: args.livePuzzleHash,
          amount: 1,
          confirmedBlockIndex: 101,
          spentBlockIndex: null,
          isLauncher: false,
        },
      ],
    };
  }

  function transitionedLineage(args: {
    previousPuzzleHash: string;
    livePuzzleHash: string;
    liveCoinId: string;
  }): SingletonLineage {
    return {
      launcherId,
      launcherCoinId,
      launcher: {} as SingletonLineage['launcher'],
      nodes: [
        {
          coinId: launcherCoinId,
          parentCoinId: b32('01'),
          puzzleHash: b32('02'),
          amount: 1,
          confirmedBlockIndex: 100,
          spentBlockIndex: 100,
          isLauncher: true,
        },
        {
          coinId: b32('33'),
          parentCoinId: launcherCoinId,
          puzzleHash: args.previousPuzzleHash,
          amount: 1,
          confirmedBlockIndex: 101,
          spentBlockIndex: 101,
          isLauncher: false,
        },
        {
          coinId: args.liveCoinId,
          parentCoinId: b32('33'),
          puzzleHash: args.livePuzzleHash,
          amount: 1,
          confirmedBlockIndex: 102,
          spentBlockIndex: null,
          isLauncher: false,
        },
      ],
    };
  }

  function replayForTransition(
    createPuzzleAnnouncements: Uint8Array[],
  ): ReplayedSpend {
    const node: SingletonLineageNode = {
      coinId: b32('33'),
      parentCoinId: launcherCoinId,
      puzzleHash: expectedFullPuzzleHash,
      amount: 1,
      confirmedBlockIndex: 101,
      spentBlockIndex: 101,
      isLauncher: false,
    };
    return {
      node,
      puzzleAndSolution: {
        coin: {
          parent_coin_info: node.parentCoinId,
          puzzle_hash: node.puzzleHash,
          amount: node.amount,
        },
        puzzleReveal: '0xaa',
        solution: '0xbb',
      },
      conditions: {
        createPuzzleAnnouncements,
        createCoins: [],
        costMojos: 0n,
      },
    };
  }
});

function b32(byteHex: string): string {
  return '0x' + byteHex.repeat(32);
}

class FakeClvm implements ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape {
    if (bytes[0] === 0xaa) return fullPuzzleProgram();
    if (bytes[0] === 0xbb) return fullSolutionProgram();
    throw new Error('unexpected fake deserialize input');
  }
}

function fullPuzzleProgram(): ProgramShape {
  const inner = curried(
    hashProgram(MintProposalV2Service.MOD_HASH),
    [
      atom(MintProposalV2Service.MOD_HASH),
      atom(b32('aa')),
      atom(b32('bb')),
      atom(b32('cc')),
      int(MintProposalV2Service.STATE_DRAFT),
      int(0),
    ],
  );
  return curried(hashProgram(b32('99')), [atom(b32('98')), inner]);
}

function fullSolutionProgram(): ProgramShape {
  const innerSolution = list([
    int(1),
    int(MintProposalV2Service.TRANSITION_APPROVE),
    int(1),
    atom(b32('dd')),
    list([]),
  ]);
  return list([list([]), int(1), innerSolution]);
}

function curried(program: ProgramShape, args: ProgramShape[]): ProgramShape {
  return new FakeProgram({
    uncurry: { program, args: list(args) },
  });
}

function list(items: ProgramShape[]): ProgramShape {
  return new FakeProgram({ list: items });
}

function atom(value: string): ProgramShape {
  return new FakeProgram({ atom: hexToBytes(value) });
}

function int(value: number): ProgramShape {
  return new FakeProgram({ int: BigInt(value) });
}

function hashProgram(hash: string): ProgramShape {
  return new FakeProgram({ treeHash: hexToBytes(hash) });
}

class FakeProgram implements ProgramShape {
  constructor(
    private readonly shape: {
      atom?: Uint8Array;
      int?: bigint;
      list?: ProgramShape[];
      treeHash?: Uint8Array;
      uncurry?: { program: ProgramShape; args: ProgramShape };
    },
  ) {}

  treeHash(): Uint8Array {
    return this.shape.treeHash ?? new Uint8Array(32);
  }

  uncurry(): { program: ProgramShape; args: ProgramShape } | undefined {
    return this.shape.uncurry;
  }

  toList(): ProgramShape[] | undefined {
    return this.shape.list;
  }

  toAtom(): Uint8Array {
    return this.shape.atom ?? new Uint8Array(0);
  }

  toInt(): bigint {
    return this.shape.int ?? 0n;
  }
}
