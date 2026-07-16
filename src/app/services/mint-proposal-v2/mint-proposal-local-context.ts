import type { MintProposalResponse } from '../admin-api.service';

const PUBLISH_CONTEXT_KEY = 'publish_context';

export interface MintPublishLocalContext {
  propertyRegistryPuzzleHash: string;
  propertyRegistryCoinId?: string;
  ownerMemberHash?: string;
  govMemberHash?: string;
  proposalDataHash?: string;
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
  return {
    propertyRegistryPuzzleHash: propertyRegistryPuzzleHash.toLowerCase(),
    ...optionalHex32(ctx, 'property_registry_coin_id', 'propertyRegistryCoinId'),
    ...optionalHex32(ctx, 'owner_member_hash', 'ownerMemberHash'),
    ...optionalHex32(ctx, 'gov_member_hash', 'govMemberHash'),
    ...optionalHex32(ctx, 'proposal_data_hash', 'proposalDataHash'),
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
