/**
 * Vault-version outdated detection — pure, backend-free, byte-compatible with
 * the protocol.
 *
 * This is the TypeScript port of the detection primitives in
 * ``populis_puzzles/vault_version_registry_driver.py`` (Bricks 2/4b).  Keeping
 * it pure (no WASM, no chain) means it is trivially unit-testable and the
 * cross-language vectors are pinned against Python in
 * ``vault-version-detection.spec.ts``.
 *
 * The registry singleton publishes the canonical current vault descriptor
 * ``(VAULT_INNER_MOD_HASH, CANONICAL_PARAMS_HASH, VAULT_VERSION)``.  A vault is
 * CURRENT iff BOTH its code hash and its canonical-params hash equal the
 * registry's; otherwise it is OUTDATED and an upgrade is offered.  See
 * ``research/POPULIS_VAULT_UPGRADE_DESIGN.md``.
 */
import { bytesToHex, canonicalIntBytes, hexToBytes } from '../utils/chia-hash';
import { treeHashAtomList } from '../utils/clvm-tree-hash';

/** Decoded state of a vault-version registry singleton. */
export interface RegistryState {
  /** Tree hash of the canonical ``vault_singleton_inner`` module (the CODE). */
  vaultInnerModHash: string;
  /** sha256tree of the canonical protocol-level vault params. */
  canonicalParamsHash: string;
  /** Monotonic on-chain vault version. */
  vaultVersion: number;
}

/** Result of comparing a vault against the registry. */
export type VaultVersionStatus =
  | { kind: 'current'; registryVersion: number }
  | {
      kind: 'outdated';
      /** Which half of the version identity diverged. */
      reason: 'code' | 'params' | 'both';
      registryVersion: number;
    };

function normalizeHex(value: string): string {
  return '0x' + value.replace(/^0x/i, '').toLowerCase();
}

function asBytes32(hex: string, name: string): Uint8Array {
  const b = hexToBytes(hex);
  if (b.length !== 32) {
    throw new Error(`${name} must be 32 bytes, got ${b.length}`);
  }
  return b;
}

/**
 * Canonical hash of the protocol-level (shared) vault params.
 *
 * ``CANONICAL_PARAMS_HASH = sha256tree(list POOL_SINGLETON_MOD_HASH
 * POOL_LAUNCHER_ID POOL_SINGLETON_LAUNCHER_PUZZLE_HASH
 * ZKPASSPORT_BRIDGE_POLICY_HASH)``.
 *
 * MUST match ``compute_canonical_params_hash`` in the Python driver
 * byte-for-byte — the order is load-bearing.  A params-only upgrade (e.g. the
 * bridge-policy-hash repair) changes exactly this hash.
 */
export function computeCanonicalParamsHash(
  poolSingletonModHash: string,
  poolLauncherId: string,
  poolSingletonLauncherPuzzleHash: string,
  zkpassportBridgePolicyHash: string,
): string {
  return bytesToHex(
    treeHashAtomList([
      asBytes32(poolSingletonModHash, 'poolSingletonModHash'),
      asBytes32(poolLauncherId, 'poolLauncherId'),
      asBytes32(poolSingletonLauncherPuzzleHash, 'poolSingletonLauncherPuzzleHash'),
      asBytes32(zkpassportBridgePolicyHash, 'zkpassportBridgePolicyHash'),
    ]),
  );
}

/**
 * The registry's published content hash for a state tuple.
 *
 * ``content_hash = sha256tree(list VAULT_INNER_MOD_HASH CANONICAL_PARAMS_HASH
 * VAULT_VERSION)`` — matches ``compute_content_hash`` in the Python driver.
 * A client can recompute this from on-chain state and compare it to the value
 * the registry emits in its CREATE_PUZZLE_ANNOUNCEMENT.
 */
export function computeContentHash(
  vaultInnerModHash: string,
  canonicalParamsHash: string,
  vaultVersion: number,
): string {
  if (!Number.isInteger(vaultVersion) || vaultVersion < 0) {
    throw new Error(`vaultVersion must be a non-negative integer, got ${vaultVersion}`);
  }
  return bytesToHex(
    treeHashAtomList([
      asBytes32(vaultInnerModHash, 'vaultInnerModHash'),
      asBytes32(canonicalParamsHash, 'canonicalParamsHash'),
      canonicalIntBytes(BigInt(vaultVersion)),
    ]),
  );
}

/**
 * True iff a vault matches the registry's canonical version: BOTH the vault
 * CODE (mod hash) AND the protocol params hash equal the registry's.  Any
 * mismatch => OUTDATED.
 */
export function isVaultCurrent(
  registry: RegistryState,
  vaultInnerModHash: string,
  vaultCanonicalParamsHash: string,
): boolean {
  return (
    normalizeHex(vaultInnerModHash) === normalizeHex(registry.vaultInnerModHash) &&
    normalizeHex(vaultCanonicalParamsHash) === normalizeHex(registry.canonicalParamsHash)
  );
}

/**
 * Classify a vault against the registry, reporting which half of the version
 * identity diverged so the UI can explain *why* an upgrade is offered (a code
 * change, a params repair like the bridge-hash bug, or both).
 */
export function classifyVaultVersion(
  registry: RegistryState,
  vaultInnerModHash: string,
  vaultCanonicalParamsHash: string,
): VaultVersionStatus {
  const codeMatch =
    normalizeHex(vaultInnerModHash) === normalizeHex(registry.vaultInnerModHash);
  const paramsMatch =
    normalizeHex(vaultCanonicalParamsHash) === normalizeHex(registry.canonicalParamsHash);
  if (codeMatch && paramsMatch) {
    return { kind: 'current', registryVersion: registry.vaultVersion };
  }
  const reason = !codeMatch && !paramsMatch ? 'both' : !codeMatch ? 'code' : 'params';
  return { kind: 'outdated', reason, registryVersion: registry.vaultVersion };
}
