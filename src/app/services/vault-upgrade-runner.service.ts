/**
 * One-click vault upgrade runner (vault upgrade Brick 6d).
 *
 * Drives the wallet + chain side of the upgrade on top of the pure builders
 * in {@link VaultUpgradeService} (Brick 6c):
 *
 *   1. Read the old vault's identity/params + registry descriptor from chain
 *      and verify the recovered identity reconstructs the live coin (safety
 *      gate against launching at the wrong identity).
 *   2. Derive the CANONICAL params (env pool fields + the validator-derived
 *      bridge policy hash) the registry only publishes as hashes, then launch
 *      a new vault at them: pick + sign a funding coin that creates the
 *      launcher, combine with the permissionless launcher spend, push, and
 *      wait for the eve coin to confirm.
 *   3. If the old vault is at current code (``canMigrateDeeds``), migrate each
 *      deed sequentially — every migration spends the old vault once (it
 *      recreates itself), so we sign + push + await confirmation + re-derive
 *      the vault's next state coin before the next deed.
 *
 * Freely-transferable XCH / pool-share CATs are ordinary sends the user can
 * do from their wallet; they are out of scope for the singleton orchestration
 * here and surfaced to the UI as a manual follow-up.
 *
 * This service performs wallet signing and broadcasts; the component (the UI
 * half of 6d) only renders the progress it streams.
 */
import { Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';
import { bytesToHex, coinId as computeCoinId, hexToBytes } from '../utils/chia-hash';
import { ChiaWasmService } from './chia-wasm.service';
import { CoinsetService, PushTxResponse } from './coinset.service';
import {
  ChiaWalletService,
  SignedSpendBundle,
  UnsignedCoinSpend,
} from './chia-wallet.service';
import { WalletCoinPickerService } from './wallet-coin-picker.service';
import {
  CanonicalVaultParams,
  SINGLETON_LAUNCHER_HASH,
  SINGLETON_MOD_HASH,
  VaultIdentity,
  VaultLaunchSpendService,
} from './vault-launch-spend.service';
import { SingletonLineageProof } from './vault-migrate-spend.service';
import { ZKPASSPORT_BRIDGE_MESSAGE_PUZZLE_HEX } from './zkpassport-vault-enrollment.puzzle-hex';
import {
  CoinFields,
  DiscoveredDeed,
  UpgradeContext,
  VaultUpgradeService,
} from './vault-upgrade.service';

/** A single deed's migration outcome. */
export interface MigratedDeed {
  deedLauncherId: string;
  pushResponse: PushTxResponse;
}

/** Final result of a completed upgrade run. */
export interface UpgradeRunResult {
  /** The new vault's launcher id (the user's vault id going forward). */
  newVaultLauncherId: string;
  /** Push response for the launch bundle. */
  launchPushResponse: PushTxResponse;
  /** Per-deed migration results, in the order they were migrated. */
  migratedDeeds: MigratedDeed[];
  /** True when the old vault's code predates ``migrate`` so deeds could not
   *  be moved by this flow (only freely-transferable assets can move). */
  deedsUnmigratable: boolean;
}

/** Streamed progress so the UI can show a live status line. */
export interface UpgradeProgress {
  phase:
    | 'loading'
    | 'launching'
    | 'awaiting_launch'
    | 'discovering_deeds'
    | 'migrating_deed'
    | 'done';
  message: string;
  newVaultLauncherId?: string;
  /** 1-based index of the deed currently being migrated. */
  deedIndex?: number;
  deedTotal?: number;
  deedLauncherId?: string;
}

type ProgressFn = (progress: UpgradeProgress) => void;

@Injectable({ providedIn: 'root' })
export class VaultUpgradeRunnerService {
  private readonly upgrade = inject(VaultUpgradeService);
  private readonly launch = inject(VaultLaunchSpendService);
  private readonly wallet = inject(ChiaWalletService);
  private readonly coinPicker = inject(WalletCoinPickerService);
  private readonly coinset = inject(CoinsetService);
  private readonly wasm = inject(ChiaWasmService);

  /** Poll cadence while waiting for a spend to confirm. */
  static readonly POLL_INTERVAL_MS = 5_000;
  /** Give a launch / migrate this long to confirm before giving up. */
  static readonly CONFIRM_TIMEOUT_MS = 240_000;

  /**
   * Run the full upgrade for a vault.  Resolves with the new launcher id +
   * per-deed results, or throws with an actionable message (nothing is left
   * half-done that the user can't recover by retrying — each step is a
   * standalone signed bundle).
   */
  async runUpgrade(vaultLauncherId: string, onProgress?: ProgressFn): Promise<UpgradeRunResult> {
    const progress = onProgress ?? (() => undefined);

    progress({ phase: 'loading', message: 'Reading vault state from chain…' });
    const context = await this.upgrade.loadUpgradeContext(vaultLauncherId);
    if (!context) {
      throw new Error(
        'Vault upgrade: the vault is not in an upgradeable state yet (not on ' +
          'chain, still at its eve coin, or the WASM SDK is not ready). Refresh and retry.',
      );
    }
    if (!context.registry) {
      throw new Error(
        'Vault upgrade: the on-chain vault-version registry is unavailable, so ' +
          'the canonical descriptor cannot be confirmed. Refusing to launch.',
      );
    }
    if (!context.isOutdated) {
      throw new Error('Vault upgrade: this vault already matches the registry — nothing to upgrade.');
    }

    // Safety gate: the identity we recovered (from the latest spent ancestor)
    // must reconstruct the LIVE vault coin.  If it does not, the vault's
    // identity moved since that ancestor (e.g. an enrollment in the tail) and
    // we must not launch a new vault at a stale identity.
    this.assertIdentityReconstructsLiveCoin(context);

    const canonicalParams = this.deriveCanonicalParams();

    // ── Launch the new vault ────────────────────────────────────────────
    progress({ phase: 'launching', message: 'Funding and signing the new vault launch…' });
    const funding = await this.buildAndSignLauncherFundingSpend();
    const launchPlan = this.upgrade.buildLaunchPlan({
      fundingCoinId: funding.fundingCoinId,
      identity: context.identity,
      params: canonicalParams,
      registryVaultInnerModHash: context.registry.vaultInnerModHash,
      registryCanonicalParamsHash: context.registry.canonicalParamsHash,
    });
    const launchBundle: SignedSpendBundle = {
      coinSpends: [...funding.signed.coinSpends, launchPlan.launcherCoinSpend],
      aggregatedSignature: funding.signed.aggregatedSignature,
    };
    const launchPushResponse = await this.coinset.pushTransaction(launchBundle);

    progress({
      phase: 'awaiting_launch',
      message: 'Waiting for the new vault to confirm on chain…',
      newVaultLauncherId: launchPlan.newVaultLauncherId,
    });
    const eveCoinId = computeCoinId(
      launchPlan.newVaultLauncherId,
      launchPlan.launchOutputs.vaultFullPuzzleHash,
      launchPlan.launchOutputs.eveCoin.amount,
    );
    await this.waitForCoinConfirmed(eveCoinId);

    // ── Migrate deeds ───────────────────────────────────────────────────
    if (!context.canMigrateDeeds) {
      progress({
        phase: 'done',
        message:
          'New vault is live. This vault predates the migrate upgrade, so its ' +
          'deeds cannot be moved automatically — only freely-transferable assets.',
        newVaultLauncherId: launchPlan.newVaultLauncherId,
      });
      return {
        newVaultLauncherId: launchPlan.newVaultLauncherId,
        launchPushResponse,
        migratedDeeds: [],
        deedsUnmigratable: true,
      };
    }

    progress({
      phase: 'discovering_deeds',
      message: 'Discovering deeds held at the old vault…',
      newVaultLauncherId: launchPlan.newVaultLauncherId,
    });
    const deeds = await this.upgrade.discoverDeedsAtVault(vaultLauncherId);

    const migratedDeeds = await this.migrateDeeds({
      context,
      newVaultLauncherId: launchPlan.newVaultLauncherId,
      deeds,
      progress,
    });

    progress({
      phase: 'done',
      message: `Upgrade complete. ${migratedDeeds.length} deed(s) migrated to the new vault.`,
      newVaultLauncherId: launchPlan.newVaultLauncherId,
    });
    return {
      newVaultLauncherId: launchPlan.newVaultLauncherId,
      launchPushResponse,
      migratedDeeds,
      deedsUnmigratable: false,
    };
  }

  // ── Deed migration loop ─────────────────────────────────────────────────

  private async migrateDeeds(args: {
    context: UpgradeContext;
    newVaultLauncherId: string;
    deeds: DiscoveredDeed[];
    progress: ProgressFn;
  }): Promise<MigratedDeed[]> {
    const { context, newVaultLauncherId, deeds, progress } = args;
    const oldVaultInnerPuzzleHash = this.launch.vaultInnerPuzzleHash(
      context.vaultLauncherId,
      context.identity,
      context.oldParams,
    );
    // The vault recreates itself UNCHANGED across a migrate, so its full
    // puzzle hash is constant; only the coin (parent/id) advances per deed.
    let currentVaultCoin: CoinFields = context.currentVaultCoin;
    let vaultLineageProof: SingletonLineageProof = context.vaultLineageProof;

    const migrated: MigratedDeed[] = [];
    for (let i = 0; i < deeds.length; i++) {
      const deed = deeds[i];
      progress({
        phase: 'migrating_deed',
        message: `Migrating deed ${i + 1} of ${deeds.length}…`,
        newVaultLauncherId,
        deedIndex: i + 1,
        deedTotal: deeds.length,
        deedLauncherId: deed.deedLauncherId,
      });

      const plan = this.upgrade.buildDeedMigratePlan({
        oldVaultLauncherId: context.vaultLauncherId,
        currentVaultCoin,
        vaultLineageProof,
        identity: context.identity,
        oldParams: context.oldParams,
        deed,
        newVaultLauncherId,
        currentTimestamp: Math.floor(Date.now() / 1000),
      });

      // The wallet signs the owner AGG_SIG_ME for the vault 'm' spend; the
      // deed's p2_vault spend carries no signature.
      const signed = await this.wallet.signSpendBundle(plan.coinSpends);
      const pushResponse = await this.coinset.pushTransaction({
        coinSpends: signed.coinSpends,
        aggregatedSignature: signed.aggregatedSignature,
      });

      // Wait for the vault coin we just spent to be marked spent on chain,
      // then advance to its self-recreated child for the next deed.
      await this.waitForCoinSpent(plan.ownerSigningRequest.vaultCoinId);

      const nextVaultCoin: CoinFields = {
        parentCoinInfo: plan.ownerSigningRequest.vaultCoinId,
        puzzleHash: currentVaultCoin.puzzleHash,
        amount: currentVaultCoin.amount,
      };
      const nextLineageProof: SingletonLineageProof = {
        parentParentCoinInfo: currentVaultCoin.parentCoinInfo,
        parentInnerPuzzleHash: oldVaultInnerPuzzleHash,
        parentAmount: currentVaultCoin.amount,
      };
      currentVaultCoin = nextVaultCoin;
      vaultLineageProof = nextLineageProof;

      migrated.push({ deedLauncherId: deed.deedLauncherId, pushResponse });
    }
    return migrated;
  }

  // ── Canonical params ────────────────────────────────────────────────────

  /**
   * Assemble the canonical protocol params the new vault must launch at: the
   * fixed pool singleton constants + the env pool launcher id + the bridge
   * policy hash derived from the configured validator set (the registry only
   * publishes the hash, so the portal supplies the preimage).
   */
  deriveCanonicalParams(): CanonicalVaultParams {
    const poolLauncherId = environment.populisProtocol?.poolLauncherId;
    if (!poolLauncherId) {
      throw new Error('Vault upgrade: environment.populisProtocol.poolLauncherId is not configured.');
    }
    const validatorPubkeys = environment.zkPassport.validatorPubkeys;
    const threshold = environment.zkPassport.validatorThreshold;
    if (!validatorPubkeys?.length || !Number.isInteger(threshold) || threshold < 1) {
      throw new Error('Vault upgrade: zkPassport validator set / threshold is not configured.');
    }
    const clvm = this.fundingSdk().Clvm;
    const c = new clvm();
    const bridgePuzzle = c
      .deserialize(hexToBytes(ZKPASSPORT_BRIDGE_MESSAGE_PUZZLE_HEX))
      .curry([
        c.list(validatorPubkeys.map((pk) => c.atom(hexToBytes(pk)))),
        c.int(BigInt(threshold)),
      ]);
    return {
      poolSingletonModHash: SINGLETON_MOD_HASH,
      poolLauncherId: normalizeHex(poolLauncherId),
      poolSingletonLauncherPuzzleHash: SINGLETON_LAUNCHER_HASH,
      zkpassportBridgePolicyHash: bytesToHexPrefixed(bridgePuzzle.treeHash()),
    };
  }

  // ── Funding spend ───────────────────────────────────────────────────────

  /**
   * Pick the largest unlocked wallet coin, build a standard spend that creates
   * the singleton launcher coin (+ change), and have the wallet sign it.  The
   * launcher's parent is exactly the coin we spend, so we return its id.
   *
   * Mirrors ``AdminAuthorityV2Service.buildAndSignFundingSpend`` (the proven
   * WASM-first funding path) — kept self-contained so the upgrade flow doesn't
   * couple to the admin-authority service.
   */
  private async buildAndSignLauncherFundingSpend(): Promise<{
    signed: SignedSpendBundle;
    fundingCoinId: string;
  }> {
    const sdk = this.fundingSdk();
    const pubkeyHex = this.wallet.pubkey();
    if (!pubkeyHex) {
      throw new Error('Vault upgrade: wallet not connected.');
    }
    const syntheticKey = sdk.PublicKey.fromBytes(hexToBytes(pubkeyHex));
    const fundingPuzzleHashBytes = sdk.standardPuzzleHash(syntheticKey);
    const fundingPuzzleHash = bytesToHexPrefixed(fundingPuzzleHashBytes);

    const pick = await this.coinPicker.pickLargestUnspentCoinForPuzzleHash({
      puzzleHash: fundingPuzzleHash,
    });
    const record = await this.coinset.getCoinRecordByName(pick.coinId);
    if (!record) {
      throw new Error(
        `Vault upgrade: funding coin ${pick.coinId} not found on chain (it may have ` +
          'been spent between selection and submit). Retry.',
      );
    }
    if (!sameHex(record.coin.puzzle_hash, fundingPuzzleHash)) {
      throw new Error(
        'Vault upgrade: selected funding coin no longer matches the connected wallet key. Retry.',
      );
    }
    const coinAmount = BigInt(record.coin.amount);
    const sendAmount = 1n; // launcher coin is 1 mojo
    if (coinAmount < sendAmount) {
      throw new Error(
        `Vault upgrade: funding coin holds only ${coinAmount} mojos; need at least ${sendAmount}.`,
      );
    }
    const changeAmount = coinAmount - sendAmount;

    const clvm = new sdk.Clvm();
    const conditions = [clvm.createCoin(hexToBytes(SINGLETON_LAUNCHER_HASH), sendAmount, undefined)];
    if (changeAmount > 0n) {
      conditions.push(clvm.createCoin(fundingPuzzleHashBytes, changeAmount, undefined));
    }
    const innerSpend = clvm.delegatedSpend(conditions);
    const sourceCoin = new sdk.Coin(
      hexToBytes(record.coin.parent_coin_info),
      hexToBytes(record.coin.puzzle_hash),
      coinAmount,
    );
    clvm.spendStandardCoin(sourceCoin, syntheticKey, innerSpend);

    const coinSpends = clvm.coinSpends();
    if (coinSpends.length !== 1) {
      throw new Error(`Vault upgrade: expected exactly 1 funding coin spend, got ${coinSpends.length}.`);
    }
    const cs = coinSpends[0];
    const unsigned: UnsignedCoinSpend[] = [
      {
        coin: {
          parentCoinInfo: bytesToHexPrefixed(cs.coin.parentCoinInfo),
          puzzleHash: bytesToHexPrefixed(cs.coin.puzzleHash),
          amount: cs.coin.amount,
        },
        puzzleReveal: bytesToHexPrefixed(cs.puzzleReveal),
        solution: bytesToHexPrefixed(cs.solution),
      },
    ];
    const signed = await this.wallet.signSpendBundle(unsigned);
    // The launcher's parent is the funding coin we just spent.
    return { signed, fundingCoinId: normalizeHex(pick.coinId) };
  }

  // ── Confirmation polling ────────────────────────────────────────────────

  /** Resolve once a coin id exists on chain (confirmed in a block). */
  private async waitForCoinConfirmed(coinId: string): Promise<void> {
    await this.poll(async () => {
      const record = await this.coinset.getCoinRecordByName(coinId);
      return !!record && record.confirmed_block_index > 0;
    }, `coin ${coinId} did not confirm`);
  }

  /** Resolve once a coin id is marked spent on chain. */
  private async waitForCoinSpent(coinId: string): Promise<void> {
    await this.poll(async () => {
      const record = await this.coinset.getCoinRecordByName(coinId);
      return !!record && record.spent_block_index > 0;
    }, `coin ${coinId} did not get spent`);
  }

  private async poll(predicate: () => Promise<boolean>, timeoutMessage: string): Promise<void> {
    const deadline = Date.now() + VaultUpgradeRunnerService.CONFIRM_TIMEOUT_MS;
    // First check immediately, then on each interval.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (await predicate()) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Vault upgrade: timed out after ${timeoutMessage}. Refresh to check status.`);
      }
      await sleep(VaultUpgradeRunnerService.POLL_INTERVAL_MS);
    }
  }

  // ── internals ───────────────────────────────────────────────────────────

  private assertIdentityReconstructsLiveCoin(context: UpgradeContext): void {
    const reconstructed = this.launch.vaultFullPuzzleHash(
      context.vaultLauncherId,
      context.identity,
      context.oldParams,
    );
    if (!sameHex(reconstructed, context.currentVaultCoin.puzzleHash)) {
      throw new Error(
        'Vault upgrade: the recovered vault identity does not reconstruct the live ' +
          'coin (its identity likely changed in the most recent spend, e.g. an ' +
          'enrollment). Refusing to launch a new vault at a stale identity; refresh and retry.',
      );
    }
  }

  private fundingSdk(): FundingSdk {
    const sdk = this.wasm.sdk() as Partial<FundingSdk>;
    if (!sdk.Clvm || !sdk.Coin || !sdk.PublicKey || !sdk.standardPuzzleHash) {
      throw new Error(
        'Vault upgrade: chia-wallet-sdk-wasm is missing Clvm/Coin/PublicKey/standardPuzzleHash exports.',
      );
    }
    return sdk as FundingSdk;
  }
}

interface FundingProgram {
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
  curry(args: unknown[]): FundingProgram;
}

interface FundingClvm {
  createCoin(puzzleHash: Uint8Array, amount: bigint, memos: undefined): unknown;
  delegatedSpend(conditions: unknown[]): unknown;
  spendStandardCoin(coin: unknown, syntheticKey: unknown, innerSpend: unknown): void;
  coinSpends(): Array<{
    coin: { parentCoinInfo: Uint8Array; puzzleHash: Uint8Array; amount: bigint };
    puzzleReveal: Uint8Array;
    solution: Uint8Array;
  }>;
  deserialize(bytes: Uint8Array): FundingProgram;
  atom(bytes: Uint8Array): unknown;
  int(value: bigint): unknown;
  list(items: unknown[]): unknown;
  nil(): unknown;
}

interface FundingSdk {
  Clvm: new () => FundingClvm;
  Coin: new (parentCoinInfo: Uint8Array, puzzleHash: Uint8Array, amount: bigint) => {
    coinId(): Uint8Array;
  };
  PublicKey: { fromBytes(bytes: Uint8Array): unknown };
  standardPuzzleHash(syntheticKey: unknown): Uint8Array;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToHexPrefixed(bytes: Uint8Array): string {
  return '0x' + bytesToHex(bytes).replace(/^0x/, '');
}

function normalizeHex(value: string): string {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`invalid hex string: ${value}`);
  }
  return `0x${hex.toLowerCase()}`;
}

function sameHex(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}
