import { Injectable, inject } from '@angular/core';

import {
  ChiaSingletonReaderService,
  SingletonLineage,
  SingletonLineageNode,
} from '../chia-singleton-reader.service';
import { ChiaWasmService } from '../chia-wasm.service';
import { bytesToHex, hexToBytes } from '../../utils/chia-hash';

/**
 * Read-only A4 property-registry evidence.
 *
 * The current registry coin's puzzle reveal is not public until it is spent,
 * so this service reconstructs the live registered-id list from the latest
 * spend, mirroring the publish material builder.  It never mutates chain; it
 * only answers whether a canonical ``property_id_canon`` is present in the
 * current singleton state.
 */
@Injectable({ providedIn: 'root' })
export class PropertyRegistryChainStateService {
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly wasm = inject(ChiaWasmService);

  async checkProperty(
    args: CheckPropertyRegistryMembershipArgs,
  ): Promise<PropertyRegistryEvidence> {
    if (!is32ByteHex(args.registryLauncherId)) {
      return {
        kind: 'not-configured',
        error: 'Property registry launcher id is not configured.',
      };
    }
    if (!is32ByteHex(args.propertyIdCanon)) {
      return {
        kind: 'read-failed',
        error: 'propertyIdCanon must be a 32-byte hex string.',
      };
    }
    if (!this.wasm.ready()) {
      return { kind: 'read-failed', error: 'Chia WASM is not ready.' };
    }

    let lineage: SingletonLineage | null;
    try {
      lineage = await this.singleton.walkLineage(args.registryLauncherId);
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
    const current = lineage?.nodes[lineage.nodes.length - 1] ?? null;
    if (!lineage || !current || current.isLauncher) {
      return {
        kind: 'not-launched',
        error: 'Property registry has no current singleton coin yet.',
      };
    }

    let registeredIds: string[];
    let registryVersion: number;
    try {
      if (lineage.nodes.length === 2) {
        registeredIds = [];
        registryVersion = 0;
      } else {
        const decoded = await this.registeredIdsFromLatestSpend(lineage, current);
        registeredIds = decoded.registeredIds;
        registryVersion = decoded.registryVersion;
      }
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }

    const propertyIdCanon = args.propertyIdCanon.toLowerCase();
    const base = {
      registryLauncherId: args.registryLauncherId.toLowerCase(),
      propertyIdCanon,
      propertyRegistryPuzzleHash: current.puzzleHash,
      registeredIds,
      registryVersion,
      confirmedBlockIndex: current.confirmedBlockIndex,
      lineageDepth: lineage.nodes.length - 1,
    };
    if (registeredIds.some((id) => sameHex(id, propertyIdCanon))) {
      return { kind: 'confirmed-present', ...base };
    }
    return {
      kind: 'mismatch',
      reason: 'property-id-not-registered',
      ...base,
    };
  }

  private async registeredIdsFromLatestSpend(
    lineage: SingletonLineage,
    current: SingletonLineageNode,
  ): Promise<{ registeredIds: string[]; registryVersion: number }> {
    const replay = await this.singleton.replayLatestSpend(lineage);
    if (!replay || replay.node.isLauncher) {
      throw new Error('Cannot reconstruct registry state from launcher-only history.');
    }
    const clvm = this.clvm();
    const full = clvm.deserialize(hexToBytes(replay.puzzleAndSolution.puzzleReveal));
    const fullUncurried = full.uncurry();
    const fullArgs = fullUncurried
      ? curriedArgs(fullUncurried, 'latest registry puzzle reveal')
      : null;
    if (!fullUncurried || !fullArgs || fullArgs.length !== 2) {
      throw new Error('Latest registry puzzle reveal is not a curried singleton.');
    }
    const oldInner = fullArgs[1];
    const oldInnerUncurried = oldInner.uncurry();
    const oldInnerArgs = oldInnerUncurried
      ? curriedArgs(oldInnerUncurried, 'registry inner puzzle')
      : null;
    if (!oldInnerUncurried || !oldInnerArgs || oldInnerArgs.length !== 4) {
      throw new Error(
        `Registry inner puzzle expects 4 curried args, got ${oldInnerArgs?.length ?? 0}.`,
      );
    }

    const solution = clvm.deserialize(hexToBytes(replay.puzzleAndSolution.solution));
    const outer = requireList(solution, 'registry outer solution');
    if (outer.length !== 3) {
      throw new Error(`Registry outer solution expects 3 items, got ${outer.length}.`);
    }
    const innerSolution = requireList(outer[2], 'registry inner solution');
    if (innerSolution.length !== 4) {
      throw new Error(`Registry inner solution expects 4 items, got ${innerSolution.length}.`);
    }
    const latestPropertyId = bytes32Atom(innerSolution[1], 'property_id_canon');
    const previousIds = requireList(innerSolution[2], 'registered_ids').map((node, i) =>
      bytes32Atom(node, `registered_ids[${i}]`),
    );
    const registeredIdBytes = [latestPropertyId, ...previousIds];
    const newVersion = requireInt(innerSolution[3], 'new_registry_version');
    if (newVersion !== BigInt(registeredIdBytes.length)) {
      throw new Error(
        `Registry solution version ${newVersion} does not match recovered id count ${registeredIdBytes.length}.`,
      );
    }

    const currentRoot = clvm.list(registeredIdBytes.map((id) => clvm.atom(id))).treeHash();
    const currentInner = oldInnerUncurried.program.curry([
      oldInnerArgs[0],
      oldInnerArgs[1],
      clvm.atom(currentRoot),
      clvm.int(newVersion),
    ]);
    const currentFull = fullUncurried.program.curry([
      fullArgs[0],
      currentInner,
    ]);
    const rebuiltFullHash = bytesToHex(currentFull.treeHash());
    if (rebuiltFullHash !== current.puzzleHash) {
      throw new Error(
        `Reconstructed property registry full puzzle hash ${rebuiltFullHash} ` +
          `does not match current coin ${current.puzzleHash}.`,
      );
    }

    return {
      registeredIds: registeredIdBytes.map((id) => bytesToHex(id)),
      registryVersion: Number(newVersion),
    };
  }

  private clvm(): ClvmShape {
    const sdk = this.wasm.sdk() as { Clvm?: new () => ClvmShape };
    if (!sdk.Clvm) {
      throw new Error('Chia WASM Clvm export is unavailable.');
    }
    return new sdk.Clvm();
  }
}

export interface CheckPropertyRegistryMembershipArgs {
  registryLauncherId: string;
  propertyIdCanon: string;
}

export type PropertyRegistryEvidence =
  | {
      kind: 'confirmed-present';
      registryLauncherId: string;
      propertyIdCanon: string;
      propertyRegistryPuzzleHash: string;
      registeredIds: string[];
      registryVersion: number;
      confirmedBlockIndex: number;
      lineageDepth: number;
    }
  | {
      kind: 'mismatch';
      reason: 'property-id-not-registered';
      registryLauncherId: string;
      propertyIdCanon: string;
      propertyRegistryPuzzleHash: string;
      registeredIds: string[];
      registryVersion: number;
      confirmedBlockIndex: number;
      lineageDepth: number;
    }
  | { kind: 'not-configured'; error: string }
  | { kind: 'not-launched'; error: string }
  | { kind: 'read-failed'; error: string };

interface ProgramShape {
  treeHash(): Uint8Array;
  curry(args: ProgramShape[]): ProgramShape;
  uncurry(): UncurriedProgramShape | null;
  toList(): ProgramShape[] | null;
  toAtom(): Uint8Array | null;
  toInt(): bigint;
}

interface UncurriedProgramShape {
  program: ProgramShape;
  args: ProgramShape[] | ProgramShape;
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  atom(value: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
  list(value: ProgramShape[]): ProgramShape;
}

function requireList(node: ProgramShape, label: string): ProgramShape[] {
  const list = node.toList();
  if (!list) throw new Error(`${label} must be a CLVM list.`);
  return list;
}

function requireAtom(node: ProgramShape, label: string): Uint8Array {
  const atom = node.toAtom();
  if (!atom) throw new Error(`${label} must be a CLVM atom.`);
  return atom;
}

function bytes32Atom(node: ProgramShape, label: string): Uint8Array {
  const atom = requireAtom(node, label);
  if (atom.length !== 32) {
    throw new Error(`${label} must be 32 bytes, got ${atom.length}.`);
  }
  return atom;
}

function requireInt(node: ProgramShape, label: string): bigint {
  try {
    return node.toInt();
  } catch {
    throw new Error(`${label} must be a CLVM integer.`);
  }
}

function curriedArgs(
  uncurried: UncurriedProgramShape,
  label: string,
): ProgramShape[] {
  if (Array.isArray(uncurried.args)) {
    return uncurried.args;
  }
  const args = uncurried.args.toList();
  if (!args) {
    throw new Error(`${label} curried args must be a CLVM list.`);
  }
  return args;
}

function is32ByteHex(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
}

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase().replace(/^0x/, '') === b.toLowerCase().replace(/^0x/, '');
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
