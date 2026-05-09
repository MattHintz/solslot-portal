import { TestBed } from '@angular/core/testing';

import { MintDraftStorageService } from './mint-draft-storage.service';
import { ProposeMintRequest } from './admin-api.service';

const BASE_REQUEST: ProposeMintRequest = {
  par_value: 1_000_000,
  asset_class: 'RWA-RE-RES',
  property_id: ' us-tx-travis-9001 ',
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
    expect(service.get(draft.id)?.property_id).toBe('US-TX-TRAVIS-9001');
  });

  it('rejects property_id that becomes empty after trimming', () => {
    expect(() =>
      service.create({ ...BASE_REQUEST, property_id: '   ' }, '0xAdmin'),
    ).toThrowError(/property_id must be non-empty/);
  });
});
