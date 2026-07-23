import { sha256 } from 'ethers';

export function canonicalizeMintPropertyId(raw: string): string {
  const canon = raw.trim().toUpperCase();
  if (!canon) {
    throw new Error('property_id must be non-empty after stripping whitespace');
  }
  return canon;
}

export function canonicalizeMintCollectionId(raw: string): string {
  const canon = raw.trim().toUpperCase();
  if (!canon) {
    throw new Error('collection_id must be non-empty after stripping whitespace');
  }
  return canon;
}

export function canonicalCollectionIdHash(raw: string): string {
  return sha256(new TextEncoder().encode(canonicalizeMintCollectionId(raw)));
}

/**
 * Canonical on-chain property id:
 *   strip -> upper -> UTF-8 -> sha256 -> bytes32.
 *
 * Mirrors ``solslot_puzzles/property_registry_driver.py``'
 * ``canonicalise_property_id`` exactly.
 */
export function canonicalPropertyIdHash(raw: string): string {
  return sha256(new TextEncoder().encode(canonicalizeMintPropertyId(raw)));
}

const ALPHA_ASSET_CLASS_CODES: Readonly<Record<string, number>> = {
  'RWA-RE-RES': 1,
  'RWA-RE-MFR': 2,
  'RWA-RE-COM': 3,
  'RWA-RE-IND': 4,
  'RWA-RE-HOS': 5,
  'RWA-RE-LAND': 6,
  'RWA-RE-MIX': 7,
};

/**
 * Alpha-only asset-class registry.  Unknown strings are rejected so the
 * publish path cannot silently choose an arbitrary on-chain integer.
 */
export function assetClassToCode(raw: string): number {
  const key = raw.trim().toUpperCase();
  const code = ALPHA_ASSET_CLASS_CODES[key];
  if (code === undefined) {
    throw new Error(
      `unsupported asset_class "${raw}"; supported alpha classes: ` +
        Object.keys(ALPHA_ASSET_CLASS_CODES).join(', '),
    );
  }
  return code;
}
