import { Injectable, inject } from '@angular/core';

import { SessionService } from './session.service';
import { VaultCredentialReceiptService } from './vault-credential-receipt.service';

export interface VaultAcceptOfferProofParams {
  identityAttestRoot: string;
  attestationLeafHash: string;
  attestationProof: {
    bitpath: number;
    siblings: string[];
  };
}

@Injectable({ providedIn: 'root' })
export class ZkPassportAcceptOfferProofService {
  private readonly receipts = inject(VaultCredentialReceiptService);
  private readonly session = inject(SessionService);

  requireProofParams(
    vaultLauncherId: string,
    currentVaultCoinId?: string | null,
  ): VaultAcceptOfferProofParams {
    const receipt = this.receipts.confirmedReceipt(
      vaultLauncherId,
      currentVaultCoinId ?? this.currentCoinFor(vaultLauncherId),
    );
    if (!receipt) {
      throw new ZkPassportEnrollmentRequiredError(vaultLauncherId);
    }
    return {
      identityAttestRoot: receipt.identityAttestRoot,
      attestationLeafHash: receipt.attestationLeafHash,
      attestationProof: receipt.attestationProof,
    };
  }

  async refreshAndRequireProofParams(
    vaultLauncherId: string,
    currentVaultCoinId?: string | null,
  ): Promise<VaultAcceptOfferProofParams> {
    await this.receipts.refresh(vaultLauncherId);
    return this.requireProofParams(vaultLauncherId, currentVaultCoinId);
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

  private currentCoinFor(vaultLauncherId: string): string | null {
    const vault = this.session.vault();
    if (!vault?.vault_launcher_id || !vault.current_coin_id) return null;
    return normalizeHex(vault.vault_launcher_id) === normalizeHex(vaultLauncherId)
      ? vault.current_coin_id
      : null;
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
