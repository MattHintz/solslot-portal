import { Injectable, inject } from '@angular/core';

import {
  BootstrapRecoveryAnchorCreateCoinPreviewResponse,
  BootstrapRecoveryAnchorPublishIntentResponse,
} from './admin-bootstrap.service';
import { ChiaWalletService, SignedSpendBundle } from './chia-wallet.service';
import { ChiaWasmService } from './chia-wasm.service';
import {
  CoinsetService,
  PushTxResponse,
  PushTxSpendBundle,
} from './coinset.service';
import { bytesToHex, hexToBytes } from '../utils/chia-hash';

/**
 * Broadcast the bootstrap recovery anchor as a 1-mojo "marker coin"
 * on chain.
 *
 * **Why this exists.** After ``/admin/bootstrap/finalize`` writes
 * ``bootstrap_recovery_anchor.json`` to API disk, the operator still
 * has to *publish* it somewhere durable.  An on-chain marker coin
 * tagged with ``POPULIS_BOOTSTRAP_V1`` is the canonical home: any
 * future scanner can discover the deployment's coordinates by memo
 * lookup without needing to trust a particular HTTP endpoint or
 * remember a file backup.
 *
 * **Boundary.** This service does NOT see private keys.  It hands a
 * one-output ``CREATE_COIN(marker_ph, 1 mojo, [tag_memo,
 * payload_memo])`` transfer to ``ChiaWalletService.transfer``, lets
 * the connected wallet (Goby or Sage) build + sign the funding
 * spend, walks the signed bundle to recover the funding coin id +
 * derive the marker coin id, then pushes via
 * ``CoinsetService.pushTransaction``.  Nothing here mutates the API.
 *
 * **Failure safety.** If the wallet drops or reorders our memos,
 * ``findMarkerFundingCoinSpend`` refuses to find the expected
 * ``CREATE_COIN`` and we throw *before* push_tx.  The signed bundle
 * is never broadcast, so the operator's wallet remains unaffected
 * by a misbehaving wallet bridge.
 */
@Injectable({ providedIn: 'root' })
export class RecoveryAnchorBroadcastService {
  private readonly wallet = inject(ChiaWalletService);
  private readonly coinset = inject(CoinsetService);
  private readonly chiaWasm = inject(ChiaWasmService);

  /** CLVM opcode for the ``CREATE_COIN`` condition. */
  static readonly CREATE_COIN_OPCODE = 51;

  /**
   * Marker coin amount.  Pinned to 1 mojo to match the API's
   * ``BOOTSTRAP_RECOVERY_ANCHOR_MARKER_MIN_MOJOS`` and the API's
   * create-coin preview shape; this service refuses to broadcast a
   * marker of any other amount.
   */
  static readonly MARKER_COIN_AMOUNT_MOJOS = 1;

  /**
   * Broadcast the marker coin produced by the API's
   * ``/admin/bootstrap/recovery-anchor/create-coin-preview`` endpoint.
   *
   * @param inputs.publishIntent Verbatim response from
   *   ``GET /admin/bootstrap/recovery-anchor/publish-intent``.
   * @param inputs.createCoinPreview Verbatim response from
   *   ``POST /admin/bootstrap/recovery-anchor/create-coin-preview``.
   *   Must have been issued for the same bootstrap artifacts as
   *   ``publishIntent`` (we check ``payload_hash``).
   * @returns The marker coin id + funding coin id + push status + the
   *   signed bundle (so the caller can append it to the recovery
   *   handoff bundle for audit).
   * @throws if the inputs disagree, the wallet refuses, the wallet
   *   strips our memos, or coinset.org rejects the bundle.
   */
  async broadcastMarkerCoin(inputs: {
    publishIntent: BootstrapRecoveryAnchorPublishIntentResponse;
    createCoinPreview: BootstrapRecoveryAnchorCreateCoinPreviewResponse;
  }): Promise<BroadcastRecoveryAnchorResult> {
    const { publishIntent, createCoinPreview } = inputs;
    this.assertPreviewMatchesIntent(publishIntent, createCoinPreview);

    // Ask the connected wallet to send 1 mojo to the marker puzzle
    // hash with the two recovery anchor memos attached.  Goby + Sage
    // both accept UTF-8 strings here; the recovery anchor's
    // canonical JSON is ASCII so this round-trips losslessly.
    const signedBundle = await this.wallet.transfer({
      targetPuzzleHash: createCoinPreview.marker_puzzle_hash,
      amount: RecoveryAnchorBroadcastService.MARKER_COIN_AMOUNT_MOJOS,
      memos: [publishIntent.tag_memo_utf8, publishIntent.payload_memo_utf8],
    });
    if (signedBundle.coinSpends.length === 0) {
      throw new Error(
        'broadcastMarkerCoin: wallet returned a signed bundle with no coin ' +
          'spends. Cannot derive the marker coin id; aborting before push_tx.',
      );
    }

    // Walk the signed bundle to find the CREATE_COIN producing our
    // marker.  This both identifies the funding coin (so we can
    // derive the marker coin id) and verifies the wallet honoured
    // the memos we requested.  If the wallet dropped them we abort
    // here — the bundle is never broadcast.
    const located = this.findMarkerFundingCoinSpend({
      coinSpends: signedBundle.coinSpends,
      markerPuzzleHashHex: createCoinPreview.marker_puzzle_hash,
      tagMemoHex: createCoinPreview.tag_memo_hex,
      payloadMemoHex: createCoinPreview.payload_memo_hex,
    });

    const pushBundle: PushTxSpendBundle = {
      coinSpends: signedBundle.coinSpends,
      aggregatedSignature: signedBundle.aggregatedSignature,
    };
    const pushResult = await this.coinset.pushTransaction(pushBundle);

    return {
      fundingCoinId: located.fundingCoinId,
      markerCoinId: located.markerCoinId,
      markerPuzzleHash: createCoinPreview.marker_puzzle_hash,
      markerCoinAmountMojos:
        RecoveryAnchorBroadcastService.MARKER_COIN_AMOUNT_MOJOS,
      tagMemoUtf8: publishIntent.tag_memo_utf8,
      payloadMemoUtf8: publishIntent.payload_memo_utf8,
      payloadHash: publishIntent.payload_hash,
      pushStatus: pushResult.status,
      signedSpendBundle: signedBundle,
    };
  }

  private assertPreviewMatchesIntent(
    publishIntent: BootstrapRecoveryAnchorPublishIntentResponse,
    createCoinPreview: BootstrapRecoveryAnchorCreateCoinPreviewResponse,
  ): void {
    if (createCoinPreview.payload_hash !== publishIntent.payload_hash) {
      throw new Error(
        'broadcastMarkerCoin: create-coin preview payload_hash does not ' +
          'match publish intent payload_hash. Refetch both before broadcast.',
      );
    }
    if (createCoinPreview.tag_memo_hex !== publishIntent.tag_memo_hex) {
      throw new Error(
        'broadcastMarkerCoin: create-coin preview tag_memo_hex does not ' +
          'match publish intent tag_memo_hex. Refetch both before broadcast.',
      );
    }
    if (
      createCoinPreview.payload_memo_hex !== publishIntent.payload_memo_hex
    ) {
      throw new Error(
        'broadcastMarkerCoin: create-coin preview payload_memo_hex does not ' +
          'match publish intent payload_memo_hex. Refetch both before broadcast.',
      );
    }
    if (
      createCoinPreview.condition_opcode !==
      RecoveryAnchorBroadcastService.CREATE_COIN_OPCODE
    ) {
      throw new Error(
        `broadcastMarkerCoin: only CREATE_COIN (opcode ${RecoveryAnchorBroadcastService.CREATE_COIN_OPCODE}) ` +
          `markers are supported; got opcode ${createCoinPreview.condition_opcode}.`,
      );
    }
    if (
      createCoinPreview.marker_coin_amount_mojos !==
      RecoveryAnchorBroadcastService.MARKER_COIN_AMOUNT_MOJOS
    ) {
      throw new Error(
        `broadcastMarkerCoin: marker coin must be ` +
          `${RecoveryAnchorBroadcastService.MARKER_COIN_AMOUNT_MOJOS} mojo ` +
          `(matches API min); got ${createCoinPreview.marker_coin_amount_mojos}.`,
      );
    }
  }

  /**
   * Scan a wallet-signed bundle for the funding spend that emits the
   * expected ``CREATE_COIN(marker_ph, 1 mojo, [tag_memo, payload_memo])``
   * condition, and derive the resulting marker coin id.
   *
   * Each ``CoinSpend`` is replayed by deserialising + running its
   * puzzle reveal against its solution; the emitted conditions are
   * scanned for one matching opcode, puzzle hash, amount, and memo
   * pair.  If none of the spends match we throw — better to abort
   * before broadcast than to push a bundle missing memos.
   */
  private findMarkerFundingCoinSpend(args: {
    coinSpends: SignedSpendBundle['coinSpends'];
    markerPuzzleHashHex: string;
    tagMemoHex: string;
    payloadMemoHex: string;
  }): { fundingCoinId: string; markerCoinId: string } {
    const sdk = this.chiaWasm.sdk();
    const ClvmCtor = sdk['Clvm'] as
      | (new () => {
          deserialize: (b: Uint8Array) => ProgramShape;
        })
      | undefined;
    const CoinCtor = sdk['Coin'] as
      | (new (
          parent: Uint8Array,
          puzzleHash: Uint8Array,
          amount: bigint,
        ) => { coinId: () => Uint8Array })
      | undefined;
    if (typeof ClvmCtor !== 'function' || typeof CoinCtor !== 'function') {
      throw new Error(
        'broadcastMarkerCoin: chia-wallet-sdk-wasm Clvm/Coin missing. ' +
          'Check ChiaWasmService.ready().',
      );
    }
    const markerPhBytes = hexToBytes(args.markerPuzzleHashHex);
    const tagMemoBytes = hexToBytes(args.tagMemoHex);
    const payloadMemoBytes = hexToBytes(args.payloadMemoHex);

    for (const cs of args.coinSpends) {
      let conditions: ProgramShape;
      try {
        const clvm = new ClvmCtor();
        const puzzle = clvm.deserialize(hexToBytes(cs.puzzleReveal));
        const solution = clvm.deserialize(hexToBytes(cs.solution));
        const output = (
          puzzle as unknown as {
            run: (
              s: ProgramShape,
              c: number,
              m: boolean,
            ) => { value: ProgramShape };
          }
        ).run(solution, 11_000_000, false);
        conditions = output.value;
      } catch {
        // A standard wallet spend should always replay; skip
        // unreadable spends (rare) and let the loop fall through to
        // the throw if none of the other spends match.
        continue;
      }
      const condArray = toProgramList(conditions);
      if (condArray === null) continue;
      for (const cond of condArray) {
        const fields = toProgramList(cond);
        if (fields === null || fields.length < 4) continue;
        const opcode = toAtom(fields[0]);
        if (
          opcode === null ||
          opcode.length !== 1 ||
          opcode[0] !==
            RecoveryAnchorBroadcastService.CREATE_COIN_OPCODE
        ) {
          continue;
        }
        const ph = toAtom(fields[1]);
        if (ph === null || !bytesEqual(ph, markerPhBytes)) continue;
        const amountBytes = toAtom(fields[2]);
        if (
          amountBytes === null ||
          amountBytes.length !== 1 ||
          amountBytes[0] !==
            RecoveryAnchorBroadcastService.MARKER_COIN_AMOUNT_MOJOS
        ) {
          continue;
        }
        const memos = toProgramList(fields[3]);
        if (memos === null || memos.length !== 2) continue;
        const m0 = toAtom(memos[0]);
        const m1 = toAtom(memos[1]);
        if (
          m0 === null ||
          m1 === null ||
          !bytesEqual(m0, tagMemoBytes) ||
          !bytesEqual(m1, payloadMemoBytes)
        ) {
          continue;
        }
        // Match.  Derive the funding coin id from the spent coin
        // and the marker coin id by treating the funding coin id as
        // the marker's parent_coin_info.
        const fundingAmount =
          typeof cs.coin.amount === 'bigint'
            ? cs.coin.amount
            : BigInt(cs.coin.amount);
        const fundingCoin = new CoinCtor(
          hexToBytes(cs.coin.parentCoinInfo),
          hexToBytes(cs.coin.puzzleHash),
          fundingAmount,
        );
        const fundingCoinIdBytes = fundingCoin.coinId();
        const markerCoin = new CoinCtor(
          fundingCoinIdBytes,
          markerPhBytes,
          BigInt(RecoveryAnchorBroadcastService.MARKER_COIN_AMOUNT_MOJOS),
        );
        return {
          fundingCoinId: bytesToHex(fundingCoinIdBytes),
          markerCoinId: bytesToHex(markerCoin.coinId()),
        };
      }
    }
    throw new Error(
      'broadcastMarkerCoin: no coin spend in the wallet-signed bundle ' +
        'creates the expected CREATE_COIN(marker_ph, 1, [tag_memo, ' +
        'payload_memo]).  The wallet may have stripped or reordered our ' +
        'memos — aborting before push_tx so the bundle is never broadcast.',
    );
  }
}

export interface BroadcastRecoveryAnchorResult {
  /** 0x-prefixed coin id of the wallet's funding coin (the marker's parent). */
  fundingCoinId: string;
  /** 0x-prefixed coin id of the newly-created on-chain marker coin. */
  markerCoinId: string;
  /** 0x-prefixed marker puzzle hash (echoed for handoff bundle audit). */
  markerPuzzleHash: string;
  /** Marker coin amount in mojos (always 1). */
  markerCoinAmountMojos: number;
  /** UTF-8 ``POPULIS_BOOTSTRAP_V1`` tag bytes echoed for audit. */
  tagMemoUtf8: string;
  /** UTF-8 canonical JSON recovery anchor payload echoed for audit. */
  payloadMemoUtf8: string;
  /** sha256 content hash of the recovery anchor payload (cross-check). */
  payloadHash: string;
  /** coinset.org ``/push_tx`` status (``SUCCESS`` / ``PENDING`` / null). */
  pushStatus: string | null;
  /** Full wallet-signed spend bundle (for the recovery handoff bundle JSON). */
  signedSpendBundle: SignedSpendBundle;
}

/**
 * Minimal structural type for chia-wallet-sdk-wasm Program / Clvm
 * outputs.  The WASM exports don't ship TypeScript types we can
 * import, and the methods we touch (``toList``, ``toAtom``) are
 * runtime-discriminated.  We narrow with these helpers so each
 * call-site is explicit about what it expects.
 */
interface ProgramShape {
  toAtom?: () => Uint8Array;
  toList?: () => ProgramShape[];
}

function toProgramList(node: ProgramShape | undefined): ProgramShape[] | null {
  if (!node || typeof node.toList !== 'function') return null;
  try {
    return node.toList();
  } catch {
    return null;
  }
}

function toAtom(node: ProgramShape | undefined): Uint8Array | null {
  if (!node || typeof node.toAtom !== 'function') return null;
  try {
    return node.toAtom();
  } catch {
    return null;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
