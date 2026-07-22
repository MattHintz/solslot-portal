import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  AdminOperationApproval,
  AdminOperationApprovalService,
} from '../../../services/admin-operation-approval.service';

@Component({
  selector: 'app-admin-approvals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="approval-desk">
      <header>
        <span class="eyebrow">OWNER-REQUIRED AUTHORITY</span>
        <h1>Admin Approvals</h1>
        <p>Load the operation ID supplied by the initiating administrator. Review the exact request before signing or executing it.</p>
      </header>

      <section class="lookup" aria-label="Load admin operation">
        <label for="operation-id">Operation ID</label>
        <div>
          <input id="operation-id" [(ngModel)]="operationId" placeholder="0x..." autocomplete="off" />
          <button type="button" (click)="load()" [disabled]="busy()">Load</button>
        </div>
      </section>

      @if (error()) {
        <p class="notice notice--error">{{ error() }}</p>
      }

      @if (approval(); as item) {
        <section class="review" aria-label="Admin operation review">
          <div class="status-row">
            <strong>{{ item.operation }}</strong>
            <span [class.is-ready]="item.status === 'approved'">{{ item.status }}</span>
          </div>
          <dl>
            <div><dt>Operation ID</dt><dd class="mono">{{ item.operationId }}</dd></div>
            <div><dt>Request</dt><dd>{{ item.requestBinding.method }} {{ item.requestBinding.path }}</dd></div>
            <div><dt>Payload hash</dt><dd class="mono">{{ item.payloadHash }}</dd></div>
            <div><dt>Authority</dt><dd class="mono">{{ item.authorityLauncherId }}</dd></div>
            <div><dt>Network</dt><dd>{{ item.network }}</dd></div>
            <div><dt>Revision</dt><dd>{{ item.revision }}</dd></div>
            <div><dt>Nonce</dt><dd class="mono">{{ item.nonce }}</dd></div>
            <div><dt>If-Match</dt><dd class="mono">{{ item.requestBinding.ifMatch || 'none' }}</dd></div>
            <div><dt>Expires</dt><dd>{{ item.expiresAt * 1000 | date:'medium' }}</dd></div>
          </dl>
          @if (item.requestBinding.query.length) {
            <details>
              <summary>Exact query parameters</summary>
              <pre>{{ item.requestBinding.query | json }}</pre>
            </details>
          }
          <details>
            <summary>Exact request body</summary>
            <pre>{{ item.requestBinding.body | json }}</pre>
          </details>
          <div class="signers">
            @for (signature of item.signatures; track signature.adminIndex) {
              <span>Slot {{ signature.adminIndex }} signed</span>
            }
          </div>
          <div class="actions">
            <button type="button" (click)="sign()" [disabled]="busy() || item.status === 'consumed'">Sign as this admin</button>
            <button type="button" class="primary" (click)="execute()" [disabled]="busy() || item.status !== 'approved'">Execute approved request</button>
          </div>
        </section>
      }
    </main>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #06110f; color: #eefbf5; }
    .approval-desk { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 80px; }
    header { border-bottom: 1px solid #245144; padding-bottom: 24px; }
    .eyebrow { color: #67e7ad; font: 700 12px/1.2 monospace; }
    h1 { margin: 8px 0; font-size: 34px; letter-spacing: 0; }
    p { color: #a9c2b8; max-width: 720px; }
    .lookup, .review { margin-top: 24px; border: 1px solid #245144; padding: 20px; background: #0a1a16; }
    label, dt { color: #8fb5a6; font-size: 12px; }
    .lookup > div { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 8px; }
    input { min-width: 0; border: 1px solid #356858; background: #04100d; color: white; padding: 11px; font-family: monospace; }
    button { border: 1px solid #4f8d77; background: #123329; color: white; padding: 10px 14px; cursor: pointer; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button.primary { background: #56d69c; color: #04100d; font-weight: 700; }
    .status-row { display: flex; justify-content: space-between; gap: 16px; }
    .status-row span { color: #f0ca67; text-transform: uppercase; font: 700 12px monospace; }
    .status-row span.is-ready { color: #67e7ad; }
    dl { display: grid; gap: 12px; margin: 22px 0; }
    dl div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .mono, pre { font-family: monospace; }
    pre { overflow: auto; padding: 12px; background: #04100d; color: #bce8d5; }
    .signers { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
    .signers span { border: 1px solid #356858; padding: 6px 9px; font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
    .notice--error { border: 1px solid #844f4f; color: #ffc4c4; padding: 12px; }
    @media (max-width: 600px) { dl div { grid-template-columns: 1fr; gap: 3px; } .lookup > div { grid-template-columns: 1fr; } }
  `],
})
export class AdminApprovalsComponent {
  private readonly api = inject(AdminOperationApprovalService);
  operationId = '';
  readonly approval = signal<AdminOperationApproval | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async load(): Promise<void> {
    if (!this.operationId.trim()) return;
    await this.run(async () => this.api.get(this.operationId.trim()));
  }

  async sign(): Promise<void> {
    const current = this.approval();
    if (!current) return;
    await this.run(async () => this.api.sign(current.operationId, current.typedData));
  }

  async execute(): Promise<void> {
    const current = this.approval();
    if (!current) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.execute(current);
      this.approval.set(await this.api.get(current.operationId));
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async run(action: () => Promise<AdminOperationApproval>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.approval.set(await action());
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'Admin approval request failed.';
}
