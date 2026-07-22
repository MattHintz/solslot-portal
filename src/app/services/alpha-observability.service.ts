import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export type AlphaRail = 'XCH' | 'BASE_USDC' | 'VOUCHER_USDC';

@Injectable({ providedIn: 'root' })
export class AlphaObservabilityService {
  private readonly endpoint = environment.faucetApi.replace(/\/$/, '') + '/alpha';
  readonly correlationId = crypto.randomUUID();

  track(event: string, details: Record<string, unknown> = {}, rail?: AlphaRail): void {
    const releaseSha = environment.solslotProtocol.adminPortalSourceSha;
    const artifactHash = environment.solslotProtocol.artifactHash;
    if (!/^[0-9a-f]{40}$/.test(releaseSha) || !/^0x[0-9a-f]{64}$/i.test(artifactHash)) return;
    void fetch(`${this.endpoint}/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        event,
        correlation_id: this.correlationId,
        release_sha: releaseSha,
        artifact_hash: artifactHash,
        rail,
        details,
      }),
    }).catch(() => undefined);
  }

  async reportBug(input: {
    category: 'PAYMENT' | 'VOUCHER' | 'WALLET' | 'IDENTITY' | 'UI' | 'OTHER';
    summary: string;
    description: string;
    diagnosticsOptIn: boolean;
  }): Promise<string> {
    const response = await fetch(`${this.endpoint}/bug-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: input.category,
        summary: input.summary,
        description: input.description,
        correlation_id: this.correlationId,
        diagnostics_opt_in: input.diagnosticsOptIn,
        diagnostics: input.diagnosticsOptIn ? this.safeDiagnostics() : {},
      }),
    });
    if (!response.ok) throw new Error('Bug reporting is temporarily unavailable.');
    return (await response.json() as { id: string }).id;
  }

  private safeDiagnostics(): Record<string, string> {
    return {
      appVersion: environment.protocolVersion,
      experienceMode: environment.experienceMode,
      network: environment.chiaNetwork,
      browser: navigator.userAgent.slice(0, 240),
      route: location.pathname,
    };
  }
}
