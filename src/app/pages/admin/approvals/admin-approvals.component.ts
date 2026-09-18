import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import {
  AdminOperationApproval,
  AdminOperationApprovalService,
  AdminOperationName,
} from '../../../services/admin-operation-approval.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'app-admin-approvals',
  standalone: true,
  imports: [CommonModule, AdminWorkspaceNavComponent],
  template: `
    <solslot-admin-workspace-nav />
    <main class="approval-desk">
      <header class="desk-header">
        <div>
          <span class="eyebrow">Administrator decisions</span>
          <h1>Approval inbox</h1>
          <p>Approve only after the purpose, effect, and wallet request all agree.</p>
        </div>
        <div class="header-actions">
          <button type="button" class="button button--quiet" (click)="reload()" [disabled]="busy()">
            Refresh
          </button>
        </div>
      </header>

      <aside class="ux-context"><strong>Two approvals, including the owner</strong><p>Read the receipt, compare the wallet request, then approve only if both agree. Approval records consent; execution is a separate action. Committee voting is also separate.</p></aside>
      @if (error()) {
        <div class="notice notice--error" role="alert">
          <strong>Approval inbox needs attention</strong>
          <span>{{ error() }}</span>
        </div>
      }

      <div class="approval-layout">
        <section class="inbox" aria-labelledby="inbox-title">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Assigned work</span>
              <h2 id="inbox-title">Open approvals</h2>
            </div>
            <strong>{{ operations().length }}</strong>
          </div>
          @if (loading()) {
            <p class="empty">Loading approvals...</p>
          } @else if (error() && !operations().length) {
            <p class="empty">Refresh to check whether any approvals are waiting.</p>
          } @else if (!operations().length) {
            <div class="empty">
              <strong>Nothing is waiting</strong>
              <span>New owner-plus-one requests will appear here automatically.</span>
            </div>
          } @else {
            <div class="operation-list">
              @for (item of operations(); track item.operationId) {
                <button
                  type="button"
                  class="operation-row"
                  [class.is-selected]="approval()?.operationId === item.operationId"
                  (click)="select(item)"
                >
                  <span [class]="statusClass(item.status)">{{ statusLabel(item) }}</span>
                  <span>
                    <strong>{{ operationLabel(item.operation) }}</strong>
                    <small>{{ operationContext(item) }}</small>
                  </span>
                  <time>{{ item.createdAt * 1000 | date: 'MMM d, h:mm a' }}</time>
                </button>
              }
            </div>
          }
        </section>

        <section class="review" aria-labelledby="review-title">
          @if (approval(); as item) {
            <span class="eyebrow">Decision receipt</span>
            <h2 id="review-title">{{ operationLabel(item.operation) }}</h2>
            <p>{{ operationDescription(item.operation) }}</p>

            <dl class="decision-grid">
              <div>
                <dt>Network</dt>
                <dd>{{ item.network === 'testnet11' ? 'Testnet11' : item.network }}</dd>
              </div>
              <div>
                <dt>Requested by</dt>
                <dd>{{ shortWallet(item.createdBy) }}</dd>
              </div>
              <div>
                <dt>Approvals</dt>
                <dd>{{ item.signatures.length }} of 2 required · owner required</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{{ item.expiresAt * 1000 | date: 'medium' }}</dd>
              </div>
            </dl>

            <div class="impact">
              <strong>{{ operationImpact(item.operation) }}</strong>
              <span>{{ operationContext(item) }}</span>
            </div>

            <div class="signing-check">
              <strong>Before signing</strong>
              <span>Confirm the wallet shows the same network and action described above.</span>
              <span>Reject unexpected payments, approvals, recipients, or recovery-phrase requests.</span>
            </div>

            @if (item.operation === 'mint.publish') {
              <p>Publishing requires the owner administrator and one coadministrator.
                You will sign the exact mint transaction approval and its matching request approval.
                The selected vault's SGT stays locked until the voting deadline.</p>
              <dl class="decision-grid">
                @for (field of mintReview(item); track field.label) {
                  <div><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div>
                }
              </dl>
            }

            <div class="signers" aria-label="Recorded signatures">
              @for (signature of item.signatures; track signature.adminIndex) {
                <span>Administrator {{ signature.adminIndex + 1 }} approved</span>
              }
              @if (!item.signatures.length) {
                <span>No approvals recorded</span>
              }
            </div>

            <details>
              <summary>Technical evidence</summary>
              <dl class="technical-grid">
                <div><dt>Operation ID</dt><dd>{{ item.operationId }}</dd></div>
                <div><dt>Payload hash</dt><dd>{{ item.payloadHash }}</dd></div>
                <div><dt>Authority</dt><dd>{{ item.authorityLauncherId }}</dd></div>
                <div>
                  <dt>Exact request</dt>
                  <dd>{{ item.requestBinding.method }} {{ item.requestBinding.path }}</dd>
                </div>
              </dl>
              <pre>{{ item.requestBinding.body | json }}</pre>
            </details>

            <div class="actions">
              @if (!signedByCurrentAdmin(item)) {
                <button
                  type="button"
                  class="button button--quiet"
                  (click)="sign()"
                  [disabled]="busy() || item.status === 'consumed'"
                >
                  Approve this request
                </button>
              }
              <button
                type="button"
                class="button button--primary"
                (click)="execute()"
                [disabled]="busy() || !canComplete(item)"
              >
                Complete approved action
              </button>
              @if (item.operation === 'mint.publish' && item.createdBy.toLowerCase() !== currentSubject()) {
                <p>The original proposer completes this mint after both approvals are recorded.</p>
              }
            </div>
          } @else {
            <div class="empty empty--review">
              <strong>Select an approval</strong>
              <span>The decision receipt will appear here.</span>
            </div>
          }
        </section>
      </div>
    </main>
  `,
  styles: [
    `
      :host { display:block; min-height:100vh; background:#06110f; color:#eefbf5; }
      .approval-desk { width:min(1180px,calc(100% - 32px)); margin:0 auto; padding:42px 0 80px; }
      .desk-header,.section-heading,.actions,.header-actions { display:flex; align-items:center; justify-content:space-between; gap:16px; }
      .desk-header { align-items:flex-end; padding-bottom:22px; border-bottom:1px solid #245144; }
      .eyebrow { color:#67e7ad; font:700 11px/1.2 monospace; text-transform:uppercase; }
      h1,h2 { letter-spacing:0; } h1 { margin:7px 0; font-size:34px; } h2 { margin:5px 0 0; font-size:22px; }
      p,.empty span,.operation-row small,.impact span { color:#a9c2b8; }
      .approval-layout { display:grid; grid-template-columns:minmax(320px,.8fr) minmax(0,1.2fr); gap:18px; margin-top:20px; }
      .inbox,.review { border:1px solid #245144; background:#0a1a16; min-height:420px; }
      .inbox { padding:18px; } .review { padding:24px; }
      .operation-list { display:grid; gap:1px; margin-top:16px; background:#245144; }
      .operation-row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:12px; width:100%; padding:13px; border:0; background:#081612; color:inherit; text-align:left; cursor:pointer; }
      .operation-row:hover,.operation-row.is-selected { background:#123329; }
      .operation-row span:nth-child(2) { display:grid; gap:3px; min-width:0; }
      .operation-row time { color:#77998c; font:11px monospace; }
      .status { padding:4px 6px; border:1px solid #4f8d77; color:#f0ca67; font:700 10px monospace; }
      .status--approved { color:#67e7ad; }
      .decision-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; margin:22px 0; background:#245144; border:1px solid #245144; }
      .decision-grid div { padding:13px; background:#081612; }
      dt { color:#8fb5a6; font-size:11px; } dd { margin:4px 0 0; overflow-wrap:anywhere; }
      .impact { display:grid; gap:5px; padding:15px; border-left:3px solid #67e7ad; background:#0d241d; }
      .signing-check { display:grid; gap:4px; margin-top:12px; padding:13px; border-left:3px solid #77bce3; background:#091b1d; font-size:11px; }
      .signing-check span { color:#a9c2b8; }
      .signers { display:flex; flex-wrap:wrap; gap:7px; margin:18px 0; }
      .signers span { border:1px solid #356858; padding:6px 9px; font-size:11px; }
      details { margin-top:18px; border-top:1px solid #245144; padding-top:14px; }
      summary { cursor:pointer; color:#a9c2b8; font-size:12px; }
      .technical-grid { display:grid; gap:8px; margin-top:12px; font-family:monospace; font-size:11px; }
      pre { max-height:220px; overflow:auto; padding:12px; background:#04100d; color:#bce8d5; font:11px monospace; }
      .actions { justify-content:flex-end; margin-top:22px; }
      .button { display:inline-flex; align-items:center; justify-content:center; border:1px solid #4f8d77; padding:10px 14px; background:#123329; color:white; cursor:pointer; text-decoration:none; }
      .button--primary { background:#56d69c; color:#04100d; font-weight:700; }
      .button:disabled { opacity:.45; cursor:not-allowed; }
      .empty { display:grid; place-content:center; gap:5px; min-height:260px; text-align:center; color:#eefbf5; }
      .empty--review { min-height:360px; }
      .notice { display:grid; gap:4px; margin-top:16px; padding:12px; border:1px solid #844f4f; color:#ffc4c4; }
      @media (max-width:800px) { .approval-layout { grid-template-columns:1fr; } .desk-header { align-items:flex-start; flex-direction:column; } }
      @media (max-width:520px) { .decision-grid { grid-template-columns:1fr; } .operation-row { grid-template-columns:auto 1fr; } .operation-row time { grid-column:2; } }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminApprovalsComponent {
  private readonly api = inject(AdminOperationApprovalService);
  private readonly session = inject(AdminSessionService);

  readonly operations = signal<AdminOperationApproval[]>([]);
  readonly approval = signal<AdminOperationApproval | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly currentSubject = computed(() => this.session.subject()?.toLowerCase() ?? '');

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.api.list('active');
      this.operations.set(result.operations);
      const selected = this.approval();
      this.approval.set(
        selected
          ? result.operations.find((item) => item.operationId === selected.operationId) ?? null
          : result.operations[0] ?? null,
      );
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.loading.set(false);
    }
  }

  select(item: AdminOperationApproval): void {
    this.approval.set(item);
  }

  async sign(): Promise<void> {
    const current = this.approval();
    if (!current) return;
    await this.run(async () => this.api.sign(current.operationId, current.typedData));
  }

  async execute(): Promise<void> {
    const current = this.approval();
    if (!current || !this.canComplete(current)) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.execute(current);
      await this.reload();
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }

  signedByCurrentAdmin(item: AdminOperationApproval): boolean {
    return item.signatures.some(
      (signature) => signature.signerAddress.toLowerCase() === this.currentSubject(),
    );
  }

  canComplete(item: AdminOperationApproval): boolean {
    return item.status === 'approved' && this.signedByCurrentAdmin(item) &&
      (item.operation !== 'mint.publish' || item.createdBy.toLowerCase() === this.currentSubject());
  }

  operationLabel(operation: AdminOperationName): string {
    const labels: Record<AdminOperationName, string> = {
      'bridge.top-up': 'Top up bridge capacity',
      'collection.amend': 'Publish collection update',
      'collection.seal': 'Seal investor dossier',
      'mint.cancel': 'Cancel mint proposal',
      'mint.execute': 'Execute approved SmartDeed mint',
      'mint.publish': 'Publish SmartDeed proposal',
      'sgt.allocate': 'Open or complete SGT allocation vote',
      'presale.create': 'Create refundable presale',
      'presale.cancel': 'Cancel refundable presale',
      'presale.launch': 'Open presale delivery',
    };
    return labels[operation];
  }

  operationDescription(operation: AdminOperationName): string {
    if (operation.startsWith('collection.')) {
      return 'Changes the shared investor dossier after independent administrator review.';
    }
    if (operation.startsWith('mint.')) {
      return 'Changes a governed SmartDeed issuance proposal on Testnet11.';
    }
    if (operation === 'sgt.allocate') {
      return 'Moves a fixed SGT allocation from the company reserve only after committee approval.';
    }
    if (operation.startsWith('presale.')) {
      return 'Changes a refundable testnet voucher campaign and its customer fulfillment state.';
    }
    return 'Changes the reviewed protocol payment capacity on Testnet11.';
  }

  operationImpact(operation: AdminOperationName): string {
    return operation.includes('cancel')
      ? 'This stops the selected testnet operation.'
      : 'No production investment or mainnet asset is affected.';
  }

  operationContext(item: AdminOperationApproval): string {
    const path = item.requestBinding.path;
    const segments = path.split('/').filter(Boolean);
    return segments.at(-2) === 'collections'
      ? `Collection ${segments.at(-1)}`
      : segments.at(-1)?.replaceAll('-', ' ') || 'Protocol operation';
  }

  mintReview(item: AdminOperationApproval): Array<{ label: string; value: string }> {
    const body = item.requestBinding.body as Record<string, unknown> | null;
    const metadata = body?.['proposal_metadata'] as Record<string, unknown> | undefined;
    return [
      { label: 'Property', value: String(metadata?.['property_id'] ?? '') },
      { label: 'Collection', value: String(metadata?.['collection_id'] ?? '') },
      { label: 'SGT stake vault', value: String(body?.['stake_vault_launcher_id'] ?? '') },
      { label: 'Voting deadline', value: metadata?.['voting_deadline']
        ? new Date(Number(metadata['voting_deadline']) * 1000).toISOString() : '' },
    ];
  }

  statusLabel(item: AdminOperationApproval): string {
    return item.status === 'approved' ? 'Ready' : 'Needs approval';
  }

  statusClass(status: string): string {
    return `status status--${status}`;
  }

  shortWallet(value: string): string {
    return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
  }

  private async run(action: () => Promise<AdminOperationApproval>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.approval.set(await action());
      await this.reload();
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
