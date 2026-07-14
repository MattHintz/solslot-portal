/**
 * Tests for the upgrade runner (Brick 6d, orchestration half).
 *
 * The runner is pure I/O glue over the 6c pure builders, so everything is
 * mocked: the 6c/6a services, the wallet, the coin picker, coinset, and a fake
 * WASM funding SDK.  We assert the orchestration contract — funding+launcher
 * combined into one launch bundle, the launch awaited, and deeds migrated
 * sequentially with the vault's self-recreated coin advanced between each.
 */
import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { coinId as computeCoinId } from '../utils/chia-hash';
import { ChiaWasmService } from './chia-wasm.service';
import { ChiaWalletService } from './chia-wallet.service';
import { CoinsetService } from './coinset.service';
import { WalletCoinPickerService } from './wallet-coin-picker.service';
import {
  SINGLETON_LAUNCHER_HASH,
  SINGLETON_MOD_HASH,
  VaultLaunchSpendService,
} from './vault-launch-spend.service';
import { UpgradeContext, VaultUpgradeService } from './vault-upgrade.service';
import { VaultUpgradeRunnerService } from './vault-upgrade-runner.service';

const h = (byte: string) => '0x' + byte.repeat(32);
const FUNDING_PH = '0x' + '70'.repeat(32);
const FUNDING_COIN_ID = '0x' + '33'.repeat(32);
const NEW_LAUNCHER = '0x' + '99'.repeat(32);
const NEW_VAULT_FULL_PH = '0x' + '88'.repeat(32);
const OLD_INNER_PH = '0x' + 'a5'.repeat(32);
const originalProtocol = { ...environment.solslotProtocol } as Record<string, unknown>;
const originalZkPassport = { ...environment.zkPassport } as Record<string, unknown>;

// ── Fake WASM funding SDK ───────────────────────────────────────────────
class FakeProgram {
  treeHash(): Uint8Array {
    return new Uint8Array(32).fill(0xab);
  }
  serialize(): Uint8Array {
    return new Uint8Array([1, 2, 3]);
  }
  curry(): FakeProgram {
    return new FakeProgram();
  }
}
class FakeClvm {
  createCoin(): unknown {
    return {};
  }
  delegatedSpend(): unknown {
    return {};
  }
  spendStandardCoin(): void {
    /* no-op */
  }
  coinSpends() {
    return [
      {
        coin: {
          parentCoinInfo: new Uint8Array(32).fill(0x11),
          puzzleHash: new Uint8Array(32).fill(0x70),
          amount: 100n,
        },
        puzzleReveal: new Uint8Array([0xaa]),
        solution: new Uint8Array([0xbb]),
      },
    ];
  }
  deserialize(): FakeProgram {
    return new FakeProgram();
  }
  atom(): unknown {
    return {};
  }
  int(): unknown {
    return {};
  }
  list(): unknown {
    return {};
  }
  nil(): unknown {
    return {};
  }
}
const fakeSdk = {
  Clvm: FakeClvm,
  Coin: class {
    coinId(): Uint8Array {
      return new Uint8Array(32).fill(0x09);
    }
  },
  PublicKey: { fromBytes: () => ({}) },
  standardPuzzleHash: () => new Uint8Array(32).fill(0x70),
};

function makeContext(overrides: Partial<UpgradeContext> = {}): UpgradeContext {
  return {
    vaultLauncherId: h('12'),
    currentVaultCoin: { parentCoinInfo: h('aa'), puzzleHash: h('dd'), amount: 1n },
    vaultLineageProof: {
      parentParentCoinInfo: h('bb'),
      parentInnerPuzzleHash: h('cc'),
      parentAmount: 1n,
    },
    identity: {
      ownerPubkey: '0x' + 'a8'.repeat(48),
      authType: 0,
      membersMerkleRoot: h('ee'),
      identityAttestRoot: h('ff'),
    },
    oldParams: {
      poolSingletonModHash: SINGLETON_MOD_HASH,
      poolLauncherId: h('01'),
      poolSingletonLauncherPuzzleHash: SINGLETON_LAUNCHER_HASH,
      zkpassportBridgePolicyHash: h('02'),
    },
    oldVaultInnerModHash: h('03'),
    oldCanonicalParamsHash: h('04'),
    registry: { vaultInnerModHash: h('05'), canonicalParamsHash: h('06'), vaultVersion: 2 },
    isOutdated: true,
    canMigrateDeeds: true,
    p2VaultPuzzleHash: h('77'),
    ...overrides,
  };
}

function launchPlanStub() {
  return {
    newVaultLauncherId: NEW_LAUNCHER,
    launchOutputs: {
      launcherId: NEW_LAUNCHER,
      launcherCoin: { parentCoinInfo: FUNDING_COIN_ID, puzzleHash: SINGLETON_LAUNCHER_HASH, amount: 1n },
      vaultInnerPuzzleHash: h('87'),
      vaultFullPuzzleHash: NEW_VAULT_FULL_PH,
      eveCoin: { parentCoinInfo: NEW_LAUNCHER, puzzleHash: NEW_VAULT_FULL_PH, amount: 1n },
      launcherAnnouncementMessage: h('8a'),
      launcherAnnouncementId: h('8b'),
    },
    launcherCoinSpend: {
      coin: { parentCoinInfo: FUNDING_COIN_ID, puzzleHash: SINGLETON_LAUNCHER_HASH, amount: 1n },
      puzzleReveal: '0xlauncher',
      solution: '0xlsol',
    },
  };
}

describe('VaultUpgradeRunnerService', () => {
  let service: VaultUpgradeRunnerService;
  let upgrade: jasmine.SpyObj<VaultUpgradeService>;
  let launch: jasmine.SpyObj<VaultLaunchSpendService>;
  let wallet: jasmine.SpyObj<ChiaWalletService>;
  let coinPicker: jasmine.SpyObj<WalletCoinPickerService>;
  let coinset: jasmine.SpyObj<CoinsetService>;

  beforeEach(() => {
    Object.assign(environment.solslotProtocol as Record<string, unknown>, {
      poolLauncherId: h('01'),
    });
    Object.assign(environment.zkPassport as Record<string, unknown>, {
      validatorPubkeys: ['0x' + 'a8'.repeat(48)],
      validatorThreshold: 1,
    });
    upgrade = jasmine.createSpyObj<VaultUpgradeService>('VaultUpgradeService', [
      'loadUpgradeContext',
      'buildLaunchPlan',
      'discoverDeedsAtVault',
      'buildDeedMigratePlan',
    ]);
    launch = jasmine.createSpyObj<VaultLaunchSpendService>('VaultLaunchSpendService', [
      'vaultInnerPuzzleHash',
      'vaultFullPuzzleHash',
    ]);
    wallet = jasmine.createSpyObj<ChiaWalletService>('ChiaWalletService', ['pubkey', 'signSpendBundle']);
    coinPicker = jasmine.createSpyObj<WalletCoinPickerService>('WalletCoinPickerService', [
      'pickLargestUnspentCoinForPuzzleHash',
    ]);
    coinset = jasmine.createSpyObj<CoinsetService>('CoinsetService', [
      'getCoinRecordByName',
      'pushTransaction',
    ]);

    TestBed.configureTestingModule({
      providers: [
        VaultUpgradeRunnerService,
        { provide: VaultUpgradeService, useValue: upgrade },
        { provide: VaultLaunchSpendService, useValue: launch },
        { provide: ChiaWalletService, useValue: wallet },
        { provide: WalletCoinPickerService, useValue: coinPicker },
        { provide: CoinsetService, useValue: coinset },
        { provide: ChiaWasmService, useValue: { sdk: () => fakeSdk } },
      ],
    });
    service = TestBed.inject(VaultUpgradeRunnerService);

    // Defaults shared across the happy-path tests.
    launch.vaultFullPuzzleHash.and.returnValue(h('dd')); // == context.currentVaultCoin.puzzleHash
    launch.vaultInnerPuzzleHash.and.returnValue(OLD_INNER_PH);
    wallet.pubkey.and.returnValue('0x' + 'a8'.repeat(48));
    wallet.signSpendBundle.and.callFake(async (spends) => ({
      coinSpends: spends,
      aggregatedSignature: '0x' + 'cc'.repeat(96),
    }));
    coinPicker.pickLargestUnspentCoinForPuzzleHash.and.resolveTo({
      coinId: FUNDING_COIN_ID,
      address: 'txch1mock',
      puzzleHash: FUNDING_PH,
      amount: 100n,
    });
    coinset.pushTransaction.and.resolveTo({ success: true, status: 'SUCCESS' });
    coinset.getCoinRecordByName.and.callFake(async (id: string) => {
      if (id.toLowerCase() === FUNDING_COIN_ID.toLowerCase()) {
        return {
          coin: { parent_coin_info: h('11'), puzzle_hash: FUNDING_PH, amount: 100 },
          confirmed_block_index: 10,
          spent_block_index: 0,
          coinbase: false,
          timestamp: 1,
        };
      }
      // Everything else (eve coin, spent vault coins) reads as confirmed+spent.
      return {
        coin: { parent_coin_info: h('00'), puzzle_hash: h('00'), amount: 1 },
        confirmed_block_index: 20,
        spent_block_index: 20,
        coinbase: false,
        timestamp: 1,
      };
    });
  });

  afterEach(() => {
    restoreEnvironment(environment.solslotProtocol as Record<string, unknown>, originalProtocol);
    restoreEnvironment(environment.zkPassport as Record<string, unknown>, originalZkPassport);
  });

  it('launches: combines funding + launcher into one bundle and awaits the eve coin', async () => {
    upgrade.loadUpgradeContext.and.resolveTo(makeContext({ canMigrateDeeds: false }));
    upgrade.buildLaunchPlan.and.returnValue(launchPlanStub() as never);

    const result = await service.runUpgrade(h('12'));

    expect(result.newVaultLauncherId).toBe(NEW_LAUNCHER);
    expect(result.deedsUnmigratable).toBeTrue();
    expect(result.migratedDeeds).toEqual([]);

    // buildLaunchPlan got the funding coin id + canonical params (derived bridge hash).
    const launchArgs = upgrade.buildLaunchPlan.calls.mostRecent().args[0];
    expect(launchArgs.fundingCoinId).toBe(FUNDING_COIN_ID);
    expect(launchArgs.params.poolSingletonModHash).toBe(SINGLETON_MOD_HASH);
    expect(launchArgs.params.poolSingletonLauncherPuzzleHash).toBe(SINGLETON_LAUNCHER_HASH);
    expect(launchArgs.params.zkpassportBridgePolicyHash).toBe('0x' + 'ab'.repeat(32));
    expect(launchArgs.registryCanonicalParamsHash).toBe(h('06'));

    // The launch bundle = funding spend(s) + the permissionless launcher spend.
    const launchBundle = coinset.pushTransaction.calls.first().args[0];
    expect(launchBundle.coinSpends.length).toBe(2);
    expect(launchBundle.coinSpends[1].puzzleReveal).toBe('0xlauncher');
    expect(launchBundle.aggregatedSignature).toBe('0x' + 'cc'.repeat(96));

    // The eve coin id we waited on is derived from launcher + full puzzle hash.
    const eveCoinId = computeCoinId(NEW_LAUNCHER, NEW_VAULT_FULL_PH, 1n);
    expect(coinset.getCoinRecordByName).toHaveBeenCalledWith(eveCoinId);
  });

  it('migrates deeds sequentially, advancing the vault coin between each', async () => {
    upgrade.loadUpgradeContext.and.resolveTo(makeContext());
    upgrade.buildLaunchPlan.and.returnValue(launchPlanStub() as never);
    upgrade.discoverDeedsAtVault.and.resolveTo([
      { deedLauncherId: h('d1'), deedCoin: { parentCoinInfo: h('e1'), puzzleHash: h('f1'), amount: 1 }, deedLineageProof: { parentParentCoinInfo: h('e1'), parentInnerPuzzleHash: null, parentAmount: 1 } },
      { deedLauncherId: h('d2'), deedCoin: { parentCoinInfo: h('e2'), puzzleHash: h('f2'), amount: 1 }, deedLineageProof: { parentParentCoinInfo: h('e2'), parentInnerPuzzleHash: null, parentAmount: 1 } },
    ]);
    const vaultCoinIds = [h('51'), h('52')];
    let call = 0;
    upgrade.buildDeedMigratePlan.and.callFake(() => {
      const vaultCoinId = vaultCoinIds[call++];
      return {
        deedLauncherId: 'deed',
        coinSpends: [
          { coin: { parentCoinInfo: h('00'), puzzleHash: h('00'), amount: 1 }, puzzleReveal: '0xv', solution: '0xvs' },
          { coin: { parentCoinInfo: h('00'), puzzleHash: h('00'), amount: 1 }, puzzleReveal: '0xd', solution: '0xds' },
        ],
        ownerSigningRequest: { signingTree: h('77'), vaultCoinId },
        newP2VaultPuzzleHash: h('a0'),
      } as never;
    });

    const result = await service.runUpgrade(h('12'));

    expect(result.deedsUnmigratable).toBeFalse();
    expect(result.migratedDeeds.length).toBe(2);
    expect(upgrade.buildDeedMigratePlan).toHaveBeenCalledTimes(2);

    // Deed 1 used the initial vault coin from the context.
    const firstArgs = upgrade.buildDeedMigratePlan.calls.argsFor(0)[0];
    expect(firstArgs.currentVaultCoin.parentCoinInfo).toBe(h('aa'));

    // Deed 2 used the self-recreated child of deed 1's vault coin.
    const secondArgs = upgrade.buildDeedMigratePlan.calls.argsFor(1)[0];
    expect(secondArgs.currentVaultCoin.parentCoinInfo).toBe(vaultCoinIds[0]);
    expect(secondArgs.currentVaultCoin.puzzleHash).toBe(h('dd'));
    expect(secondArgs.vaultLineageProof.parentParentCoinInfo).toBe(h('aa'));
    expect(secondArgs.vaultLineageProof.parentInnerPuzzleHash).toBe(OLD_INNER_PH);

    // Each deed was pushed as its own (signed) 2-spend bundle.
    expect(coinset.pushTransaction).toHaveBeenCalledTimes(3); // launch + 2 deeds
  });

  it('refuses when the vault is not outdated', async () => {
    upgrade.loadUpgradeContext.and.resolveTo(makeContext({ isOutdated: false }));
    await expectAsync(service.runUpgrade(h('12'))).toBeRejectedWithError(/already matches the registry/);
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('refuses when the recovered identity does not reconstruct the live coin', async () => {
    upgrade.loadUpgradeContext.and.resolveTo(makeContext());
    launch.vaultFullPuzzleHash.and.returnValue(h('be')); // != currentVaultCoin.puzzleHash
    await expectAsync(service.runUpgrade(h('12'))).toBeRejectedWithError(/does not reconstruct the live/);
    expect(coinset.pushTransaction).not.toHaveBeenCalled();
  });

  it('refuses when the registry is unavailable', async () => {
    upgrade.loadUpgradeContext.and.resolveTo(makeContext({ registry: null }));
    await expectAsync(service.runUpgrade(h('12'))).toBeRejectedWithError(/registry is unavailable/);
  });

  it('derives canonical params from env + the validator-derived bridge hash', () => {
    const params = service.deriveCanonicalParams();
    expect(params.poolSingletonModHash).toBe(SINGLETON_MOD_HASH);
    expect(params.poolSingletonLauncherPuzzleHash).toBe(SINGLETON_LAUNCHER_HASH);
    expect(params.poolLauncherId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(params.zkpassportBridgePolicyHash).toBe('0x' + 'ab'.repeat(32));
  });
});

function restoreEnvironment(
  target: Record<string, unknown>,
  original: Record<string, unknown>,
): void {
  for (const key of Object.keys(target)) {
    if (!(key in original)) delete target[key];
  }
  Object.assign(target, original);
}
