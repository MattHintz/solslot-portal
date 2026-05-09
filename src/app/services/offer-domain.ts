export type OfferListingState =
  | 'OP:OFFER_READY'
  | 'OP:OFFER_UNAVAILABLE'
  | 'EM:ACCEPT_SUBMITTED'
  | 'EM:ACCEPT_CONFIRMED';

export type OfferEligibilityState =
  | 'NM:UNCONNECTED'
  | 'NM:NO_VAULT'
  | 'NM:VAULT_PENDING'
  | 'NM:ZK_REQUIRED'
  | 'EM:CHAIN_STALE'
  | 'EM:OFFER_UNAVAILABLE'
  | 'EM:NOT_ELIGIBLE'
  | 'EM:ELIGIBLE';

export type OfferEligibilityAction =
  | 'connect_wallet'
  | 'create_vault'
  | 'wait_for_vault_confirmation'
  | 'enroll_zkpassport'
  | 'refresh_chain_state'
  | 'none';

export interface OfferTerms {
  deedLauncherId: string;
  tokenAmount: number;
  priceMojos: number;
  acceptedAsset: string;
  expiresAt: number | null;
}

export interface OfferArtifact {
  artifactId: string;
  deedLauncherId: string;
  artifactHash: string | null;
  rawOffer: string | null;
}

export interface OfferGatingPolicy {
  requiresZkPassport: boolean;
  allowedVaultLauncherIds?: readonly string[];
}

export interface OfferSummary {
  id: string;
  title: string;
  deedLauncherId: string;
  state: OfferListingState;
  terms: OfferTerms;
}

export interface OfferDetail extends OfferSummary {
  artifact: OfferArtifact | null;
  gatingPolicy: OfferGatingPolicy;
}

export interface MemberOfferContext {
  walletConnected: boolean;
  vaultLauncherId?: string | null;
  vaultConfirmed?: boolean;
  zkPassportProofConfirmed?: boolean;
  chainStateFresh?: boolean;
  currentTimestamp?: number;
}

export interface OfferEligibility {
  state: OfferEligibilityState;
  canAccept: boolean;
  requiredAction: OfferEligibilityAction;
  reason: string;
}

export function classifyOfferEligibility(
  offer: OfferDetail | null,
  context: MemberOfferContext,
): OfferEligibility {
  const unavailable = unavailableOfferEligibility(offer, context);
  if (unavailable) {
    return unavailable;
  }
  if (!offer) {
    return blocked('EM:OFFER_UNAVAILABLE', 'none', 'Offer is not available.');
  }
  if (!context.walletConnected) {
    return blocked('NM:UNCONNECTED', 'connect_wallet', 'Connect a wallet before accepting this offer.');
  }
  if (!context.vaultLauncherId) {
    return blocked('NM:NO_VAULT', 'create_vault', 'Create or connect a vault before accepting this offer.');
  }
  if (context.vaultConfirmed === false) {
    return blocked(
      'NM:VAULT_PENDING',
      'wait_for_vault_confirmation',
      'Wait for the vault to confirm on chain before accepting this offer.',
    );
  }
  if (offer.gatingPolicy.requiresZkPassport && !context.zkPassportProofConfirmed) {
    return blocked(
      'NM:ZK_REQUIRED',
      'enroll_zkpassport',
      'Complete zkPassport enrollment before accepting this gated offer.',
    );
  }
  if (context.chainStateFresh === false) {
    return blocked(
      'EM:CHAIN_STALE',
      'refresh_chain_state',
      'Refresh chain state before accepting this offer.',
    );
  }
  if (!vaultIsAllowed(offer.gatingPolicy, context.vaultLauncherId)) {
    return blocked('EM:NOT_ELIGIBLE', 'none', 'This vault is not eligible to accept this offer.');
  }
  return {
    state: 'EM:ELIGIBLE',
    canAccept: true,
    requiredAction: 'none',
    reason: 'Vault is eligible to accept this offer.',
  };
}

function unavailableOfferEligibility(
  offer: OfferDetail | null,
  context: MemberOfferContext,
): OfferEligibility | null {
  if (!offer) {
    return blocked('EM:OFFER_UNAVAILABLE', 'none', 'Offer is not available.');
  }
  if (offer.state !== 'OP:OFFER_READY') {
    return blocked('EM:OFFER_UNAVAILABLE', 'none', 'Offer is not ready for acceptance.');
  }
  if (!offer.artifact) {
    return blocked('EM:OFFER_UNAVAILABLE', 'none', 'Offer artifact is not available.');
  }
  if (
    offer.terms.expiresAt !== null &&
    context.currentTimestamp !== undefined &&
    context.currentTimestamp > offer.terms.expiresAt
  ) {
    return blocked('EM:OFFER_UNAVAILABLE', 'none', 'Offer has expired.');
  }
  return null;
}

function blocked(
  state: Exclude<OfferEligibilityState, 'EM:ELIGIBLE'>,
  requiredAction: OfferEligibilityAction,
  reason: string,
): OfferEligibility {
  return {
    state,
    canAccept: false,
    requiredAction,
    reason,
  };
}

function vaultIsAllowed(gatingPolicy: OfferGatingPolicy, vaultLauncherId: string): boolean {
  const allowed = gatingPolicy.allowedVaultLauncherIds;
  if (!allowed || allowed.length === 0) {
    return true;
  }
  const normalizedVaultLauncherId = normalizeId(vaultLauncherId);
  return allowed.some((allowedVaultLauncherId) => normalizeId(allowedVaultLauncherId) === normalizedVaultLauncherId);
}

function normalizeId(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X')
    ? `0x${value.slice(2).toLowerCase()}`
    : `0x${value.toLowerCase()}`;
}
