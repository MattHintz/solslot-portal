import { Injectable, inject } from '@angular/core';

import {
  MemberOfferContext,
  OfferDetail,
  OfferEligibility,
  classifyOfferEligibility,
} from './offer-domain';
import {
  AcceptOfferCommitOptions,
  VaultAcceptOfferCommitResult,
  VaultAcceptOfferCommitService,
} from './vault-accept-offer-commit.service';
import {
  VaultAcceptOfferAuthorizationArgs,
  VaultAcceptOfferAuthorizationResult,
  VaultAcceptOfferAuthorizeService,
} from './vault-accept-offer-authorize.service';

@Injectable({ providedIn: 'root' })
export class VaultAcceptOfferLifecycleService {
  private readonly authorize = inject(VaultAcceptOfferAuthorizeService);
  private readonly commit = inject(VaultAcceptOfferCommitService);

  async authorizeEligibleAcceptOffer(
    args: AuthorizeEligibleAcceptOfferArgs,
  ): Promise<VaultAcceptOfferAuthorizationResult> {
    const eligibility = classifyOfferEligibility(args.offerDetail, args.context);
    if (eligibility.state !== 'EM:ELIGIBLE') {
      throw new OfferNotEligibleError(eligibility);
    }
    return this.authorize.authorizeFromChain({
      ...args.authorizationArgs,
      currentTimestamp:
        args.context.currentTimestamp ?? args.authorizationArgs.currentTimestamp,
    });
  }

  async commitAuthorizedAcceptOffer(
    authorization: VaultAcceptOfferAuthorizationResult,
    options?: AcceptOfferCommitOptions,
  ): Promise<VaultAcceptOfferCommitResult> {
    return this.commit.commitAuthorizedAcceptOffer(authorization, options);
  }
}

export interface AuthorizeEligibleAcceptOfferArgs {
  offerDetail: OfferDetail;
  context: MemberOfferContext;
  authorizationArgs: VaultAcceptOfferAuthorizationArgs;
}

export class OfferNotEligibleError extends Error {
  readonly eligibility: OfferEligibility;

  constructor(eligibility: OfferEligibility) {
    super(
      `vault accept-offer lifecycle: offer is not eligible (${eligibility.state}: ${eligibility.reason})`,
    );
    this.name = 'OfferNotEligibleError';
    this.eligibility = eligibility;
  }
}
