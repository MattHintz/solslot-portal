/**
 * Complete single-owner vault puzzle commitment. Search hints never authorize
 * a vault. Keep this verifier identical in the coordinated customer/admin release.
 * Module hash: protocol vault_singleton_inner_v2.clsp, bound by the release sources.
 */
import { getBytes, hexlify, sha256 } from 'ethers';

export const VAULT_OWNER_MODULE_HASH =
  '0x104a7d0356d628b9073bf39f550a3b41163008381e2db3b8d2327ffe20216903';
export const VAULT_SINGLETON_MODULE_HASH =
  '0x7faa3253bfddd1e0decb0906b2dc6247bbc4cf608f58345d173adb63e8b47c9f';
export const VAULT_SINGLETON_LAUNCHER_HASH =
  '0xeff07522495060c066f66f32acc2a77e3a3e737aca8baea4d1a64ea4cdc13da9';
export const EMPTY_VAULT_IDENTITY_ROOT =
  '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a';

export interface VaultOwnerBinding {
  authType: 1 | 2 | 3;
  publicKey: string;
}
export interface VaultOwnerCoordinates {
  poolLauncherId: string;
  bridgePolicyHash: string;
}

function bytes32(value: string): Uint8Array {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid vault commitment.');
  return getBytes(value);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function atom(value: Uint8Array): Uint8Array {
  return getBytes(sha256(concat([Uint8Array.of(1), value])));
}
function pair(left: Uint8Array, right: Uint8Array): Uint8Array {
  return getBytes(sha256(concat([Uint8Array.of(2), left, right])));
}
function list(hashes: Uint8Array[]): Uint8Array {
  let result = atom(new Uint8Array());
  for (let i = hashes.length - 1; i >= 0; i--) result = pair(hashes[i], result);
  return result;
}
function curry(modHash: Uint8Array, args: Uint8Array[]): Uint8Array {
  const quote = atom(Uint8Array.of(1));
  let environment = quote;
  for (let i = args.length - 1; i >= 0; i--) {
    environment = list([atom(Uint8Array.of(4)), pair(quote, args[i]), environment]);
  }
  return list([atom(Uint8Array.of(2)), pair(quote, modHash), environment]);
}

export function canonicalOwnedVaultHash(
  launcherId: string,
  owner: VaultOwnerBinding,
  coordinates: VaultOwnerCoordinates,
  identityRoot: string,
): string {
  const lengths = { 1: 96, 2: 130, 3: 66 };
  if (![1, 2, 3].includes(owner.authType) || typeof owner.publicKey !== 'string' ||
      !new RegExp('^0x[0-9a-f]{' + lengths[owner.authType] + '}$', 'i').test(owner.publicKey)) {
    throw new Error('Reconnect the wallet to verify its vault owner key.');
  }
  const key = getBytes(owner.publicKey);
  if ((owner.authType === 2 && key[0] !== 4) ||
      (owner.authType === 3 && key[0] !== 2 && key[0] !== 3)) {
    throw new Error('Invalid vault owner key encoding.');
  }
  const singletonHash = bytes32(VAULT_SINGLETON_MODULE_HASH);
  const launcherHash = bytes32(VAULT_SINGLETON_LAUNCHER_HASH);
  const struct = pair(atom(singletonHash), pair(atom(bytes32(launcherId)), atom(launcherHash)));
  const inner = curry(bytes32(VAULT_OWNER_MODULE_HASH), [
    struct, atom(key), atom(Uint8Array.of(owner.authType)),
    atom(atom(key)), atom(bytes32(identityRoot)), atom(bytes32(coordinates.bridgePolicyHash)),
    atom(singletonHash), atom(bytes32(coordinates.poolLauncherId)), atom(launcherHash),
  ]);
  return hexlify(curry(singletonHash, [struct, inner]));
}

/**
 * Read possible 32-byte preimages without executing a provider program.
 * A candidate root is useful only if the complete independently constructed
 * vault puzzle matches the confirmed coin hash. Mere presence is not evidence.
 */
export function vaultRootCandidates(serialized: string): string[] {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(serialized) || serialized.length > 131074) {
    throw new Error('Vault proof is missing, malformed or too large.');
  }
  const bytes = getBytes(serialized);
  const roots = new Set<string>();
  const frames = [1];
  let offset = 0;
  let nodes = 0;
  while (frames.length) {
    if (++nodes > 32768 || frames.length > 512 || offset >= bytes.length) {
      throw new Error('Vault proof exceeds its structural limits.');
    }
    const prefix = bytes[offset++];
    frames[frames.length - 1]--;
    if (prefix === 255) {
      frames.push(2);
      continue;
    }
    let length = 0;
    if (prefix < 128) {
      // Single-byte atom already consumed.
    } else if (prefix === 128) {
      // Empty atom.
    } else {
      let mask = 128;
      let following = -1;
      while (prefix & mask) { following++; mask >>= 1; }
      if (following > 5 || mask === 0 || offset + following > bytes.length) {
        throw new Error('Invalid vault proof atom encoding.');
      }
      length = prefix & (mask - 1);
      for (let i = 0; i < following; i++) length = length * 256 + bytes[offset++];
      if (length > bytes.length - offset) throw new Error('Truncated vault proof atom.');
      if (length === 32) roots.add(hexlify(bytes.subarray(offset, offset + length)));
      offset += length;
    }
    while (frames.length && frames[frames.length - 1] === 0) frames.pop();
  }
  if (offset !== bytes.length || roots.size > 128) {
    throw new Error('Vault proof contains trailing data or too many candidate roots.');
  }
  return [...roots];
}
