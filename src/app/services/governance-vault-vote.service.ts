import { Injectable, computed, inject } from '@angular/core';

import { ChiaWalletService } from './chia-wallet.service';
import { EvmWalletService } from './evm-wallet.service';
import {
  GovernanceQueueService,
  GovernanceVaultVoteResult,
} from './governance-queue.service';
import { SessionService } from './session.service';
import { VaultOwnerSessionService } from './vault-owner-session.service';

/** External wallets review vote packages; Google voting remains unavailable. */
@Injectable({ providedIn: 'root' })
export class GovernanceVaultVoteService {
  private readonly api = inject(GovernanceQueueService);
  private readonly ownerSession = inject(VaultOwnerSessionService);
  private readonly session = inject(SessionService);
  private readonly chia = inject(ChiaWalletService);
  private readonly evm = inject(EvmWalletService);

  readonly googleVotingUnavailable = computed(() => {
    const current = this.session.session();
    return current?.authType === 'chia_bls' &&
      (current.walletSource === 'google' || this.chia.connectionKind() === 'google');
  });

  private requireVotingWallet(): void {
    if (this.googleVotingUnavailable()) {
      throw new Error('Voting with Google Vault is not available in this alpha. You can still view your holdings.');
    }
  }

  async vote(proposalId: string, voteAmount: string): Promise<GovernanceVaultVoteResult> {
    this.requireVotingWallet();
    const current = this.session.session();
    if (!current?.vaultLauncherId) {
      throw new Error('Connect a protocol vault before voting.');
    }
    await this.ownerSession.ensure(current.vaultLauncherId);
    this.requireVotingWallet();
    const prepared = await this.api.prepareVaultVote(
      proposalId,
      current.vaultLauncherId,
      voteAmount,
    );

    this.requireVotingWallet();

    if (prepared.vaultAuthType !== current.authType) {
      throw new Error('The prepared vote does not match the connected vault.');
    }
    if (prepared.vaultAuthType === 'chia_bls') {
      const signed = await this.chia.signSpendBundle(prepared.signingCoinSpends);
      return this.api.completeVaultVote(proposalId, current.vaultLauncherId, {
        voteAmount: prepared.voteAmount,
        operationHash: prepared.operationHash,
        aggregatedSignature: signed.aggregatedSignature,
      });
    }
    if (!prepared.vaultTypedData) {
      throw new Error('The prepared EVM vote is missing its owner authorization.');
    }
    const authorization = await this.evm.signTypedData(prepared.vaultTypedData);
    return this.api.completeVaultVote(proposalId, current.vaultLauncherId, {
      voteAmount: prepared.voteAmount,
      operationHash: prepared.operationHash,
      vaultOwnerAuthorization: authorization,
    });
  }
}
