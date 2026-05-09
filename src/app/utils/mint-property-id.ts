export function canonicalizeMintPropertyId(raw: string): string {
  const canon = raw.trim().toUpperCase();
  if (!canon) {
    throw new Error('property_id must be non-empty after stripping whitespace');
  }
  return canon;
}
