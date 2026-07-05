import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CoinsetService, BlockchainState } from '../../services/coinset.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'pp-footer',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <footer class="mt-24 border-t border-[var(--border)] bg-[rgba(0,0,0,0.32)]">
      <div class="container-p py-10 grid gap-8 lg:grid-cols-[1.15fr_0.85fr_0.85fr]">
        <div>
          <div class="mono text-[0.68rem] uppercase tracking-[0.24em] text-brand">
            Solslot Testnet Alpha
          </div>
          <div class="font-display text-2xl mt-2">Vault Console</div>
          <p class="mt-3 text-sm text-text-muted max-w-xl leading-relaxed">
            Operational surface for SmartDeeds, Vault custody, Committee Coin governance,
            identity readiness, and testnet execution. Built for clear queues, visible state,
            and fewer context switches.
          </p>
          <div class="mt-5 grid gap-2 text-xs mono text-text-muted sm:grid-cols-2">
            <div class="rounded-card border border-[var(--border)] bg-white/5 p-3">
              <span class="block uppercase tracking-[0.18em] text-text-muted">Network</span>
              <strong class="mt-1 block text-text">{{ network }}</strong>
            </div>
            <div class="rounded-card border border-[var(--border)] bg-white/5 p-3">
              <span class="block uppercase tracking-[0.18em] text-text-muted">Chain</span>
              <strong class="mt-1 block text-text">{{ chainHealth() ?? 'checking…' }}</strong>
            </div>
          </div>
        </div>
        <div>
          <div class="uppercase text-xs tracking-[0.2em] text-text-muted mb-3">Operations</div>
          <ul class="space-y-2 text-sm">
            <li><a href="/" class="hover:text-brand transition">Solslot market</a></li>
            <li><a routerLink="/connect" class="hover:text-brand transition">Vault Connect</a></li>
            <li><a routerLink="/committee" class="hover:text-brand transition">Committee Coin voting</a></li>
            <li><a href="/dashboard/asset-overview" class="hover:text-brand transition">Legacy Vault Login</a></li>
          </ul>
        </div>
        <div>
          <div class="uppercase text-xs tracking-[0.2em] text-text-muted mb-3">Operator</div>
          <ul class="space-y-2 text-sm mb-5">
            <li>
              <a routerLink="/admin/login" class="hover:text-brand transition">
                Operator desk
              </a>
            </li>
            <li>
              <a href="https://github.com/MattHintz/populis-protocol" target="_blank" rel="noopener" class="hover:text-brand transition">
                Protocol source
              </a>
            </li>
          </ul>
          <div class="uppercase text-xs tracking-[0.2em] text-text-muted mb-3">Legal</div>
          <p class="text-xs text-text-muted leading-relaxed">
            Solslot Protocol &copy; 2026 Matthew S. Hintz. All rights reserved.
            Testnet build for simulation and operator verification only. Not an offer
            of securities. No performance guarantees.
          </p>
        </div>
      </div>
    </footer>
  `,
})
export class FooterComponent {
  private readonly coinset = inject(CoinsetService);
  readonly network = environment.chiaNetwork;
  /**
   * Footer chain-state pill.  Hits coinset.org's
   * ``get_blockchain_state`` (the same RPC the portal uses for every
   * other on-chain read) and surfaces the current peak height as a
   * liveness signal.  Replaces the previous Populis-API ``/health``
   * probe (Phase 9-Hermes-D follow-up: only coinset + the faucet
   * remain as backend dependencies).
   */
  readonly chainHealth = (() => {
    let value: string | null = null;
    const sig = () => value;
    this.coinset
      .getBlockchainState()
      .then((s: BlockchainState) => {
        const peakHeight = s?.peak?.height ?? null;
        value = peakHeight !== null ? `ok · peak ${peakHeight}` : 'syncing';
      })
      .catch(() => {
        value = 'offline';
      });
    return sig;
  })();
}
