import { Injectable, inject } from '@angular/core';

import { ChiaWalletService, SignedSpendBundle, UnsignedCoinSpend } from '../chia-wallet.service';
import { ChiaWasmService } from '../chia-wasm.service';
import {
  CommitteeApiService,
  CommitteeVoteApiResponse,
  PublishProposalMetadataJson,
} from '../committee-api.service';
import { CoinsetService } from '../coinset.service';
import { SgtCoin } from '../sgt-driver/sgt-coin-discovery.service';
import { MintPublicationApiService, MintPublicationContext, MintStakePackage, MintStakeRequest } from '../mint-publication-api.service';
import { SessionService } from '../session.service';
import { VaultOwnerSessionService } from '../vault-owner-session.service';
import { EvmWalletService } from '../evm-wallet.service';
import { SgtDriverService } from '../sgt-driver/sgt-driver.service';
import { WalletCoinPickerService } from '../wallet-coin-picker.service';
import { bytesToHex, coinId, hexToBytes } from '../../utils/chia-hash';
import { environment } from '../../../environments/environment';

import { MintProposalV2Service } from './mint-proposal-v2.service';
import { MintPublishArtifacts, MintPublishService } from './mint-publish.service';
import { MintPublishSpendBuilderService } from './mint-publish-spend-builder.service';
import {
  PropertyMetadataService,
  buildMetadataReferenceMemo,
} from '../property-metadata/property-metadata.service';

/**
 * Prepare a vault-funded MINT proposal against current chain evidence.
 * The wallet package contains funding, proposal launcher, tracker, vault and
 * SGT spends. Admin Approvals then collects owner-plus-one HTTP and identity
 * signatures; the API appends the four current authority/statutes spends.
 * Property registration and deed issuance occur only after the SGT vote.
 */
@Injectable({ providedIn: 'root' })
export class MintProposalV2PublishRunnerService {
  private readonly wallet = inject(ChiaWalletService);
  private readonly wasm = inject(ChiaWasmService);
  private readonly coinset = inject(CoinsetService);
  private readonly mintApi = inject(MintPublicationApiService);
  private readonly session = inject(SessionService);
  private readonly ownerSession = inject(VaultOwnerSessionService);
  private readonly evm = inject(EvmWalletService);
  private readonly sgt = inject(SgtDriverService);
  private readonly publish = inject(MintPublishService);
  private readonly v2 = inject(MintProposalV2Service);
  private readonly spendBuilder = inject(MintPublishSpendBuilderService);
  private readonly coinPicker = inject(WalletCoinPickerService);
  private readonly api = inject(CommitteeApiService);
  private readonly propertyMetadata = inject(PropertyMetadataService);

  /**
   * Build, sign, and POST the publish bundle for a single MINT
   * proposal.
   *
   * @returns {@link PublishRunResult}.  ``'submitted'`` when the bundle
   *   was pushed (the API may still report ``pushed: false`` for a
   *   mempool rejection — the UI renders ``apiResponse.status`` either
   *   way). Failure variants identify the stage that could not complete.
   */
  async publishMint(args: PublishMintArgs): Promise<PublishRunResult> {
    // ── 0. Validate inputs ──
    let firstVoteAmount = BigInt(args.firstVoteAmount);
    if (firstVoteAmount <= 0n) {
      return { kind: 'invalid-input', reason: 'first-vote-amount-must-be-positive' };
    }
    const votingWindowSeconds = BigInt(args.votingWindowSeconds);
    if (votingWindowSeconds <= 0n) {
      return { kind: 'invalid-input', reason: 'voting-window-must-be-positive' };
    }
    if (!args.propertyRegistryCoinSpend) {
      return { kind: 'property-registry-spend-required' };
    }

    // ── 1. Wallet derivation ──
    const pubkeyHex = this.wallet.pubkey();
    if (!pubkeyHex) {
      return { kind: 'wallet-not-connected' };
    }
    const sdk = this.sdk();
    const syntheticKey = sdk.PublicKey.fromBytes(hexToBytes(pubkeyHex));
    const voterInnerPuzzleHashBytes = sdk.standardPuzzleHash(syntheticKey);
    const fundingPuzzleHash = bytesToHex(voterInnerPuzzleHashBytes);

    // Current protocol inputs are reconstructed by the API, including genesis IDLE.
    const owner = this.session.session();
    if (!owner?.vaultLauncherId || this.wallet.connectionKind() === 'google') {
      return { kind: 'vault-required', error: 'Connect an enrolled external-wallet vault to stake SGT for minting.' };
    }
    const fundingKey = pubkeyHex;
    const ownerAddress = owner.authType === 'evm' ? this.evm.address() : null;
    const assertWallets = () => {
      const latest = this.session.session();
      if (latest?.vaultLauncherId !== owner.vaultLauncherId || latest?.authType !== owner.authType ||
          this.wallet.pubkey() !== fundingKey || this.wallet.connectionKind() === 'google' ||
          (owner.authType === 'evm' && this.evm.address() !== ownerAddress)) {
        throw new Error('The funding or stake wallet changed. Prepare the mint again.');
      }
    };
    let trackerInputs: MintPublicationContext;
    try {
      await this.ownerSession.ensure(owner.vaultLauncherId);
      assertWallets();
      trackerInputs = await this.mintApi.context();
      assertWallets();
      if (args.useCurrentMinimumStake) {
        if (trackerInputs.parameters.length !== 9 || BigInt(trackerInputs.parameters[2]) <= 0n) {
          throw new Error('Current minimum proposal stake is unavailable. Refresh the protocol context.');
        }
        firstVoteAmount = BigInt(trackerInputs.parameters[2]);
      }
    } catch (err) {
      return { kind: 'tracker-read-failed', error: err instanceof Error ? err.message : String(err) };
    }
    const sgtGenesisCoinId = environment.solslotProtocol.sgtGenesisCoinId;
    if (!sgtGenesisCoinId) return { kind: 'sgt-not-deployed' };

    // ── 4. Pick a single XCH funding coin (parent for both launchers) ──
    let xchPick: { coinId: string; amount: bigint };
    try {
      xchPick = await this.coinPicker.pickLargestUnspentCoinForPuzzleHash({
        puzzleHash: fundingPuzzleHash,
      });
    } catch (err) {
      return {
        kind: 'no-xch-coin',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    const record = await this.coinset.getCoinRecordByName(xchPick.coinId);
    if (!record) {
      return { kind: 'xch-coin-vanished', coinId: xchPick.coinId };
    }
    const xchCoin = {
      parentCoinInfo: this.normalizeHex(record.coin.parent_coin_info),
      puzzleHash: this.normalizeHex(record.coin.puzzle_hash),
      amount: BigInt(record.coin.amount),
    };
    const sourceCoin = new sdk.Coin(
      hexToBytes(xchCoin.parentCoinInfo),
      hexToBytes(xchCoin.puzzleHash),
      xchCoin.amount,
    );
    const xchCoinId = bytesToHex(sourceCoin.coinId());

    // ── 5. Build the pinned artifacts (same parent for both launchers) ──
    let artifacts: MintPublishArtifacts;
    try {
      if (args.primaryPurchaseUsdAmountMinor !== undefined && args.inventoryPuzzleVersion !== 2) {
        throw new Error('New purchase publication requires governed inventory V2. Refresh the governed preview.');
      }
      artifacts = this.publish.buildMintPublishArtifacts({
        propertyIdCanon: args.propertyIdCanon,
        collectionIdCanon: args.collectionIdCanon,
        sharePpm: args.sharePpm,
        parValueMojos: args.parValueMojos,
        assetClass: args.assetClass,
        jurisdictionHex: args.jurisdictionHex,
        royaltyPuzhash: args.royaltyPuzhash,
        royaltyBps: args.royaltyBps,
        quorumThreshold: args.quorumThreshold,
        ownerMemberHash: args.ownerMemberHash,
        govMemberHash: args.govMemberHash,
        deedLauncherParentCoinName: xchCoinId,
        proposalLauncherParentCoinName: xchCoinId,
        protocolDidSingletonStructHex: args.protocolDidSingletonStructHex,
        protocolDidPuzhash: args.protocolDidPuzhash,
        protocolDidInnerPuzhash: args.protocolDidInnerPuzhash,
        governanceSingletonStructHex: args.governanceSingletonStructHex,
        poolSingletonLauncherId: args.poolSingletonLauncherId,
        poolSingletonLauncherPuzzleHash: args.poolSingletonLauncherPuzzleHash,
        p2PoolModHash: args.p2PoolModHash,
        p2VaultModHash: args.p2VaultModHash,
        propertyRegistryPuzzleHash: args.propertyRegistryPuzzleHash,
        metadataRoot: args.metadataRoot,
        metadataAnchorId: args.metadataAnchorId,
        primaryPurchaseUsdAmountMinor: args.primaryPurchaseUsdAmountMinor,
        inventoryPuzzleVersion: args.inventoryPuzzleVersion,
        primaryPurchaseValidatorPubkeys: args.primaryPurchaseValidatorPubkeys,
        primaryPurchaseNetwork: args.primaryPurchaseNetwork,
        primaryPurchaseProtocolTreasuryPuzhash:
          args.primaryPurchaseProtocolTreasuryPuzhash,
      });
    } catch (err) {
      return {
        kind: 'artifact-build-failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    let deedLauncherMemos: Uint8Array[] | undefined;
    try {
      if (args.metadataRoot) {
        if (args.metadataAnchorId) {
          deedLauncherMemos = [
            buildMetadataReferenceMemo({
              metadataRoot: args.metadataRoot,
              metadataAnchorId: args.metadataAnchorId,
            }),
          ];
        } else {
          if (!args.canonicalMetadataJson) {
            return {
              kind: 'metadata-invalid',
              error: 'The first collection proposal requires canonical metadata bytes.',
            };
          }
          const commitment = this.propertyMetadata.commit(
            JSON.parse(args.canonicalMetadataJson) as unknown,
          );
          if (commitment.canonicalJson !== args.canonicalMetadataJson) {
            return {
              kind: 'metadata-invalid',
              error: 'The supplied dossier is not RFC 8785 canonical JSON.',
            };
          }
          if (commitment.metadataRoot.toLowerCase() !== args.metadataRoot.toLowerCase()) {
            return {
              kind: 'metadata-invalid',
              error: 'The canonical dossier does not match the sealed metadata root.',
            };
          }
          deedLauncherMemos = this.propertyMetadata.buildMemos(commitment);
        }
      }
    } catch (err) {
      return {
        kind: 'metadata-invalid',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // ── 6. Build the Artifact A launcher → eve hop ──
    const eveInnerPuzzleHex = this.v2.makeInnerPuzzleHex({
      ownerMemberHash: args.ownerMemberHash,
      govMemberHash: args.govMemberHash,
      proposalDataHash: artifacts.proposalDataHash,
      governanceSingletonStructHex: args.governanceSingletonStructHex,
      governanceProposalHash: artifacts.proposalHash,
      deedLauncherId: artifacts.deedLauncherId,
      didInnerPuzzleHash: args.protocolDidInnerPuzhash,
      deedFullPuzzleHash: artifacts.deedFullPuzhash,
      proposalState: MintProposalV2Service.STATE_DRAFT,
      stateVersion: 0,
    });

    // The stake remains owned by the enrolled administrator vault.
    const votingDeadline = BigInt(trackerInputs.votingDeadline);
    const stakeRequest: MintStakeRequest = {
      contextHash: trackerInputs.contextHash, proposalHash: artifacts.proposalHash,
      vaultLauncherId: owner.vaultLauncherId, stakeAmount: firstVoteAmount.toString(),
      votingDeadline: trackerInputs.votingDeadline,
    };
    let stake: MintStakePackage;
    const validateStake = (value: MintStakePackage) => {
      assertWallets();
      if (value.contextHash !== stakeRequest.contextHash || value.proposalHash !== stakeRequest.proposalHash ||
          value.vaultLauncherId !== stakeRequest.vaultLauncherId || value.vaultAuthType !== owner.authType ||
          BigInt(value.stakeAmount) !== firstVoteAmount || value.votingDeadline !== stakeRequest.votingDeadline ||
          value.signingCoinSpends.length !== 2) {
        throw new Error('The mint stake package differs from the selected vault, proposal or deadline.');
      }
    };
    try {
      stake = await this.mintApi.stake(stakeRequest);
      validateStake(stake);
      if (stake.vaultAuthType === 'evm') {
        if (!stake.vaultTypedData) throw new Error('Mint stake owner authorization is missing.');
        const operationHash = stake.operationHash;
        const vaultCoinId = stake.vaultCoinId;
        const authorization = await this.evm.signTypedData(stake.vaultTypedData);
        assertWallets();
        stake = await this.mintApi.stake({ ...stakeRequest, operationHash, vaultOwnerAuthorization: authorization });
        validateStake(stake);
        if (!stake.evmOwnerAuthorized || stake.operationHash !== operationHash || stake.vaultCoinId !== vaultCoinId) {
          throw new Error('Mint stake changed while the vault owner was signing.');
        }
      }
    } catch (err) {
      return { kind: 'spend-builder-failed', error: err instanceof Error ? err.message : String(err) };
    }
    const voterInnerPuzzleHash = stake.voterInnerPuzzleHash;
    const sgtPick: SgtCoin = { ...stake.sgtCoin, amount: Number(stake.sgtCoin.amount), confirmedBlockIndex: 0 };
    if (!Number.isSafeInteger(sgtPick.amount) || BigInt(sgtPick.amount) !== firstVoteAmount) {
      return { kind: 'spend-builder-failed', error: 'SGT stake amount is not represented exactly.' };
    }
    const sgtTailHash = bytesToHex(this.sgt.sgtTailHash(sgtGenesisCoinId));
    const lockedCatPuzzleHash = bytesToHex(this.sgt.catSgtFreePuzzleHash({
      sgtFreeInnerHash: hexToBytes(stake.lockedInnerPuzzleHash), sgtTailHash,
    }));
    const sgtLockCoinId = coinId(stake.sgtCoinId, lockedCatPuzzleHash, firstVoteAmount);

    // Build the launcher and tracker spends alongside the prepared vault stake.
    let eveLaunch: ReturnType<MintPublishSpendBuilderService['buildProposalEveLaunchSpend']>;
    let trackerProposeSpend: UnsignedCoinSpend;
    try {
      eveLaunch = this.spendBuilder.buildProposalEveLaunchSpend({
        xchParentCoin: xchCoin,
        eveInnerPuzzleHex,
      });
      trackerProposeSpend = this.spendBuilder.buildTrackerProposeCoinSpend({
        trackerCoin: { ...trackerInputs.trackerCoin, amount: BigInt(trackerInputs.trackerCoin.amount) },
        trackerInnerPuzzleHex: trackerInputs.trackerInnerPuzzleHex,
        trackerLauncherId: trackerInputs.trackerLauncherId,
        lineageProof: { ...trackerInputs.lineageProof, amount: BigInt(trackerInputs.lineageProof.amount) },
        proposalEvidenceHex: trackerInputs.proposalEvidenceHex,
        proposalHash: artifacts.proposalHash,
        billOperationHex: artifacts.billOpProgramHex,
        voterInnerPuzzleHash,
        firstVoteAmount,
        votingDeadline,
      });

    } catch (err) {
      return {
        kind: 'spend-builder-failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // ── 9. Build the XCH parent standard-coin spend ──
    let xchParentSpend: UnsignedCoinSpend;
    try {
      xchParentSpend = this.buildXchParentSpend({
        sourceCoin,
        coinAmount: xchCoin.amount,
        syntheticKey,
        changePuzzleHash: voterInnerPuzzleHashBytes,
        deedLauncherPuzhash: this.publish.deedLauncherPuzzleHash(
          args.protocolDidSingletonStructHex,
        ),
        parentConditionsHex: eveLaunch.parentConditionsHex,
        deedLauncherMemos,
      });
    } catch (err) {
      return {
        kind: 'xch-parent-build-failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Sign funding and, for a BLS vault, the vault owner authorization.
    const unsigned: UnsignedCoinSpend[] = [
      xchParentSpend,
      eveLaunch.launcherCoinSpend,
      trackerProposeSpend,
      ...stake.signingCoinSpends,
    ];
    let signedBundle: SignedSpendBundle;
    try {
      assertWallets();
      signedBundle = await this.wallet.signSpendBundle(unsigned);
      assertWallets();
    } catch (err) {
      return {
        kind: 'sign-failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // ── 11. Publish via solslot_api → coinset.org ──
    // Attach the re-derivation guard metadata (Brick 4e.2d) so the API
    // re-runs build_mint_publish_artifacts server-side and rejects the
    // bundle if its on-chain commitments drift from the canonical
    // computation.  The exact same operator inputs that fed
    // buildMintPublishArtifacts in step 5 are echoed here — the API
    // pairs them with the launcher parent it extracts from the bundle.
    const propertyRegistryCoinId = coinId(
      args.propertyRegistryCoinSpend.coin.parentCoinInfo,
      args.propertyRegistryCoinSpend.coin.puzzleHash,
      args.propertyRegistryCoinSpend.coin.amount,
    );
    const proposalMetadata: PublishProposalMetadataJson = {
      property_id: args.propertyId,
      collection_id: args.collectionId,
      asset_class_name: args.assetClassName,
      property_id_canon: this.normalizeHex(args.propertyIdCanon),
      collection_id_canon: this.normalizeHex(args.collectionIdCanon),
      share_ppm: Number(args.sharePpm),
      property_registry_coin_id: propertyRegistryCoinId,
      property_registry_puzzle_hash: this.normalizeHex(args.propertyRegistryPuzzleHash),
      par_value_mojos: Number(args.parValueMojos),
      asset_class: Number(args.assetClass),
      jurisdiction: this.normalizeHex(args.jurisdictionHex),
      royalty_puzhash: this.normalizeHex(args.royaltyPuzhash),
      royalty_bps: Number(args.royaltyBps),
      quorum_threshold: Number(args.quorumThreshold),
      owner_member_hash: this.normalizeHex(args.ownerMemberHash),
      gov_member_hash: this.normalizeHex(args.govMemberHash),
      voting_deadline: Number(votingDeadline),
      ...(artifacts.metadataRoot && artifacts.metadataAnchorId
        ? {
            metadata_root: artifacts.metadataRoot,
            metadata_anchor_id: artifacts.metadataAnchorId,
            ...(args.primaryPurchaseUsdAmountMinor !== undefined
              ? {
                  primary_purchase_usd_amount_minor: Number(
                    args.primaryPurchaseUsdAmountMinor,
                  ),
                }
              : {}),
          }
        : {}),
      inventory_puzzle_version: args.inventoryPuzzleVersion ?? 1,
    };
    let apiResponse: CommitteeVoteApiResponse;
    try {
      assertWallets();
      apiResponse = await this.api.publishProposal(
        {
          coin_spends: signedBundle.coinSpends.map((cs) => ({
            coin: {
              parent_coin_info: this.normalizeHex(cs.coin.parentCoinInfo),
              puzzle_hash: this.normalizeHex(cs.coin.puzzleHash),
              amount: Number(cs.coin.amount),
            },
            puzzle_reveal: this.normalizeHex(cs.puzzleReveal),
            solution: this.normalizeHex(cs.solution),
          })),
          aggregated_signature: this.normalizeHex(signedBundle.aggregatedSignature),
        },
        args.proposalId,
        proposalMetadata,
        { stakeVaultLauncherId: owner.vaultLauncherId, publicationContextHash: trackerInputs.contextHash },
      );
    } catch (err) {
      return {
        kind: 'publish-failed',
        error: err instanceof Error ? err.message : String(err),
        signedBundle,
      };
    }

    return {
      kind: 'submitted',
      apiResponse,
      signedBundle,
      artifacts,
      xchCoinId,
      pickedSgtCoin: sgtPick,
      sgtLockCoinId,
      votingDeadline,
      voterInnerPuzzleHash,
      propertyRegistryCoinId,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * Spend the wallet's XCH coin as a standard p2 coin, emitting the
   * deed-launcher CREATE_COIN, the two Artifact A launcher parent
   * conditions, the property-registry assertion condition, and a change
   * CREATE_COIN.
   */
  private buildXchParentSpend(args: {
    sourceCoin: {
      coinId(): Uint8Array;
      parentCoinInfo: Uint8Array;
      puzzleHash: Uint8Array;
      amount: bigint;
    };
    coinAmount: bigint;
    syntheticKey: unknown;
    changePuzzleHash: Uint8Array;
    deedLauncherPuzhash: Uint8Array;
    parentConditionsHex: string[];
    deedLauncherMemos?: Uint8Array[];
  }): UnsignedCoinSpend {
    const clvm = this.clvm();
    const sendAmount = MintPublishSpendBuilderService.SINGLETON_AMOUNT * 2n; // deed + Artifact A launchers
    if (args.coinAmount < sendAmount) {
      throw new Error(
        `XCH funding coin holds ${args.coinAmount} mojos, but the publish ` +
          `bundle needs ${sendAmount} (two 1-mojo launchers). Top up the wallet.`,
      );
    }
    const changeAmount = args.coinAmount - sendAmount;

    const memoProgram = args.deedLauncherMemos?.length
      ? clvm.list(args.deedLauncherMemos.map((memo) => clvm.atom(memo)))
      : undefined;
    const conditions = [
      // Deed launcher pre-spawn.
      clvm.createCoin(
        args.deedLauncherPuzhash,
        MintPublishSpendBuilderService.SINGLETON_AMOUNT,
        memoProgram,
      ),
      // Artifact A launcher parent conditions (CREATE_COIN + ASSERT_COIN_ANNOUNCEMENT).
      ...args.parentConditionsHex.map((hex) => clvm.deserialize(hexToBytes(hex))),
    ];
    if (changeAmount > 0n) {
      conditions.push(clvm.createCoin(args.changePuzzleHash, changeAmount, undefined));
    }
    const innerSpend = clvm.delegatedSpend(conditions);
    clvm.spendStandardCoin(args.sourceCoin, args.syntheticKey, innerSpend);

    const coinSpends = clvm.coinSpends();
    if (coinSpends.length !== 1) {
      throw new Error(`buildXchParentSpend: expected 1 coin spend, got ${coinSpends.length}`);
    }
    const cs = coinSpends[0];
    const puzzleRevealHash = bytesToHex(clvm.deserialize(cs.puzzleReveal).treeHash());
    const coinPuzzleHash = bytesToHex(cs.coin.puzzleHash);
    if (puzzleRevealHash !== coinPuzzleHash) {
      throw new Error(
        `buildXchParentSpend: funding spend would fail WRONG_PUZZLE_HASH ` +
          `(coin puzzle hash ${coinPuzzleHash}, reveal hash ${puzzleRevealHash}).`,
      );
    }
    return {
      coin: {
        parentCoinInfo: bytesToHex(cs.coin.parentCoinInfo),
        puzzleHash: bytesToHex(cs.coin.puzzleHash),
        amount: cs.coin.amount,
      },
      puzzleReveal: bytesToHex(cs.puzzleReveal),
      solution: bytesToHex(cs.solution),
    };
  }

  private normalizeHex(value: string): string {
    return value.startsWith('0x') || value.startsWith('0X') ? value : '0x' + value;
  }

  private sdk(): RunnerSdk {
    const sdk = this.wasm.sdk() as Partial<RunnerSdk>;
    if (!sdk.Clvm || !sdk.Coin || !sdk.PublicKey || !sdk.standardPuzzleHash) {
      throw new Error(
        'MintProposalV2PublishRunner: chia-wallet-sdk-wasm missing ' +
          'Clvm/Coin/PublicKey/standardPuzzleHash',
      );
    }
    return sdk as RunnerSdk;
  }

  private clvm(): RunnerClvm {
    return new (this.sdk().Clvm)();
  }
}

// ───────────────────────────────────────────────────────────────────────
//  Public shapes
// ───────────────────────────────────────────────────────────────────────

export interface PublishMintArgs {
  // ── Proposal metadata (from the operator's DRAFT) ──
  propertyId: string;
  collectionId: string;
  assetClassName: string;
  propertyIdCanon: string;
  collectionIdCanon: string;
  sharePpm: number | bigint;
  parValueMojos: number | bigint;
  assetClass: number | bigint;
  jurisdictionHex: string;
  royaltyPuzhash: string;
  royaltyBps: number | bigint;
  quorumThreshold: number | bigint;
  ownerMemberHash: string;
  govMemberHash: string;
  // ── Protocol deployment context ──
  /** Serialized ``(SINGLETON_MOD_HASH, (DID_LAUNCHER_ID, SINGLETON_LAUNCHER_HASH))``. */
  protocolDidSingletonStructHex: string;
  protocolDidPuzhash: string;
  protocolDidInnerPuzhash: string;
  governanceSingletonStructHex: string;
  poolSingletonLauncherId: string;
  poolSingletonLauncherPuzzleHash: string;
  p2PoolModHash: string;
  p2VaultModHash: string;
  propertyRegistryPuzzleHash: string;
  /** Sealed SHA-256 commitment returned by the collection workspace API. */
  metadataRoot?: string;
  /** First deed launcher id. Omit only while publishing the first deed. */
  metadataAnchorId?: string;
  /** Required only for the first deed; must already be RFC 8785 canonical. */
  canonicalMetadataJson?: string;
  /** Exact governed USD-minor price used by the H-system quote artifact. */
  primaryPurchaseUsdAmountMinor?: number | bigint;
  inventoryPuzzleVersion?: 1 | 2;
  primaryPurchaseValidatorPubkeys?: string[];
  primaryPurchaseNetwork?: string;
  primaryPurchaseProtocolTreasuryPuzhash?: string;
  /**
   * Full singleton CoinSpend for the current property-registry registration.
   * It must CREATE_PUZZLE_ANNOUNCEMENT(0x53 || propertyIdCanon) from the
   * registry singleton whose full puzzle hash is propertyRegistryPuzzleHash.
   */
  propertyRegistryCoinSpend?: UnsignedCoinSpend;
  // ── Publish-flow inputs ──
  /** SGT mojos locked as the first vote / anti-spam stake (> 0). */
  firstVoteAmount: number | bigint;
  /** Resolve the ordinary default from current statutes; explicit choices stay fixed. */
  useCurrentMinimumStake?: boolean;
  /** Voting window length in seconds (> 0).  deadline = now + window. */
  votingWindowSeconds: number | bigint;
  /** Override "now" for deterministic tests; defaults to wall-clock. */
  nowSeconds?: number;
  /** Persisted draft id authenticated and re-derived by the API. */
  proposalId: string;
}

export type PublishRunResult =
  | {
      kind: 'invalid-input';
      reason: 'first-vote-amount-must-be-positive' | 'voting-window-must-be-positive';
    }
  | { kind: 'wallet-not-connected' }
  | { kind: 'vault-required'; error: string }
  | { kind: 'tracker-read-failed'; error: string }
  | { kind: 'tracker-not-idle' }
  | { kind: 'sgt-not-deployed' }
  | { kind: 'property-registry-spend-required' }
  | {
      kind: 'no-sgt-coins';
      discovery:
        | { kind: 'sgt-not-deployed' }
        | { kind: 'governance-not-deployed' }
        | { kind: 'no-coins'; catSgtFreePuzzleHash: string };
    }
  | {
      kind: 'no-sgt-coin-matches-stake';
      availableAmounts: number[];
      requestedAmount: bigint;
    }
  | { kind: 'no-xch-coin'; error: string }
  | { kind: 'xch-coin-vanished'; coinId: string }
  | { kind: 'artifact-build-failed'; error: string }
  | { kind: 'metadata-invalid'; error: string }
  | { kind: 'spend-builder-failed'; error: string }
  | { kind: 'xch-parent-build-failed'; error: string }
  | { kind: 'sign-failed'; error: string }
  | { kind: 'publish-failed'; error: string; signedBundle: SignedSpendBundle }
  | {
      kind: 'submitted';
      apiResponse: CommitteeVoteApiResponse;
      signedBundle: SignedSpendBundle;
      artifacts: MintPublishArtifacts;
      xchCoinId: string;
      pickedSgtCoin: SgtCoin;
      sgtLockCoinId: string;
      votingDeadline: bigint;
      voterInnerPuzzleHash: string;
      propertyRegistryCoinId: string;
    };

// ── SDK typing ──────────────────────────────────────────────────────────

interface RunnerSpend {
  puzzle: { serialize(): Uint8Array };
  solution: { serialize(): Uint8Array };
}
interface RunnerCoinSpend {
  coin: { parentCoinInfo: Uint8Array; puzzleHash: Uint8Array; amount: bigint };
  puzzleReveal: Uint8Array;
  solution: Uint8Array;
}
interface RunnerProgram {
  serialize(): Uint8Array;
  treeHash(): Uint8Array;
  curry(args: RunnerProgram[]): RunnerProgram;
}
interface RunnerClvm {
  atom(bytes: Uint8Array): RunnerProgram;
  list(items: RunnerProgram[]): RunnerProgram;
  createCoin(
    puzzleHash: Uint8Array,
    amount: bigint,
    memos: RunnerProgram | undefined,
  ): RunnerProgram;
  delegatedSpend(conditions: RunnerProgram[]): RunnerSpend;
  standardSpend(syntheticKey: unknown, spend: RunnerSpend): RunnerSpend;
  spendStandardCoin(coin: unknown, syntheticKey: unknown, spend: RunnerSpend): void;
  coinSpends(): RunnerCoinSpend[];
  deserialize(bytes: Uint8Array): RunnerProgram;
}
interface RunnerSdk {
  Clvm: new () => RunnerClvm;
  Coin: new (
    parentCoinInfo: Uint8Array,
    puzzleHash: Uint8Array,
    amount: bigint,
  ) => { coinId(): Uint8Array; parentCoinInfo: Uint8Array; puzzleHash: Uint8Array; amount: bigint };
  PublicKey: { fromBytes(bytes: Uint8Array): unknown };
  standardPuzzleHash(syntheticKey: unknown): Uint8Array;
}
