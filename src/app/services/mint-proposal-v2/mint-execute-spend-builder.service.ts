import { Injectable, inject } from '@angular/core';

import { ChiaWasmService } from '../chia-wasm.service';
import type { UnsignedCoinSpend } from '../chia-wallet.service';
import type { LineageProofShape } from '../sgt-driver/sgt-vote-spend-builder.service';
import { bytesToHex, hexToBytes } from '../../utils/chia-hash';

import { MintProposalV2Service } from './mint-proposal-v2.service';
import { QUORUM_DID_INNER_PUZZLE_HEX } from './quorum-did-inner.puzzle-hex';
import { SINGLETON_LAUNCHER_WITH_DID_PUZZLE_HEX } from './singleton-launcher-with-did.puzzle-hex';

/** Builds the four non-governance spends in a canonical MINT execution. */
@Injectable({ providedIn: 'root' })
export class MintExecuteSpendBuilderService {
  private readonly wasm = inject(ChiaWasmService);
  private readonly proposal = inject(MintProposalV2Service);

  buildDidMintSpend(args: BuildDidMintSpendArgs): UnsignedCoinSpend {
    const clvm = this.clvm();
    const governanceStruct = clvm.deserialize(
      hexToBytes(normalizeHex(args.governanceSingletonStructHex)),
    );
    const didMod = clvm.deserialize(hexToBytes(QUORUM_DID_INNER_PUZZLE_HEX));
    const didInner = didMod.curry([
      clvm.atom(didMod.treeHash()),
      governanceStruct,
    ]);
    const fullPuzzle = this.singletonFullPuzzle(
      clvm,
      args.protocolDidSingletonStructHex,
      didInner,
    );
    this.assertPuzzleHash(fullPuzzle, args.didCoin.puzzleHash, 'protocol DID');
    return this.singletonSpend(
      clvm,
      args.didCoin,
      fullPuzzle,
      args.lineageProof,
      clvm.list([
        clvm.int(BigInt(args.didCoin.amount)),
        clvm.atom(bytes32(args.deedFullPuzzleHash, 'deedFullPuzzleHash')),
        clvm.atom(
          bytes32(args.governanceInnerPuzzleHash, 'governanceInnerPuzzleHash'),
        ),
      ]),
    );
  }

  buildProposalExecuteSpend(
    args: BuildProposalExecuteSpendArgs,
  ): UnsignedCoinSpend {
    const clvm = this.clvm();
    const currentInnerHex = this.proposal.makeInnerPuzzleHex({
      ownerMemberHash: args.ownerMemberHash,
      govMemberHash: args.govMemberHash,
      proposalDataHash: args.proposalDataHash,
      governanceSingletonStructHex: args.governanceSingletonStructHex,
      governanceProposalHash: args.governanceProposalHash,
      deedLauncherId: args.deedLauncherId,
      didInnerPuzzleHash: args.didInnerPuzzleHash,
      deedFullPuzzleHash: args.deedFullPuzzleHash,
      proposalState: MintProposalV2Service.STATE_DRAFT,
      stateVersion: 0,
    });
    const currentInner = clvm.deserialize(hexToBytes(currentInnerHex));
    const proposalStruct = this.standardSingletonStruct(
      clvm,
      args.proposalLauncherId,
    );
    const fullPuzzle = this.singletonTopLayer(clvm).curry([
      proposalStruct,
      currentInner,
    ]);
    this.assertPuzzleHash(fullPuzzle, args.proposalCoin.puzzleHash, 'mint proposal');
    const innerSolution = clvm.list([
      clvm.int(BigInt(args.proposalCoin.amount)),
      clvm.int(BigInt(MintProposalV2Service.TRANSITION_EXECUTE)),
      clvm.int(1n),
      clvm.atom(
        bytes32(args.governanceInnerPuzzleHash, 'governanceInnerPuzzleHash'),
      ),
      clvm.nil(),
    ]);
    return this.singletonSpend(
      clvm,
      args.proposalCoin,
      fullPuzzle,
      args.lineageProof,
      innerSolution,
    );
  }

  buildDeedLauncherSpend(args: BuildDeedLauncherSpendArgs): UnsignedCoinSpend {
    const clvm = this.clvm();
    const didStruct = clvm.deserialize(
      hexToBytes(normalizeHex(args.protocolDidSingletonStructHex)),
    );
    const launcherPuzzle = clvm
      .deserialize(hexToBytes(SINGLETON_LAUNCHER_WITH_DID_PUZZLE_HEX))
      .curry([didStruct]);
    this.assertPuzzleHash(launcherPuzzle, args.deedLauncherCoin.puzzleHash, 'deed launcher');
    const solution = clvm.list([
      clvm.atom(bytes32(args.didInnerPuzzleHash, 'didInnerPuzzleHash')),
      clvm.atom(bytes32(args.deedFullPuzzleHash, 'deedFullPuzzleHash')),
      clvm.int(BigInt(args.deedLauncherCoin.amount)),
      clvm.nil(),
    ]);
    return {
      coin: normalizedCoin(args.deedLauncherCoin),
      puzzleReveal: bytesToHex(launcherPuzzle.serialize()),
      solution: bytesToHex(solution.serialize()),
    };
  }

  private singletonSpend(
    clvm: ClvmShape,
    coin: CoinShape,
    fullPuzzle: ProgramShape,
    lineageProof: LineageProofShape,
    innerSolution: ProgramShape,
  ): UnsignedCoinSpend {
    const solution = clvm.list([
      encodeLineageProof(clvm, lineageProof),
      clvm.int(BigInt(coin.amount)),
      innerSolution,
    ]);
    return {
      coin: normalizedCoin(coin),
      puzzleReveal: bytesToHex(fullPuzzle.serialize()),
      solution: bytesToHex(solution.serialize()),
    };
  }

  private singletonFullPuzzle(
    clvm: ClvmShape,
    singletonStructHex: string,
    inner: ProgramShape,
  ): ProgramShape {
    return this.singletonTopLayer(clvm).curry([
      clvm.deserialize(hexToBytes(normalizeHex(singletonStructHex))),
      inner,
    ]);
  }

  private standardSingletonStruct(
    clvm: ClvmShape,
    launcherId: string,
  ): ProgramShape {
    return clvm.pair(
      clvm.atom(hexToBytes(MintProposalV2ServiceSingleton.SINGLETON_MOD_HASH)),
      clvm.pair(
        clvm.atom(bytes32(launcherId, 'proposalLauncherId')),
        clvm.atom(
          hexToBytes(MintProposalV2ServiceSingleton.SINGLETON_LAUNCHER_HASH),
        ),
      ),
    );
  }

  private singletonTopLayer(clvm: ClvmShape): ProgramShape {
    const constants = this.sdk().Constants;
    const bytes =
      constants?.singletonTopLayerV11?.() ?? constants?.singletonTopLayer?.();
    if (!bytes) throw new Error('Chia singleton top-layer bytecode is unavailable.');
    return clvm.deserialize(bytes);
  }

  private assertPuzzleHash(
    puzzle: ProgramShape,
    claimed: string,
    label: string,
  ): void {
    const actual = bytesToHex(puzzle.treeHash());
    if (actual !== normalizeHex(claimed)) {
      throw new Error(
        `${label} puzzle hash mismatch: reconstructed ${actual}, coin claims ${normalizeHex(claimed)}.`,
      );
    }
  }

  private sdk(): SdkShape {
    const sdk = this.wasm.sdk() as Partial<SdkShape>;
    if (!sdk.Clvm) throw new Error('Chia WASM Clvm export is unavailable.');
    return sdk as SdkShape;
  }

  private clvm(): ClvmShape {
    const Clvm = this.sdk().Clvm;
    return new Clvm();
  }
}

const MintProposalV2ServiceSingleton = {
  SINGLETON_MOD_HASH:
    '0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f',
  SINGLETON_LAUNCHER_HASH:
    '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9',
} as const;

export interface CoinShape {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: number | bigint;
}

interface SingletonSpendBase {
  lineageProof: LineageProofShape;
  governanceInnerPuzzleHash: string;
  deedFullPuzzleHash: string;
}

export interface BuildDidMintSpendArgs extends SingletonSpendBase {
  didCoin: CoinShape;
  protocolDidSingletonStructHex: string;
  governanceSingletonStructHex: string;
}

export interface BuildProposalExecuteSpendArgs extends SingletonSpendBase {
  proposalCoin: CoinShape;
  proposalLauncherId: string;
  ownerMemberHash: string;
  govMemberHash: string;
  proposalDataHash: string;
  governanceSingletonStructHex: string;
  governanceProposalHash: string;
  deedLauncherId: string;
  didInnerPuzzleHash: string;
}

export interface BuildDeedLauncherSpendArgs {
  deedLauncherCoin: CoinShape;
  protocolDidSingletonStructHex: string;
  didInnerPuzzleHash: string;
  deedFullPuzzleHash: string;
}

function encodeLineageProof(
  clvm: ClvmShape,
  proof: LineageProofShape,
): ProgramShape {
  if (!proof.parentName || proof.amount === undefined) {
    throw new Error('Singleton lineage proof requires parentName and amount.');
  }
  const parent = clvm.atom(bytes32(proof.parentName, 'lineage parentName'));
  const amount = clvm.int(BigInt(proof.amount));
  return proof.innerPuzzleHash
    ? clvm.list([
        parent,
        clvm.atom(bytes32(proof.innerPuzzleHash, 'lineage innerPuzzleHash')),
        amount,
      ])
    : clvm.list([parent, amount]);
}

function normalizedCoin(coin: CoinShape): UnsignedCoinSpend['coin'] {
  return {
    parentCoinInfo: normalizeHex(coin.parentCoinInfo),
    puzzleHash: normalizeHex(coin.puzzleHash),
    amount: BigInt(coin.amount),
  };
}

function bytes32(value: string, label: string): Uint8Array {
  const bytes = hexToBytes(normalizeHex(value));
  if (bytes.length !== 32) throw new Error(`${label} must be 32 bytes.`);
  return bytes;
}

function normalizeHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X')
    ? `0x${value.slice(2).toLowerCase()}`
    : `0x${value.toLowerCase()}`;
}

interface ProgramShape {
  curry(args: ProgramShape[]): ProgramShape;
  serialize(): Uint8Array;
  treeHash(): Uint8Array;
}

interface ClvmShape {
  atom(value: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
  list(value: ProgramShape[]): ProgramShape;
  pair(first: ProgramShape, rest: ProgramShape): ProgramShape;
  nil(): ProgramShape;
  deserialize(value: Uint8Array): ProgramShape;
}

interface SdkShape {
  Clvm: new () => ClvmShape;
  Constants?: {
    singletonTopLayerV11?: () => Uint8Array;
    singletonTopLayer?: () => Uint8Array;
  };
}
