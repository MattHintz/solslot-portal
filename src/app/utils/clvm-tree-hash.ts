/**
 * Pure-TypeScript CLVM `sha256tree` — the tree hash chia uses for puzzles and
 * for `Program.get_tree_hash()`.  No WASM needed, so callers (and unit tests)
 * can hash CLVM structures synchronously off the main thread's SDK.
 *
 *   leaf(atom)      = sha256(0x01 || atom)
 *   pair(l, r)      = sha256(0x02 || treehash(l) || treehash(r))
 *   list[a,b,c]     = pair(a, pair(b, pair(c, nil)))   where nil = empty atom
 *
 * Mirrors `Program.to([...]).get_tree_hash()` in chia byte-for-byte; the
 * cross-language vectors are pinned in `vault-version-detection.spec.ts`
 * against `populis_puzzles.vault_version_registry_driver` (Python).
 */
import { sha256 } from 'ethers';

import { canonicalIntBytes, hexToBytes } from './chia-hash';

const ATOM_PREFIX = Uint8Array.of(1);
const PAIR_PREFIX = Uint8Array.of(2);

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    buf.set(p, offset);
    offset += p.length;
  }
  return buf;
}

function digest(parts: Uint8Array[]): Uint8Array {
  // ethers v6 sha256(BytesLike) -> "0x"-prefixed hex string.
  return hexToBytes(sha256(concatBytes(parts)));
}

/** sha256tree of a leaf atom: `sha256(0x01 || atom)`. */
export function treeHashAtom(atom: Uint8Array): Uint8Array {
  return digest([ATOM_PREFIX, atom]);
}

/** sha256tree of a cons pair: `sha256(0x02 || leftHash || rightHash)`. */
export function treeHashPair(leftHash: Uint8Array, rightHash: Uint8Array): Uint8Array {
  return digest([PAIR_PREFIX, leftHash, rightHash]);
}

/** CLVM-canonical signed integer atom bytes. */
export function clvmIntBytes(value: bigint): Uint8Array {
  if (value >= 0n) {
    return canonicalIntBytes(value);
  }

  let width = 1;
  while (true) {
    const bits = BigInt(width * 8);
    const min = -(1n << (bits - 1n));
    const max = (1n << (bits - 1n)) - 1n;
    if (value >= min && value <= max) break;
    width++;
  }

  const modulus = 1n << BigInt(width * 8);
  let encoded = modulus + value;
  const out = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i--) {
    out[i] = Number(encoded & 0xffn);
    encoded >>= 8n;
  }
  return out;
}

export type ClvmTreeValue =
  | Uint8Array
  | bigint
  | number
  | null
  | ReadonlyArray<ClvmTreeValue>;

/** sha256tree of a CLVM value represented as atoms, ints, and proper lists. */
export function treeHashValue(value: ClvmTreeValue): Uint8Array {
  if (value instanceof Uint8Array) {
    return treeHashAtom(value);
  }
  if (typeof value === 'bigint') {
    return treeHashAtom(clvmIntBytes(value));
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error('CLVM number values must be safe integers');
    }
    return treeHashAtom(clvmIntBytes(BigInt(value)));
  }
  if (value === null) {
    return treeHashAtom(new Uint8Array(0));
  }
  return treeHashList(value);
}

/** sha256tree of a proper, nil-terminated CLVM list. */
export function treeHashList(items: ReadonlyArray<ClvmTreeValue>): Uint8Array {
  let acc = treeHashAtom(new Uint8Array(0));
  for (let i = items.length - 1; i >= 0; i--) {
    acc = treeHashPair(treeHashValue(items[i]), acc);
  }
  return acc;
}

/**
 * sha256tree of a proper, nil-terminated list of atoms — i.e. the tree hash of
 * `(a0 . (a1 . (… . ())))`, identical to `Program.to([a0, a1, …]).get_tree_hash()`.
 */
export function treeHashAtomList(atoms: Uint8Array[]): Uint8Array {
  // Start from the terminating nil (the empty atom) and fold from the right.
  let acc = treeHashAtom(new Uint8Array(0));
  for (let i = atoms.length - 1; i >= 0; i--) {
    acc = treeHashPair(treeHashAtom(atoms[i]), acc);
  }
  return acc;
}
