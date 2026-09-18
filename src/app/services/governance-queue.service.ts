import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { UnsignedCoinSpend } from './chia-wallet.service';
import { Eip712TypedData } from './solslot-api.service';

export type GovernanceProposalKind = 'SGT_SALE' | 'SGT_GRANT' | 'FUNDED_REDEMPTION';
export type SgtSalePaymentRail = 'XCH' | 'WUSDC_B' | 'STRIPE' | 'BASE_USDC';

export interface SgtSalePaymentOption {
  id: SgtSalePaymentRail;
  label: string;
  decimals: number;
  assetId?: string;
  chainId?: number;
  serverPriced?: boolean;
}
export type GovernanceProposalState =
  | 'DRAFT'
  | 'READY'
  | 'ACTIVE'
  | 'EXECUTED'
  | 'FAILED'
  | 'CANCELED';

export interface StarterGrantPreview {
  amountPerAdministrator: string;
  totalAmount: string;
  statutesCoinId: string;
  authorityRule: string;
  proposals: Array<Extract<CreateGovernanceProposal, { kind: 'SGT_GRANT' }>>;
}

export interface GovernanceProposalRecord {
  id: string;
  kind: GovernanceProposalKind;
  state: GovernanceProposalState;
  title: string;
  bill: Record<string, unknown>;
  billClvmHex: string;
  proposalHash: string;
  revision: number;
  queuePosition: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  activatedAt: number | null;
  completedAt: number | null;
  activationBundleId: string | null;
  proposalCoinId: string | null;
  completionBundleId: string | null;
  publicationCoadminSlot: number | null;
  executionBundleId: string | null;
  expectedOutputCoinIds: string[];
  executionSubmittedAt: number | null;
  saleOffer?: GovernanceSaleOffer | null;
}

export interface GovernanceSaleOffer {
  offerId: string;
  offerFile?: string;
  saleCoinId: string;
  status: 'AVAILABLE' | 'PENDING' | 'TAKEN' | 'EXPIRED' | 'RETURNED';
  publishedAt: number;
  confirmedHeight: number;
  spentHeight: number | null;
}

export interface GovernanceChainResult {
  proposal: GovernanceProposalRecord;
  chainState: string;
  confirmedHeight?: number;
  voteTally?: string;
  votingDeadline?: number;
  saleStatus?: GovernanceSaleOffer['status'];
  expectedOutputCoinIds?: string[];
  submission?: {
    spendBundleId: string;
    feeMojos?: number;
    feeTargetSeconds?: number;
    mempoolObservedAt?: number;
  };
}

export interface GovernancePublicationAction {
  actionId: string;
  signerSlot: number;
  signerPublicKey: string;
  messageHash: string;
  coinId: string;
  delegatedPuzzleHash: string;
  typedData: Eip712TypedData;
  network: string;
  title: string;
  summary: string;
  financialEffect: string;
  signed: boolean;
}

export interface GovernancePublicationPackage {
  proposal: GovernanceProposalRecord;
  network: string;
  authorityRule: string;
  coadminSlot: number;
  votingDeadline: number;
  votingWindowSeconds: number;
  proposalHash: string;
  reserveVoteAmount: string;
  actions: GovernancePublicationAction[];
  readyToSubmit: boolean;
  expectedProposalCoinId: string | null;
}

export interface GovernanceVaultVotePrepare {
  schemaVersion: 1;
  proposalId: string;
  proposalHash: string;
  operationHash: string;
  vaultLauncherId: string;
  vaultCoinId: string;
  vaultAuthType: 'chia_bls' | 'evm';
  vaultTypedData?: Eip712TypedData | null;
  sgtCoinId: string;
  voteAmount: string;
  availableSgtAmounts: string[];
  votingDeadline: number;
  currentVoteTally: string;
  signingCoinSpends: UnsignedCoinSpend[];
  review: {
    network: string;
    action: string;
    proposalTitle: string;
    proposalHash: string;
    vaultLauncherId: string;
    sgtAmount: string;
    financialEffect: string;
    reversibleAfterSubmission: false;
  };
}

export interface GovernanceVaultVoteResult {
  schemaVersion: 1;
  proposalId: string;
  proposalHash: string;
  operationHash: string;
  vaultLauncherId: string;
  sgtCoinId: string;
  voteAmount: string;
  status: string;
  spendBundleId: string;
  feeMojos: string;
  feeTargetSeconds: number;
  submissionProvider: string;
  mempoolObservedAt: string;
}

export type CreateGovernanceProposal =
  | {
      kind: 'SGT_SALE';
      title: string;
      sgtAmount: string;
      recipientVaultLauncherId: string;
      saleId: string;
      paymentRail: 'XCH' | 'WUSDC_B';
      paymentAmount: string;
      expiresAt: number;
    }
  | {
      kind: 'SGT_SALE';
      title: string;
      sgtAmount: string;
      recipientVaultLauncherId: string;
      saleId: string;
      paymentRail: 'STRIPE' | 'BASE_USDC';
      baseUsdAmountMinor: string;
      expiresAt: number;
    }
  | {
      kind: 'SGT_GRANT';
      title: string;
      sgtAmount: string;
      recipientVaultLauncherId: string;
      grantId: string;
      reasonHash: string;
    };

@Injectable({ providedIn: 'root' })
export class GovernanceQueueService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AdminSessionService);
  private readonly base = environment.faucetApi;

  previewStarterGrants(vaultLauncherIds: string[]): Promise<StarterGrantPreview> {
    return firstValueFrom(this.http.post<StarterGrantPreview>(
      `${this.base}/admin/governance/sgt-starter-grants/preview`,
      { vaultLauncherIds }, { headers: this.headers() },
    ));
  }

  async list(): Promise<GovernanceProposalRecord[]> {
    const response = await firstValueFrom(
      this.http.get<{ proposals: GovernanceProposalRecord[] }>(
        `${this.base}/admin/governance/proposals`,
        { headers: this.headers() },
      ),
    );
    return response.proposals;
  }

  async allocationOptions(): Promise<SgtSalePaymentOption[]> {
    const response = await firstValueFrom(
      this.http.get<{ paymentRails: SgtSalePaymentOption[] }>(
        `${this.base}/admin/governance/sgt-allocation-options`,
        { headers: this.headers() },
      ),
    );
    return response.paymentRails;
  }

  create(input: CreateGovernanceProposal): Promise<GovernanceProposalRecord> {
    return firstValueFrom(
      this.http.post<GovernanceProposalRecord>(
        `${this.base}/admin/governance/proposals`,
        input,
        { headers: this.headers() },
      ),
    );
  }

  transition(
    proposal: GovernanceProposalRecord,
    target: 'READY' | 'CANCELED',
  ): Promise<GovernanceProposalRecord> {
    return firstValueFrom(
      this.http.post<GovernanceProposalRecord>(
        `${this.base}/admin/governance/proposals/${encodeURIComponent(proposal.id)}/transition`,
        { target },
        { headers: this.headers(proposal.revision) },
      ),
    );
  }

  package(proposalId: string, coadminSlot: number): Promise<GovernancePublicationPackage> {
    return firstValueFrom(
      this.http.post<GovernancePublicationPackage>(
        `${this.base}/admin/governance/proposals/${encodeURIComponent(proposalId)}/publication/package`,
        { coadminSlot },
        { headers: this.headers() },
      ),
    );
  }

  sign(
    proposalId: string,
    coadminSlot: number,
    actionId: string,
    signature: string,
  ): Promise<GovernancePublicationPackage> {
    return firstValueFrom(
      this.http.post<GovernancePublicationPackage>(
        `${this.base}/admin/governance/proposals/${encodeURIComponent(proposalId)}/publication/signatures`,
        { coadminSlot, actionId, signature },
        { headers: this.headers() },
      ),
    );
  }

  submit(
    proposalId: string,
    coadminSlot: number,
  ): Promise<{ proposal: GovernanceProposalRecord }> {
    return firstValueFrom(
      this.http.post<{ proposal: GovernanceProposalRecord }>(
        `${this.base}/admin/governance/proposals/${encodeURIComponent(proposalId)}/publication/submit`,
        { coadminSlot },
        { headers: this.headers() },
      ),
    );
  }

  reconcile(proposalId: string): Promise<GovernanceChainResult> {
    return firstValueFrom(
      this.http.post<GovernanceChainResult>(
        `${this.base}/admin/governance/proposals/${encodeURIComponent(proposalId)}/reconcile`,
        {},
        { headers: this.headers() },
      ),
    );
  }

  execute(proposalId: string): Promise<GovernanceChainResult> {
    return firstValueFrom(
      this.http.post<GovernanceChainResult>(
        `${this.base}/admin/governance/proposals/${encodeURIComponent(proposalId)}/execute`,
        {},
        { headers: this.headers() },
      ),
    );
  }

  prepareVaultVote(
    proposalId: string,
    vaultLauncherId: string,
    voteAmount: string,
  ): Promise<GovernanceVaultVotePrepare> {
    return firstValueFrom(
      this.http.post<GovernanceVaultVotePrepare>(
        `${this.base}/governance/proposals/${encodeURIComponent(proposalId)}/vaults/${encodeURIComponent(vaultLauncherId)}/votes/prepare`,
        { voteAmount },
        { withCredentials: true },
      ),
    );
  }

  completeVaultVote(
    proposalId: string,
    vaultLauncherId: string,
    input: {
      voteAmount: string;
      operationHash: string;
      aggregatedSignature?: string;
      vaultOwnerAuthorization?: string;
    },
  ): Promise<GovernanceVaultVoteResult> {
    return firstValueFrom(
      this.http.post<GovernanceVaultVoteResult>(
        `${this.base}/governance/proposals/${encodeURIComponent(proposalId)}/vaults/${encodeURIComponent(vaultLauncherId)}/votes/complete`,
        input,
        { withCredentials: true },
      ),
    );
  }

  private headers(revision?: number): HttpHeaders {
    let headers = new HttpHeaders({ Authorization: `Bearer ${this.session.requireJwt()}` });
    if (revision !== undefined) headers = headers.set('If-Match', `"${revision}"`);
    return headers;
  }
}
