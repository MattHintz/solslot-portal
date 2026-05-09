import { Injectable, inject } from '@angular/core';
import { sha256 } from 'ethers';

import { environment } from '../../environments/environment';
import { ChiaSingletonReaderService, SingletonLineage } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService } from './coinset.service';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import { AUTH_TYPE_BLS, AUTH_TYPE_SECP256K1, AUTH_TYPE_SECP256R1, bytesToHex, coinId, hexToBytes } from '../utils/chia-hash';
import { VAULT_SINGLETON_INNER_PUZZLE_HEX, ZKPASSPORT_BRIDGE_MESSAGE_PUZZLE_HEX } from './zkpassport-vault-enrollment.puzzle-hex';
import { ZKPASSPORT_EMPTY_ATTEST_ROOT } from './zkpassport-attestation.service';
import type { ValidatorBridgeSignature } from './zkpassport-evm-attestation-poller.service';

const SINGLETON_MOD_HASH = '0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
const SINGLETON_LAUNCHER_HASH = '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';
const SPEND_UPDATE_IDENTITY = 0x7a;

@Injectable({ providedIn: 'root' })
export class ZkPassportVaultEnrollmentSpendService {
  private readonly wasm = inject(ChiaWasmService);
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly coinset = inject(CoinsetService);

  async buildFromChain(args: ChainEnrollmentSpendArgs): Promise<ZkPassportVaultEnrollmentSpendPackage> {
    const lineage = await this.singleton.walkLineage(args.vaultLauncherId);
    if (!lineage) {
      throw new Error('vault enrollment spend: vault lineage is not confirmed on chain');
    }
    const current = lineage.nodes[lineage.nodes.length - 1];
    if (!current || current.isLauncher) {
      throw new Error('vault enrollment spend: vault singleton has no current state coin');
    }
    const expectedCoinId = normalizeHex(args.vaultCoinId);
    if (normalizeHex(current.coinId) !== expectedCoinId) {
      throw new Error(
        `vault enrollment spend: current vault coin changed from ${expectedCoinId} to ${current.coinId}`,
      );
    }
    const lineageProof = await this.lineageProofForCurrentCoin(lineage);
    return this.buildResolved({
      ...args,
      vaultCoin: {
        parentCoinInfo: current.parentCoinId,
        puzzleHash: current.puzzleHash,
        amount: current.amount,
        coinId: current.coinId,
      },
      lineageProof,
    });
  }

  buildResolved(args: ResolvedEnrollmentSpendArgs): ZkPassportVaultEnrollmentSpendPackage {
    const sdk = this.sdk();
    const clvm = this.clvm();
    const validatorPubkeys = (args.validatorPubkeys ?? environment.zkPassport.validatorPubkeys).map((pk) =>
      bytes32Or48(pk, 'validatorPubkey', 48),
    );
    const threshold = assertPositiveInteger(
      args.validatorThreshold ?? environment.zkPassport.validatorThreshold,
      'validatorThreshold',
    );
    const signerIndices = validateSignerIndices(args.signerIndices, threshold, validatorPubkeys.length);
    const vaultLauncherId = bytes32(args.vaultLauncherId, 'vaultLauncherId');
    const ownerPubkey = ownerPubkeyBytes(args.ownerPubkey, args.authType);
    const membersMerkleRoot = args.membersMerkleRoot
      ? bytes32(args.membersMerkleRoot, 'membersMerkleRoot')
      : oneLeafMerkleRoot(ownerPubkey);
    const poolLauncherIdHex = args.poolLauncherId ?? environment.populisProtocol.poolLauncherId;
    if (!poolLauncherIdHex) {
      throw new Error('vault enrollment spend: pool launcher id is not configured');
    }
    const poolLauncherId = bytes32(poolLauncherIdHex, 'poolLauncherId');
    const bridgeParentId = bytes32(args.bridgeParentId, 'bridgeParentId');
    const bridgeAmount = assertPositiveInteger(args.bridgeAmount, 'bridgeAmount');
    const newIdentityAttestRoot = bytes32(args.newIdentityAttestRoot, 'newIdentityAttestRoot');
    const bridgePolicyHash = bytes32(args.bridgePolicyHash, 'bridgePolicyHash');
    const currentTimestamp = assertNonNegativeInteger(args.currentTimestamp, 'currentTimestamp');
    const proofTimestamp = assertNonNegativeInteger(args.proofTimestamp, 'proofTimestamp');
    const signatureData = args.signatureData ? hexToBytes(args.signatureData) : new Uint8Array(0);
    const vaultCoin = normalizeCoin(args.vaultCoin);
    const bridgeCoinId = coinId(bridgeParentId, bridgePolicyHash, bridgeAmount);
    const vaultCoinId = coinId(vaultCoin.parentCoinInfo, vaultCoin.puzzleHash, vaultCoin.amount);
    if (bridgeCoinId === vaultCoinId) {
      throw new Error('vault enrollment spend: derived bridge coin id must differ from vault coin id');
    }
    if (bytesToHex(newIdentityAttestRoot) === ZKPASSPORT_EMPTY_ATTEST_ROOT) {
      throw new Error('vault enrollment spend: newIdentityAttestRoot must not be empty');
    }

    const singletonStruct = this.singletonStructProgram(clvm, vaultLauncherId);
    const vaultMod = clvm.deserialize(hexToBytes(VAULT_SINGLETON_INNER_PUZZLE_HEX));
    const vaultInnerPuzzle = vaultMod.curry([
      singletonStruct,
      clvm.atom(ownerPubkey),
      clvm.int(BigInt(args.authType)),
      clvm.atom(membersMerkleRoot),
      clvm.atom(hexToBytes(ZKPASSPORT_EMPTY_ATTEST_ROOT)),
      clvm.atom(bridgePolicyHash),
      clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
      clvm.atom(poolLauncherId),
      clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH)),
    ]);
    const vaultInnerPuzzleHash = vaultInnerPuzzle.treeHash();
    const vaultFullPuzzle = this.singletonFullPuzzle(clvm, singletonStruct, vaultInnerPuzzle);
    const vaultFullPuzzleHash = vaultFullPuzzle.treeHash();
    if (bytesToHex(vaultFullPuzzleHash) !== normalizeHex(vaultCoin.puzzleHash)) {
      throw new Error('vault enrollment spend: reconstructed vault puzzle hash does not match current coin');
    }

    const bridgePuzzle = clvm.deserialize(hexToBytes(ZKPASSPORT_BRIDGE_MESSAGE_PUZZLE_HEX)).curry([
      clvm.list(validatorPubkeys.map((pk) => clvm.atom(pk))),
      clvm.int(BigInt(threshold)),
    ]);
    const derivedBridgePolicyHash = bridgePuzzle.treeHash();
    if (bytesToHex(derivedBridgePolicyHash) !== bytesToHex(bridgePolicyHash)) {
      throw new Error('vault enrollment spend: validator set does not match bridge policy hash');
    }

    const bridgeCoin = new sdk.Coin(bridgeParentId, bridgePolicyHash, BigInt(bridgeAmount));
    const bridgeCoinIdFromWasm = bytesToHex(bridgeCoin.coinId());
    if (bridgeCoinIdFromWasm !== bridgeCoinId) {
      throw new Error('vault enrollment spend: bridge coin id mismatch');
    }
    const expectedNextVaultInnerPuzzle = vaultMod.curry([
      singletonStruct,
      clvm.atom(ownerPubkey),
      clvm.int(BigInt(args.authType)),
      clvm.atom(membersMerkleRoot),
      clvm.atom(newIdentityAttestRoot),
      clvm.atom(bridgePolicyHash),
      clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
      clvm.atom(poolLauncherId),
      clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH)),
    ]);
    const expectedNextVaultInnerPuzzleHash = expectedNextVaultInnerPuzzle.treeHash();
    const expectedNextVaultFullPuzzle = this.singletonFullPuzzle(clvm, singletonStruct, expectedNextVaultInnerPuzzle);
    const expectedNextVaultFullPuzzleHash = expectedNextVaultFullPuzzle.treeHash();
    const expectedNextVaultCoinId = coinId(
      vaultCoinId,
      expectedNextVaultFullPuzzleHash,
      vaultCoin.amount,
    );

    const bridgeSolution = clvm.list([
      clvm.atom(hexToBytes(bridgeCoinId)),
      clvm.atom(bridgePolicyHash),
      clvm.int(BigInt(bridgeAmount)),
      clvm.atom(vaultLauncherId),
      clvm.atom(newIdentityAttestRoot),
      clvm.atom(bytes32(args.attestationLeafHash, 'attestationLeafHash')),
      clvm.atom(bytes32(args.scopedNullifier, 'scopedNullifier')),
      clvm.atom(uintToBytes32(args.nullifierType, 'nullifierType')),
      clvm.atom(bytes32(args.serviceScopeHash, 'serviceScopeHash')),
      clvm.atom(bytes32(args.serviceSubscopeHash, 'serviceSubscopeHash')),
      clvm.atom(uintToBytes32(proofTimestamp, 'proofTimestamp')),
      clvm.list(signerIndices.map((idx) => clvm.int(BigInt(idx)))),
    ]);

    const innerSolution = clvm.list([
      clvm.atom(hexToBytes(vaultCoinId)),
      clvm.atom(vaultInnerPuzzleHash),
      clvm.int(BigInt(vaultCoin.amount)),
      clvm.int(BigInt(SPEND_UPDATE_IDENTITY)),
      clvm.list([
        clvm.atom(vaultMod.treeHash()),
        clvm.atom(newIdentityAttestRoot),
        clvm.atom(bridgeParentId),
        clvm.int(BigInt(bridgeAmount)),
        clvm.int(BigInt(currentTimestamp)),
        clvm.atom(signatureData),
      ]),
    ]);
    const fullSolution = this.singletonSolution(clvm, args.lineageProof, vaultCoin.amount, innerSolution);

    const coinSpends: UnsignedCoinSpend[] = [
      {
        coin: {
          parentCoinInfo: bytesToHex(bridgeParentId),
          puzzleHash: bytesToHex(bridgePolicyHash),
          amount: bridgeAmount,
        },
        puzzleReveal: bytesToHex(bridgePuzzle.serialize()),
        solution: bytesToHex(bridgeSolution.serialize()),
      },
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
      spendCase: '0x7a',
      authType: args.authType,
      vaultLauncherId: bytesToHex(vaultLauncherId),
      vaultCoin: {
        parentCoinInfo: normalizeHex(vaultCoin.parentCoinInfo),
        puzzleHash: normalizeHex(vaultCoin.puzzleHash),
        amount: vaultCoin.amount,
        coinId: vaultCoinId,
      },
      bridgeCoin: {
        parentCoinInfo: bytesToHex(bridgeParentId),
        puzzleHash: bytesToHex(bridgePolicyHash),
        amount: bridgeAmount,
        coinId: bridgeCoinId,
      },
      bridgePolicyHash: bytesToHex(bridgePolicyHash),
      vaultInnerPuzzleHash: bytesToHex(vaultInnerPuzzleHash),
      vaultFullPuzzleHash: bytesToHex(vaultFullPuzzleHash),
      expectedNextVaultInnerPuzzleHash: bytesToHex(expectedNextVaultInnerPuzzleHash),
      expectedNextVaultFullPuzzleHash: bytesToHex(expectedNextVaultFullPuzzleHash),
      expectedNextVaultCoin: {
        parentCoinInfo: vaultCoinId,
        puzzleHash: bytesToHex(expectedNextVaultFullPuzzleHash),
        amount: vaultCoin.amount,
        coinId: expectedNextVaultCoinId,
      },
      lineageProof: {
        parentParentCoinInfo: normalizeHex(args.lineageProof.parentParentCoinInfo),
        parentInnerPuzzleHash: args.lineageProof.parentInnerPuzzleHash
          ? normalizeHex(args.lineageProof.parentInnerPuzzleHash)
          : null,
        parentAmount: args.lineageProof.parentAmount,
      },
      signerIndices,
      validatorSignatures: args.validatorSignatures ?? [],
      vaultSignatureData: bytesToHex(signatureData),
      coinSpends,
      unsignedSpendBundle: {
        coinSpends,
        aggregatedSignature: null,
      },
    };
  }

  private async lineageProofForCurrentCoin(lineage: SingletonLineage): Promise<EnrollmentLineageProof> {
    const currentIndex = lineage.nodes.length - 1;
    const parent = lineage.nodes[currentIndex - 1];
    if (!parent) {
      throw new Error('vault enrollment spend: missing parent for current vault coin');
    }
    if (parent.isLauncher) {
      return {
        parentParentCoinInfo: normalizeHex(lineage.launcher.coin.parent_coin_info),
        parentInnerPuzzleHash: null,
        parentAmount: lineage.launcher.coin.amount,
      };
    }
    if (parent.spentBlockIndex === null) {
      throw new Error('vault enrollment spend: parent spend height is unavailable');
    }
    const parentSpend = await this.coinset.getPuzzleAndSolution(parent.coinId, parent.spentBlockIndex);
    if (!parentSpend) {
      throw new Error('vault enrollment spend: parent puzzle reveal is unavailable');
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
      throw new Error('vault enrollment spend: parent singleton puzzle is not curried');
    }
    const args = uncurried.args.toList();
    if (!args || args.length !== 2) {
      throw new Error('vault enrollment spend: parent singleton puzzle has unexpected curry args');
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
      throw new Error('vault enrollment spend: singleton top-layer bytecode unavailable in WASM SDK');
    }
    return clvm.deserialize(topLayer).curry([singletonStruct, innerPuzzle]);
  }

  private singletonSolution(
    clvm: ClvmShape,
    lineageProof: EnrollmentLineageProof,
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
    if (!sdk.Coin || !sdk.Clvm) {
      throw new Error('vault enrollment spend: chia-wallet-sdk-wasm Coin/Clvm exports unavailable');
    }
    return sdk;
  }

  private clvm(): ClvmShape {
    const Clvm = this.sdk().Clvm;
    return new Clvm();
  }
}

export interface ChainEnrollmentSpendArgs extends EnrollmentSpendBaseArgs {
  vaultCoinId: string;
}

export interface ResolvedEnrollmentSpendArgs extends EnrollmentSpendBaseArgs {
  vaultCoin: CoinWithIdInput;
  lineageProof: EnrollmentLineageProof;
}

export interface EnrollmentSpendBaseArgs {
  vaultLauncherId: string;
  ownerPubkey: string;
  authType: number;
  membersMerkleRoot?: string;
  poolLauncherId?: string;
  bridgePolicyHash: string;
  bridgeParentId: string;
  bridgeAmount: number;
  newIdentityAttestRoot: string;
  attestationLeafHash: string;
  scopedNullifier: string;
  nullifierType: number;
  serviceScopeHash: string;
  serviceSubscopeHash: string;
  proofTimestamp: number;
  currentTimestamp: number;
  validatorPubkeys?: ReadonlyArray<string>;
  validatorThreshold?: number;
  signerIndices: ReadonlyArray<number>;
  validatorSignatures?: ReadonlyArray<ValidatorBridgeSignature>;
  signatureData?: string;
}

export interface EnrollmentLineageProof {
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

export interface ZkPassportVaultEnrollmentSpendPackage {
  status: 'unsigned';
  backendSigning: false;
  spendCase: '0x7a';
  authType: number;
  vaultLauncherId: string;
  vaultCoin: CoinWithIdInput & { coinId: string };
  bridgeCoin: CoinWithIdInput & { coinId: string };
  bridgePolicyHash: string;
  vaultInnerPuzzleHash: string;
  vaultFullPuzzleHash: string;
  expectedNextVaultInnerPuzzleHash: string;
  expectedNextVaultFullPuzzleHash: string;
  expectedNextVaultCoin: CoinWithIdInput & { coinId: string };
  lineageProof: EnrollmentLineageProof;
  signerIndices: number[];
  validatorSignatures: ReadonlyArray<ValidatorBridgeSignature>;
  vaultSignatureData: string;
  coinSpends: ReadonlyArray<UnsignedCoinSpend>;
  unsignedSpendBundle: {
    coinSpends: ReadonlyArray<UnsignedCoinSpend>;
    aggregatedSignature: null;
  };
}

interface SdkShape {
  Clvm: new () => ClvmShape;
  Coin: new (parentCoinInfo: Uint8Array, puzzleHash: Uint8Array, amount: bigint) => { coinId(): Uint8Array };
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

function normalizeCoin(coin: CoinWithIdInput): CoinWithIdInput & { coinId: string } {
  const normalized = {
    parentCoinInfo: normalizeHex(coin.parentCoinInfo),
    puzzleHash: normalizeHex(coin.puzzleHash),
    amount: assertPositiveInteger(coin.amount, 'vaultCoin.amount'),
    coinId: coin.coinId ? normalizeHex(coin.coinId) : coinId(coin.parentCoinInfo, coin.puzzleHash, coin.amount),
  };
  const derived = coinId(normalized.parentCoinInfo, normalized.puzzleHash, normalized.amount);
  if (derived !== normalized.coinId) {
    throw new Error('vault enrollment spend: vault coin id does not match coin fields');
  }
  return normalized;
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

function bytes32Or48(input: string, name: string, length: number): Uint8Array {
  const bytes = hexToBytes(input);
  if (bytes.length !== length) {
    throw new Error(`${name} must be ${length} bytes`);
  }
  return bytes;
}

function uintToBytes32(value: number, name: string): Uint8Array {
  const n = assertNonNegativeInteger(value, name);
  const out = new Uint8Array(32);
  let x = BigInt(n);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function ownerPubkeyBytes(pubkey: string, authType: number): Uint8Array {
  const bytes = hexToBytes(pubkey);
  if (authType === AUTH_TYPE_BLS && bytes.length === 48) return bytes;
  if (authType === AUTH_TYPE_SECP256K1 && bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3)) return bytes;
  if (authType === AUTH_TYPE_SECP256R1 && bytes.length === 65 && bytes[0] === 4) return bytes;
  throw new Error('vault enrollment spend: owner pubkey does not match auth type');
}

function validateSignerIndices(indices: ReadonlyArray<number>, threshold: number, pubkeyCount: number): number[] {
  if (threshold < 1 || threshold > pubkeyCount) {
    throw new Error(`validatorThreshold must be in [1, ${pubkeyCount}]`);
  }
  if (indices.length < threshold) {
    throw new Error(`vault enrollment spend: need at least ${threshold} validator signatures`);
  }
  const out = [...indices];
  for (let i = 0; i < out.length; i++) {
    if (!Number.isInteger(out[i]) || out[i] < 0 || out[i] >= pubkeyCount) {
      throw new Error('vault enrollment spend: signer index out of range');
    }
    if (i > 0 && out[i] <= out[i - 1]) {
      throw new Error('vault enrollment spend: signer indices must be strictly ascending');
    }
  }
  return out;
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
