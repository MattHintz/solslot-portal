import { Injectable } from '@angular/core';

const STORAGE_KEY = 'populis_zkpassport_proofs_v1';

export interface ZkPassportStoredProof {
  vaultLauncherId: string;
  vaultSubscope: string;
  identityAttestRoot: string;
  attestationLeafHash: string;
  attestationProof: {
    bitpath: number;
    siblings: string[];
  };
  bridgePolicyHash: string;
  bridgeMessage: string;
  enrolledAt: number;
}

export interface VaultAcceptOfferProofParams {
  identityAttestRoot: string;
  attestationLeafHash: string;
  attestationProof: {
    bitpath: number;
    siblings: string[];
  };
}

@Injectable({ providedIn: 'root' })
export class ZkPassportProofStoreService {
  save(proof: ZkPassportStoredProof): ZkPassportStoredProof {
    const normalized = normalizeProof(proof);
    const all = this.loadAll();
    all[normalized.vaultLauncherId.toLowerCase()] = normalized;
    this.persist(all);
    return normalized;
  }

  get(vaultLauncherId: string): ZkPassportStoredProof | null {
    return this.loadAll()[vaultLauncherId.toLowerCase()] ?? null;
  }

  clear(vaultLauncherId: string): void {
    const all = this.loadAll();
    delete all[vaultLauncherId.toLowerCase()];
    this.persist(all);
  }

  acceptOfferProofParams(vaultLauncherId: string): VaultAcceptOfferProofParams | null {
    const stored = this.get(vaultLauncherId);
    if (!stored) {
      return null;
    }
    return {
      identityAttestRoot: stored.identityAttestRoot,
      attestationLeafHash: stored.attestationLeafHash,
      attestationProof: stored.attestationProof,
    };
  }

  private loadAll(): Record<string, ZkPassportStoredProof> {
    if (typeof window === 'undefined') {
      return {};
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, ZkPassportStoredProof>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return {};
    }
  }

  private persist(all: Record<string, ZkPassportStoredProof>): void {
    if (typeof window === 'undefined') {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }
}

function normalizeProof(proof: ZkPassportStoredProof): ZkPassportStoredProof {
  const bitpath = Number(proof.attestationProof.bitpath);
  if (!Number.isInteger(bitpath) || bitpath < 0) {
    throw new Error(`attestationProof.bitpath must be a non-negative integer, got ${bitpath}`);
  }
  return {
    ...proof,
    vaultLauncherId: normalizeHex(proof.vaultLauncherId),
    identityAttestRoot: normalizeHex(proof.identityAttestRoot),
    attestationLeafHash: normalizeHex(proof.attestationLeafHash),
    bridgePolicyHash: normalizeHex(proof.bridgePolicyHash),
    bridgeMessage: normalizeHex(proof.bridgeMessage),
    attestationProof: {
      bitpath,
      siblings: proof.attestationProof.siblings.map(normalizeHex),
    },
  };
}

function normalizeHex(value: string): string {
  const out = value.startsWith('0x') || value.startsWith('0X') ? value.toLowerCase() : `0x${value.toLowerCase()}`;
  if (out.length < 3 || out.length % 2 !== 0 || !/^0x[0-9a-f]+$/.test(out)) {
    throw new Error(`invalid hex value: ${value}`);
  }
  return out;
}
