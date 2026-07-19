import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { computeAddress, SigningKey, verifyTypedData } from 'ethers';
import { environment } from '../../environments/environment';
import { Eip712TypedData } from './solslot-api.service';
import { SolslotProtocolArtifactService } from './solslot-protocol-artifact.service';
import { AdminBackendAuthService } from './admin-backend-auth.service';

/** Lowercase V2 key intentionally ignores every pre-ceremony session. */
const STORAGE_KEY = 'solslot_admin_session_v2';

const ADMIN_LOGIN_TYPES = [
  { name: 'owner', type: 'address' },
  { name: 'nonce', type: 'bytes32' },
  { name: 'issuedAt', type: 'uint256' },
  { name: 'authType', type: 'string' },
  { name: 'scope', type: 'string' },
] as const;

const EIP712_DOMAIN_TYPES = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
] as const;

/**
 * Tab-scoped administrator session backed by a canonical EIP-712 envelope.
 * Every login and restore rechecks the signature, connected key, signed V2
 * artifact hash, three-member genesis roster, and bounded expiry. Browser
 * storage is a convenience cache and never establishes authority by itself.
 */
@Injectable({ providedIn: 'root' })
export class AdminSessionService implements OnDestroy {
  static readonly MAX_SESSION_SECONDS = 12 * 60 * 60;

  private readonly router = inject(Router);
  private readonly protocolArtifact = inject(SolslotProtocolArtifactService);
  private readonly backendAuth = inject(AdminBackendAuthService);
  private readonly _state = signal<AdminSessionState>(this.load());
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  readonly state = this._state.asReadonly();
  readonly isAuthenticated = computed(() => this._state().kind === 'authenticated');
  readonly subject = computed(() => {
    const state = this._state();
    return state.kind === 'authenticated' ? state.address : null;
  });
  readonly pubkey = computed(() => {
    const state = this._state();
    return state.kind === 'authenticated' ? state.pubkey : null;
  });
  readonly expiresAt = computed(() => {
    const state = this._state();
    return state.kind === 'authenticated' ? state.expiresAt : null;
  });
  readonly jwt = computed(() => {
    const state = this._state();
    return state.kind === 'authenticated' ? state.jwt : null;
  });

  constructor() {
    const state = this._state();
    if (state.kind === 'authenticated') {
      this.scheduleExpiry(state.expiresAt);
      this.scheduleRefresh(state.expiresAt);
    }
  }

  ngOnDestroy(): void {
    this.clearExpiryTimer();
    this.clearRefreshTimer();
  }

  /** Verify a wallet-signed envelope before creating a local UI session. */
  async loginWithWallet(opts: WalletLoginOptions): Promise<string> {
    const verified = this.verifyEnvelope(opts);
    this.beginSession({
      address: verified.address,
      pubkey: verified.pubkey,
      expiresAt: opts.expiresAt,
      signatureKind: 'eip712',
      signature: opts.signature,
      typedData: opts.typedData,
      jwt: opts.jwt,
    });
    return verified.address;
  }

  /** Clear all tab-scoped administrator state. */
  logout(): void {
    this._state.set({ kind: 'anonymous' });
    this.clearExpiryTimer();
    this.clearRefreshTimer();
    if (typeof window !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
  }

  logoutAndRedirect(): void {
    this.logout();
    this.router.navigate(['/admin/login']);
  }

  /** Revalidate the complete envelope before a privileged UI operation. */
  requireSession(): AuthenticatedAdminState {
    const state = this._state();
    if (state.kind !== 'authenticated') {
      throw new Error('No active admin session - login first.');
    }
    try {
      this.verifyEnvelope(state);
      return state;
    } catch (error) {
      this.logout();
      throw error;
    }
  }

  requireJwt(): string {
    return this.requireSession().jwt;
  }

  private beginSession(state: Omit<AuthenticatedAdminState, 'kind'>): void {
    const authenticated: AuthenticatedAdminState = {
      kind: 'authenticated',
      ...state,
    };
    this._state.set(authenticated);
    this.persist(authenticated);
    this.scheduleExpiry(authenticated.expiresAt);
    this.scheduleRefresh(authenticated.expiresAt);
  }

  private persist(state: AuthenticatedAdminState): void {
    if (typeof window === 'undefined') return;
    const persisted: PersistedAdminSession = {
      schemaVersion: 3,
      protocolVersion: environment.protocolVersion,
      network: 'testnet11',
      address: state.address,
      pubkey: state.pubkey,
      expiresAt: state.expiresAt,
      signatureKind: 'eip712',
      signature: state.signature,
      typedData: state.typedData,
      jwt: state.jwt,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }

  /** Restore only a complete envelope that still verifies now. */
  private load(): AdminSessionState {
    if (typeof window === 'undefined') return { kind: 'anonymous' };
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { kind: 'anonymous' };

    try {
      const parsed = JSON.parse(raw) as PersistedAdminSession;
      if (
        parsed.schemaVersion !== 3 ||
        parsed.protocolVersion !== environment.protocolVersion ||
        parsed.network !== 'testnet11' ||
        parsed.signatureKind !== 'eip712' ||
        !parsed.typedData
      ) {
        throw new Error('Administrator session schema mismatch.');
      }
      const verified = this.verifyEnvelope(parsed);
      return {
        kind: 'authenticated',
        address: verified.address,
        pubkey: verified.pubkey,
        expiresAt: parsed.expiresAt,
        signatureKind: 'eip712',
        signature: parsed.signature,
        typedData: parsed.typedData,
        jwt: parsed.jwt,
      };
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
      return { kind: 'anonymous' };
    }
  }

  private verifyEnvelope(input: EnvelopeFields): {
    address: string;
    pubkey: string;
  } {
    const artifact = this.protocolArtifact.artifact;
    if (!this.protocolArtifact.isReady || !artifact) {
      throw new Error(this.protocolArtifact.failure);
    }

    const nowSec = Math.floor(Date.now() / 1_000);
    if (
      !Number.isInteger(input.expiresAt) ||
      input.expiresAt <= nowSec ||
      input.expiresAt > nowSec + AdminSessionService.MAX_SESSION_SECONDS
    ) {
      throw new Error('Administrator session expiry is invalid.');
    }

    const typedData = input.typedData;
    if (
      typedData.primaryType !== 'SolslotAdminLogin' ||
      !sameKeys(typedData.domain, ['chainId', 'name', 'version']) ||
      typedData.domain.name !== 'Solslot Protocol' ||
      typedData.domain.version !== '2' ||
      typedData.domain.chainId !== 11155111 ||
      !sameKeys(typedData.types, ['EIP712Domain', 'SolslotAdminLogin']) ||
      JSON.stringify(typedData.types['EIP712Domain']) !==
        JSON.stringify(EIP712_DOMAIN_TYPES) ||
      JSON.stringify(typedData.types['SolslotAdminLogin']) !==
        JSON.stringify(ADMIN_LOGIN_TYPES) ||
      !sameKeys(typedData.message, ['authType', 'issuedAt', 'nonce', 'owner', 'scope']) ||
      normalizeAddress(String(typedData.message['owner'] || '')) !==
        normalizeAddress(input.address) ||
      !/^0x[0-9a-f]{64}$/i.test(String(typedData.message['nonce'] || '')) ||
      !Number.isInteger(Number(typedData.message['issuedAt'])) ||
      Number(typedData.message['issuedAt']) > nowSec + 30 ||
      Number(typedData.message['issuedAt']) < nowSec - 10 * 60 ||
      typedData.message['authType'] !== 'evm' ||
      typedData.message['scope'] !== 'admin' ||
      !/^0x[0-9a-f]{130}$/i.test(input.signature)
    ) {
      throw new Error('Administrator login envelope is invalid.');
    }

    const address = normalizeAddress(input.address);
    const pubkey = normalizePubkey(input.pubkey);
    const derivedAddress = computeAddress(
      SigningKey.computePublicKey(pubkey, false),
    ).toLowerCase();
    if (derivedAddress !== address) {
      throw new Error('Administrator key does not match the connected wallet.');
    }

    const types = Object.fromEntries(
      Object.entries(typedData.types).filter(([name]) => name !== 'EIP712Domain'),
    );
    const recovered = verifyTypedData(
      typedData.domain,
      types,
      typedData.message,
      input.signature,
    ).toLowerCase();
    if (recovered !== address) {
      throw new Error('Administrator login signature is invalid.');
    }

    if (
      !this.protocolArtifact.adminRoster.some(
        (candidate) => candidate.toLowerCase() === pubkey,
      )
    ) {
      throw new Error('Administrator key is not in the signed genesis roster.');
    }
    const jwtPayload = decodeJwtPayload(input.jwt);
    if (
      String(jwtPayload['sub'] || '').toLowerCase() !== address ||
      jwtPayload['scope'] !== 'admin' ||
      jwtPayload['auth_type'] !== 'evm' ||
      Number(jwtPayload['exp']) !== input.expiresAt
    ) {
      throw new Error('Administrator API session does not match the signed wallet.');
    }
    return { address, pubkey };
  }

  private scheduleExpiry(expiresAt: number): void {
    this.clearExpiryTimer();
    const delay = Math.max(0, expiresAt * 1_000 - Date.now());
    this.expiryTimer = setTimeout(() => this.logout(), delay);
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private scheduleRefresh(expiresAt: number): void {
    this.clearRefreshTimer();
    const delay = Math.max(1_000, expiresAt * 1_000 - Date.now() - 60_000);
    this.refreshTimer = setTimeout(() => void this.refreshApiSession(), delay);
  }

  private async refreshApiSession(): Promise<void> {
    const state = this._state();
    if (state.kind !== 'authenticated') return;
    try {
      const refreshed = await this.backendAuth.refresh(state.jwt);
      const next: AuthenticatedAdminState = {
        ...state,
        jwt: refreshed.jwt,
        expiresAt: refreshed.expires_at,
      };
      this.verifyEnvelope(next);
      this._state.set(next);
      this.persist(next);
      this.scheduleExpiry(next.expiresAt);
      this.scheduleRefresh(next.expiresAt);
    } catch {
      this.logout();
    }
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

export interface WalletLoginOptions extends EnvelopeFields {
  signatureKind: 'eip712';
}

export type AdminSessionState = { kind: 'anonymous' } | AuthenticatedAdminState;

export interface AuthenticatedAdminState extends EnvelopeFields {
  kind: 'authenticated';
  signatureKind: 'eip712';
}

interface PersistedAdminSession extends EnvelopeFields {
  schemaVersion: 3;
  protocolVersion: 'solslot-v2';
  network: 'testnet11';
  signatureKind: 'eip712';
}

interface EnvelopeFields {
  address: string;
  pubkey: string;
  expiresAt: number;
  signature: string;
  typedData: Eip712TypedData;
  jwt: string;
}

function normalizeAddress(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error('Administrator wallet address is invalid.');
  }
  return normalized;
}

function normalizePubkey(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^0x(?:02|03)[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('Administrator compressed public key is invalid.');
  }
  return normalized;
}

function sameKeys(
  value: Record<string, unknown>,
  expected: ReadonlyArray<string>,
): boolean {
  return JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort());
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Administrator API session is malformed.');
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('payload is not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('Administrator API session payload is malformed.');
  }
}
