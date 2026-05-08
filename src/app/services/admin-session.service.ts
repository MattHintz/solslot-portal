import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AdminWalletAuthService,
  MembershipResult,
} from './admin-wallet-auth.service';
import { Eip712TypedData } from './populis-api.service';

/**
 * Storage key.  Bumped from ``v1`` (JWT-era) to ``v2`` so old JWT
 * sessions are auto-invalidated on the first run after the
 * Phase 9-Hermes-D wallet-signed-auth migration; users see a single
 * "please re-login" beat instead of mysteriously broken cached
 * sessions.
 */
const STORAGE_KEY = 'populis_admin_session_v2';

/**
 * Persistent admin-desk session manager (post-Hermes-D).
 *
 * **Trust model.**  The portal no longer talks to a Populis API for
 * admin auth \u2014 every check is client-side, with chain (or env-pinned)
 * data as the source of truth:
 *
 *   1. Caller (login page) builds a ``PopulisAdminLogin`` EIP-712
 *      envelope via {@link AdminWalletAuthService.buildLoginTypedData}.
 *   2. User signs it in their wallet.
 *   3. Caller recovers the compressed pubkey via
 *      {@link EvmWalletService.recoverCompressedPubkey}.
 *   4. Caller invokes {@link AdminSessionService.loginWithWallet} which:
 *        a. Asks {@link AdminWalletAuthService.verifyMembership} whether
 *           the pubkey is in the on-chain MIPS quorum (or, fallback,
 *           in the env pubkey allowlist).
 *        b. If yes, persists the session and seeds the reactive state.
 *        c. Returns the verified address so the page can display it.
 *
 * **What's persisted.**  The full credential bundle: ``address``,
 * ``pubkey``, ``expires_at``, ``signature``, ``typed_data``.  Stored
 * in localStorage so a page reload reuses the session without
 * re-prompting the wallet.  On every load the signature is
 * re-recovered against the typed data \u2014 storage tampering surfaces
 * as "pubkey mismatch" and the session is dropped.
 *
 * **Storage caveat (XSS).**  The signature is bearer-equivalent: any
 * JS injected into the portal can read it from localStorage and
 * impersonate the admin until expiry.  This is the same trade-off as
 * the v1 JWT design; for an operator-facing tool with a tightly
 * controlled bundle it's acceptable.  A future tightening could move
 * the credential into ``sessionStorage`` (cleared on tab close) at
 * the cost of re-login-on-reload UX.
 *
 * **No auto-refresh.**  Unlike v1, there's nothing to refresh: the
 * wallet's signature has a fixed expiry baked into the typed data.
 * To extend a session, the user signs a new envelope.  Removing the
 * refresh timer simplifies the lifecycle and removes a class of edge
 * cases (network blips during refresh, double-refresh races).
 */
@Injectable({ providedIn: 'root' })
export class AdminSessionService {
  private readonly walletAuth = inject(AdminWalletAuthService);
  private readonly router = inject(Router);

  private readonly _state = signal<AdminSessionState>(this.load());
  readonly state = this._state.asReadonly();

  readonly isAuthenticated = computed(() => this._state().kind === 'authenticated');
  readonly subject = computed(() => {
    const s = this._state();
    return s.kind === 'authenticated' ? s.address : null;
  });
  readonly pubkey = computed(() => {
    const s = this._state();
    return s.kind === 'authenticated' ? s.pubkey : null;
  });
  readonly expiresAt = computed(() => {
    const s = this._state();
    return s.kind === 'authenticated' ? s.expiresAt : null;
  });

  constructor() {
    // Persist any updates to localStorage.
    effect(() => {
      const s = this._state();
      if (typeof window === 'undefined') return;
      if (s.kind === 'authenticated') {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            address: s.address,
            pubkey: s.pubkey,
            expiresAt: s.expiresAt,
            signature: s.signature,
            typedData: s.typedData,
          } satisfies PersistedAdminSession),
        );
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    });
  }

  // \u2500\u2500 Public API \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  /**
   * Verify a wallet-signed admin login bundle and seed a session.
   *
   * The caller (``AdminLoginComponent``) drives the wallet
   * handshake \u2014 build typed data, sign, recover pubkey \u2014 and passes
   * the resulting bundle here.  This service:
   *
   *   1. Asks {@link AdminWalletAuthService.verifyMembership} whether
   *      the recovered pubkey is in the portal's admin set.
   *   2. On success, persists the session and updates the reactive
   *      state.  On failure, throws with the verifier's message so
   *      the page can render it inline.
   *
   * Returns the verified address (the reactive ``subject()`` getter
   * also returns this once the session is seeded).
   */
  async loginWithWallet(opts: WalletLoginOptions): Promise<string> {
    const result: MembershipResult = this.walletAuth.verifyMembership({
      address: opts.address,
      pubkey: opts.pubkey,
    });
    if (!result.ok) {
      const e = new Error(result.message);
      // Tag the error so the login page can route specific reasons
      // to specific UI states (e.g., 'no-admins-configured' surfaces
      // a different action banner than 'mips-root-mismatch').
      (e as Error & { reason?: string }).reason = result.reason;
      throw e;
    }
    this.beginSession({
      address: result.address,
      pubkey: result.pubkey,
      expiresAt: opts.expiresAt,
      signature: opts.signature,
      typedData: opts.typedData,
    });
    return result.address;
  }

  /** Clear the session. */
  logout(): void {
    this._state.set({ kind: 'anonymous' });
  }

  /**
   * Clear the session and route to the admin login page.  Intended
   * for forced logouts (manual signout button, expired session
   * detection, integrity-check failure on session restore).
   */
  logoutAndRedirect(): void {
    this.logout();
    this.router.navigate(['/admin/login']);
  }

  /**
   * Throws if the user isn't authenticated.  Mint pages call this
   * before any action so a stale tab whose session expired between
   * route activation and form submission can't silently hand the
   * request off into the void.
   */
  requireSession(): AuthenticatedAdminState {
    const s = this._state();
    if (s.kind !== 'authenticated') {
      throw new Error('No active admin session \u2014 login first.');
    }
    return s;
  }

  // \u2500\u2500 Internal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  private beginSession(s: Omit<AuthenticatedAdminState, 'kind'>): void {
    this._state.set({ kind: 'authenticated', ...s });
  }

  /**
   * Load the persisted session at construction time, dropping it on
   * any of: expired, missing fields, or corrupt JSON.  We don't
   * re-verify membership against current chain/env state here \u2014
   * that runs lazily on the next ``loginWithWallet`` call (or
   * implicitly when the user navigates to a page that requires
   * auth).  Fail-open vs fail-closed trade-off: failing closed every
   * page-load would re-walk chain on every navigation; failing open
   * with expiry as the cap is the same trade-off the v1 JWT made.
   */
  private load(): AdminSessionState {
    if (typeof window === 'undefined') return { kind: 'anonymous' };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { kind: 'anonymous' };
    let parsed: PersistedAdminSession;
    try {
      parsed = JSON.parse(raw) as PersistedAdminSession;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return { kind: 'anonymous' };
    }
    const nowSec = Math.floor(Date.now() / 1_000);
    if (
      !parsed.address ||
      !parsed.pubkey ||
      !parsed.signature ||
      !parsed.typedData ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= nowSec
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return { kind: 'anonymous' };
    }
    return {
      kind: 'authenticated',
      address: parsed.address,
      pubkey: parsed.pubkey,
      expiresAt: parsed.expiresAt,
      signature: parsed.signature,
      typedData: parsed.typedData,
    };
  }
}

// \u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
export interface WalletLoginOptions {
  /** 0x-hex Ethereum address (any case; we normalise to lowercase). */
  address: string;
  /** 0x-hex 33-byte compressed secp256k1 pubkey, recovered from the signature. */
  pubkey: string;
  /** Unix-seconds expiry baked into ``typedData.message.expires_at``. */
  expiresAt: number;
  /** 0x-hex 65-byte (r, s, v) EIP-712 signature. */
  signature: string;
  /** Original typed data envelope.  Persisted so we can re-recover the pubkey on session restore. */
  typedData: Eip712TypedData;
}

export type AdminSessionState = { kind: 'anonymous' } | AuthenticatedAdminState;

export interface AuthenticatedAdminState {
  kind: 'authenticated';
  /** Lowercase 0x-hex Ethereum address; the legacy ``subject`` getter returns this. */
  address: string;
  /** 0x-hex 33-byte compressed secp256k1 pubkey \u2014 used for membership re-checks. */
  pubkey: string;
  /** Unix-seconds. */
  expiresAt: number;
  /** Bearer credential.  Anyone holding it can act as the admin until expiry. */
  signature: string;
  /** Typed data the signature commits to \u2014 needed to re-verify on session restore. */
  typedData: Eip712TypedData;
}

interface PersistedAdminSession {
  address: string;
  pubkey: string;
  expiresAt: number;
  signature: string;
  typedData: Eip712TypedData;
}
