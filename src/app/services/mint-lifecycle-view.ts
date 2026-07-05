import type { MintProposalResponse, MintProposalState } from './admin-api.service';
import type { TrackerStateSnapshot } from './governance-tracker-reader.service';

export type MintLifecycleNotation =
  | 'OP:DRAFT'
  | 'GC:VOTING'
  | 'GC:PASSED'
  | 'GC:FAILED'
  | 'OP:EXECUTED'
  | 'OP:MINTED'
  | 'OP:CANCELED';

export interface MintProposalLifecycleView {
  notation: MintLifecycleNotation;
  requiredAction: string;
  outcome: string;
  diagnostics: MintProposalLifecycleDiagnostics;
}

export interface MintProposalLifecycleDiagnostics {
  proposalHash: string | null;
  deedFullPuzhash: string | null;
  deedLauncherId: string | null;
  offerArtifactId: string | null;
  offerArtifactHash: string | null;
}

export interface CommitteeMintLifecycleView {
  notation: Extract<MintLifecycleNotation, 'GC:VOTING' | 'GC:PASSED' | 'GC:FAILED'>;
  requiredAction: string;
  outcome: string;
}

export function mintProposalLifecycleView(
  proposal: MintProposalResponse,
): MintProposalLifecycleView {
  const notation = notationForProposalState(proposal.state);
  const diagnostics = lifecycleDiagnostics(proposal);
  switch (proposal.state) {
    case 'DRAFT':
      return {
        notation,
        requiredAction: 'Publish the proposal to governance.',
        outcome: 'Approval starts with deed minting; offer artifacts are created later through admin/API purchase intents.',
        diagnostics,
      };
    case 'PROPOSED':
    case 'VOTING':
      return {
        notation,
        requiredAction: 'Committee voting is open or pending quorum.',
        outcome: 'Approval leads to deed mint only at this stage.',
        diagnostics,
      };
    case 'PASSED':
      return {
        notation,
        requiredAction: 'Execute the passed mint proposal.',
        outcome: 'Execution launches the deed path; offer artifacts wait for a confirmed deed launcher id.',
        diagnostics,
      };
    case 'EXECUTED':
      return {
        notation,
        requiredAction: 'Wait for chain confirmation of the minted deed launcher.',
        outcome: 'Deed mint execution is submitted; offer artifact readiness follows MINTED evidence.',
        diagnostics,
      };
    case 'MINTED':
      return {
        notation,
        requiredAction: diagnostics.deedLauncherId
          ? 'Create or verify the protocol offer artifact through the admin/API purchase intent path.'
          : 'Recover the deed launcher id before offer artifact creation can proceed.',
        outcome: diagnostics.deedLauncherId
          ? 'Minted deed plus offer-artifact readiness is available for member purchase flow.'
          : 'Minted state is missing deed launcher evidence.',
        diagnostics,
      };
    case 'FAILED':
      return {
        notation,
        requiredAction: 'No further mint action is available.',
        outcome: 'No deed or member purchase artifact will be produced.',
        diagnostics,
      };
    case 'CANCELED':
      return {
        notation,
        requiredAction: 'No further mint action is available.',
        outcome: 'The proposal was canceled before deed minting; no member purchase artifact will be produced.',
        diagnostics,
      };
  }
}

export function committeeMintLifecycleView(
  snapshot: TrackerStateSnapshot,
): CommitteeMintLifecycleView | null {
  switch (snapshot.kind) {
    case 'OPEN':
      return {
        notation: 'GC:VOTING',
        requiredAction: 'Committee can vote on this MINT proposal.',
        outcome: 'If quorum is met, execution will launch the deed mint path.',
      };
    case 'AWAITING_EXECUTE':
      return {
        notation: 'GC:PASSED',
        requiredAction: 'Execute the passed MINT proposal.',
        outcome: 'Execution launches the deed path; offer artifacts wait for MINTED evidence.',
      };
    case 'AWAITING_EXPIRE':
      return {
        notation: 'GC:FAILED',
        requiredAction: 'Expire the failed MINT proposal.',
        outcome: 'No deed or member purchase artifact will be produced.',
      };
    default:
      return null;
  }
}

function notationForProposalState(state: MintProposalState): MintLifecycleNotation {
  switch (state) {
    case 'DRAFT':
      return 'OP:DRAFT';
    case 'PROPOSED':
    case 'VOTING':
      return 'GC:VOTING';
    case 'PASSED':
      return 'GC:PASSED';
    case 'FAILED':
      return 'GC:FAILED';
    case 'EXECUTED':
      return 'OP:EXECUTED';
    case 'MINTED':
      return 'OP:MINTED';
    case 'CANCELED':
      return 'OP:CANCELED';
  }
}

function lifecycleDiagnostics(
  proposal: MintProposalResponse,
): MintProposalLifecycleDiagnostics {
  return {
    proposalHash: proposal.computed.proposal_hash,
    deedFullPuzhash: proposal.computed.deed_full_puzhash,
    deedLauncherId: proposal.on_chain.deed_launcher_id,
    offerArtifactId: metadataString(
      proposal.off_chain_metadata,
      ['offerArtifactId', 'offer_artifact_id', 'artifactId'],
      ['offerArtifact', 'protocolOffer', 'protocolArtifact'],
    ),
    offerArtifactHash: metadataString(
      proposal.off_chain_metadata,
      ['offerArtifactHash', 'offer_artifact_hash', 'artifactHash', 'protocolArtifactHash'],
      ['offerArtifact', 'protocolOffer', 'protocolArtifact'],
    ),
  };
}

function metadataString(
  metadata: Record<string, unknown> | null,
  keys: readonly string[],
  containers: readonly string[],
): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  for (const container of containers) {
    const nested = metadata[container];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const record = nested as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return null;
}
