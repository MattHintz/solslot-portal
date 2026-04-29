import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { EvmWalletService } from '../../services/evm-wallet.service';
import { ChiaWalletService } from '../../services/chia-wallet.service';
import { formatError } from '../../utils/format-error';

@Component({
  selector: 'pp-connect',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="container-p pt-16 pb-24 max-w-3xl">
      <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4">Step 1 of 2</div>
      <h1 class="font-display text-4xl md:text-5xl">Connect a wallet.</h1>
      <p class="mt-4 text-text-muted max-w-xl">
        Choose one. You can always link the other later. Your Populis vault
        key is derived from a signature &mdash; we never ask for a seed phrase
        or private key.
      </p>

      <div class="mt-10 grid gap-6 md:grid-cols-2">
        <button
          class="card text-left hover:border-brand hover:shadow-glow transition disabled:opacity-60"
          (click)="connectEvm()"
          [disabled]="busy()"
          type="button"
        >
          <div class="flex items-center gap-3">
            <span class="text-2xl">⟠</span>
            <span class="font-display text-2xl">EVM wallet</span>
          </div>
          <p class="mt-3 text-sm text-text-muted leading-relaxed">
            MetaMask, Coinbase Wallet, Rabby, or any WalletConnect-compatible
            wallet. Works entirely via EIP-712 signatures.
          </p>
          <div class="mt-4 mono text-xs text-brand uppercase tracking-[0.15em]">
            Recommended
          </div>
        </button>

        <button
          class="card text-left hover:border-brand hover:shadow-glow transition disabled:opacity-60"
          (click)="connectChia()"
          [disabled]="busy()"
          type="button"
        >
          <div class="flex items-center gap-3">
            <span class="text-2xl">🌱</span>
            <span class="font-display text-2xl">Chia wallet</span>
          </div>
          <p class="mt-3 text-sm text-text-muted leading-relaxed">
            Sage or Goby browser extension. Uses a native BLS signature and
            lets you spend XCH directly from your own wallet.
          </p>
          <div class="mt-4 mono text-xs text-text-muted uppercase tracking-[0.15em]">
            Advanced · requires testnet XCH
          </div>
        </button>
      </div>

      @if (error()) {
        <div class="mt-6 rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {{ error() }}
        </div>
      }

      @if (busy()) {
        <div class="mt-6 mono text-sm text-text-muted">
          {{ status() }}
        </div>
      }
    </section>
  `,
})
export class ConnectComponent {
  private readonly evm = inject(EvmWalletService);
  private readonly chia = inject(ChiaWalletService);
  private readonly router = inject(Router);

  readonly busy = signal(false);
  readonly status = signal<string>('');
  readonly error = signal<string | null>(null);

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
      await this.router.navigate(['/create-vault'], { queryParams: { via: 'evm' } });
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
      if (this.chia.hasGoby()) {
        await this.chia.connectGoby();
      } else if (this.chia.hasSage()) {
        await this.chia.connectSage();
      } else {
        throw new Error('No Chia wallet extension detected (Goby or Sage)');
      }
      await this.router.navigate(['/create-vault'], { queryParams: { via: 'chia' } });
    } catch (e) {
      this.error.set(this.msg(e));
    } finally {
      this.busy.set(false);
    }
  }

  private msg(e: unknown): string {
    return formatError(e);
  }
}
