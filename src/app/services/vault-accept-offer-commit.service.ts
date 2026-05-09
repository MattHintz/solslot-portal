import { Injectable, inject } from '@angular/core';

import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import { CoinsetService, PushTxResponse } from './coinset.service';
import { SessionService } from './session.service';
import { VaultAcceptOfferAuthorizationResult } from './vault-accept-offer-authorize.service';

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 180_000;
const DEFAULT_CONFIRMATION_POLL_MS = 5_000;

@Injectable({ providedIn: 'root' })
export class VaultAcceptOfferCommitService {
  private readonly coinset = inject(CoinsetService);
  private readonly session = inject(SessionService);

  async commitAuthorizedAcceptOffer(
    authorization: VaultAcceptOfferAuthorizationResult,
    options: AcceptOfferCommitOptions = {},
  ): Promise<VaultAcceptOfferCommitResult> {
    if (authorization.packageState.spendCase !== '0x61') {
      throw new Error(`vault accept-offer commit: unsupported spend case ${authorization.packageState.spendCase}`);
    }
    if (hexToBytes(authorization.signedSpendBundle.aggregatedSignature).length !== 96) {
      throw new Error('vault accept-offer commit: signed bundle aggregated signature must be 96 bytes');
    }
    const beforeCoinId = normalizeHex(authorization.packageState.vaultCoin.coinId);
    const expectedNextCoinId = normalizeHex(authorization.packageState.expectedNextVaultCoin.coinId);
    const expectedNextPuzzleHash = normalizeHex(authorization.packageState.expectedNextVaultCoin.puzzleHash);
    const pushResponse = await this.coinset.pushTransaction(authorization.signedSpendBundle);
    const confirmedVault = await this.waitForConfirmation(
      beforeCoinId,
      expectedNextCoinId,
      expectedNextPuzzleHash,
      options,
    );
    return {
      packageState: authorization.packageState,
      signedSpendBundle: authorization.signedSpendBundle,
      pushResponse,
      confirmedVaultCoinId: normalizeHex(confirmedVault.current_coin_id ?? expectedNextCoinId),
      confirmedBlockIndex: confirmedVault.confirmed_block_index,
    };
  }

  private async waitForConfirmation(
    beforeCoinId: string,
    expectedNextCoinId: string,
    expectedNextPuzzleHash: string,
    options: AcceptOfferCommitOptions,
  ) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_CONFIRMATION_POLL_MS;
    const deadline = Date.now() + timeoutMs;
    let lastVault = await this.session.refreshVault();
    while (true) {
      if (lastVault?.current_coin_id) {
        const currentCoinId = normalizeHex(lastVault.current_coin_id);
        const currentPuzzleHash = normalizeHex(lastVault.vault_full_puzhash);
        if (currentCoinId === expectedNextCoinId && currentPuzzleHash === expectedNextPuzzleHash) {
          return lastVault;
        }
        if (currentCoinId !== beforeCoinId) {
          throw new Error(
            `vault accept-offer commit: confirmed vault advanced to unexpected coin ${currentCoinId}`,
          );
        }
      }
      if (Date.now() >= deadline) {
        throw new Error('vault accept-offer commit: timed out waiting for confirmed offer acceptance');
      }
      await delay(options.delayMsOverride ?? pollIntervalMs);
      lastVault = await this.session.refreshVault();
    }
  }
}

export interface AcceptOfferCommitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  delayMsOverride?: number;
}

export interface VaultAcceptOfferCommitResult extends VaultAcceptOfferAuthorizationResult {
  pushResponse: PushTxResponse;
  confirmedVaultCoinId: string;
  confirmedBlockIndex: number | null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function normalizeHex(value: string): string {
  return bytesToHex(hexToBytes(value));
}
