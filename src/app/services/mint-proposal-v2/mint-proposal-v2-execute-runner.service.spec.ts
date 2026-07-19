import { TestBed } from '@angular/core/testing';

import { ChiaSingletonReaderService } from '../chia-singleton-reader.service';
import { ChiaWalletService, UnsignedCoinSpend } from '../chia-wallet.service';
import { ChiaWasmService } from '../chia-wasm.service';
import { CommitteeApiService } from '../committee-api.service';
import { CoinsetService } from '../coinset.service';
import { GovernanceTrackerReaderService } from '../governance-tracker-reader.service';
import { SgtVoteSpendBuilderService } from '../sgt-driver/sgt-vote-spend-builder.service';
import { coinId, hexToBytes } from '../../utils/chia-hash';
import { canonicalPropertyIdHash } from '../../utils/mint-property-id';
import { environment } from '../../../environments/environment';

import { MintExecuteSpendBuilderService } from './mint-execute-spend-builder.service';
import { MintProposalV2Service } from './mint-proposal-v2.service';
import { MintProposalV2ExecuteRunnerService } from './mint-proposal-v2-execute-runner.service';
import { PropertyRegistryRegistrationMaterialService } from './property-registry-registration-material.service';

describe('MintProposalV2ExecuteRunnerService', () => {
  const originalProtocol = { ...environment.solslotProtocol };
  const didLauncherId = b32('10');
  const registryLauncherId = b32('11');
  const proposalLauncherId = b32('54');
  const deedLauncherId = coinId(b32('85'), b32('86'), 1);
  const registryCoin = coin(b32('80'), b32('77'));
  const registryCoinId = coinId(
    registryCoin.parentCoinInfo,
    registryCoin.puzzleHash,
    registryCoin.amount,
  );

  let service: MintProposalV2ExecuteRunnerService;
  let tracker: jasmine.SpyObj<GovernanceTrackerReaderService>;
  let trackerBuilder: jasmine.SpyObj<SgtVoteSpendBuilderService>;
  let executeBuilder: jasmine.SpyObj<MintExecuteSpendBuilderService>;
  let registry: jasmine.SpyObj<PropertyRegistryRegistrationMaterialService>;
  let singleton: jasmine.SpyObj<ChiaSingletonReaderService>;
  let coinset: jasmine.SpyObj<CoinsetService>;
  let wallet: jasmine.SpyObj<ChiaWalletService>;
  let proposalV2: jasmine.SpyObj<MintProposalV2Service>;
  let api: jasmine.SpyObj<CommitteeApiService>;

  beforeEach(() => {
    Object.assign(environment.solslotProtocol, {
      ...originalProtocol,
      protocolDidLauncherId: didLauncherId,
      protocolDidInnerPuzhash: b32('13'),
      protocolDidSingletonStructHex: '0xff80',
      governanceSingletonStructHex: '0xff80',
      propertyRegistryLauncherId: registryLauncherId,
      propertyRegistryGovPubkey: '0x' + '14'.repeat(48),
    });

    tracker = jasmine.createSpyObj('GovernanceTrackerReaderService', ['getAwaitingExecuteInputs']);
    trackerBuilder = jasmine.createSpyObj('SgtVoteSpendBuilderService', [
      'buildTrackerExecuteCoinSpend',
    ]);
    executeBuilder = jasmine.createSpyObj('MintExecuteSpendBuilderService', [
      'buildDidMintSpend',
      'buildProposalExecuteSpend',
      'buildDeedLauncherSpend',
    ]);
    registry = jasmine.createSpyObj('PropertyRegistryRegistrationMaterialService', ['build']);
    singleton = jasmine.createSpyObj('ChiaSingletonReaderService', [
      'walkLineage',
      'replayLatestSpend',
    ]);
    coinset = jasmine.createSpyObj('CoinsetService', ['getCoinRecordByName']);
    wallet = jasmine.createSpyObj('ChiaWalletService', ['signSpendBundle']);
    proposalV2 = jasmine.createSpyObj('MintProposalV2Service', ['computeProposalDataHash']);
    api = jasmine.createSpyObj('CommitteeApiService', ['executeProposal']);

    tracker.getAwaitingExecuteInputs.and.resolveTo(trackerInputs());
    trackerBuilder.buildTrackerExecuteCoinSpend.and.returnValue(spend('01'));
    executeBuilder.buildDidMintSpend.and.returnValue(spend('02'));
    executeBuilder.buildProposalExecuteSpend.and.returnValue(spend('04'));
    executeBuilder.buildDeedLauncherSpend.and.returnValue(spend('05'));
    registry.build.and.resolveTo({
      kind: 'ok',
      spend: {
        ...spend('03'),
        coin: registryCoin,
        announcementId: b32('31'),
        newInnerPuzzleHash: b32('32'),
        newRegisteredIdsRoot: b32('33'),
        aggSigMeMessage: b32('34'),
      },
      propertyRegistryPuzzleHash: registryCoin.puzzleHash,
      registryInnerPuzzleHex: '0xff80',
      registeredIds: [],
    });
    singleton.walkLineage.and.callFake(async (launcherId: string) => singletonLineage(launcherId));
    coinset.getCoinRecordByName.and.resolveTo({
      coin: {
        parent_coin_info: b32('85'),
        puzzle_hash: b32('86'),
        amount: 1,
      },
      coinbase: false,
      confirmed_block_index: 100,
      spent_block_index: 0,
      timestamp: 0,
    });
    proposalV2.computeProposalDataHash.and.returnValue(hexToBytes(b32('70')));
    wallet.signSpendBundle.and.callFake(async (coinSpends: UnsignedCoinSpend[]) => ({
      coinSpends,
      aggregatedSignature: '0x' + 'ab'.repeat(96),
    }));
    api.executeProposal.and.resolveTo({
      pushed: true,
      status: 'SUCCESS',
      spendBundleId: b32('aa'),
      proposalId: 'mint-draft-1',
    });

    class FakeClvm {
      deserialize() {
        return { treeHash: () => hexToBytes(b32('90')) };
      }
    }
    const wasm = {
      ready: () => true,
      sdk: () => ({ Clvm: FakeClvm }),
    };

    TestBed.configureTestingModule({
      providers: [
        MintProposalV2ExecuteRunnerService,
        { provide: GovernanceTrackerReaderService, useValue: tracker },
        { provide: SgtVoteSpendBuilderService, useValue: trackerBuilder },
        { provide: MintExecuteSpendBuilderService, useValue: executeBuilder },
        { provide: PropertyRegistryRegistrationMaterialService, useValue: registry },
        { provide: ChiaSingletonReaderService, useValue: singleton },
        { provide: CoinsetService, useValue: coinset },
        { provide: ChiaWalletService, useValue: wallet },
        { provide: ChiaWasmService, useValue: wasm },
        { provide: MintProposalV2Service, useValue: proposalV2 },
        { provide: CommitteeApiService, useValue: api },
      ],
    });
    service = TestBed.inject(MintProposalV2ExecuteRunnerService);
  });

  afterEach(() => Object.assign(environment.solslotProtocol, originalProtocol));

  it('signs and submits governance, DID, registry, proposal, and deed spends', async () => {
    const result = await service.executeMint(proposal());

    expect(result.kind).toBe('submitted');
    expect(proposalV2.computeProposalDataHash).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        metadataRoot: b32('73'),
        metadataAnchorId: b32('74'),
      }),
    );
    expect(wallet.signSpendBundle).toHaveBeenCalledTimes(1);
    const spends = wallet.signSpendBundle.calls.mostRecent().args[0];
    expect(spends.map((item) => item.puzzleReveal)).toEqual([
      '0xff01',
      '0xff02',
      '0xff03',
      '0xff04',
      '0xff05',
    ]);
    expect(api.executeProposal).toHaveBeenCalledTimes(1);
    const [bundle, proposalId] = api.executeProposal.calls.mostRecent().args;
    expect(bundle.coin_spends.length).toBe(5);
    expect(proposalId).toBe('mint-draft-1');
  });

  it('rejects a registry coin that moved after publication', async () => {
    registry.build.and.resolveTo({
      kind: 'ok',
      spend: {
        ...spend('03'),
        coin: coin(b32('99'), b32('77')),
        announcementId: b32('31'),
        newInnerPuzzleHash: b32('32'),
        newRegisteredIdsRoot: b32('33'),
        aggSigMeMessage: b32('34'),
      },
      propertyRegistryPuzzleHash: b32('77'),
      registryInnerPuzzleHex: '0xff80',
      registeredIds: [],
    });

    const result = await service.executeMint(proposal());

    expect(result.kind).toBe('proposal-context-mismatch');
    expect(wallet.signSpendBundle).not.toHaveBeenCalled();
  });

  it('stops when governance is not awaiting execution', async () => {
    tracker.getAwaitingExecuteInputs.and.resolveTo(null);
    const result = await service.executeMint(proposal());
    expect(result).toEqual({ kind: 'tracker-not-awaiting-execute' });
    expect(wallet.signSpendBundle).not.toHaveBeenCalled();
  });

  function proposal() {
    return {
      id: 'mint-draft-1',
      owner_pubkey: '0x1111111111111111111111111111111111111111',
      state: 'PASSED' as const,
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
        eve_inner_puzhash: b32('51'),
        deed_full_puzhash: b32('52'),
        proposal_hash: b32('53'),
      },
      on_chain: {
        proposal_tracker_coin_id: proposalLauncherId,
        proposal_singleton_launcher_id: proposalLauncherId,
        sgt_lock_coin_id: b32('55'),
        deed_launcher_id: deedLauncherId,
        property_registry_coin_id: registryCoinId,
        property_registry_puzzle_hash: b32('77'),
        published_bundle_id: b32('57'),
        executed_bundle_id: null,
      },
      vote_tally: 5000,
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
          property_registry_puzzle_hash: b32('77'),
          property_registry_coin_id: registryCoinId,
          owner_member_hash: b32('71'),
          gov_member_hash: b32('72'),
          proposal_data_hash: b32('70'),
          metadata_root: b32('73'),
          metadata_anchor_id: b32('74'),
        },
      },
    };
  }

  function trackerInputs() {
    return {
      trackerCoin: { parentCoinInfo: b32('01'), puzzleHash: b32('02'), amount: 1 },
      trackerInnerPuzzleHex: '0xff80',
      trackerLauncherId: b32('03'),
      lineageProof: { parentName: b32('04'), innerPuzzleHash: b32('05'), amount: 1 },
      proposalHash: b32('53'),
      bill: {
        kind: 'MINT' as const,
        deedFullPuzzleHash: b32('52'),
        propertyIdCanon: canonicalPropertyIdHash('TX-AUSTIN-001'),
        propertyRegistryPuzzleHash: b32('77'),
      },
      deadlineSeconds: 1_700_000_678n,
    };
  }

  function singletonLineage(launcherId: string): any {
    return {
      launcherId,
      launcherCoinId: launcherId,
      launcher: {
        coin: { parent_coin_info: b32('a1'), puzzle_hash: b32('a2'), amount: 1 },
      },
      nodes: [
        {
          coinId: launcherId,
          parentCoinId: b32('a1'),
          puzzleHash: b32('a2'),
          amount: 1,
          confirmedBlockIndex: 1,
          spentBlockIndex: 2,
          isLauncher: true,
        },
        {
          coinId: b32(launcherId === didLauncherId ? 'b1' : 'b2'),
          parentCoinId: launcherId,
          puzzleHash: b32(launcherId === didLauncherId ? 'c1' : 'c2'),
          amount: 1,
          confirmedBlockIndex: 2,
          spentBlockIndex: null,
          isLauncher: false,
        },
      ],
    };
  }
});

function coin(parentCoinInfo: string, puzzleHash: string) {
  return { parentCoinInfo, puzzleHash, amount: 1n };
}

function spend(byte: string): UnsignedCoinSpend {
  return {
    coin: coin(b32(byte), b32(byte)),
    puzzleReveal: `0xff${byte}`,
    solution: '0xff80',
  };
}

function b32(byte: string): string {
  return '0x' + byte.repeat(32);
}
