import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../services/session.service';

/** Polling cadence while the vault is still unconfirmed.  Testnet11 blocks
 *  are ~18s, so 5s keeps UI snappy without hammering coinset.org. */
const PENDING_POLL_MS = 5_000;

/** Fallback cadence once confirmed — much slower; we mostly watch for new
 *  deeds / balance changes.  30s is plenty. */
const CONFIRMED_POLL_MS = 30_000;

@Component({
  selector: 'pp-vault',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-16 pb-24 max-w-4xl">
      <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4">Your Vault</div>
      <h1 class="font-display text-4xl md:text-5xl">Vault dashboard</h1>

      @if (!session.session()) {
        <div class="card mt-10">
          <p class="text-text-muted">No active session. Connect a wallet to open or create your vault.</p>
          <a routerLink="/connect" class="btn btn--primary mt-4 inline-block">Connect Wallet</a>
        </div>
      } @else {
        <div class="grid gap-4 md:grid-cols-2 mt-10">
          <div class="card">
            <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Owner</div>
            <div class="mono text-sm mt-1 break-all">{{ session.session()!.address }}</div>
          </div>
          <div class="card">
            <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Launcher id</div>
            <div class="mono text-sm mt-1 break-all">{{ session.session()!.vaultLauncherId }}</div>
          </div>
        </div>

        <div class="mt-6 flex items-center gap-3">
          <button
            class="btn"
            (click)="manualRefresh()"
            [disabled]="refreshing()"
            type="button"
          >
            @if (refreshing()) { Refreshing… } @else { Refresh now }
          </button>
          @if (pending()) {
            <span class="mono text-xs text-text-muted inline-flex items-center gap-2">
              <span class="pp-dot"></span>
              Auto-polling every {{ pollCadenceSeconds() }}s
            </span>
          } @else if (session.vault()) {
            <span class="mono text-xs text-brand uppercase tracking-[0.15em]">Live</span>
          }
        </div>

        @if (session.vault(); as v) {
          <div class="card mt-8 space-y-3" [class.pp-pending]="!v.confirmed">
            <div class="flex items-baseline justify-between">
              <span class="uppercase text-xs tracking-[0.2em] text-text-muted">Confirmation</span>
              @if (v.confirmed) {
                <span class="mono text-sm text-brand">
                  confirmed at block {{ v.confirmed_block_index }}
                </span>
              } @else {
                <span class="mono text-sm inline-flex items-center gap-2 text-amber-300">
                  <span class="pp-spinner" aria-hidden="true"></span>
                  pending &mdash; waiting for testnet11 block
                </span>
              }
            </div>
            <div class="flex items-baseline justify-between">
              <span class="uppercase text-xs tracking-[0.2em] text-text-muted">Full puzzle hash</span>
              <span class="mono text-xs break-all">{{ v.vault_full_puzhash }}</span>
            </div>
            <div class="flex items-baseline justify-between">
              <span class="uppercase text-xs tracking-[0.2em] text-text-muted">p2_vault (deed holder)</span>
              <span class="mono text-xs break-all">{{ v.p2_vault_puzhash }}</span>
            </div>
            <div class="flex items-baseline justify-between">
              <span class="uppercase text-xs tracking-[0.2em] text-text-muted">XCH balance</span>
              <span class="mono text-sm">{{ v.balance.xch_mojos }} mojo</span>
            </div>
            <div class="flex items-baseline justify-between" *ngIf="v.current_coin_id">
              <span class="uppercase text-xs tracking-[0.2em] text-text-muted">Current coin id</span>
              <span class="mono text-xs break-all">{{ v.current_coin_id }}</span>
            </div>
          </div>

          <div class="mt-6">
            <div class="uppercase text-xs tracking-[0.2em] text-text-muted mb-3">Deeds held</div>
            @if (!v.balance.deeds || v.balance.deeds.length === 0) {
              <div class="card text-sm text-text-muted">No deeds yet.</div>
            } @else {
              <div class="grid gap-3">
                @for (deed of v.balance.deeds; track deed.launcher_id) {
                  <div class="card flex items-baseline justify-between">
                    <div>
                      <div class="font-display text-lg">{{ deed.asset_class }} · {{ deed.property_id }}</div>
                      <div class="mono text-xs text-text-muted mt-1">{{ deed.launcher_id }}</div>
                    </div>
                    <div class="text-right">
                      <div class="mono text-sm">{{ deed.par_value }}</div>
                      <div class="text-xs text-text-muted">{{ deed.jurisdiction }}</div>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }
      }
    </section>
  `,
  styles: [
    `
      .pp-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 10px rgba(124, 255, 178, 0.7);
        animation: pp-pulse 1.4s ease-in-out infinite;
      }
      @keyframes pp-pulse {
        0%, 100% { opacity: 0.35; transform: scale(0.9); }
        50%     { opacity: 1;    transform: scale(1.15); }
      }

      .pp-spinner {
        width: 0.85rem;
        height: 0.85rem;
        border: 2px solid rgba(252, 211, 77, 0.25);
        border-top-color: rgb(252, 211, 77);
        border-radius: 999px;
        animation: pp-spin 0.9s linear infinite;
        display: inline-block;
      }
      @keyframes pp-spin {
        to { transform: rotate(360deg); }
      }

      .pp-pending {
        position: relative;
        overflow: hidden;
      }
      .pp-pending::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(124, 255, 178, 0.08) 50%,
          transparent 100%
        );
        animation: pp-sweep 2.4s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes pp-sweep {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
    `,
  ],
})
export class VaultComponent implements OnDestroy {
  readonly session = inject(SessionService);
  readonly refreshing = signal(false);

  /** True while the current vault is still waiting for confirmation. */
  readonly pending = computed(() => {
    const v = this.session.vault();
    return !!v && !v.confirmed;
  });

  readonly pollCadenceSeconds = computed(() =>
    Math.round((this.pending() ? PENDING_POLL_MS : CONFIRMED_POLL_MS) / 1000)
  );

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly visibilityHandler = () => this.onVisibilityChange();

  constructor() {
    if (this.session.session() && !this.session.vault()) {
      void this.refresh();
    }

    // Re-schedule whenever pending state changes (faster cadence when pending).
    effect(() => {
      // Track both signals so the effect re-runs when either changes.
      this.pending();
      this.session.session();
      this.reschedulePoll();
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  ngOnDestroy(): void {
    this.clearPoll();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /** Manual refresh (button click). */
  async manualRefresh(): Promise<void> {
    await this.refresh();
    this.reschedulePoll();
  }

  private async refresh(): Promise<void> {
    if (!this.session.session()) return;
    this.refreshing.set(true);
    try {
      await this.session.refreshVault();
    } finally {
      this.refreshing.set(false);
    }
  }

  private reschedulePoll(): void {
    this.clearPoll();
    if (!this.session.session()) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const cadence = this.pending() ? PENDING_POLL_MS : CONFIRMED_POLL_MS;
    this.pollTimer = setTimeout(async () => {
      await this.refresh();
      this.reschedulePoll();
    }, cadence);
  }

  private clearPoll(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private onVisibilityChange(): void {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      this.clearPoll();
    } else {
      // Back to the tab — fire an immediate refresh then resume polling.
      void (async () => {
        await this.refresh();
        this.reschedulePoll();
      })();
    }
  }
}
