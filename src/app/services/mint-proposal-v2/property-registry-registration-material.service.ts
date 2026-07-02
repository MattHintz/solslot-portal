import { Injectable, inject } from '@angular/core';

import {
  ChiaSingletonReaderService,
  SingletonLineage,
  SingletonLineageNode,
} from '../chia-singleton-reader.service';
import { ChiaWasmService } from '../chia-wasm.service';
import { bytesToHex, hexToBytes } from '../../utils/chia-hash';

import {
  LineageProofShape,
} from '../pgt-driver/pgt-vote-spend-builder.service';
import {
  MintPublishSpendBuilderService,
  PropertyRegistryRegistrationSpend,
} from './mint-publish-spend-builder.service';

/**
 * Resolves the A4 property-registry registration co-spend material for mint
 * publish.
 *
 * The current unspent registry coin does not reveal its inner puzzle.  This
 * service reconstructs it from either:
 *
 *   * the latest prior registry spend (normal non-eve case), or
 *   * the operator-pinned GOV_PUBKEY for a fresh/eve registry with no prior
 *     registration spends.
 */
@Injectable({ providedIn: 'root' })
export class PropertyRegistryRegistrationMaterialService {
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly wasm = inject(ChiaWasmService);
  private readonly spendBuilder = inject(MintPublishSpendBuilderService);

  async build(args: BuildPropertyRegistryRegistrationMaterialArgs): Promise<PropertyRegistryRegistrationMaterialResult> {
    if (!is32ByteHex(args.registryLauncherId)) {
      return { kind: 'not-configured', error: 'Property registry launcher id is not configured.' };
    }
    if (!is32ByteHex(args.propertyIdCanon)) {
      return { kind: 'invalid-input', error: 'propertyIdCanon must be a 32-byte hex string.' };
    }
    if (!this.wasm.ready()) {
      return { kind: 'wasm-not-ready', error: 'Chia WASM is not ready.' };
    }

    let lineage: SingletonLineage | null;
    try {
      lineage = await this.singleton.walkLineage(args.registryLauncherId);
    } catch (e) {
      return { kind: 'chain-read-failed', error: formatError(e) };
    }
    const current = lineage?.nodes[lineage.nodes.length - 1] ?? null;
    if (!lineage || !current || current.isLauncher) {
      return { kind: 'not-launched', error: 'Property registry has no current singleton coin yet.' };
    }

    let material: RegistrySpendMaterial;
    try {
      material =
        lineage.nodes.length === 2
          ? this.materialFromFreshRegistry(lineage, current, args.registryGovPubkey)
          : await this.materialFromLatestRegistrySpend(lineage, current);
    } catch (e) {
      return { kind: 'material-build-failed', error: formatError(e) };
    }

    try {
      const spend = this.spendBuilder.buildPropertyRegistryRegistrationCoinSpend({
        registryCoin: {
          parentCoinInfo: current.parentCoinId,
          puzzleHash: current.puzzleHash,
          amount: current.amount,
        },
        registryInnerPuzzleHex: material.registryInnerPuzzleHex,
        registryLauncherId: args.registryLauncherId,
        lineageProof: material.lineageProof,
        propertyIdCanon: args.propertyIdCanon,
        registeredIds: material.registeredIds,
      });
      return {
        kind: 'ok',
        spend,
        propertyRegistryPuzzleHash: current.puzzleHash,
        registryInnerPuzzleHex: material.registryInnerPuzzleHex,
        registeredIds: material.registeredIds,
      };
    } catch (e) {
      return { kind: 'material-build-failed', error: formatError(e) };
    }
  }

  private materialFromFreshRegistry(
    lineage: SingletonLineage,
    _current: SingletonLineageNode,
    registryGovPubkey: string | undefined,
  ): RegistrySpendMaterial {
    if (!is48ByteHex(registryGovPubkey)) {
      throw new Error(
        'Fresh property registry requires environment.populisProtocol.propertyRegistryGovPubkey.',
      );
    }
    return {
      registryInnerPuzzleHex: this.spendBuilder.makePropertyRegistryInnerPuzzleHex({
        govPubkey: registryGovPubkey,
        registeredIds: [],
      }),
      registeredIds: [],
      lineageProof: {
        parentName: normalizeHex(lineage.launcher.coin.parent_coin_info),
        amount: lineage.launcher.coin.amount,
      },
    };
  }

  private async materialFromLatestRegistrySpend(
    lineage: SingletonLineage,
    current: SingletonLineageNode,
  ): Promise<RegistrySpendMaterial> {
    const replay = await this.singleton.replayLatestSpend(lineage);
    if (!replay || replay.node.isLauncher) {
      throw new Error('Cannot reconstruct registry inner puzzle from launcher-only history.');
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
    const latestPropertyId = requireAtom(innerSolution[1], 'property_id_canon');
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
      registryInnerPuzzleHex: bytesToHex(currentInner.serialize()),
      registeredIds: registeredIdBytes.map((id) => bytesToHex(id)),
      lineageProof: {
        parentName: replay.node.parentCoinId,
        innerPuzzleHash: bytesToHex(oldInner.treeHash()),
        amount: replay.node.amount,
      },
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

export interface BuildPropertyRegistryRegistrationMaterialArgs {
  registryLauncherId: string;
  registryGovPubkey?: string;
  propertyIdCanon: string;
}

export type PropertyRegistryRegistrationMaterialResult =
  | {
      kind: 'ok';
      spend: PropertyRegistryRegistrationSpend;
      propertyRegistryPuzzleHash: string;
      registryInnerPuzzleHex: string;
      registeredIds: string[];
    }
  | {
      kind:
        | 'not-configured'
        | 'invalid-input'
        | 'wasm-not-ready'
        | 'chain-read-failed'
        | 'not-launched'
        | 'material-build-failed';
      error: string;
    };

interface RegistrySpendMaterial {
  registryInnerPuzzleHex: string;
  registeredIds: string[];
  lineageProof: LineageProofShape;
}

interface ProgramShape {
  serialize(): Uint8Array;
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

function is48ByteHex(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{96}$/.test(v);
}

function normalizeHex(s: string): string {
  return s.startsWith('0x') || s.startsWith('0X') ? s : '0x' + s;
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
