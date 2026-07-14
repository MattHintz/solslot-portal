import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { SessionService } from '../../services/session.service';
import {
  type VaultCredentialReceipt,
  type ZkPassportEnrollmentRecord,
} from '../../services/solslot-api.service';
import { VaultCredentialReceiptService } from '../../services/vault-credential-receipt.service';

const PENDING_POLL_MS = 5_000;
const CONFIRMED_POLL_MS = 30_000;

type CredentialState =
  | 'idle'
  | 'loading'
  | 'confirmed'
  | 'syncing'
  | 'unconfirmed'
  | 'unavailable';

@Component({
  selector: 'pp-vault',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p py-14 max-w-5xl">
      <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-3">
        Operator receipt view
      </div>
      <h1 class="font-display text-4xl md:text-5xl">Vault state</h1>
      <p class="text-text-muted mt-3 max-w-3xl">
        This console reads the current Chia vault coin and the server-indexed public
        credential receipt. Credential enrollment is completed from the Testnet Alpha
        customer vault; this console cannot create or relay proofs.
      </p>

      @if (!session.session()) {
        <div class="card mt-8">
          <p class="text-text-muted">No Testnet Alpha vault session is active.</p>
          <a
            class="btn btn--primary mt-4 inline-block"
            [routerLink]="['/connect']"
            [queryParams]="returnQueryParams()"
          >
            Connect a vault
          </a>
        </div>
      } @else {
        <div class="grid gap-4 md:grid-cols-2 mt-8">
          <div class="card">
            <div class="eyebrow">Owner</div>
            <div class="mono text-xs mt-2 break-all">{{ session.session()!.address }}</div>
          </div>
          <div class="card">
            <div class="eyebrow">Vault launcher</div>
            <div class="mono text-xs mt-2 break-all">{{ session.session()!.vaultLauncherId }}</div>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap items-center gap-3">
          <button class="btn" type="button" (click)="manualRefresh()" [disabled]="refreshing()">
            @if (refreshing()) { Refreshing... } @else { Refresh chain and receipt }
          </button>
          <span class="mono text-xs text-text-muted">
            Polling every {{ pollCadenceSeconds() }}s
          </span>
        </div>

        @if (session.vault(); as vault) {
          <div class="card mt-7 grid gap-4 md:grid-cols-2">
            <div>
              <div class="eyebrow">Chia state</div>
              <div class="font-display text-2xl mt-1">
                {{ vault.confirmed ? 'Current coin confirmed' : 'Waiting for confirmation' }}
              </div>
              @if (vault.confirmed_block_index !== null) {
                <div class="mono text-xs text-brand mt-2">
                  Block {{ vault.confirmed_block_index }}
                </div>
              }
            </div>
            <dl class="space-y-3 text-xs">
              <div>
                <dt class="eyebrow">Current coin</dt>
                <dd class="mono break-all mt-1">{{ vault.current_coin_id || 'Not indexed' }}</dd>
              </div>
              <div>
                <dt class="eyebrow">Puzzle hash</dt>
                <dd class="mono break-all mt-1">{{ vault.vault_full_puzhash }}</dd>
              </div>
            </dl>
          </div>

          <div class="card mt-7">
            <div class="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div class="eyebrow">zkPassport Chia stamp</div>
                @switch (credentialState()) {
                  @case ('loading') {
                    <h2 class="font-display text-2xl mt-1">Checking authoritative receipt</h2>
                  }
                  @case ('confirmed') {
                    <h2 class="font-display text-2xl text-brand mt-1">Confirmed on Chia</h2>
                  }
                  @case ('syncing') {
                    <h2 class="font-display text-2xl text-amber-200 mt-1">Receipt syncing</h2>
                  }
                  @case ('unavailable') {
                    <h2 class="font-display text-2xl text-red-300 mt-1">Receipt unavailable</h2>
                  }
                  @default {
                    <h2 class="font-display text-2xl mt-1">Not confirmed</h2>
                  }
                }
              </div>
              <span class="mono text-[0.68rem] uppercase tracking-[0.15em]">
                {{ credentialRecord()?.status || 'no receipt' }}
              </span>
            </div>

            @if (credentialError()) {
              <p class="text-sm text-red-300 mt-3">{{ credentialError() }}</p>
            }

            @if (credentialReceipt(); as receipt) {
              <dl class="grid gap-4 md:grid-cols-2 mt-5 text-xs">
                <div>
                  <dt class="eyebrow">Identity root</dt>
                  <dd class="mono break-all mt-1">{{ receipt.identityAttestRoot }}</dd>
                </div>
                <div>
                  <dt class="eyebrow">Policy</dt>
                  <dd class="mono mt-1">v{{ receipt.policyVersion }} · 18+ Alpha</dd>
                </div>
                <div>
                  <dt class="eyebrow">EVM proof transaction</dt>
                  <dd class="mono break-all mt-1">{{ receipt.evmTxHash }}</dd>
                </div>
                <div>
                  <dt class="eyebrow">Stamped Chia coin</dt>
                  <dd class="mono break-all mt-1">{{ receipt.chiaVaultCoinId }}</dd>
                </div>
              </dl>
            } @else {
              <p class="text-sm text-text-muted mt-3">
                Offers remain locked until the API proves that a confirmed receipt is bound
                to this exact current unspent vault coin.
              </p>
            }
          </div>

          <div class="mt-7">
            <div class="eyebrow mb-3">Deeds held</div>
            @if (!vault.balance.deeds?.length) {
              <div class="card text-sm text-text-muted">No deeds indexed.</div>
            } @else {
              <div class="grid gap-3">
                @for (deed of vault.balance.deeds; track deed.launcher_id) {
                  <div class="card">
                    <div class="font-display text-lg">{{ deed.asset_class }} · {{ deed.property_id }}</div>
                    <div class="mono text-xs text-text-muted mt-1 break-all">{{ deed.launcher_id }}</div>
                  </div>
                }
              </div>
            }
          </div>
        } @else {
          <div class="card mt-7 text-sm text-text-muted">
            The launcher has not resolved to a current Chia vault coin yet.
          </div>
        }
      }
    </section>
  `,
  styles: [
    `
      .eyebrow {
        font-family: var(--font-mono);
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.15em;
        color: var(--text-muted);
      }
    `,
  ],
})
export class VaultComponent implements OnDestroy {
  readonly session = inject(SessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly receipts = inject(VaultCredentialReceiptService);

  readonly refreshing = signal(false);
  readonly credentialState = signal<CredentialState>('idle');
  readonly credentialRecord = signal<ZkPassportEnrollmentRecord | null>(null);
  readonly credentialReceipt = signal<VaultCredentialReceipt | null>(null);
  readonly credentialError = signal<string | null>(null);
  readonly returnTo = signal<string | null>(
    safeReturnTo(this.route.snapshot.queryParamMap.get('returnTo')),
  );
  readonly pending = computed(() => {
    const vault = this.session.vault();
    return !!vault && !vault.confirmed;
  });
  readonly pollCadenceSeconds = computed(() =>
    Math.round((this.pending() ? PENDING_POLL_MS : CONFIRMED_POLL_MS) / 1000),
  );

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly visibilityHandler = () => this.onVisibilityChange();

  constructor() {
    if (this.session.session()) {
      void this.refresh();
    }
    effect(() => {
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

  returnQueryParams(): Record<string, string> | null {
    const target = this.returnTo();
    return target ? { returnTo: target } : null;
  }

  async manualRefresh(): Promise<void> {
    await this.refresh();
    this.reschedulePoll();
  }

  private async refresh(): Promise<void> {
    const active = this.session.session();
    if (!active) return;
    this.refreshing.set(true);
    this.credentialState.set('loading');
    this.credentialError.set(null);
    try {
      const vault = await this.session.refreshVault();
      const record = await this.receipts.refresh(active.vaultLauncherId);
      this.credentialRecord.set(record);
      const receipt = this.receipts.confirmedReceipt(
        active.vaultLauncherId,
        vault?.current_coin_id,
      );
      this.credentialReceipt.set(receipt);
      if (receipt) {
        this.credentialState.set('confirmed');
      } else if (record?.status === 'stamp_pending' || record?.status === 'receipt_syncing') {
        this.credentialState.set('syncing');
      } else {
        this.credentialState.set('unconfirmed');
      }
    } catch (error) {
      this.receipts.clear(active.vaultLauncherId);
      this.credentialRecord.set(null);
      this.credentialReceipt.set(null);
      this.credentialState.set('unavailable');
      this.credentialError.set(
        error instanceof Error
          ? error.message
          : 'The server could not prove the Chia credential receipt.',
      );
    } finally {
      this.refreshing.set(false);
    }
  }

  private reschedulePoll(): void {
    this.clearPoll();
    if (!this.session.session()) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const delay = this.pending() ? PENDING_POLL_MS : CONFIRMED_POLL_MS;
    this.pollTimer = setTimeout(async () => {
      await this.refresh();
      this.reschedulePoll();
    }, delay);
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
      return;
    }
    void this.manualRefresh();
  }
}

function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
