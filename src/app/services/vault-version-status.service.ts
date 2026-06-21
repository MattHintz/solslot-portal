/**
 * End-to-end vault-version status check.
 *
 * Reads the vault-version registry from chain, then reads the user's vault
 * parent-coin puzzle reveal from chain and extracts its canonical params hash
 * and inner mod hash.  No backend is used.
 *
 * Returns ``null`` if the registry is not configured, the vault has not been
 * spent (still at the eve coin), or the WASM SDK is not ready.
 */
import { Injectable, inject } from '@angular/core';

import { hexToBytes } from '../utils/chia-hash';
import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService } from './coinset.service';
import { computeCanonicalParamsHash, type VaultVersionStatus } from './vault-version-detection';
import { VaultVersionRegistryService } from './vault-version-registry.service';

export type { VaultVersionStatus };

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
}

interface ProgramShape {
  treeHash(): Uint8Array;
  uncurry(): { program: ProgramShape; args: ProgramShape } | undefined;
  toList(): ProgramShape[] | undefined;
  toAtom(): Uint8Array;
  toInt(): bigint;
}

/** Extracted vault descriptor from a spent vault coin's puzzle reveal. */
export interface VaultDescriptor {
  /** Tree hash of the vault singleton inner module. */
  vaultInnerModHash: string;
  /** Canonical protocol params hash for this vault. */
  canonicalParamsHash: string;
}

const SINGLETON_MOD_HASH = '7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
const SINGLETON_LAUNCHER_HASH = 'eff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';

/**
 * Parse a vault singleton's full puzzle reveal to recover its canonical
 * descriptor.  Exported for testing.
 *
 * The vault inner puzzle is curried as:
 *   0: SINGLETON_STRUCT
 *   1: OWNER_PUBKEY
 *   2: AUTH_TYPE
 *   3: MEMBERS_MERKLE_ROOT
 *   4: IDENTITY_ATTEST_ROOT
 *   5: ZKPASSPORT_BRIDGE_POLICY_HASH
 *   6: POOL_SINGLETON_MOD_HASH
 *   7: POOL_SINGLETON_LAUNCHER_ID
 *   8: POOL_SINGLETON_LAUNCHER_PUZZLE_HASH
 *
 * The canonical params hash is sha256tree of
 *   [POOL_SINGLETON_MOD_HASH, POOL_SINGLETON_LAUNCHER_ID,
 *    POOL_SINGLETON_LAUNCHER_PUZZLE_HASH, ZKPASSPORT_BRIDGE_POLICY_HASH].
 */
export function parseVaultFullPuzzleReveal(
  clvm: ClvmShape,
  puzzleReveal: Uint8Array,
): VaultDescriptor {
  const full = clvm.deserialize(puzzleReveal);
  const fullUncurried = full.uncurry();
  if (!fullUncurried) {
    throw new Error('vault puzzle reveal is not curried');
  }
  const fullArgs = fullUncurried.args.toList();
  if (!fullArgs || fullArgs.length !== 2) {
    throw new Error('vault puzzle reveal does not have singleton wrapper args');
  }
  const inner = fullArgs[1];
  const innerUncurried = inner.uncurry();
  if (!innerUncurried) {
    throw new Error('vault inner puzzle is not curried');
  }
  const args = innerUncurried.args.toList();
  if (!args || args.length !== 9) {
    throw new Error(`vault inner puzzle expects 9 curried args, got ${args?.length ?? 0}`);
  }

  const bridgePolicyHash = args[5].toAtom();
  const poolSingletonModHash = args[6].toAtom();
  const poolLauncherId = args[7].toAtom();
  const poolSingletonLauncherPuzzleHash = args[8].toAtom();
  const canonicalParamsHash = computeCanonicalParamsHash(
    '0x' + toHex(poolSingletonModHash),
    '0x' + toHex(poolLauncherId),
    '0x' + toHex(poolSingletonLauncherPuzzleHash),
    '0x' + toHex(bridgePolicyHash),
  );

  return {
    vaultInnerModHash: '0x' + toHex(innerUncurried.program.treeHash()),
    canonicalParamsHash,
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

@Injectable({ providedIn: 'root' })
export class VaultVersionStatusService {
  private readonly registry = inject(VaultVersionRegistryService);
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly coinset = inject(CoinsetService);
  private readonly wasm = inject(ChiaWasmService);

  /**
   * Check whether a vault is current against the on-chain registry.
   *
   * @param vaultLauncherId The vault's singleton launcher id.
   * @returns null when the registry is unavailable or the vault has not been
   * spent (eve state).
   */
  async checkVault(vaultLauncherId: string): Promise<VaultVersionStatus | null> {
    const registry = await this.registry.getCurrentState();
    if (!registry) {
      return null;
    }
    if (!this.wasm.ready()) {
      return null;
    }
    const lineage = await this.singleton.walkLineage(vaultLauncherId);
    if (!lineage) {
      return null;
    }
    const parent = this.vaultParentNode(lineage);
    if (!parent?.spentBlockIndex) {
      return null;
    }
    const ps = await this.coinset.getPuzzleAndSolution(parent.coinId, parent.spentBlockIndex);
    if (!ps) {
      return null;
    }
    const sdk = this.wasm.sdk();
    const Clvm = sdk['Clvm'];
    if (!Clvm) {
      return null;
    }
    const clvm: ClvmShape = new Clvm();
    const vault = parseVaultFullPuzzleReveal(clvm, hexToBytes(ps.puzzleReveal));
    return this.classify(registry, vault);
  }

  private classify(registry: import('./vault-version-detection').RegistryState, vault: VaultDescriptor): VaultVersionStatus {
    const codeMatch = this.eq(vault.vaultInnerModHash, registry.vaultInnerModHash);
    const paramsMatch = this.eq(vault.canonicalParamsHash, registry.canonicalParamsHash);
    if (codeMatch && paramsMatch) {
      return { kind: 'current', registryVersion: registry.vaultVersion };
    }
    const reason = !codeMatch && !paramsMatch ? 'both' : !codeMatch ? 'code' : 'params';
    return { kind: 'outdated', reason, registryVersion: registry.vaultVersion };
  }

  private eq(a: string, b: string): boolean {
    return a.toLowerCase().replace(/^0x/, '') === b.toLowerCase().replace(/^0x/, '');
  }

  /** Same parent selection logic as the registry reader. */
  private vaultParentNode(lineage: SingletonLineage): SingletonLineage['nodes'][number] | null {
    const spent = lineage.nodes.filter((n) => n.spentBlockIndex !== null);
    if (spent.length < 2) {
      return null;
    }
    return spent[spent.length - 1];
  }
}
