import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import {
  CollectionApiService,
  CollectionFeatureStatus,
} from '../../../services/collection-api.service';
import {
  SolsMarketApiService,
  SolsMarketSnapshot,
} from '../../../services/sols-market-api.service';
import { formatError } from '../../../utils/format-error';

export interface HealthCheck {
  id: string;
  title: string;
  status: 'Healthy' | 'Waiting' | 'Blocked';
  impact: string;
  evidence?: unknown;
  route?: string;
}

@Component({
  selector: 'solslot-admin-system-health',
  standalone: true,
  imports: [CommonModule, RouterLink, AdminWorkspaceNavComponent],
  template: `
    <solslot-admin-workspace-nav />
    <main class="health-desk">
      <header>
        <div>
          <span class="eyebrow">Readiness</span>
          <h1>System health</h1>
          <p>See what is working, what is waiting, and what each issue affects.</p>
        </div>
        <div class="actions">
          <button type="button" (click)="reload()" [disabled]="loading()">Refresh checks</button>
        </div>
      </header>

      @if (error()) {
        <div class="notice notice--error">{{ error() }}</div>
      }

      <section class="health-list" aria-label="System checks">
        @for (check of checks(); track check.id) {
          <article>
            <span [class]="statusClass(check.status)">{{ check.status }}</span>
            <div>
              <strong>{{ check.title }}</strong>
              <p>{{ check.impact }}</p>
              @if (check.route) {
                <a class="check-link" [routerLink]="check.route">Open this work area</a>
              }
              @if (check.evidence) {
                <details>
                  <summary>Technical evidence</summary>
                  <pre>{{ check.evidence | json }}</pre>
                </details>
              }
            </div>
          </article>
        }
      </section>

      <aside>
        <strong>Closed means protected</strong>
        <span>
          Each check above shows what is available on this server. A signed launch archive
          does not by itself enable property drafting, minting, or purchases.
        </span>
      </aside>
    </main>
  `,
  styles: [
    `
      :host { display:block; min-height:100vh; background:#06110f; color:#eefbf5; }
      .health-desk { width:min(980px,calc(100% - 32px)); margin:0 auto; padding:42px 0 80px; }
      header,.actions,.health-list article { display:flex; align-items:center; justify-content:space-between; gap:16px; }
      header { align-items:flex-end; padding-bottom:22px; border-bottom:1px solid #245144; }
      .eyebrow { color:#67e7ad; font:700 11px monospace; text-transform:uppercase; }
      h1 { margin:7px 0; font-size:34px; letter-spacing:0; } p,aside span { color:#a9c2b8; }
      .actions a,.actions button { border:1px solid #4f8d77; background:#123329; color:white; padding:9px 12px; text-decoration:none; cursor:pointer; }
      .health-list { display:grid; gap:1px; margin-top:20px; border:1px solid #245144; background:#245144; }
      .health-list article { display:grid; grid-template-columns:110px 1fr; align-items:start; padding:16px; background:#0a1a16; }
      .health-list article > div { display:grid; gap:5px; } .health-list p { margin:0; }
      .status { padding:5px 7px; border:1px solid #4f8d77; color:#e8c66a; font:700 11px monospace; text-align:center; }
      .status--healthy { color:#67e7ad; } .status--blocked { color:#ffb49f; border-color:#844f4f; }
      .check-link { width:max-content; color:#8bf0bd; font-size:12px; text-decoration:none; }
      .check-link:hover { text-decoration:underline; }
      details { margin-top:8px; } summary { cursor:pointer; color:#8fb5a6; font-size:11px; }
      pre { max-height:260px; overflow:auto; padding:12px; background:#04100d; color:#bce8d5; font:11px monospace; }
      aside { display:grid; grid-template-columns:auto 1fr; gap:12px; margin-top:18px; padding:15px; border-left:3px solid #67e7ad; background:#0a1a16; }
      .notice--error { margin-top:16px; padding:12px; border:1px solid #844f4f; color:#ffc4c4; }
      @media (max-width:620px) { header { align-items:flex-start; flex-direction:column; } .health-list article { grid-template-columns:1fr; } aside { grid-template-columns:1fr; } }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSystemHealthComponent {
  private readonly http = inject(HttpClient);
  private readonly collections = inject(CollectionApiService);
  private readonly solsMarket = inject(SolsMarketApiService);
  readonly checks = signal<HealthCheck[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const [feature, node, protocol, launch, solsMarket] = await Promise.allSettled([
      this.collections.featureStatus(),
      firstValueFrom(this.http.get<unknown>(`${environment.faucetApi}/chia/provider-status`)),
      firstValueFrom(this.http.get<unknown>(`${environment.faucetApi}/protocol`)),
      firstValueFrom(this.http.get<{ enabled: boolean; network: string }>(
        `${environment.faucetApi}/admin/launch/public`,
      )),
      this.solsMarket.readMarket(),
    ]);
    const result: HealthCheck[] = [];
    result.push(this.featureCheck(feature));
    result.push(this.requestCheck('chia', 'Chia network provider', node, 'Testnet11 chain reads are available.'));
    result.push(this.requestCheck('protocol', 'Protocol coordinates', protocol, 'Signed protocol coordinates are available to the applications.'));
    result.push(
      solsMarket.status === 'fulfilled'
        ? solsMarketHealthCheck(solsMarket.value)
        : {
            id: 'sols-pool',
            title: 'SOLS secondary market',
            status: 'Blocked',
            impact: 'The customer-facing SOLS market could not be verified.',
            route: '/admin/pool-economics-v2',
          },
    );
    result.push(
      launch.status === 'fulfilled' && launch.value.enabled
        ? {
            id: 'launch',
            title: 'Alpha launch archive',
            status: 'Healthy',
            impact: 'The guided launch desk and signed archive are available.',
            evidence: launch.value,
          }
        : {
            id: 'launch',
            title: 'Alpha launch archive',
            status: 'Waiting',
            impact: 'The launch desk is intentionally unavailable on this server.',
          },
    );
    this.checks.set(result);
    const failures = [feature, node, protocol, launch, solsMarket]
      .filter((item): item is PromiseRejectedResult => item.status === 'rejected')
      .map((item) => formatError(item.reason));
    this.error.set(failures.length ? [...new Set(failures)].join(' ') : null);
    this.loading.set(false);
  }

  statusClass(status: HealthCheck['status']): string {
    return `status status--${status.toLowerCase()}`;
  }

  private featureCheck(
    result: PromiseSettledResult<CollectionFeatureStatus>,
  ): HealthCheck {
    if (result.status === 'rejected') {
      return {
        id: 'collections',
        title: 'Collection workspace',
        status: 'Blocked',
        impact: 'Collection readiness could not be verified.',
      };
    }
    return {
      id: 'collections',
      title: 'Collection workspace',
      status: result.value.metadataEnabled ? 'Healthy' : 'Waiting',
      impact: result.value.metadataEnabled
        ? `Draft and review are available. Minting is ${result.value.mintingEnabled ? 'open' : 'closed'}.`
        : 'Collection drafting is disabled. Its storage, pinning, and file-scanning services must be configured and checked before it opens.',
      evidence: result.value,
    };
  }

  private requestCheck(
    id: string,
    title: string,
    result: PromiseSettledResult<unknown>,
    healthyImpact: string,
  ): HealthCheck {
    return result.status === 'fulfilled'
      ? { id, title, status: 'Healthy', impact: healthyImpact, evidence: result.value }
      : { id, title, status: 'Blocked', impact: `${title} could not be verified.` };
  }
}

export function solsMarketHealthCheck(market: SolsMarketSnapshot): HealthCheck {
  const route = '/admin/sols-liquidity';
  if (market.rejectedCandidateCount > 0) {
    return {
      id: 'sols-pool',
      title: 'SOLS secondary market',
      status: 'Blocked',
      impact:
        `${market.rejectedCandidateCount} executed SmartDeed candidate` +
        `${market.rejectedCandidateCount === 1 ? '' : 's'} failed chain verification and remain hidden from customers.`,
      evidence: market,
      route,
    };
  }
  if (market.outcome !== 'READY') {
    return {
      id: 'sols-pool',
      title: 'SOLS secondary market',
      status: 'Waiting',
      impact: market.title,
      evidence: market,
      route,
    };
  }
  return {
    id: 'sols-pool',
    title: 'SOLS secondary market',
    status: 'Healthy',
    impact:
      `${market.verifiedOpportunityCount} chain-verified SmartDeed swap` +
      `${market.verifiedOpportunityCount === 1 ? ' is' : 's are'} visible to eligible customer vaults.`,
    evidence: market,
    route,
  };
}
