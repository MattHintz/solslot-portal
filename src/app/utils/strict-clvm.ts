/** Bounded canonical CLVM data parsing. No evaluation or signing authority. */
import { getBytes, hexlify, sha256 } from 'ethers';

export type ClvmData = { readonly atom: Uint8Array; readonly hash: string } |
  { readonly left: ClvmData; readonly right: ClvmData; readonly hash: string };
export const MAX_PROGRAM_BYTES = 131072;
const MAX_NODES = 65536;
const MAX_DEPTH = 1024;
const U64_MAX = (1n << 64n) - 1n;

export function requireEvidence(value: unknown, message: string): asserts value {
  if (!value) throw new Error('Swap evidence: ' + message);
}
export function strictHex(value: unknown, bytes?: number): string {
  requireEvidence(typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/.test(value), 'noncanonical hex');
  requireEvidence(value.length <= 2 + MAX_PROGRAM_BYTES * 2 &&
    (bytes === undefined || value.length === 2 + bytes * 2), 'hex length');
  return value;
}
export function uint64(value: unknown): bigint {
  requireEvidence(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value), 'canonical uint64 string required');
  const result = BigInt(value);
  requireEvidence(result <= U64_MAX, 'uint64 overflow');
  return result;
}
export function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
export function uintAtom(value: bigint): Uint8Array {
  requireEvidence(value >= 0n && value <= U64_MAX, 'integer outside uint64');
  if (value === 0n) return new Uint8Array();
  let h = value.toString(16); if (h.length % 2) h = '0' + h;
  if (parseInt(h.slice(0, 2), 16) >= 128) h = '00' + h;
  return getBytes('0x' + h);
}
export function atom(bytes: Uint8Array): ClvmData {
  return { atom: bytes, hash: sha256(joinBytes([Uint8Array.of(1), bytes])) };
}
export function pair(left: ClvmData, right: ClvmData): ClvmData {
  return { left, right, hash: sha256(joinBytes([Uint8Array.of(2), getBytes(left.hash), getBytes(right.hash)])) };
}
export function list(values: readonly ClvmData[]): ClvmData {
  let result = atom(new Uint8Array());
  for (let i = values.length - 1; i >= 0; i--) result = pair(values[i], result);
  return result;
}
export function asAtom(node: ClvmData): Uint8Array {
  requireEvidence('atom' in node, 'expected atom'); return node.atom;
}
export function asList(node: ClvmData, maximum = 1024): ClvmData[] {
  const result: ClvmData[] = [];
  while (!('atom' in node)) {
    requireEvidence(result.length < maximum, 'list exceeds bound');
    result.push(node.left); node = node.right;
  }
  requireEvidence(node.atom.length === 0, 'expected proper list'); return result;
}
export function asUint(node: ClvmData): bigint {
  const bytes = asAtom(node);
  requireEvidence(bytes.length <= 9 && (!bytes.length || bytes[0] < 128), 'invalid unsigned CLVM integer');
  const value = bytes.length ? BigInt(hexlify(bytes)) : 0n;
  requireEvidence(value <= U64_MAX && hexlify(uintAtom(value)) === hexlify(bytes), 'noncanonical CLVM integer');
  return value;
}
export function parseClvm(encoded: unknown): ClvmData {
  const bytes = getBytes(strictHex(encoded));
  requireEvidence(bytes.length > 0, 'empty program');
  const frames: Array<{left?: ClvmData}> = [];
  let offset = 0, nodes = 0;
  while (offset < bytes.length) {
    requireEvidence(++nodes <= MAX_NODES, 'program node bound');
    const prefix = bytes[offset++];
    if (prefix === 255) {
      requireEvidence(frames.length < MAX_DEPTH, 'program depth bound'); frames.push({}); continue;
    }
    let data: Uint8Array;
    if (prefix < 128) data = Uint8Array.of(prefix);
    else if (prefix === 128) data = new Uint8Array();
    else {
      // No backreferences, reserved prefixes or non-minimal length aliases.
      requireEvidence(prefix < 240, 'unsupported atom encoding');
      const extra = prefix < 192 ? 0 : prefix < 224 ? 1 : 2;
      let length = prefix & (extra === 0 ? 63 : extra === 1 ? 31 : 15);
      requireEvidence(offset + extra <= bytes.length, 'truncated atom header');
      for (let i = 0; i < extra; i++) length = length * 256 + bytes[offset++];
      requireEvidence(length >= (extra === 0 ? 1 : extra === 1 ? 64 : 8192) &&
        length <= bytes.length - offset, 'noncanonical or truncated atom');
      data = bytes.subarray(offset, offset + length); offset += length;
      requireEvidence(length !== 1 || data[0] >= 128, 'noncanonical single-byte atom');
    }
    let node = atom(data);
    while (frames.length && frames[frames.length - 1].left) {
      node = pair(frames.pop()!.left!, node);
    }
    if (frames.length) frames[frames.length - 1].left = node;
    else { requireEvidence(offset === bytes.length, 'trailing CLVM data'); return node; }
  }
  throw new Error('Swap evidence: incomplete CLVM pair');
}
export function serializeClvmData(node: ClvmData): Uint8Array {
  const parts: Uint8Array[] = [];
  const visit = (n: ClvmData): void => {
    if (!('atom' in n)) { parts.push(Uint8Array.of(255)); visit(n.left); visit(n.right); return; }
    const b = n.atom, length = b.length;
    requireEvidence(length <= MAX_PROGRAM_BYTES, 'atom exceeds bound');
    if (!length) parts.push(Uint8Array.of(128));
    else if (length === 1 && b[0] < 128) parts.push(b);
    else {
      parts.push(length < 64 ? Uint8Array.of(128 | length) : length < 8192 ?
        Uint8Array.of(192 | (length >> 8), length & 255) :
        Uint8Array.of(224 | (length >> 16), (length >> 8) & 255, length & 255));
      parts.push(b);
    }
  };
  visit(node); return joinBytes(parts);
}
export function uncurry(node: ClvmData): {module: ClvmData; args: ClvmData[]} {
  const outer = asList(node, 3);
  requireEvidence(outer.length === 3 && asUint(outer[0]) === 2n && !('atom' in outer[1]) &&
    asUint(outer[1].left) === 1n, 'expected canonical curry');
  const module = outer[1].right, args: ClvmData[] = [];
  let env = outer[2];
  while (!('atom' in env)) {
    const fields = asList(env, 3);
    requireEvidence(fields.length === 3 && asUint(fields[0]) === 4n && !('atom' in fields[1]) &&
      asUint(fields[1].left) === 1n && args.length < 32, 'invalid curry arguments');
    args.push(fields[1].right); env = fields[2];
  }
  requireEvidence(asUint(env) === 1n, 'invalid curry environment'); return {module, args};
}
