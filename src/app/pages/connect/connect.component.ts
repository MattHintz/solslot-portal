import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { EvmWalletService } from '../../services/evm-wallet.service';
import { ChiaWalletService } from '../../services/chia-wallet.service';
import { WalletUxStateService } from '../../services/wallet-ux-state.service';
import { formatError } from '../../utils/format-error';

@Component({
  selector: 'pp-connect',
  standalone: true,
  imports: [CommonModule],
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
            Chia wallet, derive a Vault key from a signature, then continue into Vault
            creation, zkPassport readiness, and SmartDeed execution. We never ask for a
            seed phrase or private key.
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

      <div class="mt-10 grid gap-6 md:grid-cols-2">
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

  readonly busy = signal(false);
  readonly status = signal<string>('');
  readonly error = signal<string | null>(null);
  readonly sageWalletConnectUri = this.chia.sageWalletConnectUri;
  readonly restoringSageWalletConnect = this.chia.restoringSageWalletConnect;
  readonly returnTo = signal<string | null>(
    safeReturnTo(this.route.snapshot.queryParamMap.get('returnTo')),
  );

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

  walletLabel(kind: 'evm' | 'chia', fallback: string): string {
    return this.walletUx.lastWalletKind() === kind ? 'Last used' : fallback;
  }

  private nextQueryParams(via: 'evm' | 'chia'): Record<string, string> {
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
