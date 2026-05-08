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
    <footer class="mt-24 border-t border-[var(--border)] bg-[rgba(0,0,0,0.25)]">
      <div class="container-p py-10 grid gap-6 md:grid-cols-3">
        <div>
          <div class="font-display text-lg">Populis</div>
          <p class="mt-2 text-sm text-text-muted">
            A private-members protocol for tokenized real-world assets on Chia.
          </p>
          <p class="mt-4 mono text-[0.7rem] text-text-muted">
            Network: <span class="text-text">{{ network }}</span><br />
            Chain: <span class="text-text">{{ chainHealth() ?? '…' }}</span>
          </p>
        </div>
        <div>
          <div class="uppercase text-xs tracking-[0.2em] text-text-muted mb-3">Protocol</div>
          <ul class="space-y-2 text-sm">
            <li><a href="https://populis.xyz" target="_blank" rel="noopener" class="hover:text-brand transition">Populis.xyz</a></li>
            <li><a href="https://github.com/MattHintz/populis-protocol" target="_blank" rel="noopener" class="hover:text-brand transition">Protocol source (GitHub)</a></li>
          </ul>
        </div>
        <div>
          <div class="uppercase text-xs tracking-[0.2em] text-text-muted mb-3">Legal</div>
          <p class="text-xs text-text-muted leading-relaxed">
            Populis Protocol &copy; 2026 Matthew S. Hintz. All rights reserved.
            Testnet build. Not an offer of securities. No guarantees.
          </p>
          <p class="mt-3 text-[0.65rem] text-text-muted">
            <a routerLink="/admin/login" class="hover:text-brand transition mono">
              admin desk →
            </a>
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
