import { Injectable, inject } from '@angular/core';

import type { MintProposalResponse } from '../admin-api.service';
import { ChiaSingletonReaderService, SingletonLineage } from '../chia-singleton-reader.service';
import { ChiaWalletService, SignedSpendBundle, UnsignedCoinSpend } from '../chia-wallet.service';
import { ChiaWasmService } from '../chia-wasm.service';
import {
  CommitteeApiService,
  CommitteeVoteApiResponse,
  SpendBundleJson,
} from '../committee-api.service';
import { CoinsetService } from '../coinset.service';
import { GovernanceTrackerReaderService } from '../governance-tracker-reader.service';
import {
  SgtVoteSpendBuilderService,
  UnsignedCoinSpendHex,
} from '../sgt-driver/sgt-vote-spend-builder.service';
import { bytesToHex, coinId, hexToBytes } from '../../utils/chia-hash';
import { canonicalCollectionIdHash, canonicalPropertyIdHash } from '../../utils/mint-property-id';
import { environment } from '../../../environments/environment';

import { CoinShape, MintExecuteSpendBuilderService } from './mint-execute-spend-builder.service';
import { MintProposalV2Service } from './mint-proposal-v2.service';
import { readMintPublishLocalContext } from './mint-proposal-local-context';
import { PropertyRegistryRegistrationMaterialService } from './property-registry-registration-material.service';

/** Builds, signs, and submits the canonical five-spend MINT execution. */
@Injectable({ providedIn: 'root' })
export class MintProposalV2ExecuteRunnerService {
  private readonly tracker = inject(GovernanceTrackerReaderService);
  private readonly trackerBuilder = inject(SgtVoteSpendBuilderService);
  private readonly executeBuilder = inject(MintExecuteSpendBuilderService);
  private readonly registry = inject(PropertyRegistryRegistrationMaterialService);
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly coinset = inject(CoinsetService);
  private readonly wallet = inject(ChiaWalletService);
  private readonly wasm = inject(ChiaWasmService);
  private readonly proposalV2 = inject(MintProposalV2Service);
  private readonly api = inject(CommitteeApiService);

  async executeMint(proposal: MintProposalResponse): Promise<ExecuteMintResult> {
    const expected = expectedMintBillContext(proposal);
    const publishContext = readMintPublishLocalContext(proposal);
    const proposalLauncherId = normalize32(
      proposal.on_chain.proposal_singleton_launcher_id ??
        proposal.on_chain.proposal_tracker_coin_id,
    );
    const deedLauncherId = normalize32(proposal.on_chain.deed_launcher_id);
    if (
      !expected ||
      !publishContext?.propertyRegistryCoinId ||
      !publishContext.ownerMemberHash ||
      !publishContext.govMemberHash ||
      !publishContext.proposalDataHash ||
      !proposalLauncherId ||
      !deedLauncherId
    ) {
      return { kind: 'missing-local-context', reason: 'missing-publish-context' };
    }
    if (!this.wasm.ready()) return { kind: 'wasm-not-ready' };

    const deployment = deploymentContext();
    if (!deployment) return { kind: 'deployment-not-configured' };

    const computedProposalDataHash = bytesToHex(
      this.proposalV2.computeProposalDataHash({
        propertyIdCanon: expected.propertyIdCanon,
        collectionIdCanon: canonicalCollectionIdHash(proposal.collection_id),
        sharePpm: proposal.share_ppm,
        parValueMojos: proposal.par_value,
        royaltyBps: proposal.royalty_bps,
        quorumThreshold: proposal.quorum_required,
      }),
    );
    if (!sameHex(computedProposalDataHash, publishContext.proposalDataHash)) {
      return {
        kind: 'proposal-context-mismatch',
        reason: 'proposal-data-hash',
        expected: computedProposalDataHash,
        live: publishContext.proposalDataHash,
      };
    }

    let trackerInputs;
    try {
      trackerInputs = await this.tracker.getAwaitingExecuteInputs();
    } catch (e) {
      return { kind: 'tracker-read-failed', error: formatError(e) };
    }
    if (!trackerInputs) return { kind: 'tracker-not-awaiting-execute' };

    const mismatch = trackerMismatch(trackerInputs, expected);
    if (mismatch) return mismatch;

    let trackerSpend: UnsignedCoinSpendHex;
    try {
      trackerSpend = this.trackerBuilder.buildTrackerExecuteCoinSpend({
        trackerCoin: trackerInputs.trackerCoin,
        trackerInnerPuzzleHex: trackerInputs.trackerInnerPuzzleHex,
        trackerLauncherId: trackerInputs.trackerLauncherId,
        lineageProof: trackerInputs.lineageProof,
      });
    } catch (e) {
      return { kind: 'spend-builder-failed', error: formatError(e) };
    }

    const governanceInnerPuzzleHash = bytesToHex(
      this.clvm()
        .deserialize(hexToBytes(normalizeHex(trackerInputs.trackerInnerPuzzleHex)))
        .treeHash(),
    );

    try {
      const [didCurrent, proposalCurrent, registryMaterial, deedLauncherCoin] = await Promise.all([
        this.currentSingleton(deployment.protocolDidLauncherId),
        this.currentSingleton(proposalLauncherId),
        this.registry.build({
          registryLauncherId: deployment.propertyRegistryLauncherId,
          registryGovPubkey: deployment.propertyRegistryGovPubkey,
          propertyIdCanon: expected.propertyIdCanon,
        }),
        this.currentDeedLauncher(deedLauncherId),
      ]);
      if (!didCurrent || !proposalCurrent || !deedLauncherCoin) {
        return { kind: 'chain-state-unavailable' };
      }
      if (registryMaterial.kind !== 'ok') {
        return {
          kind: 'property-registry-unavailable',
          error: registryMaterial.error,
        };
      }
      const registryCoinId = coinId(
        registryMaterial.spend.coin.parentCoinInfo,
        registryMaterial.spend.coin.puzzleHash,
        registryMaterial.spend.coin.amount,
      );
      if (
        !sameHex(registryCoinId, publishContext.propertyRegistryCoinId) ||
        !sameHex(registryMaterial.propertyRegistryPuzzleHash, expected.propertyRegistryPuzzleHash)
      ) {
        return {
          kind: 'proposal-context-mismatch',
          reason: 'property-registry-current-coin',
          expected: publishContext.propertyRegistryCoinId,
          live: registryCoinId,
        };
      }

      const didSpend = this.executeBuilder.buildDidMintSpend({
        didCoin: didCurrent.coin,
        lineageProof: didCurrent.lineageProof,
        protocolDidSingletonStructHex: deployment.protocolDidSingletonStructHex,
        governanceSingletonStructHex: deployment.governanceSingletonStructHex,
        governanceInnerPuzzleHash,
        deedFullPuzzleHash: expected.deedFullPuzzleHash,
      });
      const proposalSpend = this.executeBuilder.buildProposalExecuteSpend({
        proposalCoin: proposalCurrent.coin,
        lineageProof: proposalCurrent.lineageProof,
        proposalLauncherId,
        ownerMemberHash: publishContext.ownerMemberHash,
        govMemberHash: publishContext.govMemberHash,
        proposalDataHash: publishContext.proposalDataHash,
        governanceSingletonStructHex: deployment.governanceSingletonStructHex,
        governanceProposalHash: expected.proposalHash,
        deedLauncherId,
        didInnerPuzzleHash: deployment.protocolDidInnerPuzhash,
        deedFullPuzzleHash: expected.deedFullPuzzleHash,
        governanceInnerPuzzleHash,
      });
      const deedLauncherSpend = this.executeBuilder.buildDeedLauncherSpend({
        deedLauncherCoin,
        protocolDidSingletonStructHex: deployment.protocolDidSingletonStructHex,
        didInnerPuzzleHash: deployment.protocolDidInnerPuzhash,
        deedFullPuzzleHash: expected.deedFullPuzzleHash,
      });

      const unsigned: UnsignedCoinSpend[] = [
        trackerSpend,
        didSpend,
        registryMaterial.spend,
        proposalSpend,
        deedLauncherSpend,
      ];
      let signedBundle: SignedSpendBundle;
      try {
        signedBundle = await this.wallet.signSpendBundle(unsigned);
      } catch (e) {
        return { kind: 'sign-failed', error: formatError(e) };
      }
      const spendBundle = toWireSpendBundle(signedBundle);
      let apiResponse: CommitteeVoteApiResponse;
      try {
        apiResponse = await this.api.executeProposal(spendBundle, proposal.id);
      } catch (e) {
        return {
          kind: 'submit-failed',
          error: formatError(e),
          signedBundle,
        };
      }
      return {
        kind: 'submitted',
        apiResponse,
        proposalHash: expected.proposalHash,
        signedBundle,
      };
    } catch (e) {
      return { kind: 'spend-builder-failed', error: formatError(e) };
    }
  }

  private async currentSingleton(launcherId: string): Promise<CurrentSingleton | null> {
    const lineage = await this.singleton.walkLineage(launcherId);
    if (!lineage || lineage.nodes.length < 2) return null;
    const current = lineage.nodes[lineage.nodes.length - 1];
    if (current.isLauncher || current.spentBlockIndex !== null) return null;
    return {
      coin: {
        parentCoinInfo: current.parentCoinId,
        puzzleHash: current.puzzleHash,
        amount: current.amount,
      },
      lineageProof: await this.currentLineageProof(lineage),
    };
  }

  private async currentLineageProof(lineage: SingletonLineage) {
    if (lineage.nodes.length === 2) {
      return {
        parentName: normalizeHex(lineage.launcher.coin.parent_coin_info),
        amount: lineage.launcher.coin.amount,
      };
    }
    const replay = await this.singleton.replayLatestSpend(lineage);
    if (!replay || replay.node.isLauncher) {
      throw new Error('Could not reconstruct singleton lineage proof.');
    }
    const full = this.clvm().deserialize(
      hexToBytes(normalizeHex(replay.puzzleAndSolution.puzzleReveal)),
    );
    const uncurried = full.uncurry();
    const args = uncurried ? programList(uncurried.args) : null;
    if (!uncurried || !args || args.length !== 2) {
      throw new Error('Previous singleton puzzle reveal is malformed.');
    }
    return {
      parentName: replay.node.parentCoinId,
      innerPuzzleHash: bytesToHex(args[1].treeHash()),
      amount: replay.node.amount,
    };
  }

  private async currentDeedLauncher(launcherId: string): Promise<CoinShape | null> {
    const record = await this.coinset.getCoinRecordByName(launcherId);
    if (!record || (record.spent_block_index ?? 0) !== 0) return null;
    const actualId = coinId(
      record.coin.parent_coin_info,
      record.coin.puzzle_hash,
      record.coin.amount,
    );
    if (!sameHex(actualId, launcherId)) {
      throw new Error('Coinset deed launcher record does not match its coin id.');
    }
    return {
      parentCoinInfo: normalizeHex(record.coin.parent_coin_info),
      puzzleHash: normalizeHex(record.coin.puzzle_hash),
      amount: record.coin.amount,
    };
  }

  private clvm(): ClvmShape {
    const sdk = this.wasm.sdk() as { Clvm?: new () => ClvmShape };
    if (!sdk.Clvm) throw new Error('Chia WASM Clvm export is unavailable.');
    return new sdk.Clvm();
  }
}

export type ExecuteMintResult =
  | { kind: 'missing-local-context'; reason: 'missing-publish-context' }
  | { kind: 'wasm-not-ready' }
  | { kind: 'deployment-not-configured' }
  | { kind: 'tracker-read-failed'; error: string }
  | { kind: 'tracker-not-awaiting-execute' }
  | TrackerMismatch
  | {
      kind: 'proposal-context-mismatch';
      reason: 'proposal-data-hash' | 'property-registry-current-coin';
      expected: string;
      live: string;
    }
  | { kind: 'chain-state-unavailable' }
  | { kind: 'property-registry-unavailable'; error: string }
  | { kind: 'spend-builder-failed'; error: string }
  | { kind: 'sign-failed'; error: string }
  | { kind: 'submit-failed'; error: string; signedBundle: SignedSpendBundle }
  | {
      kind: 'submitted';
      apiResponse: CommitteeVoteApiResponse;
      proposalHash: string;
      signedBundle: SignedSpendBundle;
    };

interface ExpectedMintBillContext {
  proposalHash: string;
  deedFullPuzzleHash: string;
  propertyIdCanon: string;
  propertyRegistryPuzzleHash: string;
}

interface CurrentSingleton {
  coin: CoinShape;
  lineageProof: {
    parentName: string;
    innerPuzzleHash?: string;
    amount: number | bigint;
  };
}

interface TrackerMismatch {
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

function expectedMintBillContext(proposal: MintProposalResponse): ExpectedMintBillContext | null {
  const proposalHash = normalize32(proposal.computed.proposal_hash);
  const deedFullPuzzleHash = normalize32(proposal.computed.deed_full_puzhash);
  const publishContext = readMintPublishLocalContext(proposal);
  if (!proposalHash || !deedFullPuzzleHash || !publishContext) return null;
  try {
    return {
      proposalHash,
      deedFullPuzzleHash,
      propertyIdCanon: canonicalPropertyIdHash(proposal.property_id),
      propertyRegistryPuzzleHash: publishContext.propertyRegistryPuzzleHash,
    };
  } catch {
    return null;
  }
}

function trackerMismatch(
  inputs: Awaited<ReturnType<GovernanceTrackerReaderService['getAwaitingExecuteInputs']>> & {},
  expected: ExpectedMintBillContext,
): TrackerMismatch | null {
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
  const live = {
    deedFullPuzzleHash: inputs.bill.deedFullPuzzleHash,
    propertyIdCanon: inputs.bill.propertyIdCanon,
    propertyRegistryPuzzleHash: inputs.bill.propertyRegistryPuzzleHash,
  };
  for (const key of Object.keys(live) as Array<keyof typeof live>) {
    if (!sameHex(live[key], expected[key])) {
      return {
        kind: 'tracker-mismatch',
        reason: key,
        expected: expected[key],
        live: live[key],
      };
    }
  }
  return null;
}

function deploymentContext() {
  const p = environment.solslotProtocol;
  if (
    !is32(p.protocolDidLauncherId) ||
    !is32(p.protocolDidInnerPuzhash) ||
    !is32(p.propertyRegistryLauncherId) ||
    !is48(p.propertyRegistryGovPubkey) ||
    !p.protocolDidSingletonStructHex ||
    !p.governanceSingletonStructHex
  ) {
    return null;
  }
  return {
    protocolDidLauncherId: normalizeHex(p.protocolDidLauncherId),
    protocolDidInnerPuzhash: normalizeHex(p.protocolDidInnerPuzhash),
    protocolDidSingletonStructHex: normalizeHex(p.protocolDidSingletonStructHex),
    governanceSingletonStructHex: normalizeHex(p.governanceSingletonStructHex),
    propertyRegistryLauncherId: normalizeHex(p.propertyRegistryLauncherId),
    propertyRegistryGovPubkey: normalizeHex(p.propertyRegistryGovPubkey),
  };
}

function toWireSpendBundle(bundle: SignedSpendBundle): SpendBundleJson {
  return {
    coin_spends: bundle.coinSpends.map((spend) => ({
      coin: {
        parent_coin_info: normalizeHex(spend.coin.parentCoinInfo),
        puzzle_hash: normalizeHex(spend.coin.puzzleHash),
        amount: Number(spend.coin.amount),
      },
      puzzle_reveal: normalizeHex(spend.puzzleReveal),
      solution: normalizeHex(spend.solution),
    })),
    aggregated_signature: normalizeHex(bundle.aggregatedSignature),
  };
}

function programList(value: ProgramShape[] | ProgramShape): ProgramShape[] | null {
  return Array.isArray(value) ? value : value.toList();
}

function normalize32(value: string | null | undefined): string | null {
  return typeof value === 'string' && is32(value) ? normalizeHex(value) : null;
}

function normalizeHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X')
    ? `0x${value.slice(2).toLowerCase()}`
    : `0x${value.toLowerCase()}`;
}

function sameHex(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}

function is32(value: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(value);
}

function is48(value: string): boolean {
  return /^(0x)?[0-9a-fA-F]{96}$/.test(value);
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface ProgramShape {
  treeHash(): Uint8Array;
  uncurry(): { program: ProgramShape; args: ProgramShape[] | ProgramShape } | null;
  toList(): ProgramShape[] | null;
}

interface ClvmShape {
  deserialize(value: Uint8Array): ProgramShape;
}
