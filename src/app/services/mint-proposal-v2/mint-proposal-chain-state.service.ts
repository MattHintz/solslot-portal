import { Injectable, inject } from '@angular/core';

import { MintProposalResponse } from '../admin-api.service';
import {
  ChiaSingletonReaderService,
  ReplayedSpend,
  SingletonLineage,
  SingletonLineageNode,
} from '../chia-singleton-reader.service';
import { ChiaWasmService } from '../chia-wasm.service';
import { CoinsetService } from '../coinset.service';
import {
  GovernanceTrackerReaderService,
  TrackerStateSnapshot,
} from '../governance-tracker-reader.service';
import { bytesToHex, canonicalIntBytes, hexToBytes } from '../../utils/chia-hash';
import { treeHashAtom, treeHashAtomList, treeHashPair } from '../../utils/clvm-tree-hash';
import { canonicalPropertyIdHash } from '../../utils/mint-property-id';
import { environment } from '../../../environments/environment';

import { readMintPublishLocalContext } from './mint-proposal-local-context';
import { MintPublishService } from './mint-publish.service';
import { MintProposalV2Service } from './mint-proposal-v2.service';
import {
  PropertyRegistryChainStateService,
  PropertyRegistryEvidence,
} from './property-registry-chain-state.service';

/**
 * Chain evidence for the local mint-proposal audit mirror.
 *
 * A freshly published portal draft stores the proposal singleton launcher id
 * plus the expected DRAFT-v0 inner puzzle hash.  The current singleton coin's
 * live puzzle reveal is unavailable until that coin is spent, but its puzzle
 * hash is public in the coin record.  Comparing that live puzzle hash with
 * the deterministic singleton wrapper hash proves the local PROPOSED mirror
 * is backed by the expected on-chain A.1 singleton.  If the DRAFT coin has
 * already transitioned, the service replays the latest spend and verifies the
 * transition announcement plus the recomputed child puzzle hash.
 */
@Injectable({ providedIn: 'root' })
export class MintProposalChainStateService {
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly wasm = inject(ChiaWasmService);
  private readonly coinset = inject(CoinsetService);
  private readonly tracker = inject(GovernanceTrackerReaderService);
  private readonly propertyRegistry = inject(PropertyRegistryChainStateService);

  async check(proposal: MintProposalResponse): Promise<MintProposalChainEvidence> {
    const launcherId = normalize32(proposal.on_chain.proposal_tracker_coin_id);
    if (!launcherId) {
      return { kind: 'local-only', reason: 'missing-proposal-launcher-id' };
    }

    const expectedInnerPuzzleHash = normalize32(proposal.computed.eve_inner_puzhash);
    if (!expectedInnerPuzzleHash) {
      return {
        kind: 'unverifiable',
        launcherId,
        reason: 'missing-eve-inner-puzzle-hash',
      };
    }

    const sgtLock = await this.checkSgtLockCoin(proposal.on_chain.sgt_lock_coin_id);
    const expectedPuzzleHash = expectedMintProposalDraftFullPuzzleHash(
      launcherId,
      expectedInnerPuzzleHash,
    );
    const lineage = await this.singleton.walkLineage(launcherId);
    if (!lineage) {
      return { kind: 'unconfirmed', stage: 'launcher-not-found', launcherId };
    }

    const live = lineage.nodes[lineage.nodes.length - 1];
    if (!live || (live.isLauncher && live.spentBlockIndex === null)) {
      return {
        kind: 'unconfirmed',
        stage: 'launcher-unspent',
        launcherId,
        launcherCoinId: lineage.launcherCoinId,
      };
    }
    if (live.isLauncher && live.spentBlockIndex !== null) {
      return {
        kind: 'unconfirmed',
        stage: 'child-pending',
        launcherId,
        launcherCoinId: lineage.launcherCoinId,
      };
    }

    const livePuzzleHash = normalizeHex(live.puzzleHash);
    const base = {
      launcherId,
      liveCoinId: live.coinId,
      livePuzzleHash,
      expectedPuzzleHash,
      confirmedBlockIndex: live.confirmedBlockIndex,
      lineageDepth: lineage.nodes.length - 1,
    };
    if (sameHex(livePuzzleHash, expectedPuzzleHash)) {
      const tracker = await this.checkTrackerProposal(proposal);
      const propertyRegistry = await this.checkPropertyRegistry(proposal);
      return {
        kind: 'confirmed-draft',
        ...base,
        proposalPuzzleState: 'DRAFT',
        stateVersion: 0,
        ...(sgtLock ? { sgtLock } : {}),
        ...(tracker ? { tracker } : {}),
        ...(propertyRegistry ? { propertyRegistry } : {}),
      };
    }

    const transition = await this.decodeLatestTransition({
      lineage,
      live,
      launcherId,
      expectedDraftPuzzleHash: expectedPuzzleHash,
      livePuzzleHash,
      sgtLock,
      propertyRegistry: await this.checkPropertyRegistry(proposal),
    });
    if (transition) return transition;

    return {
      kind: 'mismatch',
      ...base,
      reason: 'live-puzzle-hash-differs-from-local-published-draft',
    };
  }

  private async checkSgtLockCoin(
    storedCoinId: string | null | undefined,
  ): Promise<SgtLockCoinEvidence | null> {
    if (!storedCoinId) return null;
    const coinId = normalize32(storedCoinId);
    if (!coinId) {
      return { kind: 'invalid-stored-id', storedValue: storedCoinId };
    }
    const record = await this.coinset.getCoinRecordByName(coinId);
    if (!record) {
      return { kind: 'unconfirmed', coinId };
    }
    const spentBlockIndex =
      record.spent_block_index && record.spent_block_index > 0
        ? record.spent_block_index
        : null;
    const base = {
      coinId,
      parentCoinId: normalizeHex(record.coin.parent_coin_info),
      puzzleHash: normalizeHex(record.coin.puzzle_hash),
      amount: record.coin.amount,
      confirmedBlockIndex: record.confirmed_block_index,
    };
    if (spentBlockIndex !== null) {
      return {
        kind: 'confirmed-spent',
        ...base,
        spentBlockIndex,
      };
    }
    return { kind: 'confirmed-unspent', ...base };
  }

  private async checkTrackerProposal(
    proposal: MintProposalResponse,
  ): Promise<TrackerProposalEvidence | null> {
    const expectedProposalHash = normalize32(proposal.computed.proposal_hash);
    if (!expectedProposalHash) {
      return {
        kind: 'invalid-local-proposal-hash',
        storedValue: proposal.computed.proposal_hash,
      };
    }
    let snapshot: TrackerStateSnapshot;
    try {
      snapshot = await this.tracker.readCurrentState();
    } catch (err) {
      return {
        kind: 'read-failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (snapshot.kind === 'NOT_DEPLOYED') {
      return {
        kind: 'not-active',
        trackerState: snapshot.kind,
        reason: snapshot.reason,
      };
    }
    if (snapshot.kind === 'NOT_SPENT') {
      return {
        kind: 'not-active',
        trackerState: snapshot.kind,
        launcherId: snapshot.launcherId,
      };
    }
    if (snapshot.kind === 'IDLE') {
      return {
        kind: 'not-active',
        trackerState: snapshot.kind,
      };
    }

    const expectedDeadlineSeconds =
      proposal.deadline === null ? null : BigInt(proposal.deadline);
    if (!sameHex(snapshot.proposalHash, expectedProposalHash)) {
      return {
        kind: 'mismatch',
        reason: 'proposal-hash',
        trackerState: snapshot.kind,
        expectedProposalHash,
        liveProposalHash: normalizeHex(snapshot.proposalHash),
        expectedDeadlineSeconds,
        liveDeadlineSeconds: snapshot.votingDeadlineSeconds,
      };
    }
    if (
      expectedDeadlineSeconds !== null &&
      snapshot.votingDeadlineSeconds !== expectedDeadlineSeconds
    ) {
      return {
        kind: 'mismatch',
        reason: 'deadline',
        trackerState: snapshot.kind,
        expectedProposalHash,
        liveProposalHash: normalizeHex(snapshot.proposalHash),
        expectedDeadlineSeconds,
        liveDeadlineSeconds: snapshot.votingDeadlineSeconds,
      };
    }
    if (snapshot.bill.kind !== 'MINT') {
      return {
        kind: 'mismatch',
        reason: 'bill-kind',
        trackerState: snapshot.kind,
        expectedProposalHash,
        liveProposalHash: normalizeHex(snapshot.proposalHash),
        expectedDeadlineSeconds,
        liveDeadlineSeconds: snapshot.votingDeadlineSeconds,
        expectedBillKind: 'MINT',
        liveBillKind: snapshot.bill.kind,
      };
    }
    const expectedBill = this.expectedMintBillContext(proposal);
    if (!expectedBill) {
      return {
        kind: 'invalid-local-mint-bill',
        reason: 'missing-publish-context',
      };
    }
    const liveBill = {
      deedFullPuzzleHash: normalizeHex(snapshot.bill.deedFullPuzzleHash),
      propertyIdCanon: normalizeHex(snapshot.bill.propertyIdCanon),
      propertyRegistryPuzzleHash: normalizeHex(snapshot.bill.propertyRegistryPuzzleHash),
    };
    if (
      !sameHex(liveBill.deedFullPuzzleHash, expectedBill.deedFullPuzzleHash) ||
      !sameHex(liveBill.propertyIdCanon, expectedBill.propertyIdCanon) ||
      !sameHex(liveBill.propertyRegistryPuzzleHash, expectedBill.propertyRegistryPuzzleHash)
    ) {
      return {
        kind: 'mismatch',
        reason: 'mint-bill',
        trackerState: snapshot.kind,
        expectedProposalHash,
        liveProposalHash: normalizeHex(snapshot.proposalHash),
        expectedDeadlineSeconds,
        liveDeadlineSeconds: snapshot.votingDeadlineSeconds,
        expectedMintBill: expectedBill,
        liveMintBill: liveBill,
      };
    }
    return {
      kind: 'bound',
      trackerState: snapshot.kind,
      proposalHash: expectedProposalHash,
      votingDeadlineSeconds: snapshot.votingDeadlineSeconds,
      voteTally: snapshot.voteTally,
      quorumRequired: snapshot.quorumRequired,
      billKind: snapshot.bill.kind,
      deedFullPuzzleHash: liveBill.deedFullPuzzleHash,
      propertyIdCanon: liveBill.propertyIdCanon,
      propertyRegistryPuzzleHash: liveBill.propertyRegistryPuzzleHash,
    };
  }

  private async checkPropertyRegistry(
    proposal: MintProposalResponse,
  ): Promise<PropertyRegistryEvidence | null> {
    const bill = this.expectedMintBillContext(proposal);
    if (!bill) {
      return {
        kind: 'read-failed',
        error: 'Missing local publish context for property registry evidence.',
      };
    }
    return this.propertyRegistry.checkProperty({
      registryLauncherId: environment.solslotProtocol.propertyRegistryLauncherId,
      propertyIdCanon: bill.propertyIdCanon,
    });
  }

  private expectedMintBillContext(proposal: MintProposalResponse): MintBillContext | null {
    const deedFullPuzzleHash = normalize32(proposal.computed.deed_full_puzhash);
    if (!deedFullPuzzleHash) return null;
    let propertyIdCanon: string;
    try {
      propertyIdCanon = canonicalPropertyIdHash(proposal.property_id);
    } catch {
      return null;
    }
    const publishContext = readMintPublishLocalContext(proposal);
    if (!publishContext) return null;
    return {
      deedFullPuzzleHash,
      propertyIdCanon,
      propertyRegistryPuzzleHash: publishContext.propertyRegistryPuzzleHash,
    };
  }

  private async decodeLatestTransition(args: {
    lineage: SingletonLineage;
    live: SingletonLineageNode;
    launcherId: string;
    expectedDraftPuzzleHash: string;
    livePuzzleHash: string;
    sgtLock: SgtLockCoinEvidence | null;
    propertyRegistry: PropertyRegistryEvidence | null;
  }): Promise<MintProposalConfirmedTransitionEvidence | null> {
    if (args.lineage.nodes.length < 3) return null;

    const replay = await this.singleton.replayLatestSpend(args.lineage);
    if (!replay || !sameHex(replay.node.puzzleHash, args.expectedDraftPuzzleHash)) {
      return null;
    }

    let decoded: DecodedMintProposalTransition;
    try {
      decoded = decodeMintProposalTransitionSpend(this.clvm(), replay, args.launcherId);
    } catch {
      return null;
    }

    if (decoded.previousState.proposalPuzzleState !== 'DRAFT') return null;
    if (decoded.newStateVersion <= decoded.previousState.stateVersion) return null;
    if (!decoded.announcementSeen) return null;
    if (!sameHex(args.livePuzzleHash, decoded.expectedFullPuzzleHash)) return null;

    return {
      kind: 'confirmed-transition',
      launcherId: args.launcherId,
      liveCoinId: args.live.coinId,
      livePuzzleHash: args.livePuzzleHash,
      expectedPuzzleHash: decoded.expectedFullPuzzleHash,
      previousPuzzleState: decoded.previousState.proposalPuzzleState,
      previousStateVersion: decoded.previousState.stateVersion,
      proposalPuzzleState: decoded.proposalPuzzleState,
      stateVersion: decoded.newStateVersion,
      transitionCase: decoded.transitionCase,
      transitionCaseCode: decoded.transitionCaseCode,
      transitionAnnouncement: decoded.transitionAnnouncement,
      confirmedBlockIndex: args.live.confirmedBlockIndex,
      spentBlockIndex: replay.node.spentBlockIndex ?? 0,
      lineageDepth: args.lineage.nodes.length - 1,
      ...(args.sgtLock ? { sgtLock: args.sgtLock } : {}),
      ...(args.propertyRegistry ? { propertyRegistry: args.propertyRegistry } : {}),
    };
  }

  private clvm(): ClvmShape {
    const sdk = this.wasm.sdk() as { Clvm?: new () => ClvmShape };
    if (!sdk.Clvm) {
      throw new Error('MintProposalChainStateService: Chia CLVM WASM unavailable');
    }
    return new sdk.Clvm();
  }
}

export function expectedMintProposalDraftFullPuzzleHash(
  launcherId: string,
  eveInnerPuzzleHash: string,
): string {
  return expectedMintProposalFullPuzzleHash(launcherId, eveInnerPuzzleHash);
}

export function expectedMintProposalFullPuzzleHash(
  launcherId: string,
  innerPuzzleHash: string,
): string {
  const launcherIdBytes = hexToBytes(launcherId);
  const innerHashBytes = hexToBytes(innerPuzzleHash);
  if (launcherIdBytes.length !== 32) {
    throw new Error(`launcherId must be 32 bytes, got ${launcherIdBytes.length}`);
  }
  if (innerHashBytes.length !== 32) {
    throw new Error(`innerPuzzleHash must be 32 bytes, got ${innerHashBytes.length}`);
  }

  const singletonModHash = hexToBytes(MintPublishService.SINGLETON_MOD_HASH);
  const launcherPuzzleHash = hexToBytes(MintPublishService.SINGLETON_LAUNCHER_HASH);
  const singletonStructHash = treeHashPair(
    treeHashAtom(singletonModHash),
    treeHashPair(treeHashAtom(launcherIdBytes), treeHashAtom(launcherPuzzleHash)),
  );

  return bytesToHex(
    curryAndTreeHash(quotedModFromHash(singletonModHash), [
      singletonStructHash,
      innerHashBytes,
    ]),
  );
}

export function decodeMintProposalTransitionSpend(
  clvm: ClvmShape,
  replay: ReplayedSpend,
  launcherId: string,
): DecodedMintProposalTransition {
  const previousState = parseMintProposalV2FullPuzzleReveal(
    clvm,
    hexToBytes(replay.puzzleAndSolution.puzzleReveal),
    launcherId,
  );
  const solution = parseMintProposalV2FullSolution(
    clvm,
    hexToBytes(replay.puzzleAndSolution.solution),
  );
  const transition = transitionForCase(solution.transitionCaseCode);
  if (!transition) {
    throw new Error(`unknown mint proposal transition case ${solution.transitionCaseCode}`);
  }

  const expectedInnerPuzzleHash = makeMintProposalV2InnerPuzzleHash({
    selfModHash: previousState.selfModHash,
    ownerMemberHash: previousState.ownerMemberHash,
    govMemberHash: previousState.govMemberHash,
    proposalDataHash: previousState.proposalDataHash,
    proposalState: transition.newStateCode,
    stateVersion: solution.newStateVersion,
  });
  const expectedFullPuzzleHash = expectedMintProposalFullPuzzleHash(
    previousState.launcherId,
    expectedInnerPuzzleHash,
  );
  const transitionMessage = mintProposalTransitionMessage({
    transitionCase: solution.transitionCaseCode,
    newState: transition.newStateCode,
    newStateVersion: solution.newStateVersion,
  });
  const transitionAnnouncement = prefixedAnnouncement(transitionMessage);
  const announcementSeen = replay.conditions.createPuzzleAnnouncements.some(
    (body) => bytesEqual(body, transitionAnnouncement),
  );

  return {
    previousState,
    transitionCase: transition.name,
    transitionCaseCode: solution.transitionCaseCode,
    proposalPuzzleState: transition.newStateName,
    newStateVersion: solution.newStateVersion,
    transitionAnnouncement: bytesToHex(transitionAnnouncement),
    expectedInnerPuzzleHash,
    expectedFullPuzzleHash,
    announcementSeen,
  };
}

export function parseMintProposalV2FullPuzzleReveal(
  clvm: ClvmShape,
  puzzleReveal: Uint8Array,
  launcherId: string,
): ParsedMintProposalV2State {
  const full = clvm.deserialize(puzzleReveal);
  const fullUncurried = full.uncurry();
  if (!fullUncurried) {
    throw new Error('mint proposal full puzzle reveal is not curried');
  }
  const fullArgs = fullUncurried.args.toList();
  if (!fullArgs || fullArgs.length !== 2) {
    throw new Error('mint proposal full puzzle reveal does not have singleton wrapper args');
  }
  const inner = fullArgs[1];
  const innerUncurried = inner.uncurry();
  if (!innerUncurried) {
    throw new Error('mint proposal inner puzzle is not curried');
  }
  if (!sameHex(bytesToHex(innerUncurried.program.treeHash()), MintProposalV2Service.MOD_HASH)) {
    throw new Error('mint proposal inner puzzle mod hash mismatch');
  }
  const args = innerUncurried.args.toList();
  if (!args || args.length !== 6) {
    throw new Error(`mint proposal inner puzzle expects 6 curried args, got ${args?.length ?? 0}`);
  }
  const selfModHash = bytesToHex(args[0].toAtom());
  if (!sameHex(selfModHash, MintProposalV2Service.MOD_HASH)) {
    throw new Error('mint proposal SELF_MOD_HASH arg mismatch');
  }
  const proposalStateCode = safeNumber(args[4].toInt(), 'proposal_state');
  return {
    launcherId: normalizeHex(launcherId),
    selfModHash,
    ownerMemberHash: bytesToHex(args[1].toAtom()),
    govMemberHash: bytesToHex(args[2].toAtom()),
    proposalDataHash: bytesToHex(args[3].toAtom()),
    proposalStateCode,
    proposalPuzzleState: stateName(proposalStateCode),
    stateVersion: safeNumber(args[5].toInt(), 'state_version'),
  };
}

function parseMintProposalV2FullSolution(
  clvm: ClvmShape,
  solutionBytes: Uint8Array,
): ParsedMintProposalV2Solution {
  const fullSolution = clvm.deserialize(solutionBytes);
  const fullArgs = fullSolution.toList();
  if (!fullArgs || fullArgs.length !== 3) {
    throw new Error('mint proposal singleton solution expects 3 args');
  }
  const innerSolution = fullArgs[2];
  const innerArgs = innerSolution.toList();
  if (!innerArgs || innerArgs.length < 3) {
    throw new Error('mint proposal inner solution expects at least 3 args');
  }
  return {
    myAmount: safeNumber(innerArgs[0].toInt(), 'my_amount'),
    transitionCaseCode: safeNumber(innerArgs[1].toInt(), 'transition_case'),
    newStateVersion: safeNumber(innerArgs[2].toInt(), 'new_state_version'),
  };
}

function makeMintProposalV2InnerPuzzleHash(args: {
  selfModHash: string;
  ownerMemberHash: string;
  govMemberHash: string;
  proposalDataHash: string;
  proposalState: number;
  stateVersion: number;
}): string {
  const modHash = hexToBytes(MintProposalV2Service.MOD_HASH);
  return bytesToHex(
    curryAndTreeHash(quotedModFromHash(modHash), [
      treeHashAtom(hexToBytes(args.selfModHash)),
      treeHashAtom(hexToBytes(args.ownerMemberHash)),
      treeHashAtom(hexToBytes(args.govMemberHash)),
      treeHashAtom(hexToBytes(args.proposalDataHash)),
      treeHashAtom(canonicalIntBytes(BigInt(args.proposalState))),
      treeHashAtom(canonicalIntBytes(BigInt(args.stateVersion))),
    ]),
  );
}

function mintProposalTransitionMessage(args: {
  transitionCase: number;
  newState: number;
  newStateVersion: number;
}): Uint8Array {
  return treeHashAtomList([
    canonicalIntBytes(BigInt(args.transitionCase)),
    canonicalIntBytes(BigInt(args.newState)),
    canonicalIntBytes(BigInt(args.newStateVersion)),
  ]);
}

function prefixedAnnouncement(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + message.length);
  out[0] = ChiaSingletonReaderService.PROTOCOL_PREFIX;
  out.set(message, 1);
  return out;
}

function curryAndTreeHash(quotedMod: Uint8Array, args: Uint8Array[]): Uint8Array {
  return treeHashPair(
    aKwTreeHash(),
    treeHashPair(
      quotedMod,
      treeHashPair(curriedValuesTreeHash(args), nilTreeHash()),
    ),
  );
}

function curriedValuesTreeHash(args: Uint8Array[]): Uint8Array {
  if (args.length === 0) return qKwTreeHash();
  const [first, ...rest] = args;
  return treeHashPair(
    cKwTreeHash(),
    treeHashPair(
      treeHashPair(qKwTreeHash(), first),
      treeHashPair(curriedValuesTreeHash(rest), nilTreeHash()),
    ),
  );
}

function quotedModFromHash(modHash: Uint8Array): Uint8Array {
  return treeHashPair(qKwTreeHash(), modHash);
}

function qKwTreeHash(): Uint8Array {
  return treeHashAtom(Uint8Array.of(0x01));
}

function aKwTreeHash(): Uint8Array {
  return treeHashAtom(Uint8Array.of(0x02));
}

function cKwTreeHash(): Uint8Array {
  return treeHashAtom(Uint8Array.of(0x04));
}

function nilTreeHash(): Uint8Array {
  return treeHashAtom(new Uint8Array(0));
}

function normalize32(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function normalizeHex(value: string): string {
  return value.startsWith('0x') ? value.toLowerCase() : `0x${value.toLowerCase()}`;
}

function sameHex(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}

function safeNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside safe integer range`);
  }
  return Number(value);
}

function stateName(code: number): MintProposalPuzzleState {
  switch (code) {
    case MintProposalV2Service.STATE_DRAFT:
      return 'DRAFT';
    case MintProposalV2Service.STATE_APPROVED:
      return 'APPROVED';
    case MintProposalV2Service.STATE_CANCELLED:
      return 'CANCELLED';
    default:
      throw new Error(`unknown mint proposal state ${code}`);
  }
}

function transitionForCase(code: number): TransitionDescriptor | null {
  switch (code) {
    case MintProposalV2Service.TRANSITION_APPROVE:
      return {
        name: 'APPROVE',
        newStateCode: MintProposalV2Service.STATE_APPROVED,
        newStateName: 'APPROVED',
      };
    case MintProposalV2Service.TRANSITION_CANCEL:
      return {
        name: 'CANCEL',
        newStateCode: MintProposalV2Service.STATE_CANCELLED,
        newStateName: 'CANCELLED',
      };
    default:
      return null;
  }
}

export type MintProposalChainEvidence =
  | { kind: 'local-only'; reason: 'missing-proposal-launcher-id' }
  | {
      kind: 'unverifiable';
      launcherId: string;
      reason: 'missing-eve-inner-puzzle-hash';
    }
  | {
      kind: 'unconfirmed';
      stage: 'launcher-not-found' | 'launcher-unspent' | 'child-pending';
      launcherId: string;
      launcherCoinId?: string;
    }
  | {
      kind: 'confirmed-draft';
      launcherId: string;
      liveCoinId: string;
      livePuzzleHash: string;
      expectedPuzzleHash: string;
      proposalPuzzleState: 'DRAFT';
      stateVersion: 0;
      confirmedBlockIndex: number;
      lineageDepth: number;
      sgtLock?: SgtLockCoinEvidence;
      tracker?: TrackerProposalEvidence;
      propertyRegistry?: PropertyRegistryEvidence;
    }
  | MintProposalConfirmedTransitionEvidence
  | {
      kind: 'mismatch';
      launcherId: string;
      liveCoinId: string;
      livePuzzleHash: string;
      expectedPuzzleHash: string;
      confirmedBlockIndex: number;
      lineageDepth: number;
      reason: 'live-puzzle-hash-differs-from-local-published-draft';
    };

export type MintProposalConfirmedTransitionEvidence = {
  kind: 'confirmed-transition';
  launcherId: string;
  liveCoinId: string;
  livePuzzleHash: string;
  expectedPuzzleHash: string;
  previousPuzzleState: 'DRAFT';
  previousStateVersion: number;
  proposalPuzzleState: 'APPROVED' | 'CANCELLED';
  stateVersion: number;
  transitionCase: 'APPROVE' | 'CANCEL';
  transitionCaseCode: number;
  transitionAnnouncement: string;
  confirmedBlockIndex: number;
  spentBlockIndex: number;
  lineageDepth: number;
  sgtLock?: SgtLockCoinEvidence;
  propertyRegistry?: PropertyRegistryEvidence;
};

export type SgtLockCoinEvidence =
  | { kind: 'invalid-stored-id'; storedValue: string }
  | { kind: 'unconfirmed'; coinId: string }
  | {
      kind: 'confirmed-unspent';
      coinId: string;
      parentCoinId: string;
      puzzleHash: string;
      amount: number;
      confirmedBlockIndex: number;
    }
  | {
      kind: 'confirmed-spent';
      coinId: string;
      parentCoinId: string;
      puzzleHash: string;
      amount: number;
      confirmedBlockIndex: number;
      spentBlockIndex: number;
    };

export type TrackerProposalEvidence =
  | { kind: 'invalid-local-proposal-hash'; storedValue: string | null }
  | {
      kind: 'invalid-local-mint-bill';
      reason: 'missing-publish-context';
    }
  | { kind: 'read-failed'; error: string }
  | {
      kind: 'not-active';
      trackerState: 'NOT_DEPLOYED' | 'NOT_SPENT' | 'IDLE';
      reason?: 'launcher-id-missing' | 'launcher-not-on-chain';
      launcherId?: string;
    }
  | {
      kind: 'mismatch';
      reason: 'proposal-hash' | 'deadline' | 'bill-kind' | 'mint-bill';
      trackerState: 'OPEN' | 'AWAITING_EXECUTE' | 'AWAITING_EXPIRE';
      expectedProposalHash: string;
      liveProposalHash: string;
      expectedDeadlineSeconds: bigint | null;
      liveDeadlineSeconds: bigint;
      expectedBillKind?: string;
      liveBillKind?: string;
      expectedMintBill?: MintBillContext;
      liveMintBill?: MintBillContext;
    }
  | {
      kind: 'bound';
      trackerState: 'OPEN' | 'AWAITING_EXECUTE' | 'AWAITING_EXPIRE';
      proposalHash: string;
      votingDeadlineSeconds: bigint;
      voteTally: bigint;
      quorumRequired: bigint;
      billKind: string;
      deedFullPuzzleHash?: string;
      propertyIdCanon?: string;
      propertyRegistryPuzzleHash?: string;
    };

export type MintProposalPuzzleState = 'DRAFT' | 'APPROVED' | 'CANCELLED';

export interface ParsedMintProposalV2State {
  launcherId: string;
  selfModHash: string;
  ownerMemberHash: string;
  govMemberHash: string;
  proposalDataHash: string;
  proposalStateCode: number;
  proposalPuzzleState: MintProposalPuzzleState;
  stateVersion: number;
}

export interface DecodedMintProposalTransition {
  previousState: ParsedMintProposalV2State;
  transitionCase: 'APPROVE' | 'CANCEL';
  transitionCaseCode: number;
  proposalPuzzleState: 'APPROVED' | 'CANCELLED';
  newStateVersion: number;
  transitionAnnouncement: string;
  expectedInnerPuzzleHash: string;
  expectedFullPuzzleHash: string;
  announcementSeen: boolean;
}

interface ParsedMintProposalV2Solution {
  myAmount: number;
  transitionCaseCode: number;
  newStateVersion: number;
}

interface TransitionDescriptor {
  name: 'APPROVE' | 'CANCEL';
  newStateCode: number;
  newStateName: 'APPROVED' | 'CANCELLED';
}

export interface MintBillContext {
  deedFullPuzzleHash: string;
  propertyIdCanon: string;
  propertyRegistryPuzzleHash: string;
}

export interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
}

export interface ProgramShape {
  treeHash(): Uint8Array;
  uncurry(): { program: ProgramShape; args: ProgramShape } | undefined;
  toList(): ProgramShape[] | undefined;
  toAtom(): Uint8Array;
  toInt(): bigint;
}
