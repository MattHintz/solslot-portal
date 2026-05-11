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
  BootstrapRecoveryAnchorArtifact,
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
import { environment } from '../../../../environments/environment';

/**
 * Launch Authority v2 admin page (Phase 9-Hermes-D D-2.4).
 *
 * Operator-facing wizard for computing every deterministic output of
 * a v2 admin-authority genesis launch.  All computation happens
 * client-side via the WASM-first ``AdminAuthorityV2Service`` — no
 * Populis API call is needed.
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
          <h1 class="font-display text-4xl md:text-5xl">Create first-admin authority.</h1>
          <p class="mt-2 text-sm text-text-muted max-w-prose">
            Continue the same genesis ceremony by creating the
            <code>admin_authority_v2</code> singleton and binding the selected
            wallet as permanent admin slot 0.
          </p>
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
              The bootstrapper is locked. Return to genesis to inspect current
              status.
            </p>
          </div>
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
                </div>
              </div>
              @if (chiaConnectError(); as err) {
                <p class="mono text-[0.6rem] text-red-300 mt-2">
                  <strong>Connect failed.</strong> {{ err }}
                </p>
              }
            </div>
          } @else {
            <div class="mt-4 rounded-card border border-emerald-500/30 bg-emerald-500/5 p-2 text-[0.7rem]">
              <span class="text-emerald-400">✓ Chia wallet connected</span>
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
                  [disabled]="!firstAdminLeaf() || !chiaWasmReady()"
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
                  [disabled]="recoveringFirstAdmin()"
                  (click)="recoverFirstAdminFromWallet()"
                  title="Sign a probe with your connected EVM wallet, recover its pubkey, compute the canonical leaf hash, and pre-fill the textarea below as a single-admin (m_within=1) record."
                >
                  @if (recoveringFirstAdmin()) {
                    Recovering…
                  } @else {
                    Use my connected wallet as first admin
                  }
                </button>
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
                      <code>POPULIS_PROTOCOL_ADMIN_AUTHORITY_V2_LAUNCHER_ID</code>
                      = <span class="mono">{{ s.launcherId }}</span> in your
                      Populis API env to surface this singleton on
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
                          <code>POPULIS_ADMIN_PUBKEY_ALLOWLIST</code>.
                          Download the file below and set
                          <code>POPULIS_ADMIN_RECORDS_PATH</code> in your
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
                              <p class="text-[0.65rem] text-text-muted mt-2">
                                This check grants no admin access and does not
                                sign, broadcast, mint, or persist anything.
                              </p>
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

  // ─── Form state ────────────────────────────────────────────────────
  readonly parentCoinIdInput = signal('');
  readonly mipsRootHashInput = signal('');
  readonly adminRecordsInput = signal('');
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
  readonly connectingChia = signal<'goby' | 'sage' | null>(null);
  /** Last error from the inline connect flow.  Cleared on the next
   * attempt. */
  readonly chiaConnectError = signal<string | null>(null);

  // ─── Derived state ─────────────────────────────────────────────────
  readonly chiaWasmReady = computed(() => this.wasm.ready());
  readonly copyConfirmation = signal<string | null>(null);
  readonly submitState = signal<SubmitState>({ kind: 'idle' });
  readonly walletConnected = computed(() => this.chiaWallet.isConnected());
  readonly bootstrapStatus = signal<BootstrapStatusResponse | null>(null);
  readonly bootstrapStatusError = signal<string | null>(null);
  readonly checkingBootstrapStatus = signal(false);
  readonly launchAccessMode = computed<LaunchAccessMode>(() => {
    if (this.adminSession.isAuthenticated()) return 'permanent-admin';
    if (this.checkingBootstrapStatus()) return 'checking';
    const status = this.bootstrapStatus();
    if (status?.locked) return 'locked';
    if (status?.authenticated) return 'bootstrap';
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
          'Re-run populis_protocol/scripts/dump_v2_fixtures.py against ' +
          'the inputs section to verify hashes match.  Any drift = abort.',
      },
      null,
      2,
    );
  });

  constructor() {
    // Auto-clear the copy confirmation banner after a few seconds so
    // the UI doesn't stay in "copied!" state forever.
    effect((onCleanup) => {
      const msg = this.copyConfirmation();
      if (!msg) return;
      const t = setTimeout(() => this.copyConfirmation.set(null), 3000);
      onCleanup(() => clearTimeout(t));
    });
    if (!this.adminSession.isAuthenticated()) {
      void this.refreshBootstrapStatus();
    }
  }

  async refreshBootstrapStatus(): Promise<void> {
    if (this.adminSession.isAuthenticated() || this.checkingBootstrapStatus()) return;
    this.bootstrapStatusError.set(null);
    this.checkingBootstrapStatus.set(true);
    try {
      this.bootstrapStatus.set(await this.bootstrap.getBootstrapStatus());
    } catch (e) {
      this.bootstrapStatus.set(null);
      this.bootstrapStatusError.set(formatError(e));
    } finally {
      this.checkingBootstrapStatus.set(false);
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
    this.firstAdminError.set(null);
    this.recoveringFirstAdmin.set(true);
    try {
      const { pubkey, address } = await this.evmWallet.recoverFirstAdminPubkey();
      const network = environment.chiaNetwork;
      // Compute the leaf hash entirely in-browser via the
      // chia-wallet-sdk WASM (Eip712LeafHashService) — no API
      // round-trip.  Cross-verified against populis_protocol's
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
      this.firstAdminError.set(formatError(e));
    } finally {
      this.recoveringFirstAdmin.set(false);
    }
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
  async connectChia(kind: 'goby' | 'sage'): Promise<void> {
    if (this.connectingChia()) return;
    this.chiaConnectError.set(null);
    this.connectingChia.set(kind);
    try {
      if (kind === 'goby') {
        await this.chiaWallet.connectGoby();
      } else {
        await this.chiaWallet.connectSage();
      }
    } catch (e) {
      this.chiaConnectError.set(formatError(e));
    } finally {
      this.connectingChia.set(null);
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
   * first).  The button is gated on ``firstAdminLeaf() !== null``,
   * but we re-check defensively in case the signal cleared between
   * the click and the await.
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
   * ``populis_protocol/tests/test_admin_authority_v2.py:1530-1542``.
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
   * load on boot (``POPULIS_ADMIN_RECORDS_PATH``).  Schema matches
   * ``populis_api/admin_records.py``'s ``AdminRecordsConfig``.
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
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'admin_records.json';
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
    } catch (e) {
      this.finalizeState.set({ kind: 'error', message: formatError(e) });
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
    } catch (e) {
      this.recoveryVerifyState.set({ kind: 'error', message: formatError(e) });
    }
  }

  /**
   * Submit the launch on chain via the WASM-first flow:
   * 1. Compute eve_inner_puzzle_hash from current form state.
   * 2. Delegate to AdminAuthorityV2Service.submitLaunch which:
   *    a. Asks the connected wallet to fund the launcher coin.
   *    b. Combines wallet's signed funding spend with our launcher
   *       spend into one bundle.
   *    c. Pushes to coinset.org directly (no Populis API in path).
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
