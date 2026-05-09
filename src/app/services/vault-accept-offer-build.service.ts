import { Injectable, InjectionToken, inject } from '@angular/core';

import {
  VaultAcceptOfferProofParams,
  ZkPassportAcceptOfferProofService,
} from './zkpassport-accept-offer-proof.service';

export interface VaultAcceptOfferBuildRequest {
  vaultLauncherId: string;
  deedLauncherId: string;
  tokenAmount: number;
  poolInnerPuzzleHash: string;
  currentTimestamp: number;
  signatureData?: string | null;
}

export interface VaultAcceptOfferBuilderInput
  extends VaultAcceptOfferBuildRequest,
    VaultAcceptOfferProofParams {
  signatureData: string | null;
}

export interface VaultAcceptOfferUnsignedPlaceholder {
  state: 'AOSP:PROOF_READY';
  unsignedSpendPackage: null;
  builderInput: VaultAcceptOfferBuilderInput;
}

export type VaultAcceptOfferBuildResult = VaultAcceptOfferUnsignedPlaceholder;

export type VaultAcceptOfferLowerBuilder = (
  input: VaultAcceptOfferBuilderInput,
) => VaultAcceptOfferBuildResult;

export const VAULT_ACCEPT_OFFER_LOWER_BUILDER = new InjectionToken<VaultAcceptOfferLowerBuilder>(
  'VAULT_ACCEPT_OFFER_LOWER_BUILDER',
  {
    providedIn: 'root',
    factory: () => (input) => ({
      state: 'AOSP:PROOF_READY',
      unsignedSpendPackage: null,
      builderInput: input,
    }),
  },
);

@Injectable({ providedIn: 'root' })
export class VaultAcceptOfferBuildService {
  private readonly proofService = inject(ZkPassportAcceptOfferProofService);
  private readonly lowerBuilder = inject(VAULT_ACCEPT_OFFER_LOWER_BUILDER);

  build(request: VaultAcceptOfferBuildRequest): VaultAcceptOfferBuildResult {
    const builderInput = this.proofService.withProofParams(request.vaultLauncherId, {
      ...request,
      signatureData: request.signatureData ?? null,
    });
    return this.lowerBuilder(builderInput);
  }
}
