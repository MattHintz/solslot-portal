import { JourneyTelemetryService } from './journey-telemetry.service';
import { journeyScreen } from './journey-transport';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';

export type AlphaRail = 'XCH' | 'BASE_USDC' | 'VOUCHER_USDC';

@Injectable({ providedIn: 'root' })
export class AlphaObservabilityService {
  private readonly journey = inject(JourneyTelemetryService);
  private readonly endpoint = environment.faucetApi.replace(/\/$/, '') + '/alpha';
  readonly correlationId = crypto.randomUUID();

  track(event: string, details: Record<string, unknown> = {}, rail?: AlphaRail): void {
    // Legacy callers cannot submit arbitrary detail values or raw routes.
    this.journey.record({action: event.includes('WALLET') ? 'wallet_prompt' : 'button_pressed'});
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
      screen: journeyScreen(location.pathname),
    };
  }
}
