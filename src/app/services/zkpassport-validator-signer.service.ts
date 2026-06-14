import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import type { ValidatorBridgeSignature } from './zkpassport-evm-attestation-poller.service';

export interface ValidatorInfoResponse {
  pubkey_hex: string;
  threshold: number;
}

interface SignResponse {
  pubkey_hex: string;
  signature_hex: string;
  validator_message_hex: string;
}

/**
 * Fetches BLS validator signatures from the Populis API validator node.
 *
 * The API endpoint ``POST /zkpassport/sign`` accepts a ``validatorMessage``
 * (32-byte hex) and returns a BLS signature over it.  This service collects
 * the threshold signatures the portal needs before the bridge spend package
 * can be built.
 *
 * Returns 503 when the API is not configured with a validator seed.
 */
@Injectable({ providedIn: 'root' })
export class ZkPassportValidatorSignerService {
  private readonly http = inject(HttpClient);

  private get baseUrl(): string {
    return environment.faucetApi;
  }

  /** Fetch the validator BLS pubkey and threshold from the API. */
  async getValidatorInfo(): Promise<ValidatorInfoResponse> {
    return firstValueFrom(
      this.http.get<ValidatorInfoResponse>(`${this.baseUrl}/zkpassport/validator`),
    );
  }

  /**
   * Request a BLS signature over ``validatorMessage`` from the API validator node.
   *
   * @param validatorMessageHex  32-byte hex (with or without ``0x`` prefix)
   * @returns  A ``ValidatorBridgeSignature`` ready to pass into the EVM poller's
   *           ``assembleBridgeSpendPackage``.
   * @throws   When the API returns a non-2xx response (e.g. 503 unconfigured,
   *           422 bad message).
   */
  async signValidatorMessage(validatorMessageHex: string): Promise<ValidatorBridgeSignature> {
    const resp = await firstValueFrom(
      this.http.post<SignResponse>(`${this.baseUrl}/zkpassport/sign`, {
        validator_message_hex: validatorMessageHex,
      }),
    );
    return {
      validatorPubkey: '0x' + resp.pubkey_hex,
      signature: '0x' + resp.signature_hex,
    };
  }

  /**
   * Collect threshold signatures for a validator message.
   *
   * For the 1-of-1 testnet11 setup this issues a single POST.  The interface
   * is kept generic so it can be extended to multi-validator setups later
   * without changing callers.
   */
  async collectSignatures(validatorMessageHex: string): Promise<ValidatorBridgeSignature[]> {
    const sig = await this.signValidatorMessage(validatorMessageHex);
    return [sig];
  }
}
