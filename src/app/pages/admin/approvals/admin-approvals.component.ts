import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import {
  AdminOperationApproval,
  AdminOperationApprovalService,
  AdminOperationName,
} from '../../../services/admin-operation-approval.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { AdminStatusRefresh } from '../../../services/admin-status-refresh.service';
import { AdminRefreshStatusComponent } from '../../../components/admin-workspace/admin-refresh-status.component';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'app-admin-approvals',
  standalone: true,
  imports: [CommonModule, AdminWorkspaceNavComponent, AdminRefreshStatusComponent],
  providers: [AdminStatusRefresh],
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
          @if (canPrepareIdentity()) {
            <button type="button" class="button button--primary" (click)="prepareIdentity()" [disabled]="busy() || refresh.refreshing()">
              Review identity upgrade
            </button>
          }
        </div>
      </header>
      <solslot-admin-refresh-status [state]="refresh" />

      <aside class="ux-context"><strong>Two approvals, including the owner</strong><p>Read the receipt, compare the wallet request, then approve only if both agree. Approval records consent; execution is a separate action. Committee voting is also separate.</p></aside>
      @if (error()) {
        <div class="notice notice--error" role="alert">
          <strong>Approval inbox needs attention</strong>
          <span>{{ error() }}</span>
        </div>
      }
      @if (busy()) {
        <div class="pending-state" role="status" aria-live="polite">
          <strong>{{ actionMessage() }}</strong>
          <span>{{ actionHint() }}</span>
        </div>
      }
      @if (notice()) { <p class="pending-state" role="status">{{ notice() }}</p> }

      <div class="approval-layout">
        <section class="inbox" aria-labelledby="inbox-title">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Assigned work</span>
              <h2 id="inbox-title">Open approvals</h2>
            </div>
            <strong>{{ operations().length }}</strong>
          </div>
          @if (loading() && !operations().length) {
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
                  [disabled]="busy()"
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
                <dt>Request expires</dt>
                <dd>{{ item.expiresAt * 1000 | date: 'medium' }}</dd>
              </div>
            </dl>

            <div class="pending-state" role="status">
              <strong>{{ nextStep(item) }}</strong>
              @if (expired(item)) {
                <span>This request cannot be signed or executed. The owner can open a fresh review.</span>
              } @else {
                <span>{{ remaining(item) }} · The inbox checks for new approvals automatically.</span>
              }
            </div>

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

            @if (item.operation === 'identity.activate') {
              <section class="identity-review" aria-label="Identity verifier activation details">
                <strong>New private ID checks</strong>
                <p>Future vault checks use the replacement contracts below. Existing vault receipts keep their original verifier binding.</p>
                @if (reviewReady(item)) { <dl class="decision-grid">
                  @for (field of identityReview(item); track field.label) {
                    <div><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div>
                  }
                </dl> } @else { <p>The complete network and contract review is not available yet. Refresh before signing.</p> }
              </section>
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
                  [disabled]="busy() || refresh.refreshing() || expired(item) || item.status === 'consumed' || !reviewReady(item)"
                >
                  Approve this request
                </button>
              }
              <button
                type="button"
                class="button button--primary"
                (click)="execute()"
                [disabled]="busy() || refresh.refreshing() || !canComplete(item)"
              >
                {{ item.operation === 'identity.activate' ? 'Activate identity checks' : 'Complete approved action' }}
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
      .identity-review { margin-top:18px; padding:15px; border:1px solid #356858; background:#081612; }
      .identity-review p { margin-bottom:0; }
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
      .pending-state { display:grid; gap:5px; margin:16px 0; padding:13px; border-left:3px solid #7dc9ec; background:#0d251e; color:#d2e9dd; }
      @media (max-width:800px) { .approval-layout { grid-template-columns:1fr; } .desk-header { align-items:flex-start; flex-direction:column; } }
      @media (max-width:520px) { .decision-grid { grid-template-columns:1fr; } .operation-row { grid-template-columns:auto 1fr; } .operation-row time { grid-column:2; } }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminApprovalsComponent {
  private readonly api = inject(AdminOperationApprovalService);
  private readonly session = inject(AdminSessionService);
  readonly refresh = inject(AdminStatusRefresh);

  readonly operations = signal<AdminOperationApproval[]>([]);
  readonly approval = signal<AdminOperationApproval | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly actionMessage = signal('Preparing your review…');
  readonly actionHint = signal('Checking the exact request with the server.');
  readonly currentSubject = computed(() => this.session.subject()?.toLowerCase() ?? '');

  constructor() {
    this.refresh.start(() => this.loadApprovals(), () => this.busy()
      ? 'Updates paused while your action is in progress.'
      : this.session.isAuthenticated?.() === false ? 'Sign in again to resume updates.' : null);
  }

  async reload(): Promise<void> {
    await this.refresh.refresh();
  }

  private async loadApprovals(): Promise<void> {
    this.loading.set(!this.refresh.lastUpdated());
    this.error.set(null);
    try {
      const result = await this.api.list('active');
      this.operations.set(result.operations);
      const selected = this.approval();
      const next =
        selected
          ? result.operations.find((item) => item.operationId === selected.operationId) ??
            (this.expired(selected) ? selected : null)
          : result.operations[0] ?? null;
      this.approval.set(next);
      if (next && !this.expired(next) && ['identity.activate', 'mint.publish'].includes(next.operation)) {
        // The list is intentionally lightweight; GET reconstructs the full chain review.
        const detailed = await this.api.get(next.operationId);
        if (this.approval()?.operationId === next.operationId) this.approval.set(detailed);
      }
    } catch (error) {
      this.error.set(formatError(error));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  select(item: AdminOperationApproval): void {
    if (this.busy()) return;
    this.approval.set(item);
    void this.reload();
  }

  async sign(): Promise<void> {
    const current = this.approval();
    if (!current || this.busy() || this.refresh.refreshing() || this.signedByCurrentAdmin(current) || this.expired(current) || !this.reviewReady(current)) return;
    await this.run(async () => this.api.sign(current.operationId, current.typedData, (stage) => {
      this.actionMessage.set({ checking: 'Checking this request…', 'chain-signature': 'Wallet approval 1 of 2',
        'request-signature': current.chainActions?.length ? 'Wallet approval 2 of 2' : 'Waiting for your wallet signature',
        saving: 'Saving your approval…' }[stage]);
      this.actionHint.set(stage === 'saving' ? 'Wait for the server to confirm your signature.'
        : 'Open your wallet to review the request. Reject it there to stop signing.');
    }), 'Approval saved. The inbox will update when the other administrator signs.');
  }

  async execute(): Promise<void> {
    const current = this.approval();
    if (!current || this.busy() || this.refresh.refreshing() || !this.canComplete(current)) return;
    this.busy.set(true);
    this.notice.set(null);
    this.actionMessage.set('Submitting the approved action…');
    this.actionHint.set('Checking the server result. Do not submit a second transaction while this request is pending.');
    this.error.set(null);
    try {
      await this.api.execute(current);
      this.notice.set('The server accepted the approved action. Check chain confirmation before treating it as complete.');
      this.approval.set(null);
      await this.loadApprovals();
      this.refresh.updated();
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }

  canPrepareIdentity(): boolean {
    return this.session.authoritySlot?.() === 0 &&
      !this.operations().some((item) => item.operation === 'identity.activate' && !this.expired(item));
  }

  async prepareIdentity(): Promise<void> {
    if (this.busy() || !this.canPrepareIdentity()) return;
    this.actionMessage.set('Preparing the identity review…');
    this.actionHint.set('No signature or transaction is sent until you review and approve this request.');
    await this.run(() => this.api.prepareIdentityDeployment(), 'Review the network, contracts, and checks below, then choose Approve this request.');
  }

  signedByCurrentAdmin(item: AdminOperationApproval): boolean {
    return item.signatures.some(
      (signature) => signature.signerAddress.toLowerCase() === this.currentSubject(),
    );
  }

  canComplete(item: AdminOperationApproval): boolean {
    return item.status === 'approved' && !this.expired(item) && this.reviewReady(item) && this.signedByCurrentAdmin(item) &&
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
      'identity.activate': 'Activate private ID verifier',
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
    if (operation === 'identity.activate') {
      return 'Moves new vault checks to the reviewed ZKPassport verifier while preserving existing vault receipts.';
    }
    if (operation.startsWith('presale.')) {
      return 'Changes a refundable testnet voucher campaign and its customer fulfillment state.';
    }
    return 'Changes the reviewed protocol payment capacity on Testnet11.';
  }

  operationImpact(operation: AdminOperationName): string {
    if (operation === 'identity.activate') {
      return 'New identity checks change after Testnet11 confirmation. No funds move.';
    }
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

  identityReview(item: AdminOperationApproval): Array<{ label: string; value: string }> {
    const review = item.identityReview;
    const current = review?.currentDeployment ?? {};
    const replacement = review?.replacementDeployment ?? {};
    const addresses = (replacement['addresses'] ?? {}) as Record<string, unknown>;
    const policy = review?.credentialPolicy ?? {};
    return [
      { label: 'Amendment', value: review?.amendmentHash ?? '' },
      { label: 'Current identity network', value: this.identityNetworkName(review?.currentEvmChainId) },
      { label: 'New identity network', value: this.identityNetworkName(review?.replacementEvmChainId) },
      { label: 'Current verifier', value: String(current['verifierAdapter'] ?? '') },
      { label: 'Replacement verifier', value: String(addresses['verifierAdapter'] ?? '') },
      { label: 'Attestation emitter', value: String(addresses['attestationEmitter'] ?? '') },
      { label: 'Proof versions', value: review?.acceptedProofVersions?.join(', ') ?? 'Not available' },
      { label: 'Checks', value: `Age ${String(policy['minimumAge'] ?? '')}+ · sanctions ${String((policy['sanctions'] as Record<string, unknown> | undefined)?.['lists'] ?? '')}` },
      { label: 'Documents', value: policy['realDocumentOnly'] === true && policy['devMode'] === false
        ? 'Real documents only · Developer Mode off' : 'Document policy unavailable' },
      { label: 'Website', value: String(policy['domain'] ?? '') },
      { label: 'Amendment valid until', value: review?.approvalExpiresAt
        ? new Date(review.approvalExpiresAt * 1000).toLocaleString() : '' },
    ];
  }

  identityNetworkName(chainId?: number): string {
    return chainId === 8453 ? 'Base (8453)' : chainId === 11155111 ? 'Ethereum Sepolia (11155111)' :
      chainId === 84532 ? 'Base Sepolia (84532)' : 'Network details unavailable';
  }

  statusLabel(item: AdminOperationApproval): string {
    if (this.expired(item)) return 'Expired';
    return item.status === 'approved' ? 'Ready' : 'Needs approval';
  }

  expired(item: AdminOperationApproval): boolean {
    return item.expiresAt * 1000 <= this.refresh.now();
  }

  remaining(item: AdminOperationApproval): string {
    const seconds = Math.max(0, Math.ceil((item.expiresAt * 1000 - this.refresh.now()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left to approve and execute`;
  }

  reviewReady(item: AdminOperationApproval): boolean {
    if (item.operation !== 'identity.activate') return true;
    const review = item.identityReview;
    const body = item.requestBinding.body as Record<string, unknown> | null;
    const policy = review?.credentialPolicy;
    const sanctions = policy?.['sanctions'] as Record<string, unknown> | undefined;
    const addresses = review?.replacementDeployment?.['addresses'] as Record<string, unknown> | undefined;
    return !!review && review.amendmentHash === body?.['amendmentHash'] &&
      review.revision === body?.['revision'] && !!review.currentEvmChainId && !!review.replacementEvmChainId &&
      !!review.acceptedProofVersions?.length && !!policy?.['minimumAge'] && !!policy['domain'] &&
      policy['realDocumentOnly'] === true && policy['devMode'] === false && !!sanctions?.['lists'] &&
      !!review.currentDeployment?.['verifierAdapter'] && !!addresses?.['verifierAdapter'] && !!addresses['attestationEmitter'];
  }

  nextStep(item: AdminOperationApproval): string {
    if (this.expired(item)) return 'This approval window has expired';
    if (!this.reviewReady(item)) return 'Loading the complete review. Signing is unavailable until all details can be checked.';
    if (item.status === 'consumed') return 'Submitted. Follow the chain confirmation.';
    if (item.status === 'approved') return 'Both approvals are saved. Complete the approved action when ready.';
    if (this.signedByCurrentAdmin(item)) return 'Your approval is saved. Waiting for the other required administrator.';
    return 'Review the details, then approve this request. Approval alone does not execute it.';
  }

  statusClass(status: string): string {
    return `status status--${status}`;
  }

  shortWallet(value: string): string {
    return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
  }

  private async run(action: () => Promise<AdminOperationApproval>, success: string): Promise<void> {
    if (this.busy() || this.refresh.refreshing()) return;
    this.busy.set(true);
    this.notice.set(null);
    this.error.set(null);
    try {
      this.approval.set(await action());
      this.notice.set(success);
      await this.loadApprovals();
      this.refresh.updated();
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
