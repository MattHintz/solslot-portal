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
import { ChiaWasmService } from '../../../services/chia-wasm.service';
import { ChiaWalletService } from '../../../services/chia-wallet.service';

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
          <h1 class="font-display text-4xl md:text-5xl">Launch authority v2.</h1>
          <p class="mt-2 text-sm text-text-muted max-w-prose">
            Preview every deterministic output of a v2 admin-authority genesis
            launch.  Computation runs entirely in WASM in your browser — no
            Populis API call is involved.
          </p>
        </div>
        <a routerLink="/admin" class="btn btn--ghost">← Admin desk</a>
      </header>

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

          <div class="mt-6 grid gap-4">
            <label class="block">
              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Funding coin id (the coin you're spending to create the launcher)
              </div>
              <input
                type="text"
                class="input mt-1 w-full mono text-xs"
                placeholder="0x… (32 bytes)"
                [(ngModel)]="parentCoinIdInput"
              />
            </label>

            <label class="block">
              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                MIPS root hash (sha256tree of the m_of_n quorum tree)
              </div>
              <input
                type="text"
                class="input mt-1 w-full mono text-xs"
                placeholder="0x… (32 bytes)"
                [(ngModel)]="mipsRootHashInput"
              />
              <p class="text-[0.6rem] text-text-muted mt-1">
                Computed off-chain via chia-wallet-sdk's
                <code>mOfNHash(config, m, [eip712MemberHash(...), ...])</code>.
                Bundled WASM 0.33 doesn't yet expose
                <code>eip712MemberHash</code> (pending PR #396); use the
                Python driver or wait for the next SDK release.
              </p>
            </label>

            <label class="block">
              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Admin records (one per line)
              </div>
              <textarea
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
            </label>

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
                  Connect Goby/Sage from the admin desk before submitting.
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
  private readonly chiaWallet = inject(ChiaWalletService);

  // ─── Form state ────────────────────────────────────────────────────
  readonly parentCoinIdInput = signal('');
  readonly mipsRootHashInput = signal('');
  readonly adminRecordsInput = signal('');
  readonly authorityVersionInput = signal(1);
  readonly eveAmountInput = signal(1);

  // ─── Derived state ─────────────────────────────────────────────────
  readonly chiaWasmReady = computed(() => this.wasm.ready());
  readonly copyConfirmation = signal<string | null>(null);
  readonly submitState = signal<SubmitState>({ kind: 'idle' });
  readonly walletConnected = computed(() => this.chiaWallet.isConnected());

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
        message: 'Wallet not connected.  Connect Goby or Sage from the admin desk first.',
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
