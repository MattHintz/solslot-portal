import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChiaSingletonReaderService } from '../../../services/chia-singleton-reader.service';
import { CoinsetService } from '../../../services/coinset.service';
import {
  SolslotPublicArtifact,
} from '../../../services/solslot-api.service';
import { SolslotProtocolArtifactService } from '../../../services/solslot-protocol-artifact.service';
import { formatError } from '../../../utils/format-error';

type RootKey =
  | 'sgt'
  | 'pool'
  | 'did'
  | 'governance'
  | 'navRegistry'
  | 'protocolConfig'
  | 'adminAuthority'
  | 'vaultVersionRegistry';

type RootStatus =
  | { kind: 'unverified' }
  | { kind: 'checking' }
  | {
      kind: 'confirmed';
      currentCoinId: string;
      confirmedBlockIndex: number;
      lineageDepth: number;
    }
  | { kind: 'error'; message: string };

interface TrustRootView {
  key: RootKey;
  label: string;
  role: string;
  coordinate: string;
  expectedHash: string | null;
  kind: 'coin' | 'singleton';
}

/**
 * Post-genesis trust-root inspector. The signed public artifact supplies the
 * only accepted coordinates; Coinset lineage checks prove those coordinates
 * were created in the ceremony block and still resolve to a live state coin.
 */
@Component({
  selector: 'pp-trust-roots',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p py-12 md:py-16">
      <header class="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
            Solslot Admin Desk
          </div>
          <h1 class="font-display text-4xl md:text-5xl">Trust roots</h1>
          <p class="mt-3 max-w-3xl text-sm leading-relaxed text-text-muted">
            Inspect the signed V2 artifact and independently resolve every
            ceremony coordinate on Chia testnet11. This page cannot launch,
            replace, or paste protocol coordinates.
          </p>
        </div>
        <a routerLink="/admin" class="btn btn--ghost">&larr; Dashboard</a>
      </header>

      @if (!artifact()) {
        <div class="mt-10 border border-red-500/40 bg-red-500/10 p-5">
          <div class="mono text-xs uppercase tracking-[0.2em] text-red-300">
            Protocol writes locked
          </div>
          <h2 class="font-display mt-2 text-2xl">Signed artifact unavailable</h2>
          <p class="mt-2 max-w-3xl text-sm text-text-muted">
            {{ artifactFailure() }} No administrator action is available until
            this build verifies a 2-of-3 signed Solslot V2 artifact pinned to
            its frozen source commit.
          </p>
          <a routerLink="/admin/genesis" class="btn btn--primary mt-5">
            Open Genesis desk
          </a>
        </div>
      } @else {
        <div class="mt-10 border border-brand/35 bg-brand/5 p-5">
          <div class="flex flex-wrap items-start justify-between gap-5">
            <div>
              <div class="mono text-xs uppercase tracking-[0.2em] text-brand">
                Signed artifact verified
              </div>
              <div class="mono mt-2 break-all text-xs text-text-muted">
                {{ signedArtifact.artifactHash }}
              </div>
            </div>
            <div class="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div>
                <div class="mono text-[0.65rem] uppercase text-text-muted">Network</div>
                <div class="mt-1">{{ signedArtifact.network }}</div>
              </div>
              <div>
                <div class="mono text-[0.65rem] uppercase text-text-muted">Ceremony block</div>
                <div class="mt-1">{{ signedArtifact.ceremony.confirmedBlockIndex }}</div>
              </div>
              <div>
                <div class="mono text-[0.65rem] uppercase text-text-muted">Admin quorum</div>
                <div class="mt-1">{{ signedArtifact.adminAuthority.threshold }} of {{ signedArtifact.adminAuthority.compressedPubkeys.length }}</div>
              </div>
              <div>
                <div class="mono text-[0.65rem] uppercase text-text-muted">Validator quorum</div>
                <div class="mt-1">{{ signedArtifact.validatorSet.threshold }} of {{ signedArtifact.validatorSet.pubkeys.length }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="mono text-xs uppercase tracking-[0.2em] text-text-muted">
              On-chain confirmation
            </div>
            <div class="font-display mt-1 text-2xl">
              {{ confirmedCount() }} of 8 verified
            </div>
          </div>
          <button
            type="button"
            class="btn btn--primary"
            [disabled]="isChecking()"
            (click)="verifyAll()"
          >
            {{ isChecking() ? 'Checking testnet11...' : 'Verify all on chain' }}
          </button>
        </div>

        <div class="mt-6 grid gap-4 md:grid-cols-2">
          @for (root of roots(); track root.key) {
            <article class="card">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="mono text-[0.65rem] uppercase tracking-[0.2em] text-brand">
                    {{ root.key }}
                  </div>
                  <h2 class="font-display mt-1 text-2xl">{{ root.label }}</h2>
                  <p class="mt-1 text-xs text-text-muted">{{ root.role }}</p>
                </div>
                <span class="state-pill" [attr.data-state]="status(root.key).kind">
                  {{ statusLabel(root.key) }}
                </span>
              </div>

              <dl class="mt-5 space-y-4 text-sm">
                <div>
                  <dt class="mono text-[0.65rem] uppercase text-text-muted">
                    {{ root.kind === 'coin' ? 'Genesis coin ID' : 'Launcher ID' }}
                  </dt>
                  <dd class="mono mt-1 break-all text-xs">{{ root.coordinate }}</dd>
                </div>
                @if (root.expectedHash) {
                  <div>
                    <dt class="mono text-[0.65rem] uppercase text-text-muted">Committed hash</dt>
                    <dd class="mono mt-1 break-all text-xs">{{ root.expectedHash }}</dd>
                  </div>
                }
                @if (status(root.key); as rootStatus) {
                  @if (rootStatus.kind === 'confirmed') {
                    <div class="grid grid-cols-2 gap-4">
                      <div>
                        <dt class="mono text-[0.65rem] uppercase text-text-muted">Block</dt>
                        <dd class="mt-1">{{ rootStatus.confirmedBlockIndex }}</dd>
                      </div>
                      <div>
                        <dt class="mono text-[0.65rem] uppercase text-text-muted">Lineage depth</dt>
                        <dd class="mt-1">{{ rootStatus.lineageDepth }}</dd>
                      </div>
                    </div>
                    <div>
                      <dt class="mono text-[0.65rem] uppercase text-text-muted">Current coin</dt>
                      <dd class="mono mt-1 break-all text-xs">{{ rootStatus.currentCoinId }}</dd>
                    </div>
                  } @else if (rootStatus.kind === 'error') {
                    <div class="border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-200">
                      {{ rootStatus.message }}
                    </div>
                  }
                }
              </dl>

              <button
                type="button"
                class="btn btn--ghost mt-5 text-xs"
                [disabled]="status(root.key).kind === 'checking'"
                (click)="verifyRoot(root)"
              >
                {{ status(root.key).kind === 'confirmed' ? 'Re-verify' : 'Verify on chain' }}
              </button>
            </article>
          }
        </div>

        <section class="mt-10 border-t border-border pt-8">
          <div class="mono text-xs uppercase tracking-[0.2em] text-text-muted">
            Frozen source commits
          </div>
          <dl class="mt-4 grid gap-3 md:grid-cols-2">
            @for (source of sourceEntries(signedArtifact); track source.name) {
              <div class="border border-border p-3">
                <dt class="mono text-[0.65rem] uppercase text-text-muted">{{ source.name }}</dt>
                <dd class="mono mt-1 break-all text-xs">{{ source.sha }}</dd>
              </div>
            }
          </dl>
        </section>
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
      .state-pill[data-state='confirmed'] {
        border-color: rgba(124, 255, 178, 0.5);
        background: rgba(124, 255, 178, 0.12);
        color: rgb(124, 255, 178);
      }
      .state-pill[data-state='checking'] {
        color: rgb(44, 231, 255);
      }
      .state-pill[data-state='error'] {
        border-color: rgba(248, 113, 113, 0.5);
        color: rgb(252, 165, 165);
      }
    `,
  ],
})
export class TrustRootsComponent {
  private readonly protocolArtifact = inject(SolslotProtocolArtifactService);
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly coinset = inject(CoinsetService);
  private readonly statuses = signal<Record<RootKey, RootStatus>>(
    initialStatuses(),
  );

  readonly artifact = computed(() => this.protocolArtifact.artifact);
  readonly artifactFailure = computed(() => this.protocolArtifact.failure);
  readonly roots = computed(() => buildRoots(this.protocolArtifact.artifact));
  readonly confirmedCount = computed(() =>
    Object.values(this.statuses()).filter((value) => value.kind === 'confirmed').length,
  );
  readonly isChecking = computed(() =>
    Object.values(this.statuses()).some((value) => value.kind === 'checking'),
  );

  get signedArtifact(): SolslotPublicArtifact {
    return this.protocolArtifact.artifact!;
  }

  status(key: RootKey): RootStatus {
    return this.statuses()[key];
  }

  statusLabel(key: RootKey): string {
    switch (this.status(key).kind) {
      case 'checking':
        return 'checking';
      case 'confirmed':
        return 'confirmed';
      case 'error':
        return 'failed';
      default:
        return 'unverified';
    }
  }

  async verifyAll(): Promise<void> {
    for (const root of this.roots()) await this.verifyRoot(root);
  }

  async verifyRoot(root: TrustRootView): Promise<void> {
    const artifact = this.protocolArtifact.artifact;
    if (!artifact) return;
    this.setStatus(root.key, { kind: 'checking' });
    try {
      if (root.kind === 'coin') {
        const record = await this.coinset.getCoinRecordByName(root.coordinate);
        if (!record) throw new Error('Genesis coin is absent from testnet11.');
        if (record.confirmed_block_index !== artifact.ceremony.confirmedBlockIndex) {
          throw new Error('Genesis coin confirmation block does not match the signed ceremony.');
        }
        this.setStatus(root.key, {
          kind: 'confirmed',
          currentCoinId: root.coordinate,
          confirmedBlockIndex: record.confirmed_block_index,
          lineageDepth: 1,
        });
        return;
      }

      const lineage = await this.singleton.walkLineage(root.coordinate);
      if (!lineage || lineage.nodes.length < 2) {
        throw new Error('Singleton eve coin is not confirmed on testnet11.');
      }
      if (
        lineage.launcher.confirmed_block_index !==
        artifact.ceremony.confirmedBlockIndex
      ) {
        throw new Error('Launcher confirmation block does not match the signed ceremony.');
      }
      const current = lineage.nodes[lineage.nodes.length - 1];
      if (current.isLauncher || current.spentBlockIndex !== null) {
        throw new Error('Singleton lineage does not end at a current unspent state coin.');
      }
      this.setStatus(root.key, {
        kind: 'confirmed',
        currentCoinId: current.coinId,
        confirmedBlockIndex: current.confirmedBlockIndex,
        lineageDepth: lineage.nodes.length,
      });
    } catch (error) {
      this.setStatus(root.key, { kind: 'error', message: formatError(error) });
    }
  }

  sourceEntries(artifact: SolslotPublicArtifact): Array<{ name: string; sha: string }> {
    return Object.entries(artifact.sourceShas).map(([name, sha]) => ({ name, sha }));
  }

  private setStatus(key: RootKey, status: RootStatus): void {
    this.statuses.update((current) => ({ ...current, [key]: status }));
  }
}

function initialStatuses(): Record<RootKey, RootStatus> {
  return {
    sgt: { kind: 'unverified' },
    pool: { kind: 'unverified' },
    did: { kind: 'unverified' },
    governance: { kind: 'unverified' },
    navRegistry: { kind: 'unverified' },
    protocolConfig: { kind: 'unverified' },
    adminAuthority: { kind: 'unverified' },
    vaultVersionRegistry: { kind: 'unverified' },
  };
}

function buildRoots(artifact: SolslotPublicArtifact | null): TrustRootView[] {
  if (!artifact) return [];
  return [
    {
      key: 'sgt',
      label: 'SGT genesis',
      role: 'Fresh governance CAT genesis and tail commitment.',
      coordinate: artifact.sgtGenesisCoinId,
      expectedHash: artifact.sgtTailHash,
      kind: 'coin',
    },
    singletonRoot('pool', 'Pool V3', 'Only deployable deed liquidity pool.', artifact),
    singletonRoot('did', 'Protocol DID', 'Canonical protocol identity root.', artifact),
    singletonRoot(
      'governance',
      'Governance',
      'Trusted 2-of-3 administration and proposal authority.',
      artifact,
      artifact.governanceStruct.treeHash,
    ),
    singletonRoot(
      'navRegistry',
      'NAV registry',
      'Versioned collection NAV authority.',
      artifact,
    ),
    singletonRoot(
      'protocolConfig',
      'Protocol config',
      'Immutable network and protocol coordinate registry.',
      artifact,
    ),
    singletonRoot(
      'adminAuthority',
      'Admin authority',
      'Three-member roster with a 2-of-3 threshold.',
      artifact,
      artifact.adminAuthority.mipsRootHash,
    ),
    singletonRoot(
      'vaultVersionRegistry',
      'Vault version registry',
      'Approved vault code and credential policy versions.',
      artifact,
    ),
  ];
}

function singletonRoot(
  key: Exclude<RootKey, 'sgt'>,
  label: string,
  role: string,
  artifact: SolslotPublicArtifact,
  expectedHash: string | null = null,
): TrustRootView {
  const hash =
    expectedHash ||
    (key === 'pool' ? artifact.puzzleHashes.poolInnerPuzzleHash : null);
  return {
    key,
    label,
    role,
    coordinate: artifact.launcherIds[key],
    expectedHash: hash,
    kind: 'singleton',
  };
}
