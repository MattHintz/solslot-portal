import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import type { BaseSepoliaTransaction, LaunchCeremonyBinding } from './evm-wallet.service';
import { Eip712TypedData } from './solslot-api.service';

@Injectable({ providedIn: 'root' })
export class AdminLaunchService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.faucetApi}/admin/launch`;

  publicStatus(): Promise<LaunchPublicStatus> {
    return firstValueFrom(this.http.get<LaunchPublicStatus>(`${this.base}/public`));
  }

  claimOwner(input: OwnerClaimInput): Promise<OwnerClaimResult> {
    return this.post<OwnerClaimResult>('/claim', input);
  }

  prepareInvitation(token: string, wallet: string): Promise<TypedAction> {
    return this.post<TypedAction>('/invitations/prepare', { token, wallet });
  }

  reissueOwnerEnrollment(): Promise<{
    ownerEnrollmentToken: string;
    enrollmentExpiresAt: number;
  }> {
    return this.post('/owner/enrollment', {});
  }

  acceptInvitation(token: string, wallet: string, signature: string): Promise<void> {
    return this.post<void>('/invitations/accept', { token, wallet, signature });
  }

  resumeChallenge(wallet: string): Promise<ResumeChallenge> {
    return this.post<ResumeChallenge>('/auth/challenge', { wallet });
  }

  resumeLogin(wallet: string, nonce: string, signature: string): Promise<LaunchSession> {
    return this.post<LaunchSession>('/auth/login', { wallet, nonce, signature });
  }

  logout(): Promise<{ authenticated: boolean }> {
    return this.post<{ authenticated: boolean }>('/auth/logout', {});
  }

  workspace(): Promise<LaunchWorkspace> {
    return firstValueFrom(
      this.http.get<LaunchWorkspace>(`${this.base}/workspace`, {
        withCredentials: true,
      }),
    );
  }

  audit(after = 0): Promise<{ events: LaunchAuditEvent[] }> {
    return firstValueFrom(
      this.http.get<{ events: LaunchAuditEvent[] }>(`${this.base}/audit`, {
        params: { after },
        withCredentials: true,
      }),
    );
  }

  issueInvitation(slot: 2 | 3, profile: LaunchProfileInput): Promise<LaunchInvitation> {
    return this.post<LaunchInvitation>(`/invitations/${slot}`, profile);
  }

  freezeRoster(): Promise<unknown> {
    return this.post('/roster/freeze', {});
  }

  railOwnership(): Promise<RailOwnershipResult> {
    return firstValueFrom(
      this.http.get<RailOwnershipResult>(`${this.base}/rail-ownership`, {
        withCredentials: true,
      }),
    );
  }

  signRailOwnership(phase: RailOwnershipPhase, signature: string): Promise<RailOwnershipResult> {
    return this.post('/rail-ownership/sign', { phase, signature });
  }

  recordRailOwnershipBroadcast(
    phase: RailOwnershipPhase,
    transactionHash: string,
  ): Promise<RailOwnershipResult> {
    return this.post('/rail-ownership/broadcast', { phase, transactionHash });
  }

  settlementRehearsal(): Promise<SettlementRehearsalResult> {
    return firstValueFrom(
      this.http.get<SettlementRehearsalResult>(`${this.base}/settlement-rehearsal`, {
        withCredentials: true,
      }),
    );
  }

  startSettlementRehearsal(): Promise<SettlementRehearsalResult> {
    return this.post('/settlement-rehearsal/start', {});
  }

  prepareFunding(): Promise<FundingPreparation> {
    return this.post<FundingPreparation>('/funding/prepare', {});
  }

  executeFunding(): Promise<FundingReceipt> {
    return this.post<FundingReceipt>('/funding/execute', {});
  }

  confirmFunding(): Promise<FundingReceipt> {
    return this.post<FundingReceipt>('/funding/confirm', {});
  }

  proposeGate(
    gate: LaunchGateName,
    startsInSeconds = 0,
    durationSeconds = 1800,
  ): Promise<GateProposal> {
    return this.post<GateProposal>('/gates/propose', {
      gate,
      startsInSeconds,
      durationSeconds,
    });
  }

  prepareAction(actionType: LaunchActionType): Promise<PreparedLaunchAction> {
    return this.post<PreparedLaunchAction>('/actions/prepare', { actionType });
  }

  approveAction(
    prepared: PreparedLaunchAction,
    actionType: LaunchActionType,
    signature: string,
  ): Promise<ActionApproval> {
    return this.post<ActionApproval>('/actions/approve', {
      actionType,
      actionId: prepared.actionId,
      payloadHash: prepared.payloadHash,
      expiresAt: prepared.expiresAt,
      signature,
    });
  }

  activateGate(gate: LaunchGateName): Promise<LaunchGate> {
    return this.post<LaunchGate>(`/gates/${gate}/activate`, {});
  }

  closeXchVouchers(): Promise<LaunchGate> {
    return this.post<LaunchGate>('/gates/xchVouchers/close', {});
  }

  prepareAbandonment(reason: string): Promise<PreparedLaunchAction> {
    return this.post<PreparedLaunchAction>('/abandon/prepare', { reason });
  }

  executeAbandonment(): Promise<{ abandoned: boolean; launch: LaunchSummary }> {
    return this.post('/abandon/execute', {});
  }

  buildPlan(): Promise<unknown> {
    return this.post('/plan/build', {});
  }

  preparePlanSignature(): Promise<PreparedSignature> {
    return this.post<PreparedSignature>('/plan/signature/prepare', {});
  }

  signPlan(signature: string): Promise<unknown> {
    return this.post('/plan/signature', { signature });
  }

  preflight(): Promise<LaunchPreflight> {
    return this.post<LaunchPreflight>('/preflight', {});
  }

  broadcast(): Promise<unknown> {
    return this.post('/broadcast', {});
  }

  progress(): Promise<unknown> {
    return this.post('/progress', {});
  }

  prepareArtifactSignature(): Promise<PreparedSignature> {
    return this.post<PreparedSignature>('/artifact/signature/prepare', {});
  }

  signArtifact(signature: string): Promise<unknown> {
    return this.post('/artifact/signature', { signature });
  }

  archive(): Promise<{ launches: LaunchSummary[] }> {
    return firstValueFrom(
      this.http.get<{ launches: LaunchSummary[] }>(`${this.base}/archive`, {
        withCredentials: true,
      }),
    );
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(
      this.http.post<T>(`${this.base}${path}`, body, { withCredentials: true }),
    );
  }
}

export interface LaunchPublicStatus {
  enabled: boolean;
  network: string;
  title: string;
  notice: string;
}

export interface OwnerClaimInput {
  token: string;
  displayName: string;
  email?: string;
  timezone: string;
}

export interface OwnerClaimResult {
  claimed: boolean;
  ceremonyId: string;
  ownerEnrollmentToken: string;
  enrollmentExpiresAt: number;
  sessionExpiresAt: number;
}

export interface TypedAction {
  ceremonyBinding?: LaunchCeremonyBinding;
  ceremonyId: string;
  slot: number;
  expiresAt: number;
  typedData: Eip712TypedData;
}

export interface ResumeChallenge {
  ceremonyBinding?: LaunchCeremonyBinding;
  nonce: string;
  expiresAt: number;
  typedData: Eip712TypedData;
}

export interface LaunchSession {
  authenticated?: boolean;
  slot: number;
  role: 'owner' | 'coadmin';
  wallet?: string | null;
  setup?: boolean;
  expiresAt: number;
}

export interface LaunchProfileInput {
  displayName: string;
  email?: string;
  timezone: string;
  remindersEnabled: boolean;
}

export interface LaunchProfile extends LaunchProfileInput {
  slot: number;
  role: string;
  updatedAt: number;
}

export interface LaunchAdministrator {
  slot: 1 | 2 | 3;
  role: string;
  profile?: LaunchProfile | null;
  enrolled: boolean;
  wallet?: string | null;
  invitationExpiresAt?: number | null;
}

export interface LaunchSummary {
  launchProfile?: string | null;
  reviewClass?: string | null;
  evmChainId?: 11155111 | 84532 | 8453;
  enrollmentCommitments?: Record<string, string | number> | null;
  ceremonyId: string;
  state: string;
  network: string;
  createdAt: number;
  updatedAt: number;
  administrators: LaunchAdministrator[];
  planHash?: string | null;
  planExpiresAt?: number | null;
  planSignatureSlots: number[];
  spendBundleId?: string | null;
  artifactHash?: string | null;
  artifactSignatureSlots: number[];
}

export type ReadinessStatus = 'Healthy' | 'Needs action' | 'Waiting' | 'Blocked';

export interface ReadinessFinding {
  id: string;
  title: string;
  status: ReadinessStatus;
  impact: string;
  assignedRole: string;
  action?: string | null;
  evidence?: unknown;
  blocksCeremony?: boolean;
}

export interface LaunchTask {
  title: string;
  body: string;
  assignedRole: string;
  action?: string | null;
}

export type LaunchGateName = 'ceremonyBroadcast' | 'minting' | 'presale' | 'purchases' | 'xchVouchers';
export type LaunchActionType = 'funding' | 'abandon' | `gate:${LaunchGateName}`;

export interface LaunchGate {
  name: LaunchGateName;
  network: string;
  opensAt: number;
  closesAt: number;
  state: 'pending' | 'open' | 'closed' | 'cancelled';
  configuredState: string;
  payloadHash: string;
  updatedAt: number;
}

export interface FundingReceipt {
  plan: {
    sourceCoinId: string;
    sourceAmount: number;
    fee: number;
    outputs: Array<{ name: string; amount: number; coinId: string }>;
    fundingCoinIds: Record<string, string>;
    changeAmount: number;
  };
  planHash: string;
  spendBundleId?: string | null;
  state: 'prepared' | 'approved' | 'broadcast' | 'confirmed' | 'ambiguous';
  createdAt: number;
  updatedAt: number;
}

export interface FundingPreparation {
  receipt: FundingReceipt;
  summary: {
    sourceBalanceMojos: number;
    totalMojos: number;
    feeMojos: number;
    outputs: Array<{ purpose: string; amountMojos: number }>;
    bridgeBatchMojos: number;
    customizationAllowed: false;
  };
}

export interface DecisionReceipt {
  enrollmentCommitments?: Record<string, string | number> | null;
  title: string;
  network: string;
  financialEffect: string;
  customerImpact: string;
  reversibility: string;
  requiredApprovers: string;
  payloadHash?: string;
  expiresAt?: number;
  expectedResult?: string;
}

export interface PreparedLaunchAction {
  actionId: string;
  payloadHash: string;
  expiresAt: number;
  typedData: Eip712TypedData;
  typedDataHash: string;
  decisionReceipt: DecisionReceipt;
}

export interface PreparedSignature {
  ceremonyBinding?: LaunchCeremonyBinding;
  ceremonyId: string;
  slot: number;
  typedData: Eip712TypedData;
  decisionReceipt: DecisionReceipt;
}

export interface ActionApproval {
  actionId: string;
  approved: boolean;
  slots: number[];
  approvals: Array<{ slot: number; signer: string; submittedAt: number; expiresAt?: number; expired?: boolean; currentSigner?: boolean }>;
}

export interface GateProposal {
  gate: LaunchGate;
  decisionReceipt: DecisionReceipt;
}

export type RailOwnershipPhase = 'schedule' | 'execute';

export interface RailOwnershipApproval {
  role: 'owner_identity' | 'coadmin';
  safe: string;
  allowedSigners: string[];
  messageHash: string;
  typedData: Eip712TypedData;
  signed: boolean;
  signerAddress?: string | null;
  signedAt?: number | null;
}

export interface RailOwnershipStatus {
  state:
    | 'AWAITING_APPROVALS'
    | 'READY_TO_BROADCAST'
    | 'BROADCAST_PENDING'
    | 'CONFIRMING'
    | 'SCHEDULED'
    | 'WAITING_FOR_SCHEDULE'
    | 'WAITING_FOR_DELAY'
    | 'READY_TO_EXECUTE'
    | 'DONE';
  phase: RailOwnershipPhase;
  network: 'baseSepolia';
  scheduledFor?: number | null;
  approvals: RailOwnershipApproval[];
  broadcastTransaction?: BaseSepoliaTransaction | null;
  broadcast?: {
    transactionHash: string;
    confirmations: number;
    minimumConfirmations: number;
  } | null;
  submission?: {
    transactionHash: string;
    submittedBy: string;
    submittedAt: number;
  } | null;
}

export interface RailOwnershipResult {
  status: RailOwnershipStatus;
  decisionReceipt: DecisionReceipt;
}

export type SettlementRehearsalState =
  | 'NOT_STARTED'
  | 'VALIDATING'
  | 'SUCCEEDED'
  | 'FAILED';

export type SettlementRehearsalPhase =
  | 'PREPARE'
  | 'WAITING_DELIVERY_PURCHASE'
  | 'VERIFY_DELIVERY'
  | 'WAITING_REFUND_PURCHASE'
  | 'VERIFY_REFUND'
  | 'COMPLETE';

export interface SettlementRehearsalStatus {
  jobId?: string | null;
  state: SettlementRehearsalState;
  phase: SettlementRehearsalPhase;
  completedSteps: number;
  step: string;
  message: string;
  assignedRole?: 'coadmin';
  walletTransaction?: null;
  review?: {
    action: 'purchase' | 'refund' | 'verify';
    lane: 'delivery' | 'refund';
    asset: 'USD';
    amountMinor: string;
    amountLabel: string;
    paymentIntentId: string;
    approvedVault: string;
    deedLauncherId: string;
    expectedOutcome: 'DELIVERED' | 'REFUND';
  } | null;
  evidenceDigest?: string | null;
  updatedAt?: number | null;
}

export interface SettlementRehearsalResult {
  status: SettlementRehearsalStatus;
  decisionReceipt: DecisionReceipt;
}

export interface LaunchPreflight {
  ready: boolean;
  planHash: string;
  spendBundleId: string;
  reviewApproval: unknown;
  validatorHealth: unknown[];
  decisionReceipt: DecisionReceipt;
}

export interface LaunchWorkspace {
  session: LaunchSession;
  launch: LaunchSummary;
  readiness: ReadinessFinding[];
  nextTask: LaunchTask;
  gates: Partial<Record<LaunchGateName, LaunchGate>>;
  voucherRailControls?: { xch: { defaultEnabled: boolean; releaseReady: boolean; serverEnabled: boolean; canOpen: boolean; reason: string | null } };
  actionApprovals: Partial<Record<LaunchActionType, ActionApproval>>;
  notice: string;
}

export interface LaunchInvitation {
  slot: 2 | 3;
  profile: LaunchProfile;
  expiresAt: number;
  invitationFragment: string;
}

export interface LaunchAuditEvent {
  eventId: number;
  type: string;
  details: unknown;
  createdAt: number;
}
