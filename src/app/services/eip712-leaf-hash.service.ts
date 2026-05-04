import { Injectable, inject } from '@angular/core';

import { ChiaWasmService } from './chia-wasm.service';

/**
 * Hex constant — Chia testnet11 genesis challenge.  Mirrors
 * ``populis_protocol/populis_puzzles/eip712_helpers.py``'s
 * ``TESTNET11_GENESIS_CHALLENGE`` and the value pinned in the chia-blockchain
 * config (``selected_network: testnet11``).
 *
 * Used to derive the EIP-712 domain separator that gets curried into
 * the Eip712Member puzzle and into every signed CHIP-0037 envelope —
 * so an admin's signature on testnet11 can NEVER replay against
 * mainnet.
 */
export const TESTNET11_GENESIS_CHALLENGE_HEX =
  '37a90eb5185a9c4439a91ddc98bbadce7b4feba060d50116a067de66bf236615';

/**
 * Hex constant — Chia mainnet genesis challenge.  Mirrors
 * ``populis_protocol/populis_puzzles/eip712_helpers.py``'s
 * ``MAINNET_GENESIS_CHALLENGE``.
 */
export const MAINNET_GENESIS_CHALLENGE_HEX =
  'ccd5bb71183532bff220ba46c268991a3ff07eb358e8255a65c30a2dce0e5fbb';

/** Map a network name to its 32-byte genesis challenge. */
export function genesisChallengeFor(network: 'testnet11' | 'mainnet'): Uint8Array {
  const hex =
    network === 'mainnet'
      ? MAINNET_GENESIS_CHALLENGE_HEX
      : TESTNET11_GENESIS_CHALLENGE_HEX;
  return hexToBytes(hex);
}

/**
 * Convert a hex string (with or without a leading ``0x``) to a
 * ``Uint8Array``.  Throws on odd-length input or non-hex characters.
 */
function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (stripped.length % 2 !== 0) {
    throw new Error(`hex string must have even length, got ${stripped.length}`);
  }
  const bytes = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < stripped.length; i += 2) {
    const byte = parseInt(stripped.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`invalid hex pair at offset ${i}: ${stripped.slice(i, i + 2)}`);
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}

/**
 * Convert a ``Uint8Array`` to a 0x-prefixed lowercase hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return (
    '0x' +
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  );
}

/**
 * Full curry-args bundle for an ``Eip712Member`` admin leaf.
 *
 * Mirrors the wire shape of ``populis_api``'s
 * ``ComputeLeafHashResponse`` — callers can drop this directly into the
 * admin records JSON's ``leaves[i]`` block without re-deriving anything.
 */
export interface Eip712LeafHash {
  /** 0x-prefixed 32-byte tree hash of the curried Eip712Member puzzle. */
  leaf_hash: string;
  /** Echoed pubkey, lowercased + 0x-prefixed. */
  secp256k1_pubkey: string;
  /** 0x-prefixed 32-byte CHIP-0037 type hash. */
  type_hash: string;
  /** 0x-prefixed 34-byte ``0x1901 || domain_separator``. */
  prefix_and_domain_separator: string;
  /** Network whose genesis challenge produced the domain separator. */
  network: 'testnet11' | 'mainnet';
}

/**
 * Compute Eip712Member admin-leaf hashes **in the browser** via the
 * chia-wallet-sdk WASM, mirroring populis_api's
 * ``POST /admin/auth/eip712/compute_leaf_hash`` endpoint without the
 * round-trip.
 *
 * The returned ``leaf_hash`` is the puzzle hash of an ``Eip712Member``
 * curried with ``(prefix_and_domain_separator, type_hash, public_key)``
 * — no MIPS wrapper layer.  This is exactly the value the on-chain
 * ``admin_authority_v2`` inner puzzle compares to via
 * ``(= (sha256tree approving_member_reveal) <leaf>)`` at admin-spend
 * time, and is the value that gets folded into ``ADMINS_HASH`` via the
 * launch-time ``compute_admins_hash`` driver.
 *
 * Cross-verified against ``populis_protocol``'s
 * ``compute_eip712_member_leaf_hash`` Python helper (which uses
 * ``chia.wallet.util.curry_and_treehash`` semantics) by
 * ``test_matches_chia_curry_and_treehash`` — see the spec file for
 * fixture pinning.
 */
@Injectable({ providedIn: 'root' })
export class Eip712LeafHashService {
  private readonly chiaWasm = inject(ChiaWasmService);

  /**
   * Compute the canonical leaf hash + curry args for a single
   * Eip712Member admin slot.
   *
   * Throws if the WASM SDK isn't ready or if any of the expected
   * exports (``eip712TypeHash``, ``eip712DomainSeparator``,
   * ``eip712MemberInnerPuzzleHash``, ``K1PublicKey.fromBytes``) are
   * missing — the caller should gate UI on
   * ``ChiaWasmService.ready`` first.
   *
   * @param secp256k1Pubkey 0x-prefixed (or bare) hex of the 33-byte
   *   compressed secp256k1 pubkey recovered from an EVM wallet's
   *   signed CHIP-0037 envelope.
   * @param network ``"testnet11"`` | ``"mainnet"`` — controls which
   *   genesis challenge gets curried into the domain separator.
   */
  compute(
    secp256k1Pubkey: string,
    network: 'testnet11' | 'mainnet',
  ): Eip712LeafHash {
    const sdk = this.chiaWasm.sdk();
    const eip712TypeHashFn = sdk['eip712TypeHash'] as (() => Uint8Array) | undefined;
    const eip712DomainSeparatorFn = sdk['eip712DomainSeparator'] as
      | ((genesis: Uint8Array) => Uint8Array)
      | undefined;
    const eip712MemberInnerPuzzleHashFn = sdk['eip712MemberInnerPuzzleHash'] as
      | ((genesis: Uint8Array, pubkey: unknown) => Uint8Array)
      | undefined;
    const K1PublicKeyClass = sdk['K1PublicKey'] as
      | { fromBytes: (bytes: Uint8Array) => unknown }
      | undefined;
    if (
      typeof eip712TypeHashFn !== 'function' ||
      typeof eip712DomainSeparatorFn !== 'function' ||
      typeof eip712MemberInnerPuzzleHashFn !== 'function' ||
      typeof K1PublicKeyClass?.fromBytes !== 'function'
    ) {
      throw new Error(
        'chia-wallet-sdk-wasm is missing eip712 helpers. ' +
          'Required exports: eip712TypeHash, eip712DomainSeparator, ' +
          'eip712MemberInnerPuzzleHash, K1PublicKey.fromBytes.',
      );
    }

    const pubkeyBytes = hexToBytes(secp256k1Pubkey);
    if (pubkeyBytes.length !== 33) {
      throw new Error(
        `secp256k1_pubkey must be 33 bytes (compressed), got ${pubkeyBytes.length}`,
      );
    }
    const genesis = genesisChallengeFor(network);

    const typeHash = eip712TypeHashFn();
    const domainSep = eip712DomainSeparatorFn(genesis);
    // EIP-712 prefix is 0x1901 || domain_separator (34 bytes).  The WASM
    // helper for this primitive (``eip712_prefix_and_domain_separator``)
    // returns ``BytesImpl<34>``, which the bindy_macro can't currently
    // map to JS — so we concat in JS.  Cheap (one allocation).
    const prefixAndDomain = new Uint8Array(34);
    prefixAndDomain[0] = 0x19;
    prefixAndDomain[1] = 0x01;
    prefixAndDomain.set(domainSep, 2);

    const k1 = K1PublicKeyClass.fromBytes(pubkeyBytes);
    const leafHash = eip712MemberInnerPuzzleHashFn(genesis, k1);

    return {
      leaf_hash: bytesToHex(leafHash),
      secp256k1_pubkey: bytesToHex(pubkeyBytes),
      type_hash: bytesToHex(typeHash),
      prefix_and_domain_separator: bytesToHex(prefixAndDomain),
      network,
    };
  }
}
