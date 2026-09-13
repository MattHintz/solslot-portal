import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ChiaWalletService } from './chia-wallet.service';
import { EvmWalletService } from './evm-wallet.service';
import { GovernanceQueueService } from './governance-queue.service';
import { GovernanceVaultVoteService } from './governance-vault-vote.service';
import { SessionService } from './session.service';
import { VaultOwnerSessionService } from './vault-owner-session.service';

describe('GovernanceVaultVoteService', () => {
  const launcher = '0x' + '51'.repeat(32);
  let service: GovernanceVaultVoteService;
  let api: jasmine.SpyObj<GovernanceQueueService>;
  let chia: jasmine.SpyObj<ChiaWalletService>;
  let evm: jasmine.SpyObj<EvmWalletService>;
  const connectionState = signal<'goby' | 'google'>('goby');
  let ownerSession: jasmine.SpyObj<VaultOwnerSessionService>;
  const sessionState = signal<{ authType: 'chia_bls' | 'evm'; vaultLauncherId: string; walletSource?: 'chia' | 'google' }>({
    authType: 'chia_bls',
    vaultLauncherId: launcher,
  });

  beforeEach(() => {
    api = jasmine.createSpyObj<GovernanceQueueService>('GovernanceQueueService', [
      'prepareVaultVote',
      'completeVaultVote',
    ]);
    chia = jasmine.createSpyObj<ChiaWalletService>('ChiaWalletService', ['signSpendBundle', 'connectionKind']);
    connectionState.set('goby');
    chia.connectionKind.and.callFake(connectionState);
    evm = jasmine.createSpyObj<EvmWalletService>('EvmWalletService', ['signTypedData']);
    sessionState.set({ authType: 'chia_bls', vaultLauncherId: launcher });
    ownerSession = jasmine.createSpyObj<VaultOwnerSessionService>('VaultOwnerSessionService', ['ensure']);
    ownerSession.ensure.and.resolveTo({
      vaultLauncherId: launcher,
      authType: 'chia_bls',
      network: 'testnet11',
      protocolVersion: 'solslot-v2',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: GovernanceQueueService, useValue: api },
        { provide: VaultOwnerSessionService, useValue: ownerSession },
        {
          provide: SessionService,
          useValue: { session: sessionState },
        },
        { provide: ChiaWalletService, useValue: chia },
        { provide: EvmWalletService, useValue: evm },
      ],
    });
    service = TestBed.inject(GovernanceVaultVoteService);
  });

  for (const source of ['session', 'connection'] as const) {
    it(`blocks Google voting from the ${source} before owner authorization`, async () => {
      if (source === 'session') sessionState.set({ authType: 'chia_bls', vaultLauncherId: launcher, walletSource: 'google' });
      else connectionState.set('google');

      await expectAsync(service.vote('GOV-1', '10000')).toBeRejectedWithError(/Voting with Google Vault is not available/);

      expect(ownerSession.ensure).not.toHaveBeenCalled();
      expect(api.prepareVaultVote).not.toHaveBeenCalled();
      expect(chia.signSpendBundle).not.toHaveBeenCalled();
      expect(api.completeVaultVote).not.toHaveBeenCalled();
    });
  }

  it('blocks a connection changing to Google during owner authorization', async () => {
    ownerSession.ensure.and.callFake(async () => {
      connectionState.set('google');
      return { vaultLauncherId: launcher, authType: 'chia_bls', network: 'testnet11', protocolVersion: 'solslot-v2', expiresAt: 1_900_000_000 };
    });
    await expectAsync(service.vote('GOV-1', '10000')).toBeRejectedWithError(/Voting with Google Vault is not available/);
    expect(api.prepareVaultVote).not.toHaveBeenCalled();
    expect(chia.signSpendBundle).not.toHaveBeenCalled();
  });

  it('blocks a connection changing to Google while the provider prepares a vote', async () => {
    api.prepareVaultVote.and.callFake(async () => {
      connectionState.set('google');
      return { vaultAuthType: 'chia_bls', signingCoinSpends: [], voteAmount: '1' } as any;
    });
    await expectAsync(service.vote('GOV-1', '10000')).toBeRejectedWithError(/Voting with Google Vault is not available/);
    expect(chia.signSpendBundle).not.toHaveBeenCalled();
    expect(api.completeVaultVote).not.toHaveBeenCalled();
  });

  it('signs and completes the exact server-built BLS vote package with an external wallet', async () => {
    const spends = [
      {
        coin: {
          parentCoinInfo: '0x' + '61'.repeat(32),
          puzzleHash: '0x' + '62'.repeat(32),
          amount: 10000,
        },
        puzzleReveal: '0x80',
        solution: '0x80',
      },
    ];
    api.prepareVaultVote.and.resolveTo({
      schemaVersion: 1,
      proposalId: 'GOV-1',
      proposalHash: '0x' + '63'.repeat(32),
      operationHash: '0x' + '64'.repeat(32),
      vaultLauncherId: launcher,
      vaultCoinId: '0x' + '65'.repeat(32),
      vaultAuthType: 'chia_bls',
      sgtCoinId: '0x' + '66'.repeat(32),
      voteAmount: '10000',
      availableSgtAmounts: ['10000'],
      votingDeadline: 1_900_000_000,
      currentVoteTally: '0',
      signingCoinSpends: spends,
      review: {
        network: 'testnet11',
        action: 'Lock SGT for this governance vote',
        proposalTitle: 'Allocation',
        proposalHash: '0x' + '63'.repeat(32),
        vaultLauncherId: launcher,
        sgtAmount: '10000',
        financialEffect: 'SGT remains in the vault.',
        reversibleAfterSubmission: false,
      },
    });
    chia.signSpendBundle.and.resolveTo({
      coinSpends: spends,
      aggregatedSignature: '0x' + '67'.repeat(96),
    });
    api.completeVaultVote.and.resolveTo({
      schemaVersion: 1,
      proposalId: 'GOV-1',
      proposalHash: '0x' + '63'.repeat(32),
      operationHash: '0x' + '64'.repeat(32),
      vaultLauncherId: launcher,
      sgtCoinId: '0x' + '66'.repeat(32),
      voteAmount: '10000',
      status: 'MEMPOOL_OBSERVED',
      spendBundleId: '0x' + '68'.repeat(32),
      feeMojos: '5',
      feeTargetSeconds: 180,
      submissionProvider: 'local-node',
      mempoolObservedAt: '2026-08-01T18:00:00Z',
    });

    const result = await service.vote('GOV-1', '10000');

    expect(ownerSession.ensure).toHaveBeenCalledOnceWith(launcher);
    expect(chia.signSpendBundle).toHaveBeenCalledOnceWith(spends);
    expect(api.completeVaultVote).toHaveBeenCalledOnceWith('GOV-1', launcher, {
      voteAmount: '10000',
      operationHash: '0x' + '64'.repeat(32),
      aggregatedSignature: '0x' + '67'.repeat(96),
    });
    expect(result.spendBundleId).toBe('0x' + '68'.repeat(32));
  });

  for (const priorConnection of ['goby', 'google'] as const) {
  it(`uses the EIP-712 signer for an EVM-owned vault after ${priorConnection}`, async () => {
    connectionState.set(priorConnection);
    sessionState.set({ authType: 'evm', vaultLauncherId: launcher });
    const typedData = {
      domain: { name: 'Solslot', version: '2', chainId: 11155111 },
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        SolslotVaultSpend: [{ name: 'operationHash', type: 'bytes32' }],
      },
      primaryType: 'SolslotVaultSpend',
      message: { operationHash: '0x' + '74'.repeat(32) },
    };
    ownerSession.ensure.and.resolveTo({
      vaultLauncherId: launcher,
      authType: 'evm',
      network: 'testnet11',
      protocolVersion: 'solslot-v2',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    api.prepareVaultVote.and.resolveTo({
      schemaVersion: 1,
      proposalId: 'GOV-EVM',
      proposalHash: '0x' + '71'.repeat(32),
      operationHash: '0x' + '72'.repeat(32),
      vaultLauncherId: launcher,
      vaultCoinId: '0x' + '73'.repeat(32),
      vaultAuthType: 'evm',
      vaultTypedData: typedData,
      sgtCoinId: '0x' + '74'.repeat(32),
      voteAmount: '25000',
      availableSgtAmounts: ['25000'],
      votingDeadline: 1_900_000_000,
      currentVoteTally: '0',
      signingCoinSpends: [],
      review: {
        network: 'testnet11',
        action: 'Lock SGT for this governance vote',
        proposalTitle: 'EVM allocation',
        proposalHash: '0x' + '71'.repeat(32),
        vaultLauncherId: launcher,
        sgtAmount: '25000',
        financialEffect: 'SGT remains in the vault.',
        reversibleAfterSubmission: false,
      },
    });
    evm.signTypedData.and.resolveTo('0x' + '75'.repeat(65));
    api.completeVaultVote.and.resolveTo({
      schemaVersion: 1,
      proposalId: 'GOV-EVM',
      proposalHash: '0x' + '71'.repeat(32),
      operationHash: '0x' + '72'.repeat(32),
      vaultLauncherId: launcher,
      sgtCoinId: '0x' + '74'.repeat(32),
      voteAmount: '25000',
      status: 'MEMPOOL_OBSERVED',
      spendBundleId: '0x' + '76'.repeat(32),
      feeMojos: '4',
      feeTargetSeconds: 180,
      submissionProvider: 'local-node',
      mempoolObservedAt: '2026-08-01T18:00:00Z',
    });

    await service.vote('GOV-EVM', '25000');

    expect(evm.signTypedData).toHaveBeenCalledOnceWith(typedData);
    expect(chia.signSpendBundle).not.toHaveBeenCalled();
    expect(api.completeVaultVote).toHaveBeenCalledOnceWith('GOV-EVM', launcher, {
      voteAmount: '25000',
      operationHash: '0x' + '72'.repeat(32),
      vaultOwnerAuthorization: '0x' + '75'.repeat(65),
    });
  });
  }
});
