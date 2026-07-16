import { Injectable, inject } from '@angular/core';

import { ChiaWasmService } from '../chia-wasm.service';
import { canonicalIntBytes, bytesToHex, hexToBytes } from '../../utils/chia-hash';
import { GOVERNANCE_TRACKER_INNER_PUZZLE_HEX } from './governance-singleton-inner.puzzle-hex';
import { SGT_FREE_INNER_PUZZLE_HEX } from './sgt-free-inner.puzzle-hex';
import { SGT_LOCKED_INNER_PUZZLE_HEX } from './sgt-locked-inner.puzzle-hex';
import { SGT_TAIL_PUZZLE_HEX } from './sgt-tail.puzzle-hex';

/**
 * TS port of the read/announcement-id helpers in
 * ``solslot_protocol/solslot_puzzles/sgt_driver.py``.
 *
 * **What this exists for (Brick 3.5c-4 / Phase 2).**  The committee
 * VOTE path needs to build a SGT lock spend whose announcement id
 * matches what the governance tracker singleton asserts.  Computing
 * that announcement id off-chain — without round-tripping through
 * Python — requires byte-compatible TS implementations of:
 *
 *   * The SGT TAIL curry hash (genesis-coin-id → tail puzzle hash).
 *   * The proposal-tracker singleton struct hash.
 *   * The curried sgt_free_inner inner puzzle hash (per voter).
 *   * The curried sgt_locked_inner inner puzzle hash (per voter + proposal).
 *   * The CAT-wrapped sgt_free coin puzzle hash (per voter).
 *   * The LOCK announcement id (sha256 of sender-ph || prefix || sha256tree(LOCK args)).
 *   * The bill operation tuples + their tree-hashes (proposal hashes).
 *
 * **Trust source.**  Mod hashes are pinned to the constants the Python
 * driver computes.  Drift between the bundled .puzzle-hex.ts files
 * and the Python .clsp source will cause the canonical-mod-hash unit
 * tests to fail (locked by Karma + the cross-repo fixtures in this
 * service's spec).
 *
 * **Implementation notes.**  All tree-hash computation goes through
 * the chia-wallet-sdk-wasm's ``treeHashAtom`` / ``treeHashPair``
 * primitives so we share the exact algorithm with on-chain puzzles
 * and the rest of the portal's curry-and-treehash code path (see
 * {@link AdminAuthorityV2Service}).  No hand-rolled sha256 trees.
 *
 * Spend builders (SGT lock spend + tracker VOTE coin spend) live in
 * a sibling service (``CommitteeVoteRunnerService``) — that's the
 * next phase.
 */
@Injectable({ providedIn: 'root' })
export class SgtDriverService {
  private readonly wasm = inject(ChiaWasmService);

  // ── Pinned mod hashes (mirrors the Python driver) ────────────────────
  // CRITICAL: these MUST match the tree-hash of the corresponding
  // .puzzle-hex.ts file (verified by the service spec).

  static readonly SGT_TAIL_MOD_HASH =
    '0x493afb89eed93ab86741b2aa61b8f5de495d33ff9b781dfc8919e602b2afa150';
  static readonly SGT_FREE_INNER_MOD_HASH =
    '0x5b565ff4565b31f8fe351972dd58dd1e1f159b8ec39424db459ea3aa5cdd372c';
  static readonly SGT_LOCKED_INNER_MOD_HASH =
    '0x8092b7bb3f6c9d7d9e355ebc883afe2c0ef2b89336f8ef3ffb3f0716ef7c18c1';
  static readonly GOVERNANCE_TRACKER_INNER_MOD_HASH =
    '0x7f8b97229d0a47a5245d69ea5a8e4c5269c5652c9a32bb117a9149ebf63ad57d';

  /** Standard CAT v2 outer puzzle mod hash (chia_puzzles_py CAT_PUZZLE_HASH). */
  static readonly CAT_MOD_HASH =
    '0x37bef360ee858133b69d595a906dc45d01af50379dad515eb9518abb7c1d2a7a';
  /** SINGLETON_TOP_LAYER mod hash (chia.wallet.puzzles.singleton_top_layer_v1_1). */
  static readonly SINGLETON_MOD_HASH =
    '0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
  /** SINGLETON_LAUNCHER_HASH (tree hash of the launcher puzzle). */
  static readonly SINGLETON_LAUNCHER_HASH =
    '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';

  /** Solslot V2 governance announcement prefix (single byte 0x53, 'S'). */
  static readonly PROTOCOL_PREFIX = new Uint8Array([0x53]);

  /** ``LOCK`` ASCII tag asserted by sgt_free_inner.clsp.  4-byte int. */
  static readonly LOCK_TAG = 0x4c4f434b;

  // ── Bill operation tags (mirror governance_singleton_inner.clsp) ─────
  static readonly BILL_MINT = 0x4d; // 'M'
  static readonly BILL_FREEZE = 0x46; // 'F'
  static readonly BILL_SETTLE = 0x53; // 'S'
  static readonly BILL_VAULT_VERSION = 0x56; // 'V'

  // ── Mod-hash recovery (canonical-mod-hash check) ─────────────────────

  /** Compute tree hash of the bundled sgt_tail bytecode (uncurried). */
  sgtTailModHash(): Uint8Array {
    return this.clvm().deserialize(hexToBytes(SGT_TAIL_PUZZLE_HEX)).treeHash();
  }
  /** Compute tree hash of the bundled sgt_free_inner bytecode. */
  sgtFreeInnerModHash(): Uint8Array {
    return this.clvm().deserialize(hexToBytes(SGT_FREE_INNER_PUZZLE_HEX)).treeHash();
  }
  /** Compute tree hash of the bundled sgt_locked_inner bytecode. */
  sgtLockedInnerModHash(): Uint8Array {
    return this.clvm().deserialize(hexToBytes(SGT_LOCKED_INNER_PUZZLE_HEX)).treeHash();
  }
  /** Compute tree hash of the bundled governance_singleton_inner bytecode. */
  governanceTrackerInnerModHash(): Uint8Array {
    return this.clvm()
      .deserialize(hexToBytes(GOVERNANCE_TRACKER_INNER_PUZZLE_HEX))
      .treeHash();
  }

  // ── SGT TAIL hash (per genesis coin) ─────────────────────────────────

  /**
   * Tree hash of ``sgt_tail.curry(genesis_coin_id)``.
   *
   * Mirrors ``sgt_driver.sgt_tail_hash``.
   */
  sgtTailHash(genesisCoinId: string): Uint8Array {
    return this.curryAndTreeHash(this.sgtTailQuotedMod(), [
      this.treeHashAtom(hexToBytes(genesisCoinId)),
    ]);
  }

  // ── Singleton-struct hash ────────────────────────────────────────────

  /**
   * sha256tree of the proposal-tracker singleton struct:
   * ``(singleton_mod_hash . (tracker_launcher_id . launcher_puzzle_hash))``.
   *
   * Mirrors ``sgt_driver.make_proposal_tracker_struct(...).get_tree_hash()``.
   */
  trackerStructHash(args: {
    trackerLauncherId: string;
    singletonModHash?: string;
    launcherPuzzleHash?: string;
  }): Uint8Array {
    const singletonMh = hexToBytes(
      args.singletonModHash ?? SgtDriverService.SINGLETON_MOD_HASH,
    );
    const launcherId = hexToBytes(args.trackerLauncherId);
    const launcherPh = hexToBytes(
      args.launcherPuzzleHash ?? SgtDriverService.SINGLETON_LAUNCHER_HASH,
    );
    return this.treeHashPair(
      this.treeHashAtom(singletonMh),
      this.treeHashPair(
        this.treeHashAtom(launcherId),
        this.treeHashAtom(launcherPh),
      ),
    );
  }

  // ── SGT_FREE / SGT_LOCKED inner hashes (curried) ─────────────────────

  /**
   * Tree hash of the sgt_free_inner curried for a specific voter.
   *
   *   sgt_free_inner.curry(
   *     SGT_FREE_INNER_MOD_HASH,
   *     SGT_LOCKED_INNER_MOD_HASH,
   *     TRACKER_STRUCT,
   *     VOTER_INNER_PUZZLE_HASH,
   *   )
   */
  sgtFreeInnerHash(args: {
    trackerStructHash: Uint8Array | string;
    voterInnerPuzzleHash: string;
    sgtLockedInnerModHash?: string;
  }): Uint8Array {
    const lockedMh = hexToBytes(
      args.sgtLockedInnerModHash ?? SgtDriverService.SGT_LOCKED_INNER_MOD_HASH,
    );
    const modHash = hexToBytes(SgtDriverService.SGT_FREE_INNER_MOD_HASH);
    const trackerStruct =
      typeof args.trackerStructHash === 'string'
        ? hexToBytes(args.trackerStructHash)
        : args.trackerStructHash;
    return this.curryAndTreeHash(this.sgtFreeInnerQuotedMod(), [
      this.treeHashAtom(modHash),
      this.treeHashAtom(lockedMh),
      trackerStruct,
      this.treeHashAtom(hexToBytes(args.voterInnerPuzzleHash)),
    ]);
  }

  /**
   * Tree hash of the sgt_locked_inner curried for a specific voter + proposal.
   *
   *   sgt_locked_inner.curry(
   *     SGT_LOCKED_INNER_MOD_HASH,
   *     SGT_FREE_INNER_MOD_HASH,
   *     TRACKER_STRUCT,
   *     VOTER_INNER_PUZZLE_HASH,
   *     LOCK_PROPOSAL_HASH,
   *     LOCK_DEADLINE,
   *   )
   */
  sgtLockedInnerHash(args: {
    trackerStructHash: Uint8Array | string;
    voterInnerPuzzleHash: string;
    lockProposalHash: string;
    lockDeadlineSeconds: bigint | number;
    sgtFreeInnerModHash?: string;
  }): Uint8Array {
    const freeMh = hexToBytes(
      args.sgtFreeInnerModHash ?? SgtDriverService.SGT_FREE_INNER_MOD_HASH,
    );
    const modHash = hexToBytes(SgtDriverService.SGT_LOCKED_INNER_MOD_HASH);
    const trackerStruct =
      typeof args.trackerStructHash === 'string'
        ? hexToBytes(args.trackerStructHash)
        : args.trackerStructHash;
    return this.curryAndTreeHash(this.sgtLockedInnerQuotedMod(), [
      this.treeHashAtom(modHash),
      this.treeHashAtom(freeMh),
      trackerStruct,
      this.treeHashAtom(hexToBytes(args.voterInnerPuzzleHash)),
      this.treeHashAtom(hexToBytes(args.lockProposalHash)),
      this.treeHashAtom(canonicalIntBytes(BigInt(args.lockDeadlineSeconds))),
    ]);
  }

  // ── CAT-wrapped sgt_free coin puzzle hash ────────────────────────────

  /**
   * Compute the on-chain puzzle hash of a voter's free SGT CAT coin:
   *
   *   CAT_MOD.curry(CAT_MOD_HASH, SGT_TAIL_HASH, SGT_FREE_INNER_HASH)
   *
   * Mirrors ``sgt_driver.cat_sgt_free_puzzle_hash``.  This is the
   * ``sender_ph`` half of the LOCK announcement id the tracker
   * asserts.
   */
  catSgtFreePuzzleHash(args: {
    sgtFreeInnerHash: Uint8Array | string;
    sgtTailHash: Uint8Array | string;
    catModHash?: string;
  }): Uint8Array {
    const catMh = hexToBytes(args.catModHash ?? SgtDriverService.CAT_MOD_HASH);
    const tail =
      typeof args.sgtTailHash === 'string'
        ? hexToBytes(args.sgtTailHash)
        : args.sgtTailHash;
    const inner =
      typeof args.sgtFreeInnerHash === 'string'
        ? hexToBytes(args.sgtFreeInnerHash)
        : args.sgtFreeInnerHash;
    return this.curryAndTreeHash(this.quotedModFromHash(catMh), [
      this.treeHashAtom(catMh),
      this.treeHashAtom(tail),
      inner,
    ]);
  }

  // ── LOCK announcement id (matches what the tracker asserts) ──────────

  /**
   * Compute the announcement id a voter's SGT lock spend emits.  This
   * value MUST match the announcement the governance tracker asserts
   * during PROPOSE / VOTE — that's how SGT weight binds to a vote.
   *
   * Formula (mirrors governance_singleton_inner.clsp::lock_announcement_id):
   *
   *   announcement_id = sha256(
   *     CAT_SGT_FREE_PUZHASH                                  ||
   *     PROTOCOL_PREFIX                                       ||
   *     sha256tree(LOCK_TAG proposal_hash amount deadline)
   *   )
   */
  async lockAnnouncementId(args: {
    catSgtFreePuzhash: Uint8Array | string;
    proposalHash: string;
    amountMojos: bigint | number;
    lockDeadlineSeconds: bigint | number;
  }): Promise<Uint8Array> {
    const sender =
      typeof args.catSgtFreePuzhash === 'string'
        ? hexToBytes(args.catSgtFreePuzhash)
        : args.catSgtFreePuzhash;
    const inner = this.lockArgsTreeHash(
      args.proposalHash,
      args.amountMojos,
      args.lockDeadlineSeconds,
    );
    const message = new Uint8Array(sender.length + SgtDriverService.PROTOCOL_PREFIX.length + inner.length);
    message.set(sender, 0);
    message.set(SgtDriverService.PROTOCOL_PREFIX, sender.length);
    message.set(inner, sender.length + SgtDriverService.PROTOCOL_PREFIX.length);
    const digest = await crypto.subtle.digest('SHA-256', message);
    return new Uint8Array(digest);
  }

  /**
   * sha256tree of the LOCK args list ``(LOCK_TAG proposal_hash amount deadline)``.
   * Exposed so tests + callers can verify against the Python helper
   * independently of the sha256 concat layer above.
   */
  lockArgsTreeHash(
    proposalHash: string,
    amountMojos: bigint | number,
    deadlineSeconds: bigint | number,
  ): Uint8Array {
    const clvm = this.clvm();
    const list = clvm.list([
      clvm.int(BigInt(SgtDriverService.LOCK_TAG)),
      clvm.atom(hexToBytes(proposalHash)),
      clvm.int(BigInt(amountMojos)),
      clvm.int(BigInt(deadlineSeconds)),
    ]);
    return list.treeHash();
  }

  // ── Bill builders + proposal hash ────────────────────────────────────

  /**
   * MINT bill: governance approves spawning a deed and binds the property
   * registry context.  Tree-hash is the proposal hash committed on chain.
   */
  billMint(
    deedFullPuzzleHash: string,
    propertyIdCanon?: string,
    propertyRegistryPuzzleHash?: string,
  ): Uint8Array {
    const elements = [
      this.treeHashAtom(new Uint8Array([SgtDriverService.BILL_MINT])),
      this.treeHashAtom(hexToBytes(deedFullPuzzleHash)),
    ];
    if (propertyIdCanon !== undefined || propertyRegistryPuzzleHash !== undefined) {
      if (propertyIdCanon === undefined || propertyRegistryPuzzleHash === undefined) {
        throw new Error('propertyIdCanon and propertyRegistryPuzzleHash must be passed together');
      }
      elements.push(this.treeHashAtom(hexToBytes(propertyIdCanon)));
      elements.push(this.treeHashAtom(hexToBytes(propertyRegistryPuzzleHash)));
    }
    return this.billTreeHash(elements);
  }

  /** FREEZE bill: flip pool status (0 = FROZEN, 1 = ACTIVE). */
  billFreeze(newPoolStatus: number): Uint8Array {
    return this.billTreeHash([
      this.treeHashAtom(new Uint8Array([SgtDriverService.BILL_FREEZE])),
      this.treeHashAtom(canonicalIntBytes(BigInt(newPoolStatus))),
    ]);
  }

  /** SETTLE bill: batch settlement. */
  billSettle(args: {
    splitxchRoot: string;
    totalAmountMojos: bigint | number;
    numDeeds: bigint | number;
    deedReleasesHash: string;
  }): Uint8Array {
    return this.billTreeHash([
      this.treeHashAtom(new Uint8Array([SgtDriverService.BILL_SETTLE])),
      this.treeHashAtom(hexToBytes(args.splitxchRoot)),
      this.treeHashAtom(canonicalIntBytes(BigInt(args.totalAmountMojos))),
      this.treeHashAtom(canonicalIntBytes(BigInt(args.numDeeds))),
      this.treeHashAtom(hexToBytes(args.deedReleasesHash)),
    ]);
  }

  /** VAULT_VERSION bill: ratify a vault_version_registry code change. */
  billVaultVersion(args: {
    newVaultInnerModHash: string;
    newCanonicalParamsHash: string;
    newVaultVersion: bigint | number;
  }): Uint8Array {
    return this.billTreeHash([
      this.treeHashAtom(new Uint8Array([SgtDriverService.BILL_VAULT_VERSION])),
      this.treeHashAtom(hexToBytes(args.newVaultInnerModHash)),
      this.treeHashAtom(hexToBytes(args.newCanonicalParamsHash)),
      this.treeHashAtom(canonicalIntBytes(BigInt(args.newVaultVersion))),
    ]);
  }

  /**
   * Hex-string convenience wrappers around the {@link billMint} etc.
   * helpers — every spec/wire context wants 0x-prefixed lowercase
   * strings.  ``proposalHashFromBillHex`` mirrors the
   * ``sgt_driver.proposal_hash_from_bill`` semantics:
   * ``sha256tree(bill_op) == proposal_hash``.
   */
  proposalHashFromBillHex(bill: Uint8Array): string {
    return bytesToHex(bill);
  }

  // ── Internal: tree hash of a proper-list bill ────────────────────────

  private billTreeHash(elementHashes: Uint8Array[]): Uint8Array {
    // Bills are proper CLVM lists (right-nested cons cells terminated
    // by nil).  sha256tree of a list is built right-to-left.
    let acc = this.nilTreeHash();
    for (let i = elementHashes.length - 1; i >= 0; i--) {
      acc = this.treeHashPair(elementHashes[i], acc);
    }
    return acc;
  }

  // ── Curry-and-treehash helpers (mirror AdminAuthorityV2 internals) ───

  private curryAndTreeHash(quotedMod: Uint8Array, args: Uint8Array[]): Uint8Array {
    return this.treeHashPair(
      this.aKwTreeHash(),
      this.treeHashPair(
        quotedMod,
        this.treeHashPair(this.curriedValuesTreeHash(args), this.nilTreeHash()),
      ),
    );
  }

  private curriedValuesTreeHash(args: Uint8Array[]): Uint8Array {
    if (args.length === 0) {
      return this.qKwTreeHash(); // ONE_TREEHASH = treeHashAtom([1])
    }
    const [first, ...rest] = args;
    return this.treeHashPair(
      this.cKwTreeHash(),
      this.treeHashPair(
        this.treeHashPair(this.qKwTreeHash(), first),
        this.treeHashPair(this.curriedValuesTreeHash(rest), this.nilTreeHash()),
      ),
    );
  }

  /**
   * ``calculate_hash_of_quoted_mod_hash(mod_hash)`` from chia.  The
   * second argument is the mod hash *itself* (32 raw bytes), NOT
   * ``treeHashAtom(mod_hash)`` — the mod hash already IS the tree
   * hash of the mod expression, so wrapping in ``(q . mod_hash)``
   * just pairs it with the quoted-opcode tree hash.
   */
  private quotedModFromHash(modHash: Uint8Array): Uint8Array {
    return this.treeHashPair(this.qKwTreeHash(), modHash);
  }

  private sgtTailQuotedMod(): Uint8Array {
    return this.quotedModFromHash(hexToBytes(SgtDriverService.SGT_TAIL_MOD_HASH));
  }
  private sgtFreeInnerQuotedMod(): Uint8Array {
    return this.quotedModFromHash(hexToBytes(SgtDriverService.SGT_FREE_INNER_MOD_HASH));
  }
  private sgtLockedInnerQuotedMod(): Uint8Array {
    return this.quotedModFromHash(hexToBytes(SgtDriverService.SGT_LOCKED_INNER_MOD_HASH));
  }

  // Memoised single-byte tree hashes.
  private _qKw?: Uint8Array;
  private _aKw?: Uint8Array;
  private _cKw?: Uint8Array;
  private _nil?: Uint8Array;
  private qKwTreeHash(): Uint8Array {
    return (this._qKw ??= this.treeHashAtom(new Uint8Array([0x01])));
  }
  private aKwTreeHash(): Uint8Array {
    return (this._aKw ??= this.treeHashAtom(new Uint8Array([0x02])));
  }
  private cKwTreeHash(): Uint8Array {
    return (this._cKw ??= this.treeHashAtom(new Uint8Array([0x04])));
  }
  private nilTreeHash(): Uint8Array {
    return (this._nil ??= this.treeHashAtom(new Uint8Array(0)));
  }

  private treeHashAtom(bytes: Uint8Array): Uint8Array {
    const sdk = this.wasm.sdk() as SgtSdkShape;
    if (!sdk.treeHashAtom) {
      throw new Error('chia-wallet-sdk-wasm missing treeHashAtom export');
    }
    return sdk.treeHashAtom(bytes);
  }

  private treeHashPair(first: Uint8Array, rest: Uint8Array): Uint8Array {
    const sdk = this.wasm.sdk() as SgtSdkShape;
    if (!sdk.treeHashPair) {
      throw new Error('chia-wallet-sdk-wasm missing treeHashPair export');
    }
    return sdk.treeHashPair(first, rest);
  }

  // ── WASM accessor ────────────────────────────────────────────────────

  private clvm(): ClvmShape {
    const sdk = this.wasm.sdk() as SgtSdkShape;
    if (!sdk.Clvm) {
      throw new Error(
        'SgtDriverService: chia-wallet-sdk-wasm not loaded yet. ' +
          'Await ChiaWasmService.ready() before calling hash helpers.',
      );
    }
    return new sdk.Clvm();
  }
}

// ─── SDK shape (narrowed) ────────────────────────────────────────────────

interface SgtSdkShape {
  Clvm?: new () => ClvmShape;
  treeHashAtom?: (bytes: Uint8Array) => Uint8Array;
  treeHashPair?: (first: Uint8Array, rest: Uint8Array) => Uint8Array;
}

interface ClvmShape {
  atom(bytes: Uint8Array): ClvmProgramShape;
  int(value: bigint): ClvmProgramShape;
  list(items: ReadonlyArray<ClvmProgramShape>): ClvmProgramShape;
  deserialize(bytes: Uint8Array): ClvmProgramShape;
}

interface ClvmProgramShape {
  treeHash(): Uint8Array;
}
