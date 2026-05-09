import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SignedSpendBundle } from './chia-wallet.service';
import { CoinsetService } from './coinset.service';
import { VaultState } from './populis-api.service';
import { SessionService } from './session.service';
import { VaultAcceptOfferAuthorizationResult } from './vault-accept-offer-authorize.service';
import { VaultAcceptOfferSpendPackage } from './vault-accept-offer-spend.service';
import { VaultAcceptOfferCommitService } from './vault-accept-offer-commit.service';

const VAULT_LAUNCHER_ID = '0x' + '01'.repeat(32);
const BEFORE_COIN_ID = '0x' + '02'.repeat(32);
const NEXT_COIN_ID = '0x' + '03'.repeat(32);
const NEXT_PUZZLE_HASH = '0x' + '04'.repeat(32);
const SIGNED_BUNDLE: SignedSpendBundle = {
  coinSpends: [],
  aggregatedSignature: '0x' + 'aa'.repeat(96),
};

describe('VaultAcceptOfferCommitService', () => {
  let service: VaultAcceptOfferCommitService;
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
        VaultAcceptOfferCommitService,
        { provide: CoinsetService, useValue: coinset },
        { provide: SessionService, useValue: sessionMock },
      ],
    });
    service = TestBed.inject(VaultAcceptOfferCommitService);
  });

  it('pushes the signed bundle and resolves after the expected accept-offer vault coin confirms', async () => {
    refreshQueue.push(vaultState(BEFORE_COIN_ID, '0x' + '05'.repeat(32), 10));
    refreshQueue.push(vaultState(NEXT_COIN_ID, NEXT_PUZZLE_HASH, 11));

    const result = await service.commitAuthorizedAcceptOffer(authorization(), {
      timeoutMs: 1_000,
      delayMsOverride: 0,
    });

    expect(coinset.pushTransaction).toHaveBeenCalledOnceWith(SIGNED_BUNDLE);
    expect(result.pushResponse.status).toBe('SUCCESS');
    expect(result.confirmedVaultCoinId).toBe(NEXT_COIN_ID);
    expect(result.confirmedBlockIndex).toBe(11);
  });

  it('rejects if the vault advances to an unexpected coin after submission', async () => {
    refreshQueue.push(vaultState('0x' + '99'.repeat(32), NEXT_PUZZLE_HASH, 12));

    await expectAsync(
      service.commitAuthorizedAcceptOffer(authorization(), { timeoutMs: 1_000, delayMsOverride: 0 }),
    ).toBeRejectedWithError(/unexpected coin/);

    expect(coinset.pushTransaction).toHaveBeenCalledOnceWith(SIGNED_BUNDLE);
  });

  it('rejects malformed authorization before pushing', async () => {
    await expectAsync(
      service.commitAuthorizedAcceptOffer({
        ...authorization(),
        packageState: { ...packageState(), spendCase: '0x7a' as '0x61' },
      }),
    ).toBeRejectedWithError(/unsupported spend case/);

    await expectAsync(
      service.commitAuthorizedAcceptOffer({
        ...authorization(),
        signedSpendBundle: { ...SIGNED_BUNDLE, aggregatedSignature: '0x' + 'aa'.repeat(95) },
      }),
    ).toBeRejectedWithError(/96 bytes/);

    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });
});

function authorization(): VaultAcceptOfferAuthorizationResult {
  return {
    packageState: packageState(),
    signedSpendBundle: SIGNED_BUNDLE,
  };
}

function packageState(): VaultAcceptOfferSpendPackage {
  return {
    status: 'unsigned',
    backendSigning: false,
    spendCase: '0x61',
    authType: 1,
    vaultLauncherId: VAULT_LAUNCHER_ID,
    offerId: 'offer-1',
    offerArtifactId: 'artifact-1',
    deedLauncherId: '0x' + '06'.repeat(32),
    tokenAmount: 100,
    poolInnerPuzzleHash: '0x' + '07'.repeat(32),
    identityAttestRoot: '0x' + '08'.repeat(32),
    attestationLeafHash: '0x' + '09'.repeat(32),
    attestationProof: { bitpath: 0, siblings: [] },
    vaultCoin: {
      parentCoinInfo: '0x' + '00'.repeat(32),
      puzzleHash: '0x' + '05'.repeat(32),
      amount: 1,
      coinId: BEFORE_COIN_ID,
    },
    vaultInnerPuzzleHash: '0x' + '0a'.repeat(32),
    vaultFullPuzzleHash: '0x' + '05'.repeat(32),
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
    acceptOfferInnerSolution: '0xff80',
    acceptOfferInnerSolutionTreeHash: '0x' + '0b'.repeat(32),
    vaultSignatureData: '0x',
    coinSpends: [],
    unsignedSpendBundle: { coinSpends: [], aggregatedSignature: null },
  };
}

function vaultState(currentCoinId: string, puzzleHash: string, blockIndex: number): VaultState {
  return {
    vault_launcher_id: VAULT_LAUNCHER_ID,
    vault_full_puzhash: puzzleHash,
    p2_vault_puzhash: '0x' + '0c'.repeat(32),
    auth_type: 'chia_bls',
    owner_address: null,
    owner_pubkey: '0x' + '0d'.repeat(48),
    confirmed: true,
    confirmed_block_index: blockIndex,
    current_coin_id: currentCoinId,
    balance: { xch_mojos: 1, deeds: [] },
  };
}
