/** Reads the registry's confirmed successor, including the last publish transition.
 * A spent parent's reveal describes its INPUT; the solution and current output
 * hash are needed to reconstruct the current descriptor. Eve without a verified
 * reveal remains unavailable, never guessed from application configuration.
 */
import { Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';
import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService } from './coinset.service';
import { reconstructSingletonOutput, OutputProgram } from './singleton-output-state';
import type { RegistryState } from './vault-version-detection';

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
}

type ProgramShape = OutputProgram;

export interface RegistryReadResult {
  /** Canonical state parsed from the on-chain registry. */
  state: RegistryState;
  /** Depth of the current coin in the lineage (1 = eve). */
  lineageDepth: number;
}

/**
 * Parse a registry singleton's full puzzle reveal to recover the curried
 * state.  Exported so the orchestration logic can be tested independently of
 * chain reads.
 *
 * @throws if the reveal is not a curried singleton, the inner puzzle is not an
 * instance of ``vault_version_registry_inner.clsp``, or the curry args are
 * malformed.
 */
export function parseRegistryFullPuzzleReveal(
  clvm: ClvmShape,
  registryModHash: Uint8Array,
  puzzleReveal: Uint8Array,
): RegistryState {
  const full = clvm.deserialize(puzzleReveal);
  const fullUncurried = full.uncurry();
  if (!fullUncurried) {
    throw new Error('registry puzzle reveal is not curried');
  }
  const fullArgs = fullUncurried.args;
  if (!fullArgs || fullArgs.length !== 2) {
    throw new Error('registry puzzle reveal does not have singleton wrapper args');
  }
  const inner = fullArgs[1];
  const innerUncurried = inner.uncurry();
  if (!innerUncurried) {
    throw new Error('registry inner puzzle is not curried');
  }
  const modHash = innerUncurried.program.treeHash();
  if (!bytesEqual(modHash, registryModHash)) {
    throw new Error(
      `registry inner puzzle mod hash mismatch: got ${bytesToHex(modHash)} expected ${bytesToHex(
        registryModHash,
      )}`,
    );
  }
  const args = innerUncurried.args;
  if (!args || args.length !== 8) {
    throw new Error(`registry inner puzzle expects 8 curried args, got ${args?.length ?? 0}`);
  }

  // Curried args (in order):
  //   0: SELF_MOD_HASH
  //   1: SINGLETON_MOD_HASH
  //   2: LAUNCHER_PUZZLE_HASH
  //   3: ADMIN_AUTHORITY_LAUNCHER_ID
  //   4: GOVERNANCE_LAUNCHER_ID
  //   5: VAULT_INNER_MOD_HASH
  //   6: CANONICAL_PARAMS_HASH
  //   7: VAULT_VERSION
  const version = args[7].toInt();
  if (args[5].toAtom().length !== 32 || args[6].toAtom().length !== 32 ||
      version < 0n || version > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Registry descriptor cannot be represented safely.');
  }
  return {
    vaultInnerModHash: bytesToHex(args[5].toAtom()),
    canonicalParamsHash: bytesToHex(args[6].toAtom()),
    vaultVersion: Number(version),
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

@Injectable({ providedIn: 'root' })
export class VaultVersionRegistryService {
  private readonly coinset = inject(CoinsetService);
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly wasm = inject(ChiaWasmService);

  /**
   * Read the current vault-version registry state from coinset.org.
   *
   * Returns ``null`` if the registry is not configured, not found, or has not yet
   * been spent (eve state).  The caller should treat ``null`` as "registry not
   * available / no upgrade signal".
   */
  async getCurrentState(): Promise<RegistryState | null> {
    const launcherId = environment.solslotProtocol.vaultVersionRegistryLauncherId;
    if (!launcherId) {
      return null;
    }
    if (!this.wasm.ready()) {
      return null;
    }
    const lineage = await this.singleton.walkLineage(launcherId);
    if (!lineage) {
      return null;
    }
    const parent = this.registryParentNode(lineage);
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
    const registryModHash = hexToBytes(environment.solslotProtocol.vaultVersionRegistryModHash);
    const current = lineage.nodes[lineage.nodes.length - 1];
    if (!current || current.spentBlockIndex !== null || current.parentCoinId !== parent.coinId) {
      throw new Error('Registry lineage changed. Refresh chain status.');
    }
    const reveal = reconstructSingletonOutput(clvm, hexToBytes(ps.puzzleReveal), hexToBytes(ps.solution),
      hexToBytes(parent.puzzleHash), hexToBytes(current.puzzleHash), 'registry', registryModHash);
    return parseRegistryFullPuzzleReveal(clvm, registryModHash, reveal);
  }

  /**
   * Return the spent input whose transition created the current state coin.  This is the most recently spent non-launcher node; if the
   * registry is still at the eve coin, the only spent node is the launcher and
   * we cannot yet recover the inner puzzle from chain.
   */
  private registryParentNode(lineage: SingletonLineage): SingletonLineage['nodes'][number] | null {
    const spent = lineage.nodes.filter((n) => n.spentBlockIndex !== null);
    if (spent.length < 2) {
      return null;
    }
    return spent[spent.length - 1];
  }
}
