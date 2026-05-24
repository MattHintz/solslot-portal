import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AdminAuthorityResponse,
  AdminAuthorityV2Response,
} from '../../../services/admin-api.service';
import { ProtocolInfo } from '../../../services/populis-api.service';
import { OnChainStateService } from '../../../services/on-chain-state.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import {
  ChiaSingletonReaderService,
  SingletonLineage,
} from '../../../services/chia-singleton-reader.service';
import { ChiaWasmService } from '../../../services/chia-wasm.service';
import { formatError } from '../../../utils/format-error';
import { environment } from '../../../../environments/environment';

/**
 * Verification status for a single trust-root singleton card.
 *
 * - ``not-configured`` — operator hasn't deployed this singleton yet.
 * - ``pending`` — verification not yet attempted on this page load.
 * - ``walking`` — actively walking lineage / fetching spend.
 * - ``replaying`` — running the puzzle in WASM.
 * - ``match`` — on-chain state_hash matches API's published value.
 * - ``mismatch`` — they differ; operator drift.
 * - ``error`` — coinset.org or WASM raised; surfaces details.
 * - ``no-spends-yet`` — singleton confirmed but never spent (pristine launch).
 */
type VerifyStatus =
  | { kind: 'not-configured' }
  | { kind: 'pending' }
  | { kind: 'walking' | 'replaying' }
  | {
      kind: 'match';
      onChainStateHash: string;
      apiStateHash: string;
      lineageDepth: number;
      latestBlockIndex: number;
    }
  | {
      kind: 'mismatch';
      onChainStateHash: string;
      apiStateHash: string;
    }
  | { kind: 'no-spends-yet'; lineageDepth: number }
  | { kind: 'error'; message: string };

/**
 * Trust Roots admin page (Phase 3).
 *
 * Surfaces the four A.x trust-root singletons published by the API at
 * /protocol + /admin/auth/authority and lets the operator (or any
 * curious admin) verify that the published state matches what's
 * actually on chain.  Verification is end-to-end:
 *
 *   1. Read the API's claim — launcher_id, mod_hash, state_hash.
 *   2. Walk the singleton lineage on coinset.org (no API involvement).
 *   3. Replay the most recent spend in chia-wallet-sdk-wasm.
 *   4. Pull the CREATE_PUZZLE_ANNOUNCEMENT body whose first byte is
 *      PROTOCOL_PREFIX (0x50).  For every A.x puzzle that body is
 *      `PROTOCOL_PREFIX || state_hash` by construction.
 *   5. Compare the on-chain state_hash with the API-published value.
 *      Match  -> green badge "verified".
 *      Differ -> red banner "operator drift; check on coinset.org".
 *
 * The page surfaces three audit-driven UX features (POP-CANON-017/018/021):
 *
 *   - A Phase-2 disclaimer banner (POP-CANON-021): published BLS state
 *     is informational; gating source is the EVM allowlist.
 *   - Per-pubkey-hash size validity badge (POP-CANON-018): each
 *     allowlist_pubkey_hashes entry should be 32 bytes (sha256 of
 *     the original 48-byte BLS G1 pubkey).
 *   - Cardinality summary (POP-CANON-017 spirit): allowlist size +
 *     quorum_m so dilution is visible at a glance.
 *
 * Auth: gated by adminAuthGuard.  A signed-in admin is required to
 * view this page (third parties can already read /admin/auth/authority
 * and /protocol directly without us ever needing to mediate).
 */
@Component({
  selector: 'pp-trust-roots',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-12 pb-24">
      <header class="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
            Populis · Admin Desk
          </div>
          <h1 class="font-display text-4xl md:text-5xl">Trust roots.</h1>
          <p class="mt-2 max-w-2xl text-text-muted text-sm">
            On-chain singletons that hold protocol authority.  Each card
            shows what the API publishes, then lets you verify it against
            chain via coinset.org and chia-wallet-sdk WASM running in your
            browser.  Operator-state-vs-on-chain-state drift becomes
            visible.
          </p>
        </div>
        <a routerLink="/admin" class="btn btn--ghost">&larr; Back to dashboard</a>
      </header>

      <!-- POP-CANON-021 Phase-2 disclaimer banner -->
      @if (primaryAuthority(); as a) {
        @if (a.informational_only) {
          <div class="mt-8 rounded-card border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
            <div class="font-display text-base text-amber-300 mb-1">
              Phase {{ a.phase || '2-informational-only' }} — informational only
            </div>
            <p class="text-text-muted leading-relaxed">
              The on-chain admin-authority state below is published as a
              transparency surface.  Today the actual gating source for
              <span class="mono text-text">/admin/*</span> is
              <span class="mono text-text">{{ a.gating_source || 'POPULIS_ADMIN_PUBKEY_ALLOWLIST' }}</span>.
              Phase 2.5 will swap the gating source to the on-chain
              singleton; until then operators must keep the EVM ↔ BLS
              allowlist mapping consistent off-chain (the API's startup
              validator refuses to boot if it detects drift; see
              <span class="mono">POP-CANON-021</span>).
            </p>
          </div>
        }
      }

      @if (!chiaWasmReady()) {
        <div class="mt-8 rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <div class="font-display text-base text-red-300 mb-1">
            Chia WASM not loaded
          </div>
          <p class="text-text-muted leading-relaxed">
            On-chain verification needs chia-wallet-sdk-wasm to replay
            spend bundles.  The WASM init failed at page load; the cards
            below show the API's published state but no chain-verify
            badges will appear.  Reload the page to retry.
          </p>
        </div>
      }

      <div class="mt-10 grid gap-6 md:grid-cols-2">
        <h2 class="font-display text-xl md:col-span-2 mt-2 -mb-2">
          Admin authority
          <span class="mono text-[0.65rem] uppercase tracking-[0.2em] text-text-muted ml-2 align-middle">
            {{ authorityV2()?.launcher_id ? 'A.5' : 'A.2 / A.5' }}
          </span>
        </h2>
        <!-- A.2 admin authority -->
        @if (showLegacyAuthority()) {
        <div class="card flex flex-col">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="mono text-[0.65rem] uppercase tracking-[0.2em] text-brand">
                A.2
              </div>
              <h3 class="font-display text-2xl mt-1">BLS quorum (v1)</h3>
              <p class="text-xs text-text-muted mt-1">
                m-of-n BLS quorum with on-chain rotation.
              </p>
            </div>
            <ng-container [ngTemplateOutlet]="statusBadge" [ngTemplateOutletContext]="{ s: adminAuthorityStatus() }"></ng-container>
          </div>

          @if (!authority()?.launcher_id) {
            <p class="mt-5 text-xs text-text-muted leading-relaxed flex-1">
              Legacy v1 is not configured.  Populate
              <span class="mono">POPULIS_ADMIN_AUTHORITY_*</span>
              on the API to enable on-chain verification here.
            </p>
          } @else {
          <dl class="mt-5 space-y-3 text-sm flex-1">
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Launcher ID
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ authority()?.launcher_id }}
              </dd>
            </div>
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Quorum
              </dt>
              <dd class="font-display text-xl mt-1">
                @if (authority()?.enabled) {
                  {{ authority()?.quorum_m }} of {{ authority()?.allowlist_pubkey_hashes?.length || 0 }}
                  <span class="text-xs text-text-muted ml-1">
                    (v{{ authority()?.authority_version }})
                  </span>
                } @else {
                  <span class="text-text-muted text-sm">disabled</span>
                }
              </dd>
            </div>
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                State hash
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ authority()?.state_hash || '—' }}
              </dd>
            </div>

            <!-- POP-CANON-018: surface pubkey-hash sizes so a malformed -->
            <!-- entry is visible (sha256 results are always 32 bytes). -->
            @if (authority()?.allowlist_pubkey_hashes?.length) {
              <div>
                <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  Allowlist pubkey hashes
                </dt>
                <dd class="mt-1 grid gap-1">
                  @for (h of authority()?.allowlist_pubkey_hashes; track h) {
                    <div class="flex items-center gap-2 text-xs">
                      <span class="mono break-all flex-1">{{ h }}</span>
                      <span
                        class="mono text-[0.6rem] px-1.5 py-0.5 rounded"
                        [class.bg-brand]="isHash32(h)"
                        [class.text-bg]="isHash32(h)"
                        [class.bg-red-500]="!isHash32(h)"
                        [class.text-white]="!isHash32(h)"
                      >
                        {{ hashLengthLabel(h) }}
                      </span>
                    </div>
                  }
                </dd>
              </div>
            }
          </dl>
          }

          @if (authority()?.launcher_id) {
            <div class="mt-5 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                class="btn btn--ghost text-xs"
                [disabled]="!chiaWasmReady() || isWalking(adminAuthorityStatus())"
                (click)="verifyAdminAuthority()"
              >
                {{ verifyButtonLabel(adminAuthorityStatus()) }}
              </button>
              @if (verifyDetail(adminAuthorityStatus()); as detail) {
                <span class="text-xs text-text-muted">{{ detail }}</span>
              }
            </div>
          }
        </div>
        }

        <!-- A.5 admin authority v2 (Phase 9-Hermes-C) -->
        <div class="card flex flex-col">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="mono text-[0.65rem] uppercase tracking-[0.2em] text-brand">
                A.5
              </div>
              <h3 class="font-display text-2xl mt-1">MIPS quorum (v2)</h3>
              <p class="text-xs text-text-muted mt-1">
                MIPS m-of-n quorum with per-admin OneOfN
                (BLS / EIP-712 / passkey).
              </p>
            </div>
            <ng-container [ngTemplateOutlet]="statusBadge" [ngTemplateOutletContext]="{ s: adminAuthorityV2Status() }"></ng-container>
          </div>

          @if (!authorityV2()?.launcher_id) {
            <p class="mt-5 text-xs text-text-muted leading-relaxed flex-1">
              Launch the v2 admin-authority singleton to enable
              chain verification here.
            </p>
          } @else {
          <dl class="mt-5 space-y-3 text-sm flex-1">
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Launcher ID
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ authorityV2()?.launcher_id }}
              </dd>
            </div>
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Migration phase
              </dt>
              <dd class="font-display text-xl mt-1">
                @if (authorityV2()?.enabled) {
                  {{ authorityV2()?.phase }}
                  <span class="text-xs text-text-muted ml-1">
                    (v{{ authorityV2()?.authority_version }})
                  </span>
                } @else {
                  <span class="text-text-muted text-sm">disabled</span>
                }
              </dd>
            </div>
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                MIPS root hash
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ authorityV2()?.mips_root_hash || '—' }}
              </dd>
            </div>
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Admins-list hash
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ authorityV2()?.admins_hash || '—' }}
              </dd>
            </div>
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Pending-ops hash
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ authorityV2()?.pending_ops_hash || '— empty —' }}
              </dd>
            </div>
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                State hash
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ authorityV2()?.state_hash || '—' }}
              </dd>
            </div>
          </dl>
          }

          @if (authorityV2()?.launcher_id) {
            <div class="mt-5 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                class="btn btn--ghost text-xs"
                [disabled]="!chiaWasmReady() || isWalking(adminAuthorityV2Status())"
                (click)="verifyAdminAuthorityV2()"
              >
                {{ verifyButtonLabel(adminAuthorityV2Status()) }}
              </button>
              @if (verifyDetail(adminAuthorityV2Status()); as detail) {
                <span class="text-xs text-text-muted">{{ detail }}</span>
              }
            </div>
          }
        </div>

        <h2 class="font-display text-xl md:col-span-2 mt-6 -mb-2">
          Protocol surfaces
          <span class="mono text-[0.65rem] uppercase tracking-[0.2em] text-text-muted ml-2 align-middle">
            A.3 / A.4
          </span>
        </h2>
        <!-- A.3 protocol config -->
        <div class="card flex flex-col">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="mono text-[0.65rem] uppercase tracking-[0.2em] text-brand">A.3</div>
              <h3 class="font-display text-2xl mt-1">Protocol config</h3>
              <p class="text-xs text-text-muted mt-1">
                Pool / governance launcher ids + chain network.
              </p>
            </div>
            <ng-container [ngTemplateOutlet]="statusBadge" [ngTemplateOutletContext]="{ s: protocolConfigStatus() }"></ng-container>
          </div>

          @if (!protocol()?.protocol_config_launcher_id) {
            <p class="mt-5 text-xs text-text-muted leading-relaxed flex-1">
              Network: <span class="mono">{{ protocol()?.network || '—' }}</span>.
              Launch the protocol-config singleton, then set
              <span class="mono">POPULIS_PROTOCOL_CONFIG_LAUNCHER_ID</span>.
            </p>
            <div class="mt-4 rounded-card border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-text-muted">
              <div class="font-display text-sm text-yellow-100">Vault registration is locked</div>
              <p class="mt-2 leading-relaxed">
                A.3 is the protocol configuration trust root.  It records the pool, governance,
                network, and version on chain so a broker or auditor can later verify that users
                registered against the intended protocol.
              </p>
              <div class="mt-3 grid gap-3">
                <div>
                  <div class="font-display text-sm text-text">Who launches it</div>
                  <p class="mt-1 leading-relaxed">
                    An authorized technical protocol operator launches this singleton after the
                    firm's off-chain approval record is complete.  This page does not create legal
                    approval, register a vault, mint securities, or ask for private keys.
                  </p>
                </div>
                <div>
                  <div class="font-display text-sm text-text">What must be ready</div>
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>Approved pool launcher id.</li>
                    <li>Approved governance launcher id.</li>
                    <li>Correct network, such as testnet11 or mainnet.</li>
                    <li>Governance public key and a funded Chia wallet coin for the singleton launch.</li>
                  </ul>
                </div>
                <div>
                  <div class="font-display text-sm text-text">After launch</div>
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>Capture the A.3 launcher id.</li>
                    <li>Set <span class="mono">POPULIS_PROTOCOL_CONFIG_LAUNCHER_ID</span> in the API environment.</li>
                    <li>Restart the API, then verify <span class="mono">/protocol</span> and this Trust Roots card.</li>
                    <li>Keep the approval record, launcher id, environment change, and verification result for audit review.</li>
                  </ul>
                </div>
              </div>
              <p class="mt-3 leading-relaxed">
                Technical support procedure: <span class="mono">populis_api/GENESIS_README.md §A.3</span>
                and <span class="mono">populis_api/SECURITY.md §A.3</span>.
              </p>
              <a routerLink="/admin/launch-protocol-config" class="btn btn--primary text-xs mt-4">
                Launch A.3 in portal
              </a>
            </div>
          } @else {
          <dl class="mt-5 space-y-3 text-sm flex-1">
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Launcher ID
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ protocol()?.protocol_config_launcher_id }}
              </dd>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  Network
                </dt>
                <dd class="font-display text-lg mt-1">
                  {{ protocol()?.network }}
                </dd>
              </div>
              <div>
                <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  Version
                </dt>
                <dd class="font-display text-lg mt-1">
                  {{ protocol()?.protocol_config_version }}
                </dd>
              </div>
            </div>
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Content hash
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ protocol()?.protocol_config_hash || '—' }}
              </dd>
            </div>
          </dl>
          }

          @if (protocol()?.protocol_config_launcher_id) {
            <div class="mt-5 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                class="btn btn--ghost text-xs"
                [disabled]="!chiaWasmReady() || isWalking(protocolConfigStatus())"
                (click)="verifyProtocolConfig()"
              >
                {{ verifyButtonLabel(protocolConfigStatus()) }}
              </button>
              @if (verifyDetail(protocolConfigStatus()); as detail) {
                <span class="text-xs text-text-muted">{{ detail }}</span>
              }
            </div>
          }
        </div>

        <!-- A.4 property registry -->
        <div class="card flex flex-col">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="mono text-[0.65rem] uppercase tracking-[0.2em] text-brand">A.4</div>
              <h3 class="font-display text-2xl mt-1">Property registry</h3>
              <p class="text-xs text-text-muted mt-1">
                Append-only on-chain log of registered property ids.
              </p>
            </div>
            <ng-container [ngTemplateOutlet]="statusBadge" [ngTemplateOutletContext]="{ s: propertyRegistryStatus() }"></ng-container>
          </div>

          @if (!protocol()?.property_registry_launcher_id) {
            <p class="mt-5 text-xs text-text-muted leading-relaxed flex-1">
              Launch the property-registry singleton, then set
              <span class="mono">POPULIS_PROTOCOL_PROPERTY_REGISTRY_LAUNCHER_ID</span>.
            </p>
          } @else {
          <dl class="mt-5 space-y-3 text-sm flex-1">
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Launcher ID
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ protocol()?.property_registry_launcher_id }}
              </dd>
            </div>
            <div>
              <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Mod hash
              </dt>
              <dd class="mono text-xs break-all mt-1">
                {{ protocol()?.property_registry_mod_hash || '—' }}
              </dd>
            </div>
          </dl>
          }

          @if (protocol()?.property_registry_launcher_id) {
            <div class="mt-5 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                class="btn btn--ghost text-xs"
                [disabled]="!chiaWasmReady() || isWalking(propertyRegistryStatus())"
                (click)="verifyPropertyRegistry()"
              >
                {{ verifyButtonLabel(propertyRegistryStatus()) }}
              </button>
              @if (verifyDetail(propertyRegistryStatus()); as detail) {
                <span class="text-xs text-text-muted">{{ detail }}</span>
              }
            </div>
          }
        </div>

        <h2 class="font-display text-xl md:col-span-2 mt-6 -mb-2">
          Per-proposal puzzle
          <span class="mono text-[0.65rem] uppercase tracking-[0.2em] text-text-muted ml-2 align-middle">
            A.1
          </span>
        </h2>
        <!-- A.1 mint proposal mod hash (no per-protocol launcher; per-proposal) -->
        <div class="card md:col-span-2">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="mono text-[0.65rem] uppercase tracking-[0.2em] text-brand">A.1</div>
              <h3 class="font-display text-2xl mt-1">Mint proposal</h3>
              <p class="text-xs text-text-muted mt-1">
                A.1 is a puzzle module rather than a singleton.  Each
                proposal launches its own singleton with its own
                launcher_id, so verification is per-proposal.
              </p>
            </div>
            <span class="state-pill" data-state="DRAFT">module</span>
          </div>

          <div class="mt-5 text-sm">
            <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
              Inner mod hash
            </div>
            <div class="mono text-xs break-all mt-1">
              {{ protocol()?.mint_proposal_mod_hash || '—' }}
            </div>
          </div>
          <p class="text-xs text-text-muted leading-relaxed mt-4">
            Open any
            <a class="text-brand hover:underline" routerLink="/admin">mint proposal detail</a>
            page to walk that proposal's lineage and verify its
            published state.
          </p>
        </div>
      </div>
    </section>

    <ng-template #statusBadge let-s="s">
      @switch (s.kind) {
        @case ('match') {
          <span class="state-pill ok">verified</span>
        }
        @case ('mismatch') {
          <span class="state-pill err">drift</span>
        }
        @case ('walking') {
          <span class="state-pill busy">walking…</span>
        }
        @case ('replaying') {
          <span class="state-pill busy">replaying…</span>
        }
        @case ('no-spends-yet') {
          <span class="state-pill">no spends</span>
        }
        @case ('error') {
          <span class="state-pill err">error</span>
        }
        @case ('not-configured') {
          <span class="state-pill">not deployed</span>
        }
        @default {
          <span class="state-pill">unverified</span>
        }
      }
    </ng-template>
  `,
  styles: [
    `
      .state-pill {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        letter-spacing: 0.18em;
        padding: 0.18rem 0.55rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
      }
      .state-pill.ok {
        color: #04110d;
        background: rgba(124, 255, 178, 0.85);
      }
      .state-pill.busy {
        color: #2ce7ff;
        background: rgba(44, 231, 255, 0.12);
      }
      .state-pill.err {
        color: rgba(255, 120, 120, 0.95);
        background: rgba(255, 120, 120, 0.12);
      }
    `,
  ],
})
export class TrustRootsComponent {
  private readonly http = inject(HttpClient);
  private readonly onChain = inject(OnChainStateService);
  private readonly session = inject(AdminSessionService);
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly wasm = inject(ChiaWasmService);

  readonly authority = signal<AdminAuthorityResponse | null>(null);
  readonly authorityV2 = signal<AdminAuthorityV2Response | null>(null);
  readonly protocol = signal<ProtocolInfo | null>(null);

  readonly adminAuthorityStatus = signal<VerifyStatus>({ kind: 'pending' });
  readonly adminAuthorityV2Status = signal<VerifyStatus>({ kind: 'pending' });
  readonly protocolConfigStatus = signal<VerifyStatus>({ kind: 'pending' });
  readonly propertyRegistryStatus = signal<VerifyStatus>({ kind: 'pending' });

  readonly chiaWasmReady = computed(() => this.wasm.ready());
  readonly primaryAuthority = computed(() =>
    this.authorityV2()?.launcher_id ? this.authorityV2() : this.authority(),
  );
  readonly showLegacyAuthority = computed(
    () => this.authorityV2() !== null && !this.authorityV2()?.launcher_id,
  );

  constructor() {
    void this.loadInitial();
  }

  /**
   * Load each singleton's on-chain state via {@link OnChainStateService}.
   *
   * Post-Hermes-D: there's no API to fail any more — the data is
   * sourced from build-time env constants (launcher_ids, mod_hashes)
   * plus on-chain singleton replays.  The shim swallows per-singleton
   * read failures and surfaces them as null fields, so a single bad
   * coinset response no longer hides the rest of the page.  Card-level
   * status badges still call {@link runVerification} (the old
   * "verify" button) which surfaces walking/replay errors per card.
   */
  private async loadInitial(): Promise<void> {
    const [auth, proto, authV2] = await this.loadPublishedSnapshots();
    this.authority.set(auth);
    this.protocol.set(proto);
    this.authorityV2.set(authV2);

    if (!auth.launcher_id) {
      this.adminAuthorityStatus.set({ kind: 'not-configured' });
    }
    if (!authV2.launcher_id) {
      this.adminAuthorityV2Status.set({ kind: 'not-configured' });
    }
    if (!proto.protocol_config_launcher_id) {
      this.protocolConfigStatus.set({ kind: 'not-configured' });
    }
    if (!proto.property_registry_launcher_id) {
      this.propertyRegistryStatus.set({ kind: 'not-configured' });
    }
  }

  private async loadPublishedSnapshots(): Promise<
    [AdminAuthorityResponse, ProtocolInfo, AdminAuthorityV2Response]
  > {
    try {
      return await Promise.all([
        firstValueFrom(
          this.http.get<AdminAuthorityResponse>(
            `${environment.faucetApi}/admin/auth/authority`,
          ),
        ),
        firstValueFrom(
          this.http.get<ProtocolInfo>(`${environment.faucetApi}/protocol`),
        ),
        firstValueFrom(
          this.http.get<AdminAuthorityV2Response>(
            `${environment.faucetApi}/admin/auth/authority_v2`,
          ),
        ),
      ]);
    } catch {
      return Promise.all([
        this.onChain.getAuthority(),
        this.onChain.getProtocolInfo(),
        this.onChain.getAuthorityV2(),
      ]);
    }
  }

  /**
   * Walk the v1 admin-authority singleton lineage and surface its
   * latest on-chain state hash.  Post-Hermes-D ``state_hash`` may be
   * null on first paint (the OnChainStateService shim returns null
   * when WASM isn't ready yet); the walk re-derives it from chain so
   * the button always works once the launcher is configured.
   */
  async verifyAdminAuthority(): Promise<void> {
    const launcher = this.authority()?.launcher_id;
    if (!launcher) return;
    const claimed = this.authority()?.state_hash ?? null;
    await this.runVerification(launcher, claimed, this.adminAuthorityStatus);
  }

  /**
   * Walk the v2 admin-authority singleton lineage; semantics match
   * {@link verifyAdminAuthority}.
   */
  async verifyAdminAuthorityV2(): Promise<void> {
    const launcher = this.authorityV2()?.launcher_id;
    if (!launcher) return;
    const claimed = this.authorityV2()?.state_hash ?? null;
    await this.runVerification(launcher, claimed, this.adminAuthorityV2Status);
  }

  /**
   * Walk the protocol-config singleton lineage; semantics match
   * {@link verifyAdminAuthority}.
   */
  async verifyProtocolConfig(): Promise<void> {
    const launcher = this.protocol()?.protocol_config_launcher_id;
    if (!launcher) return;
    const claimed = this.protocol()?.protocol_config_hash ?? null;
    await this.runVerification(launcher, claimed, this.protocolConfigStatus);
  }

  async verifyPropertyRegistry(): Promise<void> {
    const launcher = this.protocol()?.property_registry_launcher_id;
    if (!launcher) return;
    // A.4 doesn't expose a state_hash on /protocol — its on-chain
    // CREATE_PUZZLE_ANNOUNCEMENT body is the property_id_canon, not a
    // state hash.  For Phase 3 we just verify lineage exists and
    // record depth; per-property verification lives on a future page.
    await this.runVerification(launcher, null, this.propertyRegistryStatus);
  }

  /**
   * Common verification flow for any singleton:
   *   1. Walk lineage from launcher_id forward.
   *   2. Replay the latest spend in WASM.
   *   3. Read the protocol-prefixed announcement body.
   *   4. Compare against the claimed state hash, if provided.
   */
  private async runVerification(
    launcherId: string,
    claimedStateHash: string | null,
    target: { set: (v: VerifyStatus) => void },
  ): Promise<void> {
    target.set({ kind: 'walking' });
    try {
      const lineage = await this.singleton.walkLineage(launcherId);
      if (!lineage) {
        target.set({
          kind: 'error',
          message: 'Launcher coin not found on chain (not yet confirmed?).',
        });
        return;
      }

      const hasStateSpends = lineage.nodes.some(
        (n) => !n.isLauncher && n.spentBlockIndex !== null,
      );
      if (!hasStateSpends) {
        target.set({ kind: 'no-spends-yet', lineageDepth: lineage.nodes.length });
        return;
      }

      target.set({ kind: 'replaying' });
      const onChain = await this.singleton.readLatestProtocolStateHash(lineage);
      if (!onChain) {
        target.set({
          kind: 'error',
          message: 'Latest spend has no PROTOCOL_PREFIX announcement.',
        });
        return;
      }

      const onChainHex = '0x' + bytesToHex(onChain);
      const latestNode = this.findLatestSpentNode(lineage);

      if (claimedStateHash === null) {
        // No published state_hash to compare — treat the lineage walk
        // alone as success (A.4 case).
        target.set({
          kind: 'match',
          onChainStateHash: onChainHex,
          apiStateHash: '(not published)',
          lineageDepth: lineage.nodes.length,
          latestBlockIndex: latestNode?.spentBlockIndex ?? 0,
        });
        return;
      }

      if (eqHex(onChainHex, claimedStateHash)) {
        target.set({
          kind: 'match',
          onChainStateHash: onChainHex,
          apiStateHash: claimedStateHash,
          lineageDepth: lineage.nodes.length,
          latestBlockIndex: latestNode?.spentBlockIndex ?? 0,
        });
      } else {
        target.set({
          kind: 'mismatch',
          onChainStateHash: onChainHex,
          apiStateHash: claimedStateHash,
        });
      }
    } catch (e) {
      target.set({ kind: 'error', message: formatError(e) });
    }
  }

  private findLatestSpentNode(lineage: SingletonLineage) {
    for (let i = lineage.nodes.length - 1; i >= 0; i--) {
      if (lineage.nodes[i].spentBlockIndex !== null) return lineage.nodes[i];
    }
    return null;
  }

  /** Template helpers. */
  isWalking(s: VerifyStatus): boolean {
    return s.kind === 'walking' || s.kind === 'replaying';
  }

  isHash32(hex: string): boolean {
    const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
    return stripped.length === 64;
  }

  hashLengthLabel(hex: string): string {
    const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
    return `${stripped.length / 2}B`;
  }

  /** Render a one-line summary for the verify-status footer text. */
  verifyDetail(s: VerifyStatus): string | null {
    switch (s.kind) {
      case 'match':
        return `depth ${s.lineageDepth}, last spend at block ${s.latestBlockIndex}`;
      case 'mismatch':
        return 'on-chain hash differs from API';
      case 'no-spends-yet':
        return `launcher confirmed; lineage depth ${s.lineageDepth}`;
      case 'error':
        return s.message;
      default:
        return null;
    }
  }

  /**
   * Verify-button copy.  ``Re-verify`` is only correct after a prior
   * successful walk; otherwise the button hasn't actually verified
   * anything yet.  ``not-configured`` cards render the button disabled
   * with a passive label so the affordance is honest.
   */
  verifyButtonLabel(s: VerifyStatus): string {
    switch (s.kind) {
      case 'match':
      case 'mismatch':
      case 'no-spends-yet':
        return 'Re-verify';
      case 'walking':
      case 'replaying':
        return 'Verifying…';
      case 'not-configured':
        return 'Not deployed';
      case 'error':
        return 'Retry verify';
      default:
        return 'Verify on chain';
    }
  }
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}

function eqHex(a: string, b: string): boolean {
  const na = (a.startsWith('0x') ? a.slice(2) : a).toLowerCase();
  const nb = (b.startsWith('0x') ? b.slice(2) : b).toLowerCase();
  return na === nb;
}
