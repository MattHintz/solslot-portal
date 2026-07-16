import { TestBed } from '@angular/core/testing';

import { MintDraftStorageService } from './mint-draft-storage.service';
import { ProposeMintRequest } from './admin-api.service';

const BASE_REQUEST: ProposeMintRequest = {
  par_value: 1_000_000,
  asset_class: 'RWA-RE-RES',
  property_id: ' us-tx-travis-9001 ',
  collection_id: ' us-tx-travis-sfr ',
  share_ppm: 750_000,
  jurisdiction: 'US-TX-Travis',
  royalty_puzhash: '0x' + 'aa'.repeat(32),
  royalty_bps: 200,
  quorum_required: 500_000,
};

describe('MintDraftStorageService', () => {
  let service: MintDraftStorageService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(MintDraftStorageService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('canonicalises property_id before storing browser-local drafts', () => {
    const draft = service.create(BASE_REQUEST, '0xAdmin');
    expect(draft.property_id).toBe('US-TX-TRAVIS-9001');
    expect(draft.collection_id).toBe('US-TX-TRAVIS-SFR');
    expect(draft.share_ppm).toBe(750_000);
    expect(service.get(draft.id)?.property_id).toBe('US-TX-TRAVIS-9001');
  });

  it('rejects property_id that becomes empty after trimming', () => {
    expect(() => service.create({ ...BASE_REQUEST, property_id: '   ' }, '0xAdmin')).toThrowError(
      /property_id must be non-empty/,
    );
  });

  it('rejects collection_id that becomes empty after trimming', () => {
    expect(() => service.create({ ...BASE_REQUEST, collection_id: '   ' }, '0xAdmin')).toThrowError(
      /collection_id must be non-empty/,
    );
  });

  it('marks a draft published with deterministic on-chain audit fields', () => {
    const draft = service.create(BASE_REQUEST, '0xAdmin');
    const updated = service.markPublished(draft.id, {
      smartDeedInnerPuzhash: '0x' + '01'.repeat(32),
      eveInnerPuzhash: '0x' + '02'.repeat(32),
      deedFullPuzhash: '0x' + '03'.repeat(32),
      proposalHash: '0x' + '04'.repeat(32),
      proposalTrackerCoinId: '0x' + '05'.repeat(32),
      proposalSingletonLauncherId: '0x' + '05'.repeat(32),
      sgtLockCoinId: '0x' + '06'.repeat(32),
      deedLauncherId: '0x' + '07'.repeat(32),
      publishedBundleId: '0x' + '08'.repeat(32),
      propertyRegistryPuzzleHash: '0x' + '09'.repeat(32),
      propertyRegistryCoinId: '0x' + '0a'.repeat(32),
      ownerMemberHash: '0x' + '0b'.repeat(32),
      govMemberHash: '0x' + '0c'.repeat(32),
      proposalDataHash: '0x' + '0d'.repeat(32),
      deadline: 1_700_001_000,
      publishedAt: 1_700_000_001,
    });

    expect(updated?.state).toBe('PROPOSED');
    expect(updated?.computed.proposal_hash).toBe('0x' + '04'.repeat(32));
    expect(updated?.on_chain.proposal_tracker_coin_id).toBe('0x' + '05'.repeat(32));
    expect(updated?.on_chain.proposal_singleton_launcher_id).toBe('0x' + '05'.repeat(32));
    expect(updated?.on_chain.property_registry_coin_id).toBe('0x' + '0a'.repeat(32));
    expect(updated?.on_chain.sgt_lock_coin_id).toBe('0x' + '06'.repeat(32));
    expect(updated?.on_chain.deed_launcher_id).toBe('0x' + '07'.repeat(32));
    expect(updated?.on_chain.published_bundle_id).toBe('0x' + '08'.repeat(32));
    expect(updated?.deadline).toBe(1_700_001_000);
    expect(updated?.timestamps.published_at).toBe(1_700_000_001);
    expect(updated?.off_chain_metadata).toEqual({
      publish_context: {
        property_registry_puzzle_hash: '0x' + '09'.repeat(32),
        property_registry_coin_id: '0x' + '0a'.repeat(32),
        owner_member_hash: '0x' + '0b'.repeat(32),
        gov_member_hash: '0x' + '0c'.repeat(32),
        proposal_data_hash: '0x' + '0d'.repeat(32),
      },
    });
    expect(service.get(draft.id)?.state).toBe('PROPOSED');
  });

  it('marks active published proposals executed locally', () => {
    const draft = service.create(BASE_REQUEST, '0xAdmin');
    service.markPublished(draft.id, {
      smartDeedInnerPuzhash: '0x' + '01'.repeat(32),
      eveInnerPuzhash: '0x' + '02'.repeat(32),
      deedFullPuzhash: '0x' + '03'.repeat(32),
      proposalHash: '0x' + '04'.repeat(32),
      proposalTrackerCoinId: '0x' + '05'.repeat(32),
      proposalSingletonLauncherId: '0x' + '05'.repeat(32),
      sgtLockCoinId: '0x' + '06'.repeat(32),
      deedLauncherId: '0x' + '07'.repeat(32),
      publishedBundleId: '0x' + '08'.repeat(32),
      propertyRegistryPuzzleHash: '0x' + '09'.repeat(32),
      propertyRegistryCoinId: '0x' + '0a'.repeat(32),
      ownerMemberHash: '0x' + '0b'.repeat(32),
      govMemberHash: '0x' + '0c'.repeat(32),
      proposalDataHash: '0x' + '0d'.repeat(32),
      deadline: 1_700_001_000,
    });

    const updated = service.markExecuted(draft.id, {
      executedBundleId: '0x' + '0a'.repeat(32),
      executedAt: 1_700_002_000,
    });

    expect(updated?.state).toBe('EXECUTED');
    expect(updated?.on_chain.executed_bundle_id).toBe('0x' + '0a'.repeat(32));
    expect(updated?.timestamps.executed_at).toBe(1_700_002_000);
    expect(service.get(draft.id)?.state).toBe('EXECUTED');
  });

  it('does not mark non-DRAFT proposals published through the local path', () => {
    const draft = service.create(BASE_REQUEST, '0xAdmin');
    service.cancel(draft.id);
    expect(() =>
      service.markPublished(draft.id, {
        smartDeedInnerPuzhash: '0x' + '01'.repeat(32),
        eveInnerPuzhash: '0x' + '02'.repeat(32),
        deedFullPuzhash: '0x' + '03'.repeat(32),
        proposalHash: '0x' + '04'.repeat(32),
        proposalTrackerCoinId: '0x' + '05'.repeat(32),
        proposalSingletonLauncherId: '0x' + '05'.repeat(32),
        sgtLockCoinId: '0x' + '06'.repeat(32),
        deedLauncherId: '0x' + '07'.repeat(32),
        publishedBundleId: '0x' + '08'.repeat(32),
        propertyRegistryPuzzleHash: '0x' + '09'.repeat(32),
        propertyRegistryCoinId: '0x' + '0a'.repeat(32),
        ownerMemberHash: '0x' + '0b'.repeat(32),
        govMemberHash: '0x' + '0c'.repeat(32),
        proposalDataHash: '0x' + '0d'.repeat(32),
        deadline: 1_700_001_000,
      }),
    ).toThrowError(/only DRAFT proposals/);
  });
});
