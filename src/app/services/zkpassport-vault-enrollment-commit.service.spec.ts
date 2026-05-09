import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SignedSpendBundle } from './chia-wallet.service';
import { CoinsetService } from './coinset.service';
import { VaultState } from './populis-api.service';
import { SessionService } from './session.service';
import { ZkPassportVaultEnrollmentAuthorizationResult } from './zkpassport-vault-enrollment-authorize.service';
import { ZkPassportVaultEnrollmentSpendPackage } from './zkpassport-vault-enrollment-spend.service';
import { ZkPassportVaultEnrollmentCommitService } from './zkpassport-vault-enrollment-commit.service';

const VAULT_LAUNCHER_ID = '0x' + '01'.repeat(32);
const BEFORE_COIN_ID = '0x' + '02'.repeat(32);
const NEXT_COIN_ID = '0x' + '03'.repeat(32);
const NEXT_PUZZLE_HASH = '0x' + '04'.repeat(32);

const SIGNED_BUNDLE: SignedSpendBundle = {
  coinSpends: [],
  aggregatedSignature: '0x' + 'aa'.repeat(96),
};

describe('ZkPassportVaultEnrollmentCommitService', () => {
  let service: ZkPassportVaultEnrollmentCommitService;
  let coinset: jasmine.SpyObj<CoinsetService>;
  let refreshQueue: Array<VaultState | null>;
  let sessionMock: Pick<SessionService, 'session' | 'vault' | 'refreshVault'>;

  beforeEach(() => {
    coinset = jasmine.createSpyObj<CoinsetService>('CoinsetService', ['pushTransaction']);
    coinset.pushTransaction.and.resolveTo({ success: true, status: 'SUCCESS' });
    refreshQueue = [];
    sessionMock = {
      session: signal(null),
      vault: signal(null),
      refreshVault: async () => refreshQueue.shift() ?? null,
    } as unknown as Pick<SessionService, 'session' | 'vault' | 'refreshVault'>;

    TestBed.configureTestingModule({
      providers: [
        ZkPassportVaultEnrollmentCommitService,
        { provide: CoinsetService, useValue: coinset },
        { provide: SessionService, useValue: sessionMock },
      ],
    });
    service = TestBed.inject(ZkPassportVaultEnrollmentCommitService);
  });

  it('pushes the signed bundle and resolves after the expected next vault coin confirms', async () => {
    refreshQueue.push(vaultState(BEFORE_COIN_ID, '0x' + '05'.repeat(32), 10));
    refreshQueue.push(vaultState(NEXT_COIN_ID, NEXT_PUZZLE_HASH, 11));

    const result = await service.commitAuthorizedEnrollment(authorization(), {
      timeoutMs: 1_000,
      delayMsOverride: 0,
    });

    expect(coinset.pushTransaction).toHaveBeenCalledOnceWith(SIGNED_BUNDLE);
    expect(result.pushResponse.status).toBe('SUCCESS');
    expect(result.confirmedVaultCoinId).toBe(NEXT_COIN_ID);
    expect(result.confirmedBlockIndex).toBe(11);
  });

  it('rejects if the vault advances to an unexpected coin', async () => {
    refreshQueue.push(vaultState('0x' + '99'.repeat(32), NEXT_PUZZLE_HASH, 12));
    await expectAsync(
      service.commitAuthorizedEnrollment(authorization(), { timeoutMs: 1_000, delayMsOverride: 0 }),
    ).toBeRejectedWithError(/unexpected coin/);
  });
});

function authorization(): ZkPassportVaultEnrollmentAuthorizationResult {
  return {
    packageState: packageState(),
    signedSpendBundle: SIGNED_BUNDLE,
  };
}

function packageState(): ZkPassportVaultEnrollmentSpendPackage {
  return {
    status: 'unsigned',
    backendSigning: false,
    spendCase: '0x7a',
    authType: 3,
    vaultLauncherId: VAULT_LAUNCHER_ID,
    vaultCoin: {
      parentCoinInfo: '0x' + '00'.repeat(32),
      puzzleHash: '0x' + '05'.repeat(32),
      amount: 1,
      coinId: BEFORE_COIN_ID,
    },
    bridgeCoin: {
      parentCoinInfo: '0x' + '06'.repeat(32),
      puzzleHash: '0x' + '07'.repeat(32),
      amount: 1,
      coinId: '0x' + '08'.repeat(32),
    },
    bridgePolicyHash: '0x' + '07'.repeat(32),
    vaultInnerPuzzleHash: '0x' + '09'.repeat(32),
    vaultFullPuzzleHash: '0x' + '05'.repeat(32),
    expectedNextVaultInnerPuzzleHash: '0x' + '0a'.repeat(32),
    expectedNextVaultFullPuzzleHash: NEXT_PUZZLE_HASH,
    expectedNextVaultCoin: {
      parentCoinInfo: BEFORE_COIN_ID,
      puzzleHash: NEXT_PUZZLE_HASH,
      amount: 1,
      coinId: NEXT_COIN_ID,
    },
    lineageProof: {
      parentParentCoinInfo: '0x' + '00'.repeat(32),
      parentInnerPuzzleHash: null,
      parentAmount: 1,
    },
    signerIndices: [],
    validatorSignatures: [],
    vaultSignatureData: '0x',
    coinSpends: [],
    unsignedSpendBundle: { coinSpends: [], aggregatedSignature: null },
  };
}

function vaultState(currentCoinId: string, puzzleHash: string, blockIndex: number): VaultState {
  return {
    vault_launcher_id: VAULT_LAUNCHER_ID,
    vault_full_puzhash: puzzleHash,
    p2_vault_puzhash: '0x' + '0b'.repeat(32),
    auth_type: 'evm',
    owner_address: null,
    owner_pubkey: '0x02' + '0c'.repeat(32),
    confirmed: true,
    confirmed_block_index: blockIndex,
    current_coin_id: currentCoinId,
    balance: { xch_mojos: 0, deeds: [] },
  };
}
