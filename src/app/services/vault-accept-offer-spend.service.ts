import { Injectable, inject } from '@angular/core';
import { sha256 } from 'ethers';

import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService } from './coinset.service';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import type { OfferDetail } from './offer-domain';
import {
  protocolCoordinateFromEnvironment,
  resolveProtocolCoordinate,
} from './protocol-coordinate-guard';
import { VAULT_SINGLETON_INNER_PUZZLE_HEX } from './zkpassport-vault-enrollment.puzzle-hex';
import type { VaultAcceptOfferProofParams } from './zkpassport-accept-offer-proof.service';
import { AUTH_TYPE_BLS, AUTH_TYPE_SECP256K1, AUTH_TYPE_SECP256R1, bytesToHex, coinId, hexToBytes } from '../utils/chia-hash';

const SINGLETON_MOD_HASH = '0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
const SINGLETON_LAUNCHER_HASH = '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';
const DEFAULT_ZKPASSPORT_BRIDGE_POLICY_HASH = '0x' + '00'.repeat(32);
const SPEND_ACCEPT_OFFER = 0x61;
const ZERO_BYTES32 = '0x' + '00'.repeat(32);
const ZKPASSPORT_EMPTY_ATTEST_ROOT =
  '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a';

@Injectable({ providedIn: 'root' })
export class VaultAcceptOfferSpendService {
  private readonly wasm = inject(ChiaWasmService);
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly coinset = inject(CoinsetService);

  async buildFromChain(args: ChainVaultAcceptOfferBuildRequest): Promise<VaultAcceptOfferSpendPackage> {
    const lineage = await this.singleton.walkLineage(args.vaultLauncherId);
    if (!lineage) {
      throw new Error('vault accept-offer spend: vault lineage is not confirmed on chain');
    }
    const current = lineage.nodes[lineage.nodes.length - 1];
    if (!current || current.isLauncher) {
      throw new Error('vault accept-offer spend: vault singleton has no current state coin');
    }
    const expectedCoinId = normalizeHex(args.vaultCoinId);
    if (normalizeHex(current.coinId) !== expectedCoinId) {
      throw new Error(
        `vault accept-offer spend: current vault coin changed from ${expectedCoinId} to ${current.coinId}`,
      );
    }
    const lineageProof = await this.lineageProofForCurrentCoin(lineage);
    return this.buildResolved({
      ...args,
      signatureData: args.signatureData ?? null,
      vaultCoin: {
        parentCoinInfo: current.parentCoinId,
        puzzleHash: current.puzzleHash,
        amount: current.amount,
        coinId: current.coinId,
      },
      lineageProof,
    });
  }

  buildResolved(input: VaultAcceptOfferBuilderInput): VaultAcceptOfferSpendPackage {
    const clvm = this.clvm();
    const offerFields = normalizeOffer(input.offer);
    const vaultLauncherId = bytes32(input.vaultLauncherId, 'vaultLauncherId');
    const ownerPubkey = ownerPubkeyBytes(input.ownerPubkey, input.authType);
    const authType = assertPositiveInteger(input.authType, 'authType');
    if (authType !== AUTH_TYPE_BLS) {
      throw new Error('vault accept-offer spend: accept-offer is currently BLS-only');
    }
    const membersMerkleRoot = input.membersMerkleRoot
      ? bytes32(input.membersMerkleRoot, 'membersMerkleRoot')
      : oneLeafMerkleRoot(ownerPubkey);
    const poolLauncherIdHex = resolveProtocolCoordinate({
      coordinateName: 'pool launcher id',
      pinned: protocolCoordinateFromEnvironment('poolLauncherId'),
      candidate: input.poolLauncherId,
      candidateLabel: 'builder input',
      errorPrefix: 'vault accept-offer spend',
    });
    if (!poolLauncherIdHex) {
      throw new Error('vault accept-offer spend: pool launcher id is not configured');
    }
    const poolLauncherId = bytes32(poolLauncherIdHex, 'poolLauncherId');
    const bridgePolicyHashHex =
      resolveProtocolCoordinate({
        coordinateName: 'bridge policy hash',
        pinned: protocolCoordinateFromEnvironment('bridgePolicyHash'),
        candidate: input.bridgePolicyHash,
        candidateLabel: 'builder input',
        errorPrefix: 'vault accept-offer spend',
      }) ?? DEFAULT_ZKPASSPORT_BRIDGE_POLICY_HASH;
    const poolInnerPuzzleHashHex = resolveProtocolCoordinate({
      coordinateName: 'pool inner puzzle hash',
      pinned: protocolCoordinateFromEnvironment('poolInnerPuzzleHash'),
      candidate: input.poolInnerPuzzleHash,
      candidateLabel: 'builder input',
      errorPrefix: 'vault accept-offer spend',
    });
    if (!poolInnerPuzzleHashHex) {
      throw new Error('vault accept-offer spend: pool inner puzzle hash is not configured');
    }
    const bridgePolicyHash = bytes32(bridgePolicyHashHex, 'bridgePolicyHash');
    const poolInnerPuzzleHash = bytes32(poolInnerPuzzleHashHex, 'poolInnerPuzzleHash');
    const identityAttestRoot = bytes32(input.identityAttestRoot, 'identityAttestRoot');
    const attestationLeafHash = bytes32(input.attestationLeafHash, 'attestationLeafHash');
    if (bytesToHex(identityAttestRoot) === ZKPASSPORT_EMPTY_ATTEST_ROOT) {
      throw new Error('vault accept-offer spend: identityAttestRoot must be enrolled before accepting offers');
    }
    if (bytesToHex(bridgePolicyHash) === ZERO_BYTES32) {
      throw new Error('vault accept-offer spend: bridgePolicyHash must be pinned before accepting offers');
    }
    if (bytesToHex(poolInnerPuzzleHash) === ZERO_BYTES32) {
      throw new Error('vault accept-offer spend: poolInnerPuzzleHash must not be zero');
    }
    const currentTimestamp = assertNonNegativeInteger(input.currentTimestamp, 'currentTimestamp');
    const signatureData = input.signatureData ? hexToBytes(input.signatureData) : new Uint8Array(0);
    const vaultCoin = normalizeCoin(input.vaultCoin, 'vault accept-offer spend');
    const vaultCoinId = coinId(vaultCoin.parentCoinInfo, vaultCoin.puzzleHash, vaultCoin.amount);

    const singletonStruct = this.singletonStructProgram(clvm, vaultLauncherId);
    const vaultMod = clvm.deserialize(hexToBytes(VAULT_SINGLETON_INNER_PUZZLE_HEX));
    const vaultInnerPuzzle = vaultMod.curry([
      singletonStruct,
      clvm.atom(ownerPubkey),
      clvm.int(BigInt(authType)),
      clvm.atom(membersMerkleRoot),
      clvm.atom(identityAttestRoot),
      clvm.atom(bridgePolicyHash),
      clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
      clvm.atom(poolLauncherId),
      clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH)),
    ]);
    const vaultInnerPuzzleHash = vaultInnerPuzzle.treeHash();
    const vaultFullPuzzle = this.singletonFullPuzzle(clvm, singletonStruct, vaultInnerPuzzle);
    const vaultFullPuzzleHash = vaultFullPuzzle.treeHash();
    if (bytesToHex(vaultFullPuzzleHash) !== normalizeHex(vaultCoin.puzzleHash)) {
      throw new Error('vault accept-offer spend: reconstructed vault puzzle hash does not match current coin');
    }

    const innerSolution = this.innerSolution(clvm, {
      vaultCoinId,
      vaultInnerPuzzleHash: bytesToHex(vaultInnerPuzzleHash),
      vaultAmount: vaultCoin.amount,
      deedLauncherId: offerFields.deedLauncherId,
      tokenAmount: offerFields.tokenAmount,
      poolInnerPuzzleHash: bytesToHex(poolInnerPuzzleHash),
      attestationLeafHash: bytesToHex(attestationLeafHash),
      attestationProof: input.attestationProof,
      currentTimestamp,
      signatureData: input.signatureData,
    });
    const fullSolution = this.singletonSolution(clvm, input.lineageProof, vaultCoin.amount, innerSolution);
    const expectedNextVaultCoinId = coinId(vaultCoinId, vaultFullPuzzleHash, vaultCoin.amount);
    const coinSpends: UnsignedCoinSpend[] = [
      {
        coin: {
          parentCoinInfo: normalizeHex(vaultCoin.parentCoinInfo),
          puzzleHash: normalizeHex(vaultCoin.puzzleHash),
          amount: vaultCoin.amount,
        },
        puzzleReveal: bytesToHex(vaultFullPuzzle.serialize()),
        solution: bytesToHex(fullSolution.serialize()),
      },
    ];

    return {
      status: 'unsigned',
      backendSigning: false,
      spendCase: '0x61',
      authType,
      vaultLauncherId: bytesToHex(vaultLauncherId),
      offerId: input.offer.id,
      offerArtifactId: input.offer.artifact?.artifactId ?? null,
      deedLauncherId: offerFields.deedLauncherId,
      tokenAmount: offerFields.tokenAmount,
      poolInnerPuzzleHash: bytesToHex(poolInnerPuzzleHash),
      identityAttestRoot: bytesToHex(identityAttestRoot),
      attestationLeafHash: bytesToHex(attestationLeafHash),
      attestationProof: normalizeAttestationProof(input.attestationProof),
      vaultCoin: {
        parentCoinInfo: normalizeHex(vaultCoin.parentCoinInfo),
        puzzleHash: normalizeHex(vaultCoin.puzzleHash),
        amount: vaultCoin.amount,
        coinId: vaultCoinId,
      },
      vaultInnerPuzzleHash: bytesToHex(vaultInnerPuzzleHash),
      vaultFullPuzzleHash: bytesToHex(vaultFullPuzzleHash),
      expectedNextVaultCoin: {
        parentCoinInfo: vaultCoinId,
        puzzleHash: bytesToHex(vaultFullPuzzleHash),
        amount: vaultCoin.amount,
        coinId: expectedNextVaultCoinId,
      },
      lineageProof: {
        parentParentCoinInfo: normalizeHex(input.lineageProof.parentParentCoinInfo),
        parentInnerPuzzleHash: input.lineageProof.parentInnerPuzzleHash
          ? normalizeHex(input.lineageProof.parentInnerPuzzleHash)
          : null,
        parentAmount: input.lineageProof.parentAmount,
      },
      acceptOfferInnerSolution: bytesToHex(innerSolution.serialize()),
      acceptOfferInnerSolutionTreeHash: bytesToHex(innerSolution.treeHash()),
      vaultSignatureData: bytesToHex(signatureData),
      coinSpends,
      unsignedSpendBundle: {
        coinSpends,
        aggregatedSignature: null,
      },
    };
  }

  buildInnerSolution(input: VaultAcceptOfferInnerSolutionInput): VaultAcceptOfferInnerSolutionVector {
    const clvm = this.clvm();
    const innerSolution = this.innerSolution(clvm, input);
    return {
      serializedSolution: bytesToHex(innerSolution.serialize()),
      solutionTreeHash: bytesToHex(innerSolution.treeHash()),
    };
  }

  private innerSolution(clvm: ClvmShape, input: VaultAcceptOfferInnerSolutionInput): ProgramShape {
    const vaultCoinId = bytes32(input.vaultCoinId, 'vaultCoinId');
    const vaultInnerPuzzleHash = bytes32(input.vaultInnerPuzzleHash, 'vaultInnerPuzzleHash');
    const vaultAmount = assertPositiveInteger(input.vaultAmount, 'vaultAmount');
    const deedLauncherId = bytes32(input.deedLauncherId, 'deedLauncherId');
    const tokenAmount = assertPositiveInteger(input.tokenAmount, 'tokenAmount');
    const poolInnerPuzzleHash = bytes32(input.poolInnerPuzzleHash, 'poolInnerPuzzleHash');
    const attestationLeafHash = bytes32(input.attestationLeafHash, 'attestationLeafHash');
    const currentTimestamp = assertNonNegativeInteger(input.currentTimestamp, 'currentTimestamp');
    const signatureData = input.signatureData ? hexToBytes(input.signatureData) : new Uint8Array(0);
    return clvm.list([
      clvm.atom(vaultCoinId),
      clvm.atom(vaultInnerPuzzleHash),
      clvm.int(BigInt(vaultAmount)),
      clvm.int(BigInt(SPEND_ACCEPT_OFFER)),
      clvm.list([
        clvm.atom(deedLauncherId),
        clvm.int(BigInt(tokenAmount)),
        clvm.atom(poolInnerPuzzleHash),
        clvm.atom(attestationLeafHash),
        this.attestationProofProgram(clvm, input.attestationProof),
        clvm.int(BigInt(currentTimestamp)),
        clvm.atom(signatureData),
      ]),
    ]);
  }

  private attestationProofProgram(clvm: ClvmShape, proof: VaultAcceptOfferAttestationProof): ProgramShape {
    const bitpath = assertNonNegativeInteger(proof.bitpath, 'attestationProof.bitpath');
    return clvm.pair(
      clvm.int(BigInt(bitpath)),
      clvm.list(proof.siblings.map((sibling, index) => clvm.atom(bytes32(sibling, `attestationProof.siblings[${index}]`)))),
    );
  }

  private async lineageProofForCurrentCoin(lineage: SingletonLineage): Promise<VaultAcceptOfferLineageProof> {
    const currentIndex = lineage.nodes.length - 1;
    const parent = lineage.nodes[currentIndex - 1];
    if (!parent) {
      throw new Error('vault accept-offer spend: missing parent for current vault coin');
    }
    if (parent.isLauncher) {
      return {
        parentParentCoinInfo: normalizeHex(lineage.launcher.coin.parent_coin_info),
        parentInnerPuzzleHash: null,
        parentAmount: lineage.launcher.coin.amount,
      };
    }
    if (parent.spentBlockIndex === null) {
      throw new Error('vault accept-offer spend: parent spend height is unavailable');
    }
    const parentSpend = await this.coinset.getPuzzleAndSolution(parent.coinId, parent.spentBlockIndex);
    if (!parentSpend) {
      throw new Error('vault accept-offer spend: parent puzzle reveal is unavailable');
    }
    return {
      parentParentCoinInfo: parent.parentCoinId,
      parentInnerPuzzleHash: bytesToHex(this.extractSingletonInnerPuzzleHash(parentSpend.puzzleReveal)),
      parentAmount: parent.amount,
    };
  }

  private extractSingletonInnerPuzzleHash(puzzleReveal: string): Uint8Array {
    const clvm = this.clvm();
    const puzzle = clvm.deserialize(hexToBytes(puzzleReveal));
    const uncurried = puzzle.uncurry();
    if (!uncurried) {
      throw new Error('vault accept-offer spend: parent singleton puzzle is not curried');
    }
    const args = uncurried.args.toList();
    if (!args || args.length !== 2) {
      throw new Error('vault accept-offer spend: parent singleton puzzle has unexpected curry args');
    }
    return args[1].treeHash();
  }

  private singletonStructProgram(clvm: ClvmShape, launcherId: Uint8Array): ProgramShape {
    return clvm.pair(
      clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
      clvm.pair(clvm.atom(launcherId), clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH))),
    );
  }

  private singletonFullPuzzle(clvm: ClvmShape, singletonStruct: ProgramShape, innerPuzzle: ProgramShape): ProgramShape {
    const constants = this.sdk().Constants;
    const topLayer = constants?.singletonTopLayerV11?.() ?? constants?.singletonTopLayer?.();
    if (!topLayer) {
      throw new Error('vault accept-offer spend: singleton top-layer bytecode unavailable in WASM SDK');
    }
    return clvm.deserialize(topLayer).curry([singletonStruct, innerPuzzle]);
  }

  private singletonSolution(
    clvm: ClvmShape,
    lineageProof: VaultAcceptOfferLineageProof,
    amount: number,
    innerSolution: ProgramShape,
  ): ProgramShape {
    const parentInfo = lineageProof.parentInnerPuzzleHash
      ? clvm.list([
          clvm.atom(bytes32(lineageProof.parentParentCoinInfo, 'lineage.parentParentCoinInfo')),
          clvm.atom(bytes32(lineageProof.parentInnerPuzzleHash, 'lineage.parentInnerPuzzleHash')),
          clvm.int(BigInt(lineageProof.parentAmount)),
        ])
      : clvm.list([
          clvm.atom(bytes32(lineageProof.parentParentCoinInfo, 'lineage.parentParentCoinInfo')),
          clvm.int(BigInt(lineageProof.parentAmount)),
        ]);
    return clvm.list([parentInfo, clvm.int(BigInt(amount)), innerSolution]);
  }

  private sdk(): SdkShape {
    const sdk = this.wasm.sdk() as SdkShape;
    if (!sdk.Clvm) {
      throw new Error('vault accept-offer spend: chia-wallet-sdk-wasm Clvm export unavailable');
    }
    return sdk;
  }

  private clvm(): ClvmShape {
    const Clvm = this.sdk().Clvm;
    return new Clvm();
  }
}

export interface ChainVaultAcceptOfferBuildRequest extends Omit<VaultAcceptOfferBuilderInput, 'vaultCoin' | 'lineageProof'> {
  vaultCoinId: string;
}

export interface VaultAcceptOfferBuildRequest {
  vaultLauncherId: string;
  ownerPubkey: string;
  authType: number;
  membersMerkleRoot?: string;
  poolLauncherId?: string;
  bridgePolicyHash?: string;
  vaultCoin: CoinWithIdInput;
  lineageProof: VaultAcceptOfferLineageProof;
  offer: OfferDetail;
  poolInnerPuzzleHash: string;
  currentTimestamp: number;
  signatureData?: string | null;
}

export interface VaultAcceptOfferBuilderInput extends VaultAcceptOfferBuildRequest, VaultAcceptOfferProofParams {
  signatureData: string | null;
}

export interface VaultAcceptOfferInnerSolutionInput {
  vaultCoinId: string;
  vaultInnerPuzzleHash: string;
  vaultAmount: number;
  deedLauncherId: string;
  tokenAmount: number;
  poolInnerPuzzleHash: string;
  attestationLeafHash: string;
  attestationProof: VaultAcceptOfferAttestationProof;
  currentTimestamp: number;
  signatureData?: string | null;
}

export interface VaultAcceptOfferInnerSolutionVector {
  serializedSolution: string;
  solutionTreeHash: string;
}

export interface VaultAcceptOfferAttestationProof {
  bitpath: number;
  siblings: string[];
}

export interface VaultAcceptOfferLineageProof {
  parentParentCoinInfo: string;
  parentInnerPuzzleHash: string | null;
  parentAmount: number;
}

export interface CoinWithIdInput {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: number;
  coinId?: string;
}

export interface VaultAcceptOfferSpendPackage {
  status: 'unsigned';
  backendSigning: false;
  spendCase: '0x61';
  authType: number;
  vaultLauncherId: string;
  offerId: string;
  offerArtifactId: string | null;
  deedLauncherId: string;
  tokenAmount: number;
  poolInnerPuzzleHash: string;
  identityAttestRoot: string;
  attestationLeafHash: string;
  attestationProof: VaultAcceptOfferAttestationProof;
  vaultCoin: CoinWithIdInput & { coinId: string };
  vaultInnerPuzzleHash: string;
  vaultFullPuzzleHash: string;
  expectedNextVaultCoin: CoinWithIdInput & { coinId: string };
  lineageProof: VaultAcceptOfferLineageProof;
  acceptOfferInnerSolution: string;
  acceptOfferInnerSolutionTreeHash: string;
  vaultSignatureData: string;
  coinSpends: ReadonlyArray<UnsignedCoinSpend>;
  unsignedSpendBundle: {
    coinSpends: ReadonlyArray<UnsignedCoinSpend>;
    aggregatedSignature: null;
  };
}

interface SdkShape {
  Clvm: new () => ClvmShape;
  Constants?: {
    singletonTopLayer?: () => Uint8Array;
    singletonTopLayerV11?: () => Uint8Array;
  };
}

interface ClvmShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  atom(bytes: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
  list(values: ProgramShape[]): ProgramShape;
  pair(first: ProgramShape, rest: ProgramShape): ProgramShape;
}

interface ProgramShape {
  curry(args: ProgramShape[]): ProgramShape;
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
  uncurry(): { program: ProgramShape; args: ProgramShape } | undefined;
  toList(): ProgramShape[] | undefined;
}

function normalizeOffer(offer: OfferDetail): { deedLauncherId: string; tokenAmount: number } {
  if (offer.state !== 'OP:OFFER_READY') {
    throw new Error('vault accept-offer spend: offer is not ready');
  }
  if (!offer.artifact) {
    throw new Error('vault accept-offer spend: offer artifact is required');
  }
  const deedLauncherId = bytesToHex(bytes32(offer.terms.deedLauncherId, 'offer.terms.deedLauncherId'));
  if (normalizeHex(offer.deedLauncherId) !== deedLauncherId) {
    throw new Error('vault accept-offer spend: offer deed launcher mismatch');
  }
  if (normalizeHex(offer.artifact.deedLauncherId) !== deedLauncherId) {
    throw new Error('vault accept-offer spend: offer artifact deed launcher mismatch');
  }
  return {
    deedLauncherId,
    tokenAmount: assertPositiveInteger(offer.terms.tokenAmount, 'offer.terms.tokenAmount'),
  };
}

function normalizeCoin(coin: CoinWithIdInput, prefix: string): CoinWithIdInput & { coinId: string } {
  const normalized = {
    parentCoinInfo: normalizeHex(coin.parentCoinInfo),
    puzzleHash: normalizeHex(coin.puzzleHash),
    amount: assertPositiveInteger(coin.amount, 'vaultCoin.amount'),
    coinId: coin.coinId ? normalizeHex(coin.coinId) : coinId(coin.parentCoinInfo, coin.puzzleHash, coin.amount),
  };
  const derived = coinId(normalized.parentCoinInfo, normalized.puzzleHash, normalized.amount);
  if (derived !== normalized.coinId) {
    throw new Error(`${prefix}: vault coin id does not match coin fields`);
  }
  return normalized;
}

function normalizeAttestationProof(proof: VaultAcceptOfferAttestationProof): VaultAcceptOfferAttestationProof {
  return {
    bitpath: assertNonNegativeInteger(proof.bitpath, 'attestationProof.bitpath'),
    siblings: proof.siblings.map((sibling, index) => bytesToHex(bytes32(sibling, `attestationProof.siblings[${index}]`))),
  };
}

function oneLeafMerkleRoot(ownerPubkey: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(ownerPubkey.length + 1);
  bytes[0] = 1;
  bytes.set(ownerPubkey, 1);
  return hexToBytes(sha256(bytes));
}

function bytes32(input: string | Uint8Array, name: string): Uint8Array {
  const bytes = input instanceof Uint8Array ? input : hexToBytes(input);
  if (bytes.length !== 32) {
    throw new Error(`${name} must be 32 bytes`);
  }
  return bytes;
}

function ownerPubkeyBytes(pubkey: string, authType: number): Uint8Array {
  const bytes = hexToBytes(pubkey);
  if (authType === AUTH_TYPE_BLS && bytes.length === 48) return bytes;
  if (authType === AUTH_TYPE_SECP256K1 && bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3)) return bytes;
  if (authType === AUTH_TYPE_SECP256R1 && bytes.length === 65 && bytes[0] === 4) return bytes;
  throw new Error('vault accept-offer spend: owner pubkey does not match auth type');
}

function assertPositiveInteger(value: number, name: string): number {
  const n = assertNonNegativeInteger(value, name);
  if (n <= 0) {
    throw new Error(`${name} must be greater than zero`);
  }
  return n;
}

function assertNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeHex(value: string): string {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`invalid hex string: ${value}`);
  }
  return `0x${hex.toLowerCase()}`;
}
