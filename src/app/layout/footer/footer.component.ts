import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PopulisApiService } from '../../services/populis-api.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'pp-footer',
  standalone: true,
  imports: [CommonModule],
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
            API: <span class="text-text">{{ apiHealth() ?? '…' }}</span>
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
        </div>
      </div>
    </footer>
  `,
})
export class FooterComponent {
  private readonly api = inject(PopulisApiService);
  readonly network = environment.chiaNetwork;
  readonly apiHealth = (() => {
    let value: string | null = null;
    const sig = () => value;
    this.api
      .health()
      .then((h) => {
        value = `ok · peak ${h.peak_height ?? '?'}`;
      })
      .catch(() => {
        value = 'offline';
      });
    return sig;
  })();
}
