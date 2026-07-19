export const PROPERTY_DOSSIER_SCHEMA = 'solslot.property-dossier.v1' as const;
export const METADATA_ENVELOPE_SCHEMA = 'solslot.metadata-envelope.v1' as const;
export const PROPERTY_AMENDMENT_SCHEMA = 'solslot.property-amendment.v1' as const;
export const MAX_CANONICAL_METADATA_BYTES = 24 * 1024;
export const TARGET_ALLOCATION_PPM = 1_000_000;

export interface AssetDescriptorV1 {
  assetId: string;
  uris: string[];
  sha256: string;
  cid: string;
  mimeType: string;
  byteSize: number;
}

export interface MediaAssetV1 extends AssetDescriptorV1 {
  role: 'hero' | 'gallery' | 'floorplan' | 'other';
  alt: string;
}

export interface DocumentAssetV1 extends AssetDescriptorV1 {
  title: string;
  category: string;
}

export interface DeedAllocationV1 {
  deedId: string;
  sharePpm: number;
  parValueMojos: string;
  proposalId?: string;
  deedLauncherId?: string;
}

export interface PropertyDossierV1 {
  schemaVersion: typeof PROPERTY_DOSSIER_SCHEMA;
  collectionId: string;
  revision: number;
  title: string;
  summary: string;
  property: {
    address: {
      line1: string;
      line2?: string;
      city: string;
      region: string;
      postalCode: string;
      country: string;
    };
    propertyType: string;
    yearBuilt?: number;
    bedrooms?: string;
    bathrooms?: string;
    interiorSquareFeet?: string;
    lotSquareFeet?: string;
    latitude?: string;
    longitude?: string;
  };
  media: MediaAssetV1[];
  valuation: {
    asOfDate: string;
    marketValueMinor: string;
    currency: string;
    method: string;
    source: string;
  };
  offering: {
    targetRaiseMinor: string;
    currency: string;
    parValueMojos: string;
    assetClass: string;
    jurisdiction: string;
    royaltyPuzhash: string;
    royaltyBps: string;
    governanceQuorum: string;
    minimumInvestmentMinor?: string;
    projectedReturnBps?: string;
    termMonths?: string;
  };
  operations: {
    occupancyStatus: string;
    monthlyGrossRentMinor: string;
    annualOperatingExpenseMinor: string;
    currency: string;
    leaseSummary?: string;
    manager?: string;
  };
  capital: {
    debtBalanceMinor: string;
    debtRateBps: string;
    debtMaturityDate?: string;
    currency: string;
    plannedUses?: Array<{ label: string; amountMinor: string }>;
  };
  legal: {
    issuerLegalName: string;
    securityStructure: string;
    collateralSummary: string;
    filingStatus: string;
    filingReference?: string;
    priorityDescription?: string;
    settlementBasis?: string;
    transferPolicy: string;
  };
  risks: Array<{
    riskId: string;
    title: string;
    severity: 'low' | 'medium' | 'high';
    detail: string;
  }>;
  documents: DocumentAssetV1[];
  history: Array<{ date: string; title: string; detail: string }>;
  disclosures: string[];
  dataSources: Array<{ name: string; asOfDate: string; url: string }>;
  deedAllocation: DeedAllocationV1[];
}

export interface DraftMediaAssetV1 {
  assetId: string;
  role: MediaAssetV1['role'];
  alt: string;
  uris?: string[];
  sha256?: string;
  cid?: string;
  mimeType?: string;
  byteSize?: number;
}

export interface DraftDocumentAssetV1 {
  assetId: string;
  title: string;
  category: string;
  uris?: string[];
  sha256?: string;
  cid?: string;
  mimeType?: string;
  byteSize?: number;
}

export interface DraftPropertyIdentityV1 {
  address: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  propertyType?: string;
  yearBuilt?: number;
  bedrooms?: string;
  bathrooms?: string;
  interiorSquareFeet?: string;
  lotSquareFeet?: string;
  latitude?: string;
  longitude?: string;
}

export type DraftValuationV1 = Partial<PropertyDossierV1['valuation']>;
export type DraftOfferingV1 = Partial<PropertyDossierV1['offering']>;
export type DraftOperationsV1 = Partial<PropertyDossierV1['operations']>;
export type DraftLegalV1 = Partial<PropertyDossierV1['legal']>;

export interface DraftCapitalV1
  extends Partial<Omit<PropertyDossierV1['capital'], 'plannedUses'>> {
  plannedUses: Array<{ label?: string; amountMinor?: string }>;
}

export interface DraftRiskV1 {
  riskId?: string;
  title?: string;
  severity?: 'low' | 'medium' | 'high';
  detail?: string;
}

export interface DraftHistoryEventV1 {
  date?: string;
  title?: string;
  detail?: string;
}

export interface DraftDataSourceV1 {
  name?: string;
  asOfDate?: string;
  url?: string;
}

export interface DraftDeedAllocationV1 {
  deedId?: string;
  sharePpm?: number;
  parValueMojos?: string;
  proposalId?: string;
  deedLauncherId?: string;
}

export interface PropertyDossierDraftV1 {
  schemaVersion: typeof PROPERTY_DOSSIER_SCHEMA;
  collectionId: string;
  revision: number;
  title: string;
  summary?: string;
  property?: DraftPropertyIdentityV1;
  media: DraftMediaAssetV1[];
  valuation?: DraftValuationV1;
  offering?: DraftOfferingV1;
  operations?: DraftOperationsV1;
  capital?: DraftCapitalV1;
  legal?: DraftLegalV1;
  risks: DraftRiskV1[];
  documents: DraftDocumentAssetV1[];
  history: DraftHistoryEventV1[];
  disclosures: string[];
  dataSources: DraftDataSourceV1[];
  deedAllocation: DraftDeedAllocationV1[];
}

export interface MetadataEnvelopeV1 {
  schemaVersion: typeof METADATA_ENVELOPE_SCHEMA;
  metadataRoot: string;
  metadataAnchorId: string;
  canonicalByteSize: number;
  chunkCount: number;
}

export type PropertyAmendmentSignatureV1 =
  | {
      scheme: 'eip712';
      signer: string;
      signature: string;
      chainId: string;
      typedDataHash: string;
    }
  | {
      scheme: 'bls';
      signer: string;
      signature: string;
      messageHash: string;
    };

export interface PropertyAmendmentV1 {
  schemaVersion: typeof PROPERTY_AMENDMENT_SCHEMA;
  collectionId: string;
  previousRoot: string;
  newRoot: string;
  reason: string;
  effectiveDate: string;
  changedFields: string[];
  signature: PropertyAmendmentSignatureV1;
}

export const PROTECTED_AMENDMENT_PATHS = Object.freeze([
  '/deedAllocation',
  '/offering/parValueMojos',
  '/offering/assetClass',
  '/offering/jurisdiction',
  '/offering/royaltyPuzhash',
  '/offering/royaltyBps',
  '/offering/governanceQuorum',
  '/offering/targetRaiseMinor',
  '/legal/securityStructure',
  '/legal/settlementBasis',
]);
