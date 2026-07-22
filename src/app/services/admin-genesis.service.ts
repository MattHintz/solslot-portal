import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { Eip712TypedData } from './solslot-api.service';

@Injectable({ providedIn: 'root' })
export class AdminGenesisService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.faucetApi}/admin/genesis`;

  createDraft(
    token: string,
    sourceShas: GenesisSourceShas,
    reviewClass: GenesisReviewClass = 'internal-engineering-testnet',
  ): Promise<GenesisCeremony> {
    return this.adminPost<GenesisCeremony>('/drafts', token, {
      sourceShas,
      reviewClass,
    });
  }

  getCeremony(token: string, ceremonyId: string): Promise<GenesisCeremony> {
    return firstValueFrom(
      this.http.get<GenesisCeremony>(`${this.base}/${normalizeCeremonyId(ceremonyId)}`, {
        headers: authHeaders(token),
      }),
    );
  }

  issueInvitation(token: string, ceremonyId: string, slot: number): Promise<GenesisInvitation> {
    return this.adminPost<GenesisInvitation>(
      `/${normalizeCeremonyId(ceremonyId)}/invitations/${slot}`,
      token,
      {},
    );
  }

  prepareInvitation(invitationToken: string, wallet: string): Promise<GenesisTypedAction> {
    return firstValueFrom(
      this.http.post<GenesisTypedAction>(`${this.base}/invitations/prepare`, {
        token: invitationToken,
        wallet,
      }),
    );
  }

  acceptInvitation(
    invitationToken: string,
    wallet: string,
    signature: string,
  ): Promise<GenesisInvitationAcceptance> {
    return firstValueFrom(
      this.http.post<GenesisInvitationAcceptance>(`${this.base}/invitations/accept`, {
        token: invitationToken,
        wallet,
        signature,
      }),
    );
  }

  freezeRoster(token: string, ceremonyId: string): Promise<GenesisCeremony> {
    return this.adminPost<GenesisCeremony>(
      `/${normalizeCeremonyId(ceremonyId)}/roster/freeze`,
      token,
      {},
    );
  }

  createPlan(
    token: string,
    ceremonyId: string,
    plan: GenesisPlanInput,
  ): Promise<GenesisPlanAction> {
    return this.adminPost<GenesisPlanAction>(
      `/${normalizeCeremonyId(ceremonyId)}/plan`,
      token,
      plan,
    );
  }

  signPlan(ceremonyId: string, slot: number, signature: string): Promise<GenesisCeremony> {
    return firstValueFrom(
      this.http.post<GenesisCeremony>(
        `${this.base}/${normalizeCeremonyId(ceremonyId)}/plan/signatures`,
        { slot, signature },
      ),
    );
  }

  preparePlanSignature(ceremonyId: string, slot: number): Promise<GenesisSignatureAction> {
    return firstValueFrom(
      this.http.post<GenesisSignatureAction>(
        `${this.base}/${normalizeCeremonyId(ceremonyId)}/plan/signatures/prepare`,
        { slot },
      ),
    );
  }

  preflight(token: string, ceremonyId: string): Promise<GenesisPreflight> {
    return this.adminPost<GenesisPreflight>(
      `/${normalizeCeremonyId(ceremonyId)}/preflight`,
      token,
      {},
    );
  }

  broadcast(token: string, ceremonyId: string): Promise<GenesisCeremony> {
    return this.adminPost<GenesisCeremony>(
      `/${normalizeCeremonyId(ceremonyId)}/broadcast`,
      token,
      {},
    );
  }

  confirm(token: string, ceremonyId: string): Promise<GenesisCeremony> {
    return this.adminPost<GenesisCeremony>(
      `/${normalizeCeremonyId(ceremonyId)}/confirmation`,
      token,
      {},
    );
  }

  createArtifact(token: string, ceremonyId: string): Promise<GenesisArtifactAction> {
    return this.adminPost<GenesisArtifactAction>(
      `/${normalizeCeremonyId(ceremonyId)}/artifact`,
      token,
      {},
    );
  }

  signArtifact(ceremonyId: string, slot: number, signature: string): Promise<GenesisCeremony> {
    return firstValueFrom(
      this.http.post<GenesisCeremony>(
        `${this.base}/${normalizeCeremonyId(ceremonyId)}/artifact/signatures`,
        { slot, signature },
      ),
    );
  }

  prepareArtifactSignature(ceremonyId: string, slot: number): Promise<GenesisSignatureAction> {
    return firstValueFrom(
      this.http.post<GenesisSignatureAction>(
        `${this.base}/${normalizeCeremonyId(ceremonyId)}/artifact/signatures/prepare`,
        { slot },
      ),
    );
  }

  finalize(token: string, ceremonyId: string): Promise<GenesisFinalizeResult> {
    return this.adminPost<GenesisFinalizeResult>(
      `/${normalizeCeremonyId(ceremonyId)}/finalize`,
      token,
      {},
    );
  }

  abandon(token: string, ceremonyId: string, reason: string): Promise<GenesisCeremony> {
    return this.adminPost<GenesisCeremony>(`/${normalizeCeremonyId(ceremonyId)}/abandon`, token, {
      reason,
    });
  }

  private adminPost<T>(path: string, token: string, body: unknown): Promise<T> {
    return firstValueFrom(
      this.http.post<T>(`${this.base}${path}`, body, { headers: authHeaders(token) }),
    );
  }
}

export interface GenesisSourceShas {
  protocol: string;
  evm: string;
  omnichain: string;
  api: string;
  legacyBackend: string;
  keyOfSolomon: string;
  samuel: string;
  customerWeb: string;
  adminPortal: string;
}

export interface GenesisCeremony {
  ceremony_id: string;
  state: string;
  network: string;
  evm_chain_id: number;
  source_shas: GenesisSourceShas;
  invitations: GenesisAdminSlot[];
  roster_hash?: string | null;
  plan_hash?: string | null;
  plan_signatures?: GenesisSignature[];
  spend_bundle_id?: string | null;
  confirmed_block_index?: number | null;
  artifact_hash?: string | null;
  artifact_signatures?: GenesisSignature[];
  abandoned_reason?: string | null;
}

export interface GenesisAdminSlot {
  slot: number;
  wallet_address?: string | null;
  compressed_pubkey?: string | null;
  expires_at?: number | null;
  consumed_at?: number | null;
}

export interface GenesisSignature {
  slot: number;
  compressed_pubkey: string;
  signature: string;
}

export interface GenesisInvitation {
  ceremonyId: string;
  slot: number;
  expiresAt: number;
  invitationFragment: string;
}

export interface GenesisInvitationAcceptance {
  ceremonyId: string;
  slot: number;
  enrolled: boolean;
  state: string;
}

export interface GenesisTypedAction {
  ceremonyId: string;
  slot: number;
  expiresAt: number;
  typedData: Eip712TypedData;
}

export interface GenesisSignatureAction {
  ceremonyId: string;
  slot: number;
  typedData: Eip712TypedData;
}

export interface GenesisPlanAction {
  ceremony: GenesisCeremony;
  typedData: Eip712TypedData;
}

export interface GenesisArtifactAction {
  ceremony: GenesisCeremony;
  typedData: Eip712TypedData;
}

export interface GenesisPreflight {
  ready: boolean;
  ceremonyId: string;
  planHash: string;
  spendBundleId: string;
  spendCount: number;
  reviewClass: GenesisReviewClass;
  auditStatus: 'independently-reviewed' | 'unaudited';
  auditApprovalHash: string;
}

export type GenesisReviewClass = 'independent-release-review' | 'internal-engineering-testnet';

export interface GenesisFinalizeResult {
  locked: boolean;
  artifactHash: string;
  publicArtifactPath: string;
  bootstrapLockPath: string;
  ceremony: GenesisCeremony;
}

export type GenesisPlanInput = Record<string, unknown>;

function authHeaders(token: string): HttpHeaders {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('admin genesis: operator token is required');
  return new HttpHeaders({ Authorization: `Bearer ${trimmed}` });
}

function normalizeCeremonyId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('admin genesis: ceremony ID must be a 32-byte 0x hex value');
  }
  return normalized;
}
