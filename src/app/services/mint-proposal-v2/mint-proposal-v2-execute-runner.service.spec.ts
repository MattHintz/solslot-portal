import { TestBed } from '@angular/core/testing';

import { MintProposalResponse } from '../admin-api.service';
import {
  CommitteeApiService,
  CommitteeVoteApiResponse,
  SpendBundleJson,
} from '../committee-api.service';
import { GovernanceTrackerReaderService } from '../governance-tracker-reader.service';
import {
  SgtVoteSpendBuilderService,
  UnsignedCoinSpendHex,
} from '../sgt-driver/sgt-vote-spend-builder.service';
import { canonicalPropertyIdHash } from '../../utils/mint-property-id';

import {
  MintProposalV2ExecuteRunnerService,
} from './mint-proposal-v2-execute-runner.service';

describe('MintProposalV2ExecuteRunnerService', () => {
  let service: MintProposalV2ExecuteRunnerService;
  let tracker: jasmine.SpyObj<
    Pick<GovernanceTrackerReaderService, 'getAwaitingExecuteInputs'>
  >;
  let builder: jasmine.SpyObj<Pick<SgtVoteSpendBuilderService, 'buildTrackerExecuteCoinSpend'>>;
  let api: jasmine.SpyObj<Pick<CommitteeApiService, 'castVote'>>;

  beforeEach(() => {
    tracker = jasmine.createSpyObj('GovernanceTrackerReaderService', [
      'getAwaitingExecuteInputs',
    ]);
    builder = jasmine.createSpyObj('SgtVoteSpendBuilderService', [
      'buildTrackerExecuteCoinSpend',
    ]);
    api = jasmine.createSpyObj('CommitteeApiService', ['castVote']);

    tracker.getAwaitingExecuteInputs.and.resolveTo(trackerInputs());
    builder.buildTrackerExecuteCoinSpend.and.returnValue(trackerSpend());
    api.castVote.and.resolveTo(apiAccepted());

    TestBed.configureTestingModule({
      providers: [
        MintProposalV2ExecuteRunnerService,
        { provide: GovernanceTrackerReaderService, useValue: tracker },
        { provide: SgtVoteSpendBuilderService, useValue: builder },
        { provide: CommitteeApiService, useValue: api },
      ],
    });
    service = TestBed.inject(MintProposalV2ExecuteRunnerService);
  });

  it('builds and forwards a one-spend tracker EXECUTE bundle with an empty aggregate signature', async () => {
    const result = await service.executeMint(proposal());

    expect(builder.buildTrackerExecuteCoinSpend).toHaveBeenCalledOnceWith({
      trackerCoin: trackerInputs().trackerCoin,
      trackerInnerPuzzleHex: trackerInputs().trackerInnerPuzzleHex,
      trackerLauncherId: trackerInputs().trackerLauncherId,
      lineageProof: trackerInputs().lineageProof,
    });
    const bundle = api.castVote.calls.mostRecent().args[0] as SpendBundleJson;
    expect(bundle.coin_spends).toEqual([
      {
        coin: {
          parent_coin_info: b32('01'),
          puzzle_hash: b32('02'),
          amount: 1,
        },
        puzzle_reveal: '0xff01',
        solution: '0xff80',
      },
    ]);
    expect(bundle.aggregated_signature).toBe('0x' + 'c0' + '00'.repeat(95));
    expect(api.castVote.calls.mostRecent().args[1]).toBe(b32('53'));
    expect(result.kind).toBe('submitted');
  });

  it('stops before building when the tracker is not executable', async () => {
    tracker.getAwaitingExecuteInputs.and.resolveTo(null);

    const result = await service.executeMint(proposal());

    expect(result).toEqual({ kind: 'tracker-not-awaiting-execute' });
    expect(builder.buildTrackerExecuteCoinSpend).not.toHaveBeenCalled();
    expect(api.castVote).not.toHaveBeenCalled();
  });

  it('rejects a live tracker MINT payload that does not match local publish context', async () => {
    tracker.getAwaitingExecuteInputs.and.resolveTo({
      ...trackerInputs(),
      bill: {
        ...trackerInputs().bill,
        propertyRegistryPuzzleHash: b32('99'),
      },
    });

    const result = await service.executeMint(proposal());

    expect(result).toEqual({
      kind: 'tracker-mismatch',
      reason: 'propertyRegistryPuzzleHash',
      expected: b32('77'),
      live: b32('99'),
    });
    expect(builder.buildTrackerExecuteCoinSpend).not.toHaveBeenCalled();
    expect(api.castVote).not.toHaveBeenCalled();
  });

  function proposal(): MintProposalResponse {
    return {
      id: 'mint-draft-1',
      owner_pubkey: '0x1111111111111111111111111111111111111111',
      state: 'PASSED',
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
        proposal_tracker_coin_id: b32('54'),
        sgt_lock_coin_id: b32('55'),
        deed_launcher_id: b32('56'),
        published_bundle_id: b32('57'),
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
          property_registry_puzzle_hash: b32('77'),
        },
      },
    };
  }

  function trackerInputs() {
    const propertyIdCanon = canonicalPropertyIdHash('TX-AUSTIN-001');
    return {
      trackerCoin: {
        parentCoinInfo: b32('01'),
        puzzleHash: b32('02'),
        amount: 1,
      },
      trackerInnerPuzzleHex: '0xff80',
      trackerLauncherId: b32('03'),
      lineageProof: {
        parentName: b32('04'),
        innerPuzzleHash: b32('05'),
        amount: 1,
      },
      proposalHash: b32('53'),
      bill: {
        kind: 'MINT' as const,
        deedFullPuzzleHash: b32('52'),
        propertyIdCanon,
        propertyRegistryPuzzleHash: b32('77'),
      },
      deadlineSeconds: 1_700_000_678n,
    };
  }

  function trackerSpend(): UnsignedCoinSpendHex {
    return {
      coin: {
        parentCoinInfo: b32('01'),
        puzzleHash: b32('02'),
        amount: 1n,
      },
      puzzleReveal: '0xff01',
      solution: '0xff80',
    };
  }

  function apiAccepted(): CommitteeVoteApiResponse {
    return {
      pushed: true,
      status: 'SUCCESS',
      spendBundleId: b32('aa'),
      proposalId: b32('53'),
    };
  }
});

function b32(byte: string): string {
  return '0x' + byte.repeat(32);
}
