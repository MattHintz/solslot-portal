import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  AdminAuthorityV2Service,
  AdminRosterSpendPackagePreflight,
  bytesToHexPrefixed,
} from '../../../services/admin-authority-v2/admin-authority-v2.service';

@Component({
  selector: 'pp-roster-spend-package-review',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-12 pb-24">
      <header class="flex flex-wrap items-start justify-between gap-6">
        <div>
          <a routerLink="/admin" class="mono text-xs text-brand hover:underline">
            ← Admin desk
          </a>
          <div class="mono mt-5 text-[0.7rem] uppercase tracking-[0.25em] text-brand">
            Authority v2 · A.5 package review
          </div>
          <h1 class="font-display mt-2 text-4xl md:text-5xl">
            Review unsigned roster spend package.
          </h1>
          <p class="mt-3 max-w-3xl text-sm text-text-muted">
            Paste an exported A.5 unsigned roster-spend package, run local preflight checks,
            and review the signer-facing summary. This screen does not sign, build, broadcast,
            or call the backend.
          </p>
        </div>
        <a routerLink="/admin/authority-v2/add-admin-slot" class="btn btn--ghost">
          Export package
        </a>
      </header>

      <div class="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
        <div class="grid gap-4 content-start">
          <div class="card">
            <label class="mono text-xs uppercase tracking-[0.2em] text-text-muted" for="unsigned-package-json">
              Unsigned package JSON
            </label>
            <textarea
              id="unsigned-package-json"
              #packageTextArea
              class="mt-3 min-h-[28rem] w-full rounded-card border border-white/10 bg-black/30 p-4 mono text-xs text-text outline-none focus:border-brand"
              spellcheck="false"
              [value]="packageText()"
              (input)="setPackageText(packageTextArea.value)"
              placeholder="Paste admin_authority_v2_roster_update_unsigned_package JSON here"
            ></textarea>
            <div class="mt-4 flex flex-wrap gap-2">
              <button class="btn btn--ghost" type="button" (click)="clearPackageText()" [disabled]="!packageText()">
                Clear
              </button>
              <button class="btn btn--ghost" type="button" disabled>
                Build/sign roster spend unavailable
              </button>
            </div>
          </div>

          <div class="card">
            <div class="font-display text-lg">Signer input readiness + hash verification</div>
            <p class="mt-2 text-sm text-text-muted">
              Paste local spend-builder inputs for readiness and package-hash checks only. This
              screen still does not execute MIPS, construct spends, collect signatures, or broadcast.
            </p>

            <div class="mt-4 grid gap-3">
              <label class="grid gap-2 text-sm">
                <span class="text-text-muted">Current MIPS puzzle reveal</span>
                <textarea
                  #mipsPuzzleReveal
                  class="min-h-24 w-full rounded-card border border-white/10 bg-black/30 p-3 mono text-xs text-text outline-none focus:border-brand"
                  spellcheck="false"
                  [value]="currentMipsPuzzleReveal()"
                  (input)="setSignerInput('currentMipsPuzzleReveal', mipsPuzzleReveal.value)"
                  placeholder="Paste current MIPS puzzle reveal serialized CLVM hex"
                ></textarea>
              </label>

              <label class="grid gap-2 text-sm">
                <span class="text-text-muted">Current MIPS quorum solution</span>
                <textarea
                  #mipsQuorumSolution
                  class="min-h-24 w-full rounded-card border border-white/10 bg-black/30 p-3 mono text-xs text-text outline-none focus:border-brand"
                  spellcheck="false"
                  [value]="currentMipsQuorumSolution()"
                  (input)="setSignerInput('currentMipsQuorumSolution', mipsQuorumSolution.value)"
                  placeholder="Paste current MIPS quorum solution serialized CLVM hex"
                ></textarea>
              </label>

              <label class="grid gap-2 text-sm">
                <span class="text-text-muted">Current admin_authority_v2 inner puzzle reveal</span>
                <textarea
                  #authorityInnerPuzzleReveal
                  class="min-h-24 w-full rounded-card border border-white/10 bg-black/30 p-3 mono text-xs text-text outline-none focus:border-brand"
                  spellcheck="false"
                  [value]="currentAuthorityInnerPuzzleReveal()"
                  (input)="setSignerInput('currentAuthorityInnerPuzzleReveal', authorityInnerPuzzleReveal.value)"
                  placeholder="Paste current admin_authority_v2 inner puzzle reveal serialized CLVM hex"
                ></textarea>
              </label>

              <div class="grid gap-3 md:grid-cols-2">
                <label class="grid gap-2 text-sm">
                  <span class="text-text-muted">Live singleton parent coin id</span>
                  <input
                    #liveParentCoinId
                    class="w-full rounded-card border border-white/10 bg-black/30 p-3 mono text-xs text-text outline-none focus:border-brand"
                    [value]="liveSingletonParentCoinId()"
                    (input)="setSignerInput('liveSingletonParentCoinId', liveParentCoinId.value)"
                    placeholder="0x..."
                  />
                </label>
                <label class="grid gap-2 text-sm">
                  <span class="text-text-muted">Live singleton puzzle hash</span>
                  <input
                    #livePuzzleHash
                    class="w-full rounded-card border border-white/10 bg-black/30 p-3 mono text-xs text-text outline-none focus:border-brand"
                    [value]="liveSingletonPuzzleHash()"
                    (input)="setSignerInput('liveSingletonPuzzleHash', livePuzzleHash.value)"
                    placeholder="0x..."
                  />
                </label>
              </div>

              <label class="grid gap-2 text-sm">
                <span class="text-text-muted">Live singleton amount</span>
                <input
                  #liveAmount
                  class="w-full rounded-card border border-white/10 bg-black/30 p-3 mono text-xs text-text outline-none focus:border-brand"
                  inputmode="numeric"
                  [value]="liveSingletonAmount()"
                  (input)="setSignerInput('liveSingletonAmount', liveAmount.value)"
                  placeholder="1"
                />
              </label>
            </div>

            <div class="mt-4 rounded-card border border-white/10 bg-black/20 p-3 text-sm">
              @if (signerInputReadiness(); as r) {
                <div class="font-display" [class.text-brand]="r.ok" [class.text-yellow-100]="!r.ok">
                  Signer input readiness: {{ r.status }}
                </div>
                @if (r.failures.length) {
                  <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-yellow-100/80">
                    @for (failure of r.failures; track failure) {
                      <li>{{ failure }}</li>
                    }
                  </ul>
                } @else {
                  <p class="mt-2 text-xs text-text-muted">
                    Local signer inputs match package hashes for a future spend builder. Nothing is signed or broadcast here.
                  </p>
                }
              }
            </div>

            <div class="mt-4 rounded-card border border-white/10 bg-black/20 p-3 text-xs text-text-muted">
              Final wallet signature is a future step and is not accepted or stored on this screen.
            </div>
          </div>

          <div class="card">
            <div class="font-display text-lg">Local verification report</div>
            @if (localVerificationReportJson(); as report) {
              <p class="mt-2 text-sm text-text-muted">
                Hash-only report for handoff to a future spend builder. Raw reveals and solutions
                are omitted; nothing is signed, broadcast, or sent to a backend.
              </p>
              <textarea
                class="mt-3 min-h-72 w-full rounded-card border border-white/10 bg-black/30 p-4 mono text-xs text-text outline-none"
                readonly
                [value]="report"
              ></textarea>
            } @else {
              <p class="mt-2 text-sm text-text-muted">
                Available after the unsigned package preflight and local signer-input hash verification pass.
              </p>
            }
          </div>
        </div>

        <div class="grid gap-4 content-start">
          <div class="card">
            <div class="font-display text-lg">Local preflight</div>
            @if (!packageText().trim()) {
              <p class="mt-2 text-sm text-text-muted">
                Paste a package to run local checks.
              </p>
            } @else {
              @if (parseError(); as err) {
                <div class="mt-3 rounded-card border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                  {{ err }}
                </div>
              } @else {
                @if (preflight(); as p) {
                  <div class="mt-3 rounded-card border border-white/10 bg-black/20 p-3 text-sm">
                    <div class="font-display" [class.text-brand]="p.ok" [class.text-red-200]="!p.ok">
                      Unsigned package preflight: {{ p.status }}
                    </div>
                    @if (p.failures.length) {
                      <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-red-200">
                        @for (failure of p.failures; track failure) {
                          <li>{{ failure }}</li>
                        }
                      </ul>
                    } @else {
                      <p class="mt-2 text-xs text-text-muted">
                        Local package contract, hash, append-only roster, and secret-leak checks pass.
                      </p>
                    }
                  </div>
                }
              }
            }
          </div>

          <div class="card">
            <div class="font-display text-lg">Signer-facing summary</div>
            @if (summary(); as s) {
              <dl class="mt-4 grid gap-3 text-sm">
                <div>
                  <dt class="text-text-muted">kind</dt>
                  <dd class="mono break-all text-brand">{{ s.kind }}</dd>
                </div>
                <div>
                  <dt class="text-text-muted">network</dt>
                  <dd class="mono break-all text-brand">{{ s.network }}</dd>
                </div>
                <div>
                  <dt class="text-text-muted">launcher_id</dt>
                  <dd class="mono break-all text-brand">{{ s.launcherId }}</dd>
                </div>
                <div class="grid gap-3 md:grid-cols-2">
                  <div>
                    <dt class="text-text-muted">current authority_version</dt>
                    <dd class="mono break-all text-brand">{{ s.currentAuthorityVersion }}</dd>
                  </div>
                  <div>
                    <dt class="text-text-muted">new authority_version</dt>
                    <dd class="mono break-all text-brand">{{ s.newAuthorityVersion }}</dd>
                  </div>
                </div>
                <div>
                  <dt class="text-text-muted">current_state_hash</dt>
                  <dd class="mono break-all text-brand">{{ s.currentStateHash }}</dd>
                </div>
                <div>
                  <dt class="text-text-muted">new_state_hash</dt>
                  <dd class="mono break-all text-brand">{{ s.newStateHash }}</dd>
                </div>
                <div>
                  <dt class="text-text-muted">roster_update_binding_hash</dt>
                  <dd class="mono break-all text-brand">{{ s.rosterUpdateBindingHash }}</dd>
                </div>
                <div class="grid gap-3 md:grid-cols-2">
                  <div>
                    <dt class="text-text-muted">new admin slot</dt>
                    <dd class="mono break-all text-brand">{{ s.newAdminSlotIndex }}</dd>
                  </div>
                  <div>
                    <dt class="text-text-muted">live singleton source</dt>
                    <dd class="mono break-all text-brand">{{ s.liveSingletonSource }}</dd>
                  </div>
                </div>
                <div>
                  <dt class="text-text-muted">API cross-check attachment</dt>
                  <dd class="mono break-all text-brand">{{ s.apiCrossCheckStatus }}</dd>
                </div>
              </dl>
              <div class="mt-4 rounded-card border border-white/10 bg-black/20 p-3">
                <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                  Required local signer inputs
                </div>
                @if (s.requiredInputs.length) {
                  <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-yellow-100/80">
                    @for (item of s.requiredInputs; track item) {
                      <li>{{ item }}</li>
                    }
                  </ul>
                } @else {
                  <p class="mt-2 text-xs text-text-muted">not listed</p>
                }
              </div>
            } @else {
              <p class="mt-2 text-sm text-text-muted">
                No parseable package loaded yet.
              </p>
            }
          </div>
        </div>
      </div>
    </section>
  `,
})
export class RosterSpendPackageReviewComponent {
  private readonly v2 = inject(AdminAuthorityV2Service);

  readonly packageText = signal('');
  readonly currentMipsPuzzleReveal = signal('');
  readonly currentMipsQuorumSolution = signal('');
  readonly currentAuthorityInnerPuzzleReveal = signal('');
  readonly liveSingletonParentCoinId = signal('');
  readonly liveSingletonPuzzleHash = signal('');
  readonly liveSingletonAmount = signal('');

  readonly parseError = computed(() => {
    const text = this.packageText().trim();
    if (!text) return null;
    try {
      JSON.parse(text) as unknown;
      return null;
    } catch (e) {
      return `Invalid JSON: ${errorMessage(e)}`;
    }
  });

  readonly parsedPackage = computed<unknown | null>(() => {
    const text = this.packageText().trim();
    if (!text || this.parseError()) return null;
    return JSON.parse(text) as unknown;
  });

  readonly preflight = computed<AdminRosterSpendPackagePreflight | null>(() => {
    const pkg = this.parsedPackage();
    if (!pkg) return null;
    return this.v2.validateUnsignedRosterSpendPackage(pkg);
  });

  readonly summary = computed<ReviewSummary | null>(() => {
    const pkg = this.parsedPackage();
    return pkg ? summarizePackage(pkg) : null;
  });

  readonly signerInputReadiness = computed<SignerInputReadiness>(() => {
    const failures: string[] = [];
    let hashCheckFailed = false;
    const preflight = this.preflight();
    if (!preflight) {
      failures.push('unsigned package must be pasted and pass local preflight');
    } else if (!preflight.ok) {
      failures.push('unsigned package preflight must pass before signer inputs are ready');
    }
    const pkg = this.parsedPackage();
    const root = asRecord(pkg);
    const current = root ? asRecord(root['current']) : null;
    const liveSingleton = root ? asRecord(root['live_singleton']) : null;
    const selectedCoin = liveSingleton ? asRecord(liveSingleton['selected_coin']) : null;
    const launcherId = root ? stringValue(root['launcher_id']) : null;
    const currentMipsRootHash = current ? stringValue(current['mips_root_hash']) : null;
    const currentAdminsHash = current ? stringValue(current['admins_hash']) : null;
    const currentPendingOpsHash = current ? stringValue(current['pending_ops_hash']) : null;
    const currentAuthorityVersion = current ? numberValue(current['authority_version']) : null;
    if (isBlank(this.currentMipsPuzzleReveal())) {
      failures.push('current MIPS puzzle reveal is required');
    } else if (currentMipsRootHash) {
      hashCheckFailed = !this.compareSerializedProgramHash(
        this.currentMipsPuzzleReveal(),
        currentMipsRootHash,
        'current MIPS puzzle reveal tree hash must match current.mips_root_hash',
        failures,
      ) || hashCheckFailed;
    }
    if (isBlank(this.currentMipsQuorumSolution())) {
      failures.push('current MIPS quorum solution is required');
    } else {
      hashCheckFailed = !this.verifySerializedProgram(
        this.currentMipsQuorumSolution(),
        'current MIPS quorum solution must be serialized CLVM hex',
        failures,
      ) || hashCheckFailed;
    }
    if (isBlank(this.currentAuthorityInnerPuzzleReveal())) {
      failures.push('current admin_authority_v2 inner puzzle reveal is required');
    } else if (
      launcherId &&
      currentMipsRootHash &&
      currentAdminsHash &&
      currentPendingOpsHash &&
      currentAuthorityVersion !== null
    ) {
      try {
        const actualInnerPuzzleHash = this.v2.computeSerializedProgramTreeHash(this.currentAuthorityInnerPuzzleReveal());
        const expectedInnerPuzzleHash = bytesToHexPrefixed(
          this.v2.makeInnerPuzzleHash({
            mipsRootHash: currentMipsRootHash,
            adminsHash: currentAdminsHash,
            pendingOpsHash: currentPendingOpsHash,
            authorityVersion: currentAuthorityVersion,
          }),
        );
        if (!sameHex(actualInnerPuzzleHash, expectedInnerPuzzleHash)) {
          failures.push('current admin_authority_v2 inner puzzle reveal tree hash must match computed current inner puzzle hash');
          hashCheckFailed = true;
        }
        if (isHex32(this.liveSingletonPuzzleHash())) {
          const expectedFullPuzzleHash = bytesToHexPrefixed(
            this.v2.singletonFullPuzzleHash(launcherId, actualInnerPuzzleHash),
          );
          if (!sameHex(this.liveSingletonPuzzleHash(), expectedFullPuzzleHash)) {
            failures.push('live singleton puzzle hash must match singleton wrapper for launcher_id and current inner puzzle reveal');
            hashCheckFailed = true;
          }
        }
      } catch (e) {
        failures.push(`current admin_authority_v2 inner puzzle reveal hash verification failed: ${errorMessage(e)}`);
        hashCheckFailed = true;
      }
    }
    if (!isHex32(this.liveSingletonParentCoinId())) {
      failures.push('live singleton parent coin id must be a 0x-prefixed 32-byte hex string');
    } else if (selectedCoin && stringValue(selectedCoin['parent_coin_info']) && !sameHex(
      this.liveSingletonParentCoinId(),
      stringValue(selectedCoin['parent_coin_info']) ?? '',
    )) {
      failures.push('live singleton parent coin id must match package live_singleton.selected_coin.parent_coin_info');
      hashCheckFailed = true;
    }
    if (!isHex32(this.liveSingletonPuzzleHash())) {
      failures.push('live singleton puzzle hash must be a 0x-prefixed 32-byte hex string');
    } else if (selectedCoin && stringValue(selectedCoin['puzzle_hash']) && !sameHex(
      this.liveSingletonPuzzleHash(),
      stringValue(selectedCoin['puzzle_hash']) ?? '',
    )) {
      failures.push('live singleton puzzle hash must match package live_singleton.selected_coin.puzzle_hash');
      hashCheckFailed = true;
    }
    const amount = this.liveSingletonAmount().trim();
    if (!amount) {
      failures.push('live singleton amount is required');
    } else if (amount !== '1') {
      failures.push('live singleton amount must equal 1');
    } else if (selectedCoin && numberValue(selectedCoin['amount']) !== null && Number(amount) !== numberValue(selectedCoin['amount'])) {
      failures.push('live singleton amount must match package live_singleton.selected_coin.amount');
      hashCheckFailed = true;
    }
    return signerInputReadinessResult(failures, hashCheckFailed);
  });

  readonly localVerificationReportJson = computed<string | null>(() => {
    const pkg = this.parsedPackage();
    const preflight = this.preflight();
    const readiness = this.signerInputReadiness();
    if (!pkg || !preflight?.ok || !readiness.ok) return null;
    const root = asRecord(pkg);
    if (!root) return null;
    const current = asRecord(root['current']);
    const update = asRecord(root['update']);
    const spendIntent = asRecord(root['spend_intent']);
    const liveSingleton = asRecord(root['live_singleton']);
    const selectedCoin = liveSingleton ? asRecord(liveSingleton['selected_coin']) : null;
    const launcherId = stringValue(root['launcher_id']);
    try {
      const currentMipsPuzzleRevealTreeHash = this.v2.computeSerializedProgramTreeHash(this.currentMipsPuzzleReveal());
      const currentMipsQuorumSolutionTreeHash = this.v2.computeSerializedProgramTreeHash(this.currentMipsQuorumSolution());
      const currentAuthorityInnerPuzzleRevealTreeHash = this.v2.computeSerializedProgramTreeHash(
        this.currentAuthorityInnerPuzzleReveal(),
      );
      const computedSingletonFullPuzzleHash = launcherId
        ? bytesToHexPrefixed(this.v2.singletonFullPuzzleHash(launcherId, currentAuthorityInnerPuzzleRevealTreeHash))
        : null;
      return JSON.stringify(
        {
          version: 1,
          kind: 'admin_authority_v2_roster_update_local_verification_report',
          validation_scope: 'local_hash_verification_report_no_spend_execution',
          result: 'locally_verified_for_future_spend_builder',
          package: {
            kind: stringValue(root['kind']),
            network: stringValue(root['network']),
            launcher_id: launcherId,
            spend_tag: numberValue(spendIntent?.['spend_tag']),
            spend_name: stringValue(spendIntent?.['spend_name']),
            current_authority_version: numberValue(current?.['authority_version']),
            new_authority_version: numberValue(update?.['new_authority_version']),
            current_state_hash: stringValue(spendIntent?.['current_state_hash'] ?? current?.['state_hash']),
            new_state_hash: stringValue(spendIntent?.['new_state_hash'] ?? update?.['new_state_hash']),
            roster_update_binding_hash: stringValue(
              spendIntent?.['roster_update_binding_hash'] ?? update?.['roster_update_binding_hash'],
            ),
          },
          signer_input_commitments: {
            current_mips_puzzle_reveal_tree_hash: currentMipsPuzzleRevealTreeHash,
            current_mips_quorum_solution_tree_hash: currentMipsQuorumSolutionTreeHash,
            current_admin_authority_v2_inner_puzzle_reveal_tree_hash: currentAuthorityInnerPuzzleRevealTreeHash,
            computed_singleton_full_puzzle_hash: computedSingletonFullPuzzleHash,
            live_singleton_parent_coin_id: this.liveSingletonParentCoinId().trim(),
            live_singleton_puzzle_hash: this.liveSingletonPuzzleHash().trim(),
            live_singleton_amount: Number(this.liveSingletonAmount().trim()),
            package_selected_coin_id: selectedCoin ? stringValue(selectedCoin['coin_id']) : null,
          },
          omitted_inputs: [
            'raw_current_mips_puzzle_reveal',
            'raw_current_mips_quorum_solution',
            'raw_current_admin_authority_v2_inner_puzzle_reveal',
            'wallet_finalization_material',
            'api_credentials',
          ],
          local_only_boundaries: [
            'mips_not_executed',
            'clvm_spends_not_constructed',
            'transaction_not_signed',
            'transaction_not_broadcast',
            'backend_not_called',
          ],
        },
        null,
        2,
      );
    } catch {
      return null;
    }
  });

  setPackageText(value: string): void {
    this.packageText.set(value);
  }

  clearPackageText(): void {
    this.packageText.set('');
  }

  setSignerInput(name: SignerInputName, value: string): void {
    switch (name) {
      case 'currentMipsPuzzleReveal':
        this.currentMipsPuzzleReveal.set(value);
        break;
      case 'currentMipsQuorumSolution':
        this.currentMipsQuorumSolution.set(value);
        break;
      case 'currentAuthorityInnerPuzzleReveal':
        this.currentAuthorityInnerPuzzleReveal.set(value);
        break;
      case 'liveSingletonParentCoinId':
        this.liveSingletonParentCoinId.set(value);
        break;
      case 'liveSingletonPuzzleHash':
        this.liveSingletonPuzzleHash.set(value);
        break;
      case 'liveSingletonAmount':
        this.liveSingletonAmount.set(value);
        break;
    }
  }

  private compareSerializedProgramHash(
    programHex: string,
    expectedHash: string,
    message: string,
    failures: string[],
  ): boolean {
    try {
      const actualHash = this.v2.computeSerializedProgramTreeHash(programHex);
      if (!sameHex(actualHash, expectedHash)) {
        failures.push(message);
        return false;
      }
      return true;
    } catch (e) {
      failures.push(`${message}: ${errorMessage(e)}`);
      return false;
    }
  }

  private verifySerializedProgram(
    programHex: string,
    message: string,
    failures: string[],
  ): boolean {
    try {
      this.v2.computeSerializedProgramTreeHash(programHex);
      return true;
    } catch (e) {
      failures.push(`${message}: ${errorMessage(e)}`);
      return false;
    }
  }
}

type SignerInputName =
  | 'currentMipsPuzzleReveal'
  | 'currentMipsQuorumSolution'
  | 'currentAuthorityInnerPuzzleReveal'
  | 'liveSingletonParentCoinId'
  | 'liveSingletonPuzzleHash'
  | 'liveSingletonAmount';

type SignerInputReadiness = {
  ok: boolean;
  status: string;
  failures: string[];
};

type ReviewSummary = {
  kind: string;
  network: string;
  launcherId: string;
  currentAuthorityVersion: string;
  newAuthorityVersion: string;
  currentStateHash: string;
  newStateHash: string;
  rosterUpdateBindingHash: string;
  newAdminSlotIndex: string;
  liveSingletonSource: string;
  apiCrossCheckStatus: string;
  requiredInputs: string[];
};

function summarizePackage(pkg: unknown): ReviewSummary | null {
  const root = asRecord(pkg);
  if (!root) return null;
  const current = asRecord(root['current']);
  const update = asRecord(root['update']);
  const spendIntent = asRecord(root['spend_intent']);
  const liveSingleton = asRecord(root['live_singleton']);
  const optionalAttachments = asRecord(root['optional_attachments']);
  const newAdminRecord = update ? asRecord(update['new_admin_record']) : null;
  const requiredInputs = Array.isArray(root['required_local_signer_inputs'])
    ? root['required_local_signer_inputs'].filter((item): item is string => typeof item === 'string')
    : [];

  return {
    kind: displayValue(root['kind']),
    network: displayValue(root['network']),
    launcherId: displayValue(root['launcher_id']),
    currentAuthorityVersion: displayValue(current?.['authority_version']),
    newAuthorityVersion: displayValue(update?.['new_authority_version']),
    currentStateHash: displayValue(spendIntent?.['current_state_hash'] ?? current?.['state_hash']),
    newStateHash: displayValue(spendIntent?.['new_state_hash'] ?? update?.['new_state_hash']),
    rosterUpdateBindingHash: displayValue(spendIntent?.['roster_update_binding_hash'] ?? update?.['roster_update_binding_hash']),
    newAdminSlotIndex: displayValue(newAdminRecord?.['admin_idx']),
    liveSingletonSource: displayValue(liveSingleton?.['source']),
    apiCrossCheckStatus: displayValue(optionalAttachments?.['api_cross_check_status']),
    requiredInputs,
  };
}

function signerInputReadinessResult(failures: string[], hashCheckFailed = false): SignerInputReadiness {
  return {
    ok: failures.length === 0,
    status: failures.length === 0
      ? 'locally verified for future spend builder'
      : hashCheckFailed ? 'fails local hash checks' : 'incomplete',
    failures,
  };
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function isHex32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

function sameHex(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value || 'not present';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'not present';
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
