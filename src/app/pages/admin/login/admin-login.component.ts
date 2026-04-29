import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { formatError } from '../../../utils/format-error';

/**
 * Admin desk sign-in page.
 *
 * Flow:
 *   1. User connects an EVM wallet (injected or WalletConnect v2).
 *   2. User clicks "Sign in as Admin" — the page calls
 *      {@link AdminSessionService.login} which:
 *        a. requests an EIP-712 challenge,
 *        b. asks the wallet to sign it,
 *        c. submits the signature to `/admin/auth/login`,
 *        d. seeds the persistent session.
 *   3. The user is redirected to `?returnTo=...` or `/admin`.
 *
 * The 403 case (signer not in `POPULIS_ADMIN_PUBKEY_ALLOWLIST`) surfaces
 * verbatim from the backend's error detail — operators will see it as
 * "Subject 0x… is not in the admin allowlist."
 */
@Component({
  selector: 'pp-admin-login',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-16 pb-24 max-w-2xl">
      <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4">
        Populis · Admin Desk
      </div>
      <h1 class="font-display text-4xl md:text-5xl">Sign in.</h1>
      <p class="mt-4 text-text-muted max-w-xl">
        Authenticate with the EVM key whose pubkey is on the
        <code class="mono text-xs">POPULIS_ADMIN_PUBKEY_ALLOWLIST</code>.
        The signed challenge is bound to the chain id and to this site's
        EIP-712 domain &mdash; nothing is broadcast on chain.
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
      </div>
    </section>
  `,
})
export class AdminLoginComponent {
  private readonly evm = inject(EvmWalletService);
  private readonly session = inject(AdminSessionService);
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
      await this.evm.connectWalletConnect();
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
    const owner = this.walletAddress();
    if (!owner) {
      this.error.set('Connect an EVM wallet first.');
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.status.set('Requesting challenge from /admin/auth/challenge…');
      await this.session.login({
        owner,
        authType: 'evm',
        sign: async (typedData) => {
          this.status.set('Awaiting wallet signature…');
          return this.evm.signTypedData(typedData);
        },
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
