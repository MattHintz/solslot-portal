import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { EvmWalletService } from '../../services/evm-wallet.service';
import { ChiaWalletService } from '../../services/chia-wallet.service';
import { SessionService } from '../../services/session.service';

@Component({
  selector: 'pp-header',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <header class="sticky top-0 z-30 backdrop-blur bg-[rgba(2,11,11,0.7)] border-b border-[var(--border)]">
      <div class="container-p flex items-center justify-between py-4">
        <a routerLink="/" class="flex items-center gap-3 group">
          <span
            class="inline-block h-8 w-8 rounded-full bg-gradient-to-br from-[#7cffb2] to-[#00d3a7]
                   shadow-[0_0_40px_rgba(124,255,178,0.4)] group-hover:scale-105 transition-transform"
            aria-hidden="true"
          ></span>
          <span class="font-display text-xl tracking-tight">Populis</span>
          <span class="mono text-[0.65rem] uppercase tracking-[0.2em] text-text-muted rounded border border-[var(--border)] px-2 py-0.5">
            Genesis · Testnet
          </span>
        </a>
        <nav class="hidden md:flex items-center gap-6 text-sm text-text-muted">
          <a routerLink="/" routerLinkActive="text-text" [routerLinkActiveOptions]="{ exact: true }" class="hover:text-text transition">Genesis</a>
          <a routerLink="/vault" routerLinkActive="text-text" class="hover:text-text transition" *ngIf="session.session()">My Vault</a>
          <a href="https://populis.xyz" target="_blank" rel="noopener" class="hover:text-text transition">Learn</a>
        </nav>
        <div class="flex items-center gap-3">
          <ng-container *ngIf="session.session() as s; else connectBtn">
            <span class="mono text-xs text-text-muted hidden sm:inline">{{ shortAddr(s.address) }}</span>
            <button class="btn btn--ghost" (click)="disconnect()" type="button">Disconnect</button>
          </ng-container>
          <ng-template #connectBtn>
            <a routerLink="/connect" class="btn btn--primary">Connect Wallet</a>
          </ng-template>
        </div>
      </div>
    </header>
  `,
})
export class HeaderComponent {
  readonly session = inject(SessionService);
  private readonly evm = inject(EvmWalletService);
  private readonly chia = inject(ChiaWalletService);

  shortAddr(addr: string): string {
    if (!addr) return '';
    if (addr.length <= 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  async disconnect(): Promise<void> {
    await this.evm.disconnect();
    this.chia.disconnect();
    this.session.clear();
  }
}
