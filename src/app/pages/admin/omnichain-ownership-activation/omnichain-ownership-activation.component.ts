import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminSessionService } from '../../../services/admin-session.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import {
  OmnichainOwnershipActivationService,
  OwnershipActivationStatus,
  OwnershipSafeApproval,
} from '../../../services/omnichain-ownership-activation.service';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'pp-omnichain-ownership-activation',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <main class="activation">
      <header class="page-header">
        <div>
          <div class="eyebrow">Alpha rail authority</div>
          <h1>Base Sepolia ownership handoff</h1>
          <p>Approve and schedule the sealed Safe-to-timelock operation.</p>
        </div>
        <div class="header-actions">
          <a routerLink="/admin/collections" class="btn btn--ghost">Collections</a>
          <button type="button" class="btn btn--ghost" (click)="reload()" [disabled]="loading()">
            Refresh
          </button>
        </div>
      </header>

      <section class="safety">
        <strong>Schedule phase only</strong>
        <span>
          This transaction does not move escrow funds. It starts the reviewed 24-hour delay
          before the timelock can accept ownership of the gateway and escrow spoke.
        </span>
      </section>

      @if (loading()) {
        <div class="state-panel mono">Verifying the sealed package and live Safe state…</div>
      } @else if (error()) {
        <section class="state-panel state-panel--error">
          <strong>Ownership handoff is unavailable</strong>
          <p>{{ error() }}</p>
          <button type="button" class="btn btn--ghost" (click)="reload()">Retry</button>
        </section>
      } @else if (status(); as operation) {
        <section class="status-strip" [attr.data-state]="operation.state">
          <div>
            <span>Current state</span>
            <strong>{{ stateLabel(operation.state) }}</strong>
          </div>
          <div>
            <span>Network</span>
            <strong>Base Sepolia · 84532</strong>
          </div>
          <div>
            <span>Delay</span>
            <strong>24 hours</strong>
          </div>
          <div>
            <span>Source</span>
            <strong class="mono">{{ short(operation.sourceSha, 12) }}</strong>
          </div>
        </section>

        <div class="work-grid">
          <section class="panel">
            <header class="panel-header">
              <div>
                <span class="step">1</span>
                <h2>Administrator approvals</h2>
              </div>
              <strong>{{ signedCount(operation) }} / 2</strong>
            </header>

            <div class="approval-list">
              @for (approval of operation.approvals; track approval.role) {
                <article class="approval" [class.is-signed]="approval.signed">
                  <span class="approval-mark">{{ approval.signed ? 'OK' : '—' }}</span>
                  <div class="approval-copy">
                    <strong>{{ roleLabel(approval.role) }}</strong>
                    <span class="mono">{{ short(approval.safe, 18) }}</span>
                    @if (approval.signed) {
                      <small>
                        Signed by {{ short(approval.signerAddress || '', 18) }}
                        · {{ approval.signedAt! * 1000 | date: 'medium' }}
                      </small>
                    } @else {
                      <small>{{ approval.allowedSigners.length }} eligible wallet{{ approval.allowedSigners.length === 1 ? '' : 's' }}</small>
                    }
                  </div>
                </article>
              }
            </div>

            <div class="wallet-box">
              <div>
                <span>Authenticated administrator</span>
                <strong class="mono">{{ short(subject() || '', 22) }}</strong>
              </div>
              <div>
                <span>Connected EVM wallet</span>
                <strong class="mono">{{ wallet.address() ? short(wallet.address()!, 22) : 'Not connected' }}</strong>
              </div>
              @if (!wallet.isConnected()) {
                <div class="connect-actions">
                  <button type="button" class="btn btn--ghost" (click)="connectInjected()" [disabled]="busy()">
                    Browser wallet
                  </button>
                  <button type="button" class="btn btn--ghost" (click)="connectWalletConnect()" [disabled]="busy()">
                    WalletConnect
                  </button>
                </div>
              }
            </div>

            @if (currentApproval(operation); as approval) {
              @if (!approval.signed) {
                <button
                  type="button"
                  class="btn btn--primary action-button"
                  (click)="sign(approval)"
                  [disabled]="busy() || !walletMatchesSession()"
                >
                  {{ busy() ? 'Waiting for wallet…' : 'Review and sign ' + roleLabel(approval.role) }}
                </button>
                @if (wallet.isConnected() && !walletMatchesSession()) {
                  <p class="inline-error">The connected wallet does not match this admin session.</p>
                }
              } @else {
                <p class="complete-note">Your required Safe approval is sealed.</p>
              }
            } @else {
              <p class="inline-note">This admin session is not an allowed signer for this operation.</p>
            }
          </section>

          <section class="panel">
            <header class="panel-header">
              <div>
                <span class="step">2</span>
                <h2>Schedule handoff</h2>
              </div>
              <strong>{{ operation.broadcast ? operation.broadcast.confirmations + ' conf.' : 'Not sent' }}</strong>
            </header>

            <dl class="evidence">
              <div><dt>Package</dt><dd class="mono" [title]="operation.packageHash">{{ short(operation.packageHash, 24) }}</dd></div>
              <div><dt>Operation</dt><dd class="mono" [title]="operation.operationId">{{ short(operation.operationId, 24) }}</dd></div>
              <div><dt>Root Safe</dt><dd class="mono" [title]="operation.rootSafe">{{ short(operation.rootSafe, 24) }}</dd></div>
              <div><dt>Timelock</dt><dd class="mono" [title]="operation.timelock">{{ short(operation.timelock, 24) }}</dd></div>
              <div><dt>Safe tx hash</dt><dd class="mono" [title]="operation.rootSafeTransactionHash">{{ short(operation.rootSafeTransactionHash, 24) }}</dd></div>
            </dl>

            @if (operation.state === 'READY_TO_BROADCAST' && operation.broadcastTransaction) {
              <p class="action-copy">
                Both authorities approved the fixed transaction. The connected administrator
                pays Base Sepolia gas; the signatures provide the authority.
              </p>
              <button
                type="button"
                class="btn btn--primary action-button"
                (click)="broadcast(operation)"
                [disabled]="busy() || !walletMatchesSession()"
              >
                {{ busy() ? 'Waiting for confirmation…' : 'Schedule 24-hour handoff' }}
              </button>
            } @else if (operation.state === 'AWAITING_APPROVALS') {
              <p class="inline-note">The broadcast remains locked until both Safe approvals are present.</p>
            } @else if (operation.scheduledFor) {
              <div class="scheduled">
                <span>Timelock execution opens</span>
                <strong>{{ operation.scheduledFor * 1000 | date: 'full' }}</strong>
                @if (operation.broadcast; as broadcast) {
                  <small class="mono">Tx {{ short(broadcast.transactionHash, 28) }}</small>
                }
              </div>
            }

            @if (pendingTransactionHash()) {
              <div class="pending">
                <span>Transaction submitted</span>
                <strong class="mono">{{ short(pendingTransactionHash()!, 28) }}</strong>
                <button type="button" (click)="confirmBroadcast()" [disabled]="busy()">
                  Check confirmation
                </button>
              </div>
            }
          </section>
        </div>

        @if (actionError()) {
          <section class="state-panel state-panel--error action-error">{{ actionError() }}</section>
        }
      }
    </main>
  `,
  styles: [
    `
      .activation { max-width: 1120px; margin: 0 auto; padding: 2.5rem var(--pad-x) 5rem; }
      .page-header { display:flex; align-items:flex-end; justify-content:space-between; gap:1.5rem; padding-bottom:1.5rem; border-bottom:1px solid var(--border); }
      .page-header h1 { font-family:var(--font-sans); font-size:clamp(1.65rem,4vw,2.4rem); letter-spacing:0; }
      .page-header p { color:var(--muted); font-size:.86rem; margin-top:.4rem; }
      .eyebrow { color:var(--accent); font:600 .66rem var(--font-mono); text-transform:uppercase; letter-spacing:.16em; margin-bottom:.45rem; }
      .header-actions,.connect-actions { display:flex; flex-wrap:wrap; gap:.55rem; }
      .safety { display:grid; grid-template-columns:auto 1fr; gap:1rem; margin:1rem 0; padding:.9rem 1rem; border:1px solid rgba(255,196,87,.3); background:rgba(255,196,87,.06); border-radius:6px; font-size:.76rem; }
      .safety strong { color:#ffd889; text-transform:uppercase; font:600 .65rem var(--font-mono); }
      .safety span { color:var(--muted); }
      .state-panel { padding:1.2rem; border:1px solid var(--border); border-radius:6px; color:var(--muted); }
      .state-panel--error { border-color:rgba(255,110,110,.35); background:rgba(255,110,110,.07); color:var(--text); }
      .state-panel--error p { color:var(--muted); margin:.45rem 0 1rem; }
      .status-strip { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border:1px solid var(--border); border-radius:6px; overflow:hidden; }
      .status-strip > div { padding:.85rem 1rem; border-right:1px solid var(--border); }
      .status-strip > div:last-child { border-right:0; }
      .status-strip span,.wallet-box span,.scheduled span,.pending span { display:block; color:var(--muted); font:500 .61rem var(--font-mono); text-transform:uppercase; margin-bottom:.28rem; }
      .status-strip strong { font-size:.78rem; }
      .work-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-top:1rem; align-items:start; }
      .panel { border:1px solid var(--border); border-radius:6px; padding:1rem; background:rgba(255,255,255,.018); }
      .panel-header { display:flex; justify-content:space-between; align-items:center; gap:1rem; padding-bottom:.85rem; border-bottom:1px solid var(--border); }
      .panel-header > div { display:flex; align-items:center; gap:.65rem; }
      .panel-header h2 { font-size:1rem; letter-spacing:0; }
      .panel-header > strong { color:var(--muted); font:500 .67rem var(--font-mono); }
      .step { display:inline-flex; width:1.65rem; height:1.65rem; align-items:center; justify-content:center; border:1px solid rgba(124,255,178,.35); color:var(--accent); font:600 .66rem var(--font-mono); }
      .approval-list { display:grid; gap:.55rem; margin:.85rem 0; }
      .approval { display:grid; grid-template-columns:2rem 1fr; gap:.7rem; padding:.75rem; border:1px solid var(--border); }
      .approval.is-signed { border-color:rgba(124,255,178,.28); background:rgba(124,255,178,.045); }
      .approval-mark { display:flex; width:2rem; height:2rem; align-items:center; justify-content:center; border:1px solid var(--border); color:var(--muted); font:600 .62rem var(--font-mono); }
      .is-signed .approval-mark { color:var(--accent); border-color:rgba(124,255,178,.35); }
      .approval-copy { min-width:0; }
      .approval-copy strong,.approval-copy span,.approval-copy small { display:block; }
      .approval-copy strong { font-size:.79rem; }
      .approval-copy span { color:var(--muted); font-size:.65rem; margin:.2rem 0; }
      .approval-copy small { color:var(--muted); font-size:.66rem; }
      .wallet-box { display:grid; gap:.65rem; padding:.8rem; border-top:1px solid var(--border); border-bottom:1px solid var(--border); }
      .wallet-box strong { font-size:.7rem; overflow-wrap:anywhere; }
      .evidence { margin:.85rem 0; }
      .evidence div { display:grid; grid-template-columns:7.2rem minmax(0,1fr); gap:.6rem; padding:.52rem 0; border-bottom:1px solid var(--border); }
      .evidence dt { color:var(--muted); font-size:.68rem; }
      .evidence dd { min-width:0; text-align:right; font-size:.67rem; overflow:hidden; text-overflow:ellipsis; }
      .action-copy,.inline-note,.inline-error,.complete-note { color:var(--muted); font-size:.72rem; line-height:1.5; margin:.9rem 0; }
      .inline-error { color:#ff9f9f; }
      .complete-note { color:var(--accent); }
      .action-button { width:100%; justify-content:center; min-height:2.65rem; }
      .scheduled,.pending { padding:.9rem; border:1px solid rgba(124,255,178,.28); background:rgba(124,255,178,.045); }
      .scheduled strong,.scheduled small,.pending strong { display:block; margin-top:.3rem; }
      .scheduled strong { font-size:.78rem; }
      .scheduled small,.pending strong { color:var(--muted); font-size:.66rem; overflow-wrap:anywhere; }
      .pending { margin-top:.75rem; border-color:rgba(44,231,255,.3); }
      .pending button { margin-top:.65rem; border:0; background:none; color:var(--accent); text-decoration:underline; cursor:pointer; }
      .action-error { margin-top:1rem; font-size:.74rem; }
      .mono { font-family:var(--font-mono); }
      @media (max-width: 760px) {
        .page-header { align-items:flex-start; flex-direction:column; }
        .status-strip { grid-template-columns:1fr 1fr; }
        .status-strip > div:nth-child(2) { border-right:0; }
        .status-strip > div:nth-child(-n+2) { border-bottom:1px solid var(--border); }
        .work-grid { grid-template-columns:1fr; }
        .safety { grid-template-columns:1fr; }
      }
    `,
  ],
})
export class OmnichainOwnershipActivationComponent {
  private readonly api = inject(OmnichainOwnershipActivationService);
  private readonly session = inject(AdminSessionService);
  readonly wallet = inject(EvmWalletService);

  readonly status = signal<OwnershipActivationStatus | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly pendingTransactionHash = signal<string | null>(null);
  readonly subject = this.session.subject;
  readonly walletMatchesSession = computed(() => {
    const wallet = this.wallet.address();
    const subject = this.subject();
    return !!wallet && !!subject && wallet.toLowerCase() === subject.toLowerCase();
  });

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.status.set(await this.api.get());
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.loading.set(false);
    }
  }

  async connectInjected(): Promise<void> {
    await this.run(async () => {
      await this.wallet.connectInjected();
    });
  }

  async connectWalletConnect(): Promise<void> {
    await this.run(async () => {
      await this.wallet.connectWalletConnect({
        optionalChains: 'solslot',
        resetSession: true,
      });
    });
  }

  async sign(approval: OwnershipSafeApproval): Promise<void> {
    await this.run(async () => {
      this.requireMatchingWallet();
      const signature = await this.wallet.signSafeMessage(
        approval.typedData,
        approval.safe,
      );
      this.status.set(await this.api.sign(signature));
    });
  }

  async broadcast(operation: OwnershipActivationStatus): Promise<void> {
    await this.run(async () => {
      this.requireMatchingWallet();
      if (!operation.broadcastTransaction) {
        throw new Error('The sealed Root Safe transaction is not ready.');
      }
      const transactionHash = await this.wallet.sendBaseSepoliaTransaction(
        operation.broadcastTransaction,
      );
      this.pendingTransactionHash.set(transactionHash);
      await this.confirmBroadcastWithRetry(transactionHash);
    });
  }

  async confirmBroadcast(): Promise<void> {
    const transactionHash = this.pendingTransactionHash();
    if (!transactionHash) return;
    await this.run(async () => {
      this.status.set(await this.api.recordBroadcast(transactionHash));
      this.pendingTransactionHash.set(null);
    });
  }

  currentApproval(operation: OwnershipActivationStatus): OwnershipSafeApproval | null {
    const subject = this.subject();
    if (!subject) return null;
    return (
      operation.approvals.find((approval) =>
        approval.allowedSigners.some(
          (address) => address.toLowerCase() === subject.toLowerCase(),
        ),
      ) ?? null
    );
  }

  signedCount(operation: OwnershipActivationStatus): number {
    return operation.approvals.filter((approval) => approval.signed).length;
  }

  roleLabel(role: OwnershipSafeApproval['role']): string {
    return role === 'owner_identity' ? 'Owner identity Safe' : 'Coadmin Safe';
  }

  stateLabel(state: OwnershipActivationStatus['state']): string {
    switch (state) {
      case 'AWAITING_APPROVALS': return 'Awaiting approvals';
      case 'READY_TO_BROADCAST': return 'Ready to schedule';
      case 'SCHEDULED': return '24-hour delay active';
      case 'READY_TO_EXECUTE': return 'Ready to accept ownership';
      case 'DONE': return 'Ownership activated';
    }
  }

  short(value: string, length: number): string {
    if (!value || value.length <= length) return value || '—';
    const half = Math.max(4, Math.floor((length - 1) / 2));
    return `${value.slice(0, half)}…${value.slice(-half)}`;
  }

  private requireMatchingWallet(): void {
    if (!this.walletMatchesSession()) {
      throw new Error('Connect the same EVM wallet used for this administrator session.');
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await action();
    } catch (error) {
      this.actionError.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async confirmBroadcastWithRetry(transactionHash: string): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      try {
        this.status.set(await this.api.recordBroadcast(transactionHash));
        this.pendingTransactionHash.set(null);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
    throw lastError ?? new Error('Base Sepolia confirmation is still pending.');
  }
}
