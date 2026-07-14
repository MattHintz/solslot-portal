import { Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';
import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import {
  ChiaSingletonReaderService,
  ReplayedSpend,
  SingletonLineage,
  SingletonLineageNode,
} from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import type { CollectionNavEvidenceInput } from './pool-economics-v2.service';

@Injectable({ providedIn: 'root' })
export class PoolEconomicsV2NavRegistryChainStateService {
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly wasm = inject(ChiaWasmService);

  async readCollectionNav(
    args: ReadCollectionNavRegistryArgs,
  ): Promise<CollectionNavRegistryEvidence> {
    const registryLauncherId = normalize32(
      args.registryLauncherId ?? environment.solslotProtocol.collectionNavRegistryLauncherId,
    );
    const collectionIdCanon = normalize32(args.collectionIdCanon);
    if (!registryLauncherId) {
      return { kind: 'not-configured', error: 'Collection NAV registry launcher id is not configured.' };
    }
    if (!collectionIdCanon) {
      return { kind: 'read-failed', error: 'collectionIdCanon must be a 32-byte hex string.' };
    }
    if (!this.wasm.ready()) {
      return { kind: 'read-failed', error: 'Chia WASM is not ready.' };
    }

    let lineage: SingletonLineage | null;
    try {
      lineage = await this.singleton.walkLineage(registryLauncherId);
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
    const live = lineage?.nodes[lineage.nodes.length - 1] ?? null;
    if (!lineage || !live || live.isLauncher) {
      return {
        kind: 'not-launched',
        registryLauncherId,
        error: 'Collection NAV registry has no current singleton coin yet.',
      };
    }

    let replay: ReplayedSpend | null;
    try {
      replay = await this.singleton.replayLatestSpend(lineage);
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
    if (!replay || replay.node.isLauncher) {
      return {
        kind: 'not-spent',
        registryLauncherId,
        liveCoinId: live.coinId,
        livePuzzleHash: live.puzzleHash,
        confirmedBlockIndex: live.confirmedBlockIndex,
        lineageDepth: lineage.nodes.length - 1,
      };
    }

    try {
      const decoded = this.decodeCurrentRegistryState({
        replay,
        live,
        registryLauncherId,
      });
      const entry = decoded.entries.find((item) => sameHex(item.collectionIdCanon, collectionIdCanon));
      const base = {
        registryLauncherId,
        collectionIdCanon,
        registryCoinId: live.coinId,
        registryPuzzleHash: live.puzzleHash,
        collectionNavRoot: decoded.collectionNavRoot,
        registryVersion: decoded.registryVersion,
        entries: decoded.entries,
        confirmedBlockIndex: live.confirmedBlockIndex,
        lineageDepth: lineage.nodes.length - 1,
        latestSpendCoinId: replay.node.coinId,
        latestSpentBlockIndex: replay.node.spentBlockIndex,
      };
      if (!entry) {
        return { kind: 'mismatch', reason: 'collection-not-registered', ...base };
      }
      const navEvidence: CollectionNavEvidenceInput = {
        registryCoinId: live.coinId,
        registryPuzzleHash: live.puzzleHash,
        collectionIdCanon,
        navValueMojos: entry.navValueMojos,
        collectionNavRoot: decoded.collectionNavRoot,
        registryVersion: decoded.registryVersion,
      };
      return {
        kind: 'confirmed-present',
        ...base,
        navValueMojos: entry.navValueMojos,
        navEvidence,
        navEvidenceSpend: this.buildReadEvidenceSpend({
          decoded,
          live,
          replay,
          collectionIdCanon,
          navValueMojos: entry.navValueMojos,
        }),
      };
    } catch (e) {
      return { kind: 'read-failed', error: formatError(e) };
    }
  }

  private decodeCurrentRegistryState(args: {
    replay: ReplayedSpend;
    live: SingletonLineageNode;
    registryLauncherId: string;
  }): DecodedNavRegistryState {
    const clvm = this.clvm();
    const full = clvm.deserialize(hexToBytes(args.replay.puzzleAndSolution.puzzleReveal));
    const fullUncurried = full.uncurry();
    const fullArgs = fullUncurried ? curriedArgs(fullUncurried, 'NAV registry singleton puzzle') : null;
    if (!fullUncurried || !fullArgs || fullArgs.length !== 2) {
      throw new Error('Latest NAV registry puzzle reveal is not a curried singleton.');
    }

    const oldInner = fullArgs[1];
    const oldInnerUncurried = oldInner.uncurry();
    const oldInnerArgs = oldInnerUncurried ? curriedArgs(oldInnerUncurried, 'NAV registry inner puzzle') : null;
    if (!oldInnerUncurried || !oldInnerArgs || oldInnerArgs.length !== 4) {
      throw new Error(
        `NAV registry inner puzzle expects 4 curried args, got ${oldInnerArgs?.length ?? 0}.`,
      );
    }

    const oldRoot = bytes32Atom(oldInnerArgs[2], 'COLLECTION_NAV_ROOT');
    const oldVersion = requireInt(oldInnerArgs[3], 'REGISTRY_VERSION');
    const solution = clvm.deserialize(hexToBytes(args.replay.puzzleAndSolution.solution));
    const outer = requireList(solution, 'NAV registry singleton outer solution');
    if (outer.length !== 3) {
      throw new Error(`NAV registry outer solution expects 3 items, got ${outer.length}.`);
    }
    const innerSolution = requireList(outer[2], 'NAV registry inner solution');
    if (innerSolution.length !== 5) {
      throw new Error(`NAV registry inner solution expects 5 items, got ${innerSolution.length}.`);
    }
    const targetCollectionId = bytesToHex(bytes32Atom(innerSolution[1], 'collection_id_canon'));
    const navValueMojos = requireInt(innerSolution[2], 'nav_value_mojos');
    const previousEntries = navEntries(innerSolution[3]);
    const previousRoot = bytesToHex(entriesProgram(clvm, previousEntries).treeHash());
    if (!sameHex(previousRoot, bytesToHex(oldRoot))) {
      throw new Error(
        `NAV registry entries root ${previousRoot} does not match prior root ${bytesToHex(oldRoot)}.`,
      );
    }
    const newVersion = requireInt(innerSolution[4], 'new_registry_version');
    const entries =
      newVersion === oldVersion
        ? previousEntries
        : newVersion === oldVersion + 1n
          ? upsertNavEntry(previousEntries, targetCollectionId, navValueMojos)
          : null;
    if (!entries) {
      throw new Error(
        `NAV registry version transition ${oldVersion} -> ${newVersion} is not supported.`,
      );
    }
    if (newVersion === oldVersion) {
      const existing = entries.find((entry) => sameHex(entry.collectionIdCanon, targetCollectionId));
      if (!existing || existing.navValueMojos !== navValueMojos) {
        throw new Error('NAV read-evidence spend does not match current entries.');
      }
    }

    const collectionNavRoot = bytesToHex(entriesProgram(clvm, entries).treeHash());
    const currentInner = oldInnerUncurried.program.curry([
      oldInnerArgs[0],
      oldInnerArgs[1],
      clvm.atom(hexToBytes(collectionNavRoot)),
      clvm.int(newVersion),
    ]);
    const currentFull = fullUncurried.program.curry([fullArgs[0], currentInner]);
    const rebuiltFullPuzzleHash = bytesToHex(currentFull.treeHash());
    if (!sameHex(rebuiltFullPuzzleHash, args.live.puzzleHash)) {
      throw new Error(
        `Reconstructed NAV registry full puzzle hash ${rebuiltFullPuzzleHash} ` +
          `does not match current coin ${args.live.puzzleHash}.`,
      );
    }

    return {
      previousInnerPuzzleHash: bytesToHex(oldInner.treeHash()),
      currentFullPuzzleHex: bytesToHex(currentFull.serialize()),
      collectionNavRoot,
      registryVersion: newVersion,
      entries,
    };
  }

  private buildReadEvidenceSpend(args: {
    decoded: DecodedNavRegistryState;
    live: SingletonLineageNode;
    replay: ReplayedSpend;
    collectionIdCanon: string;
    navValueMojos: bigint;
  }): UnsignedCoinSpend {
    const clvm = this.clvm();
    const entries = entriesProgram(clvm, args.decoded.entries);
    const innerSolution = clvm.list([
      clvm.int(BigInt(args.live.amount)),
      clvm.atom(hexToBytes(args.collectionIdCanon)),
      clvm.int(args.navValueMojos),
      entries,
      clvm.int(args.decoded.registryVersion),
    ]);
    const fullSolution = clvm.list([
      encodeLineageProof(clvm, {
        parentName: args.replay.node.parentCoinId,
        innerPuzzleHash: args.decoded.previousInnerPuzzleHash,
        amount: args.replay.node.amount,
      }),
      clvm.int(BigInt(args.live.amount)),
      innerSolution,
    ]);
    return {
      coin: {
        parentCoinInfo: args.live.parentCoinId,
        puzzleHash: args.live.puzzleHash,
        amount: args.live.amount,
      },
      puzzleReveal: args.decoded.currentFullPuzzleHex,
      solution: bytesToHex(fullSolution.serialize()),
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

export interface ReadCollectionNavRegistryArgs {
  collectionIdCanon: string;
  registryLauncherId?: string | null;
}

export interface NavRegistryEntry {
  collectionIdCanon: string;
  navValueMojos: bigint;
}

export type CollectionNavRegistryEvidence =
  | {
      kind: 'confirmed-present';
      registryLauncherId: string;
      collectionIdCanon: string;
      registryCoinId: string;
      registryPuzzleHash: string;
      navValueMojos: bigint;
      collectionNavRoot: string;
      registryVersion: bigint;
      entries: NavRegistryEntry[];
      confirmedBlockIndex: number;
      lineageDepth: number;
      latestSpendCoinId: string;
      latestSpentBlockIndex: number | null;
      navEvidence: CollectionNavEvidenceInput;
      navEvidenceSpend: UnsignedCoinSpend;
    }
  | {
      kind: 'mismatch';
      reason: 'collection-not-registered';
      registryLauncherId: string;
      collectionIdCanon: string;
      registryCoinId: string;
      registryPuzzleHash: string;
      collectionNavRoot: string;
      registryVersion: bigint;
      entries: NavRegistryEntry[];
      confirmedBlockIndex: number;
      lineageDepth: number;
      latestSpendCoinId: string;
      latestSpentBlockIndex: number | null;
    }
  | {
      kind: 'not-spent';
      registryLauncherId: string;
      liveCoinId: string;
      livePuzzleHash: string;
      confirmedBlockIndex: number;
      lineageDepth: number;
    }
  | { kind: 'not-configured'; error: string }
  | { kind: 'not-launched'; registryLauncherId: string; error: string }
  | { kind: 'read-failed'; error: string };

interface DecodedNavRegistryState {
  previousInnerPuzzleHash: string;
  currentFullPuzzleHex: string;
  collectionNavRoot: string;
  registryVersion: bigint;
  entries: NavRegistryEntry[];
}

interface ProgramShape {
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
  curry(args: ProgramShape[]): ProgramShape;
  uncurry(): UncurriedProgramShape | null | undefined;
  toList(): ProgramShape[] | null | undefined;
  toAtom(): Uint8Array | null | undefined;
  toInt(): bigint;
  first(): ProgramShape;
  rest(): ProgramShape;
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
  pair(first: ProgramShape, rest: ProgramShape): ProgramShape;
  nil(): ProgramShape;
}

function navEntries(node: ProgramShape): NavRegistryEntry[] {
  return requireList(node, 'current_entries').map((entry, index) => {
    const collectionIdCanon = bytesToHex(bytes32Atom(entry.first(), `current_entries[${index}].collection_id`));
    const navValueMojos = requireInt(entry.rest(), `current_entries[${index}].nav_value_mojos`);
    if (navValueMojos <= 0n) {
      throw new Error(`current_entries[${index}].nav_value_mojos must be positive.`);
    }
    return { collectionIdCanon, navValueMojos };
  });
}

function entriesProgram(clvm: ClvmShape, entries: NavRegistryEntry[]): ProgramShape {
  return clvm.list(
    entries.map((entry) =>
      clvm.pair(clvm.atom(hexToBytes(entry.collectionIdCanon)), clvm.int(entry.navValueMojos)),
    ),
  );
}

function upsertNavEntry(
  entries: NavRegistryEntry[],
  collectionIdCanon: string,
  navValueMojos: bigint,
): NavRegistryEntry[] {
  if (navValueMojos <= 0n) {
    throw new Error('nav_value_mojos must be positive.');
  }
  const index = entries.findIndex((entry) => sameHex(entry.collectionIdCanon, collectionIdCanon));
  if (index === -1) {
    return [{ collectionIdCanon, navValueMojos }, ...entries];
  }
  return entries.map((entry, i) => (i === index ? { collectionIdCanon, navValueMojos } : entry));
}

function encodeLineageProof(
  clvm: ClvmShape,
  proof: { parentName: string; innerPuzzleHash: string; amount: number | bigint },
): ProgramShape {
  return clvm.list([
    clvm.atom(hexToBytes(proof.parentName)),
    clvm.atom(hexToBytes(proof.innerPuzzleHash)),
    clvm.int(BigInt(proof.amount)),
  ]);
}

function requireList(node: ProgramShape, label: string): ProgramShape[] {
  const list = node.toList();
  if (!list) throw new Error(`${label} must be a CLVM list.`);
  return list;
}

function atomBytes(node: ProgramShape, label: string): Uint8Array {
  const atom = node.toAtom();
  if (!atom) throw new Error(`${label} must be a CLVM atom.`);
  return atom;
}

function bytes32Atom(node: ProgramShape, label: string): Uint8Array {
  const atom = atomBytes(node, label);
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

function normalize32(value: string | null | undefined): string | null {
  if (!value) return null;
  const prefixed = value.startsWith('0x') || value.startsWith('0X') ? value : `0x${value}`;
  const normal = prefixed.toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normal) ? normal : null;
}

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase().replace(/^0x/, '') === b.toLowerCase().replace(/^0x/, '');
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
