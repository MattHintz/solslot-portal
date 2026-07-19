import type { MintProposalResponse } from '../admin-api.service';

const PUBLISH_CONTEXT_KEY = 'publish_context';

export interface MintPublishLocalContext {
  propertyRegistryPuzzleHash: string;
  propertyRegistryCoinId?: string;
  ownerMemberHash?: string;
  govMemberHash?: string;
  proposalDataHash?: string;
  metadataRoot?: string;
  metadataAnchorId?: string;
}

export function readMintPublishLocalContext(
  proposal: MintProposalResponse,
): MintPublishLocalContext | null {
  const metadata = proposal.off_chain_metadata;
  if (!isRecord(metadata)) return null;
  const ctx = metadata[PUBLISH_CONTEXT_KEY];
  if (!isRecord(ctx)) return null;
  const propertyRegistryPuzzleHash = ctx['property_registry_puzzle_hash'];
  if (!is32ByteHex(propertyRegistryPuzzleHash)) return null;
  const metadataRoot = ctx['metadata_root'];
  const metadataAnchorId = ctx['metadata_anchor_id'];
  const hasMetadataCommitment = metadataRoot !== undefined || metadataAnchorId !== undefined;
  if (
    hasMetadataCommitment &&
    (!is32ByteHex(metadataRoot) || !is32ByteHex(metadataAnchorId))
  ) {
    return null;
  }
  return {
    propertyRegistryPuzzleHash: propertyRegistryPuzzleHash.toLowerCase(),
    ...optionalHex32(ctx, 'property_registry_coin_id', 'propertyRegistryCoinId'),
    ...optionalHex32(ctx, 'owner_member_hash', 'ownerMemberHash'),
    ...optionalHex32(ctx, 'gov_member_hash', 'govMemberHash'),
    ...optionalHex32(ctx, 'proposal_data_hash', 'proposalDataHash'),
    ...(hasMetadataCommitment
      ? {
          metadataRoot: (metadataRoot as string).toLowerCase(),
          metadataAnchorId: (metadataAnchorId as string).toLowerCase(),
        }
      : {}),
  };
}

export function mergeMintPublishLocalContext(
  metadata: Record<string, unknown> | null | undefined,
  context: MintPublishLocalContext,
): Record<string, unknown> {
  const base = isRecord(metadata) ? metadata : {};
  const existing = base[PUBLISH_CONTEXT_KEY];
  return {
    ...base,
    [PUBLISH_CONTEXT_KEY]: {
      ...(isRecord(existing) ? existing : {}),
      property_registry_puzzle_hash: context.propertyRegistryPuzzleHash.toLowerCase(),
      ...(context.propertyRegistryCoinId
        ? { property_registry_coin_id: context.propertyRegistryCoinId.toLowerCase() }
        : {}),
      ...(context.ownerMemberHash
        ? { owner_member_hash: context.ownerMemberHash.toLowerCase() }
        : {}),
      ...(context.govMemberHash ? { gov_member_hash: context.govMemberHash.toLowerCase() } : {}),
      ...(context.proposalDataHash
        ? { proposal_data_hash: context.proposalDataHash.toLowerCase() }
        : {}),
      ...(context.metadataRoot && context.metadataAnchorId
        ? {
            metadata_root: context.metadataRoot.toLowerCase(),
            metadata_anchor_id: context.metadataAnchorId.toLowerCase(),
          }
        : {}),
    },
  };
}

function optionalHex32(
  source: Record<string, unknown>,
  wireKey: string,
  propertyKey: string,
): Record<string, string> {
  const value = source[wireKey];
  return is32ByteHex(value) ? { [propertyKey]: value.toLowerCase() } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function is32ByteHex(v: unknown): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
}
