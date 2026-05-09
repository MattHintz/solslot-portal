import { Injectable, inject } from '@angular/core';

import { AUTH_TYPE_BLS, bytesToHex, hexToBytes } from '../utils/chia-hash';
import { ChiaWalletService, SignedSpendBundle, UnsignedCoinSpend } from './chia-wallet.service';
import { ZkPassportAcceptOfferProofService } from './zkpassport-accept-offer-proof.service';
import {
  ChainVaultAcceptOfferBuildRequest,
  VaultAcceptOfferSpendPackage,
  VaultAcceptOfferSpendService,
} from './vault-accept-offer-spend.service';

@Injectable({ providedIn: 'root' })
export class VaultAcceptOfferAuthorizeService {
  private readonly spendBuilder = inject(VaultAcceptOfferSpendService);
  private readonly proofService = inject(ZkPassportAcceptOfferProofService);
  private readonly chiaWallet = inject(ChiaWalletService);

  async authorizeFromChain(args: VaultAcceptOfferAuthorizationArgs): Promise<VaultAcceptOfferAuthorizationResult> {
    if (args.authType !== AUTH_TYPE_BLS) {
      throw new Error('vault accept-offer authorize: accept-offer authorization is currently BLS-only');
    }
    const currentTimestamp = args.currentTimestamp ?? Math.floor(Date.now() / 1000);
    const packageState = await this.spendBuilder.buildFromChain(
      this.proofService.withProofParams(args.vaultLauncherId, {
        ...args,
        currentTimestamp,
        signatureData: null,
      }),
    );
    return this.authorizePackage(packageState);
  }

  async authorizePackage(packageState: VaultAcceptOfferSpendPackage): Promise<VaultAcceptOfferAuthorizationResult> {
    if (packageState.status !== 'unsigned' || packageState.backendSigning !== false) {
      throw new Error('vault accept-offer authorize: package must be unsigned and client-authorized');
    }
    if (packageState.spendCase !== '0x61') {
      throw new Error(`vault accept-offer authorize: unsupported spend case ${packageState.spendCase}`);
    }
    if (packageState.authType !== AUTH_TYPE_BLS) {
      throw new Error('vault accept-offer authorize: BLS package authorization requires a BLS vault');
    }
    const vaultSpend = findVaultSpend(packageState);
    const ownerSigned = await this.chiaWallet.signSpendBundle([vaultSpend]);
    return {
      packageState,
      signedSpendBundle: this.finalizeSpendBundle(packageState, ownerSigned.aggregatedSignature),
    };
  }

  finalizeSpendBundle(
    packageState: VaultAcceptOfferSpendPackage,
    ownerAggregatedSignature: string,
  ): SignedSpendBundle {
    if (hexToBytes(ownerAggregatedSignature).length !== 96) {
      throw new Error('vault accept-offer authorize: BLS signature must be 96 bytes');
    }
    return {
      coinSpends: [...packageState.coinSpends],
      aggregatedSignature: bytesToHex(hexToBytes(ownerAggregatedSignature)),
    };
  }
}

export type VaultAcceptOfferAuthorizationArgs = Omit<
  ChainVaultAcceptOfferBuildRequest,
  'identityAttestRoot' | 'attestationLeafHash' | 'attestationProof' | 'signatureData' | 'currentTimestamp'
> & {
  currentTimestamp?: number;
};

export interface VaultAcceptOfferAuthorizationResult {
  packageState: VaultAcceptOfferSpendPackage;
  signedSpendBundle: SignedSpendBundle;
}

function findVaultSpend(packageState: VaultAcceptOfferSpendPackage): UnsignedCoinSpend {
  const spend = packageState.coinSpends.find(
    (coinSpend) =>
      normalizeHex(coinSpend.coin.parentCoinInfo) === normalizeHex(packageState.vaultCoin.parentCoinInfo) &&
      normalizeHex(coinSpend.coin.puzzleHash) === normalizeHex(packageState.vaultCoin.puzzleHash) &&
      Number(coinSpend.coin.amount) === packageState.vaultCoin.amount,
  );
  if (!spend) {
    throw new Error('vault accept-offer authorize: package does not contain the vault coin spend');
  }
  return spend;
}

function normalizeHex(value: string): string {
  return bytesToHex(hexToBytes(value));
}
