import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { BaseSepoliaTransaction } from './evm-wallet.service';
import { Eip712TypedData } from './solslot-api.service';

@Injectable({ providedIn: 'root' })
export class AdminSecurityService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AdminSessionService);
  private readonly base = `${environment.faucetApi}/admin/security`;

  status(): Promise<AdminSecurityStatus> {
    return firstValueFrom(
      this.http.get<AdminSecurityStatus>(`${this.base}/status`, {
        headers: this.headers(),
      }),
    );
  }

  prepareRecoveryDrill(
    evmGuardian: string,
    recoveryBlsPubkey: string,
  ): Promise<RecoveryDrillChallenge> {
    return firstValueFrom(
      this.http.post<RecoveryDrillChallenge>(
        `${this.base}/recovery-kit/drill`,
        { evmGuardian, recoveryBlsPubkey },
        { headers: this.headers() },
      ),
    );
  }

  completeRecoveryDrill(
    request: CompleteRecoveryDrillRequest,
  ): Promise<RecoveryDrillCompletion> {
    return firstValueFrom(
      this.http.post<RecoveryDrillCompletion>(
        `${this.base}/recovery-kit/drill/complete`,
        request,
        { headers: this.headers() },
      ),
    );
  }

  prepareRoutine(newDailyCompressedPubkey: string): Promise<PreparedKeyChange> {
    return firstValueFrom(
      this.http.post<PreparedKeyChange>(
        `${this.base}/key-changes/routine/prepare`,
        { newDailyCompressedPubkey },
        { headers: this.headers() },
      ),
    );
  }

  prepareLost(request: LostKeyPrepareRequest): Promise<PreparedKeyChange> {
    return firstValueFrom(
      this.http.post<PreparedKeyChange>(
        `${this.base}/key-changes/lost/prepare`,
        request,
      ),
    );
  }

  authorizeLost(
    request: LostKeyAuthorizationRequest,
  ): Promise<LostKeyAuthorizationResponse> {
    return firstValueFrom(
      this.http.post<LostKeyAuthorizationResponse>(
        `${this.base}/key-changes/lost/authorize`,
        request,
      ),
    );
  }

  authorizeRecoveryGuardian(
    caseId: string,
    request: RecoveryGuardianAuthorizationRequest,
  ): Promise<RecoveryGuardianAuthorizationResponse> {
    return firstValueFrom(
      this.http.post<RecoveryGuardianAuthorizationResponse>(
        `${this.base}/key-changes/${encodeURIComponent(caseId)}/recovery-guardian/authorize`,
        request,
        { headers: this.headers() },
      ),
    );
  }

  prepareRecoveryKit(challengeId: string): Promise<PreparedKeyChange> {
    return firstValueFrom(
      this.http.post<PreparedKeyChange>(
        `${this.base}/key-changes/recovery-kit/prepare`,
        { challengeId },
        { headers: this.headers() },
      ),
    );
  }

  submitPrepared(
    kind: AdminKeyChangeKind,
    request: PreparedTransactionSubmission,
  ): Promise<AdminRecoveryCase> {
    const route = {
      ROUTINE: 'routine',
      LOST: 'lost',
      RECOVERY_KIT: 'recovery-kit',
    }[kind];
    const headers = kind === 'LOST' ? undefined : this.headers();
    return firstValueFrom(
      this.http.post<AdminRecoveryCase>(
        `${this.base}/key-changes/${route}/submit`,
        request,
        headers ? { headers } : {},
      ),
    );
  }

  listKeyChanges(): Promise<{ schemaVersion: 1; cases: AdminRecoveryCase[] }> {
    return firstValueFrom(
      this.http.get<{ schemaVersion: 1; cases: AdminRecoveryCase[] }>(
        `${this.base}/key-changes`,
        { headers: this.headers() },
      ),
    );
  }

  getKeyChange(caseId: string): Promise<AdminRecoveryCase> {
    return firstValueFrom(
      this.http.get<AdminRecoveryCase>(
        `${this.base}/key-changes/${encodeURIComponent(caseId)}`,
        { headers: this.headers() },
      ),
    );
  }

  observeEvm(caseId: string, transactionHash: string): Promise<AdminRecoveryCase> {
    return firstValueFrom(
      this.http.post<AdminRecoveryCase>(
        `${this.base}/key-changes/${encodeURIComponent(caseId)}/evm/observe`,
        { transactionHash },
        { headers: this.headers() },
      ),
    );
  }

  getEvmSafePackage(
    caseId: string,
    request: EvmSafeActionPackageRequest,
  ): Promise<EvmSafeActionPackage> {
    return firstValueFrom(
      this.http.post<EvmSafeActionPackage>(
        `${this.base}/key-changes/${encodeURIComponent(caseId)}/evm/safe/package`,
        request,
        { headers: this.headers() },
      ),
    );
  }

  submitEvmSafeSignature(
    caseId: string,
    request: EvmSafeActionSignatureSubmission,
  ): Promise<EvmSafeActionPackage> {
    return firstValueFrom(
      this.http.post<EvmSafeActionPackage>(
        `${this.base}/key-changes/${encodeURIComponent(caseId)}/evm/safe/signatures`,
        request,
      ),
    );
  }

  recordEvmSubmission(
    caseId: string,
    request: EvmActionSubmission,
  ): Promise<AdminRecoveryCase> {
    return firstValueFrom(
      this.http.post<AdminRecoveryCase>(
        `${this.base}/key-changes/${encodeURIComponent(caseId)}/evm/submissions`,
        request,
        { headers: this.headers() },
      ),
    );
  }

  observeChia(caseId: string): Promise<AdminRecoveryCase> {
    return firstValueFrom(
      this.http.post<AdminRecoveryCase>(
        `${this.base}/key-changes/${encodeURIComponent(caseId)}/chia/observe`,
        {},
        { headers: this.headers() },
      ),
    );
  }

  getChiaPackage(
    caseId: string,
    request: ChiaActionPackageRequest,
  ): Promise<ChiaActionPackage> {
    return firstValueFrom(
      this.http.post<ChiaActionPackage>(
        `${this.base}/key-changes/${encodeURIComponent(caseId)}/chia/package`,
        request,
        { headers: this.headers() },
      ),
    );
  }

  submitChiaSignature(
    caseId: string,
    request: ChiaActionSignatureSubmission,
  ): Promise<ChiaActionPackage> {
    return firstValueFrom(
      this.http.post<ChiaActionPackage>(
        `${this.base}/key-changes/${encodeURIComponent(caseId)}/chia/signatures`,
        request,
      ),
    );
  }

  submitChiaPackage(
    caseId: string,
    request: ChiaActionPackageRequest,
  ): Promise<ChiaActionPackage> {
    return firstValueFrom(
      this.http.post<ChiaActionPackage>(
        `${this.base}/key-changes/${encodeURIComponent(caseId)}/chia/submit`,
        request,
        { headers: this.headers() },
      ),
    );
  }

  private headers(): HttpHeaders {
    const jwt = this.session.jwt();
    return jwt
      ? new HttpHeaders({ Authorization: `Bearer ${jwt}` })
      : new HttpHeaders();
  }
}

export type AdminKeyChangeKind = 'ROUTINE' | 'LOST' | 'RECOVERY_KIT';
export type AdminRecoveryState =
  | 'PREPARED'
  | 'AWAITING_APPROVALS'
  | 'READY'
  | 'SUBMITTED'
  | 'PARTIAL'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface AdminSecurityStatus {
  schemaVersion: 1;
  actor: {
    ceremonyId: string;
    slot: 0 | 1 | 2;
    role: 'Owner' | 'Coadministrator';
    wallet: string;
  };
  authorityRule: 'owner_plus_one';
  authority: AdminAuthorityV3Snapshot | null;
  authorityNotice: string | null;
  recoveryKits: AdminRecoveryKitPublic[];
  recoveryReady: boolean;
  myRecoveryKit: AdminRecoveryKitPublic | null;
  pendingRecoveryKit: AdminRecoveryKitCandidate | null;
  activeRecovery: AdminRecoveryCase | null;
  operationsFrozen: boolean;
  recoveryPolicy: {
    routineDelaySeconds: 86400;
    lostKeyDelaySeconds: 604800;
    oldKeyVeto: true;
    replacementAcceptanceRequired: true;
    totalLossBypass: false;
  };
}

export interface AdminAuthorityV3Snapshot {
  chain_verified: boolean;
  network: 'testnet11';
  launcher_id: string;
  current_coin_id: string | null;
  current_puzzle_hash: string | null;
  confirmed_height: number | null;
  source_manifest_hash: string;
  operational_mips_root_hash: string;
  lost_recovery_mips_root_hashes: [string, string, string];
  authority_version: number;
  pending: boolean;
  pending_kind: string;
  pending_slot: number | null;
  pending_intent_hash: string | null;
  pending_identity_coin_id: string | null;
  pending_original_custody_hash: string | null;
  pending_replacement_custody_hash: string | null;
  pending_replacement_member_hash: string | null;
  pending_delay_seconds: number;
  routine_delay_seconds: number;
  lost_key_delay_seconds: number;
  authority_rule: 'owner-plus-one';
  identities: AdminIdentityVaultV1[];
  evidence: Record<string, unknown>;
}

export interface AdminIdentityVaultV1 {
  slot: 0 | 1 | 2;
  launcher_id: string;
  current_coin_id: string | null;
  current_puzzle_hash: string | null;
  daily_compressed_pubkey: string;
  daily_member_hash: string;
  recovery_member_hash: string;
  recovery_bls_pubkey: string;
  custody_hash: string;
  full_puzzle_hash: string;
  confirmed_height: number | null;
}

export interface AdminRecoveryKitPublic {
  ceremonyId: string;
  slot: 0 | 1 | 2;
  revision: number;
  evmGuardian: string;
  recoveryBlsPubkey: string;
  recoveryBlsCommitment: string;
  drillChallengeHash: string;
  drillVerifiedAt: number;
  offlineCopyConfirmed: boolean;
  secondDeviceConfirmed: boolean;
  backupStatus: 'NOT_CONFIGURED' | 'VERIFIED';
  backupRevision: number | null;
  backupCiphertextHash: string | null;
  backupVerifiedAt: number | null;
  updatedAt: number;
}

export interface AdminRecoveryKitCandidate extends AdminRecoveryKitPublic {
  challengeId: string;
  state: 'PENDING' | 'ACTIVATED' | 'CANCELLED';
}

export interface RecoveryDrillChallenge {
  challengeId: string;
  challengeHash: string;
  expiresAt: number;
  revision: number;
  evmTypedData: Eip712TypedData;
  blsSigningDigest: string;
  recoveryBlsPath: "m/12381/8444/2/0-unhardened";
  recoveryEvmPath: "m/44'/60'/0'/0/0";
}

export interface CompleteRecoveryDrillRequest {
  challengeId: string;
  evmSignature: string;
  blsSignature: string;
  offlineCopyConfirmed: boolean;
  secondDeviceConfirmed: boolean;
  backup: {
    status: 'NOT_CONFIGURED' | 'VERIFIED';
    revision?: number;
    ciphertextHash?: string;
  };
}

export interface RecoveryDrillCompletion {
  verified: true;
  recoveryKit?: AdminRecoveryKitPublic;
  recoveryKitCandidate?: AdminRecoveryKitCandidate;
  notice: string;
}

export interface AdminKeyChangeIntentV1 {
  schemaVersion: 1;
  slot: 0 | 1 | 2;
  kind: AdminKeyChangeKind;
  oldDailyEvmKey: string;
  newDailyEvmKey: string;
  oldDailyChiaKey: string;
  newDailyChiaKey: string;
  oldRecoveryGuardian: string;
  newRecoveryGuardian: string;
  oldRecoveryBlsKey: string;
  newRecoveryBlsKey: string;
  identityLauncherIds: [string, string, string];
  identitySafes: [string, string, string];
  authorityLauncherId: string;
  coadminSafe: string;
  rootSafe: string;
  chiaNetwork: 'testnet11';
  evmChainId: 84532 | 8453;
  sourceManifestHash: string;
  nonce: number;
  expiresAt: number;
  recoveryKeyRevision: number;
}

export interface PreparedKeyChange {
  intent: AdminKeyChangeIntentV1;
  intentHash: string;
  coordinator: string;
  prepareTransaction: BaseSepoliaTransaction;
  clearSigning: {
    title: string;
    slot: 0 | 1 | 2;
    oldWallet: string;
    newWallet: string;
    oldRecoveryGuardian: string;
    newRecoveryGuardian: string;
    financialEffect: 'No funds move.';
    authorityEffect: string;
    delaySeconds: number;
    expiresAt: number;
    operationsFreeze: true;
    oldKeyCanVeto: true;
  };
  recoveryBlsDigest: string | null;
  guardianTypedData: Eip712TypedData | null;
}

export interface PreparedTransactionSubmission {
  intent: AdminKeyChangeIntentV1;
  transactionHash: string;
  recoveryBlsSignature?: string;
  guardianSignature?: string;
}

export interface LostKeyPrepareRequest {
  ceremonyId: string;
  slot: 0 | 1 | 2;
  evmGuardian: string;
  recoveryBlsPubkey: string;
  newDailyCompressedPubkey: string;
}

export interface LostKeyAuthorizationRequest {
  intent: AdminKeyChangeIntentV1;
  guardianSignature: string;
}

export interface LostKeyAuthorizationResponse {
  intentHash: string;
  guardianSigner: string;
  relayTransaction: BaseSepoliaTransaction;
}

export interface RecoveryGuardianAuthorizationRequest {
  action: 'ACCEPT' | 'VETO';
  guardianSignature: string;
}

export interface RecoveryGuardianAuthorizationResponse {
  intentHash: string;
  action: 'ACCEPT' | 'VETO';
  guardianSigner: string;
  relayTransaction: BaseSepoliaTransaction;
}

export interface AdminRecoveryCase {
  caseId: string;
  ceremonyId: string;
  slot: 0 | 1 | 2;
  kind: AdminKeyChangeKind;
  state: AdminRecoveryState;
  intentHash: string;
  intent: AdminKeyChangeIntentV1;
  executeAfter: number;
  expiresAt: number;
  preparedBy: string;
  chiaTransactionId: string | null;
  evmTransactionHash: string | null;
  chiaReceiptHash: string | null;
  evmReceiptHash: string | null;
  failureReason: string | null;
  approvals: AdminRecoveryApproval[];
  receipts: AdminKeyChangeReceipt[];
  chiaSignatures: AdminChiaSignatureReceipt[];
  evmSubmissions: AdminEvmSubmission[];
  createdAt: number;
  updatedAt: number;
  approvalsComplete: boolean;
  delayComplete: boolean;
  actions: EvmRecoveryAction[];
  policy: {
    operationsFrozen: boolean;
    crossChainConvergenceRequired: true;
    oldKeyVetoUntilExecution: true;
    totalLossBypass: false;
  };
}

export interface AdminRecoveryApproval {
  actorRole: string;
  actorId: string;
  signerSlot: number | null;
  signerAddress: string;
  messageHash: string;
  submittedAt: number;
}

export interface AdminKeyChangeReceipt {
  chain: 'CHIA' | 'EVM';
  phase: 'PREPARE' | 'APPROVE' | 'EXECUTE' | 'CANCEL' | 'COMPLETE' | 'ROLLBACK';
  transactionId: string;
  receiptHash: string;
  receipt: Record<string, unknown>;
  observedAt: number;
}

export interface AdminChiaSignatureReceipt {
  phase: 'PREPARE' | 'CANCEL';
  actionId: string;
  signerKind: 'EIP712_DAILY' | 'BLS_RECOVERY';
  signerSlot: number | null;
  signerPublicKey: string;
  messageHash: string;
  submittedAt: number;
}

export interface EvmRecoveryAction {
  actionId: string;
  title: string;
  network: 'Base Sepolia';
  financialEffect: 'No funds move.';
  to: string;
  value: '0' | '0x0';
  data: string;
  signer: string;
  execution: 'WALLET' | 'SAFE' | 'PERMISSIONLESS' | 'OFFLINE_RELAY';
  typedData?: Eip712TypedData | null;
  authorizationAction?: 'ACCEPT' | 'VETO' | null;
}

export interface EvmSafeActionPackageRequest {
  actionId: string;
  coadminSlot?: 1 | 2;
}

export interface EvmSafeActionSignatureSubmission extends EvmSafeActionPackageRequest {
  packageHash: string;
  signature: string;
}

export interface EvmActionSubmission extends EvmSafeActionPackageRequest {
  transactionHash: string;
}

export interface AdminEvmSubmission {
  actionId: string;
  transactionHash: string;
  state: 'PENDING' | 'CONFIRMED';
  submittedBy: string;
  submittedAt: number;
  updatedAt: number;
}

export interface EvmSafeActionPackage {
  schemaVersion: 1;
  kind: 'solslot-authority-v3-safe-action';
  caseId: string;
  actionId: string;
  intentHash: string;
  network: 'baseSepolia' | 'baseMainnet';
  chainId: 84532 | 8453;
  executionSafe: string;
  safeNonce: number;
  coadminSlot: 1 | 2 | null;
  transaction: {
    to: string;
    value: number | string;
    data: string;
    operation: number | string;
    safeTxGas: number | string;
    baseGas: number | string;
    gasPrice: number | string;
    gasToken: string;
    refundReceiver: string;
    nonce: number | string;
  };
  transactionHash: string;
  transactionData: string;
  packageHash: string;
  title: string;
  financialEffect: 'No funds move.';
  authorityRule: string;
  approvals: EvmSafeApproval[];
  readyToBroadcast: boolean;
  broadcastTransaction: BaseSepoliaTransaction | null;
}

export interface EvmSafeApproval {
  slot: 0 | 1 | 2;
  role: 'OWNER' | 'COADMIN' | 'PEER';
  identitySafe: string;
  signerAddress: string;
  signatureKind: 'SAFE_MESSAGE' | 'SAFE_TX';
  messageHash: string;
  typedData: Eip712TypedData;
  signed: boolean;
  signedAt: number | null;
}

export interface ChiaActionPackageRequest {
  phase: 'PREPARE' | 'CANCEL' | 'COMPLETE';
  coadminSlot?: 1 | 2;
}

export interface ChiaActionSignatureSubmission {
  phase: 'PREPARE' | 'CANCEL';
  actionId: string;
  signature: string;
  coadminSlot?: 1 | 2;
}

export interface ChiaActionPackage {
  schemaVersion: 1;
  caseId: string;
  intentHash: string;
  phase: 'PREPARE' | 'CANCEL' | 'COMPLETE';
  network: 'testnet11';
  authorityCoinId: string;
  authorityVersion: number;
  coadminSlot: 1 | 2 | null;
  actions: ChiaSigningAction[];
  delayComplete: boolean;
  executeAfter: number;
  readyToSubmit: boolean;
  spendBundleId: string | null;
  inputCoinIds: string[];
  clearSigning: {
    title: string;
    financialEffect: string;
    authorityRule: string;
    replacement: string;
    reversible: boolean;
    operationsFrozen: true;
  };
  submission?: {
    status: string;
    network: 'testnet11';
    spendBundleId: string;
    feeMojos: string | number;
    feeTargetSeconds: number;
    submissionProvider: string;
    mempoolObservedAt: number;
    ambiguousPushRecovered: boolean;
  };
}

export interface ChiaSigningAction {
  actionId: string;
  phase: 'PREPARE' | 'CANCEL';
  signerKind: 'EIP712_DAILY' | 'BLS_RECOVERY';
  signerSlot: 0 | 1 | 2;
  signerPublicKey: string;
  messageHash: string;
  title: string;
  summary: string;
  network: 'Testnet11';
  financialEffect: string;
  coinId: string | null;
  delegatedPuzzleHash: string | null;
  typedData: Eip712TypedData | null;
  blsPairs: Array<{ publicKey: string; message: string }>;
  signed: boolean;
}
