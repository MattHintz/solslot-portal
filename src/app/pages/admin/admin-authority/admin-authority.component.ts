import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminAuthorityV2Response } from '../../../services/admin-api.service';
import { OnChainStateService } from '../../../services/on-chain-state.service';
import { SolslotProtocolArtifactService } from '../../../services/solslot-protocol-artifact.service';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'solslot-admin-authority',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="container-p py-12 md:py-16">
      <header class="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
            Solslot Admin Desk
          </div>
          <h1 class="font-display text-4xl md:text-5xl">Current authority</h1>
          <p class="mt-3 max-w-3xl text-sm leading-relaxed text-text-muted">
            Read-only view of the on-chain admin authority state and the signed
            artifact roster. No actions can be taken from this screen.
          </p>
        </div>
        <a routerLink="/admin" class="btn btn--ghost">&larr; Dashboard</a>
      </header>

      @if (loading()) {
        <div class="mt-10 text-sm text-text-muted">Loading authority state...</div>
      }

      @if (error(); as message) {
        <section class="notice notice--error mt-6" role="alert">
          <strong>Authority lookup failed</strong>
          <span>{{ message }}</span>
        </section>
      }

      @if (authority(); as auth) {
        <div class="mt-8 grid gap-6 lg:grid-cols-2">
          <section class="panel">
            <div class="section-label">On-chain authority (v2)</div>
            <dl class="mt-4 space-y-4 text-sm">
              <div>
                <dt class="mono text-[0.65rem] uppercase text-text-muted">Status</dt>
                <dd class="mt-1">
                  <span class="state-pill" [attr.data-state]="auth.enabled ? 'ready' : 'locked'">
                    {{ auth.enabled ? 'enabled' : 'disabled / not deployed' }}
                  </span>
                </dd>
              </div>
              <div>
                <dt class="mono text-[0.65rem] uppercase text-text-muted">Launcher ID</dt>
                <dd class="mono mt-1 break-all text-xs">{{ auth.launcher_id || '—' }}</dd>
              </div>
              <div>
                <dt class="mono text-[0.65rem] uppercase text-text-muted">State hash</dt>
                <dd class="mono mt-1 break-all text-xs">{{ auth.state_hash || '—' }}</dd>
              </div>
              <div>
                <dt class="mono text-[0.65rem] uppercase text-text-muted">Phase</dt>
                <dd class="mt-1">{{ auth.phase }}</dd>
              </div>
              <div>
                <dt class="mono text-[0.65rem] uppercase text-text-muted">Gating source</dt>
                <dd class="mt-1">{{ auth.gating_source }}</dd>
              </div>
              <div>
                <dt class="mono text-[0.65rem] uppercase text-text-muted">Informational only</dt>
                <dd class="mt-1">{{ auth.informational_only ? 'yes' : 'no' }}</dd>
              </div>
            </dl>
          </section>

          <section class="panel">
            <div class="section-label">Signed artifact roster</div>
            @if (artifactFailure()) {
              <div class="mt-4 text-sm text-text-muted">
                {{ artifactFailure() }}
              </div>
            } @else if (artifact(); as art) {
              <dl class="mt-4 space-y-4 text-sm">
                <div>
                  <dt class="mono text-[0.65rem] uppercase text-text-muted">Artifact hash</dt>
                  <dd class="mono mt-1 break-all text-xs">{{ art.artifactHash }}</dd>
                </div>
                <div>
                  <dt class="mono text-[0.65rem] uppercase text-text-muted">Admin quorum</dt>
                  <dd class="mt-1">
                    {{ art.adminAuthority.threshold }} of
                    {{ art.adminAuthority.compressedPubkeys.length }}
                  </dd>
                </div>
                <div>
                  <dt class="mono text-[0.65rem] uppercase text-text-muted">Administrator pubkeys</dt>
                  <dd class="mt-2 space-y-2">
                    @for (pubkey of art.adminAuthority.compressedPubkeys; track pubkey) {
                      <div class="mono break-all text-xs">{{ pubkey }}</div>
                    }
                  </dd>
                </div>
                <div>
                  <dt class="mono text-[0.65rem] uppercase text-text-muted">Validator quorum</dt>
                  <dd class="mt-1">
                    {{ art.validatorSet.threshold }} of
                    {{ art.validatorSet.pubkeys.length }}
                  </dd>
                </div>
              </dl>
            } @else {
              <div class="mt-4 text-sm text-text-muted">No signed artifact loaded.</div>
            }
          </section>
        </div>

        <div class="mt-8 flex flex-wrap gap-3">
          <a routerLink="/admin/trust-roots" class="btn btn--ghost">Trust roots</a>
          <a routerLink="/admin/authority-v2/add-admin-slot" class="btn btn--ghost">
            Add admin slot
          </a>
          <a routerLink="/admin/authority-v2/roster-spend-package-review" class="btn btn--ghost">
            Review roster spend
          </a>
          <a routerLink="/admin/recovery" class="btn btn--ghost">Recovery</a>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .state-pill {
        flex: 0 0 auto;
        border: 1px solid rgba(255, 255, 255, 0.14);
        padding: 0.2rem 0.5rem;
        font-family: var(--font-mono);
        font-size: 0.65rem;
        text-transform: uppercase;
      }
      .state-pill[data-state='ready'] {
        border-color: rgba(124, 255, 178, 0.5);
        background: rgba(124, 255, 178, 0.12);
        color: rgb(124, 255, 178);
      }
      .state-pill[data-state='locked'] {
        border-color: rgba(248, 113, 113, 0.5);
        color: rgb(252, 165, 165);
      }
    `,
  ],
})
export class AdminAuthorityComponent implements OnInit {
  private readonly onChain = inject(OnChainStateService);
  private readonly protocolArtifact = inject(SolslotProtocolArtifactService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly authority = signal<AdminAuthorityV2Response | null>(null);

  readonly artifact = computed(() => this.protocolArtifact.artifact);
  readonly artifactFailure = computed(() => this.protocolArtifact.failure);

  async ngOnInit(): Promise<void> {
    try {
      const auth = await this.onChain.getAuthorityV2();
      this.authority.set(auth);
    } catch (err) {
      this.error.set(formatError(err));
    } finally {
      this.loading.set(false);
    }
  }
}
