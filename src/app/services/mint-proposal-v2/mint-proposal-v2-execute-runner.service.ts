import { Injectable, inject } from '@angular/core';

import type { MintProposalResponse } from '../admin-api.service';
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

import { readMintPublishLocalContext } from './mint-proposal-local-context';

const EMPTY_AGGREGATE_SIGNATURE = '0x' + 'c0' + '00'.repeat(95);

/**
 * End-to-end portal runner for mint tracker EXECUTE.
 *
 * EXECUTE is permissionless once the tracker has passed its deadline and met
 * quorum.  The runner therefore does not invoke the Chia wallet; it verifies
 * that the live tracker state still matches this local mint draft, builds the
 * tracker ``TRK_EXECUTE`` spend, and forwards the one-spend bundle through the
 * same publish-only committee relay used by PROPOSE/VOTE.
 */
@Injectable({ providedIn: 'root' })
export class MintProposalV2ExecuteRunnerService {
  private readonly tracker = inject(GovernanceTrackerReaderService);
  private readonly builder = inject(SgtVoteSpendBuilderService);
  private readonly api = inject(CommitteeApiService);

  async executeMint(proposal: MintProposalResponse): Promise<ExecuteMintResult> {
    const expected = expectedMintBillContext(proposal);
    if (!expected) {
      return { kind: 'missing-local-context', reason: 'missing-publish-context' };
    }

    let inputs;
    try {
      inputs = await this.tracker.getAwaitingExecuteInputs();
    } catch (e) {
      return { kind: 'tracker-read-failed', error: formatError(e) };
    }
    if (!inputs) {
      return { kind: 'tracker-not-awaiting-execute' };
    }

    if (!sameHex(inputs.proposalHash, expected.proposalHash)) {
      return {
        kind: 'tracker-mismatch',
        reason: 'proposal-hash',
        expected: expected.proposalHash,
        live: inputs.proposalHash,
      };
    }
    if (inputs.bill.kind !== 'MINT') {
      return {
        kind: 'tracker-mismatch',
        reason: 'bill-kind',
        expected: 'MINT',
        live: inputs.bill.kind,
      };
    }
    const liveBill = {
      deedFullPuzzleHash: inputs.bill.deedFullPuzzleHash,
      propertyIdCanon: inputs.bill.propertyIdCanon,
      propertyRegistryPuzzleHash: inputs.bill.propertyRegistryPuzzleHash,
    };
    for (const key of [
      'deedFullPuzzleHash',
      'propertyIdCanon',
      'propertyRegistryPuzzleHash',
    ] as const) {
      if (!sameHex(liveBill[key], expected[key])) {
        return {
          kind: 'tracker-mismatch',
          reason: key,
          expected: expected[key],
          live: liveBill[key],
        };
      }
    }

    let trackerSpend: UnsignedCoinSpendHex;
    try {
      trackerSpend = this.builder.buildTrackerExecuteCoinSpend({
        trackerCoin: inputs.trackerCoin,
        trackerInnerPuzzleHex: inputs.trackerInnerPuzzleHex,
        trackerLauncherId: inputs.trackerLauncherId,
        lineageProof: inputs.lineageProof,
      });
    } catch (e) {
      return { kind: 'spend-builder-failed', error: formatError(e) };
    }

    const spendBundle: SpendBundleJson = {
      coin_spends: [toWireCoinSpend(trackerSpend)],
      aggregated_signature: EMPTY_AGGREGATE_SIGNATURE,
    };
    const apiResponse = await this.api.castVote(spendBundle, expected.proposalHash);
    return {
      kind: 'submitted',
      apiResponse,
      proposalHash: expected.proposalHash,
      trackerSpend,
    };
  }
}

export type ExecuteMintResult =
  | { kind: 'missing-local-context'; reason: 'missing-publish-context' }
  | { kind: 'tracker-read-failed'; error: string }
  | { kind: 'tracker-not-awaiting-execute' }
  | {
      kind: 'tracker-mismatch';
      reason:
        | 'proposal-hash'
        | 'bill-kind'
        | 'deedFullPuzzleHash'
        | 'propertyIdCanon'
        | 'propertyRegistryPuzzleHash';
      expected: string;
      live: string;
    }
  | { kind: 'spend-builder-failed'; error: string }
  | {
      kind: 'submitted';
      apiResponse: CommitteeVoteApiResponse;
      proposalHash: string;
      trackerSpend: UnsignedCoinSpendHex;
    };

interface ExpectedMintBillContext {
  proposalHash: string;
  deedFullPuzzleHash: string;
  propertyIdCanon: string;
  propertyRegistryPuzzleHash: string;
}

function expectedMintBillContext(
  proposal: MintProposalResponse,
): ExpectedMintBillContext | null {
  const proposalHash = normalize32(proposal.computed.proposal_hash);
  const deedFullPuzzleHash = normalize32(proposal.computed.deed_full_puzhash);
  const publishContext = readMintPublishLocalContext(proposal);
  if (!proposalHash || !deedFullPuzzleHash || !publishContext) return null;
  let propertyIdCanon: string;
  try {
    propertyIdCanon = canonicalPropertyIdHash(proposal.property_id);
  } catch {
    return null;
  }
  return {
    proposalHash,
    deedFullPuzzleHash,
    propertyIdCanon,
    propertyRegistryPuzzleHash: publishContext.propertyRegistryPuzzleHash,
  };
}

function toWireCoinSpend(spend: UnsignedCoinSpendHex): SpendBundleJson['coin_spends'][number] {
  return {
    coin: {
      parent_coin_info: normalizeHex(spend.coin.parentCoinInfo),
      puzzle_hash: normalizeHex(spend.coin.puzzleHash),
      amount: Number(spend.coin.amount),
    },
    puzzle_reveal: normalizeHex(spend.puzzleReveal),
    solution: normalizeHex(spend.solution),
  };
}

function normalize32(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function normalizeHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X')
    ? value.toLowerCase()
    : `0x${value.toLowerCase()}`;
}

function sameHex(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
