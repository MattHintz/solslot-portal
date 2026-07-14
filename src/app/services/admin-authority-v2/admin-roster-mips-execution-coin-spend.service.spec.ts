import { TestBed } from '@angular/core/testing';

import { coinId, hexToBytes } from '../../utils/chia-hash';
import { ChiaWasmService } from '../chia-wasm.service';
import { AdminAuthorityV2Service, bytesToHexPrefixed } from './admin-authority-v2.service';
import {
  AdminRosterMipsExecutionCoinSpendRequest,
  AdminRosterMipsExecutionCoinSpendService,
} from './admin-roster-mips-execution-coin-spend.service';

const RAW_MIPS_REVEAL = '0xa1';
const RAW_MIPS_SOLUTION = '0xa2';
const RAW_INNER_REVEAL = '0xa3';
const TOP_LAYER = '0xa4';
const FULL_PUZZLE_REVEAL = '0xf1';
const SINGLETON_SOLUTION = '0xf2';
const LIVE_PARENT = h('01');
const LIVE_PUZZLE_HASH = h('02');
const LIVE_AMOUNT = 1;
const LIVE_COIN_ID = coinId(LIVE_PARENT, LIVE_PUZZLE_HASH, LIVE_AMOUNT);
const LAUNCHER_ID = h('03');
const CURRENT_MIPS_HASH = h('04');
const MIPS_SOLUTION_HASH = h('05');
const CURRENT_INNER_HASH = h('06');
const CURRENT_ADMINS_HASH = h('07');
const NEW_ADMINS_HASH = h('08');
const PENDING_OPS_HASH = h('09');
const NEW_MIPS_ROOT_HASH = h('0a');
const ROSTER_UPDATE_BINDING_HASH = h('0b');
const NEW_STATE_HASH = h('0c');
const NEXT_INNER_PUZZLE_HASH = h('0d');
const NEXT_FULL_PUZZLE_HASH = h('0e');
const PUBKEY = '0x' + '11'.repeat(48);

class FakeProgram {
  constructor(
    readonly kind: string,
    private readonly opts: {
      atom?: Uint8Array;
      int?: bigint;
      listItems?: FakeProgram[];
      treeHash?: string;
      serialized?: string;
      clvm?: FakeClvm;
    } = {},
  ) {}

  treeHash(): Uint8Array {
    return hexToBytes(this.opts.treeHash ?? h('ff'));
  }

  serialize(): Uint8Array {
    return hexToBytes(this.opts.serialized ?? '0x80');
  }

  curry(): FakeProgram {
    return new FakeProgram('fullPuzzle', {
      treeHash: LIVE_PUZZLE_HASH,
      serialized: FULL_PUZZLE_REVEAL,
      clvm: this.opts.clvm,
    });
  }

  run(): { value: FakeProgram; cost: bigint } {
    const clvm = this.opts.clvm;
    if (!clvm) throw new Error('missing fake CLVM');
    return { value: clvm.conditionsProgram(), cost: clvm.cost };
  }

  toList(): FakeProgram[] | null {
    return this.opts.listItems ?? null;
  }

  toAtom(): Uint8Array {
    return this.opts.atom ?? new Uint8Array(0);
  }

  toInt(): bigint {
    return this.opts.int ?? 0n;
  }
}

class FakeClvm {
  cost = 123n;
  includeBadAggSigMessage = false;

  deserialize(bytes: Uint8Array): FakeProgram {
    const hex = bytesToHexPrefixed(bytes);
    if (hex === RAW_INNER_REVEAL) return new FakeProgram('innerPuzzle', { treeHash: CURRENT_INNER_HASH, serialized: RAW_INNER_REVEAL, clvm: this });
    if (hex === RAW_MIPS_REVEAL) return new FakeProgram('mipsPuzzle', { treeHash: CURRENT_MIPS_HASH, serialized: RAW_MIPS_REVEAL, clvm: this });
    if (hex === RAW_MIPS_SOLUTION) return new FakeProgram('mipsSolution', { treeHash: MIPS_SOLUTION_HASH, serialized: RAW_MIPS_SOLUTION, clvm: this });
    if (hex === TOP_LAYER) return new FakeProgram('singletonTopLayer', { clvm: this });
    return new FakeProgram('deserialized', { serialized: hex, clvm: this });
  }

  atom(value: Uint8Array): FakeProgram {
    return new FakeProgram('atom', { atom: value });
  }

  int(value: bigint): FakeProgram {
    return new FakeProgram('int', { int: value });
  }

  list(values: FakeProgram[]): FakeProgram {
    if (values.length === 3 && values[0].kind === 'int' && values[1].kind === 'list' && values[2].kind === 'int') {
      return new FakeProgram(`adminRecord${values[0].toInt()}`, { listItems: values });
    }
    if (values.length === 0) {
      return new FakeProgram('list', { listItems: values, treeHash: PENDING_OPS_HASH });
    }
    if (values.every((value) => value.kind.startsWith('adminRecord'))) {
      return new FakeProgram('list', { listItems: values, treeHash: values.length === 1 ? CURRENT_ADMINS_HASH : NEW_ADMINS_HASH });
    }
    if (values.length === 6) {
      return new FakeProgram('spendArgs', { listItems: values });
    }
    if (values.length === 4 && values[0].kind === 'int' && values[0].toInt() === 7n) {
      return new FakeProgram('innerSolution', { listItems: values });
    }
    if (values.length === 3 && values[2].kind === 'innerSolution') {
      return new FakeProgram('singletonSolution', { listItems: values, serialized: SINGLETON_SOLUTION });
    }
    return new FakeProgram('list', { listItems: values });
  }

  pair(first: FakeProgram, rest: FakeProgram): FakeProgram {
    return new FakeProgram('pair', { listItems: [first, rest] });
  }

  conditionsProgram(): FakeProgram {
    const announcement = new Uint8Array([0x53, 0x07, ...hexToBytes(NEW_STATE_HASH)]);
    const aggMessage = this.includeBadAggSigMessage ? h('ba') : ROSTER_UPDATE_BINDING_HASH;
    return new FakeProgram('conditions', {
      listItems: [
        new FakeProgram('condition', { listItems: [this.int(62n), this.atom(announcement)] }),
        new FakeProgram('condition', { listItems: [this.int(51n), this.atom(hexToBytes(NEXT_INNER_PUZZLE_HASH)), this.int(1n)] }),
        new FakeProgram('condition', { listItems: [this.int(73n), this.int(1n)] }),
        new FakeProgram('condition', { listItems: [this.int(50n), this.atom(hexToBytes(PUBKEY)), this.atom(hexToBytes(aggMessage))] }),
      ],
    });
  }
}

describe('AdminRosterMipsExecutionCoinSpendService', () => {
  let service: AdminRosterMipsExecutionCoinSpendService;
  let fakeClvm: FakeClvm;

  beforeEach(() => {
    fakeClvm = new FakeClvm();
    const wasm = jasmine.createSpyObj<ChiaWasmService>('ChiaWasmService', ['sdk']);
    wasm.sdk.and.returnValue({
      Clvm: function FakeClvmConstructor() {
        return fakeClvm;
      },
      Constants: {
        singletonTopLayerV11: () => hexToBytes(TOP_LAYER),
      },
    });
    const v2 = jasmine.createSpyObj<AdminAuthorityV2Service>('AdminAuthorityV2Service', [
      'computeSerializedProgramTreeHash',
    ]);
    v2.computeSerializedProgramTreeHash.and.callFake((hex: string) => {
      if (hex === RAW_MIPS_REVEAL) return CURRENT_MIPS_HASH;
      if (hex === RAW_MIPS_SOLUTION) return MIPS_SOLUTION_HASH;
      if (hex === RAW_INNER_REVEAL) return CURRENT_INNER_HASH;
      throw new Error(`unexpected serialized program: ${hex}`);
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: ChiaWasmService, useValue: wasm },
        { provide: AdminAuthorityV2Service, useValue: v2 },
      ],
    });
    service = TestBed.inject(AdminRosterMipsExecutionCoinSpendService);
  });

  it('executes the local MIPS path and emits an unsigned admin_authority_v2 CoinSpend candidate', () => {
    const result = service.build(validRequest());

    expect(result.ok).toBeTrue();
    expect(result.failures).toEqual([]);
    expect(result.candidate?.unsigned_admin_authority_v2_coin_spend).toEqual({
      coin: {
        parentCoinInfo: LIVE_PARENT,
        puzzleHash: LIVE_PUZZLE_HASH,
        amount: LIVE_AMOUNT,
      },
      puzzleReveal: FULL_PUZZLE_REVEAL,
      solution: SINGLETON_SOLUTION,
    });
    expect(result.candidate?.bounded_mips_execution_report.cost).toBe('123');
    expect(result.candidate?.bounded_mips_execution_report.create_puzzle_announcements).toEqual([
      '0x5307' + NEW_STATE_HASH.slice(2),
    ]);
    expect(result.candidate?.bounded_mips_execution_report.agg_sig_me_conditions[0].message).toBe(ROSTER_UPDATE_BINDING_HASH);
    expect(result.candidate?.unsigned_spend_bundle_candidate.coin_spends.length).toBe(1);
    expect(JSON.stringify(result.candidate?.unsigned_spend_bundle_candidate)).not.toContain('aggregatedSignature');
  });

  it('fails closed when full admin records are missing', () => {
    const request = validRequest();
    delete (request.rosterUpdateMaterial as Record<string, unknown>)['current_admin_records'];

    const result = service.build(request);

    expect(result.ok).toBeFalse();
    expect(result.candidate).toBeNull();
    expect(result.failures).toContain('roster_update_material.current_admin_records must be an array');
  });

  it('fails closed when execution conditions do not match the expected plan', () => {
    const request = validRequest();
    const plan = request.unsignedClvmConstructionPlan as Record<string, unknown>;
    const expected = plan['expected_conditions_summary'] as Record<string, unknown>;
    const continuation = expected['singleton_continuation'] as Record<string, unknown>;
    continuation['next_inner_puzzle_hash'] = h('99');

    const result = service.build(request);

    expect(result.ok).toBeFalse();
    expect(result.candidate).toBeNull();
    expect(result.failures).toContain('MIPS execution conditions must include expected singleton continuation CREATE_COIN');
  });

  it('rejects forbidden credential material without serializing a candidate', () => {
    const request = validRequest();
    (request.rosterUpdateMaterial as Record<string, unknown>)['api_credentials'] = 'token';

    const result = service.build(request);

    expect(result.ok).toBeFalse();
    expect(result.candidate).toBeNull();
    expect(result.failures).toContain('roster_update_material.api_credentials must not contain signing, backend, credential, or secret material');
  });

  it('fails closed when AGG_SIG_ME messages do not bind to the roster update', () => {
    fakeClvm.includeBadAggSigMessage = true;

    const result = service.build(validRequest());

    expect(result.ok).toBeFalse();
    expect(result.candidate).toBeNull();
    expect(result.failures).toContain('MIPS AGG_SIG_ME messages must bind to roster update binding hash');
  });
});

function validRequest(): AdminRosterMipsExecutionCoinSpendRequest {
  return {
    unsignedClvmConstructionPlan: {
      kind: 'admin_authority_v2_roster_update_unsigned_clvm_construction_plan',
      boundary: 'derive_unsigned_clvm_construction_plan_without_coin_spend_serialization',
      result: 'unsigned_clvm_construction_plan_only_no_coin_spends',
      unsigned_admin_authority_v2_spend_shape: {
        coin: {
          coin_id: LIVE_COIN_ID,
          parent_coin_info: LIVE_PARENT,
          puzzle_hash: LIVE_PUZZLE_HASH,
          amount: LIVE_AMOUNT,
        },
        current_inner_puzzle_hash: CURRENT_INNER_HASH,
      },
      unsigned_mips_spend_shape: {
        puzzle_reveal_tree_hash: CURRENT_MIPS_HASH,
        quorum_solution_tree_hash: MIPS_SOLUTION_HASH,
      },
      expected_conditions_summary: {
        state_announcement: {
          state_hash: NEW_STATE_HASH,
        },
        singleton_continuation: {
          next_inner_puzzle_hash: NEXT_INNER_PUZZLE_HASH,
          next_full_puzzle_hash: NEXT_FULL_PUZZLE_HASH,
        },
      },
      deterministic_unsigned_construction_summary: {
        current_mips_puzzle_reveal_tree_hash: CURRENT_MIPS_HASH,
        current_mips_quorum_solution_tree_hash: MIPS_SOLUTION_HASH,
      },
    },
    verifiedSpendBuilderIntake: {
      kind: 'admin_authority_v2_roster_update_spend_builder_verified_intake',
      boundary: 'normalize_and_reverify_inputs_without_spend_construction',
      result: 'verified_intake_only_no_signed_bundle',
      singleton_coin: {
        coin_id: LIVE_COIN_ID,
      },
      roster_transition: {
        launcher_id: LAUNCHER_ID,
        spend_tag: 7,
        new_authority_version: 2,
        current_mips_root_hash: CURRENT_MIPS_HASH,
        new_mips_root_hash: NEW_MIPS_ROOT_HASH,
        current_admins_hash: CURRENT_ADMINS_HASH,
        new_admins_hash: NEW_ADMINS_HASH,
        current_pending_ops_hash: PENDING_OPS_HASH,
        new_pending_ops_hash: PENDING_OPS_HASH,
        roster_update_binding_hash: ROSTER_UPDATE_BINDING_HASH,
      },
      deterministic_commitment_summary: {
        current_mips_puzzle_reveal_tree_hash: CURRENT_MIPS_HASH,
        current_mips_quorum_solution_tree_hash: MIPS_SOLUTION_HASH,
        current_admin_authority_v2_inner_puzzle_reveal_tree_hash: CURRENT_INNER_HASH,
      },
    },
    rawCurrentMipsPuzzleReveal: RAW_MIPS_REVEAL,
    rawCurrentMipsQuorumSolution: RAW_MIPS_SOLUTION,
    rawCurrentAdminAuthorityV2InnerPuzzleReveal: RAW_INNER_REVEAL,
    liveSingletonCoinMetadata: {
      coin_id: LIVE_COIN_ID,
      parent_coin_info: LIVE_PARENT,
      puzzle_hash: LIVE_PUZZLE_HASH,
      amount: LIVE_AMOUNT,
    },
    rosterUpdateMaterial: {
      current_admin_records: [
        {
          admin_idx: 0,
          m_within: 1,
          leaves: [{ leaf_hash: h('20') }],
        },
      ],
      current_pending_ops: [],
      new_admin_record: {
        admin_idx: 1,
        m_within: 1,
        leaves: [{ leaf_hash: h('21') }],
      },
      singleton_lineage_proof: {
        parent_parent_coin_info: h('22'),
        parent_inner_puzzle_hash: null,
        parent_amount: 1,
      },
    },
    maxCost: 11_000_000_000n,
  };
}

function h(byte: string): string {
  return `0x${byte.repeat(32)}`;
}
