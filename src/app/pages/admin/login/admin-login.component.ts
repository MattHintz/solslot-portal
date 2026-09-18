import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { AdminBackendAuthService } from '../../../services/admin-backend-auth.service';
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
 *        b. Asks the wallet to sign it with EIP-712 (no fallback envelope).
 *        c. Recovers the 33-byte compressed secp256k1 pubkey via
 *           {@link EvmWalletService.recoverCompressedPubkey}.
 *        d. Hands the bundle to {@link AdminSessionService.loginWithWallet}
 *           which checks the signature and signed-artifact roster before
 *           persisting a tab-scoped session.
 *   3. The user is redirected to `?returnTo=...` or `/admin`.
 *
 * Membership comes only from the verified 2-of-3 roster in the signed
 * ceremony artifact. The portal refuses admin login before that artifact is
 * available.
 */
@Component({
  selector: 'pp-admin-login',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="login-page">
      <a routerLink="/" class="back-link">&larr; Protocol status</a>

      <div class="login-layout">
        <section class="welcome" aria-labelledby="admin-sign-in-title">
          <span class="eyebrow">Solslot administration</span>
          <h1 id="admin-sign-in-title">Sign in to your admin desk</h1>
          <p>
            Use the administrator wallet assigned to you. Your wallet will ask for
            a sign-in signature. This does not send a transaction or move funds.
          </p>

          <aside class="ux-context">
            <strong>Joining for the first time?</strong>
            <p>Use the owner’s private invitation to enroll your daily wallet first. You do not need an SGT vault or an SGT balance to enroll.</p>
            <a routerLink="/admin/genesis">View setup & launch</a>
          </aside>
          <div class="safety-brief" aria-labelledby="sign-in-safety-title">
            <h2 id="sign-in-safety-title">Before you connect</h2>
            <ul>
              <li>Confirm the address bar shows the official Solslot admin site.</li>
              <li>Use only your enrolled administrator wallet.</li>
              <li>Never enter or share a recovery phrase, private key, or wallet password.</li>
            </ul>
          </div>

          <details>
            <summary>How this sign-in is protected</summary>
            <p>
              Solslot verifies the signature against the administrator team recorded
              at launch. The request is time-limited and tied to this Testnet11 release.
            </p>
          </details>
        </section>

        <section class="sign-in-card" aria-label="Administrator wallet sign-in">
          <header>
            <div>
              <span class="eyebrow">Administrator wallet</span>
              <strong>
                @if (walletAddress(); as address) {
                  {{ shortWallet(address) }}
                } @else {
                  Choose how to connect
                }
              </strong>
            </div>
            @if (walletAddress()) {
              <button class="quiet-action" type="button" (click)="disconnect()">
                Change wallet
              </button>
            }
          </header>

          @if (!walletAddress()) {
            <div class="connection-options">
              <button
                class="connect-option"
                type="button"
                (click)="connectInjected()"
                [disabled]="busy()"
              >
                <span aria-hidden="true">01</span>
                <span>
                  <strong>Browser wallet</strong>
                  <small>MetaMask, Rabby, Coinbase Wallet, or another installed wallet</small>
                </span>
              </button>
              <button
                class="connect-option"
                type="button"
                (click)="connectWalletConnect()"
                [disabled]="busy()"
              >
                <span aria-hidden="true">02</span>
                <span>
                  <strong>Mobile or hardware wallet</strong>
                  <small>WalletConnect, including compatible Tangem and hardware wallets</small>
                </span>
              </button>
            </div>
          } @else {
            <div class="connected-wallet">
              <span>Connected address</span>
              <code>{{ walletAddress() }}</code>
            </div>
            <button
              class="primary-action"
              type="button"
              (click)="signIn()"
              [disabled]="busy()"
            >
              {{ busy() ? 'Waiting for wallet...' : 'Continue securely' }}
            </button>
            <p class="signature-note">
              Check that your wallet says <strong>Sign</strong>, not Send, Approve, or Transfer.
            </p>
          }

          @if (status()) {
            <div class="status" role="status">{{ status() }}</div>
          }

          @if (error()) {
            <div class="error" role="alert">
              <strong>We could not sign you in</strong>
              <span>{{ error() }}</span>
              <small>
                Confirm that the connected wallet is one of the enrolled administrator wallets,
                then try again.
              </small>
            </div>
          }
        </section>
      </div>
    </main>
  `,
  styles: [
    `
      :host { display:block; min-height:100vh; background:#04100e; color:#effcf7; }
      .login-page { width:min(1040px,calc(100% - 32px)); margin:0 auto; padding:30px 0 80px; }
      .back-link { color:#8ab6a4; font-size:12px; text-decoration:none; }
      .login-layout { display:grid; grid-template-columns:minmax(0,1fr) minmax(360px,.78fr); gap:64px; align-items:start; margin-top:72px; }
      .eyebrow { color:#67e7ad; font:700 11px/1.2 var(--font-mono); text-transform:uppercase; }
      h1 { margin-top:10px; font:600 48px/1.05 var(--font-sans); letter-spacing:0; }
      .welcome > p { max-width:590px; margin-top:18px; color:#aac4b9; font-size:16px; line-height:1.65; }
      .safety-brief { margin-top:34px; padding:20px 0; border-block:1px solid #21483d; }
      h2 { font:600 15px/1.3 var(--font-sans); letter-spacing:0; }
      ul { display:grid; gap:10px; margin:15px 0 0; padding-left:20px; color:#c2d8cf; font-size:13px; }
      details { margin-top:18px; color:#91ada1; font-size:12px; }
      summary { color:#79dbae; cursor:pointer; }
      details p { margin-top:9px; max-width:600px; line-height:1.6; }
      .sign-in-card { border:1px solid #295448; background:#091b16; box-shadow:0 24px 70px rgba(0,0,0,.36); }
      .sign-in-card > header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px; border-bottom:1px solid #21483d; }
      .sign-in-card header > div { display:grid; gap:7px; min-width:0; }
      .sign-in-card header strong { overflow:hidden; color:#f4fff9; font-size:18px; text-overflow:ellipsis; }
      .quiet-action { border:0; background:none; color:#75d8aa; font-size:11px; cursor:pointer; }
      .connection-options { display:grid; gap:1px; background:#21483d; }
      .connect-option { display:grid; grid-template-columns:34px minmax(0,1fr); gap:12px; align-items:start; padding:18px 20px; border:0; background:#091713; color:inherit; text-align:left; cursor:pointer; }
      .connect-option:hover { background:#0d251e; }
      .connect-option > span:first-child { display:grid; width:30px; height:30px; place-items:center; border:1px solid #3c7361; color:#67e7ad; font:10px var(--font-mono); }
      .connect-option > span:last-child { display:grid; gap:4px; }
      .connect-option strong { font-size:14px; }
      .connect-option small { color:#91ada1; font-size:11px; line-height:1.5; }
      .connect-option:disabled,.primary-action:disabled { cursor:not-allowed; opacity:.55; }
      .connected-wallet { display:grid; gap:7px; margin:20px 20px 0; padding:13px; background:#06110f; }
      .connected-wallet span { color:#8dab9f; font-size:10px; text-transform:uppercase; }
      .connected-wallet code { overflow:hidden; color:#cce6da; font-size:11px; text-overflow:ellipsis; }
      .primary-action { width:calc(100% - 40px); margin:14px 20px 0; padding:13px 16px; border:1px solid #73e5b2; background:#67e7ad; color:#04110d; font-weight:700; cursor:pointer; }
      .signature-note { margin:11px 20px 20px; color:#91ada1; font-size:11px; line-height:1.5; }
      .status,.error { margin:0 20px 20px; padding:12px; font-size:12px; }
      .status { border-left:2px solid #67e7ad; background:#0d251e; color:#bcd8cb; }
      .error { display:grid; gap:5px; border:1px solid #824f4f; background:#261414; color:#ffd0d0; }
      .error span,.error small { line-height:1.5; }
      .error small { color:#cfa7a7; }
      @media (max-width:780px) { .login-layout { grid-template-columns:1fr; gap:32px; margin-top:42px; } h1 { font-size:38px; } }
      @media (max-width:440px) { .login-page { width:calc(100% - 20px); } .sign-in-card > header { align-items:flex-start; flex-direction:column; } }
    `,
  ],
})
export class AdminLoginComponent {
  private readonly evm = inject(EvmWalletService);
  private readonly session = inject(AdminSessionService);
  private readonly backendAuth = inject(AdminBackendAuthService);
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

  shortWallet(value: string): string {
    return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
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
      this.status.set('Preparing a secure sign-in request...');
      const challenge = await this.backendAuth.requestChallenge(address);
      const typedData = challenge.typed_data;

      this.status.set('Check your wallet and approve the sign-in signature.');
      const signature = await this.evm.signTypedData(typedData);
      const pubkey = this.evm.recoverCompressedPubkey(typedData, signature);

      this.status.set('Confirming your administrator role...');
      const apiSession = await this.backendAuth.login(address, challenge.nonce, signature);
      await this.session.loginWithWallet({
        address,
        pubkey,
        authoritySlot: apiSession.authority_slot,
        expiresAt: apiSession.expires_at,
        signatureKind: 'eip712',
        signature,
        typedData,
        jwt: apiSession.jwt,
      });

      this.status.set('Signed in. Opening your task list...');
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
