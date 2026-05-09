import { Injectable } from '@angular/core';
import { sha256 } from 'ethers';

import { bytesToHex, hexToBytes } from '../utils/chia-hash';

export const ZKPASSPORT_ATTEST_DOMAIN = 'populis-zkpassport-vault-attestation-v1';
export const ZKPASSPORT_POLICY_VERSION = 1;
export const ZKPASSPORT_SCOPE = 'populis.app';
export const ZKPASSPORT_EMPTY_ATTEST_ROOT =
  '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a';

export interface ZkPassportAttestationInput {
  vaultLauncherId: string | Uint8Array;
  scopedNullifier: string | Uint8Array;
  nullifierType: number;
  serviceScopeHash: string | Uint8Array;
  serviceSubscopeHash: string | Uint8Array;
  proofTimestamp: number;
  policyVersion?: number;
}

export interface ZkPassportMerkleProof {
  bitpath: number;
  siblings: Array<string | Uint8Array>;
}

export interface AttestationBridgeMessageInput {
  vaultLauncherId: string | Uint8Array;
  attestationRoot: string | Uint8Array;
  bridgePolicyHash: string | Uint8Array;
  policyVersion?: number;
}

@Injectable({ providedIn: 'root' })
export class ZkPassportAttestationService {
  computeVaultSubscope(vaultLauncherId: string | Uint8Array): string {
    const launcher = bytes32(vaultLauncherId, 'vaultLauncherId');
    return `vault:0x${bytesToHex(launcher).slice(2)}`;
  }

  computeAttestationLeaf(input: ZkPassportAttestationInput): string {
    const policyVersion = input.policyVersion ?? ZKPASSPORT_POLICY_VERSION;
    assertUint(policyVersion, 0xffff, 'policyVersion');
    assertUint(input.nullifierType, 0xffff, 'nullifierType');
    assertUint(input.proofTimestamp, Number.MAX_SAFE_INTEGER, 'proofTimestamp');
    const hashes = [
      treeHashAtom(new TextEncoder().encode(ZKPASSPORT_ATTEST_DOMAIN)),
      treeHashAtom(uintAtom(policyVersion)),
      treeHashAtom(bytes32(input.vaultLauncherId, 'vaultLauncherId')),
      treeHashAtom(bytes32(input.scopedNullifier, 'scopedNullifier')),
      treeHashAtom(uintAtom(input.nullifierType)),
      treeHashAtom(bytes32(input.serviceScopeHash, 'serviceScopeHash')),
      treeHashAtom(bytes32(input.serviceSubscopeHash, 'serviceSubscopeHash')),
      treeHashAtom(uintAtom(input.proofTimestamp)),
    ];
    return bytesToHex(treeHashListFromHashes(hashes));
  }

  computeAttestationRoot(leaves: Array<string | Uint8Array>): string {
    if (leaves.length === 0) {
      return ZKPASSPORT_EMPTY_ATTEST_ROOT;
    }
    let level = leaves.map((leaf, index) => bytes32(leaf, `leaf[${index}]`));
    while (level.length > 1) {
      if (level.length % 2 === 1) {
        level = [...level, level[level.length - 1]];
      }
      const next: Uint8Array[] = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(combineMerkleNodes(level[i], level[i + 1]));
      }
      level = next;
    }
    return bytesToHex(level[0]);
  }

  computeAttestationBridgeMessage(input: AttestationBridgeMessageInput): string {
    const policyVersion = input.policyVersion ?? ZKPASSPORT_POLICY_VERSION;
    assertUint(policyVersion, 0xffff, 'policyVersion');
    const hashes = [
      treeHashAtom(new TextEncoder().encode(ZKPASSPORT_ATTEST_DOMAIN)),
      treeHashAtom(uintAtom(policyVersion)),
      treeHashAtom(bytes32(input.vaultLauncherId, 'vaultLauncherId')),
      treeHashAtom(bytes32(input.attestationRoot, 'attestationRoot')),
      treeHashAtom(bytes32(input.bridgePolicyHash, 'bridgePolicyHash')),
    ];
    return bytesToHex(treeHashListFromHashes(hashes));
  }

  singleLeafProof(): ZkPassportMerkleProof {
    return { bitpath: 0, siblings: [] };
  }

  verifyMerkleProof(
    leafHash: string | Uint8Array,
    root: string | Uint8Array,
    proof: ZkPassportMerkleProof,
  ): boolean {
    let acc = bytes32(leafHash, 'leafHash');
    let remaining = proof.bitpath;
    if (!Number.isInteger(remaining) || remaining < 0) {
      throw new Error(`bitpath must be a non-negative integer, got ${proof.bitpath}`);
    }
    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = bytes32(proof.siblings[i], `sibling[${i}]`);
      if (remaining & 1) {
        acc = combineMerkleNodes(sibling, acc);
      } else {
        acc = combineMerkleNodes(acc, sibling);
      }
      remaining = Math.floor(remaining / 2);
    }
    return bytesToHex(acc) === bytesToHex(bytes32(root, 'root'));
  }
}

function treeHashListFromHashes(itemHashes: Uint8Array[]): Uint8Array {
  let acc = treeHashAtom(new Uint8Array());
  for (let i = itemHashes.length - 1; i >= 0; i--) {
    acc = treeHashPair(itemHashes[i], acc);
  }
  return acc;
}

function treeHashAtom(atom: Uint8Array): Uint8Array {
  return digest(concatBytes(new Uint8Array([1]), atom));
}

function treeHashPair(leftHash: Uint8Array, rightHash: Uint8Array): Uint8Array {
  return digest(concatBytes(new Uint8Array([2]), leftHash, rightHash));
}

function combineMerkleNodes(left: Uint8Array, right: Uint8Array): Uint8Array {
  return digest(concatBytes(new Uint8Array([2]), left, right));
}

function digest(bytes: Uint8Array): Uint8Array {
  return hexToBytes(sha256(bytes));
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function bytes32(input: string | Uint8Array, name: string): Uint8Array {
  const bytes = input instanceof Uint8Array ? input : hexToBytes(input);
  if (bytes.length !== 32) {
    throw new Error(`${name} must be 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

function uintAtom(value: number): Uint8Array {
  assertUint(value, Number.MAX_SAFE_INTEGER, 'value');
  if (value === 0) {
    return new Uint8Array();
  }
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  if (bytes[0] & 0x80) {
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

function assertUint(value: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${name} must be an unsigned integer <= ${max}, got ${value}`);
  }
}
