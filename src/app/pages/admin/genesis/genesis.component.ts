import { ZkPassportPrivacyComponent } from '../../../components/zkpassport-privacy/zkpassport-privacy.component';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  NgZone,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import {
  ActionApproval,
  AdminLaunchService,
  DecisionReceipt,
  FundingPreparation,
  FundingReceipt,
  LaunchActionType,
  LaunchGateName,
  LaunchInvitation,
  LaunchPublicStatus,
  LaunchSummary,
  LaunchWorkspace,
  PreparedLaunchAction,
  PreparedSignature,
  RailOwnershipApproval,
  RailOwnershipResult,
  ReadinessFinding,
  SettlementRehearsalResult,
} from '../../../services/admin-launch.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { formatError } from '../../../utils/format-error';

type WalletKind = 'injected' | 'walletconnect';
type PendingDecision =
  | {
      kind: 'action';
      actionType: LaunchActionType;
      prepared: PreparedLaunchAction;
    }
  | {
      kind: 'plan';
      prepared: PreparedSignature;
    }
  | {
      kind: 'broadcast';
      receipt: DecisionReceipt;
    }
  | {
      kind: 'artifact';
      prepared: PreparedSignature;
    }
  | {
      kind: 'rail-sign';
      rail: RailOwnershipResult;
      approval: RailOwnershipApproval;
    }
  | {
      kind: 'rail-broadcast';
      rail: RailOwnershipResult;
    };

interface LaunchStage {
  label: string;
  description: string;
}

@Component({
  selector: 'solslot-admin-genesis',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminWorkspaceNavComponent, ZkPassportPrivacyComponent],
  templateUrl: './genesis.component.html',
  styleUrl: './genesis.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenesisComponent implements OnInit, OnDestroy {
  private readonly launch = inject(AdminLaunchService);
  private readonly router = inject(Router);
  readonly wallet = inject(EvmWalletService);

  readonly publicStatus = signal<LaunchPublicStatus | null>(null);
  readonly workspace = signal<LaunchWorkspace | null>(null);
  readonly railOwnership = signal<RailOwnershipResult | null>(null);
  readonly settlementRehearsal = signal<SettlementRehearsalResult | null>(null);
  readonly fundingPreparation = signal<FundingPreparation | null>(null);
  readonly pendingDecision = signal<PendingDecision | null>(null);
  readonly invitationLinks = signal<Partial<Record<2 | 3, string>>>({});
  readonly archive = signal<LaunchSummary[]>([]);
  readonly pending = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  readonly ownerToken = signal<string | null>(null);
  readonly enrollmentToken = signal<string | null>(null);
  readonly secureLinkMode = computed(() =>
    this.ownerToken() ? 'owner' : this.enrollmentToken() ? 'invite' : null,
  );

  ownerName = 'Owner';
  ownerEmail = '';
  admin2Name = '';
  admin2Email = '';
  admin3Name = '';
  admin3Email = '';
  abandonmentReason = '';
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';

  readonly disposable = computed(() => this.workspace()?.launch.launchProfile === "disposable-vault-identity");
  get stages(): LaunchStage[] {
    const stages: LaunchStage[] = [
    { label: 'Release Check', description: 'Confirm the reviewed Solslot release.' },
    { label: 'Administrator Team', description: 'Enroll the owner and two coadministrators.' },
    { label: 'Test Funding', description: 'Create the nine fixed Testnet11 inputs.' },
    { label: 'Plan Review', description: 'See exactly what the launch will create.' },
    { label: 'Administrator Protection', description: 'Bind the recovery contracts to the planned administrator vaults.' },
    { label: 'Team Approval', description: 'Owner plus one approve the exact plan.' },
    { label: 'Final Launch', description: 'Owner launches during a short approved window.' },
    { label: 'Confirmation', description: 'Confirm the chain result and approve the record.' },
    { label: 'Signed Archive', description: 'Preserve the completed launch as read-only.' },
    { label: 'Payment Rail', description: 'After genesis, put the test payment rail under team control.' },
    {
      label: 'Payment Check',
      description: 'Test one delivery and one full refund before opening sales.',
    },
    ];
    return this.disposable() ? stages.filter((_stage, index) => ![4, 9, 10].includes(index)) : stages;
  }
  readonly operationGateNames = ['minting', 'presale', 'purchases', 'xchVouchers'] as const;

  readonly enrolledCount = computed(
    () => this.workspace()?.launch.administrators.filter((admin) => admin.enrolled).length ?? 0,
  );
  readonly currentStageIndex = computed(() => this.resolveStageIndex());
  readonly connectedWalletLabel = computed(() => {
    const value = this.wallet.address();
    return value ? `${value.slice(0, 8)}...${value.slice(-6)}` : 'Not connected';
  });
  readonly fundingReceipt = computed<FundingReceipt | null>(() => {
    const prepared = this.fundingPreparation()?.receipt;
    if (prepared) return prepared;
    const evidence = this.finding('funding')?.evidence;
    return evidence && typeof evidence === 'object' ? (evidence as FundingReceipt) : null;
  });
  readonly ownerSession = computed(() => this.workspace()?.session.role === 'owner');
  readonly coadminSession = computed(() => this.workspace()?.session.role === 'coadmin');
  readonly customerPaymentsReady = computed(
    () => this.finding('settlement')?.status === 'Healthy',
  );
  readonly deferredFindings = computed(() =>
    (this.workspace()?.readiness ?? []).filter((item) => item.status !== 'Healthy' && item.blocksCeremony === false),
  );
  readonly attentionFindings = computed(() =>
    (this.workspace()?.readiness ?? []).filter((item) => item.status !== 'Healthy' && item.blocksCeremony !== false),
  );
  readonly readyFindings = computed(() =>
    (this.workspace()?.readiness ?? []).filter((item) => item.status === 'Healthy'),
  );
  readonly readinessPercent = computed(() => {
    const total = this.readyFindings().length + this.attentionFindings().length;
    return total ? Math.round((this.readyFindings().length / total) * 100) : 0;
  });
  readonly primaryActionLabel = computed(() => this.nextActionLabel());

  readonly clockSeconds = signal(Math.floor(Date.now() / 1000));
  private readonly zone = inject(NgZone);
  private approvalClock: ReturnType<typeof setInterval> | null = null;

  approvalLabel(action: LaunchActionType, slot: number): string {
    const receipt = this.approval(action);
    const recorded = receipt?.approvals.find(item => item.slot === slot);
    if (recorded?.currentSigner === false) return 'Wallet changed · review again';
    if (recorded?.expired || (recorded?.expiresAt && recorded.expiresAt <= this.clockSeconds())) return 'Expired · approve again';
    return receipt?.slots.includes(slot) ? 'Approval recorded' : 'Awaiting approval';
  }

  approvalRemaining(action: LaunchActionType, slot: number): string {
    const receipt = this.approval(action)?.approvals.find(item => item.slot === slot);
    if (!receipt?.expiresAt || receipt.expired || receipt.currentSigner === false) return '';
    const seconds = Math.max(0, receipt.expiresAt - this.clockSeconds());
    return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining` : '';
  }

  async refreshStatus(): Promise<void> {
    await this.perform('refresh', () => this.reloadWorkspace());
  }

  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private rehearsalTimer: ReturnType<typeof setInterval> | null = null;
  private railTimer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    this.zone.runOutsideAngular(() => {
      this.approvalClock = setInterval(() => this.clockSeconds.set(Math.floor(Date.now() / 1000)), 1000);
    });
    this.consumeFragment();
    await this.perform('load', async () => {
      this.publicStatus.set(await this.launch.publicStatus());
      try {
        await this.reloadWorkspace(true);
      } catch {
        this.workspace.set(null);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.approvalClock) clearInterval(this.approvalClock);
    this.stopProgressPolling();
    this.stopRehearsalPolling();
    this.stopRailPolling();
  }

  async claimOwner(kind: WalletKind): Promise<void> {
    const token = this.ownerToken();
    if (!token) return;
    if (!this.ownerName.trim()) {
      this.error.set('Enter the owner name before continuing.');
      return;
    }
    await this.perform('claim', async () => {
      const claimed = await this.launch.claimOwner({
        token,
        displayName: this.ownerName.trim(),
        email: this.ownerEmail.trim() || undefined,
        timezone: this.timezone,
      });
      this.ownerToken.set(null);
      this.enrollmentToken.set(claimed.ownerEnrollmentToken);
      await this.connectAndEnroll(kind);
    });
  }

  async acceptInvite(kind: WalletKind): Promise<void> {
    if (!this.enrollmentToken()) return;
    await this.perform('enroll', () => this.connectAndEnroll(kind));
  }

  async signIn(kind: WalletKind): Promise<void> {
    await this.perform('signin', async () => {
      const wallet = await this.connect(kind);
      const challenge = await this.launch.resumeChallenge(wallet);
      const signature = await this.wallet.signLaunchAction(challenge.typedData, challenge.ceremonyBinding);
      await this.launch.resumeLogin(wallet, challenge.nonce, signature);
      await this.reloadWorkspace();
      this.message.set('Administrator wallet verified. Your launch tasks are ready.');
    });
  }

  async logout(): Promise<void> {
    await this.perform('logout', async () => {
      await this.launch.logout();
      await this.wallet.disconnect();
      this.workspace.set(null);
      this.stopProgressPolling();
      this.stopRehearsalPolling();
      this.stopRailPolling();
      this.message.set('Signed out. The launch remains safely saved.');
    });
  }

  async issueInvitation(slot: 2 | 3): Promise<void> {
    const displayName = (slot === 2 ? this.admin2Name : this.admin3Name).trim();
    const email = (slot === 2 ? this.admin2Email : this.admin3Email).trim();
    if (!displayName) {
      this.error.set(`Enter a name for Admin ${slot}.`);
      return;
    }
    await this.perform(`invite-${slot}`, async () => {
      const invitation = await this.launch.issueInvitation(slot, {
        displayName,
        email: email || undefined,
        timezone: this.timezone,
        remindersEnabled: true,
      });
      const link = this.invitationUrl(invitation);
      this.invitationLinks.update((current) => ({ ...current, [slot]: link }));
      await this.copyText(link);
      await this.reloadWorkspace();
      this.message.set(`Admin ${slot}'s private invitation link was copied.`);
    });
  }

  async copyInvitation(slot: 2 | 3): Promise<void> {
    const link = this.invitationLinks()[slot];
    if (!link) return;
    await this.copyText(link);
    this.message.set(`Admin ${slot}'s invitation link was copied.`);
  }

  async runPrimaryAction(): Promise<void> {
    const action = this.workspace()?.nextTask.action;
    if (!action || this.pending()) return;
    if (this.primaryActionIsRefreshOnly()) {
      await this.perform('refresh', async () => {
        await this.reloadWorkspace();
        this.message.set('Solslot checked the launch services again.');
      });
      return;
    }
    switch (action) {
      case 'enrollment':
        this.focusElement('administrator-team');
        return;
      case 'securityAccess':
        await this.router.navigate(['/admin/genesis/security']);
        return;
      case 'railOwnership':
        await this.advanceRailOwnership();
        return;
      case 'settlementRehearsal':
        await this.advanceSettlementRehearsal();
        return;
      case 'funding':
        await this.advanceFunding();
        return;
      case 'freezeRoster':
        await this.simpleMutation('freeze-roster', () => this.launch.freezeRoster());
        return;
      case 'buildPlan':
        await this.simpleMutation('build-plan', () => this.launch.buildPlan());
        return;
      case 'signPlan':
        await this.reviewPlanSignature();
        return;
      case 'preflight':
        await this.advanceFinalLaunch();
        return;
      case 'confirm':
      case 'createArtifact':
        await this.progressLaunch();
        return;
      case 'signArtifact':
        await this.reviewArtifactSignature();
        return;
      case 'finalize':
        await this.progressLaunch();
        return;
      case 'openOperations':
        await this.router.navigate(['/admin']);
        return;
      default:
        await this.reloadWorkspace();
    }
  }

  async prepareFunding(): Promise<void> {
    await this.perform('prepare-funding', async () => {
      this.fundingPreparation.set(await this.launch.prepareFunding());
      await this.reloadWorkspace();
      this.message.set(
        'The fixed nine-output funding transaction is ready for owner-plus-one review.',
      );
    });
  }

  async reviewFundingApproval(): Promise<void> {
    await this.reviewAction('funding');
  }

  async executeFunding(): Promise<void> {
    await this.simpleMutation('execute-funding', () => this.launch.executeFunding());
  }

  async confirmFunding(): Promise<void> {
    await this.simpleMutation('confirm-funding', () => this.launch.confirmFunding());
  }

  async proposeLaunchWindow(): Promise<void> {
    await this.perform('prepare-window', async () => {
      const existing = this.workspace()?.gates.ceremonyBroadcast;
      if (!existing || existing.state === 'closed' || existing.state === 'cancelled') {
        await this.launch.proposeGate('ceremonyBroadcast', 0, 900);
      }
      await this.reloadWorkspace();
      const prepared = await this.launch.prepareAction('gate:ceremonyBroadcast');
      this.pendingDecision.set({
        kind: 'action',
        actionType: 'gate:ceremonyBroadcast',
        prepared,
      });
    });
  }

  async activateLaunchWindow(): Promise<void> {
    await this.simpleMutation('activate-window', () =>
      this.launch.activateGate('ceremonyBroadcast'),
    );
  }

  async reviewOperationWindow(name: Exclude<LaunchGateName, 'ceremonyBroadcast'>): Promise<void> {
    await this.perform(`prepare-${name}-window`, async () => {
      const existing = this.workspace()?.gates[name];
      if (!existing || existing.state === 'closed' || existing.state === 'cancelled') {
        await this.launch.proposeGate(name, 0, 1800);
        await this.reloadWorkspace();
      }
      const actionType: LaunchActionType = `gate:${name}`;
      const prepared = await this.launch.prepareAction(actionType);
      this.pendingDecision.set({ kind: 'action', actionType, prepared });
    });
  }

  async activateOperationWindow(
    name: Exclude<LaunchGateName, 'ceremonyBroadcast'>,
  ): Promise<void> {
    await this.simpleMutation(`activate-${name}-window`, () => this.launch.activateGate(name));
  }

  async openOperations(): Promise<void> {
    await this.router.navigate(['/admin']);
  }

  gateAction(name: Exclude<LaunchGateName, 'ceremonyBroadcast'>): LaunchActionType {
    return `gate:${name}`;
  }

  async reviewAbandonment(): Promise<void> {
    if (this.ownerSession() && !this.approval('abandon')) {
      const reason = this.abandonmentReason.trim();
      if (reason.length < 12) {
        this.error.set('Explain why the launch must be abandoned before requesting approval.');
        return;
      }
      await this.perform('prepare-abandonment', async () => {
        const prepared = await this.launch.prepareAbandonment(reason);
        this.pendingDecision.set({ kind: 'action', actionType: 'abandon', prepared });
        await this.reloadWorkspace();
      });
      return;
    }
    await this.reviewAction('abandon');
  }

  async executeAbandonment(): Promise<void> {
    await this.perform('execute-abandonment', async () => {
      await this.launch.executeAbandonment();
      await this.reloadWorkspace();
      this.message.set('The launch was abandoned and preserved as a read-only record.');
    });
  }

  gateLabel(name: Exclude<LaunchGateName, 'ceremonyBroadcast'>): string {
    return {
      minting: 'Minting',
      presale: 'Refundable presales',
      purchases: 'Direct purchases',
      xchVouchers: 'XCH voucher purchases',
    }[name];
  }

  gateHelp(name: Exclude<LaunchGateName, 'ceremonyBroadcast'>): string {
    return {
      minting: 'Publish approved SmartDeeds from a reviewed collection.',
      xchVouchers: 'Off by default. Vouchers currently use approved stablecoins or Stripe. Existing XCH refunds and recovery remain available.',
      presale:
        'Accept new refundable reservations. Existing deliveries and refunds continue after closing.',
      purchases:
        'Accept new direct SmartDeed purchases for approved vaults. Existing settlement continues after closing.',
    }[name];
  }

  canOpenXchVouchers(): boolean {
    return this.workspace()?.voucherRailControls?.xch?.canOpen === true;
  }

  async closeXchVouchers(): Promise<void> {
    await this.simpleMutation('close-xch-vouchers', () => this.launch.closeXchVouchers());
  }

  private launchBinding() {
    const launch = this.workspace()?.launch;
    if (!launch) throw new Error('Reload the server-selected launch before signing.');
    return {ceremonyId: launch.ceremonyId, evmChainId: launch.evmChainId ?? 11155111,
      planHash: launch.planHash, artifactHash: launch.artifactHash};
  }

  enrollmentCommitmentEntries(): [string, string | number][] {
    return Object.entries(this.decisionReceipt()?.enrollmentCommitments ?? {});
  }

  async confirmDecision(): Promise<void> {
    const decision = this.pendingDecision();
    if (!decision) return;
    await this.perform('sign-decision', async () => {
      if (decision.kind === 'action') {
        const signature = await this.wallet.signLaunchAction(decision.prepared.typedData, this.launchBinding());
        await this.launch.approveAction(decision.prepared, decision.actionType, signature);
      } else if (decision.kind === 'plan') {
        const signature = await this.wallet.signLaunchCeremony(decision.prepared.typedData, this.launchBinding());
        await this.launch.signPlan(signature);
      } else if (decision.kind === 'artifact') {
        const signature = await this.wallet.signLaunchCeremony(decision.prepared.typedData, this.launchBinding());
        await this.launch.signArtifact(signature);
      } else if (decision.kind === 'rail-sign') {
        const signature = await this.wallet.signSafeMessage(
          decision.approval.typedData,
          decision.approval.safe,
        );
        this.railOwnership.set(
          await this.launch.signRailOwnership(decision.rail.status.phase, signature),
        );
      } else if (decision.kind === 'rail-broadcast') {
        const transaction = decision.rail.status.broadcastTransaction;
        if (!transaction) throw new Error('The reviewed Safe transaction is not ready.');
        const transactionHash = await this.wallet.sendBaseSepoliaTransaction(transaction);
        this.railOwnership.set(
          await this.launch.recordRailOwnershipBroadcast(
            decision.rail.status.phase,
            transactionHash,
          ),
        );
        this.startRailPolling();
      } else {
        await this.launch.broadcast();
      }
      this.pendingDecision.set(null);
      await this.reloadWorkspace();
      this.message.set('The exact reviewed action was accepted.');
    });
  }

  cancelDecision(): void {
    this.pendingDecision.set(null);
  }

  async loadArchive(): Promise<void> {
    await this.perform('archive', async () => {
      this.archive.set((await this.launch.archive()).launches);
      this.focusElement('launch-archive');
    });
  }

  finding(id: string): ReadinessFinding | undefined {
    return this.workspace()?.readiness.find((item) => item.id === id);
  }

  approval(actionType: LaunchActionType): ActionApproval | undefined {
    return this.workspace()?.actionApprovals[actionType];
  }

  hasCurrentApproval(actionType: LaunchActionType): boolean {
    const slot = this.workspace()?.session.slot;
    return slot != null && this.approvalLabel(actionType, slot) === 'Approval recorded';
  }

  statusClass(status: string): string {
    return `status status--${status.toLowerCase().replace(/\s+/g, '-')}`;
  }

  gateOpen(name: LaunchGateName): boolean {
    return (name !== 'xchVouchers' || this.canOpenXchVouchers()) &&
      this.workspace()?.gates[name]?.state === 'open';
  }

  formatTime(epoch?: number | null): string {
    return epoch
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(epoch * 1000)
      : 'Not available';
  }

  displayRole(role: string): string {
    const labels: Record<string, string> = {
      owner: 'Owner',
      coadmin: 'Coadministrator',
      administrator: 'Any administrator',
      'technical-coadmin': 'Technical coadministrator',
      system: 'Solslot system',
    };
    return labels[role] ?? role;
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      Healthy: 'Ready',
      'Needs action': 'Action needed',
      Waiting: 'Waiting',
      Blocked: 'Setup needed',
    };
    return labels[status] ?? status;
  }

  nextTaskNote(): string {
    const task = this.workspace()?.nextTask;
    if (!task) return '';
    if (this.infrastructureAction(task.action)) {
      return 'This is a protected server task. No administrator should paste keys, hashes, or configuration into this page.';
    }
    if (!this.taskAssignedToCurrentSession()) {
      return `No signature is needed from you yet. ${this.displayRole(task.assignedRole)} owns this step.`;
    }
    return 'The button opens only the exact review or action needed for this step.';
  }

  decisionReceipt(): DecisionReceipt | null {
    const decision = this.pendingDecision();
    if (!decision) return null;
    if (decision.kind === 'action') return decision.prepared.decisionReceipt;
    if (decision.kind === 'plan' || decision.kind === 'artifact') {
      return decision.prepared.decisionReceipt;
    }
    if (decision.kind === 'rail-sign' || decision.kind === 'rail-broadcast') {
      return decision.rail.decisionReceipt;
    }
    return decision.receipt;
  }

  private async connectAndEnroll(kind: WalletKind): Promise<void> {
    const token = this.enrollmentToken();
    if (!token) throw new Error('The private administrator invitation is missing.');
    const wallet = await this.connect(kind);
    const prepared = await this.launch.prepareInvitation(token, wallet);
    const signature = await this.wallet.signLaunchCeremony(prepared.typedData, prepared.ceremonyBinding ?? this.launchBinding());
    await this.launch.acceptInvitation(token, wallet, signature);
    this.enrollmentToken.set(null);
    const challenge = await this.launch.resumeChallenge(wallet);
    const resumeSignature = await this.wallet.signLaunchAction(challenge.typedData, challenge.ceremonyBinding);
    await this.launch.resumeLogin(wallet, challenge.nonce, resumeSignature);
    await this.reloadWorkspace();
    this.message.set('Enrollment complete. This wallet is now mapped to its administrator role.');
  }

  private async connect(kind: WalletKind): Promise<string> {
    return kind === 'injected'
      ? this.wallet.connectInjected()
      : this.wallet.connectWalletConnect({ resetSession: true });
  }

  private async advanceFunding(): Promise<void> {
    const receipt = this.fundingReceipt();
    const approval = this.approval('funding');
    if (!receipt) {
      await this.prepareFunding();
      return;
    }
    if (!this.hasCurrentApproval('funding')) {
      await this.reviewFundingApproval();
      return;
    }
    if (approval?.approved && this.ownerSession() && receipt.state === 'prepared') {
      await this.executeFunding();
      return;
    }
    if (receipt.state === 'broadcast' || receipt.state === 'ambiguous') {
      await this.confirmFunding();
      return;
    }
    this.message.set('Waiting for the other required administrator approval.');
  }

  async advanceRailOwnership(): Promise<void> {
    await this.perform('rail-ownership', async () => {
      const rail = await this.launch.railOwnership();
      this.railOwnership.set(rail);
      if (rail.status.state === 'DONE') {
        await this.reloadWorkspace();
        this.message.set('Base Sepolia ownership is active and independently verified.');
        return;
      }
      if (
        rail.status.state === 'BROADCAST_PENDING' ||
        rail.status.state === 'CONFIRMING'
      ) {
        this.startRailPolling();
        this.message.set(
          rail.status.state === 'BROADCAST_PENDING'
            ? 'The reviewed Safe transaction was submitted. Solslot is tracking it automatically.'
            : 'The ownership action is confirmed and is collecting the required block confirmations.',
        );
        return;
      }
      if (
        rail.status.state === 'SCHEDULED' ||
        rail.status.state === 'WAITING_FOR_DELAY' ||
        rail.status.state === 'WAITING_FOR_SCHEDULE'
      ) {
        this.message.set(
          rail.status.scheduledFor
            ? `The safety delay ends ${this.formatTime(rail.status.scheduledFor)}.`
            : 'Waiting for the reviewed schedule to appear on Base Sepolia.',
        );
        return;
      }
      const approval = this.currentRailApproval(rail);
      if (approval && !approval.signed) {
        this.pendingDecision.set({ kind: 'rail-sign', rail, approval });
        return;
      }
      if (rail.status.broadcastTransaction) {
        this.pendingDecision.set({ kind: 'rail-broadcast', rail });
        return;
      }
      this.message.set('Waiting for the other required Safe approval.');
    });
  }

  currentRailApproval(
    rail: RailOwnershipResult | null = this.railOwnership(),
  ): RailOwnershipApproval | null {
    const wallet = this.wallet.address()?.toLowerCase();
    if (!wallet || !rail) return null;
    return (
      rail.status.approvals.find((approval) =>
        approval.allowedSigners.some((allowed) => allowed.toLowerCase() === wallet),
      ) ?? null
    );
  }

  railSignedCount(): number {
    return this.railOwnership()?.status.approvals.filter((item) => item.signed).length ?? 0;
  }

  railStepLabel(): string {
    const status = this.railOwnership()?.status;
    if (!status || status.phase === 'schedule') return 'Start the 24-hour safety delay';
    if (status.state === 'WAITING_FOR_DELAY') return 'Safety delay in progress';
    if (status.state === 'DONE') return 'Payment rail ready';
    return 'Complete the handoff';
  }

  railStepHelp(): string {
    const status = this.railOwnership()?.status;
    if (!status || status.phase === 'schedule') {
      return 'The owner and one coadministrator approve the fixed handoff. The wizard prepares the final step automatically.';
    }
    if (status.state === 'WAITING_FOR_DELAY') {
      return 'No action is needed yet. This page keeps checking and will show the final approval when the delay ends.';
    }
    if (status.state === 'DONE') {
      return 'The reviewed Safe and timelock now control the Base Sepolia payment rail.';
    }
    return 'The owner and one coadministrator give fresh approval, then either may submit the fixed final action.';
  }

  railDelayLabel(): string {
    const status = this.railOwnership()?.status;
    if (!status || status.phase === 'schedule') return 'Starts after submission';
    if (status.state === 'WAITING_FOR_DELAY' && status.scheduledFor) {
      return `Ends ${this.formatTime(status.scheduledFor)}`;
    }
    return status.scheduledFor ? 'Complete' : 'Checking';
  }

  railActionLabel(): string {
    const rail = this.railOwnership();
    if (!rail) return 'Check readiness';
    const approval = this.currentRailApproval(rail);
    if (approval && !approval.signed) return 'Review and approve';
    if (rail.status.broadcastTransaction) return 'Review and submit';
    if (
      ['SCHEDULED', 'WAITING_FOR_SCHEDULE', 'WAITING_FOR_DELAY', 'BROADCAST_PENDING', 'CONFIRMING']
        .includes(rail.status.state)
    ) {
      return 'Check now';
    }
    return 'Continue handoff';
  }

  railStateLabel(): string {
    const state = this.railOwnership()?.status.state;
    const labels: Record<string, string> = {
      AWAITING_APPROVALS: 'Awaiting approvals',
      READY_TO_BROADCAST: 'Ready to submit',
      BROADCAST_PENDING: 'Submitted to Base Sepolia',
      CONFIRMING: 'Confirming on Base Sepolia',
      SCHEDULED: '24-hour delay active',
      WAITING_FOR_SCHEDULE: 'Waiting for schedule',
      WAITING_FOR_DELAY: '24-hour delay active',
      READY_TO_EXECUTE: 'Ready for fresh approvals',
      DONE: 'Ownership active',
    };
    return state ? (labels[state] ?? state) : (this.finding('railOwnership')?.status ?? 'Waiting');
  }

  rehearsalCompleted(step: number): boolean {
    return (this.settlementRehearsal()?.status.completedSteps ?? 0) >= step;
  }

  rehearsalActionLabel(rehearsal = this.settlementRehearsal()): string {
    const status = rehearsal?.status;
    if (!status || status.state === 'NOT_STARTED') return 'Start payment check';
    if (status.state === 'FAILED') return 'Retry payment check';
    if (status.state === 'SUCCEEDED') return 'Payment path ready';
    const labels: Record<string, string> = {
      PREPARE: 'Start payment check',
      WAITING_DELIVERY_PURCHASE: 'Check delivery purchase',
      VERIFY_DELIVERY: 'Check SmartDeed delivery',
      WAITING_REFUND_PURCHASE: 'Check refund purchase',
      VERIFY_REFUND: 'Check exact refund',
      COMPLETE: 'Payment path ready',
    };
    return labels[status.phase] ?? 'Check progress';
  }

  async advanceSettlementRehearsal(): Promise<void> {
    await this.perform('settlement-rehearsal', async () => {
      let rehearsal = await this.launch.settlementRehearsal();
      this.settlementRehearsal.set(rehearsal);
      if (rehearsal.status.state === 'SUCCEEDED') {
        this.stopRehearsalPolling();
        await this.reloadWorkspace();
        this.message.set('Payment, SmartDeed delivery, and exact refund evidence all passed.');
        return;
      }
      if (!this.coadminSession()) {
        this.focusElement('settlement-rehearsal');
        this.message.set('This test is assigned to either enrolled coadministrator.');
        return;
      }
      if (rehearsal.status.state === 'NOT_STARTED' || rehearsal.status.state === 'FAILED') {
        rehearsal = await this.launch.startSettlementRehearsal();
        this.settlementRehearsal.set(rehearsal);
      }
      if (rehearsal.status.state === 'VALIDATING') {
        this.startRehearsalPolling();
        this.message.set(
          rehearsal.status.message || 'The payment check is running. This page will update.',
        );
      }
    });
  }

  openSalesDesk(): void {
    void this.router.navigate(['/admin/sales']);
  }

  private async advanceFinalLaunch(): Promise<void> {
    const gate = this.workspace()?.gates.ceremonyBroadcast;
    const approval = this.approval('gate:ceremonyBroadcast');
    if (!gate || gate.state === 'closed' || gate.state === 'cancelled') {
      await this.proposeLaunchWindow();
      return;
    }
    if (!this.hasCurrentApproval('gate:ceremonyBroadcast')) {
      await this.reviewAction('gate:ceremonyBroadcast');
      return;
    }
    if (approval?.approved && this.ownerSession() && gate.state !== 'open') {
      await this.activateLaunchWindow();
      return;
    }
    if (gate.state === 'open' && this.ownerSession()) {
      await this.perform('preflight', async () => {
        const preflight = await this.launch.preflight();
        this.pendingDecision.set({
          kind: 'broadcast',
          receipt: preflight.decisionReceipt,
        });
      });
      return;
    }
    this.message.set('Waiting for the owner to open the approved launch window.');
  }

  private async reviewAction(actionType: LaunchActionType): Promise<void> {
    await this.perform('review-action', async () => {
      const prepared = await this.launch.prepareAction(actionType);
      this.pendingDecision.set({ kind: 'action', actionType, prepared });
    });
  }

  private async reviewPlanSignature(): Promise<void> {
    if (
      (this.workspace()?.launch.planSignatureSlots ?? []).includes(
        this.workspace()?.session.slot ?? 0,
      )
    ) {
      this.message.set('Your plan approval is recorded. Waiting for the other signer.');
      return;
    }
    await this.perform('review-plan', async () => {
      const prepared = await this.launch.preparePlanSignature();
      this.pendingDecision.set({ kind: 'plan', prepared });
    });
  }

  private async reviewArtifactSignature(): Promise<void> {
    if (
      (this.workspace()?.launch.artifactSignatureSlots ?? []).includes(
        this.workspace()?.session.slot ?? 0,
      )
    ) {
      this.message.set('Your archive signature is recorded. Waiting for the other signer.');
      return;
    }
    await this.perform('review-artifact', async () => {
      const prepared = await this.launch.prepareArtifactSignature();
      this.pendingDecision.set({ kind: 'artifact', prepared });
    });
  }

  private async progressLaunch(): Promise<void> {
    await this.simpleMutation('progress', () => this.launch.progress());
  }

  private async simpleMutation(label: string, operation: () => Promise<unknown>): Promise<void> {
    await this.perform(label, async () => {
      await operation();
      await this.reloadWorkspace();
    });
  }

  private async reloadWorkspace(reissueOwner = false): Promise<void> {
    const workspace = await this.launch.workspace();
    this.workspace.set(workspace);
    try {
      const rail = await this.launch.railOwnership();
      this.railOwnership.set(rail);
      if (
        ['BROADCAST_PENDING', 'CONFIRMING', 'SCHEDULED', 'WAITING_FOR_SCHEDULE', 'WAITING_FOR_DELAY']
          .includes(rail.status.state)
      ) {
        this.startRailPolling();
      } else {
        this.stopRailPolling();
      }
    } catch {
      this.railOwnership.set(null);
      this.stopRailPolling();
    }
    try {
      const rehearsal = await this.launch.settlementRehearsal();
      this.settlementRehearsal.set(rehearsal);
      if (
        ['PREPARED', 'AWAITING_WALLET', 'PAYMENT_SUBMITTED', 'VALIDATING'].includes(
          rehearsal.status.state,
        )
      ) {
        this.startRehearsalPolling();
      } else {
        this.stopRehearsalPolling();
      }
    } catch {
      this.settlementRehearsal.set(null);
      this.stopRehearsalPolling();
    }
    if (workspace.session.setup && !this.enrollmentToken() && reissueOwner) {
      const result = await this.launch.reissueOwnerEnrollment();
      this.enrollmentToken.set(result.ownerEnrollmentToken);
    }
    if (['broadcast', 'confirmed', 'artifact_signed'].includes(workspace.launch.state)) {
      this.startProgressPolling();
    } else {
      this.stopProgressPolling();
    }
  }

  private startProgressPolling(): void {
    if (this.progressTimer) return;
    this.progressTimer = setInterval(() => {
      if (!this.pending()) void this.progressLaunch();
    }, 15_000);
  }

  private stopProgressPolling(): void {
    if (!this.progressTimer) return;
    clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private startRehearsalPolling(): void {
    if (this.rehearsalTimer) return;
    this.rehearsalTimer = setInterval(() => {
      if (!this.pending()) void this.pollSettlementRehearsal();
    }, 10_000);
  }

  private stopRehearsalPolling(): void {
    if (!this.rehearsalTimer) return;
    clearInterval(this.rehearsalTimer);
    this.rehearsalTimer = null;
  }

  private startRailPolling(): void {
    if (this.railTimer) return;
    this.railTimer = setInterval(() => {
      if (!this.pending()) void this.pollRailOwnership();
    }, 15_000);
  }

  private stopRailPolling(): void {
    if (!this.railTimer) return;
    clearInterval(this.railTimer);
    this.railTimer = null;
  }

  private async pollRailOwnership(): Promise<void> {
    const result = await this.perform('poll-rail', () => this.launch.railOwnership());
    if (!result) return;
    this.railOwnership.set(result);
    if (
      ['AWAITING_APPROVALS', 'READY_TO_BROADCAST', 'READY_TO_EXECUTE', 'DONE']
        .includes(result.status.state)
    ) {
      this.stopRailPolling();
      if (result.status.state === 'DONE') {
        this.message.set('Base Sepolia ownership is active and fully confirmed.');
        await this.reloadWorkspace();
      } else if (result.status.state === 'READY_TO_EXECUTE') {
        this.message.set('The 24-hour safety delay is complete. Fresh approvals are ready.');
      }
    }
  }

  private async pollSettlementRehearsal(): Promise<void> {
    const result = await this.perform('poll-rehearsal', () =>
      this.launch.settlementRehearsal(),
    );
    if (!result) return;
    this.settlementRehearsal.set(result);
    if (result.status.state === 'SUCCEEDED' || result.status.state === 'FAILED') {
      this.stopRehearsalPolling();
      await this.reloadWorkspace();
    }
  }

  private resolveStageIndex(): number {
    const workspace = this.workspace();
    if (!workspace) return 0;
    if (this.finding('release')?.status !== 'Healthy') return 0;
    if (this.enrolledCount() < 3) return 1;
    if (this.finding('funding')?.status !== 'Healthy') return 2;
    const state = workspace.launch.state;
    if (this.disposable()) {
      if (['roster_open', 'roster_frozen'].includes(state)) return 3;
      if (state === 'planned') return 4;
      if (state === 'plan_approved') return 5;
      if (state === 'broadcast') return 6;
      return 7;
    }
    if (state === 'roster_open' || state === 'roster_frozen') return 3;
    if (['planned', 'plan_approved'].includes(state) &&
        (this.finding('authorityV3Evm')?.status !== 'Healthy' ||
         this.finding('authorityV3Review')?.status !== 'Healthy')) return 4;
    if (state === 'planned') return 5;
    if (state === 'plan_approved') return 6;
    if (state === 'broadcast') return 7;
    if (['confirmed', 'artifact_pending', 'artifact_signed'].includes(state)) return 8;
    if (state === 'locked' && this.finding('railOwnership')?.status !== 'Healthy') return 9;
    if (state === 'locked' && !this.customerPaymentsReady()) return 10;
    return this.stages.length - 1;
  }

  private nextActionLabel(): string {
    const action = this.workspace()?.nextTask.action;
    if (this.infrastructureAction(action)) return 'Check setup again';
    if (!this.taskAssignedToCurrentSession()) return 'Refresh status';
    const labels: Record<string, string> = {
      enrollment: 'Review administrator team',
      securityAccess: 'Set up recovery',
      railOwnership: 'Continue rail ownership',
      settlementRehearsal: 'Run customer payment check',
      funding: 'Continue ceremony funding',
      freezeRoster: 'Confirm administrator team',
      buildPlan: 'Build launch plan',
      signPlan: 'Review and approve plan',
      preflight: 'Prepare final launch',
      confirm: 'Check chain confirmation',
      createArtifact: 'Build launch archive',
      signArtifact: 'Review and sign archive',
      finalize: 'Seal launch archive',
      openOperations: 'Open operations dashboard',
      refresh: 'Refresh launch status',
    };
    return action ? (labels[action] ?? 'Continue') : 'Refresh';
  }

  private primaryActionIsRefreshOnly(): boolean {
    return (
      this.infrastructureAction(this.workspace()?.nextTask.action) ||
      !this.taskAssignedToCurrentSession()
    );
  }

  private infrastructureAction(action?: string | null): boolean {
    return new Set([
      'replaceReleaseEvidence',
      'replacePlanEvidence',
      'installEvmEvidence',
      'configureValidators',
      'restoreChiaNode',
      'configureFeeTill',
    ]).has(action ?? '');
  }

  private taskAssignedToCurrentSession(): boolean {
    const task = this.workspace()?.nextTask;
    const role = this.workspace()?.session.role;
    if (!task || !role) return false;
    if (task.assignedRole === 'administrator') return true;
    if (task.assignedRole === 'owner') return role === 'owner';
    if (
      task.assignedRole === 'coadmin' ||
      task.assignedRole === 'technical-coadmin'
    ) {
      return role === 'coadmin';
    }
    return false;
  }

  private consumeFragment(): void {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const owner = params.get('launch-owner');
    const invitation = params.get('launch-invite');
    if (owner) this.ownerToken.set(owner);
    if (invitation) this.enrollmentToken.set(invitation);
    if (owner || invitation) {
      window.history.replaceState(
        null,
        document.title,
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }

  private invitationUrl(invitation: LaunchInvitation): string {
    if (typeof window === 'undefined') return invitation.invitationFragment;
    return `${window.location.origin}${window.location.pathname}${invitation.invitationFragment}`;
  }

  private async copyText(value: string): Promise<void> {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
    await navigator.clipboard.writeText(value);
  }

  private focusElement(id: string): void {
    if (typeof document === 'undefined') return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private async perform<T>(label: string, operation: () => Promise<T>): Promise<T | undefined> {
    if (this.pending()) return undefined;
    this.pending.set(label);
    this.error.set(null);
    try {
      return await operation();
    } catch (error) {
      const detail = formatError(error);
      if (
        /unknown error|http failure during parsing|http failure response.*:\s*0\b/i.test(
          detail,
        )
      ) {
        this.error.set(
          'The administrator service could not be reached. No action is available. Try again after the service is restored.',
        );
      } else if (/\b401\b|unauthori[sz]ed|session expired/i.test(detail)) {
        this.error.set('Your administrator session expired. Sign in with your enrolled wallet again.');
      } else {
        this.error.set(detail);
      }
      return undefined;
    } finally {
      this.pending.set(null);
    }
  }
}
