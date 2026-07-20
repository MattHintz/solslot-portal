import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EvmWalletService } from '../../services/evm-wallet.service';
import { ChiaWalletService } from '../../services/chia-wallet.service';
import { GoogleDriveVaultService } from '../../services/google-drive-vault.service';
import {
  SolslotVaultBackupEnvelope,
  VaultBackupCryptoService,
} from '../../services/vault-backup-crypto.service';
import { WalletUxStateService } from '../../services/wallet-ux-state.service';
import { formatError } from '../../utils/format-error';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'pp-connect',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="container-p pt-16 pb-24 max-w-5xl">
      <div class="grid gap-10 lg:grid-cols-[1fr_0.8fr] lg:items-end">
        <div>
          <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4">
            Vault Connect · Step 1 of 2
          </div>
          <h1 class="font-display text-4xl md:text-6xl">Enter the SmartDeeds vault layer.</h1>
          <p class="mt-5 text-text-muted max-w-2xl leading-relaxed">
            This is the new Solslot connection path for Testnet Alpha. Connect an EVM or
            Chia wallet, or create a password-encrypted BLS wallet backed up privately in
            your Google Drive. Then continue into Vault creation, zkPassport readiness,
            and SmartDeed execution.
          </p>
        </div>

        <aside class="card border-brand/30 bg-brand-soft">
          <div class="mono text-[0.68rem] uppercase tracking-[0.2em] text-brand">
            Legacy customer recall
          </div>
          <p class="mt-3 text-sm text-text-muted leading-relaxed">
            Looking for the old Solslot customer records or pro-vault holdings? Use the
            legacy login path. New SmartDeeds activity starts here in Vault Connect.
          </p>
          <a href="/dashboard/asset-overview" class="btn btn--ghost mt-5 inline-flex">
            Legacy Vault Login
          </a>
        </aside>
      </div>

      <div class="mt-10 grid gap-6 md:grid-cols-3">
        <button
          class="card text-left hover:border-brand hover:shadow-glow transition disabled:opacity-60"
          (click)="connectEvm()"
          [disabled]="busy()"
          type="button"
        >
          <div class="flex items-center gap-3">
            <span class="mono text-xs rounded border border-brand/30 px-2 py-1 text-brand">EVM</span>
            <span class="font-display text-2xl">EVM wallet</span>
          </div>
          <p class="mt-3 text-sm text-text-muted leading-relaxed">
            MetaMask, Coinbase Wallet, Rabby, or any WalletConnect-compatible
            wallet. Recommended for the alpha path because the Vault key can be
            derived from one EIP-712 signature.
          </p>
          <div class="mt-4 mono text-xs text-brand uppercase tracking-[0.15em]">
            {{ walletLabel('evm', 'Recommended for Vault Connect') }}
          </div>
        </button>

        <button
          class="card text-left hover:border-brand hover:shadow-glow transition disabled:opacity-60"
          (click)="connectChia()"
          [disabled]="busy()"
          type="button"
        >
          <div class="flex items-center gap-3">
            <span class="mono text-xs rounded border border-brand/30 px-2 py-1 text-brand">BLS</span>
            <span class="font-display text-2xl">Chia wallet</span>
          </div>
          <p class="mt-3 text-sm text-text-muted leading-relaxed">
            Sage or Goby browser extension, with Sage WalletConnect fallback.
            Uses a native BLS signature and lets advanced users spend XCH directly
            from their own wallet on testnet11.
          </p>
          <div class="mt-4 mono text-xs text-text-muted uppercase tracking-[0.15em]">
            {{ walletLabel('chia', 'Advanced · extension or QR link') }}
          </div>
        </button>

        @if (googleVaultEnabled) {
          <button
            class="card text-left hover:border-brand hover:shadow-glow transition disabled:opacity-60"
            (click)="connectGoogle()"
            [disabled]="busy()"
            type="button"
          >
            <div class="flex items-center gap-3">
              <span class="mono text-xs rounded border border-brand/30 px-2 py-1 text-brand">GOOGLE</span>
              <span class="font-display text-2xl">Google vault</span>
            </div>
            <p class="mt-3 text-sm text-text-muted leading-relaxed">
              Create or restore a browser-managed BLS wallet. The seed is encrypted with
              your recovery password before it is saved to Drive's private app storage.
            </p>
            <div class="mt-4 mono text-xs text-brand uppercase tracking-[0.15em]">
              {{ walletLabel('google', 'Easy recovery · password protected') }}
            </div>
          </button>
        }
      </div>

      <div class="mt-8 grid gap-3 text-sm text-text-muted md:grid-cols-3">
        <div class="card p-4">
          <div class="mono text-[0.68rem] uppercase tracking-[0.18em] text-brand">1 · Sign</div>
          <p class="mt-2">Signature-derived keying. No seed entry. No private-key upload.</p>
        </div>
        <div class="card p-4">
          <div class="mono text-[0.68rem] uppercase tracking-[0.18em] text-brand">2 · Vault</div>
          <p class="mt-2">Launch or recover your SmartDeeds custody singleton.</p>
        </div>
        <div class="card p-4">
          <div class="mono text-[0.68rem] uppercase tracking-[0.18em] text-brand">3 · Execute</div>
          <p class="mt-2">Proceed to Moon alpha simulations and committee-gated actions.</p>
        </div>
      </div>

      @if (googleMode() === 'restore') {
        <form class="card mt-7 border-brand/30" (ngSubmit)="restoreGoogleVault()">
          <div class="font-display text-2xl">Unlock your Google vault</div>
          <p class="mt-2 text-sm text-text-muted">
            Enter the recovery password used to encrypt this backup. Solslot never receives it.
          </p>
          <label class="mt-5 block text-sm">
            <span class="eyebrow">Recovery password</span>
            <input class="mt-2 w-full rounded border border-white/15 bg-black/30 px-3 py-3" type="password" name="restorePassword" [(ngModel)]="password" autocomplete="current-password" required />
          </label>
          <label class="mt-4 flex gap-3 text-sm text-amber-100">
            <input type="checkbox" name="restoreGoogleVaultRisk" [(ngModel)]="googleVaultRiskAcknowledged" required />
            <span>Testnet only: while this browser vault is unlocked, a compromised Solslot page or browser extension could request signatures. Review every signing prompt.</span>
          </label>
          <div class="mt-5 flex flex-wrap gap-3">
            <button class="btn btn--primary" type="submit" [disabled]="busy()">Unlock vault</button>
            <button class="btn btn--ghost" type="button" (click)="beginSeedRecovery()" [disabled]="busy()">Forgot password</button>
            <button class="btn btn--ghost" type="button" (click)="cancelGoogle()" [disabled]="busy()">Cancel</button>
          </div>
        </form>
      }

      @if (googleMode() === 'create') {
        <form class="card mt-7 border-brand/30" (ngSubmit)="createGoogleVault()">
          <div class="font-display text-2xl">Record your recovery phrase</div>
          <p class="mt-2 text-sm text-text-muted">
            This is the only fallback if you forget the recovery password. Keep it offline and private.
          </p>
          <div class="mono mt-5 grid grid-cols-2 gap-2 rounded border border-brand/20 bg-black/30 p-4 text-sm md:grid-cols-3">
            @for (word of mnemonicWords(); track $index) {
              <span><span class="text-text-muted">{{ $index + 1 }}.</span> {{ word }}</span>
            }
          </div>
          <div class="mt-5 grid gap-4 md:grid-cols-3">
            @for (index of confirmationIndices; track index; let inputIndex = $index) {
              <label class="text-sm">
                <span class="eyebrow">Word {{ index + 1 }}</span>
                <input class="mt-2 w-full rounded border border-white/15 bg-black/30 px-3 py-3" type="text" [name]="'word' + index" [(ngModel)]="confirmationWords[inputIndex]" autocomplete="off" required />
              </label>
            }
          </div>
          <div class="mt-5 grid gap-4 md:grid-cols-2">
            <label class="text-sm">
              <span class="eyebrow">Recovery password</span>
              <input class="mt-2 w-full rounded border border-white/15 bg-black/30 px-3 py-3" type="password" name="newPassword" [(ngModel)]="password" autocomplete="new-password" minlength="12" required />
            </label>
            <label class="text-sm">
              <span class="eyebrow">Confirm password</span>
              <input class="mt-2 w-full rounded border border-white/15 bg-black/30 px-3 py-3" type="password" name="confirmPassword" [(ngModel)]="confirmPassword" autocomplete="new-password" minlength="12" required />
            </label>
          </div>
          <label class="mt-4 flex gap-3 text-sm text-amber-100">
            <input type="checkbox" name="createGoogleVaultRisk" [(ngModel)]="googleVaultRiskAcknowledged" required />
            <span>Testnet only: this keeps a BLS key in page memory while unlocked. XSS can request signatures, so use only a dedicated testnet mnemonic and review each signing prompt.</span>
          </label>
          <div class="mt-5 flex flex-wrap gap-3">
            <button class="btn btn--primary" type="submit" [disabled]="busy()">Encrypt, back up, and continue</button>
            <button class="btn btn--ghost" type="button" (click)="cancelGoogle()" [disabled]="busy()">Cancel</button>
          </div>
        </form>
      }

      @if (googleMode() === 'recover_seed') {
        <form class="card mt-7 border-brand/30" (ngSubmit)="recoverPasswordWithSeed()">
          <div class="font-display text-2xl">Reset with recovery phrase</div>
          <p class="mt-2 text-sm text-text-muted">
            The phrase must derive the same BLS public key recorded in the Drive backup.
          </p>
          <label class="mt-5 block text-sm">
            <span class="eyebrow">24-word recovery phrase</span>
            <textarea class="mt-2 min-h-28 w-full rounded border border-white/15 bg-black/30 px-3 py-3" name="recoveryMnemonic" [(ngModel)]="recoveryMnemonic" autocomplete="off" required></textarea>
          </label>
          <div class="mt-5 grid gap-4 md:grid-cols-2">
            <label class="text-sm">
              <span class="eyebrow">New recovery password</span>
              <input class="mt-2 w-full rounded border border-white/15 bg-black/30 px-3 py-3" type="password" name="resetPassword" [(ngModel)]="password" autocomplete="new-password" minlength="12" required />
            </label>
            <label class="text-sm">
              <span class="eyebrow">Confirm new password</span>
              <input class="mt-2 w-full rounded border border-white/15 bg-black/30 px-3 py-3" type="password" name="resetConfirmPassword" [(ngModel)]="confirmPassword" autocomplete="new-password" minlength="12" required />
            </label>
          </div>
          <label class="mt-4 flex gap-3 text-sm text-amber-100">
            <input type="checkbox" name="recoverGoogleVaultRisk" [(ngModel)]="googleVaultRiskAcknowledged" required />
            <span>Testnet only: this keeps a BLS key in page memory while unlocked. XSS can request signatures, so use only a dedicated testnet mnemonic and review each signing prompt.</span>
          </label>
          <div class="mt-5 flex flex-wrap gap-3">
            <button class="btn btn--primary" type="submit" [disabled]="busy()">Replace encrypted backup</button>
            <button class="btn btn--ghost" type="button" (click)="showRestore()" [disabled]="busy()">Back</button>
          </div>
        </form>
      }

      @if (error()) {
        <div class="mt-6 rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {{ error() }}
        </div>
      }

      @if (busy()) {
        <div class="mt-6 mono text-sm text-text-muted">
          @if (restoringSageWalletConnect()) {
            Checking existing Sage session...
          } @else {
            {{ status() }}
          }
        </div>
      }

      @if (sageWalletConnectUri(); as uri) {
        <div class="mt-6 card border-brand/30 bg-brand-soft">
          <div class="font-display text-xl">Sage WalletConnect is waiting.</div>
          <p class="mt-2 text-sm text-text-muted">
            Open Sage, scan the WalletConnect prompt, or copy the pairing link.
          </p>
          <div class="mt-4 flex flex-wrap gap-3">
            <button class="btn btn--primary" type="button" (click)="copySagePairUri(uri)">
              Copy pairing link
            </button>
            <button class="btn btn--ghost" type="button" (click)="cancelChiaPairing()">
              Cancel
            </button>
          </div>
          <pre class="mono mt-4 max-h-32 overflow-auto rounded-card border border-white/10 bg-black/30 p-3 text-xs text-text-muted">{{ uri }}</pre>
        </div>
      }
    </section>
  `,
})
export class ConnectComponent {
  private readonly evm = inject(EvmWalletService);
  private readonly chia = inject(ChiaWalletService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly walletUx = inject(WalletUxStateService);
  private readonly googleDrive = inject(GoogleDriveVaultService);
  private readonly backupCrypto = inject(VaultBackupCryptoService);

  readonly busy = signal(false);
  readonly status = signal<string>('');
  readonly error = signal<string | null>(null);
  readonly sageWalletConnectUri = this.chia.sageWalletConnectUri;
  readonly restoringSageWalletConnect = this.chia.restoringSageWalletConnect;
  readonly googleMode = signal<'idle' | 'restore' | 'create' | 'recover_seed'>('idle');
  readonly googleVaultEnabled = environment.googleVaultEnabled;
  readonly mnemonic = signal('');
  readonly mnemonicWords = () => this.mnemonic().split(' ').filter(Boolean);
  readonly confirmationIndices = [3, 11, 19];
  readonly returnTo = signal<string | null>(
    safeReturnTo(this.route.snapshot.queryParamMap.get('returnTo')),
  );
  confirmationWords = ['', '', ''];
  password = '';
  confirmPassword = '';
  recoveryMnemonic = '';
  googleVaultRiskAcknowledged = false;
  private googleEnvelope: SolslotVaultBackupEnvelope | null = null;

  async connectEvm(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      this.status.set('Requesting wallet permission…');
      let address: string;
      if (this.evm.hasInjectedProvider()) {
        address = await this.evm.connectInjected();
      } else {
        address = await this.evm.connectWalletConnect();
      }
      this.status.set(`Connected ${address}`);
      this.walletUx.setLastWalletKind('evm');
      await this.router.navigate(['/create-vault'], {
        queryParams: this.nextQueryParams('evm'),
      });
    } catch (e) {
      this.error.set(this.msg(e));
    } finally {
      this.busy.set(false);
    }
  }

  async connectChia(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      this.status.set('Requesting Chia wallet…');
      let pubkey: string;
      if (this.chia.hasGoby()) {
        this.status.set('Opening Goby…');
        pubkey = await this.chia.connectGoby();
      } else if (this.chia.hasSage()) {
        this.status.set('Opening Sage…');
        pubkey = await this.chia.connectSage();
      } else if (this.chia.hasSageWalletConnect()) {
        this.status.set('Opening Sage WalletConnect…');
        pubkey = await this.chia.connectSageWalletConnect();
      } else {
        throw new Error('No Chia wallet option detected');
      }
      this.status.set(`Connected ${this.short(pubkey)}`);
      this.walletUx.setLastWalletKind('chia');
      await this.router.navigate(['/create-vault'], {
        queryParams: this.nextQueryParams('chia'),
      });
    } catch (e) {
      this.error.set(this.msg(e));
    } finally {
      this.busy.set(false);
    }
  }

  async connectGoogle(): Promise<void> {
    if (!this.googleVaultEnabled) {
      this.error.set('Google Vault is disabled for this deployment.');
      return;
    }
    this.resetGoogleInputs();
    this.error.set(null);
    this.busy.set(true);
    this.status.set('Opening Google sign-in…');
    try {
      const envelope = await this.googleDrive.loadBackup();
      this.googleEnvelope = envelope;
      if (envelope) {
        this.googleMode.set('restore');
        this.status.set('Encrypted vault backup found.');
      } else {
        this.mnemonic.set(this.backupCrypto.generateMnemonic());
        this.googleMode.set('create');
        this.status.set('New recovery phrase generated locally.');
      }
    } catch (e) {
      this.error.set(this.msg(e));
      this.googleMode.set('idle');
    } finally {
      this.busy.set(false);
    }
  }

  async restoreGoogleVault(): Promise<void> {
    const envelope = this.googleEnvelope;
    if (!envelope) return;
    this.error.set(null);
    if (!this.requireGoogleVaultRiskAcknowledgement()) return;
    this.busy.set(true);
    this.status.set('Decrypting your vault locally…');
    try {
      const restored = await this.backupCrypto.decrypt(envelope, this.password);
      const pubkey = this.chia.connectGoogle(restored.mnemonic, envelope.publicKey);
      await this.finishGoogleConnection(pubkey);
    } catch (e) {
      this.chia.disconnect();
      this.error.set(this.msg(e));
    } finally {
      this.password = '';
      this.busy.set(false);
    }
  }

  async createGoogleVault(): Promise<void> {
    this.error.set(null);
    if (!this.requireGoogleVaultRiskAcknowledgement()) return;
    if (!this.confirmedMnemonic()) {
      this.error.set('Enter the requested recovery words exactly as shown.');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error.set('Recovery passwords do not match.');
      return;
    }
    this.busy.set(true);
    this.status.set('Encrypting and backing up your vault…');
    try {
      const pubkey = this.chia.connectGoogle(this.mnemonic());
      const envelope = await this.backupCrypto.encrypt({
        mnemonic: this.mnemonic(),
        password: this.password,
        publicKey: pubkey,
      });
      await this.googleDrive.createBackup(envelope);
      this.mnemonic.set('');
      this.confirmationWords = ['', '', ''];
      await this.finishGoogleConnection(pubkey);
    } catch (e) {
      this.chia.disconnect();
      this.error.set(this.msg(e));
    } finally {
      this.password = '';
      this.confirmPassword = '';
      this.busy.set(false);
    }
  }

  beginSeedRecovery(): void {
    this.error.set(null);
    this.password = '';
    this.confirmPassword = '';
    this.googleMode.set('recover_seed');
  }

  showRestore(): void {
    this.error.set(null);
    this.recoveryMnemonic = '';
    this.password = '';
    this.confirmPassword = '';
    this.googleMode.set('restore');
  }

  async recoverPasswordWithSeed(): Promise<void> {
    const envelope = this.googleEnvelope;
    if (!envelope) return;
    this.error.set(null);
    if (!this.requireGoogleVaultRiskAcknowledgement()) return;
    if (this.password !== this.confirmPassword) {
      this.error.set('Recovery passwords do not match.');
      return;
    }
    this.busy.set(true);
    this.status.set('Verifying the phrase and replacing the encrypted backup…');
    try {
      const pubkey = this.chia.connectGoogle(this.recoveryMnemonic, envelope.publicKey);
      const replacement = await this.backupCrypto.encrypt({
        mnemonic: this.recoveryMnemonic,
        password: this.password,
        publicKey: pubkey,
        launcherId: envelope.launcherId,
        createdAt: envelope.createdAt,
      });
      await this.googleDrive.replaceBackup(replacement);
      this.recoveryMnemonic = '';
      await this.finishGoogleConnection(pubkey);
    } catch (e) {
      this.chia.disconnect();
      this.error.set(this.msg(e));
    } finally {
      this.password = '';
      this.confirmPassword = '';
      this.busy.set(false);
    }
  }

  async cancelGoogle(): Promise<void> {
    this.chia.disconnect();
    await this.googleDrive.disconnect();
    this.googleMode.set('idle');
    this.googleEnvelope = null;
    this.mnemonic.set('');
    this.resetGoogleInputs();
    this.status.set('');
  }

  async copySagePairUri(uri: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(uri);
      this.status.set('Sage pairing link copied.');
    } catch {
      this.error.set('Could not copy pairing link. Select and copy it manually.');
    }
  }

  cancelChiaPairing(): void {
    this.chia.disconnect();
    this.busy.set(false);
    this.status.set('');
  }

  private msg(e: unknown): string {
    return formatError(e);
  }

  walletLabel(kind: 'evm' | 'chia' | 'google', fallback: string): string {
    return this.walletUx.lastWalletKind() === kind ? 'Last used' : fallback;
  }

  private async finishGoogleConnection(pubkey: string): Promise<void> {
    this.status.set(`Google vault unlocked ${this.short(pubkey)}`);
    this.walletUx.setLastWalletKind('google');
    this.googleMode.set('idle');
    await this.router.navigate(['/create-vault'], {
      queryParams: this.nextQueryParams('google'),
    });
  }

  private confirmedMnemonic(): boolean {
    const words = this.mnemonicWords();
    return this.confirmationIndices.every(
      (wordIndex, inputIndex) =>
        words[wordIndex] === this.confirmationWords[inputIndex].trim().toLowerCase(),
    );
  }

  private resetGoogleInputs(): void {
    this.password = '';
    this.confirmPassword = '';
    this.recoveryMnemonic = '';
    this.confirmationWords = ['', '', ''];
    this.googleVaultRiskAcknowledged = false;
  }

  private requireGoogleVaultRiskAcknowledgement(): boolean {
    if (this.googleVaultRiskAcknowledged) return true;
    this.error.set('Confirm the testnet-only in-memory signing risk before continuing.');
    return false;
  }

  private nextQueryParams(via: 'evm' | 'chia' | 'google'): Record<string, string> {
    const returnTo = this.returnTo();
    return returnTo ? { via, returnTo } : { via };
  }

  private short(value: string): string {
    return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
  }
}

function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
