import { Injectable, inject } from '@angular/core';

import { ChiaWalletService, SignedSpendBundle, UnsignedCoinSpend } from '../chia-wallet.service';
import { ChiaWasmService } from '../chia-wasm.service';
import {
  CommitteeApiService,
  CommitteeVoteApiResponse,
  PublishProposalMetadataJson,
} from '../committee-api.service';
import { CoinsetService } from '../coinset.service';
import {
  GovernanceTrackerReaderService,
  IdleStateProposeInputs,
} from '../governance-tracker-reader.service';
import { SgtCoin, SgtCoinDiscoveryService } from '../sgt-driver/sgt-coin-discovery.service';
import { SgtDriverService } from '../sgt-driver/sgt-driver.service';
import { WalletCoinPickerService } from '../wallet-coin-picker.service';
import { bytesToHex, coinId, hexToBytes } from '../../utils/chia-hash';
import { environment } from '../../../environments/environment';

import { MintProposalV2Service } from './mint-proposal-v2.service';
import { MintPublishArtifacts, MintPublishService } from './mint-publish.service';
import { MintPublishSpendBuilderService } from './mint-publish-spend-builder.service';

/**
 * End-to-end orchestrator for the Mint V2 **Publish** flow (Phase 4
 * sub-brick 4d.3).
 *
 * **4d.3b scope (this commit).**  Glue every service needed to take a
 * single MINT proposal from the connected wallet to a *signed* spend
 * bundle — but stop short of posting it.  The runner returns the
 * assembled {@link SignedSpendBundle} (+ the pinned artifacts) so the
 * caller can inspect/dump it.  4d.3c adds the
 * ``CommitteeApiService.publishProposal()`` forwarder and flips the
 * happy-path result from ``'assembled'`` to ``'submitted'``.
 *
 * **Bundle topology.**  The publish bundle lands three on-chain
 * artifacts atomically (the "P-C-soft" path):
 *
 *   1. **XCH parent spend** — one standard p2 coin from the connected
 *      wallet, spent to emit:
 *        * ``CREATE_COIN(deed_launcher_puzhash, 1)`` — pre-spawns the
 *          DID-gated deed launcher coin (the deed launcher itself is
 *          NOT spent here; that's a post-Phase-4 deed-launch brick).
 *        * the two Artifact A launcher parent conditions
 *          (``CREATE_COIN(singleton_launcher, 1)`` +
 *          ``ASSERT_COIN_ANNOUNCEMENT``) from
 *          {@link MintPublishSpendBuilderService.buildProposalEveLaunchSpend}.
 *        * a change ``CREATE_COIN`` back to the wallet.
 *      The same XCH coin is the parent for BOTH launchers — the two
 *      children have distinct puzzle hashes (DID-gated vs. standard)
 *      so their coin ids differ.
 *   2. **Artifact A launcher coin spend** — launcher → eve singleton
 *      (V2 mint-proposal, DRAFT state).
 *   3. **Tracker PROPOSE spend** — the governance tracker singleton
 *      IDLE → OPEN.
 *   4. **SGT first-vote LOCK spend** — the proposer's SGT free coin
 *      locked as the proposal's first vote / anti-spam stake.
 *
 * Property registration is intentionally deferred to the quorum-authorized
 * EXECUTE bundle.  The current registry coin is carried only as a witness at
 * publish time and is never spent before governance passes.
 *
 * The wallet signs the AGG_SIG_ME conditions in (1), (4), and (5) when
 * the connected wallet controls the required keys.  (2) and (3) are
 * permissionless.
 *
 * **Protocol context.**  Several curry inputs to
 * {@link MintPublishService.buildMintPublishArtifacts}
 * (``protocolDidSingletonStructHex``, ``protocolDidPuzhash``,
 * ``p2PoolModHash``, ``p2VaultModHash``, ``govMemberHash``) are not in
 * ``environment.solslotProtocol`` today, so the runner takes them as
 * explicit ``PublishMintArgs`` fields.  The 4f UI assembles them from
 * the protocol read + the operator's draft.
 *
 * **Result.**  Discriminated-union {@link PublishRunResult} mirroring
 * Phase 3's ``VoteRunResult`` shape: every non-``'assembled'`` variant
 * is a pre-flight failure that didn't touch the wallet.
 */
@Injectable({ providedIn: 'root' })
export class MintProposalV2PublishRunnerService {
  private readonly wallet = inject(ChiaWalletService);
  private readonly wasm = inject(ChiaWasmService);
  private readonly coinset = inject(CoinsetService);
  private readonly tracker = inject(GovernanceTrackerReaderService);
  private readonly discovery = inject(SgtCoinDiscoveryService);
  private readonly sgt = inject(SgtDriverService);
  private readonly publish = inject(MintPublishService);
  private readonly v2 = inject(MintProposalV2Service);
  private readonly spendBuilder = inject(MintPublishSpendBuilderService);
  private readonly coinPicker = inject(WalletCoinPickerService);
  private readonly api = inject(CommitteeApiService);

  /**
   * Build, sign, and POST the publish bundle for a single MINT
   * proposal.
   *
   * @returns {@link PublishRunResult}.  ``'submitted'`` when the bundle
   *   was pushed (the API may still report ``pushed: false`` for a
   *   mempool rejection — the UI renders ``apiResponse.status`` either
   *   way).  All other variants are pre-flight failures that did not
   *   reach the wallet or the API.
   */
  async publishMint(args: PublishMintArgs): Promise<PublishRunResult> {
    // ── 0. Validate inputs ──
    const firstVoteAmount = BigInt(args.firstVoteAmount);
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
    const voterInnerPuzzleHash = bytesToHex(voterInnerPuzzleHashBytes);
    const fundingPuzzleHash = bytesToHex(voterInnerPuzzleHashBytes);

    // ── 2. Tracker IDLE state ──
    let trackerInputs: IdleStateProposeInputs | null;
    try {
      trackerInputs = await this.tracker.getIdleStateProposeInputs();
    } catch (err) {
      return {
        kind: 'tracker-read-failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (!trackerInputs) {
      return { kind: 'tracker-not-idle' };
    }

    // ── 3. SGT coin discovery (proposer's first-vote stake) ──
    const sgtGenesisCoinId = environment.solslotProtocol.sgtGenesisCoinId;
    if (!sgtGenesisCoinId) {
      return { kind: 'sgt-not-deployed' };
    }
    const discovery = await this.discovery.discover({ voterInnerPuzzleHash });
    if (discovery.kind !== 'found') {
      return { kind: 'no-sgt-coins', discovery };
    }
    const sgtPick = discovery.coins.find((c) => BigInt(c.amount) === firstVoteAmount);
    if (!sgtPick) {
      return {
        kind: 'no-sgt-coin-matches-stake',
        availableAmounts: discovery.coins.map((c) => c.amount),
        requestedAmount: firstVoteAmount,
      };
    }

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
        p2PoolModHash: args.p2PoolModHash,
        p2VaultModHash: args.p2VaultModHash,
        propertyRegistryPuzzleHash: args.propertyRegistryPuzzleHash,
      });
    } catch (err) {
      return {
        kind: 'artifact-build-failed',
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

    // ── 7. Compute the proposer's SGT LOCK inner solution ──
    // A standard p2 delegated spend that creates exactly the canonical
    // sgt_locked_inner output and nothing else; the wallet signs the
    // AGG_SIG_ME this delegated puzzle introduces.
    const votingDeadline =
      BigInt(args.nowSeconds ?? Math.floor(Date.now() / 1000)) + votingWindowSeconds;
    const trackerStructHash = this.sgt.trackerStructHash({
      trackerLauncherId: trackerInputs.trackerLauncherId,
    });
    const lockedPuzzleHash = this.sgt.sgtLockedInnerHash({
      trackerStructHash,
      voterInnerPuzzleHash,
      lockProposalHash: artifacts.proposalHash,
      lockDeadlineSeconds: votingDeadline,
    });
    const clvm = this.clvm();
    const lockCreateCoin = clvm.createCoin(lockedPuzzleHash, firstVoteAmount, undefined);
    const lockDelegatedSpend = clvm.delegatedSpend([lockCreateCoin]);
    const lockInnerSpend = clvm.standardSpend(syntheticKey, lockDelegatedSpend);
    const voterInnerPuzzleHex = bytesToHex(lockInnerSpend.puzzle.serialize());
    const voterInnerSolutionHex = bytesToHex(lockInnerSpend.solution.serialize());

    const sgtTailHash = bytesToHex(this.sgt.sgtTailHash(sgtGenesisCoinId));
    // The delegated inner spend creates the locked inner puzzle hash; the
    // actual child coin is CAT-wrapped with the SGT TAIL as its asset id.
    const lockedCatPuzzleHash = bytesToHex(
      this.sgt.catSgtFreePuzzleHash({
        sgtFreeInnerHash: lockedPuzzleHash,
        sgtTailHash,
      }),
    );
    const sgtPickCoinId = coinId(sgtPick.parentCoinInfo, sgtPick.puzzleHash, sgtPick.amount);
    const sgtLockCoinId = coinId(sgtPickCoinId, lockedCatPuzzleHash, firstVoteAmount);

    // ── 8. Build the three publish spends ──
    let eveLaunch: ReturnType<MintPublishSpendBuilderService['buildProposalEveLaunchSpend']>;
    let trackerProposeSpend: UnsignedCoinSpend;
    let sgtLockSpend: UnsignedCoinSpend;
    try {
      eveLaunch = this.spendBuilder.buildProposalEveLaunchSpend({
        xchParentCoin: xchCoin,
        eveInnerPuzzleHex,
      });
      trackerProposeSpend = this.spendBuilder.buildTrackerProposeCoinSpend({
        trackerCoin: trackerInputs.trackerCoin,
        trackerInnerPuzzleHex: trackerInputs.trackerInnerPuzzleHex,
        trackerLauncherId: trackerInputs.trackerLauncherId,
        lineageProof: trackerInputs.lineageProof,
        proposalHash: artifacts.proposalHash,
        billOperationHex: artifacts.billOpProgramHex,
        voterInnerPuzzleHash,
        firstVoteAmount,
        votingDeadline,
      });
      sgtLockSpend = this.spendBuilder.buildSgtFirstVoteCoinSpend({
        sgtCoin: {
          parentCoinInfo: sgtPick.parentCoinInfo,
          puzzleHash: sgtPick.puzzleHash,
          amount: sgtPick.amount,
        },
        voterInnerPuzzleHex,
        voterInnerSolutionHex,
        trackerLauncherId: trackerInputs.trackerLauncherId,
        sgtTailHash,
        // Eve case (empty lineage proof) — sufficient for SGT coins that
        // are direct children of the TAIL issuance.  Transferred coins
        // need a real proof; same alpha caveat as the Phase 3 vote runner.
        lineageProof: {},
        proposalHash: artifacts.proposalHash,
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
      });
    } catch (err) {
      return {
        kind: 'xch-parent-build-failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // ── 10. Sign the bundle (wallet covers XCH parent + SGT lock) ──
    const unsigned: UnsignedCoinSpend[] = [
      xchParentSpend,
      eveLaunch.launcherCoinSpend,
      trackerProposeSpend,
      sgtLockSpend,
    ];
    let signedBundle: SignedSpendBundle;
    try {
      signedBundle = await this.wallet.signSpendBundle(unsigned);
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
    };
    let apiResponse: CommitteeVoteApiResponse;
    try {
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

    const conditions = [
      // Deed launcher pre-spawn.
      clvm.createCoin(
        args.deedLauncherPuzhash,
        MintPublishSpendBuilderService.SINGLETON_AMOUNT,
        undefined,
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
  p2PoolModHash: string;
  p2VaultModHash: string;
  propertyRegistryPuzzleHash: string;
  /**
   * Full singleton CoinSpend for the current property-registry registration.
   * It must CREATE_PUZZLE_ANNOUNCEMENT(0x53 || propertyIdCanon) from the
   * registry singleton whose full puzzle hash is propertyRegistryPuzzleHash.
   */
  propertyRegistryCoinSpend?: UnsignedCoinSpend;
  // ── Publish-flow inputs ──
  /** SGT mojos locked as the first vote / anti-spam stake (> 0). */
  firstVoteAmount: number | bigint;
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
  createCoin(puzzleHash: Uint8Array, amount: bigint, memos: undefined): RunnerProgram;
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
