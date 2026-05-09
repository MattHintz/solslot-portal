import { Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';
import { AUTH_TYPE_BLS, AUTH_TYPE_SECP256K1, AUTH_TYPE_SECP256R1, bytesToHex, hexToBytes } from '../utils/chia-hash';
import { ChiaWalletService, SignedSpendBundle, UnsignedCoinSpend } from './chia-wallet.service';
import { ChiaWasmService } from './chia-wasm.service';
import { EvmWalletService } from './evm-wallet.service';
import { Eip712TypedData } from './populis-api.service';
import {
  ChainEnrollmentSpendArgs,
  ZkPassportVaultEnrollmentSpendPackage,
  ZkPassportVaultEnrollmentSpendService,
} from './zkpassport-vault-enrollment-spend.service';

const SPEND_UPDATE_IDENTITY_HEX = '0x7a';
const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

@Injectable({ providedIn: 'root' })
export class ZkPassportVaultEnrollmentAuthorizeService {
  private readonly spendBuilder = inject(ZkPassportVaultEnrollmentSpendService);
  private readonly chiaWallet = inject(ChiaWalletService);
  private readonly wasm = inject(ChiaWasmService);
  private readonly evm = inject(EvmWalletService);

  async authorizeFromChain(args: ZkPassportVaultEnrollmentAuthorizationArgs): Promise<ZkPassportVaultEnrollmentAuthorizationResult> {
    const currentTimestamp = args.currentTimestamp ?? Math.floor(Date.now() / 1000);
    if (args.authType === AUTH_TYPE_BLS) {
      const packageState = await this.spendBuilder.buildFromChain({
        ...args,
        currentTimestamp,
      });
      return this.authorizeBlsPackage(packageState);
    }
    if (args.authType === AUTH_TYPE_SECP256K1) {
      const typedData = buildVaultEnrollmentTypedData(args.newIdentityAttestRoot, args.vaultCoinId);
      const signature = await this.evm.signTypedData(typedData);
      const recoveredPubkey = normalizeHex(this.evm.recoverCompressedPubkey(typedData, signature));
      if (recoveredPubkey !== normalizeHex(args.ownerPubkey)) {
        throw new Error('vault enrollment authorize: EVM signature did not recover the vault owner pubkey');
      }
      const packageState = await this.spendBuilder.buildFromChain({
        ...args,
        currentTimestamp,
        signatureData: compactSignatureFromEvm(signature),
      });
      return this.authorizeExternallyAuthorizedPackage(packageState);
    }
    if (args.authType === AUTH_TYPE_SECP256R1) {
      throw new Error('vault enrollment authorize: passkey authorization is not wired yet');
    }
    throw new Error(`vault enrollment authorize: unsupported auth type ${args.authType}`);
  }

  async authorizeBlsPackage(
    packageState: ZkPassportVaultEnrollmentSpendPackage,
  ): Promise<ZkPassportVaultEnrollmentAuthorizationResult> {
    if (packageState.authType !== AUTH_TYPE_BLS) {
      throw new Error('vault enrollment authorize: BLS package authorization requires a BLS vault');
    }
    const vaultSpend = findVaultSpend(packageState);
    const ownerSigned = await this.chiaWallet.signSpendBundle([vaultSpend]);
    const signedSpendBundle = this.finalizeSpendBundle(packageState, ownerSigned.aggregatedSignature);
    return { packageState, signedSpendBundle };
  }

  authorizeExternallyAuthorizedPackage(
    packageState: ZkPassportVaultEnrollmentSpendPackage,
  ): ZkPassportVaultEnrollmentAuthorizationResult {
    if (packageState.authType === AUTH_TYPE_BLS) {
      throw new Error('vault enrollment authorize: external authorization requires secp signature data');
    }
    if (hexToBytes(packageState.vaultSignatureData).length !== 64) {
      throw new Error('vault enrollment authorize: secp vault signature data must be 64 bytes');
    }
    return {
      packageState,
      signedSpendBundle: this.finalizeSpendBundle(packageState),
    };
  }

  finalizeSpendBundle(
    packageState: ZkPassportVaultEnrollmentSpendPackage,
    ownerAggregatedSignature?: string,
  ): SignedSpendBundle {
    const validatorSignatures = packageState.validatorSignatures.map((entry) => entry.signature);
    if (validatorSignatures.length < packageState.signerIndices.length) {
      throw new Error('vault enrollment authorize: missing validator signatures for signer indices');
    }
    const signatures = ownerAggregatedSignature
      ? [...validatorSignatures, ownerAggregatedSignature]
      : validatorSignatures;
    return {
      coinSpends: [...packageState.coinSpends],
      aggregatedSignature: this.aggregateSignatures(signatures),
    };
  }

  private aggregateSignatures(signatureHexes: ReadonlyArray<string>): string {
    if (signatureHexes.length === 0) {
      throw new Error('vault enrollment authorize: at least one BLS signature is required');
    }
    const Signature = this.wasm.sdk().Signature as SignatureConstructor | undefined;
    if (!Signature) {
      throw new Error('vault enrollment authorize: chia-wallet-sdk-wasm Signature export unavailable');
    }
    const signatures = signatureHexes.map((signature) => {
      const bytes = hexToBytes(signature);
      if (bytes.length !== 96) {
        throw new Error('vault enrollment authorize: BLS signature must be 96 bytes');
      }
      return Signature.fromBytes(bytes);
    });
    const aggregated = Signature.aggregate(signatures);
    try {
      return bytesToHex(aggregated.toBytes());
    } finally {
      aggregated.free?.();
      for (const signature of signatures) {
        signature.free?.();
      }
    }
  }
}

export type ZkPassportVaultEnrollmentAuthorizationArgs = Omit<
  ChainEnrollmentSpendArgs,
  'currentTimestamp' | 'signatureData'
> & {
  currentTimestamp?: number;
};

export interface ZkPassportVaultEnrollmentAuthorizationResult {
  packageState: ZkPassportVaultEnrollmentSpendPackage;
  signedSpendBundle: SignedSpendBundle;
}

interface SignatureConstructor {
  fromBytes(bytes: Uint8Array): SignatureShape;
  aggregate(signatures: SignatureShape[]): SignatureShape;
}

interface SignatureShape {
  toBytes(): Uint8Array;
  free?: () => void;
}

export function buildVaultEnrollmentTypedData(
  newIdentityAttestRoot: string,
  vaultCoinId: string,
): Eip712TypedData {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      PopulisVaultSpend: [
        { name: 'spend_case', type: 'bytes32' },
        { name: 'deed_launcher_id', type: 'bytes32' },
        { name: 'vault_coin_id', type: 'bytes32' },
      ],
    },
    domain: {
      name: 'Populis Protocol',
      version: '1',
      chainId: environment.eip712ChainId,
    },
    primaryType: 'PopulisVaultSpend',
    message: {
      spend_case: padRightBytes32(SPEND_UPDATE_IDENTITY_HEX),
      deed_launcher_id: normalizeSizedHex(newIdentityAttestRoot, 32, 'newIdentityAttestRoot'),
      vault_coin_id: normalizeSizedHex(vaultCoinId, 32, 'vaultCoinId'),
    },
  };
}

export function compactSignatureFromEvm(signature: string): string {
  const bytes = hexToBytes(signature);
  if (bytes.length !== 65) {
    throw new Error(`vault enrollment authorize: expected 65-byte EVM signature, got ${bytes.length} bytes`);
  }
  const out = bytes.slice(0, 64);
  const s = bytesToBigInt(out.slice(32, 64));
  const lowS = s > SECP256K1_N / 2n ? SECP256K1_N - s : s;
  out.set(bigIntToBytes32(lowS), 32);
  return bytesToHex(out);
}

function findVaultSpend(packageState: ZkPassportVaultEnrollmentSpendPackage): UnsignedCoinSpend {
  const spend = packageState.coinSpends.find(
    (coinSpend) =>
      normalizeHex(coinSpend.coin.parentCoinInfo) === normalizeHex(packageState.vaultCoin.parentCoinInfo) &&
      normalizeHex(coinSpend.coin.puzzleHash) === normalizeHex(packageState.vaultCoin.puzzleHash) &&
      Number(coinSpend.coin.amount) === packageState.vaultCoin.amount,
  );
  if (!spend) {
    throw new Error('vault enrollment authorize: package does not contain the vault coin spend');
  }
  return spend;
}

function padRightBytes32(value: string): string {
  const hex = stripHex(value);
  if (hex.length > 64 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`vault enrollment authorize: invalid bytes32 prefix ${value}`);
  }
  return `0x${hex.toLowerCase().padEnd(64, '0')}`;
}

function normalizeSizedHex(value: string, bytes: number, name: string): string {
  const hex = stripHex(value);
  if (hex.length !== bytes * 2 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`vault enrollment authorize: ${name} must be ${bytes} bytes`);
  }
  return `0x${hex.toLowerCase()}`;
}

function normalizeHex(value: string): string {
  const hex = stripHex(value);
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`vault enrollment authorize: invalid hex string ${value}`);
  }
  return `0x${hex.toLowerCase()}`;
}

function stripHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const byte of bytes) {
    out = (out << 8n) + BigInt(byte);
  }
  return out;
}

function bigIntToBytes32(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let n = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}
