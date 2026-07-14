import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { AdminWalletAuthService } from '../../../services/admin-wallet-auth.service';
import { formatError } from '../../../utils/format-error';

/**
 * Admin desk sign-in page (Phase 9-Hermes-D wallet-signed auth).
 *
 * Flow:
 *   1. User connects an EVM wallet (injected or WalletConnect v2).
 *   2. User clicks "Sign in as Admin".  The page:
 *        a. Builds a ``SolslotAdminLogin`` EIP-712 envelope via
 *           {@link AdminWalletAuthService.buildLoginTypedData} (fresh
 *           nonce, 12h expiry, chainId-bound).
 *        b. Asks the wallet to sign it (no API call).
 *        c. Recovers the 33-byte compressed secp256k1 pubkey via
 *           {@link EvmWalletService.recoverCompressedPubkey}.
 *        d. Hands the bundle to {@link AdminSessionService.loginWithWallet}
 *           which checks pubkey membership (MIPS root match for the
 *           on-chain v2 quorum, or env pubkey allowlist as a
 *           fallback) and persists the session.
 *   3. The user is redirected to `?returnTo=...` or `/admin`.
 *
 * No backend involvement.  Membership failures are surfaced from the
 * verifier's typed reason code so the page can render targeted help
 * (e.g., ``no-admins-configured`` → "ask the operator to update env").
 */
@Component({
  selector: 'pp-admin-login',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-16 pb-24 max-w-2xl">
      <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4">
        Solslot · Admin Desk
      </div>
      <h1 class="font-display text-4xl md:text-5xl">Sign in.</h1>
      <p class="mt-4 text-text-muted max-w-xl">
        Authenticate with the EVM key whose pubkey is in the on-chain
        admin authority's MIPS quorum (or, fallback, the portal's
        env pubkey allowlist).  The signed proof is bound to this
        deployment's chain id and site domain &mdash; nothing is
        broadcast on chain and nothing reaches an API server.
      </p>

      <div class="mt-10 card">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="mono text-xs uppercase tracking-[0.2em] text-text-muted">
              Wallet
            </div>
            <div class="mt-2 font-display text-2xl truncate">
              @if (walletAddress(); as a) {
                {{ a }}
              } @else {
                Not connected
              }
            </div>
          </div>
          @if (walletAddress()) {
            <button
              class="text-xs mono uppercase tracking-[0.18em] text-text-muted hover:text-brand"
              type="button"
              (click)="disconnect()"
            >
              Disconnect
            </button>
          }
        </div>

        <div class="mt-6 grid gap-3 sm:grid-cols-2">
          @if (!walletAddress()) {
            <button
              class="btn btn--primary"
              type="button"
              (click)="connectInjected()"
              [disabled]="busy()"
            >
              Connect injected wallet
            </button>
            <button
              class="btn btn--ghost"
              type="button"
              (click)="connectWalletConnect()"
              [disabled]="busy()"
            >
              WalletConnect
            </button>
          } @else {
            <button
              class="btn btn--primary sm:col-span-2"
              type="button"
              (click)="signIn()"
              [disabled]="busy()"
            >
              @if (busy()) {
                Signing in&hellip;
              } @else {
                Sign in as Admin
              }
            </button>
          }
        </div>
      </div>

      @if (status()) {
        <div class="mt-6 mono text-sm text-text-muted">
          {{ status() }}
        </div>
      }

      @if (error()) {
        <div class="mt-6 rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          <div class="font-display text-base mb-1">Sign-in failed.</div>
          <div class="mono text-xs">{{ error() }}</div>
        </div>
      }

      <div class="mt-12 text-xs text-text-muted">
        <a routerLink="/" class="hover:text-brand">&larr; Back to portal</a>
        <span class="mx-2 opacity-40">·</span>
        <a routerLink="/admin/genesis" class="hover:text-brand">Initialize genesis</a>
      </div>
    </section>
  `,
})
export class AdminLoginComponent {
  private readonly evm = inject(EvmWalletService);
  private readonly session = inject(AdminSessionService);
  private readonly walletAuth = inject(AdminWalletAuthService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);

  readonly busy = signal(false);
  readonly status = signal<string>('');
  readonly error = signal<string | null>(null);

  readonly walletAddress = computed(() => this.evm.address());

  constructor() {
    // If the user reloads /admin/login while already authenticated, send
    // them straight to the dashboard.  Avoids the awkward "you're already
    // signed in but the page still shows the connect screen" state.
    if (this.session.isAuthenticated()) {
      this.router.navigate([this.targetUrl()]);
    }
  }

  async connectInjected(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      this.status.set('Requesting wallet permission…');
      await this.evm.connectInjected();
      this.status.set('');
    } catch (e) {
      this.error.set(formatError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async connectWalletConnect(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      this.status.set('Opening WalletConnect modal…');
      await this.evm.connectWalletConnect({
        optionalChains: 'none',
        resetSession: true,
      });
      this.status.set('');
    } catch (e) {
      this.error.set(formatError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async disconnect(): Promise<void> {
    await this.evm.disconnect();
  }

  async signIn(): Promise<void> {
    const address = this.walletAddress();
    if (!address) {
      this.error.set('Connect an EVM wallet first.');
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.status.set('Building login envelope…');
      const expiresAt = this.walletAuth.defaultExpiresAt();
      const nonce = this.walletAuth.newNonce();
      const typedData = this.walletAuth.buildLoginTypedData(expiresAt, nonce);

      this.status.set('Awaiting wallet signature…');
      let signatureKind: 'eip712' | 'personal-sign' = 'eip712';
      let signature: string;
      let pubkey: string;
      let signedMessage: string | null = null;
      let signingMethod: 'eth_sign' | 'personal_sign' | null = null;
      try {
        signature = await this.evm.signTypedData(typedData);
        pubkey = this.evm.recoverCompressedPubkey(typedData, signature);
      } catch (signError) {
        if (!this.evm.canUseMessageSignatureFallback(signError)) {
          throw signError;
        }
        this.status.set('Typed-data signing unsupported. Awaiting Tangem-compatible admin proof…');
        signedMessage = this.walletAuth.buildLoginPersonalSignMessage(
          address,
          expiresAt,
          nonce,
        );
        const fallback = await this.evm.signAdminLoginMessage(signedMessage);
        signatureKind = 'personal-sign';
        signature = fallback.signature;
        pubkey = fallback.pubkey;
        signingMethod = fallback.method;
      }

      this.status.set('Verifying admin membership…');
      await this.session.loginWithWallet({
        address,
        pubkey,
        expiresAt,
        signatureKind,
        signature,
        typedData: signatureKind === 'eip712' ? typedData : null,
        signedMessage,
        signingMethod,
      });

      this.status.set('Signed in. Redirecting…');
      await this.router.navigate([this.targetUrl()]);
    } catch (e) {
      this.error.set(formatError(e));
      this.status.set('');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Resolve where the user should land after a successful sign-in.  The
   * guard pushes the original URL into `?returnTo=`; we honour that as
   * long as it points back into the admin tree (don't trust open
   * redirects to external hosts).
   */
  private targetUrl(): string {
    const raw = this.activatedRoute.snapshot.queryParamMap.get('returnTo');
    if (raw && raw.startsWith('/admin') && !raw.startsWith('/admin/login')) {
      return raw;
    }
    return '/admin';
  }
}
