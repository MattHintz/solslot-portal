import {
  Component,
  computed,
  inject,
  signal,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import {
  AdminAuthorityV2Service,
  AdminRecord,
  bytesToHexPrefixed,
  LaunchOutputs,
} from '../../../services/admin-authority-v2/admin-authority-v2.service';
import {
  AdminBootstrapService,
  BootstrapRecoveryAnchorCreateCoinPreviewResponse,
  BootstrapRecoveryAnchorArtifact,
  BootstrapRecoveryAnchorPublishIntentResponse,
  BootstrapRecoveryAnchorVerifyResponse,
  BootstrapManifestArtifact,
  BootstrapFinalizeResponse,
  BootstrapStatusResponse,
  PortalRuntimeConfigArtifact,
} from '../../../services/admin-bootstrap.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import {
  Eip712LeafHash,
  Eip712LeafHashService,
} from '../../../services/eip712-leaf-hash.service';
import { ChiaWasmService } from '../../../services/chia-wasm.service';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { WalletCoinPickerService } from '../../../services/wallet-coin-picker.service';
import { OnChainStateService } from '../../../services/on-chain-state.service';
import {
  BroadcastRecoveryAnchorResult,
  RecoveryAnchorBroadcastService,
} from '../../../services/recovery-anchor-broadcast.service';
import { environment } from '../../../../environments/environment';

/**
 * Launch Authority v2 admin page (Phase 9-Hermes-D D-2.4).
 *
 * Operator-facing wizard for computing every deterministic output of
 * a v2 admin-authority genesis launch.  All computation happens
 * client-side via the WASM-first ``AdminAuthorityV2Service`` — no
 * Solslot API call is needed.
 *
 * **Why a "preview-only" wizard for now?**
 * Actually submitting the launch bundle on chain requires constructing
 * the operator's funding-coin spend, which depends on:
 *   * Synthetic-key derivation from the connected wallet's master pubkey.
 *   * Standard p2_delegated_puzzle puzzle reveal construction.
 *   * Coin selection from the operator's address on coinset.org.
 * Each of these is its own ~1-day implementation chunk.
 * For D-2.4 we deliver the deterministic computation surface so an
 * operator can:
 *   1. See exactly what their launch parameters will produce.
 *   2. Copy a JSON instructions blob to feed into a Python CLI fallback.
 *   3. Verify the launcher_id + state_hash match what their CLI run
 *      produced, before configuring the API env vars.
 *
 * The "Submit on chain" path lights up in D-2.5 + D-2.6 once the
 * funding-coin construction lands.
 */

/**
 * State machine for the on-chain submit flow.
 *
 *   idle      — user hasn't clicked submit yet (or already-completed
 *               result was cleared).
 *   signing   — waiting for wallet to sign the funding transfer.
 *   pushing   — wallet signed; pushing combined bundle to coinset.
 *   submitted — coinset accepted the bundle; launcher_id is known.
 *   error     — any step failed; user can retry.
 */
type SubmitState =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'pushing' }
  | { kind: 'submitted'; launcherId: string; statusFromCoinset: string | null }
  | { kind: 'error'; message: string };

type LaunchAccessMode = 'permanent-admin' | 'bootstrap' | 'checking' | 'locked' | 'missing';

/**
 * State machine for the bootstrap finalize flow.  Only meaningful when
 * the page was opened under a temporary bootstrap session and the
 * admin-authority launch has already been submitted.
 *
 *   idle      — not yet attempted, or cleared after a previous error.
 *   pending   — request in flight against ``/admin/bootstrap/finalize``.
 *   finalized — API persisted the public artifacts and locked the
 *               bootstrapper; we cache the returned manifest +
 *               runtime config for read-only display.
 *   error     — finalize failed; user can retry.
 */
type FinalizeState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | {
      kind: 'finalized';
      bootstrapManifest: BootstrapManifestArtifact;
      portalRuntimeConfig: PortalRuntimeConfigArtifact;
      bootstrapRecoveryAnchor: BootstrapRecoveryAnchorArtifact;
    }
  | { kind: 'error'; message: string };

type RecoveryVerifyState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'verified'; response: BootstrapRecoveryAnchorVerifyResponse }
  | { kind: 'rejected'; response: BootstrapRecoveryAnchorVerifyResponse }
  | { kind: 'error'; message: string };

type RecoveryChainState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | {
      kind: 'matched';
      launcherId: string;
      expectedStateHash: string;
      chainStateHash: string;
    }
  | {
      kind: 'mismatch';
      launcherId: string | null;
      expectedStateHash: string;
      chainStateHash: string | null;
      message: string;
    }
  | { kind: 'unavailable'; expectedStateHash: string | null; message: string }
  | { kind: 'error'; message: string };

type RecoveryPublishIntentState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ready'; response: BootstrapRecoveryAnchorPublishIntentResponse }
  | { kind: 'error'; message: string };

type RecoveryCreateCoinPreviewState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ready'; response: BootstrapRecoveryAnchorCreateCoinPreviewResponse }
  | { kind: 'error'; message: string };

/**
 * State machine for broadcasting the recovery anchor marker coin
 * on chain (Path A brick R1).
 *
 *   idle       — preview generated but operator hasn't clicked Broadcast.
 *   signing    — waiting on the connected wallet to sign the funding
 *                transfer carrying the two recovery anchor memos.
 *   pushing    — wallet signed; pushing the bundle to coinset.org.
 *   broadcast  — coinset accepted the bundle.  ``result`` records the
 *                marker coin id + funding coin id + push status for
 *                inclusion in the downloadable handoff bundle.
 *   error      — wallet rejected, wallet stripped our memos, or
 *                coinset rejected the bundle.  ``message`` is the
 *                operator-facing reason.
 */
type RecoveryBroadcastState =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'pushing' }
  | { kind: 'broadcast'; result: BroadcastRecoveryAnchorResult }
  | { kind: 'error'; message: string };

type RecoveryHandoffResumeState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'loaded' }
  | { kind: 'error'; message: string };

interface RecoveryHandoffBundle {
  version: 1;
  artifacts: {
    bootstrap_manifest: BootstrapManifestArtifact;
    portal_runtime_config: PortalRuntimeConfigArtifact;
    bootstrap_recovery_anchor: BootstrapRecoveryAnchorArtifact;
    admin_records: Record<string, unknown>;
  };
  verifier: RecoveryVerifyState;
  chain_state: RecoveryChainState;
  recovery_anchor_publish_intent: BootstrapRecoveryAnchorPublishIntentResponse | null;
  recovery_anchor_create_coin_preview: BootstrapRecoveryAnchorCreateCoinPreviewResponse | null;
  /**
   * The on-chain marker coin record produced by Path A brick R1's
   * broadcast button.  ``null`` until the operator broadcasts; only
   * shape we record after a successful push so the bundle can pin
   * the marker coin id + push status without re-deriving from chain.
   */
  recovery_anchor_broadcast: {
    funding_coin_id: string;
    marker_coin_id: string;
    marker_puzzle_hash: string;
    marker_coin_amount_mojos: number;
    payload_hash: string;
    push_status: string | null;
  } | null;
}


@Component({
  selector: 'pp-launch-authority-v2',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-4 py-10 max-w-4xl">
      <header class="mb-8 flex items-center justify-between gap-4">
        <div>
          <div class="mono text-[0.65rem] uppercase tracking-[0.2em] text-brand">
            A.5 / Phase 9-Hermes-D
          </div>
          @if (launchAccessMode() === 'locked') {
            <h1 class="font-display text-4xl md:text-5xl">Genesis already finalized.</h1>
            <p class="mt-2 text-sm text-text-muted max-w-prose">
              The <code>admin_authority_v2</code> bootstrapper is locked. Inspect
              finalized artifacts or sign in with the recorded admin slot 0 wallet.
            </p>
          } @else {
            <h1 class="font-display text-4xl md:text-5xl">Create first-admin authority.</h1>
            <p class="mt-2 text-sm text-text-muted max-w-prose">
              Continue the same genesis ceremony by creating the
              <code>admin_authority_v2</code> singleton and binding the selected
              wallet as permanent admin slot 0.
            </p>
          }
        </div>
        @if (launchAccessMode() === 'permanent-admin') {
          <a routerLink="/admin" class="btn btn--ghost">← Admin desk</a>
        } @else {
          <a routerLink="/admin/genesis" class="btn btn--ghost">← Genesis ceremony</a>
        }
      </header>

      @switch (launchAccessMode()) {
        @case ('bootstrap') {
          <div class="card mb-6 border border-yellow-500/30 bg-yellow-500/10">
            <h2 class="font-display text-2xl">Genesis bootstrap access</h2>
            <p class="text-sm text-text-muted mt-2">
              This first-admin step was opened by a short-lived bootstrap
              session. It is not permanent admin authority and does not open
              the normal Admin Desk.
            </p>
            @if (bootstrapStatus()?.expires_at) {
              <p class="mono text-xs text-text-muted mt-2">
                Bootstrap session expires at {{ bootstrapStatus()?.expires_at }}.
              </p>
            }
          </div>
        }
        @case ('checking') {
          <div class="card mb-6 border border-white/10">
            <p class="text-sm text-text-muted">Checking bootstrap session…</p>
          </div>
        }
        @case ('locked') {
          <div class="card mb-6 border border-red-500/40 bg-red-500/10">
            <h2 class="font-display text-2xl">Bootstrap access unavailable</h2>
            <p class="text-sm text-text-muted mt-2">
              The bootstrapper is locked, so this first-admin bootstrap step
              cannot be run again. Inspect the finalized artifacts or continue
              with permanent admin login using the recorded admin slot 0 wallet.
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <a routerLink="/admin/genesis" class="btn btn--ghost">Inspect finalized artifacts</a>
              <a routerLink="/admin/login" class="btn btn--primary">Permanent admin login</a>
              <a routerLink="/admin" class="btn btn--ghost">Open Admin desk</a>
            </div>
          </div>
          @if (resumedAdminRecords() || !finalizedView()) {
            <div class="card mb-6 border border-brand/30 bg-brand/5">
              <h2 class="font-display text-2xl">Publish recovery marker</h2>
              <p class="text-sm text-text-muted mt-2">
                Load the downloaded <code>recovery_handoff_bundle.json</code>
                to resume the optional marker coin broadcast after bootstrap
                finalization.
              </p>
              <div class="mt-4 grid gap-3">
                <label for="recovery-handoff-bundle-input" class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted cursor-pointer">
                  recovery_handoff_bundle.json
                </label>
                <input
                  type="file"
                  accept="application/json,.json"
                  class="input text-xs"
                  (change)="importRecoveryHandoffBundleFile($event)"
                />
                <textarea
                  id="recovery-handoff-bundle-input"
                  class="input w-full mono text-xs"
                  rows="8"
                  placeholder="{ &quot;version&quot;: 1, &quot;artifacts&quot;: ... }"
                  [ngModel]="recoveryHandoffBundleInput()"
                  (ngModelChange)="recoveryHandoffBundleInput.set($event)"
                ></textarea>
                <button
                  type="button"
                  class="btn btn--primary w-fit"
                  [disabled]="recoveryHandoffResumeState().kind === 'pending' || !recoveryHandoffBundleInput().trim()"
                  (click)="loadRecoveryHandoffBundle()"
                >
                  @if (recoveryHandoffResumeState().kind === 'pending') {
                    Verifying…
                  } @else {
                    Load handoff bundle
                  }
                </button>
                @if (recoveryHandoffResumeState().kind === 'loaded') {
                  <p class="text-xs text-emerald-300">
                    Loaded recovery handoff bundle.
                  </p>
                }
                @if (recoveryHandoffResumeError(); as err) {
                  <p class="mono text-[0.65rem] text-red-300">
                    <strong>Handoff load failed.</strong> {{ err }}
                  </p>
                }
              </div>

              @if (finalizedView()) {
                <div class="mt-5 grid gap-3">
                  <div class="rounded border border-white/10 bg-white/[0.03] p-3">
                    <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                      Recovery verifier
                    </div>
                    @switch (recoveryVerifyState().kind) {
                      @case ('pending') {
                        <p class="text-xs text-text-muted mt-1">
                          Verifying recovered public artifacts against the
                          recovery anchor hash chain…
                        </p>
                      }
                      @case ('verified') {
                        @if (recoveryVerifySuccess(); as v) {
                          <p class="text-xs text-emerald-300 mt-1">
                            Verified. The recovery anchor, manifest, runtime
                            config, admin records, and authority coordinates
                            agree.
                          </p>
                          <p class="mono text-[0.6rem] text-text-muted mt-2 break-all">
                            launcher_id={{ v.admin_authority_v2_launcher_id }}
                            · admin_records_hash={{ v.admin_records_hash }}
                          </p>
                        }
                      }
                      @case ('rejected') {
                        @if (recoveryVerifyFailure(); as err) {
                          <p class="text-xs text-red-300 mt-1">
                            Verification rejected these public artifacts:
                            {{ err }}
                          </p>
                        }
                      }
                      @case ('error') {
                        @if (recoveryVerifyFailure(); as err) {
                          <p class="text-xs text-yellow-300 mt-1">
                            Verification request failed: {{ err }}
                          </p>
                        }
                      }
                    }
                  </div>

                  <div class="rounded border border-white/10 bg-white/[0.03] p-3">
                    <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                      Chia funding wallet
                    </div>
                    @if (!walletConnected()) {
                      <div class="mt-2 flex flex-wrap gap-2">
                        @if (chiaWallet.hasGoby()) {
                          <button
                            type="button"
                            class="btn btn--ghost text-[0.65rem] py-1 px-3"
                            [disabled]="connectingChia()"
                            (click)="connectChia('goby')"
                          >
                            @if (connectingChia() === 'goby') {
                              Connecting…
                            } @else {
                              Connect Goby
                            }
                          </button>
                        }
                        @if (chiaWallet.hasSage()) {
                          <button
                            type="button"
                            class="btn btn--ghost text-[0.65rem] py-1 px-3"
                            [disabled]="connectingChia()"
                            (click)="connectChia('sage')"
                          >
                            @if (connectingChia() === 'sage') {
                              Connecting…
                            } @else {
                              Connect Sage
                            }
                          </button>
                        }
                        @if (chiaWallet.hasSageWalletConnect()) {
                          <button
                            type="button"
                            class="btn btn--ghost text-[0.65rem] py-1 px-3"
                            [disabled]="connectingChia()"
                            (click)="connectChia('sage-walletconnect')"
                          >
                            @if (connectingChia() === 'sage-walletconnect') {
                              Connecting…
                            } @else {
                              Sage WalletConnect
                            }
                          </button>
                        }
                        @if (connectingChia() && (connectingChia() !== 'sage-walletconnect' || chiaWallet.sageWalletConnectUri())) {
                          <button
                            type="button"
                            class="btn btn--ghost text-[0.65rem] py-1 px-3"
                            (click)="cancelChiaConnect()"
                          >
                            Cancel
                          </button>
                        }
                      </div>
                      @if (chiaWallet.restoringSageWalletConnect()) {
                        <p class="mono text-[0.6rem] text-text-muted mt-2">
                          Checking existing Sage session...
                        </p>
                      }
                      @if (connectingChia() === 'sage-walletconnect' && chiaWallet.sageWalletConnectUri(); as uri) {
                        <div class="mt-3 rounded-card border border-brand/30 bg-brand/10 p-2">
                          <p class="text-[0.7rem] text-text-muted">
                            Open Sage WalletConnect and paste this pairing URI
                            if the wallet does not open automatically:
                          </p>
                          <code class="mt-1 block break-all text-[0.6rem]">{{ uri }}</code>
                        </div>
                      }
                      @if (chiaConnectError(); as err) {
                        <p class="mono text-[0.6rem] text-red-300 mt-2">
                          <strong>Connect failed.</strong> {{ err }}
                        </p>
                      }
                    } @else {
                      <p class="text-xs text-emerald-300 mt-1">
                        ✓ Connected ({{ chiaWallet.connectionKind() }}).
                        <code class="break-all">{{ chiaWallet.pubkey() }}</code>
                      </p>
                    }
                  </div>

                  <div class="rounded border border-white/10 bg-white/[0.03] p-3">
                    <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                      Recovery anchor handoff
                    </div>
                    @switch (recoveryPublishIntentState().kind) {
                      @case ('pending') {
                        <p class="text-xs text-text-muted mt-1">
                          Fetching marker-coin memo payload…
                        </p>
                      }
                      @case ('ready') {
                        @if (recoveryPublishIntent(); as intent) {
                          <p class="text-xs text-emerald-300 mt-1">
                            Publish intent ready.
                          </p>
                          <p class="mono text-[0.6rem] text-text-muted mt-2 break-all">
                            amount={{ intent.marker_coin_amount_mojos }} mojo
                            · payload_hash={{ intent.payload_hash }}
                          </p>
                          <label for="locked-recovery-marker-puzzle-hash-input" class="mt-3 block mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted cursor-pointer">
                            Marker puzzle hash
                          </label>
                          <input
                            id="locked-recovery-marker-puzzle-hash-input"
                            type="text"
                            class="input mt-1 w-full mono text-xs"
                            placeholder="0x… (32 bytes)"
                            [(ngModel)]="recoveryMarkerPuzzleHashInput"
                          />
                          <button
                            type="button"
                            class="btn btn--ghost mt-2 text-[0.65rem] py-1 px-3"
                            [disabled]="!canPreviewRecoveryMarkerCoin()"
                            (click)="previewRecoveryAnchorMarkerCoin()"
                          >
                            @if (recoveryCreateCoinPreviewState().kind === 'pending') {
                              Previewing…
                            } @else {
                              Preview CREATE_COIN
                            }
                          </button>
                        }
                      }
                      @case ('error') {
                        @if (recoveryPublishIntentError(); as err) {
                          <p class="text-xs text-yellow-300 mt-1">
                            Publish intent unavailable: {{ err }}
                          </p>
                        }
                      }
                    }
                    @switch (recoveryCreateCoinPreviewState().kind) {
                      @case ('ready') {
                        @if (recoveryCreateCoinPreview(); as p) {
                          <div class="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 p-2">
                            <p class="text-xs text-emerald-300">
                              CREATE_COIN preview ready.
                            </p>
                            <p class="mono text-[0.6rem] text-text-muted mt-2 break-all">
                              opcode={{ p.condition_opcode }}
                              · amount={{ p.marker_coin_amount_mojos }} mojo
                              · payload_hash={{ p.payload_hash }}
                            </p>
                            <p class="mono text-[0.6rem] text-text-muted mt-2 break-all">
                              marker_puzzle_hash={{ p.marker_puzzle_hash }}
                            </p>
                          </div>
                        }
                      }
                      @case ('error') {
                        @if (recoveryCreateCoinPreviewError(); as err) {
                          <p class="text-xs text-yellow-300 mt-2">
                            CREATE_COIN preview unavailable: {{ err }}
                          </p>
                        }
                      }
                    }
                    @if (recoveryCreateCoinPreviewState().kind === 'ready') {
                      <button
                        type="button"
                        class="btn btn--primary mt-3 text-[0.65rem] py-1 px-3"
                        [disabled]="!canBroadcastRecoveryMarkerCoin()"
                        (click)="broadcastRecoveryAnchorMarkerCoin()"
                      >
                        @switch (recoveryBroadcastState().kind) {
                          @case ('signing') { Signing… }
                          @case ('pushing') { Pushing… }
                          @default { Broadcast on chain }
                        }
                      </button>
                    }
                    @if (recoveryBroadcastResult(); as r) {
                      <p class="text-xs text-emerald-300 mt-2">
                        Broadcast accepted by coinset.org
                        (status: {{ r.pushStatus ?? 'pending' }}).
                      </p>
                      <p class="mono text-[0.6rem] text-text-muted mt-1 break-all">
                        marker_coin_id={{ r.markerCoinId }}
                      </p>
                    }
                    @if (recoveryBroadcastError(); as err) {
                      <p class="text-xs text-yellow-300 mt-2">
                        Broadcast failed: {{ err }}
                      </p>
                    }
                  </div>
                </div>
              }
            </div>
          }
        }
        @case ('missing') {
          <div class="card mb-6 border border-yellow-500/30 bg-yellow-500/10">
            <h2 class="font-display text-2xl">Bootstrap session unavailable</h2>
            <p class="text-sm text-text-muted mt-2">
              Return to genesis to start or refresh the bootstrap session before
              continuing the first-admin step of the genesis ceremony.
            </p>
          </div>
        }
      }

      @if (launchAccessMode() !== 'locked' || (finalizedView() && !resumedAdminRecords())) {
      @if (!chiaWasmReady()) {
        <div class="card border border-yellow-500/40 bg-yellow-500/10">
          <p class="text-sm">
            <strong>Waiting for WASM SDK</strong> — the Chia wallet SDK WASM
            module hasn't finished loading.  Reload if this persists for
            more than a few seconds.
          </p>
        </div>
      } @else {
        <div class="card">
          <h2 class="font-display text-2xl">Inputs</h2>
          <p class="text-xs text-text-muted mt-1">
            All fields accept 0x-prefixed or bare hex.  Validation
            happens on every keystroke; results below update live.
          </p>

          @if (!walletConnected()) {
            <div class="mt-4 rounded-card border border-yellow-500/40 bg-yellow-500/10 p-3">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="text-xs">
                  <strong>No Chia wallet connected.</strong>
                  Connect Goby or Sage to enable
                  <em>Fetch from wallet</em> and on-chain submission.
                  ({{ chiaWallet.hasGoby() ? 'Goby detected' : 'Goby missing' }} ·
                  {{ chiaWallet.hasSage() ? 'Sage detected' : 'Sage missing' }})
                </div>
                <div class="flex gap-2">
                  @if (chiaWallet.hasGoby()) {
                    <button
                      type="button"
                      class="btn btn--ghost text-[0.65rem] py-1 px-3"
                      [disabled]="connectingChia()"
                      (click)="connectChia('goby')"
                    >
                      @if (connectingChia() === 'goby') {
                        Connecting…
                      } @else {
                        Connect Goby
                      }
                    </button>
                  }
                  @if (chiaWallet.hasSage()) {
                    <button
                      type="button"
                      class="btn btn--ghost text-[0.65rem] py-1 px-3"
                      [disabled]="connectingChia()"
                      (click)="connectChia('sage')"
                    >
                      @if (connectingChia() === 'sage') {
                        Connecting…
                      } @else {
                        Connect Sage
                      }
                    </button>
                  }
                  @if (chiaWallet.hasSageWalletConnect()) {
                    <button
                      type="button"
                      class="btn btn--ghost text-[0.65rem] py-1 px-3"
                      [disabled]="connectingChia()"
                      (click)="connectChia('sage-walletconnect')"
                    >
                      @if (connectingChia() === 'sage-walletconnect') {
                        Connecting…
                      } @else {
                        Sage WalletConnect
                      }
                    </button>
                  }
                  @if (connectingChia() && (connectingChia() !== 'sage-walletconnect' || chiaWallet.sageWalletConnectUri())) {
                    <button
                      type="button"
                      class="btn btn--ghost text-[0.65rem] py-1 px-3"
                      (click)="cancelChiaConnect()"
                    >
                      Cancel
                    </button>
                  }
                </div>
              </div>
              @if (chiaWallet.restoringSageWalletConnect()) {
                <p class="mono text-[0.6rem] text-text-muted mt-2">
                  Checking existing Sage session...
                </p>
              }
              @if (connectingChia() === 'sage-walletconnect' && chiaWallet.sageWalletConnectUri(); as uri) {
                <div class="mt-3 rounded-card border border-brand/30 bg-brand/10 p-2">
                  <p class="text-[0.7rem] text-text-muted">
                    Open Sage WalletConnect and paste this pairing URI if the
                    wallet does not open automatically:
                  </p>
                  <code class="mt-1 block break-all text-[0.6rem]">{{ uri }}</code>
                </div>
              }
              @if (chiaConnectError(); as err) {
                <p class="mono text-[0.6rem] text-red-300 mt-2">
                  <strong>Connect failed.</strong> {{ err }}
                </p>
              }
            </div>
          } @else {
            <div class="mt-4 rounded-card border border-emerald-500/30 bg-emerald-500/5 p-2 text-[0.7rem]">
              <span class="text-emerald-400">✓ Chia funding wallet connected</span>
              ({{ chiaWallet.connectionKind() }}).
              Pubkey:
              <code class="break-all">{{ chiaWallet.pubkey() }}</code>
            </div>
          }

          <div class="mt-6 grid gap-4">
            <div class="block">
              <div class="flex items-baseline justify-between gap-2 flex-wrap">
                <label for="funding-coin-id-input" class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted cursor-pointer">
                  Funding coin id (the coin you're spending to create the launcher)
                </label>
                <button
                  type="button"
                  class="btn btn--ghost text-[0.6rem] py-1 px-2 relative z-10"
                  [disabled]="fetchingFundingCoinId() || !walletConnected() || !chiaWasmReady()"
                  (click)="fetchFundingCoinIdFromWallet()"
                  title="Ask your connected Chia wallet (Goby/Sage) for its receive address, query coinset.org for unspent coins under that address, and auto-fill this field with the largest one. Used only for the deterministic preview — at submit time the wallet picks its own coin."
                >
                  @if (fetchingFundingCoinId()) {
                    Fetching…
                  } @else {
                    Fetch from wallet
                  }
                </button>
              </div>
              <input
                id="funding-coin-id-input"
                type="text"
                class="input mt-1 w-full mono text-xs"
                placeholder="0x… (32 bytes)"
                [(ngModel)]="parentCoinIdInput"
              />
              @if (fundingCoinPick(); as p) {
                <p class="mono text-[0.6rem] text-emerald-400 mt-1 break-all">
                  ✓ Picked from
                  <code>{{ p.address }}</code>
                  (<code>{{ p.amountTxch }}</code> TXCH)
                </p>
              }
              @if (fundingCoinError(); as err) {
                <p class="mono text-[0.6rem] text-red-300 mt-1">
                  <strong>Wallet pick failed.</strong> {{ err }}
                </p>
              }
            </div>

            <div class="block">
              <div class="flex items-baseline justify-between gap-2 flex-wrap">
                <label for="mips-root-hash-input" class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted cursor-pointer">
                  MIPS root hash (sha256tree of the m_of_n quorum tree)
                </label>
                <button
                  type="button"
                  class="btn btn--ghost text-[0.6rem] py-1 px-2 relative z-10"
                  [disabled]="!chiaWasmReady()"
                  (click)="useFirstAdminAsController()"
                  title="Compute MIPS root for a real CHIP-0043 1-of-1 quorum where the recovered first admin is the sole controller. Uses mOfNHash(config, 1, [eip712MemberHash(...)]) entirely in-browser via WASM — no API call."
                >
                  Use my admin as 1-of-1 controller
                </button>
              </div>
              <input
                id="mips-root-hash-input"
                type="text"
                class="input mt-1 w-full mono text-xs"
                placeholder="0x… (32 bytes)"
                [(ngModel)]="mipsRootHashInput"
              />
              <p class="text-[0.6rem] text-text-muted mt-1">
                Computed off-chain via chia-wallet-sdk's
                <code>mOfNHash(config, m, [eip712MemberHash(...), ...])</code>.
                For a 1-of-1 controller (single admin signs both rotation
                and ops), click the button above after recovering your
                first admin — we'll fill this in via WASM.  For richer
                quorums (multiple controllers, BLS / passkey mixes,
                restrictions), compose the tree off-chain with the
                <code>chia-wallet-sdk</code> CLI / npm SDK.
              </p>
              @if (evmAdminConnected() && !firstAdminLeaf()) {
                <p class="mono text-[0.6rem] text-yellow-300 mt-1">
                  Recover the first-admin leaf before computing the 1-of-1
                  MIPS root. EVM connection alone only proves the wallet
                  address is paired.
                </p>
              }
              @if (mipsRootShape(); as shape) {
                <p class="mono text-[0.6rem] text-emerald-400 mt-1">
                  ✓ Computed via WASM (shape:
                  <code>{{ shape }}</code>)
                </p>
              }
              @if (mipsRootError(); as err) {
                <p class="mono text-[0.6rem] text-red-300 mt-1">
                  <strong>MIPS root compute failed.</strong> {{ err }}
                </p>
              }
            </div>

            <div class="block">
              <div class="flex items-baseline justify-between gap-2 flex-wrap">
                <label for="admin-records-textarea" class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted cursor-pointer">
                  Admin records (one per line)
                </label>
                <button
                  type="button"
                  class="btn btn--ghost text-[0.6rem] py-1 px-2 relative z-10"
                  [disabled]="recoveringFirstAdmin() || !evmAdminConnected()"
                  (click)="recoverFirstAdminFromWallet()"
                  title="Sign a probe with your connected EVM wallet, recover its pubkey, compute the canonical leaf hash, and pre-fill the textarea below as a single-admin (m_within=1) record."
                >
                  @if (recoveringFirstAdmin()) {
                    Recovering…
                  } @else {
                    Use connected EVM wallet as first admin
                  }
                </button>
                @if (recoveringFirstAdmin()) {
                  <button
                    type="button"
                    class="btn btn--ghost text-[0.6rem] py-1 px-2 relative z-10"
                    (click)="cancelFirstAdminRecovery()"
                  >
                    Cancel
                  </button>
                }
              </div>
              <textarea
                id="admin-records-textarea"
                class="input mt-1 w-full mono text-xs"
                rows="4"
                placeholder="admin_idx leaf_hash m_within (space-separated, e.g. '0 0xab... 1')"
                [(ngModel)]="adminRecordsInput"
              ></textarea>
              <p class="text-[0.6rem] text-text-muted mt-1">
                Each line: <code>admin_idx</code> <code>leaf_hash</code>
                <code>m_within</code>.  For an admin with multiple leaves,
                separate them with commas inside the leaf field, e.g.
                <code>0 0xa1...,0xa2... 2</code>.
              </p>
              @if (!evmAdminConnected()) {
                <div class="mt-2 rounded-card border border-yellow-500/40 bg-yellow-500/10 p-3">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="text-xs">
                      <strong>No EVM admin wallet connected.</strong>
                      Your Chia/Goby wallet funds the on-chain launcher; the
                      first admin uses an EVM signature to recover the
                      secp256k1 pubkey for admin slot 0.
                    </div>
                    <div class="flex flex-wrap gap-2">
                      @if (hasInjectedEvmWallet()) {
                        <button
                          type="button"
                          class="btn btn--ghost text-[0.65rem] py-1 px-3"
                          [disabled]="connectingEvm()"
                          (click)="connectEvmAdminWallet('injected')"
                        >
                          @if (connectingEvm() === 'injected') {
                            Connecting…
                          } @else {
                            Connect browser EVM
                          }
                        </button>
                      }
                      <button
                        type="button"
                        class="btn btn--ghost text-[0.65rem] py-1 px-3"
                        [disabled]="connectingEvm()"
                        (click)="connectEvmAdminWallet('walletconnect')"
                      >
                        @if (connectingEvm() === 'walletconnect') {
                          Connecting…
                        } @else {
                          WalletConnect
                        }
                      </button>
                    </div>
                  </div>
                  @if (evmConnectError(); as err) {
                    <p class="mono text-[0.6rem] text-red-300 mt-2">
                      <strong>EVM connect failed.</strong> {{ err }}
                    </p>
                  }
                </div>
              } @else {
                <div class="mt-2 rounded-card border border-emerald-500/30 bg-emerald-500/5 p-2 text-[0.7rem]">
                  <span class="text-emerald-400">✓ EVM admin wallet connected</span>
                  ({{ evmAdminConnectionKind() }}).
                  Address:
                  <code class="break-all">{{ evmAdminAddress() }}</code>
                </div>
              }
              @if (recoveringFirstAdmin()) {
                <p class="mono text-[0.6rem] text-yellow-300 mt-2">
                  Waiting for wallet signature. Tangem recovery tries
                  <code>eth_sign</code> first and falls back if no response is
                  returned.
                </p>
              }
              @if (firstAdminLeaf(); as leaf) {
                <div class="mt-2 rounded-card border border-green-500/30 bg-green-500/5 p-2">
                  <div class="mono text-[0.6rem] uppercase tracking-[0.18em] text-green-400">
                    ✓ First admin recovered
                  </div>
                  <dl class="mt-1 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5 text-[0.65rem]">
                    <dt class="text-text-muted">Admin slot:</dt>
                    <dd class="mono">0</dd>
                    <dt class="text-text-muted">m_within:</dt>
                    <dd class="mono">1</dd>
                    <dt class="text-text-muted">EVM:</dt>
                    <dd class="mono break-all">{{ firstAdminAddress() }}</dd>
                    <dt class="text-text-muted">Pubkey:</dt>
                    <dd class="mono break-all">{{ leaf.secp256k1_pubkey }}</dd>
                    <dt class="text-text-muted">Leaf hash:</dt>
                    <dd class="mono break-all">{{ leaf.leaf_hash }}</dd>
                    <dt class="text-text-muted">Type hash:</dt>
                    <dd class="mono break-all">{{ leaf.type_hash }}</dd>
                    <dt class="text-text-muted">Network/domain:</dt>
                    <dd class="mono break-all">
                      {{ leaf.network }} · {{ leaf.prefix_and_domain_separator }}
                    </dd>
                    @if (mipsRootHashInput()) {
                      <dt class="text-text-muted">MIPS root:</dt>
                      <dd class="mono break-all">{{ mipsRootHashInput() }}</dd>
                    }
                  </dl>
                  <p class="text-[0.6rem] text-text-muted mt-2">
                    Wallet signature is proof-of-possession only; it is not
                    stored or included in admin_records.json.
                  </p>
                </div>
              }
              @if (firstAdminError(); as err) {
                <div class="mt-2 rounded-card border border-red-500/40 bg-red-500/10 p-2 text-[0.65rem] text-red-300">
                  <strong>Recovery failed.</strong> {{ err }}
                </div>
              }
            </div>

            <div class="grid grid-cols-2 gap-4">
              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  Authority version
                </div>
                <input
                  type="number"
                  class="input mt-1 w-full mono text-xs"
                  [(ngModel)]="authorityVersionInput"
                  min="1"
                />
              </label>

              <label class="block">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  Eve amount (mojos)
                </div>
                <input
                  type="number"
                  class="input mt-1 w-full mono text-xs"
                  [(ngModel)]="eveAmountInput"
                  min="1"
                />
              </label>
            </div>
          </div>
        </div>

        @if (validationError()) {
          <div class="card mt-6 border border-red-500/40 bg-red-500/10">
            <h3 class="font-display text-xl">Input error</h3>
            <p class="mt-1 text-sm break-words">{{ validationError() }}</p>
          </div>
        }

        @if (computedPreview(); as p) {
          <div class="card mt-6">
            <h2 class="font-display text-2xl">Preview</h2>
            <p class="text-xs text-text-muted mt-1">
              Every value below is a pure function of the inputs above.
              Submit these EXACT values via your CLI tool — any drift in
              the on-chain bundle will produce a different launcher_id /
              state_hash and the API will refuse to attest to it.
            </p>

            <dl class="mt-5 space-y-3 text-sm">
              <div>
                <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  Launcher id (singleton's permanent identifier)
                </dt>
                <dd class="mono text-xs break-all mt-1">{{ p.launcherId }}</dd>
              </div>
              <div>
                <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  Eve inner puzzle hash
                </dt>
                <dd class="mono text-xs break-all mt-1">{{ p.eveInnerPuzzleHash }}</dd>
              </div>
              <div>
                <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  Eve full puzzle hash (singleton-wrapped)
                </dt>
                <dd class="mono text-xs break-all mt-1">{{ p.eveFullPuzzleHash }}</dd>
              </div>
              <div>
                <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  State hash (CREATE_PUZZLE_ANNOUNCEMENT body)
                </dt>
                <dd class="mono text-xs break-all mt-1">{{ stateHash() }}</dd>
              </div>
              <div>
                <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  Launcher announcement id
                </dt>
                <dd class="mono text-xs break-all mt-1">
                  {{ p.launcherAnnouncementId }}
                </dd>
              </div>
            </dl>

            <div class="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" class="btn btn--ghost" (click)="copyJson()">
                Copy launch instructions (JSON)
              </button>
              <button
                type="button"
                class="btn btn--primary"
                [disabled]="!walletConnected() || submitState().kind === 'signing' || submitState().kind === 'pushing'"
                (click)="submitOnChain()"
              >
                @switch (submitState().kind) {
                  @case ('signing') { Waiting for wallet… }
                  @case ('pushing') { Pushing to coinset… }
                  @case ('submitted') { Re-submit }
                  @default { Submit on chain }
                }
              </button>
              @if (!walletConnected()) {
                <span class="text-xs text-text-muted">
                  Connect Goby/Sage before submitting.
                </span>
              }
              @if (copyConfirmation(); as msg) {
                <span class="text-xs text-text-muted">{{ msg }}</span>
              }
            </div>

            @switch (submitState().kind) {
              @case ('submitted') {
                @if (submittedView(); as s) {
                  <div class="card mt-4 border border-green-500/40 bg-green-500/10">
                    <h3 class="font-display text-xl">✓ Launch submitted</h3>
                    <p class="text-xs text-text-muted mt-1">
                      coinset.org accepted the spend bundle.  Confirmation
                      typically takes 1–2 blocks (~30s on mainnet).  Poll
                      <code>/get_coin_record_by_name</code> on the launcher
                      id to monitor.
                    </p>
                    <dl class="mt-3 space-y-2 text-sm">
                      <div>
                        <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                          Launcher id (= singleton's identity)
                        </dt>
                        <dd class="mono text-xs break-all mt-1">{{ s.launcherId }}</dd>
                      </div>
                      <div>
                        <dt class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                          coinset status
                        </dt>
                        <dd class="mono text-xs mt-1">{{ s.statusFromCoinset || '—' }}</dd>
                      </div>
                    </dl>
                    <p class="mt-3 text-xs text-text-muted">
                      Configure
                      <code>SOLSLOT_PROTOCOL_ADMIN_AUTHORITY_V2_LAUNCHER_ID</code>
                      = <span class="mono">{{ s.launcherId }}</span> in your
                      Solslot API env to surface this singleton on
                      <code>/admin/auth/authority_v2</code>.
                    </p>

                    @if (firstAdminLeaf()) {
                      <div class="mt-4 pt-3 border-t border-green-500/20">
                        <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                          Phase 2.5b: download admin records
                        </div>
                        <p class="text-xs text-text-muted mt-1">
                          The API needs an expanded form of these admin
                          records (with EVM addresses + curry args, not
                          just leaf hashes) to gate the admin desk via
                          the on-chain singleton instead of
                          <code>SOLSLOT_ADMIN_PUBKEY_ALLOWLIST</code>.
                          Download the file below and set
                          <code>SOLSLOT_ADMIN_RECORDS_PATH</code> in your
                          API env.
                        </p>
                        <button
                          type="button"
                          class="btn btn--primary mt-2"
                          (click)="downloadAdminRecordsJson()"
                        >
                          Download admin_records.json
                        </button>
                      </div>
                    }

                    @if ((launchAccessMode() === 'bootstrap' || finalizedView()) && firstAdminLeaf()) {
                      <div class="mt-4 pt-3 border-t border-yellow-500/20">
                        <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-yellow-400">
                          Finish genesis · public artifacts
                        </div>
                        <p class="text-xs text-text-muted mt-1">
                          Submit the public commitments above to finish the
                          genesis ceremony. The API will atomically persist
                          <code>admin_records.json</code>,
                          <code>portal_runtime_config.json</code>,
                          <code>bootstrap_recovery_anchor.json</code> and
                          <code>bootstrap_manifest.json</code> and lock the
                          bootstrapper. No raw signatures, session cookies, or
                          one-shot tokens are sent.
                        </p>
                        <button
                          type="button"
                          class="btn btn--primary mt-2"
                          [disabled]="!canFinalizeBootstrap() || finalizeState().kind === 'pending' || finalizeState().kind === 'finalized'"
                          (click)="finalizeBootstrapArtifacts()"
                        >
                          @switch (finalizeState().kind) {
                            @case ('pending') { Finalizing… }
                            @case ('finalized') { Genesis finalized · bootstrapper locked }
                            @default { Finalize genesis artifacts }
                          }
                        </button>
                        @if (finalizeError(); as err) {
                          <p class="mono text-[0.65rem] text-red-300 mt-2">
                            <strong>Finalize failed.</strong> {{ err }}
                          </p>
                        }
                        @if (finalizedView(); as f) {
                          <div class="mt-3 grid gap-3">
                            <div class="rounded border border-white/10 bg-white/[0.03] p-3">
                              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                                Recovery verifier
                              </div>
                              @switch (recoveryVerifyState().kind) {
                                @case ('pending') {
                                  <p class="text-xs text-text-muted mt-1">
                                    Verifying returned public artifacts against
                                    the recovery anchor hash chain…
                                  </p>
                                }
                                @case ('verified') {
                                  @if (recoveryVerifySuccess(); as v) {
                                    <p class="text-xs text-emerald-300 mt-1">
                                      Verified. The recovery anchor, manifest,
                                      runtime config, admin records, and
                                      authority coordinates agree.
                                    </p>
                                    <p class="mono text-[0.6rem] text-text-muted mt-2 break-all">
                                      launcher_id={{ v.admin_authority_v2_launcher_id }}
                                      · admins_hash={{ v.admins_hash }}
                                      · admin_records_hash={{ v.admin_records_hash }}
                                    </p>
                                  }
                                }
                                @case ('rejected') {
                                  @if (recoveryVerifyFailure(); as err) {
                                    <p class="text-xs text-red-300 mt-1">
                                      Verification rejected these public artifacts:
                                      {{ err }}
                                    </p>
                                  }
                                }
                                @case ('error') {
                                  @if (recoveryVerifyFailure(); as err) {
                                    <p class="text-xs text-yellow-300 mt-1">
                                      Verification request failed: {{ err }}
                                    </p>
                                  }
                                }
                                @default {
                                  <p class="text-xs text-text-muted mt-1">
                                    Waiting for finalized artifacts before
                                    checking the recovery verifier.
                                  </p>
                                }
                              }
                              @switch (recoveryChainState().kind) {
                                @case ('pending') {
                                  <p class="text-xs text-text-muted mt-2">
                                    Checking recovered authority state hash
                                    against live chain state…
                                  </p>
                                }
                                @case ('matched') {
                                  @if (recoveryChainMatched(); as c) {
                                    <p class="text-xs text-emerald-300 mt-2">
                                      Chain state matched. The recovered
                                      authority state hash equals the live
                                      admin_authority_v2 state hash.
                                    </p>
                                    <p class="mono text-[0.6rem] text-text-muted mt-2 break-all">
                                      launcher_id={{ c.launcherId }}
                                      · state_hash={{ c.chainStateHash }}
                                    </p>
                                  }
                                }
                                @case ('mismatch') {
                                  @if (recoveryChainWarning(); as msg) {
                                    <p class="text-xs text-red-300 mt-2">
                                      {{ msg }}
                                    </p>
                                  }
                                }
                                @case ('unavailable') {
                                  @if (recoveryChainWarning(); as msg) {
                                    <p class="text-xs text-yellow-300 mt-2">
                                      {{ msg }}
                                    </p>
                                  }
                                }
                                @case ('error') {
                                  @if (recoveryChainWarning(); as msg) {
                                    <p class="text-xs text-yellow-300 mt-2">
                                      Chain-state check failed: {{ msg }}
                                    </p>
                                  }
                                }
                              }
                              <p class="text-[0.65rem] text-text-muted mt-2">
                                This check grants no admin access and does not
                                sign, broadcast, mint, or persist anything.
                              </p>
                            </div>
                            <div class="rounded border border-white/10 bg-white/[0.03] p-3">
                              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                                Recovery anchor handoff
                              </div>
                              @switch (recoveryPublishIntentState().kind) {
                                @case ('pending') {
                                  <p class="text-xs text-text-muted mt-1">
                                    Fetching marker-coin memo payload for
                                    recovery-anchor publication…
                                  </p>
                                }
                                @case ('ready') {
                                  @if (recoveryPublishIntent(); as intent) {
                                    <p class="text-xs text-emerald-300 mt-1">
                                      Publish intent ready. Use these memos if
                                      you later create the optional recovery
                                      marker coin.
                                    </p>
                                    <p class="mono text-[0.6rem] text-text-muted mt-2 break-all">
                                      amount={{ intent.marker_coin_amount_mojos }} mojo
                                      · payload_hash={{ intent.payload_hash }}
                                    </p>
                                    <details class="mt-2">
                                      <summary class="text-xs text-text-muted cursor-pointer">
                                        marker coin memos
                                      </summary>
                                      <pre class="mt-2 mono text-[0.6rem] bg-black/30 p-3 rounded overflow-x-auto">{{ intent.memos_hex.join('\n') }}</pre>
                                    </details>
                                    <details class="mt-2">
                                      <summary class="text-xs text-text-muted cursor-pointer">
                                        payload memo JSON
                                      </summary>
                                      <pre class="mt-2 mono text-[0.6rem] bg-black/30 p-3 rounded overflow-x-auto">{{ recoveryPublishIntentPayloadJson() }}</pre>
                                    </details>
                                    <div class="mt-3">
                                      <label for="recovery-marker-puzzle-hash-input" class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted cursor-pointer">
                                        Marker puzzle hash
                                      </label>
                                      <input
                                        id="recovery-marker-puzzle-hash-input"
                                        type="text"
                                        class="input mt-1 w-full mono text-xs"
                                        placeholder="0x… (32 bytes)"
                                        [(ngModel)]="recoveryMarkerPuzzleHashInput"
                                      />
                                      <button
                                        type="button"
                                        class="btn btn--ghost mt-2 text-[0.65rem] py-1 px-3"
                                        [disabled]="!canPreviewRecoveryMarkerCoin()"
                                        (click)="previewRecoveryAnchorMarkerCoin()"
                                      >
                                        @if (recoveryCreateCoinPreviewState().kind === 'pending') {
                                          Previewing…
                                        } @else {
                                          Preview CREATE_COIN
                                        }
                                      </button>
                                    </div>
                                  }
                                }
                                @case ('error') {
                                  @if (recoveryPublishIntentError(); as err) {
                                    <p class="text-xs text-yellow-300 mt-1">
                                      Publish intent unavailable: {{ err }}
                                    </p>
                                  }
                                }
                                @default {
                                  <p class="text-xs text-text-muted mt-1">
                                    Waiting for finalized artifacts before
                                    fetching recovery-anchor publication memos.
                                  </p>
                                }
                              }
                              @switch (recoveryCreateCoinPreviewState().kind) {
                                @case ('ready') {
                                  @if (recoveryCreateCoinPreview(); as p) {
                                    <div class="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 p-2">
                                      <p class="text-xs text-emerald-300">
                                        CREATE_COIN preview ready.
                                      </p>
                                      <p class="mono text-[0.6rem] text-text-muted mt-2 break-all">
                                        opcode={{ p.condition_opcode }}
                                        · amount={{ p.marker_coin_amount_mojos }} mojo
                                        · payload_hash={{ p.payload_hash }}
                                      </p>
                                      <p class="mono text-[0.6rem] text-text-muted mt-2 break-all">
                                        marker_puzzle_hash={{ p.marker_puzzle_hash }}
                                      </p>
                                      <details class="mt-2">
                                        <summary class="text-xs text-text-muted cursor-pointer">
                                          condition hex
                                        </summary>
                                        <pre class="mt-2 mono text-[0.6rem] bg-black/30 p-3 rounded overflow-x-auto">{{ p.condition_hex | json }}</pre>
                                      </details>
                                    </div>
                                  }
                                }
                                @case ('error') {
                                  @if (recoveryCreateCoinPreviewError(); as err) {
                                    <p class="text-xs text-yellow-300 mt-2">
                                      CREATE_COIN preview unavailable: {{ err }}
                                    </p>
                                  }
                                }
                              }
                              @switch (recoveryCreateCoinPreviewState().kind) {
                                @case ('ready') {
                                  <div class="mt-3 rounded border border-white/10 bg-white/[0.03] p-2">
                                    <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                                      Broadcast marker coin (optional)
                                    </div>
                                    @if (!walletConnected()) {
                                      <p class="text-[0.65rem] text-yellow-300 mt-2">
                                        Connect a Chia wallet above to enable
                                        on-chain broadcast.
                                      </p>
                                    } @else {
                                      <p class="text-[0.65rem] text-text-muted mt-2">
                                        Signs the previewed CREATE_COIN with the
                                        connected wallet, then pushes the bundle
                                        to coinset.org. The marker coin is owned
                                        by the marker puzzle hash you entered
                                        above; only the 1-mojo dust + memos are
                                        recorded on chain.
                                      </p>
                                    }
                                    <button
                                      type="button"
                                      class="btn btn--ghost mt-2 text-[0.65rem] py-1 px-3"
                                      [disabled]="!canBroadcastRecoveryMarkerCoin()"
                                      (click)="broadcastRecoveryAnchorMarkerCoin()"
                                    >
                                      @switch (recoveryBroadcastState().kind) {
                                        @case ('signing') { Signing… }
                                        @case ('pushing') { Pushing… }
                                        @default { Broadcast on chain }
                                      }
                                    </button>
                                    @if (recoveryBroadcastResult(); as r) {
                                      <p class="text-xs text-emerald-300 mt-2">
                                        Broadcast accepted by coinset.org
                                        (status: {{ r.pushStatus ?? 'pending' }}).
                                      </p>
                                      <p class="mono text-[0.6rem] text-text-muted mt-1 break-all">
                                        marker_coin_id={{ r.markerCoinId }}
                                      </p>
                                      <p class="mono text-[0.6rem] text-text-muted mt-1 break-all">
                                        funding_coin_id={{ r.fundingCoinId }}
                                      </p>
                                    }
                                    @if (recoveryBroadcastError(); as err) {
                                      <p class="text-xs text-yellow-300 mt-2">
                                        Broadcast failed: {{ err }}
                                      </p>
                                    }
                                  </div>
                                }
                              }
                              <p class="text-[0.65rem] text-text-muted mt-2">
                                The preview above is also accepted by offline
                                tools (e.g. <code>chia rpc full_node
                                push_tx</code>) so operators can publish without
                                a browser wallet if they prefer.
                              </p>
                              @if (recoveryHandoffBundleJson()) {
                                <button
                                  type="button"
                                  class="btn btn--ghost mt-3 text-[0.65rem] py-1 px-3"
                                  (click)="downloadRecoveryHandoffBundleJson()"
                                >
                                  Download recovery handoff bundle
                                </button>
                                <details class="mt-2">
                                  <summary class="text-xs text-text-muted cursor-pointer">
                                    recovery_handoff_bundle.json
                                  </summary>
                                  <pre class="mt-2 mono text-[0.6rem] bg-black/30 p-3 rounded overflow-x-auto">{{ recoveryHandoffBundleJson() }}</pre>
                                </details>
                              }
                            </div>
                            <details>
                              <summary class="text-xs text-text-muted cursor-pointer">
                                bootstrap_manifest.json
                              </summary>
                              <pre class="mt-2 mono text-[0.6rem] bg-black/30 p-3 rounded overflow-x-auto">{{ finalizedManifestJson() }}</pre>
                            </details>
                            <details>
                              <summary class="text-xs text-text-muted cursor-pointer">
                                portal_runtime_config.json
                              </summary>
                              <pre class="mt-2 mono text-[0.6rem] bg-black/30 p-3 rounded overflow-x-auto">{{ finalizedRuntimeJson() }}</pre>
                            </details>
                            <details>
                              <summary class="text-xs text-text-muted cursor-pointer">
                                bootstrap_recovery_anchor.json
                              </summary>
                              <pre class="mt-2 mono text-[0.6rem] bg-black/30 p-3 rounded overflow-x-auto">{{ finalizedRecoveryAnchorJson() }}</pre>
                            </details>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              }
              @case ('error') {
                @if (errorView(); as e) {
                  <div class="card mt-4 border border-red-500/40 bg-red-500/10">
                    <h3 class="font-display text-xl">Submit failed</h3>
                    <p class="text-sm break-words mt-1">{{ e.message }}</p>
                    <p class="text-xs text-text-muted mt-2">
                      Click "Submit on chain" to retry, or copy the JSON
                      instructions and finish via the Python CLI.
                    </p>
                  </div>
                }
              }
            }

            <details class="mt-5">
              <summary class="text-xs text-text-muted cursor-pointer">
                Show JSON blob
              </summary>
              <pre class="mt-2 mono text-[0.6rem] bg-black/30 p-3 rounded overflow-x-auto">{{ jsonInstructions() }}</pre>
            </details>
          </div>
        }
      }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .input {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 0.5rem 0.75rem;
        color: inherit;
      }
      .input:focus {
        outline: none;
        border-color: rgba(0, 200, 120, 0.6);
        background: rgba(255, 255, 255, 0.06);
      }
      code {
        background: rgba(255, 255, 255, 0.06);
        padding: 0 0.25rem;
        border-radius: 3px;
      }
    `,
  ],
})
export class LaunchAuthorityV2Component {
  private readonly v2 = inject(AdminAuthorityV2Service);
  private readonly wasm = inject(ChiaWasmService);
  private readonly adminSession = inject(AdminSessionService);
  private readonly bootstrap = inject(AdminBootstrapService);
  // Public so the template can read isConnected/pubkey/connectionKind
  // and call hasGoby()/hasSage() for the inline connect banner.
  readonly chiaWallet = inject(ChiaWalletService);
  private readonly evmWallet = inject(EvmWalletService);
  private readonly eip712Leaf = inject(Eip712LeafHashService);
  private readonly coinPicker = inject(WalletCoinPickerService);
  private readonly onChain = inject(OnChainStateService);
  private readonly recoveryBroadcast = inject(RecoveryAnchorBroadcastService);
  private chiaConnectAttempt = 0;
  private firstAdminRecoverAttempt = 0;

  // ─── Form state ────────────────────────────────────────────────────
  readonly parentCoinIdInput = signal('');
  readonly mipsRootHashInput = signal('');
  readonly adminRecordsInput = signal('');
  readonly recoveryMarkerPuzzleHashInput = signal('');
  readonly authorityVersionInput = signal(1);
  readonly eveAmountInput = signal(1);

  // ─── Phase 2.5a: first-admin auto-fill ─────────────────────────────
  /** Captured leaf metadata when the operator opted to use their
   * connected EVM wallet as admin[0].  Drives both the textarea
   * pre-fill and the admin_records.json download. */
  readonly firstAdminLeaf = signal<Eip712LeafHash | null>(null);
  /** Resolved EVM address that was probed; `null` until first probe
   * completes successfully. */
  readonly firstAdminAddress = signal<string | null>(null);
  /** True while the wallet probe + API roundtrip are in flight. */
  readonly recoveringFirstAdmin = signal(false);
  /** Last error from the recovery flow (wallet rejection, API
   * failure, etc.).  Cleared when a fresh attempt starts. */
  readonly firstAdminError = signal<string | null>(null);

  // ─── Phase 2.5b: MIPS root auto-fill ───────────────────────────────
  /** When non-null, indicates that {@link mipsRootHashInput} was
   * populated via {@link useFirstAdminAsController}.  The value
   * (``'bare'`` | ``'mofn1of1'``) tells the user which CHIP-0043
   * shape we built for them — surfaces in the UI as a confirmation
   * line. */
  readonly mipsRootShape = signal<'bare' | 'mofn1of1' | null>(null);
  /** Last error from the MIPS-root computation flow.  Cleared when
   * a fresh attempt starts or the input is manually edited. */
  readonly mipsRootError = signal<string | null>(null);

  // ─── Phase 2.5c: funding coin id auto-fill ─────────────────────────
  /** Set when {@link parentCoinIdInput} was populated via
   * {@link fetchFundingCoinIdFromWallet}.  Holds the receive address
   * + chosen amount so the UI can show "✓ Picked from txch1... (N
   * TXCH)" as confirmation. */
  readonly fundingCoinPick = signal<{ address: string; amountTxch: string } | null>(
    null,
  );
  /** Last error from the funding-coin pick flow.  Cleared when a
   * fresh attempt starts. */
  readonly fundingCoinError = signal<string | null>(null);
  /** True while the wallet probe + coinset query are in flight. */
  readonly fetchingFundingCoinId = signal(false);

  // ─── Phase 2.5d: inline Chia wallet connect ────────────────────────
  /** Set to ``'goby'`` or ``'sage'`` while a connect call is in
   * flight; ``null`` otherwise.  Used by the connect banner to
   * disable both buttons + show "Connecting…" on the active one. */
  readonly connectingChia = signal<'goby' | 'sage' | 'sage-walletconnect' | null>(null);
  /** Last error from the inline connect flow.  Cleared on the next
   * attempt. */
  readonly chiaConnectError = signal<string | null>(null);
  readonly connectingEvm = signal<'injected' | 'walletconnect' | null>(null);
  readonly evmConnectError = signal<string | null>(null);

  // ─── Derived state ─────────────────────────────────────────────────
  readonly chiaWasmReady = computed(() => this.wasm.ready());
  readonly copyConfirmation = signal<string | null>(null);
  readonly submitState = signal<SubmitState>({ kind: 'idle' });
  readonly walletConnected = computed(() => this.chiaWallet.isConnected());
  readonly evmAdminConnected = computed(() => this.evmWallet.isConnected());
  readonly evmAdminAddress = computed(() => this.evmWallet.address());
  readonly evmAdminConnectionKind = computed(() => this.evmWallet.connectionKind());
  readonly bootstrapStatus = signal<BootstrapStatusResponse | null>(null);
  readonly bootstrapStatusError = signal<string | null>(null);
  readonly checkingBootstrapStatus = signal(false);
  private bootstrapStatusRequestInFlight = false;
  readonly launchAccessMode = computed<LaunchAccessMode>(() => {
    const status = this.bootstrapStatus();
    if (status?.locked) return 'locked';
    if (this.checkingBootstrapStatus()) return 'checking';
    if (status?.authenticated) return 'bootstrap';
    if (this.adminSession.isAuthenticated()) return 'permanent-admin';
    return 'missing';
  });

  /**
   * Narrowed view of submitState when the kind is 'submitted'.
   * Angular templates can't narrow discriminated unions directly via
   * @switch — TS strict-templates rejects ``submitState().launcherId``
   * inside the @case('submitted') branch — so we expose typed
   * helpers per-state.
   */
  readonly submittedView = computed(() => {
    const s = this.submitState();
    return s.kind === 'submitted'
      ? { launcherId: s.launcherId, statusFromCoinset: s.statusFromCoinset }
      : null;
  });

  readonly errorView = computed(() => {
    const s = this.submitState();
    return s.kind === 'error' ? { message: s.message } : null;
  });

  // ─── Phase 0 Brick 0.4E: bootstrap finalize state ──────────────────
  /** Result of the most recent ``/admin/bootstrap/finalize`` attempt.
   * Only ever transitions away from ``'idle'`` after a successful
   * admin-authority launch under a temporary bootstrap session. */
  readonly finalizeState = signal<FinalizeState>({ kind: 'idle' });

  /** Narrowed view of finalizeState when kind is ``'finalized'``. */
  readonly finalizedView = computed(() => {
    const s = this.finalizeState();
    return s.kind === 'finalized'
      ? {
          bootstrapManifest: s.bootstrapManifest,
          portalRuntimeConfig: s.portalRuntimeConfig,
          bootstrapRecoveryAnchor: s.bootstrapRecoveryAnchor,
        }
      : null;
  });

  /** Pretty-printed JSON of the returned bootstrap_manifest, for the
   * read-only `<details>` block.  Empty string when not finalized. */
  readonly finalizedManifestJson = computed(() => {
    const v = this.finalizedView();
    return v ? JSON.stringify(v.bootstrapManifest, null, 2) : '';
  });

  /** Pretty-printed JSON of the returned portal_runtime_config. */
  readonly finalizedRuntimeJson = computed(() => {
    const v = this.finalizedView();
    return v ? JSON.stringify(v.portalRuntimeConfig, null, 2) : '';
  });

  readonly finalizedRecoveryAnchorJson = computed(() => {
    const v = this.finalizedView();
    return v ? JSON.stringify(v.bootstrapRecoveryAnchor, null, 2) : '';
  });

  /** Last finalize error message, or null when not in error state. */
  readonly finalizeError = computed(() => {
    const s = this.finalizeState();
    return s.kind === 'error' ? s.message : null;
  });

  readonly recoveryVerifyState = signal<RecoveryVerifyState>({ kind: 'idle' });
  readonly recoveryChainState = signal<RecoveryChainState>({ kind: 'idle' });
  readonly recoveryPublishIntentState = signal<RecoveryPublishIntentState>({ kind: 'idle' });
  readonly recoveryCreateCoinPreviewState = signal<RecoveryCreateCoinPreviewState>({ kind: 'idle' });
  readonly recoveryBroadcastState = signal<RecoveryBroadcastState>({ kind: 'idle' });
  readonly recoveryHandoffBundleInput = signal('');
  readonly recoveryHandoffResumeState = signal<RecoveryHandoffResumeState>({
    kind: 'idle',
  });
  readonly resumedAdminRecords = signal<Record<string, unknown> | null>(null);

  readonly recoveryHandoffResumeError = computed(() => {
    const s = this.recoveryHandoffResumeState();
    return s.kind === 'error' ? s.message : null;
  });

  readonly recoveryVerifySuccess = computed(() => {
    const s = this.recoveryVerifyState();
    return s.kind === 'verified' ? s.response : null;
  });

  readonly recoveryVerifyFailure = computed(() => {
    const s = this.recoveryVerifyState();
    if (s.kind === 'rejected') return s.response.error ?? 'Recovery artifacts failed verification.';
    if (s.kind === 'error') return s.message;
    return null;
  });

  readonly recoveryChainMatched = computed(() => {
    const s = this.recoveryChainState();
    return s.kind === 'matched' ? s : null;
  });

  readonly recoveryChainWarning = computed(() => {
    const s = this.recoveryChainState();
    return s.kind === 'mismatch' || s.kind === 'unavailable' || s.kind === 'error' ? s.message : null;
  });

  readonly recoveryPublishIntent = computed(() => {
    const s = this.recoveryPublishIntentState();
    return s.kind === 'ready' ? s.response : null;
  });

  readonly recoveryPublishIntentError = computed(() => {
    const s = this.recoveryPublishIntentState();
    return s.kind === 'error' ? s.message : null;
  });

  readonly recoveryPublishIntentPayloadJson = computed(() => {
    const intent = this.recoveryPublishIntent();
    return intent ? JSON.stringify(intent.payload_memo_json, null, 2) : '';
  });

  readonly recoveryCreateCoinPreview = computed(() => {
    const s = this.recoveryCreateCoinPreviewState();
    return s.kind === 'ready' ? s.response : null;
  });

  readonly recoveryCreateCoinPreviewError = computed(() => {
    const s = this.recoveryCreateCoinPreviewState();
    return s.kind === 'error' ? s.message : null;
  });

  readonly recoveryHandoffBundle = computed<RecoveryHandoffBundle | null>(() => {
    const finalized = this.finalizedView();
    const adminRecords = this.buildAdminRecordsConfig() ?? this.resumedAdminRecords();
    if (!finalized || !adminRecords) return null;
    const broadcast = this.recoveryBroadcastResult();
    return {
      version: 1,
      artifacts: {
        bootstrap_manifest: finalized.bootstrapManifest,
        portal_runtime_config: finalized.portalRuntimeConfig,
        bootstrap_recovery_anchor: finalized.bootstrapRecoveryAnchor,
        admin_records: adminRecords,
      },
      verifier: this.recoveryVerifyState(),
      chain_state: this.recoveryChainState(),
      recovery_anchor_publish_intent: this.recoveryPublishIntent(),
      recovery_anchor_create_coin_preview: this.recoveryCreateCoinPreview(),
      recovery_anchor_broadcast: broadcast
        ? {
            funding_coin_id: broadcast.fundingCoinId,
            marker_coin_id: broadcast.markerCoinId,
            marker_puzzle_hash: broadcast.markerPuzzleHash,
            marker_coin_amount_mojos: broadcast.markerCoinAmountMojos,
            payload_hash: broadcast.payloadHash,
            push_status: broadcast.pushStatus,
          }
        : null,
    };
  });

  readonly recoveryHandoffBundleJson = computed(() => {
    const bundle = this.recoveryHandoffBundle();
    return bundle ? JSON.stringify(bundle, null, 2) : '';
  });

  readonly canPreviewRecoveryMarkerCoin = computed(() =>
    this.recoveryPublishIntentState().kind === 'ready'
    && isHex32(this.recoveryMarkerPuzzleHashInput().trim())
    && this.recoveryCreateCoinPreviewState().kind !== 'pending',
  );

  /** Successful broadcast result, or ``null`` if not yet broadcast. */
  readonly recoveryBroadcastResult = computed(() => {
    const s = this.recoveryBroadcastState();
    return s.kind === 'broadcast' ? s.result : null;
  });

  /** Operator-facing broadcast error message, if any. */
  readonly recoveryBroadcastError = computed(() => {
    const s = this.recoveryBroadcastState();
    return s.kind === 'error' ? s.message : null;
  });

  /** True iff the broadcast button is currently waiting on the
   * wallet or coinset.  Used to disable the button + show a spinner. */
  readonly recoveryBroadcastInFlight = computed(() => {
    const k = this.recoveryBroadcastState().kind;
    return k === 'signing' || k === 'pushing';
  });

  /** True iff every precondition for the broadcast button is met:
   * a CREATE_COIN preview has been generated, a Chia wallet is
   * connected, and we're not already broadcasting. */
  readonly canBroadcastRecoveryMarkerCoin = computed(() =>
    this.recoveryCreateCoinPreviewState().kind === 'ready'
    && this.walletConnected()
    && !this.recoveryBroadcastInFlight(),
  );

  /** True when every input the finalize endpoint requires is present:
   * temporary bootstrap session, submitted launch, recovered first
   * admin, computed admins_hash, and a non-empty MIPS root. */
  readonly canFinalizeBootstrap = computed(() =>
    this.launchAccessMode() === 'bootstrap'
    && this.submitState().kind === 'submitted'
    && this.firstAdminLeaf() !== null
    && this.firstAdminAddress() !== null
    && !!this.adminsHash()
    && !!this.mipsRootHashInput(),
  );

  /**
   * Parse the admin-records textarea into typed AdminRecord objects,
   * surfacing the first parse error as a string.  Returns ``null``
   * when the textarea is empty (we let computedPreview() decide
   * whether that's a hard error or just "not ready yet").
   */
  readonly adminRecordsParsed = computed<
    { records: AdminRecord[]; error: null } | { records: null; error: string }
  >(() => {
    const raw = this.adminRecordsInput().trim();
    if (!raw) return { records: [], error: null };
    const records: AdminRecord[] = [];
    const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/\s+/);
      if (parts.length !== 3) {
        return {
          records: null,
          error: `Line ${i + 1}: expected 3 fields (admin_idx leaves m_within), got ${parts.length}`,
        };
      }
      const adminIdx = Number(parts[0]);
      const leaves = parts[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      const mWithin = Number(parts[2]);
      if (!Number.isInteger(adminIdx) || adminIdx < 0) {
        return { records: null, error: `Line ${i + 1}: admin_idx must be a non-negative integer` };
      }
      if (!Number.isInteger(mWithin) || mWithin < 1) {
        return { records: null, error: `Line ${i + 1}: m_within must be a positive integer` };
      }
      if (mWithin > leaves.length) {
        return {
          records: null,
          error: `Line ${i + 1}: m_within (${mWithin}) > leaves count (${leaves.length})`,
        };
      }
      // Validate each leaf is hex bytes32.
      for (const leaf of leaves) {
        if (!isHex32(leaf)) {
          return { records: null, error: `Line ${i + 1}: leaf "${leaf}" is not a 32-byte hex string` };
        }
      }
      records.push({ adminIdx, leaves, mWithin });
    }
    return { records, error: null };
  });

  /** First validation error from any input field, or null when ready. */
  readonly validationError = computed<string | null>(() => {
    if (this.parentCoinIdInput() && !isHex32(this.parentCoinIdInput())) {
      return 'Funding coin id must be a 32-byte hex string';
    }
    if (this.mipsRootHashInput() && !isHex32(this.mipsRootHashInput())) {
      return 'MIPS root hash must be a 32-byte hex string';
    }
    const recs = this.adminRecordsParsed();
    if (recs.error) return recs.error;
    if (this.authorityVersionInput() < 1) {
      return 'Authority version must be ≥ 1';
    }
    if (this.eveAmountInput() < 1 || this.eveAmountInput() % 2 === 0) {
      return 'Eve amount must be a positive odd integer (singletons require odd amounts)';
    }
    return null;
  });

  /**
   * Live admins_hash computation from the parsed admin records.
   * Returns null when records aren't yet parseable; the preview
   * pipeline short-circuits when this is null.
   */
  readonly adminsHash = computed<string | null>(() => {
    if (!this.chiaWasmReady()) return null;
    const recs = this.adminRecordsParsed();
    // TS' control-flow analysis doesn't narrow the discriminated
    // union through a computed-signal boundary in strict mode, so
    // we explicitly capture the records into a typed const after
    // the safety check rather than rely on auto-narrowing.
    const records = recs.records;
    if (records === null) return null;
    try {
      return bytesToHexPrefixed(this.v2.computeAdminsHash(records));
    } catch {
      return null;
    }
  });

  /** Live state_hash from current inputs.  Surfaces in the preview card. */
  readonly stateHash = computed<string | null>(() => {
    if (!this.chiaWasmReady()) return null;
    const mips = this.mipsRootHashInput();
    const admins = this.adminsHash();
    if (!mips || !admins || !isHex32(mips)) return null;
    try {
      return bytesToHexPrefixed(
        this.v2.computeStateHash({
          mipsRootHash: mips,
          adminsHash: admins,
          pendingOpsHash: AdminAuthorityV2Service.EMPTY_LIST_HASH,
          authorityVersion: this.authorityVersionInput(),
        }),
      );
    } catch {
      return null;
    }
  });

  /**
   * Full launch outputs.  Null until every input is valid + the WASM
   * SDK is ready — the template guards on this signal so the preview
   * card stays hidden during partial input.
   */
  readonly computedPreview = computed<LaunchOutputs | null>(() => {
    if (!this.chiaWasmReady()) return null;
    if (this.validationError()) return null;
    const parent = this.parentCoinIdInput();
    const mips = this.mipsRootHashInput();
    const admins = this.adminsHash();
    if (!parent || !mips || !admins) return null;
    try {
      const innerHash = bytesToHexPrefixed(
        this.v2.makeInnerPuzzleHash({
          mipsRootHash: mips,
          adminsHash: admins,
          authorityVersion: this.authorityVersionInput(),
        }),
      );
      return this.v2.computeLaunchOutputs({
        parentCoinId: parent,
        eveInnerPuzzleHash: innerHash,
        eveAmount: this.eveAmountInput(),
      });
    } catch {
      return null;
    }
  });

  /** JSON blob the operator copy-pastes into their CLI launch tool. */
  readonly jsonInstructions = computed<string>(() => {
    const p = this.computedPreview();
    if (!p) return '';
    const recs = this.adminRecordsParsed();
    return JSON.stringify(
      {
        launcher_id: p.launcherId,
        eve_inner_puzzle_hash: p.eveInnerPuzzleHash,
        eve_full_puzzle_hash: p.eveFullPuzzleHash,
        state_hash: this.stateHash(),
        launcher_announcement_id: p.launcherAnnouncementId,
        launcher_announcement_message: p.launcherAnnouncementMessage,
        inputs: {
          parent_coin_id: this.parentCoinIdInput(),
          mips_root_hash: this.mipsRootHashInput(),
          admins_hash: this.adminsHash(),
          admin_records: recs.error ? null : recs.records,
          authority_version: this.authorityVersionInput(),
          eve_amount: this.eveAmountInput(),
        },
        // The operator's CLI tool re-derives all the hashes from the
        // input section to verify it's reading the same world the
        // portal computed against.  Any drift surfaces as a
        // launcher_id / state_hash mismatch — the safest possible
        // failure mode.
        cross_check_note:
          'Re-run solslot_protocol/scripts/dump_v2_fixtures.py against ' +
          'the inputs section to verify hashes match.  Any drift = abort.',
      },
      null,
      2,
    );
  });

  constructor() {
    void this.chiaWallet.restoreSageWalletConnectSession();
    // Auto-clear the copy confirmation banner after a few seconds so
    // the UI doesn't stay in "copied!" state forever.
    effect((onCleanup) => {
      const msg = this.copyConfirmation();
      if (!msg) return;
      const t = setTimeout(() => this.copyConfirmation.set(null), 3000);
      onCleanup(() => clearTimeout(t));
    });
    void this.refreshBootstrapStatus();
  }

  async refreshBootstrapStatus(): Promise<void> {
    if (this.bootstrapStatusRequestInFlight) return;
    this.bootstrapStatusRequestInFlight = true;
    this.bootstrapStatusError.set(null);
    this.checkingBootstrapStatus.set(true);
    try {
      this.bootstrapStatus.set(await this.bootstrap.getBootstrapStatus());
    } catch (e) {
      this.bootstrapStatus.set(null);
      this.bootstrapStatusError.set(formatError(e));
    } finally {
      this.checkingBootstrapStatus.set(false);
      this.bootstrapStatusRequestInFlight = false;
    }
  }

  /**
   * Phase 2.5a: ask the operator's connected EVM wallet to sign a
   * deterministic probe, recover their compressed secp256k1 pubkey,
   * call the API to compute the canonical Eip712Member leaf hash,
   * and pre-fill the admin records textarea with a single-admin
   * record using that leaf.
   *
   * The full leaf metadata (curry args + EVM address) is also saved
   * to {@link firstAdminLeaf} so we can emit the API-ready
   * admin_records.json file after a successful launch.
   */
  async recoverFirstAdminFromWallet(): Promise<void> {
    if (this.recoveringFirstAdmin()) return;
    const attempt = ++this.firstAdminRecoverAttempt;
    this.firstAdminError.set(null);
    if (!this.evmAdminConnected()) {
      this.firstAdminError.set(
        'Connect an EVM wallet for admin slot 0 first. The connected Chia wallet only funds the on-chain launcher.',
      );
      return;
    }
    this.recoveringFirstAdmin.set(true);
    try {
      const { pubkey, address } = await this.evmWallet.recoverFirstAdminPubkey();
      if (this.firstAdminRecoverAttempt !== attempt) return;
      const network = environment.chiaNetwork;
      // Compute the leaf hash entirely in-browser via the
      // chia-wallet-sdk WASM (Eip712LeafHashService) — no API
      // round-trip.  Cross-verified against solslot_protocol's
      // ``compute_eip712_member_leaf_hash`` Python helper, which uses
      // ``chia.wallet.util.curry_and_treehash`` semantics.
      const resp = this.eip712Leaf.compute(pubkey, network);
      this.firstAdminLeaf.set(resp);
      this.firstAdminAddress.set(address);

      // Fill the wizard's textarea with the canonical record.  Each
      // line is `admin_idx leaf_hash m_within`; for a single admin
      // with one leaf and m_within=1 we get just one line.
      this.adminRecordsInput.set(`0 ${resp.leaf_hash} 1`);
    } catch (e) {
      if (this.firstAdminRecoverAttempt === attempt) {
        this.firstAdminError.set(formatError(e));
      }
    } finally {
      if (this.firstAdminRecoverAttempt === attempt) {
        this.recoveringFirstAdmin.set(false);
      }
    }
  }

  cancelFirstAdminRecovery(): void {
    if (!this.recoveringFirstAdmin()) return;
    this.firstAdminRecoverAttempt += 1;
    this.recoveringFirstAdmin.set(false);
    this.firstAdminError.set(
      'Recovery request canceled. Close any stale wallet prompt, then retry with a fresh WalletConnect session.',
    );
  }

  /**
   * Phase 2.5d: connect to Goby or Sage directly from the wizard
   * banner so the operator doesn't have to navigate to ``/connect``
   * just to enable the Chia-wallet-gated buttons (Fetch from wallet,
   * Submit on chain).
   *
   * Calls into the existing ``ChiaWalletService.connectGoby`` /
   * ``connectSage`` flow — same code path as ``/connect``, just
   * without the post-connect router navigation.  After a successful
   * connect, ``walletConnected()`` flips to true and Angular's signal
   * graph re-renders the banner as the green "connected" state +
   * enables all the gated buttons.
   *
   * @param kind ``'goby'`` (browser extension) or ``'sage'``
   *   (Sage Wallet bridge).  Only buttons whose wallet is detected
   *   are rendered, so we don't expose a "missing wallet" error
   *   path here — the connect call would surface that anyway.
   */
  async connectChia(kind: 'goby' | 'sage' | 'sage-walletconnect'): Promise<void> {
    if (this.connectingChia()) return;
    const attempt = ++this.chiaConnectAttempt;
    this.chiaConnectError.set(null);
    this.connectingChia.set(kind);
    try {
      if (kind === 'goby') {
        await this.chiaWallet.connectGoby();
      } else if (kind === 'sage') {
        await this.chiaWallet.connectSage();
      } else {
        await this.chiaWallet.connectSageWalletConnect();
      }
    } catch (e) {
      if (this.chiaConnectAttempt === attempt) {
        this.chiaConnectError.set(formatError(e));
      }
    } finally {
      if (this.chiaConnectAttempt === attempt) {
        this.connectingChia.set(null);
      }
    }
  }

  cancelChiaConnect(): void {
    if (!this.connectingChia()) return;
    this.chiaConnectAttempt += 1;
    this.chiaWallet.cancelPendingConnection();
    this.connectingChia.set(null);
    this.chiaConnectError.set('Connection request canceled. Close the wallet prompt, then try again.');
  }

  hasInjectedEvmWallet(): boolean {
    return this.evmWallet.hasInjectedProvider();
  }

  async connectEvmAdminWallet(kind: 'injected' | 'walletconnect'): Promise<void> {
    if (this.connectingEvm()) return;
    this.evmConnectError.set(null);
    this.firstAdminError.set(null);
    this.connectingEvm.set(kind);
    try {
      if (kind === 'injected') {
        await this.evmWallet.connectInjected();
      } else {
        await this.evmWallet.connectWalletConnect({
          optionalChains: 'none',
          resetSession: true,
        });
      }
    } catch (e) {
      this.evmConnectError.set(formatError(e));
    } finally {
      this.connectingEvm.set(null);
    }
  }

  /**
   * Phase 2.5c: ask the connected Chia wallet for its receive
   * address, query coinset.org for unspent coins under that puzzle
   * hash, and pre-fill the {@link parentCoinIdInput} with the
   * largest-amount coin's id.
   *
   * **What this is for.** The funding coin id is curried into the
   * launcher coin name, so it's part of the deterministic
   * ``launcher_id`` preview.  Without a real coin id the wizard can
   * only show "shape-correct" outputs that won't match what shows up
   * on chain.  With one, the previewed ``launcher_id`` is the value
   * the operator will literally see post-launch (assuming the
   * wallet picks the same coin at submit time, which it usually
   * does — wallets prefer the largest unspent coin too).
   *
   * **What this is NOT for.** It's not a coin lock / reservation.
   * The wallet may spend the picked coin between now and Submit
   * (e.g. on a competing tx); the wallet picks its own coin at
   * sign time anyway, per
   * ``ChiaWalletService.transfer``.  This helper is purely a UX
   * convenience so the operator doesn't have to manually copy a
   * coin id out of their wallet UI.
   *
   * Errors surface in {@link fundingCoinError} (cleared on the
   * next attempt).  Pre-conditions: connected Chia wallet + WASM
   * ready (button is gated on both).
   */
  async fetchFundingCoinIdFromWallet(): Promise<void> {
    if (this.fetchingFundingCoinId()) return;
    this.fundingCoinError.set(null);
    this.fetchingFundingCoinId.set(true);
    try {
      const pick = await this.coinPicker.pickLargestUnspentCoinId();
      this.parentCoinIdInput.set(pick.coinId);
      // Convert mojos → TXCH/XCH (1 XCH = 1e12 mojos).  Use
      // BigInt-safe formatting; show 4 decimals to match what most
      // wallet UIs surface for receive-address balances.
      const mojosPerXch = 1_000_000_000_000n;
      const whole = pick.amount / mojosPerXch;
      const frac = pick.amount % mojosPerXch;
      const fracStr = frac
        .toString()
        .padStart(12, '0')
        .slice(0, 4)
        .replace(/0+$/, '');
      const amountTxch =
        fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
      this.fundingCoinPick.set({ address: pick.address, amountTxch });
    } catch (e) {
      this.fundingCoinError.set(formatError(e));
      this.fundingCoinPick.set(null);
    } finally {
      this.fetchingFundingCoinId.set(false);
    }
  }

  /**
   * Phase 2.5b: build a CHIP-0043 1-of-1 ``m_of_n`` quorum where the
   * recovered first admin's EIP-712 member is the sole controller,
   * compute its tree hash entirely in-browser via WASM, and pre-fill
   * the {@link mipsRootHashInput} field.
   *
   * Pre-condition: {@link firstAdminLeaf} must already be set (i.e.,
   * the operator clicked "Use my connected wallet as first admin"
   * first). The button stays clickable once WASM is ready so the UI
   * can explain that missing recovery step instead of failing silently.
   *
   * Uses the production-shaped ``mofn1of1`` mode by default — a real
   * ``mOfNHash(MemberConfig{topLevel: true}, 1,
   * [eip712MemberHash(MemberConfig{topLevel: false}, ...)])`` —
   * because:
   *
   *   1. It's what production launches will use (so the previewed
   *      ``launcher_id`` reflects what the operator will actually
   *      see on chain).
   *   2. It exercises the full CHIP-0043 stack via the new WASM
   *      bindings landed in PR #396 (``mOfNHash`` +
   *      ``eip712MemberHash`` + ``MemberConfig``), proving the
   *      bindings work end-to-end without any API call.
   *
   * Operators who want the smallest possible controller (degenerate
   * "MIPS root = bare member") can skip this button and paste the
   * recovered ``leaf_hash`` directly into the field — that matches
   * the test fixture pattern in
   * ``solslot_protocol/tests/test_admin_authority_v2.py:1530-1542``.
   */
  useFirstAdminAsController(): void {
    this.mipsRootError.set(null);
    const leaf = this.firstAdminLeaf();
    if (!leaf) {
      this.mipsRootError.set('Recover your first admin first.');
      return;
    }
    try {
      const result = this.eip712Leaf.computeMipsRoot1Of1(
        leaf.secp256k1_pubkey,
        leaf.network,
        'mofn1of1',
      );
      this.mipsRootHashInput.set(result.mips_root_hash);
      this.mipsRootShape.set(result.shape);
    } catch (e) {
      this.mipsRootError.set(formatError(e));
      this.mipsRootShape.set(null);
    }
  }

  /**
   * Build the operator-supplied admin records JSON for the API to
   * load on boot (``SOLSLOT_ADMIN_RECORDS_PATH``).  Schema matches
   * ``solslot_api/admin_records.py``'s ``AdminRecordsConfig``.
   *
   * Returns null when the operator hasn't recovered their EVM wallet
   * yet (no ``firstAdminLeaf``) OR the launch hasn't been submitted
   * (no ``launcherId``); both are required for the JSON to be
   * useful.
   */
  buildAdminRecordsConfig(): Record<string, unknown> | null {
    const leaf = this.firstAdminLeaf();
    const evm = this.firstAdminAddress();
    const submitted = this.submittedView();
    if (!leaf || !evm || !submitted) return null;
    return {
      version: 1,
      launcher_id: submitted.launcherId,
      admin_records: [
        {
          admin_idx: 0,
          m_within: 1,
          leaves: [
            {
              kind: 'eip712_member',
              leaf_hash: leaf.leaf_hash,
              evm_address: evm.toLowerCase(),
              secp256k1_pubkey: leaf.secp256k1_pubkey,
              type_hash: leaf.type_hash,
              prefix_and_domain_separator: leaf.prefix_and_domain_separator,
            },
          ],
        },
      ],
    };
  }

  buildAdminRecordsJson(): string | null {
    const config = this.buildAdminRecordsConfig();
    return config ? JSON.stringify(config, null, 2) : null;
  }

  /**
   * Trigger a browser download of the API-ready admin_records.json
   * file.  Called from the success card after a successful launch.
   */
  downloadAdminRecordsJson(): void {
    const json = this.buildAdminRecordsJson();
    if (!json) return;
    this.downloadJson('admin_records.json', json);
  }

  downloadRecoveryHandoffBundleJson(): void {
    const json = this.recoveryHandoffBundleJson();
    if (!json) return;
    this.downloadJson('recovery_handoff_bundle.json', json);
  }

  async importRecoveryHandoffBundleFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.recoveryHandoffBundleInput.set(await file.text());
      this.recoveryHandoffResumeState.set({ kind: 'idle' });
    } catch (e) {
      this.recoveryHandoffResumeState.set({
        kind: 'error',
        message: formatError(e),
      });
    } finally {
      input.value = '';
    }
  }

  async loadRecoveryHandoffBundle(): Promise<void> {
    if (this.recoveryHandoffResumeState().kind === 'pending') return;
    this.recoveryHandoffResumeState.set({ kind: 'pending' });
    this.recoveryVerifyState.set({ kind: 'idle' });
    this.recoveryChainState.set({ kind: 'idle' });
    this.recoveryPublishIntentState.set({ kind: 'idle' });
    this.recoveryCreateCoinPreviewState.set({ kind: 'idle' });
    this.recoveryBroadcastState.set({ kind: 'idle' });
    try {
      const bundle = parseRecoveryHandoffBundle(this.recoveryHandoffBundleInput());
      const finalized: BootstrapFinalizeResponse = {
        locked: true,
        bootstrap_manifest: bundle.artifacts.bootstrap_manifest,
        portal_runtime_config: bundle.artifacts.portal_runtime_config,
        bootstrap_recovery_anchor: bundle.artifacts.bootstrap_recovery_anchor,
      };
      this.resumedAdminRecords.set(bundle.artifacts.admin_records);
      this.finalizeState.set({
        kind: 'finalized',
        bootstrapManifest: finalized.bootstrap_manifest,
        portalRuntimeConfig: finalized.portal_runtime_config,
        bootstrapRecoveryAnchor: finalized.bootstrap_recovery_anchor,
      });

      if (bundle.recovery_anchor_publish_intent) {
        this.recoveryPublishIntentState.set({
          kind: 'ready',
          response: bundle.recovery_anchor_publish_intent,
        });
      }
      if (bundle.recovery_anchor_create_coin_preview) {
        this.recoveryCreateCoinPreviewState.set({
          kind: 'ready',
          response: bundle.recovery_anchor_create_coin_preview,
        });
        this.recoveryMarkerPuzzleHashInput.set(
          bundle.recovery_anchor_create_coin_preview.marker_puzzle_hash,
        );
      }

      await this.verifyFinalizedRecoveryArtifacts(
        finalized,
        bundle.artifacts.admin_records,
      );
      if (!bundle.recovery_anchor_publish_intent) {
        await this.fetchRecoveryAnchorPublishIntent();
      }
      this.recoveryHandoffResumeState.set({ kind: 'loaded' });
    } catch (e) {
      this.recoveryHandoffResumeState.set({
        kind: 'error',
        message: formatError(e),
      });
    }
  }

  private downloadJson(filename: string, json: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async copyJson(): Promise<void> {
    const json = this.jsonInstructions();
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      this.copyConfirmation.set('Copied to clipboard.');
    } catch {
      this.copyConfirmation.set('Copy failed — select + copy manually below.');
    }
  }

  /**
   * Phase 0 Brick 0.4E: submit the public commitments built during
   * the bootstrap-accessible launch ceremony to the API's
   * ``/admin/bootstrap/finalize`` endpoint.  The API atomically
   * persists ``admin_records.json``, ``portal_runtime_config.json``
   * and ``bootstrap_manifest.json``, the last of which locks the
   * bootstrapper.
   *
   * Pre-conditions (also enforced by ``canFinalizeBootstrap``):
   *   * ``launchAccessMode() === 'bootstrap'`` — temporary bootstrap
   *     session is active.  Permanent admin sessions never call this.
   *   * ``submitState().kind === 'submitted'`` — admin-authority
   *     launch already on chain.
   *   * Recovered first admin (``firstAdminLeaf`` + ``firstAdminAddress``).
   *   * Live ``adminsHash`` and a non-empty ``mipsRootHashInput``.
   *
   * Sends only public commitments — no wallet signatures, bootstrap
   * session token/cookie, or admin JWT material is included in the
   * request or stored locally.
   */
  async finalizeBootstrapArtifacts(): Promise<void> {
    if (this.finalizeState().kind === 'pending') return;
    const submitted = this.submittedView();
    const adminRecords = this.buildAdminRecordsConfig();
    const adminsHash = this.adminsHash();
    const mipsRoot = this.mipsRootHashInput();
    if (!this.canFinalizeBootstrap() || !submitted || !adminRecords || !adminsHash || !mipsRoot) {
      this.finalizeState.set({
        kind: 'error',
        message:
          'Cannot finalize: missing first admin, MIPS root, admins hash, or submitted launch.',
      });
      return;
    }
    this.finalizeState.set({ kind: 'pending' });
    this.recoveryVerifyState.set({ kind: 'idle' });
    this.recoveryChainState.set({ kind: 'idle' });
    this.recoveryPublishIntentState.set({ kind: 'idle' });
    this.recoveryCreateCoinPreviewState.set({ kind: 'idle' });
    try {
      const response: BootstrapFinalizeResponse = await this.bootstrap.finalizeBootstrap({
        admin_records: adminRecords,
        admin_authority_launcher_id: submitted.launcherId,
        admins_hash: adminsHash,
        mips_root: mipsRoot,
      });
      this.finalizeState.set({
        kind: 'finalized',
        bootstrapManifest: response.bootstrap_manifest,
        portalRuntimeConfig: response.portal_runtime_config,
        bootstrapRecoveryAnchor: response.bootstrap_recovery_anchor,
      });
      if (response.locked) {
        this.bootstrapStatus.set({
          locked: true,
          authenticated: false,
          expires_at: null,
        });
      }
      void this.verifyFinalizedRecoveryArtifacts(response, adminRecords);
      void this.fetchRecoveryAnchorPublishIntent();
      this.recoveryBroadcastState.set({ kind: 'idle' });
    } catch (e) {
      this.finalizeState.set({ kind: 'error', message: formatError(e) });
    }
  }

  async fetchRecoveryAnchorPublishIntent(): Promise<void> {
    if (this.recoveryPublishIntentState().kind === 'pending') return;
    this.recoveryPublishIntentState.set({ kind: 'pending' });
    try {
      const response = await this.bootstrap.getRecoveryAnchorPublishIntent();
      this.recoveryPublishIntentState.set({ kind: 'ready', response });
    } catch (e) {
      this.recoveryPublishIntentState.set({ kind: 'error', message: formatError(e) });
    }
  }

  async previewRecoveryAnchorMarkerCoin(): Promise<void> {
    const markerPuzzleHash = this.recoveryMarkerPuzzleHashInput().trim();
    if (!isHex32(markerPuzzleHash)) {
      this.recoveryCreateCoinPreviewState.set({
        kind: 'error',
        message: 'Marker puzzle hash must be a 32-byte hex string.',
      });
      return;
    }
    if (this.recoveryCreateCoinPreviewState().kind === 'pending') return;
    this.recoveryCreateCoinPreviewState.set({ kind: 'pending' });
    // Re-previewing invalidates any prior broadcast result; the marker
    // puzzle hash and/or memos may have changed, so a stale "broadcast"
    // state would misrepresent the freshly-previewed condition.
    this.recoveryBroadcastState.set({ kind: 'idle' });
    try {
      const response = await this.bootstrap.createRecoveryAnchorCoinPreview({
        marker_puzzle_hash: markerPuzzleHash,
      });
      this.recoveryCreateCoinPreviewState.set({ kind: 'ready', response });
    } catch (e) {
      const intent = this.recoveryPublishIntent();
      if (intent) {
        this.recoveryCreateCoinPreviewState.set({
          kind: 'ready',
          response: buildLocalRecoveryAnchorCoinPreview(markerPuzzleHash, intent),
        });
        return;
      }
      this.recoveryCreateCoinPreviewState.set({ kind: 'error', message: formatError(e) });
    }
  }

  /**
   * Path A brick R1: actually publish the recovery anchor on chain.
   *
   * Uses the previously-fetched ``publishIntent`` + ``createCoinPreview``
   * pair as the source of truth for the marker coin's puzzle hash and
   * memos, hands the deterministic ``CREATE_COIN`` to
   * ``RecoveryAnchorBroadcastService`` which asks the connected wallet
   * to sign a 1-mojo transfer carrying both memos, walks the signed
   * bundle to derive the marker coin id, and pushes via coinset.org.
   *
   * Refuses to run if the preview isn't ready or no wallet is connected.
   * Surfaces wallet rejections + push_tx errors via
   * ``recoveryBroadcastState`` so the UI can show a useful message
   * without blowing up the whole launch wizard.
   */
  async broadcastRecoveryAnchorMarkerCoin(): Promise<void> {
    if (this.recoveryBroadcastInFlight()) return;
    const previewState = this.recoveryCreateCoinPreviewState();
    const intentState = this.recoveryPublishIntentState();
    if (previewState.kind !== 'ready' || intentState.kind !== 'ready') {
      this.recoveryBroadcastState.set({
        kind: 'error',
        message:
          'Generate a CREATE_COIN preview before attempting to broadcast.',
      });
      return;
    }
    if (!this.walletConnected()) {
      this.recoveryBroadcastState.set({
        kind: 'error',
        message: 'Connect a Chia wallet before broadcasting.',
      });
      return;
    }
    this.recoveryBroadcastState.set({ kind: 'signing' });
    try {
      // We can't distinguish "wallet still showing signing prompt" from
      // "wallet signed, push in flight" without instrumenting the
      // service — but flipping to 'pushing' before the await would lie.
      // The service's awaited call covers both phases; the UI's
      // "Signing…" → "Pushing…" copy is approximate but accurate enough
      // for the operator, who sees the wallet's own UI for signing.
      const result = await this.recoveryBroadcast.broadcastMarkerCoin({
        publishIntent: intentState.response,
        createCoinPreview: previewState.response,
      });
      this.recoveryBroadcastState.set({ kind: 'broadcast', result });
    } catch (e) {
      this.recoveryBroadcastState.set({ kind: 'error', message: formatError(e) });
    }
  }

  async verifyFinalizedRecoveryArtifacts(
    response: BootstrapFinalizeResponse,
    adminRecords: Record<string, unknown>,
  ): Promise<void> {
    if (this.recoveryVerifyState().kind === 'pending') return;
    this.recoveryVerifyState.set({ kind: 'pending' });
    try {
      const verification = await this.bootstrap.verifyRecoveryArtifacts({
        bootstrap_recovery_anchor: response.bootstrap_recovery_anchor,
        bootstrap_manifest: response.bootstrap_manifest,
        portal_runtime_config: response.portal_runtime_config,
        admin_records: adminRecords,
      });
      this.recoveryVerifyState.set(
        verification.verified
          ? { kind: 'verified', response: verification }
          : { kind: 'rejected', response: verification },
      );
      if (verification.verified) {
        void this.checkRecoveredAuthorityAgainstChain(response);
      } else {
        this.recoveryChainState.set({ kind: 'idle' });
      }
    } catch (e) {
      this.recoveryVerifyState.set({ kind: 'error', message: formatError(e) });
      this.recoveryChainState.set({ kind: 'idle' });
    }
  }

  async checkRecoveredAuthorityAgainstChain(response: BootstrapFinalizeResponse): Promise<void> {
    if (this.recoveryChainState().kind === 'pending') return;
    this.recoveryChainState.set({ kind: 'pending' });
    let expectedStateHash: string | null = null;
    try {
      const authority = response.bootstrap_manifest.admin_authority_v2;
      expectedStateHash = bytesToHexPrefixed(
        this.v2.computeStateHash({
          mipsRootHash: authority.mips_root,
          adminsHash: authority.admins_hash,
          pendingOpsHash: AdminAuthorityV2Service.EMPTY_LIST_HASH,
          authorityVersion: authority.authority_version,
        }),
      );
      const chain = await this.onChain.getAuthorityV2();
      if (!chain.launcher_id || !chain.state_hash) {
        this.recoveryChainState.set({
          kind: 'unavailable',
          expectedStateHash,
          message: 'Live admin_authority_v2 state hash is not available from chain yet.',
        });
        return;
      }
      const expectedLauncher = authority.launcher_id.toLowerCase();
      const chainLauncher = chain.launcher_id.toLowerCase();
      const expectedState = expectedStateHash.toLowerCase();
      const chainState = chain.state_hash.toLowerCase();
      if (chainLauncher === expectedLauncher && chainState === expectedState) {
        this.recoveryChainState.set({
          kind: 'matched',
          launcherId: chain.launcher_id,
          expectedStateHash,
          chainStateHash: chain.state_hash,
        });
        return;
      }
      this.recoveryChainState.set({
        kind: 'mismatch',
        launcherId: chain.launcher_id,
        expectedStateHash,
        chainStateHash: chain.state_hash,
        message: 'Recovered authority coordinates do not match the live admin_authority_v2 chain state.',
      });
    } catch (e) {
      this.recoveryChainState.set({
        kind: 'error',
        message: formatError(e),
      });
    }
  }

  /**
   * Submit the launch on chain via the WASM-first flow:
   * 1. Compute eve_inner_puzzle_hash from current form state.
   * 2. Delegate to AdminAuthorityV2Service.submitLaunch which:
   *    a. Asks the connected wallet to fund the launcher coin.
   *    b. Combines wallet's signed funding spend with our launcher
   *       spend into one bundle.
   *    c. Pushes to coinset.org directly (no Solslot API in path).
   * 3. Display launcher_id + status.
   *
   * Drives the ``submitState`` signal so the UI can show progress
   * indicators and surface errors actionably.
   */
  async submitOnChain(): Promise<void> {
    if (this.submitState().kind === 'signing' || this.submitState().kind === 'pushing') {
      return;  // Already in flight; ignore double-clicks.
    }
    if (!this.walletConnected()) {
      this.submitState.set({
        kind: 'error',
        message: 'Wallet not connected.  Connect Goby or Sage first.',
      });
      return;
    }

    // Compute the eve inner puzzle hash from the form's current state.
    // We need MIPS root + admins hash + version (NOT parent coin id —
    // the wallet picks that for us, so the form's parentCoinIdInput
    // is ignored here).
    const mips = this.mipsRootHashInput();
    const admins = this.adminsHash();
    if (!mips || !admins) {
      this.submitState.set({
        kind: 'error',
        message: 'Form is incomplete.  Fill MIPS root hash + admin records first.',
      });
      return;
    }
    let eveInnerPuzzleHash: string;
    try {
      eveInnerPuzzleHash = bytesToHexPrefixed(
        this.v2.makeInnerPuzzleHash({
          mipsRootHash: mips,
          adminsHash: admins,
          authorityVersion: this.authorityVersionInput(),
        }),
      );
    } catch (e) {
      this.submitState.set({
        kind: 'error',
        message: 'Could not compute inner puzzle hash: ' + formatError(e),
      });
      return;
    }

    this.submitState.set({ kind: 'signing' });
    try {
      // submitLaunch internally:
      //   1. wallet.transfer(SINGLETON_LAUNCHER_HASH, 1)  ← signing phase
      //   2. findLauncherParentCoinId
      //   3. computeLaunchOutputs
      //   4. buildLauncherCoinSpend
      //   5. coinset.pushTransaction                       ← pushing phase
      // We can't observe phase 1 → 5 transitions from here without
      // refactoring submitLaunch into smaller chunks; for the first
      // cut we just hold 'signing' through the whole thing.  D-2.6
      // part 3 polish can split into finer states.
      const result = await this.v2.submitLaunch({
        eveInnerPuzzleHash,
        eveAmount: this.eveAmountInput(),
      });
      this.submitState.set({
        kind: 'submitted',
        launcherId: result.launcherId,
        statusFromCoinset: result.pushResponse.status,
      });
    } catch (e) {
      this.submitState.set({
        kind: 'error',
        message: formatError(e),
      });
    }
  }
}

function parseRecoveryHandoffBundle(raw: string): RecoveryHandoffBundle {
  const parsed = parseJsonObject(raw, 'recovery_handoff_bundle.json');
  const version = parsed['version'];
  if (version !== 1) {
    throw new Error('recovery_handoff_bundle.json must have version=1.');
  }
  const artifacts = requireObject(parsed['artifacts'], 'artifacts');
  const bootstrapManifest = requireObject(
    artifacts['bootstrap_manifest'],
    'artifacts.bootstrap_manifest',
  ) as BootstrapManifestArtifact;
  const portalRuntimeConfig = requireObject(
    artifacts['portal_runtime_config'],
    'artifacts.portal_runtime_config',
  ) as PortalRuntimeConfigArtifact;
  const bootstrapRecoveryAnchor = requireObject(
    artifacts['bootstrap_recovery_anchor'],
    'artifacts.bootstrap_recovery_anchor',
  ) as BootstrapRecoveryAnchorArtifact;
  const adminRecords = requireObject(
    artifacts['admin_records'],
    'artifacts.admin_records',
  );
  const publishIntent = parsed['recovery_anchor_publish_intent'];
  const createCoinPreview = parsed['recovery_anchor_create_coin_preview'];
  return {
    version: 1,
    artifacts: {
      bootstrap_manifest: bootstrapManifest,
      portal_runtime_config: portalRuntimeConfig,
      bootstrap_recovery_anchor: bootstrapRecoveryAnchor,
      admin_records: adminRecords,
    },
    verifier: isObject(parsed['verifier'])
      ? (parsed['verifier'] as RecoveryVerifyState)
      : { kind: 'idle' },
    chain_state: isObject(parsed['chain_state'])
      ? (parsed['chain_state'] as RecoveryChainState)
      : { kind: 'idle' },
    recovery_anchor_publish_intent: publishIntent == null
      ? null
      : (requireObject(
          publishIntent,
          'recovery_anchor_publish_intent',
        ) as unknown as BootstrapRecoveryAnchorPublishIntentResponse),
    recovery_anchor_create_coin_preview: createCoinPreview == null
      ? null
      : (requireObject(
          createCoinPreview,
          'recovery_anchor_create_coin_preview',
        ) as unknown as BootstrapRecoveryAnchorCreateCoinPreviewResponse),
    recovery_anchor_broadcast: null,
  };
}

function buildLocalRecoveryAnchorCoinPreview(
  markerPuzzleHash: string,
  intent: BootstrapRecoveryAnchorPublishIntentResponse,
): BootstrapRecoveryAnchorCreateCoinPreviewResponse {
  const memos = [intent.tag_memo_hex, intent.payload_memo_hex] as [
    string,
    string,
  ];
  return {
    condition_opcode: RecoveryAnchorBroadcastService.CREATE_COIN_OPCODE,
    marker_puzzle_hash: markerPuzzleHash,
    marker_coin_amount_mojos: intent.marker_coin_amount_mojos,
    tag_memo_hex: intent.tag_memo_hex,
    payload_memo_hex: intent.payload_memo_hex,
    memos_hex: memos,
    condition_hex: [
      RecoveryAnchorBroadcastService.CREATE_COIN_OPCODE,
      markerPuzzleHash,
      intent.marker_coin_amount_mojos,
      memos,
    ],
    payload_hash: intent.payload_hash,
  };
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  try {
    return requireObject(JSON.parse(raw), label);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`${label} is not valid JSON.`);
    }
    throw e;
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    // Wallet bridges (Goby / Sage / WalletConnect) typically reject
    // with plain objects like ``{ code: 4004, message: "..." }`` rather
    // than Error instances.  Walking the common keys gives operators
    // an actionable string instead of "[object Object]".
    const obj = e as Record<string, unknown>;
    const msg = obj['message'] ?? obj['error'] ?? obj['reason'];
    if (typeof msg === 'string' && msg.length > 0) {
      const code = obj['code'];
      return code != null ? `${msg} (code ${String(code)})` : msg;
    }
    try {
      return JSON.stringify(e);
    } catch {
      // Cyclic / non-serialisable — fall through.
    }
  }
  return String(e);
}

/**
 * Shallow validation: does ``s`` look like a 32-byte (64 hex char)
 * hex string with optional 0x prefix?  We don't full-decode here —
 * the service throws on actual invalid hex when computing — but
 * surface obvious shape errors immediately.
 */
function isHex32(s: string): boolean {
  const stripped = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
  return /^[0-9a-fA-F]{64}$/.test(stripped);
}
