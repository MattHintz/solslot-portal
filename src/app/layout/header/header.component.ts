import { Component, EnvironmentInjector, inject } from '@angular/core';
import { AlphaObservabilityService } from '../../services/alpha-observability.service';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SessionService } from '../../services/session.service';

@Component({
  selector: 'pp-header',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <header class="sticky top-0 z-30 backdrop-blur bg-[rgba(2,11,11,0.82)] border-b border-[var(--border)]">
      <div class="container-p flex items-center justify-between py-4">
        <a routerLink="/" class="flex items-center gap-3 group">
          <span
            class="inline-block h-8 w-8 rounded-full bg-gradient-to-br from-[#7cffb2] to-[#00d3a7]
                   shadow-[0_0_40px_rgba(124,255,178,0.4)] group-hover:scale-105 transition-transform"
            aria-hidden="true"
          ></span>
          <span class="font-display text-xl tracking-tight">Solslot</span>
          <span class="mono text-[0.65rem] uppercase tracking-[0.2em] text-text-muted rounded border border-[var(--border)] px-2 py-0.5">
            Vault Console · Testnet Alpha
          </span>
        </a>
        <nav class="hidden lg:flex items-center gap-5 text-sm text-text-muted">
          <a routerLink="/" routerLinkActive="text-text" [routerLinkActiveOptions]="{ exact: true }" class="hover:text-text transition">Status</a>
          <a routerLink="/offers" routerLinkActive="text-text" class="hover:text-text transition">Offers</a>
          <a routerLink="/committee" routerLinkActive="text-text" class="hover:text-text transition">Committee</a>
          <a routerLink="/vault" routerLinkActive="text-text" class="hover:text-text transition" *ngIf="session.session()">My Vault</a>
          <a href="/" class="hover:text-text transition">Market</a>
          <a href="/dashboard/asset-overview" class="hover:text-text transition">Legacy Vault Login</a>
        </nav>
        <div class="flex items-center gap-3">
          <button class="btn btn--ghost hidden sm:inline-flex" (click)="reportBug()" type="button">Report bug</button>
          <ng-container *ngIf="session.session() as s; else connectBtn">
            <span class="mono text-xs text-text-muted hidden sm:inline">{{ shortAddr(s.address) }}</span>
            <button class="btn btn--ghost" (click)="disconnect()" type="button">Disconnect</button>
          </ng-container>
          <ng-template #connectBtn>
            <a routerLink="/connect" class="btn btn--primary">Vault Connect</a>
          </ng-template>
        </div>
      </div>
    </header>
  `,
})
export class HeaderComponent {
  readonly session = inject(SessionService);
  private readonly injector = inject(EnvironmentInjector);
  private readonly alphaObservability = inject(AlphaObservabilityService);

  shortAddr(addr: string): string {
    if (!addr) return '';
    if (addr.length <= 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  async reportBug(): Promise<void> {
    const summary = window.prompt('Briefly describe the issue.');
    if (!summary?.trim()) return;
    const description = window.prompt('Add any steps to reproduce the issue.') || summary;
    try {
      const id = await this.alphaObservability.reportBug({
        category: 'UI',
        summary: summary.trim(),
        description: description.trim(),
        diagnosticsOptIn: false,
      });
      window.alert(`Thank you. Your Alpha bug report is ${id}.`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Bug reporting failed.');
    }
  }

  async disconnect(): Promise<void> {
    const [{ EvmWalletService }, { ChiaWalletService }, { GoogleDriveVaultService }] = await Promise.all([
      import('../../services/evm-wallet.service'),
      import('../../services/chia-wallet.service'),
      import('../../services/google-drive-vault.service'),
    ]);
    await this.injector.get(EvmWalletService).disconnect();
    this.injector.get(ChiaWalletService).disconnect();
    await this.injector.get(GoogleDriveVaultService).disconnect();
    this.session.clear();
  }
}
