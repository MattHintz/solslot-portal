import { Injectable, InjectionToken, inject } from '@angular/core';

import { ZkPassportAcceptOfferProofService } from './zkpassport-accept-offer-proof.service';
import {
  VaultAcceptOfferBuildRequest,
  VaultAcceptOfferBuilderInput,
  VaultAcceptOfferSpendPackage,
  VaultAcceptOfferSpendService,
} from './vault-accept-offer-spend.service';

export type {
  CoinWithIdInput,
  ChainVaultAcceptOfferBuildRequest,
  VaultAcceptOfferAttestationProof,
  VaultAcceptOfferBuildRequest,
  VaultAcceptOfferBuilderInput,
  VaultAcceptOfferInnerSolutionInput,
  VaultAcceptOfferInnerSolutionVector,
  VaultAcceptOfferLineageProof,
  VaultAcceptOfferSpendPackage,
} from './vault-accept-offer-spend.service';

export type VaultAcceptOfferBuildResult = VaultAcceptOfferSpendPackage;

export type VaultAcceptOfferLowerBuilder = (
  input: VaultAcceptOfferBuilderInput,
) => VaultAcceptOfferBuildResult;

export const VAULT_ACCEPT_OFFER_LOWER_BUILDER = new InjectionToken<VaultAcceptOfferLowerBuilder>(
  'VAULT_ACCEPT_OFFER_LOWER_BUILDER',
  {
    providedIn: 'root',
    factory: () => {
      const spendService = inject(VaultAcceptOfferSpendService);
      return (input) => spendService.buildResolved(input);
    },
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
