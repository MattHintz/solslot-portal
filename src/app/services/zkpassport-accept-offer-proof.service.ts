import { Injectable, inject } from '@angular/core';

import {
  ZkPassportProofStoreService,
  type VaultAcceptOfferProofParams,
} from './zkpassport-proof-store.service';

export type { VaultAcceptOfferProofParams } from './zkpassport-proof-store.service';

@Injectable({ providedIn: 'root' })
export class ZkPassportAcceptOfferProofService {
  private readonly proofStore = inject(ZkPassportProofStoreService);

  requireProofParams(vaultLauncherId: string): VaultAcceptOfferProofParams {
    const proof = this.proofStore.acceptOfferProofParams(vaultLauncherId);
    if (!proof) {
      throw new ZkPassportEnrollmentRequiredError(vaultLauncherId);
    }
    return proof;
  }

  withProofParams<T extends AcceptOfferProofInput>(
    vaultLauncherId: string,
    input: T,
  ): T & VaultAcceptOfferProofParams {
    return {
      ...input,
      ...this.requireProofParams(vaultLauncherId),
    };
  }

  buildWithProof<TInput extends AcceptOfferProofInput, TResult>(
    vaultLauncherId: string,
    input: TInput,
    builder: (input: TInput & VaultAcceptOfferProofParams) => TResult,
  ): TResult {
    return builder(this.withProofParams(vaultLauncherId, input));
  }
}

export type AcceptOfferProofInput = object;

export class ZkPassportEnrollmentRequiredError extends Error {
  readonly code = 'zkpassport_enrollment_required';

  constructor(readonly vaultLauncherId: string) {
    super(
      `zkPassport enrollment is required before accepting offers for vault ${normalizeHex(vaultLauncherId)}`,
    );
    this.name = 'ZkPassportEnrollmentRequiredError';
  }
}

function normalizeHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X')
    ? `0x${value.slice(2).toLowerCase()}`
    : `0x${value.toLowerCase()}`;
}
