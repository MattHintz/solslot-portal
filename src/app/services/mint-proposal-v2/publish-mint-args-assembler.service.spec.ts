/**
 * Unit tests for {@link PublishMintArgsAssemblerService} (Phase 4f.1b).
 *
 * The assembler is pure (no chain / wallet / WASM), so these tests
 * construct it directly and assert the deterministic draft + protocol
 * context → {@link PublishMintArgs} mapping, plus every guard branch.
 */
import { MintProposalResponse } from '../admin-api.service';
import { environment } from '../../../environments/environment';

import {
  AssemblePublishArgsInput,
  MintPublishProtocolContext,
  PublishMintArgsAssemblerService,
} from './publish-mint-args-assembler.service';

// ── Fixtures ────────────────────────────────────────────────────────────────

const HEX32_A = '0x' + 'a1'.repeat(32);
const HEX32_ROYALTY = '0x' + 'a2'.repeat(32);
const HEX32_OWNER = '0x' + 'a6'.repeat(32);
const ZERO32 = '0x' + '0'.repeat(64);
const PROPERTY_ID_CANON =
  '0x37bd13f75d6f94c3ff0b42608163f0086e6ac95eab55a42d7cb0cd4218a7b6fd';
const COLLECTION_ID_CANON =
  '0xf618a1106b08dec32255847313c26363d359794b7dcfdf8242e1dd4b9dec0de6';

const VALID_CTX: MintPublishProtocolContext = {
  protocolDidSingletonStructHex: '0xffaa',
  protocolDidPuzhash: '0x' + 'a3'.repeat(32),
  p2PoolModHash: '0x' + 'a4'.repeat(32),
  p2VaultModHash: '0x' + 'a5'.repeat(32),
  propertyRegistryPuzzleHash: '0x' + 'a7'.repeat(32),
};

function makeDraft(overrides: Partial<MintProposalResponse> = {}): MintProposalResponse {
  return {
    id: 'draft-123',
    owner_pubkey: '0x' + '0e'.repeat(20),
    state: 'DRAFT',
    par_value: 250_000_000_000,
    asset_class: 'RWA-RE-RES',
    property_id: '123 MAIN ST',
    collection_id: '123 MAIN ST COLLECTION',
    share_ppm: 1_000_000,
    jurisdiction: 'US-CA',
    royalty_puzhash: HEX32_ROYALTY,
    royalty_bps: 250,
    computed: {
      smart_deed_inner_puzhash: null,
      eve_inner_puzhash: null,
      deed_full_puzhash: null,
      proposal_hash: null,
    },
    on_chain: {
      proposal_tracker_coin_id: null,
      pgt_lock_coin_id: null,
      deed_launcher_id: null,
      published_bundle_id: null,
      executed_bundle_id: null,
    },
    vote_tally: 0,
    quorum_required: 5_000,
    deadline: null,
    timestamps: {
      created_at: 1_700_000_000,
      published_at: null,
      executed_at: null,
      minted_at: null,
    },
    off_chain_metadata: null,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<AssemblePublishArgsInput> = {},
): AssemblePublishArgsInput {
  return {
    draft: makeDraft(),
    ownerMemberHash: HEX32_OWNER,
    protocolContext: VALID_CTX,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PublishMintArgsAssemblerService', () => {
  let service: PublishMintArgsAssemblerService;

  beforeEach(() => {
    service = new PublishMintArgsAssemblerService();
  });

  it('assembles a complete PublishMintArgs from a draft + context', () => {
    const result = service.assemble(baseInput());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const { args } = result;

    // Draft-derived canonical values.
    expect(args.propertyIdCanon).toBe(PROPERTY_ID_CANON);
    expect(args.collectionIdCanon).toBe(COLLECTION_ID_CANON);
    expect(args.sharePpm).toBe(1_000_000);
    expect(args.parValueMojos).toBe(250_000_000_000n);
    expect(args.assetClass).toBe(1n);
    // Caller-supplied owner leaf passes through verbatim.
    expect(args.ownerMemberHash).toBe(HEX32_OWNER);

    // Draft-derived fields.
    expect(args.royaltyPuzhash).toBe(HEX32_ROYALTY);
    expect(args.royaltyBps).toBe(250);
    expect(args.quorumThreshold).toBe(5_000);
    expect(args.proposalId).toBe('draft-123');

    // Protocol context threaded through from the override.
    expect(args.protocolDidSingletonStructHex).toBe(
      VALID_CTX.protocolDidSingletonStructHex,
    );
    expect(args.protocolDidPuzhash).toBe(VALID_CTX.protocolDidPuzhash);
    expect(args.p2PoolModHash).toBe(VALID_CTX.p2PoolModHash);
    expect(args.p2VaultModHash).toBe(VALID_CTX.p2VaultModHash);
    expect(args.propertyRegistryPuzzleHash).toBe(
      VALID_CTX.propertyRegistryPuzzleHash,
    );
  });

  it('UTF-8 encodes the jurisdiction string to 0x-hex', () => {
    const result = service.assemble(baseInput());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    // "US-CA" == 0x55 53 2d 43 41 — matches the Python fixture b"US-CA".
    expect(result.args.jurisdictionHex).toBe('0x55532d4341');
  });

  it('defaults govMemberHash to 32 zero bytes', () => {
    const result = service.assemble(baseInput());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.args.govMemberHash).toBe(ZERO32);
  });

  it('defaults first-vote + voting-window to the env governance mirrors', () => {
    const result = service.assemble(baseInput());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.args.firstVoteAmount).toBe(
      environment.populisProtocol.governanceMinProposalStake,
    );
    expect(result.args.votingWindowSeconds).toBe(
      environment.populisProtocol.governanceVotingWindowSeconds,
    );
  });

  it('honours explicit first-vote, voting-window, gov-hash, and nowSeconds', () => {
    const result = service.assemble(
      baseInput({
        firstVoteAmount: 42,
        votingWindowSeconds: 600,
        govMemberHash: HEX32_A,
        nowSeconds: 1_234,
      }),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.args.firstVoteAmount).toBe(42);
    expect(result.args.votingWindowSeconds).toBe(600);
    expect(result.args.govMemberHash).toBe(HEX32_A);
    expect(result.args.nowSeconds).toBe(1_234);
  });

  it('omits nowSeconds when the caller does not supply it', () => {
    const result = service.assemble(baseInput());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect('nowSeconds' in result.args).toBe(false);
  });

  describe('missing protocol context', () => {
    it('reports every empty context field', () => {
      const result = service.assemble(
        baseInput({
          protocolContext: {
            protocolDidSingletonStructHex: '',
            protocolDidPuzhash: '   ',
            p2PoolModHash: '',
            p2VaultModHash: VALID_CTX.p2VaultModHash,
            propertyRegistryPuzzleHash: '',
          },
        }),
      );
      expect(result.kind).toBe('missing-protocol-context');
      if (result.kind !== 'missing-protocol-context') return;
      expect(result.missing).toEqual([
        'protocolDidSingletonStructHex',
        'protocolDidPuzhash',
        'p2PoolModHash',
        'propertyRegistryPuzzleHash',
      ]);
    });
  });

  describe('invalid input guards', () => {
    const cases: Array<[string, Partial<AssemblePublishArgsInput>, string]> = [
      [
        'ownerMemberHash not 32 bytes',
        { ownerMemberHash: '0x1234' },
        'owner-member-hash-must-be-32-bytes',
      ],
      [
        'gov member hash override not 32 bytes',
        { govMemberHash: '0xbad' },
        'gov-member-hash-must-be-32-bytes',
      ],
      [
        'par value zero',
        { draft: makeDraft({ par_value: 0 }) },
        'par-value-must-be-positive',
      ],
      [
        'unknown asset class',
        { draft: makeDraft({ asset_class: 'RWA-SPACEPORT' }) },
        'asset-class-unknown',
      ],
      [
        'first-vote amount zero',
        { firstVoteAmount: 0 },
        'first-vote-amount-must-be-positive',
      ],
      [
        'voting window zero',
        { votingWindowSeconds: 0 },
        'voting-window-must-be-positive',
      ],
    ];

    for (const [name, override, reason] of cases) {
      it(`rejects: ${name}`, () => {
        const result = service.assemble(baseInput(override));
        expect(result.kind).toBe('invalid-input');
        if (result.kind !== 'invalid-input') return;
        expect(result.reason).toBe(reason);
      });
    }

    it('rejects a draft with a malformed royalty puzhash', () => {
      const result = service.assemble(
        baseInput({ draft: makeDraft({ royalty_puzhash: '0xnothex' }) }),
      );
      expect(result.kind).toBe('invalid-input');
      if (result.kind !== 'invalid-input') return;
      expect(result.reason).toBe('royalty-puzhash-must-be-32-bytes');
    });

    it('rejects malformed property registry puzzle hash context', () => {
      const result = service.assemble(
        baseInput({
          protocolContext: {
            ...VALID_CTX,
            propertyRegistryPuzzleHash: '0x1234',
          },
        }),
      );
      expect(result.kind).toBe('invalid-input');
      if (result.kind !== 'invalid-input') return;
      expect(result.reason).toBe('property-registry-puzzle-hash-must-be-32-bytes');
    });

    it('rejects a draft with a negative royalty_bps', () => {
      const result = service.assemble(
        baseInput({ draft: makeDraft({ royalty_bps: -5 }) }),
      );
      expect(result.kind).toBe('invalid-input');
      if (result.kind !== 'invalid-input') return;
      expect(result.reason).toBe('royalty-bps-must-be-non-negative-integer');
    });

    it('rejects a draft with a negative quorum_required', () => {
      const result = service.assemble(
        baseInput({ draft: makeDraft({ quorum_required: -1 }) }),
      );
      expect(result.kind).toBe('invalid-input');
      if (result.kind !== 'invalid-input') return;
      expect(result.reason).toBe('quorum-required-must-be-non-negative-integer');
    });
  });
});
