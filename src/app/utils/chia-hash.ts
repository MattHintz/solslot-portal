/**
 * Chia primitives reimplemented in TypeScript so the portal can derive
 * vault-discovery hints and coin ids without any backend round-trip.
 *
 * Mirrors ``populis_puzzles/vault_driver.py``:
 *   - ``vault_discovery_hint`` (sha256 of the namespaced pubkey)
 *   - ``coin_id`` (sha256 of parent_coin_info || puzzle_hash || amount_bytes)
 *
 * Reference test vectors live in
 * ``populis_protocol/tests/test_vault_discovery_hint.py::TestKnownAnswers``
 * — the assertions there must produce identical hex output to the
 * functions below.
 */

import { sha256 } from 'ethers';

// Byte-for-byte mirror of populis_puzzles/vault_driver.py:VAULT_HINT_DOMAIN.
// DO NOT edit one without editing the other (locked by Python tests).
const VAULT_HINT_DOMAIN = new TextEncoder().encode('populis-vault-discovery-v1');

export const AUTH_TYPE_BLS = 1;
export const AUTH_TYPE_SECP256R1 = 2;
export const AUTH_TYPE_SECP256K1 = 3;

/**
 * Deterministic 32-byte hint for vault discovery via CHIP-22 hints.
 *
 * Given a user's pubkey + auth type, this returns the hint that the
 * launcher coin was created with at registration time.  Search for the
 * launcher via `coinset.getCoinRecordsByHint(hint)`.
 *
 * Format (locked by Python tests, must match byte-for-byte):
 *     sha256(b"populis-vault-discovery-v1" || auth_type_byte || owner_pubkey)
 */
export function vaultDiscoveryHint(authType: number, ownerPubkey: Uint8Array): string {
  if (authType !== AUTH_TYPE_BLS && authType !== AUTH_TYPE_SECP256R1 && authType !== AUTH_TYPE_SECP256K1) {
    throw new Error(`Unsupported authType: ${authType}`);
  }
  const buf = new Uint8Array(VAULT_HINT_DOMAIN.length + 1 + ownerPubkey.length);
  buf.set(VAULT_HINT_DOMAIN, 0);
  buf[VAULT_HINT_DOMAIN.length] = authType;
  buf.set(ownerPubkey, VAULT_HINT_DOMAIN.length + 1);
  return sha256(buf); // ethers v6 returns "0x..." 32-byte hex
}

/**
 * Compute a Chia coin id from its three components.
 *
 * ``coin_id = sha256(parent_coin_info || puzzle_hash || amount_bytes)``
 *
 * `amount_bytes` is the canonical CLVM-style big-endian representation:
 *   - 0 → empty bytes (`b""`)
 *   - positive int → minimum-length big-endian, with a leading 0x00 added if
 *     the high bit of the first byte would otherwise be set (to keep it
 *     unambiguously positive in CLVM's signed-int convention).
 */
export function coinId(
  parentCoinInfo: string | Uint8Array,
  puzzleHash: string | Uint8Array,
  amount: number | bigint
): string {
  const parent = toBytes(parentCoinInfo, 32);
  const puz = toBytes(puzzleHash, 32);
  const amt = canonicalIntBytes(typeof amount === 'bigint' ? amount : BigInt(amount));
  const buf = new Uint8Array(parent.length + puz.length + amt.length);
  buf.set(parent, 0);
  buf.set(puz, parent.length);
  buf.set(amt, parent.length + puz.length);
  return sha256(buf);
}

/**
 * CLVM-canonical encoding of a non-negative integer.
 *
 * Examples:
 *   0      → 0x        (empty)
 *   1      → 0x01
 *   127    → 0x7f
 *   128    → 0x0080    (leading 00 to preserve positivity)
 *   256    → 0x0100
 */
export function canonicalIntBytes(n: bigint): Uint8Array {
  if (n < 0n) throw new Error('Negative amounts not supported');
  if (n === 0n) return new Uint8Array(0);
  const bytes: number[] = [];
  let x = n;
  while (x > 0n) {
    bytes.unshift(Number(x & 0xffn));
    x >>= 8n;
  }
  // Add leading 0x00 if the high bit of the first byte is set, otherwise
  // CLVM would interpret it as a negative int.
  if (bytes[0] & 0x80) bytes.unshift(0);
  return new Uint8Array(bytes);
}

function toBytes(input: string | Uint8Array, expectedLen?: number): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  const hex = input.startsWith('0x') ? input.slice(2) : input;
  if (hex.length % 2 !== 0) {
    throw new Error(`Hex string has odd length: ${input}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  if (expectedLen !== undefined && out.length !== expectedLen) {
    throw new Error(`Expected ${expectedLen} bytes, got ${out.length}`);
  }
  return out;
}

/** Helper: hex string '0xab12...' → Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  return toBytes(hex);
}

/** Helper: Uint8Array → '0xab12...' hex string. */
export function bytesToHex(b: Uint8Array): string {
  return '0x' + Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
