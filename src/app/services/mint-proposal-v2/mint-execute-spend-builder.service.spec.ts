import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ChiaWasmService } from '../chia-wasm.service';
import type { UnsignedCoinSpend } from '../chia-wallet.service';

import fixturesJson from './mint-publish.fixtures.json';
import { MintExecuteSpendBuilderService } from './mint-execute-spend-builder.service';

interface FixtureCoin {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: number;
}

interface LineageFixture {
  parent_name: string | null;
  inner_puzzle_hash: string | null;
  amount: number | null;
}

interface SpendExpected {
  coin: FixtureCoin;
  puzzle_reveal_hex: string;
  solution_hex: string;
  coin_spend_hex: string;
}

interface Fixture {
  did_mint_execute: {
    inputs: {
      did_coin: FixtureCoin;
      lineage_proof: LineageFixture;
      protocol_did_singleton_struct_hex: string;
      governance_singleton_struct_hex: string;
      governance_inner_puzzle_hash: string;
      deed_full_puzzle_hash: string;
    };
    expected: SpendExpected;
  };
  proposal_mint_execute: {
    inputs: {
      proposal_coin: FixtureCoin;
      lineage_proof: LineageFixture;
      proposal_launcher_id: string;
      owner_member_hash: string;
      gov_member_hash: string;
      proposal_data_hash: string;
      governance_singleton_struct_hex: string;
      governance_proposal_hash: string;
      deed_launcher_id: string;
      did_inner_puzzle_hash: string;
      deed_full_puzzle_hash: string;
      governance_inner_puzzle_hash: string;
    };
    expected: SpendExpected;
  };
  deed_launcher_execute: {
    inputs: {
      deed_launcher_coin: FixtureCoin;
      protocol_did_singleton_struct_hex: string;
      did_inner_puzzle_hash: string;
      deed_full_puzzle_hash: string;
    };
    expected: SpendExpected;
  };
}

const fixture = fixturesJson as Fixture;

describe('MintExecuteSpendBuilderService', () => {
  let service: MintExecuteSpendBuilderService;

  beforeAll(async () => {
    if ((window as unknown as { ChiaSDK?: unknown }).ChiaSDK) return;
    // @ts-ignore deep WASM glue import
    const wasmExports = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
    const response = await fetch('/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm');
    const result = await WebAssembly.instantiate(await response.arrayBuffer(), {
      './chia_wallet_sdk_wasm_bg.js': wasmExports as unknown as WebAssembly.ModuleImports,
    });
    (wasmExports as unknown as { __wbg_set_wasm(wasm: WebAssembly.Exports): void })
      .__wbg_set_wasm(result.instance.exports);
    (window as unknown as { ChiaSDK: unknown }).ChiaSDK = wasmExports;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(ChiaWasmService).probeReady();
    service = TestBed.inject(MintExecuteSpendBuilderService);
  });

  it('matches the Python quorum-DID mint spend byte for byte', () => {
    const input = fixture.did_mint_execute.inputs;
    const spend = service.buildDidMintSpend({
      didCoin: input.did_coin,
      lineageProof: lineage(input.lineage_proof),
      protocolDidSingletonStructHex: input.protocol_did_singleton_struct_hex,
      governanceSingletonStructHex: input.governance_singleton_struct_hex,
      governanceInnerPuzzleHash: input.governance_inner_puzzle_hash,
      deedFullPuzzleHash: input.deed_full_puzzle_hash,
    });
    expectSpend(spend, fixture.did_mint_execute.expected);
  });

  it('matches the Python proposal EXECUTE spend byte for byte', () => {
    const input = fixture.proposal_mint_execute.inputs;
    const spend = service.buildProposalExecuteSpend({
      proposalCoin: input.proposal_coin,
      lineageProof: lineage(input.lineage_proof),
      proposalLauncherId: input.proposal_launcher_id,
      ownerMemberHash: input.owner_member_hash,
      govMemberHash: input.gov_member_hash,
      proposalDataHash: input.proposal_data_hash,
      governanceSingletonStructHex: input.governance_singleton_struct_hex,
      governanceProposalHash: input.governance_proposal_hash,
      deedLauncherId: input.deed_launcher_id,
      didInnerPuzzleHash: input.did_inner_puzzle_hash,
      deedFullPuzzleHash: input.deed_full_puzzle_hash,
      governanceInnerPuzzleHash: input.governance_inner_puzzle_hash,
    });
    expectSpend(spend, fixture.proposal_mint_execute.expected);
  });

  it('matches the Python DID-gated deed-launcher spend byte for byte', () => {
    const input = fixture.deed_launcher_execute.inputs;
    const spend = service.buildDeedLauncherSpend({
      deedLauncherCoin: input.deed_launcher_coin,
      protocolDidSingletonStructHex: input.protocol_did_singleton_struct_hex,
      didInnerPuzzleHash: input.did_inner_puzzle_hash,
      deedFullPuzzleHash: input.deed_full_puzzle_hash,
    });
    expectSpend(spend, fixture.deed_launcher_execute.expected);
  });
});

function lineage(value: LineageFixture) {
  return {
    ...(value.parent_name ? { parentName: value.parent_name } : {}),
    ...(value.inner_puzzle_hash
      ? { innerPuzzleHash: value.inner_puzzle_hash }
      : {}),
    ...(value.amount !== null ? { amount: value.amount } : {}),
  };
}

function expectSpend(spend: UnsignedCoinSpend, expected: SpendExpected): void {
  expect(spend.coin.parentCoinInfo).toBe(expected.coin.parentCoinInfo);
  expect(spend.coin.puzzleHash).toBe(expected.coin.puzzleHash);
  expect(BigInt(spend.coin.amount)).toBe(BigInt(expected.coin.amount));
  expect(spend.puzzleReveal).toBe(expected.puzzle_reveal_hex);
  expect(spend.solution).toBe(expected.solution_hex);
}
