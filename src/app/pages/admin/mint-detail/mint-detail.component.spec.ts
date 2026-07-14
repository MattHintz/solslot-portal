import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { MintProposalResponse } from '../../../services/admin-api.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { Eip712LeafHashService } from '../../../services/eip712-leaf-hash.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { MintDraftStorageService } from '../../../services/mint-draft-storage.service';
import {
  MintProposalV2PublishRunnerService,
  PublishMintArgs,
  PublishRunResult,
} from '../../../services/mint-proposal-v2/mint-proposal-v2-publish-runner.service';
import {
  MintProposalV2ExecuteRunnerService,
} from '../../../services/mint-proposal-v2/mint-proposal-v2-execute-runner.service';
import { MintProposalChainStateService } from '../../../services/mint-proposal-v2/mint-proposal-chain-state.service';
import { PropertyRegistryRegistrationMaterialService } from '../../../services/mint-proposal-v2/property-registry-registration-material.service';
import { PropertyRegistryRegistrationSpend } from '../../../services/mint-proposal-v2/mint-publish-spend-builder.service';
import {
  canonicalCollectionIdHash,
  canonicalPropertyIdHash,
} from '../../../utils/mint-property-id';
import { environment } from '../../../../environments/environment';
import { MintDetailComponent } from './mint-detail.component';

describe('MintDetailComponent publish flow', () => {
  let fixture: ComponentFixture<MintDetailComponent>;
  let component: MintDetailComponent;
  let drafts: jasmine.SpyObj<
    Pick<MintDraftStorageService, 'get' | 'markPublished'>
  >;
  let registryMaterial: jasmine.SpyObj<
    Pick<PropertyRegistryRegistrationMaterialService, 'build'>
  >;
  let publishRunner: jasmine.SpyObj<
    Pick<MintProposalV2PublishRunnerService, 'publishMint'>
  >;
  let executeRunner: jasmine.SpyObj<
    Pick<MintProposalV2ExecuteRunnerService, 'executeMint'>
  >;
  let chainState: jasmine.SpyObj<Pick<MintProposalChainStateService, 'check'>>;

  const originalProtocol = { ...environment.solslotProtocol };
  const ownerAddress = '0x1111111111111111111111111111111111111111';
  const proposalId = 'mint-draft-1';
  const registryLauncherId = b32('a4');
  const registryPuzzleHash = b32('19');
  const ownerMemberHash = b32('aa');
  const registrySpend: PropertyRegistryRegistrationSpend = {
    coin: {
      parentCoinInfo: b32('20'),
      puzzleHash: registryPuzzleHash,
      amount: 1n,
    },
    puzzleReveal: '0xff01',
    solution: '0xff80',
    announcementId: b32('21'),
    newInnerPuzzleHash: b32('22'),
    newRegisteredIdsRoot: b32('23'),
    aggSigMeMessage: b32('24'),
  };

  beforeEach(async () => {
    Object.assign(environment.solslotProtocol, {
      ...originalProtocol,
      propertyRegistryLauncherId: registryLauncherId,
      propertyRegistryCurrentPuzzleHash: '',
      protocolDidSingletonStructHex: '0xff80',
      protocolDidPuzhash: b32('30'),
      p2PoolModHash: b32('31'),
      p2VaultModHash: b32('32'),
      governanceMinProposalStake: 10_000,
      governanceVotingWindowSeconds: 300,
    });

    drafts = jasmine.createSpyObj('MintDraftStorageService', [
      'get',
      'markPublished',
    ]);
    registryMaterial = jasmine.createSpyObj(
      'PropertyRegistryRegistrationMaterialService',
      ['build'],
    );
    publishRunner = jasmine.createSpyObj(
      'MintProposalV2PublishRunnerService',
      ['publishMint'],
    );
    executeRunner = jasmine.createSpyObj(
      'MintProposalV2ExecuteRunnerService',
      ['executeMint'],
    );
    chainState = jasmine.createSpyObj('MintProposalChainStateService', [
      'check',
    ]);

    drafts.get.and.returnValue(draft());
    drafts.markPublished.and.returnValue(publishedDraft());
    registryMaterial.build.and.resolveTo({
      kind: 'ok',
      spend: registrySpend,
      propertyRegistryPuzzleHash: registryPuzzleHash,
      registryInnerPuzzleHex: '0xff80',
      registeredIds: [],
    });
    publishRunner.publishMint.and.resolveTo(submittedResult());
    chainState.check.and.resolveTo({
      kind: 'local-only',
      reason: 'missing-proposal-launcher-id',
    });

    await TestBed.configureTestingModule({
      imports: [MintDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: proposalId }) },
          },
        },
        {
          provide: AdminSessionService,
          useValue: {
            isAuthenticated: () => true,
            subject: () => ownerAddress,
          },
        },
        { provide: MintDraftStorageService, useValue: drafts },
        {
          provide: PropertyRegistryRegistrationMaterialService,
          useValue: registryMaterial,
        },
        { provide: MintProposalV2PublishRunnerService, useValue: publishRunner },
        { provide: MintProposalV2ExecuteRunnerService, useValue: executeRunner },
        { provide: MintProposalChainStateService, useValue: chainState },
        { provide: EvmWalletService, useValue: {} },
        { provide: Eip712LeafHashService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MintDetailComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
    component.ownerMemberHashInput.set(ownerMemberHash);
    component.firstVoteAmountInput.set('12345');
    component.votingWindowSecondsInput.set('678');
  });

  afterEach(() => {
    Object.assign(environment.solslotProtocol, originalProtocol);
  });

  async function renderProposal(proposal: MintProposalResponse): Promise<string> {
    drafts.get.and.returnValue(proposal);
    await component.reload();
    await fixture.whenStable();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('assembles registry-backed publish args, calls the runner, and persists submitted metadata', async () => {
    await component.publish();

    const propertyIdCanon = canonicalPropertyIdHash(draft().property_id);
    const collectionIdCanon = canonicalCollectionIdHash(draft().collection_id);
    expect(registryMaterial.build).toHaveBeenCalledOnceWith({
      registryLauncherId,
      registryGovPubkey: originalProtocol.propertyRegistryGovPubkey,
      propertyIdCanon,
    });
    expect(publishRunner.publishMint).toHaveBeenCalledTimes(1);

    const args = publishRunner.publishMint.calls.mostRecent().args[0] as PublishMintArgs;
    expect(args).toEqual(jasmine.objectContaining({
      proposalId,
      propertyIdCanon,
      collectionIdCanon,
      sharePpm: 1_000_000,
      parValueMojos: 125_000n,
      assetClass: 1n,
      jurisdictionHex: '0x55532d5458',
      royaltyPuzhash: b32('40'),
      royaltyBps: 250,
      quorumThreshold: 5000,
      ownerMemberHash,
      propertyRegistryPuzzleHash: registryPuzzleHash,
      propertyRegistryCoinSpend: registrySpend,
      firstVoteAmount: 12345n,
      votingWindowSeconds: 678n,
    }));

    expect(drafts.markPublished).toHaveBeenCalledOnceWith(proposalId, {
      smartDeedInnerPuzhash: b32('50'),
      eveInnerPuzhash: b32('51'),
      deedFullPuzhash: b32('52'),
      proposalHash: b32('53'),
      proposalTrackerCoinId: b32('54'),
      sgtLockCoinId: b32('65'),
      deedLauncherId: b32('55'),
      publishedBundleId: b32('60'),
      propertyRegistryPuzzleHash: registryPuzzleHash,
      deadline: 1_700_000_678,
    });
    expect(component.publishResult()?.kind).toBe('submitted');
    expect(component.proposal()?.state).toBe('PROPOSED');
    expect(chainState.check.calls.mostRecent().args[0].state).toBe('PROPOSED');
  });

  it('does not call the runner when the property-registry co-spend cannot be built', async () => {
    registryMaterial.build.and.resolveTo({
      kind: 'material-build-failed',
      error: 'registry witness drift',
    });

    await component.publish();

    expect(publishRunner.publishMint).not.toHaveBeenCalled();
    expect(drafts.markPublished).not.toHaveBeenCalled();
    expect(component.previewError()).toContain(
      'Could not build property-registry co-spend: registry witness drift',
    );
  });

  it('renders distinct lifecycle next steps for PASSED, EXECUTED, and MINTED proposals', async () => {
    const cases: Array<{
      proposal: MintProposalResponse;
      notation: string;
      nextStep: string;
    }> = [
      {
        proposal: proposalWithState('PASSED'),
        notation: 'GC:PASSED',
        nextStep: 'Execute the passed mint proposal.',
      },
      {
        proposal: proposalWithState('EXECUTED', {
          on_chain: {
            ...publishedDraft().on_chain,
            executed_bundle_id: b32('66'),
          },
          timestamps: {
            ...publishedDraft().timestamps,
            executed_at: 1_700_000_200,
          },
        }),
        notation: 'OP:EXECUTED',
        nextStep: 'Wait for chain confirmation of the minted deed launcher.',
      },
      {
        proposal: proposalWithState('MINTED', {
          on_chain: {
            ...publishedDraft().on_chain,
            deed_launcher_id: b32('55'),
            executed_bundle_id: b32('66'),
          },
          timestamps: {
            ...publishedDraft().timestamps,
            executed_at: 1_700_000_200,
            minted_at: 1_700_000_300,
          },
        }),
        notation: 'OP:MINTED',
        nextStep: 'Create or verify the protocol offer artifact through the admin/API purchase intent path.',
      },
    ];

    for (const c of cases) {
      const text = await renderProposal(c.proposal);
      expect(text).toContain(c.notation);
      expect(text).toContain(c.nextStep);
    }
  });

  it('shows minted offer-artifact readiness diagnostics when deed launcher evidence exists', async () => {
    const artifactHash = 'sha256:' + 'ab'.repeat(32);
    const text = await renderProposal(
      proposalWithState('MINTED', {
        on_chain: {
          ...publishedDraft().on_chain,
          deed_launcher_id: b32('55'),
          executed_bundle_id: b32('66'),
        },
        timestamps: {
          ...publishedDraft().timestamps,
          executed_at: 1_700_000_200,
          minted_at: 1_700_000_300,
        },
        off_chain_metadata: {
          protocolOffer: {
            artifactId: 'protocol-offer:pi_123',
            artifactHash,
          },
        },
      }),
    );

    expect(text).toContain('OP:MINTED');
    expect(text).toContain('Minted deed plus offer-artifact readiness is available for member purchase flow.');
    expect(text).toContain('admin/API purchase intent');
    expect(text).toContain('protocol-offer:pi_123');
    expect(text).toContain(artifactHash);
    expect(text).toContain(b32('55'));
  });

  it('does not show offer-ready or acceptance language for FAILED proposals', async () => {
    const text = await renderProposal(proposalWithState('FAILED'));

    expect(text).toContain('GC:FAILED');
    expect(text).toContain('No deed or member purchase artifact will be produced.');
    expect(text).not.toContain('OP:OFFER_READY');
    expect(text).not.toContain('offer-ready');
    expect(text).not.toContain('admin/API purchase intent');
  });

  function draft(): MintProposalResponse {
    return {
      id: proposalId,
      owner_pubkey: ownerAddress,
      state: 'DRAFT',
      par_value: 125_000,
      asset_class: 'RWA-RE-RES',
      property_id: ' tx-austin-001 ',
      collection_id: 'TX-AUSTIN-SFR',
      share_ppm: 1_000_000,
      jurisdiction: 'US-TX',
      royalty_puzhash: b32('40'),
      royalty_bps: 250,
      computed: {
        smart_deed_inner_puzhash: null,
        eve_inner_puzhash: null,
        deed_full_puzhash: null,
        proposal_hash: null,
      },
      on_chain: {
        proposal_tracker_coin_id: null,
        sgt_lock_coin_id: null,
        deed_launcher_id: null,
        published_bundle_id: null,
        executed_bundle_id: null,
      },
      vote_tally: 0,
      quorum_required: 5000,
      deadline: null,
      timestamps: {
        created_at: 1_700_000_000,
        published_at: null,
        executed_at: null,
        minted_at: null,
      },
      off_chain_metadata: { fixture: true },
    };
  }

  function proposalWithState(
    state: MintProposalResponse['state'],
    overrides: Partial<MintProposalResponse> = {},
  ): MintProposalResponse {
    const base = publishedDraft();
    return {
      ...base,
      ...overrides,
      state,
      computed: {
        ...base.computed,
        ...(overrides.computed ?? {}),
      },
      on_chain: {
        ...base.on_chain,
        ...(overrides.on_chain ?? {}),
      },
      timestamps: {
        ...base.timestamps,
        ...(overrides.timestamps ?? {}),
      },
    };
  }

  function publishedDraft(): MintProposalResponse {
    return {
      ...draft(),
      state: 'PROPOSED',
      computed: {
        smart_deed_inner_puzhash: b32('50'),
        eve_inner_puzhash: b32('51'),
        deed_full_puzhash: b32('52'),
        proposal_hash: b32('53'),
      },
      on_chain: {
        proposal_tracker_coin_id: b32('54'),
        sgt_lock_coin_id: b32('65'),
        deed_launcher_id: b32('55'),
        published_bundle_id: b32('60'),
        executed_bundle_id: null,
      },
      deadline: 1_700_000_678,
      timestamps: {
        ...draft().timestamps,
        published_at: 1_700_000_100,
      },
    };
  }

  function submittedResult(): PublishRunResult {
    return {
      kind: 'submitted',
      apiResponse: {
        pushed: true,
        status: 'SUCCESS',
        spendBundleId: b32('60'),
        proposalId,
      },
      signedBundle: {
        coinSpends: [],
        aggregatedSignature: '0x' + 'ab'.repeat(96),
      },
      artifacts: {
        smartDeedInnerPuzhash: b32('50'),
        eveInnerPuzhash: b32('51'),
        deedFullPuzhash: b32('52'),
        proposalHash: b32('53'),
        proposalSingletonLauncherId: b32('54'),
        deedLauncherId: b32('55'),
        proposalDataHash: b32('56'),
        billOpProgramHex: '0xff80',
        billOpProgramHash: b32('57'),
        deedSingletonStructProgramHex: '0xff80',
        deedSingletonStructProgramHash: b32('58'),
        proposalSingletonStructProgramHex: '0xff80',
        proposalSingletonStructProgramHash: b32('59'),
      },
      xchCoinId: b32('61'),
      pickedSgtCoin: {
        parentCoinInfo: b32('62'),
        puzzleHash: b32('63'),
        amount: 12345,
        confirmedBlockIndex: 100,
      },
      sgtLockCoinId: b32('65'),
      votingDeadline: 1_700_000_678n,
      voterInnerPuzzleHash: b32('64'),
    };
  }

});

function b32(byteHex: string): string {
  return '0x' + byteHex.repeat(32);
}
