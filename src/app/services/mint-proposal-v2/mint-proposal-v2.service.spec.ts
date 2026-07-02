/**
 * Cross-repo binding test for the TS port of mint_proposal_v2_driver.
 *
 * The fixture file (``mint-proposal-v2.fixtures.json``) is generated
 * by ``populis_protocol/scripts/dump_mint_proposal_v2_fixtures.py``.
 * Each section of the fixture corresponds to a TS helper and asserts
 * hex-byte equivalence with the production Python implementation.
 *
 * **If a test here fails:**
 *   1. The TS implementation in ``mint-proposal-v2.service.ts`` drifted
 *      from the Python source of truth.  Diff the offending case's
 *      input + output and find the divergence.
 *   2. OR the Python source changed and the fixture wasn't regenerated.
 *      Re-run ``python populis_protocol/scripts/dump_mint_proposal_v2_fixtures.py``
 *      and re-test.
 *
 * Test patterns mirror ``admin-authority-v2.service.spec.ts`` so the
 * WASM bootstrap is identical (deep-import the JS glue, fetch the
 * .wasm binary, hand-instantiate, stash on window.ChiaSDK).
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ChiaWasmService } from '../chia-wasm.service';
import {
  MintProposalV2Service,
  bytesToHex,
} from './mint-proposal-v2.service';
import fixturesJson from './mint-proposal-v2.fixtures.json';

// \u2500\u2500 Fixture shape \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
interface FixtureCase<TInput> {
  input: TInput;
  expected: string;
}

interface ProposalDataInput {
  property_id_canon: string;
  collection_id_canon: string;
  share_ppm: number;
  par_value_mojos: number;
  royalty_bps: number;
  quorum_threshold: number;
}

interface BindingHashInput {
  transition_case: number;
  new_state_version: number;
  proposal_data_hash: string;
}

interface TransitionMessageInput {
  transition_case: number;
  new_state: number;
  new_state_version: number;
}

interface InnerPuzzleInput {
  owner_member_hash: string;
  gov_member_hash: string;
  proposal_data_hash: string;
  proposal_state: number;
  state_version: number;
}

interface FixtureFile {
  constants: {
    mod_hash: string;
    state_draft: number;
    state_approved: number;
    state_cancelled: number;
    transition_approve: number;
    transition_cancel: number;
  };
  proposal_data_hash: FixtureCase<ProposalDataInput>[];
  binding_hash: FixtureCase<BindingHashInput>[];
  transition_message: FixtureCase<TransitionMessageInput>[];
  inner_puzzle_hash: FixtureCase<InnerPuzzleInput>[];
}

const fixtures = fixturesJson as FixtureFile;

// \u2500\u2500 Test suite \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
describe('MintProposalV2Service', () => {
  let service: MintProposalV2Service;

  beforeAll(async () => {
    // WASM bootstrap mirroring admin-authority-v2.service.spec.ts.  See
    // that spec for the full rationale; tl;dr deep-import the JS glue,
    // fetch the .wasm binary, hand-instantiate, stash on window.ChiaSDK.
    if ((window as unknown as { ChiaSDK?: unknown }).ChiaSDK) {
      return;
    }
    // @ts-ignore \u2014 deep-import path; types come from chia_wallet_sdk_wasm.d.ts.
    const wasmExports = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
    const response = await fetch('/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm');
    if (!response.ok) {
      throw new Error(
        `WASM asset fetch failed: ${response.status} ${response.statusText}`,
      );
    }
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, {
      './chia_wallet_sdk_wasm_bg.js': wasmExports as unknown as WebAssembly.ModuleImports,
    });
    const setWasm = (wasmExports as unknown as {
      __wbg_set_wasm?: (w: WebAssembly.Exports) => void;
    }).__wbg_set_wasm;
    if (typeof setWasm !== 'function') {
      throw new Error('chia_wallet_sdk_wasm_bg.js missing __wbg_set_wasm');
    }
    setWasm(result.instance.exports);
    (window as unknown as { ChiaSDK: unknown }).ChiaSDK = wasmExports;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const wasmService = TestBed.inject(ChiaWasmService);
    wasmService.probeReady();
    service = TestBed.inject(MintProposalV2Service);
  });

  // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Constants
  // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  describe('constants', () => {
    it('MOD_HASH static matches the fixture', () => {
      expect(MintProposalV2Service.MOD_HASH).toBe(fixtures.constants.mod_hash);
    });

    it('state machine constants match the fixture', () => {
      expect(MintProposalV2Service.STATE_DRAFT).toBe(fixtures.constants.state_draft);
      expect(MintProposalV2Service.STATE_APPROVED).toBe(fixtures.constants.state_approved);
      expect(MintProposalV2Service.STATE_CANCELLED).toBe(fixtures.constants.state_cancelled);
    });

    it('transition case constants match the fixture', () => {
      expect(MintProposalV2Service.TRANSITION_APPROVE).toBe(
        fixtures.constants.transition_approve,
      );
      expect(MintProposalV2Service.TRANSITION_CANCEL).toBe(
        fixtures.constants.transition_cancel,
      );
    });

    it('runtime modHash() matches MOD_HASH static (puzzle-hex \u2194 .clsp consistency)', () => {
      const runtime = bytesToHex(service.modHash());
      expect(runtime).toBe(MintProposalV2Service.MOD_HASH);
    });
  });

  // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // proposal_data_hash
  // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  describe('computeProposalDataHash', () => {
    fixtures.proposal_data_hash.forEach((c, i) => {
      it(`case ${i}: par=${c.input.par_value_mojos}, royalty=${c.input.royalty_bps}`, () => {
        const got = service.computeProposalDataHash({
          propertyIdCanon: c.input.property_id_canon,
          collectionIdCanon: c.input.collection_id_canon,
          sharePpm: c.input.share_ppm,
          parValueMojos: c.input.par_value_mojos,
          royaltyBps: c.input.royalty_bps,
          quorumThreshold: c.input.quorum_threshold,
        });
        expect(bytesToHex(got)).toBe(c.expected);
      });
    });
  });

  // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // binding_hash
  // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  describe('computeBindingHash', () => {
    fixtures.binding_hash.forEach((c, i) => {
      const caseLabel = c.input.transition_case === 0x61 ? 'APPROVE' : 'CANCEL';
      it(`case ${i}: ${caseLabel} v${c.input.new_state_version}`, () => {
        const got = service.computeBindingHash({
          transitionCase: c.input.transition_case,
          newStateVersion: c.input.new_state_version,
          proposalDataHash: c.input.proposal_data_hash,
        });
        expect(bytesToHex(got)).toBe(c.expected);
      });
    });

    it('binding hashes are unique across (case, version, proposal) triples', () => {
      // Defence-in-depth: confirm at least two of the fixture cases
      // produce different hashes, even when run by the TS port.
      // Catches a degenerate "TS always returns 0x00...0" bug.
      const seen = new Set(
        fixtures.binding_hash.map((c) =>
          bytesToHex(
            service.computeBindingHash({
              transitionCase: c.input.transition_case,
              newStateVersion: c.input.new_state_version,
              proposalDataHash: c.input.proposal_data_hash,
            }),
          ),
        ),
      );
      expect(seen.size).toBe(fixtures.binding_hash.length);
    });
  });

  // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // transition_message
  // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  describe('computeTransitionMessage', () => {
    fixtures.transition_message.forEach((c, i) => {
      const caseLabel = c.input.transition_case === 0x61 ? 'APPROVE' : 'CANCEL';
      it(`case ${i}: ${caseLabel}`, () => {
        const got = service.computeTransitionMessage({
          transitionCase: c.input.transition_case,
          newState: c.input.new_state,
          newStateVersion: c.input.new_state_version,
        });
        expect(bytesToHex(got)).toBe(c.expected);
      });
    });
  });

  // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // inner_puzzle_hash
  // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  describe('makeInnerPuzzleHash', () => {
    fixtures.inner_puzzle_hash.forEach((c, i) => {
      it(`case ${i}: state=${c.input.proposal_state}, version=${c.input.state_version}`, () => {
        const got = service.makeInnerPuzzleHash({
          ownerMemberHash: c.input.owner_member_hash,
          govMemberHash: c.input.gov_member_hash,
          proposalDataHash: c.input.proposal_data_hash,
          proposalState: c.input.proposal_state,
          stateVersion: c.input.state_version,
        });
        expect(bytesToHex(got)).toBe(c.expected);
      });
    });
  });
});
