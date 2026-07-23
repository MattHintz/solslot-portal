import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { AdminOperationApprovalService } from './admin-operation-approval.service';
import {
  PropertyAmendmentV1,
  PropertyDossierDraftV1,
  PropertyDossierV1,
} from './property-metadata/property-dossier';

@Injectable({ providedIn: 'root' })
export class CollectionApiService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AdminSessionService);
  private readonly approvals = inject(AdminOperationApprovalService);
  private readonly base = environment.faucetApi;

  featureStatus(): Promise<CollectionFeatureStatus> {
    return firstValueFrom(
      this.http.get<CollectionFeatureStatus>(`${this.base}/admin/collections/feature-status`, {
        headers: this.headers(),
      }),
    );
  }

  profiles(): Promise<CollectionProfiles> {
    return firstValueFrom(
      this.http.get<CollectionProfiles>(`${this.base}/admin/collections/profiles`, {
        headers: this.headers(),
      }),
    );
  }

  list(options: { state?: CollectionState; owner?: string } = {}): Promise<CollectionListResponse> {
    const query = new URLSearchParams();
    if (options.state) query.set('state', options.state);
    if (options.owner) query.set('owner', options.owner);
    const suffix = query.size ? `?${query.toString()}` : '';
    return firstValueFrom(
      this.http.get<CollectionListResponse>(`${this.base}/admin/collections${suffix}`, {
        headers: this.headers(),
      }),
    );
  }

  create(collectionId: string, title: string): Promise<CollectionWorkspace> {
    return firstValueFrom(
      this.http.post<CollectionWorkspace>(
        `${this.base}/admin/collections`,
        { collectionId, title },
        { headers: this.headers() },
      ),
    );
  }

  get(collectionId: string): Promise<CollectionWorkspace> {
    return firstValueFrom(
      this.http.get<CollectionWorkspace>(
        `${this.base}/admin/collections/${encodeURIComponent(collectionId)}`,
        { headers: this.headers() },
      ),
    );
  }

  update(
    collectionId: string,
    draft: PropertyDossierDraftV1,
    revision: number,
    submitForReview = false,
  ): Promise<CollectionWorkspace> {
    return firstValueFrom(
      this.http.put<CollectionWorkspace>(
        `${this.base}/admin/collections/${encodeURIComponent(collectionId)}`,
        draft,
        {
          headers: this.headers(revision),
          params: submitForReview ? { submit_for_review: 'true' } : undefined,
        },
      ),
    );
  }

  seal(collectionId: string, revision: number): Promise<CollectionWorkspace> {
    return this.approvals.prepareSignAndRequireSecond({
      operation: 'collection.seal',
      revision,
      binding: {
        method: 'POST',
        path: `/admin/collections/${encodeURIComponent(collectionId)}/seal`,
        query: [],
        body: {},
        ifMatch: `"${revision}"`,
      },
    });
  }

  addComment(
    collectionId: string,
    section: string,
    body: string,
    blocking = true,
  ): Promise<ReviewComment> {
    return firstValueFrom(
      this.http.post<ReviewComment>(
        `${this.base}/admin/collections/${encodeURIComponent(collectionId)}/comments`,
        { section, body, blocking },
        { headers: this.headers() },
      ),
    );
  }


  review(
    collectionId: string,
    decision: 'APPROVED' | 'CHANGES_REQUESTED',
    note?: string,
  ): Promise<CollectionWorkspace> {
    return firstValueFrom(
      this.http.post<CollectionWorkspace>(
        `${this.base}/admin/collections/${encodeURIComponent(collectionId)}/reviews`,
        { decision, note: note?.trim() || undefined },
        { headers: this.headers() },
      ),
    );
  }

  resolveComment(collectionId: string, commentId: string): Promise<ReviewComment> {
    return firstValueFrom(
      this.http.post<ReviewComment>(
        `${this.base}/admin/collections/${encodeURIComponent(collectionId)}/comments/${encodeURIComponent(commentId)}/resolve`,
        {},
        { headers: this.headers() },
      ),
    );
  }

  refreshChainEvidence(collectionId: string): Promise<CollectionWorkspace> {
    return firstValueFrom(
      this.http.post<CollectionWorkspace>(
        `${this.base}/admin/collections/${encodeURIComponent(collectionId)}/refresh-chain-evidence`,
        {},
        { headers: this.headers() },
      ),
    );
  }

  appendAmendment(
    collectionId: string,
    revision: number,
    dossier: PropertyDossierV1,
    amendment: PropertyAmendmentV1,
  ): Promise<CollectionWorkspace> {
    return this.approvals.prepareSignAndRequireSecond({
      operation: 'collection.amend',
      revision,
      binding: {
        method: 'POST',
        path: `/admin/collections/${encodeURIComponent(collectionId)}/amendments`,
        query: [],
        body: { dossier, amendment },
        ifMatch: `"${revision}"`,
      },
    });
  }

  async uploadAsset(
    collectionId: string,
    file: File,
    details: CollectionAssetDetails,
  ): Promise<CollectionAsset> {
    const sha256 = await sha256File(file);
    const presigned = await firstValueFrom(
      this.http.post<PresignedAssetUpload>(
        `${this.base}/admin/collections/${encodeURIComponent(collectionId)}/assets/presign`,
        {
          assetId: details.assetId,
          kind: details.kind,
          filename: file.name,
          sha256,
          mimeType: file.type,
          byteSize: file.size,
          role: details.role,
          title: details.title,
          alt: details.alt,
          category: details.category,
          visibility: details.visibility || 'PUBLIC',
        },
        { headers: this.headers() },
      ),
    );
    const upload = await fetch(presigned.uploadUrl, {
      method: presigned.method,
      headers: presigned.headers,
      body: file,
    });
    if (!upload.ok) {
      throw new Error(`Object upload failed with HTTP ${upload.status}.`);
    }
    return firstValueFrom(
      this.http.post<CollectionAsset>(
        `${this.base}/admin/collections/${encodeURIComponent(collectionId)}/assets/${encodeURIComponent(details.assetId)}/complete`,
        {},
        { headers: this.headers() },
      ),
    );
  }

  getPublic(identifier: string): Promise<CollectionWorkspace> {
    return firstValueFrom(
      this.http.get<CollectionWorkspace>(
        `${this.base}/public/collections/${encodeURIComponent(identifier)}`,
      ),
    );
  }

  getPresale(identifier: string): Promise<PresaleSeries> {
    return firstValueFrom(
      this.http.get<PresaleSeries>(
        `${this.base}/presales/admin/${encodeURIComponent(identifier)}`,
      ),
    );
  }

  createPresale(
    collection: CollectionWorkspace,
    schedule: PresaleSchedule,
  ): Promise<never> {
    const body = {
      collectionId: collection.id,
      saleOpen: schedule.saleOpen,
      saleClose: schedule.saleClose,
      refundDeadline: schedule.refundDeadline,
      launchDeadline: schedule.launchDeadline,
    };
    return this.approvals.prepareSignAndRequireSecond({
      operation: 'presale.create',
      revision: collection.revision,
      binding: {
        method: 'POST',
        path: '/presales',
        query: [],
        body,
      },
    });
  }

  cancelPresale(
    collection: CollectionWorkspace,
    presale: PresaleSeries,
    reason: string,
  ): Promise<never> {
    return this.approvals.prepareSignAndRequireSecond({
      operation: 'presale.cancel',
      revision: collection.revision,
      binding: {
        method: 'POST',
        path: `/presales/${encodeURIComponent(presale.termsHash)}/cancel`,
        query: [],
        body: { reason },
      },
    });
  }

  launchPresale(
    collection: CollectionWorkspace,
    presale: PresaleSeries,
  ): Promise<never> {
    return this.approvals.prepareSignAndRequireSecond({
      operation: 'presale.launch',
      revision: collection.revision,
      binding: {
        method: 'POST',
        path: `/presales/${encodeURIComponent(presale.termsHash)}/launch`,
        query: [],
        body: {},
      },
    });
  }

  privateDownload(collectionId: string, assetId: string): Promise<PrivateAssetDownload> {
    return firstValueFrom(
      this.http.post<PrivateAssetDownload>(
        `${this.base}/admin/collections/${encodeURIComponent(collectionId)}/assets/${encodeURIComponent(assetId)}/private-download`,
        {},
        { headers: this.headers() },
      ),
    );
  }

  private headers(revision?: number): HttpHeaders {
    let headers = new HttpHeaders({ Authorization: `Bearer ${this.session.requireJwt()}` });
    if (revision !== undefined) headers = headers.set('If-Match', `"${revision}"`);
    return headers;
  }
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type CollectionState = 'DRAFT' | 'REVIEW' | 'SEALED' | 'PUBLISHED';

export interface CollectionFeatureStatus {
  metadataEnabled: boolean;
  mintingEnabled: boolean;
  maxCanonicalBytes: number;
  maxAssetBytes: number;
  network: 'testnet11' | 'mainnet';
}

export interface CollectionProfiles {
  assetClasses: Array<{ id: string; code: number; subtypes: string[] }>;
  projectStages: string[];
  programOverlays: string[];
  diligence: {
    common: string[];
    byAssetClass: Record<string, string[]>;
    byProjectStage: Record<string, string[]>;
    byProgramOverlay: Record<string, string[]>;
  };
  legalRight: 'future-sale-or-refinance-proceeds';
}

export interface CollectionReadinessIssue {
  code: string;
  path: string;
  message: string;
}

export interface CollectionReadiness {
  ready: boolean;
  issues: CollectionReadinessIssue[];
  metadataRoot: string | null;
  canonicalByteSize: number | null;
  allocationPpm: number;
  assetCount: number;
}

export interface CollectionAsset {
  assetId: string;
  kind: 'MEDIA' | 'DOCUMENT';
  role?: string | null;
  title?: string | null;
  alt?: string | null;
  category?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  objectKey?: string | null;
  expectedSha256: string;
  expectedMimeType: string;
  expectedByteSize: number;
  verifiedHttpsUrl: string | null;
  ipfsCid: string | null;
  actualSha256: string | null;
  actualMimeType: string | null;
  actualByteSize: number | null;
  malwareStatus: string;
  availabilityStatus: string;
  state: 'PENDING_UPLOAD' | 'UPLOADED' | 'VERIFIED' | 'PINNED' | 'FAILED';
  failureReason: string | null;
  revision: number;
}

export interface CollectionDeed {
  deedId: string;
  ordinal: number;
  sharePpm: number;
  parValueMojos: string;
  proposalId: string | null;
  proposalState: string;
  proposalHash: string | null;
  proposalLauncherId: string | null;
  deedLauncherId: string | null;
  outputCoinId: string | null;
  publishBundleId: string | null;
  executeBundleId: string | null;
  confirmationHeight: number | null;
}

export interface ReviewComment {
  id: string;
  actorSubject: string;
  section: string;
  body: string;
  blocking: boolean;
  resolved: boolean;
  createdAt: number;
}

export interface CollectionReview {
  id: string;
  reviewerSubject: string;
  decision: 'APPROVED' | 'CHANGES_REQUESTED';
  note: string | null;
  collectionRevision: number;
  createdAt: number;
}

export interface MetadataVersion {
  id: string;
  sequence: number;
  kind: 'ISSUANCE' | 'OWNER_AMENDMENT';
  metadataRoot: string;
  previousRoot: string | null;
  canonicalMetadata: PropertyDossierV1;
  envelope: PropertyAmendmentV1 | null;
  actorSubject: string;
  effectiveDate: string | null;
  createdAt: number;
}

export interface AnchorEvidence {
  id: string;
  deedId: string;
  anchorCoinId: string;
  spendBundleId: string | null;
  confirmationHeight: number | null;
  puzzleSolutionHash: string | null;
  reconstructedRoot: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'MISMATCH' | 'ORPHANED';
  details: Record<string, unknown>;
  checkedAt: number;
}

export interface CollectionWorkspace {
  id: string;
  slug: string;
  ownerSubject: string;
  ownerAuthType: string;
  state: CollectionState;
  revision: number;
  dossier: PropertyDossierDraftV1;
  metadataRoot: string | null;
  metadataAnchorId: string | null;
  firstProposalId: string | null;
  allocationLocked: boolean;
  canonicalByteSize: number | null;
  createdAt: number;
  updatedAt: number;
  sealedAt: number | null;
  publishedAt: number | null;
  deeds: CollectionDeed[];
  assets: CollectionAsset[];
  comments: ReviewComment[];
  reviews: CollectionReview[];
  metadataVersions: MetadataVersion[];
  anchorEvidence: AnchorEvidence[];
  auditEvents?: AuditEvent[];
  readiness: CollectionReadiness;
  verification?: {
    chainReconstructed: boolean;
    mediaVerified: boolean;
    verified: boolean;
    issuanceMetadataRoot: string | null;
    currentMetadataRoot: string | null;
    currentVersionGovernance: 'SGT_GOVERNED' | 'OWNER_SIGNED_UPDATE';
  };
}

export interface AuditEvent {
  id: number;
  actorSubject: string;
  action: string;
  details: Record<string, unknown>;
  occurredAt: number;
}

export interface CollectionListResponse {
  collections: CollectionWorkspace[];
  count: number;
}

export interface CollectionAssetDetails {
  assetId: string;
  kind: 'MEDIA' | 'DOCUMENT';
  role?: string;
  title?: string;
  alt?: string;
  category?: string;
  visibility?: 'PUBLIC' | 'PRIVATE';
}

export interface PrivateAssetDownload {
  assetId: string;
  downloadUrl: string;
  expiresIn: number;
}

interface PresignedAssetUpload {
  objectKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
  asset: CollectionAsset;
}

export interface PresaleSchedule {
  saleOpen: number;
  saleClose: number;
  refundDeadline: number;
  launchDeadline: number;
}

export type PresaleSeriesState = 'PRESALE' | 'LIVE' | 'CANCELED';
export type VoucherState =
  | 'PENDING_ISSUANCE'
  | 'ISSUANCE_SUBMITTED'
  | 'ESCROWED'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'REDEEMING'
  | 'REDEEMED';

export interface PresaleVoucher {
  serial: number;
  deedLauncherId: string;
  paymentRail: 'BASE_SEPOLIA_USDC' | 'CHIA_XCH';
  paymentPrincipal: number;
  basePriceMinor: number;
  technologyFeeBps: number;
  technologyFeeMinor: number;
  grossPriceMinor: number;
  originalPayer: string;
  vaultLauncherId: string;
  vaultP2PuzzleHash: string;
  purchaseId: string;
  globalPaymentId: string;
  commitmentHash: string;
  state: VoucherState;
  deliveryDeadline: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PresaleSeries {
  schema: 'solslot.refundable-voucher-series.v2';
  termsHash: string;
  seriesSingletonId: string;
  collectionId: string;
  state: PresaleSeriesState;
  terms: {
    collectionWorkspaceId: string;
    collectionId: string;
    metadataRoot: string;
    metadataAnchorId: string;
    allocationRoot: string;
    trustedProtocolTreasury: string;
    inventoryCap: number;
    saleOpen: number;
    saleClose: number;
    refundDeadline: number;
    launchDeadline: number;
    deliveryWindowSeconds: number;
    technologyFeeBps: number;
    deeds: Array<{
      deedId: string;
      deedLauncherId: string;
      ordinal: number;
      sharePpm: number;
      parValueMojos: number;
      basePriceMinor: number;
      technologyFeeMinor: number;
      grossPriceMinor: number;
    }>;
  };
  singletonLaunch: {
    parentCoinId: string | null;
    fullPuzzleHash: string | null;
    spendBundleId: string | null;
    status: 'MEMPOOL_ACCEPTED' | 'LEGACY_TEST_FIXTURE';
  };
  vouchers: PresaleVoucher[];
  launchedAt: number | null;
  deliveryDeadline: number | null;
  launchEvidenceId: string | null;
  governanceExecutionId: string | null;
  cancelReason: string | null;
  phaseTransition: {
    targetState: PresaleSeriesState | null;
    spendBundleId: string | null;
    inputCoinId: string | null;
    outputCoinId: string | null;
    outputInnerPuzzleHash: string | null;
    launchAnchor: number | null;
    governanceExecutionIds: string[];
    submittedAt: number | null;
    confirmedHeight: number | null;
    status: 'NOT_SUBMITTED' | 'MEMPOOL_ACCEPTED' | 'CONFIRMED';
  };
  createdAt: number;
  updatedAt: number;
}
