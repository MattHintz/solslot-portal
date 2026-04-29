import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AdminApiService,
  AdminAuthType,
  AdminLoginRequest,
} from './admin-api.service';

const STORAGE_KEY = 'populis_admin_session_v1';

/**
 * Refresh the JWT this many seconds before its `expires_at`.  Comfortable
 * margin so a slow round-trip doesn't let the token lapse mid-flight.
 */
const REFRESH_LEAD_SECONDS = 60;

/**
 * Floor on the auto-refresh timer so we don't spin a tight loop if a JWT
 * arrives nearly-expired (e.g., clock skew between client and server).
 */
const MIN_REFRESH_INTERVAL_MS = 5_000;

/**
 * Persistent admin-desk session manager.
 *
 * Lifecycle:
 *   1. Caller (login page) drives the wallet-signing handshake and calls
 *      {@link beginSession} with the response from `/admin/auth/login`.
 *   2. The session is mirrored to localStorage and an auto-refresh timer is
 *      scheduled to fire `REFRESH_LEAD_SECONDS` before expiry.
 *   3. Any auth failure during refresh (403 — usually the operator has been
 *      removed from `POPULIS_ADMIN_PUBKEY_ALLOWLIST`, per POP-CANON-012)
 *      clears the session and routes the user back to `/admin/login`.
 *
 * **Storage caveat.**  The JWT is bearer authority; persisting it in
 * `localStorage` exposes it to any XSS injected into the portal.  For an
 * operator-facing internal tool this is an accepted trade-off (small known
 * audience, no untrusted user content rendered, 15-min TTL).  If we ever
 * extend this surface to less-trusted operators, switch to in-memory only
 * and accept the page-reload re-login UX cost.
 */
@Injectable({ providedIn: 'root' })
export class AdminSessionService {
  private readonly api = inject(AdminApiService);
  private readonly router = inject(Router);

  private readonly _state = signal<AdminSessionState>(this.load());
  readonly state = this._state.asReadonly();

  readonly isAuthenticated = computed(() => this._state().kind === 'authenticated');
  readonly subject = computed(() => {
    const s = this._state();
    return s.kind === 'authenticated' ? s.subject : null;
  });
  readonly authType = computed(() => {
    const s = this._state();
    return s.kind === 'authenticated' ? s.authType : null;
  });
  readonly expiresAt = computed(() => {
    const s = this._state();
    return s.kind === 'authenticated' ? s.expiresAt : null;
  });

  /** True while a refresh is in flight; prevents double-refresh races. */
  private refreshing: Promise<void> | null = null;

  /** Handle of the scheduled auto-refresh timer (0 means none). */
  private refreshHandle = 0;

  constructor() {
    // Persist any updates to localStorage and (re-)schedule the auto-refresh.
    effect(() => {
      const s = this._state();
      if (typeof window === 'undefined') return;
      if (s.kind === 'authenticated') {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            jwt: s.jwt,
            subject: s.subject,
            authType: s.authType,
            expiresAt: s.expiresAt,
          } satisfies PersistedAdminSession),
        );
        this.scheduleAutoRefresh(s.expiresAt);
      } else {
        localStorage.removeItem(STORAGE_KEY);
        this.cancelAutoRefresh();
      }
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────
  /**
   * Run the full login handshake: request a challenge, hand the typed-data
   * to {@link sign}, submit the resulting signature to `/admin/auth/login`,
   * and seed a session.  Returns the `subject` claim on success.
   *
   * `sign` is provided by the caller because signing requires a wallet
   * service — keeping that out of the session service preserves the
   * separation between "session lifecycle" and "wallet operations".
   */
  async login(opts: AdminLoginOptions): Promise<string> {
    const challenge = await this.api.requestChallenge(opts.owner, opts.authType);
    const signature = await opts.sign(challenge.typed_data);
    const req: AdminLoginRequest = {
      owner: opts.owner,
      nonce: challenge.nonce,
      signature,
      auth_type: opts.authType,
    };
    const resp = await this.api.submitLogin(req);
    this.beginSession({
      jwt: resp.jwt,
      subject: resp.owner,
      authType: opts.authType,
      expiresAt: resp.expires_at,
    });
    return resp.owner;
  }

  /** Returns the current JWT or throws if no active session. */
  requireJwt(): string {
    const s = this._state();
    if (s.kind !== 'authenticated') {
      throw new Error('No active admin session — login first.');
    }
    return s.jwt;
  }

  /** Returns the current JWT or null. */
  jwt(): string | null {
    const s = this._state();
    return s.kind === 'authenticated' ? s.jwt : null;
  }

  /**
   * Force a refresh now.  Subsequent concurrent callers share the same
   * in-flight promise, so it's safe to call from many places.
   */
  async refreshNow(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const s = this._state();
    if (s.kind !== 'authenticated') return;
    this.refreshing = this.runRefresh(s.jwt, s.subject, s.authType)
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /** Clear the session and stop any pending auto-refresh. */
  logout(): void {
    this._state.set({ kind: 'anonymous' });
  }

  /**
   * Clear the session, then navigate to the admin login page.  Intended for
   * forced logouts (403 on refresh, manual signout button).
   */
  logoutAndRedirect(): void {
    this.logout();
    this.router.navigate(['/admin/login']);
  }

  // ── Internal ────────────────────────────────────────────────────────────
  private beginSession(s: Omit<AuthenticatedAdminState, 'kind'>): void {
    this._state.set({ kind: 'authenticated', ...s });
  }

  private async runRefresh(
    jwt: string,
    subject: string,
    authType: AdminAuthType,
  ): Promise<void> {
    try {
      const resp = await this.api.refreshJwt(jwt);
      this.beginSession({
        jwt: resp.jwt,
        subject,
        authType,
        expiresAt: resp.expires_at,
      });
    } catch (err: unknown) {
      // 401/403 here means the JWT is invalid OR the subject has been
      // revoked from POPULIS_ADMIN_PUBKEY_ALLOWLIST (POP-CANON-012).
      // Either way the only safe action is to drop the session.
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        this.logoutAndRedirect();
        return;
      }
      // Network errors etc. — keep the session and let the next attempt
      // retry; the auto-refresh will fire again at the next interval.
      throw err;
    }
  }

  private scheduleAutoRefresh(expiresAt: number): void {
    this.cancelAutoRefresh();
    if (typeof window === 'undefined') return;
    const nowSec = Math.floor(Date.now() / 1_000);
    const delaySec = expiresAt - nowSec - REFRESH_LEAD_SECONDS;
    const delayMs = Math.max(MIN_REFRESH_INTERVAL_MS, delaySec * 1_000);
    this.refreshHandle = window.setTimeout(() => {
      // Catch errors so unhandled-promise rejections don't leak; the
      // refreshNow() handler routes 401/403 to logoutAndRedirect already.
      void this.refreshNow().catch(() => undefined);
    }, delayMs);
  }

  private cancelAutoRefresh(): void {
    if (this.refreshHandle !== 0 && typeof window !== 'undefined') {
      window.clearTimeout(this.refreshHandle);
    }
    this.refreshHandle = 0;
  }

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
    // Drop expired sessions on load so the user is sent to /admin/login
    // rather than fighting a 403 on the first /admin/mint/* call.
    const nowSec = Math.floor(Date.now() / 1_000);
    if (!parsed.jwt || !parsed.expiresAt || parsed.expiresAt <= nowSec) {
      localStorage.removeItem(STORAGE_KEY);
      return { kind: 'anonymous' };
    }
    return {
      kind: 'authenticated',
      jwt: parsed.jwt,
      subject: parsed.subject,
      authType: parsed.authType ?? 'evm',
      expiresAt: parsed.expiresAt,
    };
  }
}

// ── Types ──────────────────────────────────────────────────────────────────
export interface AdminLoginOptions {
  /** Checksummed 0x-prefixed Ethereum address of the operator. */
  owner: string;
  /** "evm" today; "chia_bls" reserved for a later checkpoint. */
  authType: AdminAuthType;
  /**
   * Sign the EIP-712 typed data with the operator's wallet and return the
   * 65-byte (r, s, v) signature as 0x-prefixed hex.
   */
  sign: (typedData: import('./populis-api.service').Eip712TypedData) => Promise<string>;
}

export type AdminSessionState =
  | { kind: 'anonymous' }
  | AuthenticatedAdminState;

interface AuthenticatedAdminState {
  kind: 'authenticated';
  jwt: string;
  /** Lowercase 0x-prefixed address — the JWT's `sub` claim. */
  subject: string;
  authType: AdminAuthType;
  /** Unix-seconds. */
  expiresAt: number;
}

interface PersistedAdminSession {
  jwt: string;
  subject: string;
  authType?: AdminAuthType;
  expiresAt: number;
}
