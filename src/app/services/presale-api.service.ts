import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type PresalePhase = 'PRESALE' | 'LIVE' | 'CANCELED';
export type VoucherPaymentRail = 'BASE_SEPOLIA_USDC' | 'CHIA_XCH';

export interface PresaleTerms {
  terms_hash: string;
  series_id: string;
  inventory_cap: number;
  xch_price_mojos: number;
  base_usdc_price_units: number;
  sale_open: number;
  sale_close: number;
  launch_deadline: number;
  identity_attest_root: string;
  bridge_policy_hash: string;
}

export interface PresaleSeries {
  terms_hash: string;
  series_id: string;
  phase: PresalePhase;
  created_at: number;
  admin_approval_hash: string | null;
  governance_execution_id: string | null;
  terms: PresaleTerms;
}

export interface VoucherRecord {
  terms_hash: string;
  serial: number;
  payment_rail: VoucherPaymentRail;
  payment_principal: number;
  vault_launcher_id: string;
  holder_member_hash: string;
  base_refund_address_hash: string;
  status: 'ACTIVE' | 'REFUNDED' | 'REDEEMED';
  chain_evidence_id: string | null;
}

export interface VoucherPurchaseRequest {
  serial: number;
  payment_rail: VoucherPaymentRail;
  payment_principal: number;
  vault_launcher_id: string;
  holder_member_hash: string;
  base_refund_address_hash: string;
}
@Injectable({ providedIn: 'root' })
export class PresaleApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.faucetApi;

  list(): Promise<PresaleSeries[]> {
    return firstValueFrom(this.http.get<PresaleSeries[]>(`${this.base}/presales/admin`));
  }

  get(termsHash: string): Promise<PresaleSeries> {
    return firstValueFrom(
      this.http.get<PresaleSeries>(
        `${this.base}/presales/admin/${encodeURIComponent(termsHash)}`,
      ),
    );
  }

  purchase(termsHash: string, request: VoucherPurchaseRequest): Promise<VoucherRecord> {
    return firstValueFrom(this.http.post<VoucherRecord>(`${this.base}/presales/${termsHash}/vouchers`, request));
  }

  voucher(termsHash: string, serial: number): Promise<VoucherRecord> {
    return firstValueFrom(this.http.get<VoucherRecord>(`${this.base}/presales/${termsHash}/vouchers/${serial}`));
  }
  refund(termsHash: string, serial: number, chainEvidenceId: string): Promise<VoucherRecord> {
    return firstValueFrom(
      this.http.post<VoucherRecord>(`${this.base}/presales/${termsHash}/vouchers/${serial}/refund`, null, {
        params: { chain_evidence_id: chainEvidenceId },
      }),
    );
  }
}
