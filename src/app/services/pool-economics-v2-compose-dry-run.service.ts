import { Injectable, inject } from '@angular/core';
import { sha256 } from 'ethers';

import { bytesToHex, hexToBytes } from '../utils/chia-hash';
import type { UnsignedCoinSpend } from './chia-wallet.service';
import { ChiaWasmService } from './chia-wasm.service';
import {
  type CollectionNavEvidenceInput,
  type PoolEconomicStateInput,
  PoolEconomicsV2Service,
  type ReserveAcquisitionQuote,
  type SpecificDeedSwapQuote,
  type TrueRedemptionQuote,
} from './pool-economics-v2.service';
import {
  type PoolV2ActionPreviewKind,
} from './pool-economics-v2-action-preview.service';
import {
  type PoolV2CoinSpendBuild,
  POOL_SPEND_V2_RESERVE_ACQUISITION,
  POOL_SPEND_V2_SPECIFIC_DEED_SWAP,
  POOL_SPEND_V2_TRUE_REDEMPTION,
  POOL_V2_MAX_UNSIGNED_BUNDLE_COIN_SPENDS,
  POOL_V2_MAX_WITNESS_COIN_SPENDS,
  type PoolV2RequiredAnnouncement,
  type PoolV2WitnessReplaySummary,
  PoolEconomicsV2SpendBuilderService,
  SINGLETON_LAUNCHER_HASH,
  SINGLETON_MOD_HASH,
} from './pool-economics-v2-spend-builder.service';
import { VAULT_CURRENT_INNER_PUZZLE_HEX } from './vault-current-inner.puzzle-hex';

export interface PoolV2ComposeDryRunArgs {
  state: PoolEconomicStateInput;
  collectionNavMojos: bigint;
  sharePpm: bigint;
  sellerTokenPrice: bigint;
}

export interface PoolV2ComposeDryRunResult {
  kind: PoolV2ActionPreviewKind;
  label: string;
  spendCase: number;
  actionTag: number;
  coinSpendCount: number;
  witnessCoinSpendCount: number;
  maxWitnessCoinSpends: number;
  unsignedBundleCoinSpendLimit: number;
  aggregatedSignature: null;
  requiredAnnouncements: PoolV2RequiredAnnouncement[];
  witnessSummary: PoolV2WitnessReplaySummary[];
}

const DRY_RUN_IDS = {
  poolLauncherId: b32('20'),
  deedLauncherId: b32('1f'),
  p2VaultPuzzleHash: b32('12'),
  collectionIdCanon: b32('13'),
  collectionNavRoot: b32('16'),
  treasuryReservePuzhash: b32('17'),
  protocolTreasuryPuzhash: b32('18'),
  governanceRewardsPuzhash: b32('19'),
  governanceRewardsRoot: b32('1a'),
  propertyIdCanon: b32('1c'),
  sellerPuzhash: b32('1d'),
  launcherPuzzleHash: b32('22'),
  ownerPubkey: hexRepeat('24', 48),
  authType: 1n,
  membersMerkleRoot: b32('25'),
  identityAttestRoot: b32('26'),
  bridgePolicyHash: b32('27'),
  vaultLineageParent: b32('28'),
};

@Injectable({ providedIn: 'root' })
export class PoolEconomicsV2ComposeDryRunService {
  private readonly wasm = inject(ChiaWasmService);
  private readonly economics = inject(PoolEconomicsV2Service);
  private readonly builder = inject(PoolEconomicsV2SpendBuilderService);

  specificDeedSwap(args: PoolV2ComposeDryRunArgs): PoolV2ComposeDryRunResult {
    const seeds = this.witnessSeeds();
    const navEvidence = this.navEvidence(args, seeds.nav);
    const buyerVault = this.buyerVaultSeed();
    const inner = this.builder.buildSpecificDeedSwapInnerSolution({
      ...this.innerContext(seeds.pool),
      state: args.state,
      deedId: seeds.deed.coinId,
      deedLauncherId: DRY_RUN_IDS.deedLauncherId,
      parValueMojos: args.collectionNavMojos,
      assetClass: 1n,
      propertyIdCanon: DRY_RUN_IDS.propertyIdCanon,
      buyerVaultLauncherId: buyerVault.launcherId,
      launcherPuzzleHash: DRY_RUN_IDS.launcherPuzzleHash,
      buyerVaultCoinId: buyerVault.coinId,
      buyerOwnerPubkey: DRY_RUN_IDS.ownerPubkey,
      buyerAuthType: DRY_RUN_IDS.authType,
      buyerMembersMerkleRoot: DRY_RUN_IDS.membersMerkleRoot,
      buyerIdentityAttestRoot: DRY_RUN_IDS.identityAttestRoot,
      buyerBridgePolicyHash: DRY_RUN_IDS.bridgePolicyHash,
      collectionIdCanon: DRY_RUN_IDS.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence,
      treasuryReservePuzhash: DRY_RUN_IDS.treasuryReservePuzhash,
      protocolTreasuryPuzhash: DRY_RUN_IDS.protocolTreasuryPuzhash,
      governanceRewardsPuzhash: DRY_RUN_IDS.governanceRewardsPuzhash,
      governanceRewardsRoot: DRY_RUN_IDS.governanceRewardsRoot,
    });
    const poolSpend = this.poolSpendFromInner(inner, seeds.pool);
    const tokenSettlementMessage = this.tokenSettlementMessage(poolSpend);
    const composed = this.builder.composePoolV2UnsignedBundle({
      poolSpend,
      deedId: seeds.deed.coinId,
      navEvidence,
      witnesses: {
        navEvidenceSpend: this.witnessSpend(seeds.nav, [
          condition(62, poolSpend.spec.requiredNavEvidenceMessage),
        ]),
        deedSpend: this.witnessSpend(seeds.deed, [
          condition(60, poolSpend.spec.deedMessage),
        ]),
        vaultAcceptOfferSpend: this.vaultAcceptOfferSpend(buyerVault, poolSpend),
        tokenSettlementPuzzleHash: seeds.tokenSettlement.puzzleHash,
        tokenSettlementSpend: this.witnessSpend(seeds.tokenSettlement, [
          condition(62, tokenSettlementMessage),
        ]),
      },
    });
    return this.result({
      kind: 'specific-deed-swap',
      label: 'Specific deed swap',
      spendCase: POOL_SPEND_V2_SPECIFIC_DEED_SWAP,
      poolSpend,
      composed,
    });
  }

  trueRedemption(args: PoolV2ComposeDryRunArgs): PoolV2ComposeDryRunResult {
    const seeds = this.witnessSeeds();
    const navEvidence = this.navEvidence(args, seeds.nav);
    const vaultLauncherId = this.syntheticVaultLauncherId();
    const inner = this.builder.buildTrueRedemptionInnerSolution({
      ...this.innerContext(seeds.pool),
      state: args.state,
      deedId: seeds.deed.coinId,
      deedLauncherId: DRY_RUN_IDS.deedLauncherId,
      parValueMojos: args.collectionNavMojos,
      assetClass: 1n,
      propertyIdCanon: DRY_RUN_IDS.propertyIdCanon,
      vaultLauncherId,
      launcherPuzzleHash: DRY_RUN_IDS.launcherPuzzleHash,
      collectionIdCanon: DRY_RUN_IDS.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence,
      tokenCoinId: seeds.tokenAuthorization.coinId,
    });
    const poolSpend = this.poolSpendFromInner(inner, seeds.pool);
    const auth = poolSpend.spec.tokenAuthorizations[0];
    const composed = this.builder.composePoolV2UnsignedBundle({
      poolSpend,
      deedId: seeds.deed.coinId,
      navEvidence,
      witnesses: {
        navEvidenceSpend: this.witnessSpend(seeds.nav, [
          condition(62, poolSpend.spec.requiredNavEvidenceMessage),
        ]),
        deedSpend: this.witnessSpend(seeds.deed, [
          condition(60, poolSpend.spec.deedMessage),
        ]),
        tokenAuthorizationSpends: auth
          ? [
              this.witnessSpend(seeds.tokenAuthorization, [
                condition(63, announcementId(poolSpend.poolFullPuzzleHash, auth.announcementMessage)),
              ]),
            ]
          : [],
      },
    });
    return this.result({
      kind: 'true-redemption',
      label: 'True redemption',
      spendCase: POOL_SPEND_V2_TRUE_REDEMPTION,
      poolSpend,
      composed,
    });
  }

  reserveAcquisition(args: PoolV2ComposeDryRunArgs): PoolV2ComposeDryRunResult {
    const seeds = this.witnessSeeds();
    const navEvidence = this.navEvidence(args, seeds.nav);
    const inner = this.builder.buildReserveAcquisitionInnerSolution({
      ...this.innerContext(seeds.pool),
      state: args.state,
      deedId: seeds.deed.coinId,
      deedLauncherId: DRY_RUN_IDS.deedLauncherId,
      propertyIdCanon: DRY_RUN_IDS.propertyIdCanon,
      parValueMojos: args.collectionNavMojos,
      assetClass: 1n,
      collectionIdCanon: DRY_RUN_IDS.collectionIdCanon,
      sharePpm: args.sharePpm,
      navEvidence,
      sellerPuzhash: DRY_RUN_IDS.sellerPuzhash,
      sellerTokenPrice: args.sellerTokenPrice,
      mintTokenCoinId: seeds.tokenAuthorization.coinId,
    });
    const poolSpend = this.poolSpendFromInner(inner, seeds.pool);
    const tokenSettlementMessage =
      poolSpend.spec.tokenOutputs.length > 0 ? this.tokenSettlementMessage(poolSpend) : null;
    const auth = poolSpend.spec.tokenAuthorizations[0];
    const composed = this.builder.composePoolV2UnsignedBundle({
      poolSpend,
      deedId: seeds.deed.coinId,
      navEvidence,
      witnesses: {
        navEvidenceSpend: this.witnessSpend(seeds.nav, [
          condition(62, poolSpend.spec.requiredNavEvidenceMessage),
        ]),
        deedSpend: this.witnessSpend(seeds.deed, [
          condition(60, poolSpend.spec.deedMessage),
        ]),
        tokenSettlementPuzzleHash: tokenSettlementMessage ? seeds.tokenSettlement.puzzleHash : null,
        tokenSettlementSpend: tokenSettlementMessage
          ? this.witnessSpend(seeds.tokenSettlement, [
              condition(62, tokenSettlementMessage),
            ])
          : null,
        tokenAuthorizationSpends: auth
          ? [
              this.witnessSpend(seeds.tokenAuthorization, [
                condition(63, announcementId(poolSpend.poolFullPuzzleHash, auth.announcementMessage)),
              ]),
            ]
          : [],
      },
    });
    return this.result({
      kind: 'reserve-acquisition',
      label: 'Reserve acquisition',
      spendCase: POOL_SPEND_V2_RESERVE_ACQUISITION,
      poolSpend,
      composed,
    });
  }

  private result<
    Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
  >(args: {
    kind: PoolV2ActionPreviewKind;
    label: string;
    spendCase: number;
    poolSpend: PoolV2CoinSpendBuild<Quote>;
    composed: {
      requiredAnnouncements: PoolV2RequiredAnnouncement[];
      witnessSummary: PoolV2WitnessReplaySummary[];
      coinSpends: ReadonlyArray<UnsignedCoinSpend>;
      unsignedSpendBundle: { aggregatedSignature: null };
    };
  }): PoolV2ComposeDryRunResult {
    return {
      kind: args.kind,
      label: args.label,
      spendCase: args.spendCase,
      actionTag: args.poolSpend.actionTag,
      coinSpendCount: args.composed.coinSpends.length,
      witnessCoinSpendCount: args.composed.witnessSummary.length,
      maxWitnessCoinSpends: POOL_V2_MAX_WITNESS_COIN_SPENDS,
      unsignedBundleCoinSpendLimit: POOL_V2_MAX_UNSIGNED_BUNDLE_COIN_SPENDS,
      aggregatedSignature: args.composed.unsignedSpendBundle.aggregatedSignature,
      requiredAnnouncements: args.composed.requiredAnnouncements,
      witnessSummary: args.composed.witnessSummary,
    };
  }

  private poolSpendFromInner<
    Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
  >(
    inner: {
      spendCase: number;
      actionTag: number;
      innerSolutionHex: string;
      spec: PoolV2CoinSpendBuild<Quote>['spec'];
      p2VaultPuzzleHash?: string;
    },
    seed: WitnessSeed,
  ): PoolV2CoinSpendBuild<Quote> {
    const poolConditions = [
      condition(62, inner.spec.poolActionMessage),
      ...inner.spec.tokenAuthorizations.map((auth) => condition(62, auth.announcementMessage)),
    ];
    const coinSpend = this.witnessSpend(seed, poolConditions);
    return {
      ...inner,
      poolCoinId: seed.coinId,
      poolInnerPuzzleHash: b32('31'),
      poolFullPuzzleHash: seed.puzzleHash,
      poolPuzzleReveal: coinSpend.puzzleReveal,
      poolFullSolutionHex: coinSpend.solution,
      coinSpend,
      unsignedSpendBundle: {
        coinSpends: [coinSpend],
        aggregatedSignature: null,
      },
    };
  }

  private tokenSettlementMessage<
    Quote extends SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote,
  >(poolSpend: PoolV2CoinSpendBuild<Quote>): string {
    return this.economics.tokenSettlementPaymentMessage(
      poolSpend.poolCoinId,
      poolSpend.spec.tokenOutputs,
    );
  }

  private innerContext(seed: WitnessSeed): {
    poolCoinId: string;
    poolInnerPuzzleHash: string;
    poolAmount: bigint;
    poolLauncherId: string;
  } {
    return {
      poolCoinId: seed.coinId,
      poolInnerPuzzleHash: b32('31'),
      poolAmount: seed.amount,
      poolLauncherId: DRY_RUN_IDS.poolLauncherId,
    };
  }

  private buyerVaultSeed(): VaultWitnessSeed {
    const sdk = this.sdk();
    const clvm = new sdk.Clvm();
    const launcherId = this.syntheticVaultLauncherId();
    const singletonStruct = this.singletonStruct(clvm, launcherId, DRY_RUN_IDS.launcherPuzzleHash);
    const vaultMod = clvm.deserialize(hexToBytes(VAULT_CURRENT_INNER_PUZZLE_HEX));
    const vaultInner = vaultMod.curry([
      singletonStruct,
      clvm.atom(hexToBytes(DRY_RUN_IDS.ownerPubkey)),
      clvm.int(DRY_RUN_IDS.authType),
      clvm.atom(hexToBytes(DRY_RUN_IDS.membersMerkleRoot)),
      clvm.atom(hexToBytes(DRY_RUN_IDS.identityAttestRoot)),
      clvm.atom(hexToBytes(DRY_RUN_IDS.bridgePolicyHash)),
      clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
      clvm.atom(hexToBytes(DRY_RUN_IDS.poolLauncherId)),
      clvm.atom(hexToBytes(SINGLETON_LAUNCHER_HASH)),
    ]);
    const vaultFullPuzzle = this.singletonFullPuzzle(clvm, singletonStruct, vaultInner);
    const puzzleHash = bytesToHex(vaultFullPuzzle.treeHash());
    const amount = 1n;
    const coin = new sdk.Coin(hexToBytes(launcherId), hexToBytes(puzzleHash), amount);
    return {
      launcherId,
      parentCoinInfo: launcherId,
      puzzleHash,
      amount,
      coinId: bytesToHex(coin.coinId()),
      innerPuzzleHash: bytesToHex(vaultInner.treeHash()),
      puzzleReveal: bytesToHex(vaultFullPuzzle.serialize()),
    };
  }

  private syntheticVaultLauncherId(): string {
    const sdk = this.sdk();
    const launcherCoin = new sdk.Coin(
      hexToBytes(DRY_RUN_IDS.vaultLineageParent),
      hexToBytes(DRY_RUN_IDS.launcherPuzzleHash),
      1n,
    );
    return bytesToHex(launcherCoin.coinId());
  }

  private vaultAcceptOfferSpend<Quote extends SpecificDeedSwapQuote>(
    vault: VaultWitnessSeed,
    poolSpend: PoolV2CoinSpendBuild<Quote>,
  ): UnsignedCoinSpend {
    const clvm = new (this.sdk().Clvm)();
    const proof = clvm.pair(clvm.int(0n), clvm.list([]));
    const innerSolution = clvm.list([
      clvm.atom(hexToBytes(vault.coinId)),
      clvm.atom(hexToBytes(vault.innerPuzzleHash)),
      clvm.int(vault.amount),
      clvm.int(0x61n),
      clvm.list([
        clvm.atom(hexToBytes(DRY_RUN_IDS.deedLauncherId)),
        clvm.int(BigInt(poolSpend.spec.quote.principalTokens)),
        clvm.atom(hexToBytes(poolSpend.poolInnerPuzzleHash)),
        clvm.atom(hexToBytes(DRY_RUN_IDS.identityAttestRoot)),
        proof,
        clvm.int(1_735_689_600n),
        clvm.atom(new Uint8Array(0)),
      ]),
    ]);
    const lineageProof = clvm.list([
      clvm.atom(hexToBytes(DRY_RUN_IDS.vaultLineageParent)),
      clvm.int(vault.amount),
    ]);
    const fullSolution = clvm.list([
      lineageProof,
      clvm.int(vault.amount),
      innerSolution,
    ]);
    return {
      coin: {
        parentCoinInfo: vault.parentCoinInfo,
        puzzleHash: vault.puzzleHash,
        amount: vault.amount,
      },
      puzzleReveal: vault.puzzleReveal,
      solution: bytesToHex(fullSolution.serialize()),
    };
  }

  private singletonStruct(clvm: ClvmFactoryShape, launcherId: string, launcherPuzzleHash: string): ProgramShape {
    return clvm.pair(
      clvm.atom(hexToBytes(SINGLETON_MOD_HASH)),
      clvm.pair(clvm.atom(hexToBytes(launcherId)), clvm.atom(hexToBytes(launcherPuzzleHash))),
    );
  }

  private singletonFullPuzzle(
    clvm: ClvmFactoryShape,
    singletonStruct: ProgramShape,
    innerPuzzle: ProgramShape,
  ): ProgramShape {
    const constants = this.sdk().Constants;
    const topLayer = constants?.singletonTopLayerV11?.() ?? constants?.singletonTopLayer?.();
    if (!topLayer) {
      throw new Error('pool-v2-dry-run: singleton top-layer bytecode unavailable in WASM SDK');
    }
    return clvm.deserialize(topLayer).curry([singletonStruct, innerPuzzle]);
  }

  private navEvidence(args: PoolV2ComposeDryRunArgs, nav: WitnessSeed): CollectionNavEvidenceInput {
    return {
      registryCoinId: nav.coinId,
      registryPuzzleHash: nav.puzzleHash,
      collectionIdCanon: DRY_RUN_IDS.collectionIdCanon,
      navValueMojos: args.collectionNavMojos,
      collectionNavRoot: DRY_RUN_IDS.collectionNavRoot,
      registryVersion: 1n,
    };
  }

  private witnessSeeds(): {
    pool: WitnessSeed;
    nav: WitnessSeed;
    deed: WitnessSeed;
    tokenSettlement: WitnessSeed;
    tokenAuthorization: WitnessSeed;
  } {
    return {
      pool: this.witnessSeed(0x91),
      nav: this.witnessSeed(0xa1),
      deed: this.witnessSeed(0xd1),
      tokenSettlement: this.witnessSeed(0xf1),
      tokenAuthorization: this.witnessSeed(0xe1),
    };
  }

  private witnessSeed(byte: number): WitnessSeed {
    const sdk = this.sdk();
    const clvm = new sdk.Clvm();
    const puzzle = clvm.int(1n);
    const parent = new Uint8Array(32).fill(byte);
    const puzzleHash = puzzle.treeHash();
    const amount = 1n;
    const coin = new sdk.Coin(parent, puzzleHash, amount);
    return {
      parentCoinInfo: bytesToHex(parent),
      puzzleHash: bytesToHex(puzzleHash),
      amount,
      coinId: bytesToHex(coin.coinId()),
    };
  }

  private witnessSpend(seed: WitnessSeed, conditions: WitnessCondition[]): UnsignedCoinSpend {
    const clvm = new (this.sdk().Clvm)();
    const puzzle = clvm.int(1n);
    return {
      coin: {
        parentCoinInfo: seed.parentCoinInfo,
        puzzleHash: seed.puzzleHash,
        amount: seed.amount,
      },
      puzzleReveal: bytesToHex(puzzle.serialize()),
      solution: bytesToHex(
        clvm
          .list(
            conditions.map((c) =>
              clvm.list([
                clvm.int(BigInt(c.opcode)),
                clvm.atom(hexToBytes(c.message)),
              ]),
            ),
          )
          .serialize(),
      ),
    };
  }

  private sdk(): SdkShape {
    const sdk = this.wasm.sdk() as SdkShape | undefined;
    if (!sdk?.Clvm || !sdk?.Coin) {
      throw new Error('pool-v2-dry-run: chia-wallet-sdk-wasm Clvm/Coin exports unavailable');
    }
    return sdk;
  }
}

interface WitnessSeed {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: bigint;
  coinId: string;
}

interface VaultWitnessSeed extends WitnessSeed {
  launcherId: string;
  innerPuzzleHash: string;
  puzzleReveal: string;
}

interface WitnessCondition {
  opcode: number;
  message: string;
}

interface ProgramShape {
  treeHash(): Uint8Array;
  serialize(): Uint8Array;
  curry(args: ProgramShape[]): ProgramShape;
}

interface ClvmFactoryShape {
  deserialize(bytes: Uint8Array): ProgramShape;
  int(value: bigint): ProgramShape;
  atom(value: Uint8Array): ProgramShape;
  list(values: ProgramShape[]): ProgramShape;
  pair(first: ProgramShape, rest: ProgramShape): ProgramShape;
}

interface SdkShape {
  Clvm: new () => ClvmFactoryShape;
  Coin: new (
    parentCoinInfo: Uint8Array,
    puzzleHash: Uint8Array,
    amount: bigint,
  ) => { coinId(): Uint8Array };
  Constants?: {
    singletonTopLayer?: () => Uint8Array;
    singletonTopLayerV11?: () => Uint8Array;
  };
}

function condition(opcode: number, message: string): WitnessCondition {
  return { opcode, message };
}

function announcementId(sourceId: string, message: string): string {
  return sha256(concatBytes([hexToBytes(sourceId), hexToBytes(message)]));
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function b32(byte: string): string {
  return hexRepeat(byte, 32);
}

function hexRepeat(byte: string, count: number): string {
  return `0x${byte.repeat(count)}`;
}
