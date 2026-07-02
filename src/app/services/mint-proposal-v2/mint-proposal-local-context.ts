import type { MintProposalResponse } from '../admin-api.service';

const PUBLISH_CONTEXT_KEY = 'publish_context';

export interface MintPublishLocalContext {
  propertyRegistryPuzzleHash: string;
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
  return { propertyRegistryPuzzleHash: propertyRegistryPuzzleHash.toLowerCase() };
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
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function is32ByteHex(v: unknown): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
}
