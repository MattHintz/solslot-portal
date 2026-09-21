import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { computeAddress } from 'ethers';

import {
  AdminChiaRecoveryActionPackage,
  AdminRecoveryGuardianActionPackage,
  createAdminChiaRecoveryActionPackage,
  createAdminRecoveryGuardianActionPackage,
  parseAdminChiaRecoveryActionResult,
  parseAdminRecoveryGuardianActionResult,
} from '../../../services/admin-recovery-handoff';
import {
  AdminRecoveryCase,
  AdminSecurityService,
  AdminSecurityStatus,
  ChiaActionPackage,
  ChiaSigningAction,
  EvmRecoveryAction,
  EvmSafeActionPackage,
  EvmSafeApproval,
} from '../../../services/admin-security.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { formatError } from '../../../utils/format-error';

type WalletMode = 'injected' | 'walletconnect';
type ChiaPhase = 'PREPARE' | 'CANCEL' | 'COMPLETE';

@Component({
  selector: 'solslot-admin-recovery-case-actions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="case-workspace" aria-labelledby="case-workspace-title">
      <header class="case-header">
        <div>
          <span class="eyebrow">Protected key change</span>
          <h2 id="case-workspace-title">{{ caseTitle }}</h2>
          <p>{{ caseHelp }}</p>
        </div>
        <span [class]="stateClass">{{ stateLabel(recovery.state) }}</span>
      </header>

      @if (error(); as detail) {
        <div class="notice notice--error" role="alert">
          <strong>Action stopped</strong>
          <span>{{ detail }}</span>
        </div>
      }
      @if (message(); as detail) {
        <div class="notice" role="status">
          <strong>Protected change update</strong>
          <span>{{ detail }}</span>
        </div>
      }

      <div class="case-summary">
        <div>
          <span>Administrator</span>
          <strong>Slot {{ recovery.slot + 1 }}</strong>
        </div>
        <div>
          <span>Funds moved</span>
          <strong>None</strong>
        </div>
        <div>
          <span>Safety delay</span>
          <strong>{{ countdown(recovery.executeAfter) }}</strong>
        </div>
        <div>
          <span>Final authority</span>
          <strong>Owner plus one</strong>
        </div>
      </div>

      <ol class="progress" aria-label="Protected key-change progress">
        <li [class.is-complete]="hasReceipt('EVM', 'PREPARE')">
          <span>1</span>
          <div><strong>Request opened</strong><small>{{ baseNetworkLabel }}</small></div>
        </li>
        <li [class.is-complete]="hasReceipt('CHIA', 'PREPARE')">
          <span>2</span>
          <div><strong>Chia lock</strong><small>Testnet11</small></div>
        </li>
        <li [class.is-complete]="recovery.approvalsComplete">
          <span>3</span>
          <div><strong>Team approval</strong><small>Exact replacement</small></div>
        </li>
        <li [class.is-complete]="recovery.delayComplete">
          <span>4</span>
          <div><strong>Safety delay</strong><small>Old-key veto</small></div>
        </li>
        <li [class.is-complete]="recovery.state === 'COMPLETED'">
          <span>5</span>
          <div><strong>Both chains match</strong><small>Access restored</small></div>
        </li>
      </ol>

      @if (recovery.state !== 'COMPLETED' && recovery.state !== 'CANCELLED') {
        @if (needsCoadminChoice) {
          <label class="coadmin-choice">
            Coadministrator for owner approval
            <select [(ngModel)]="coadminSlot" (ngModelChange)="clearPreparedPackages()">
              <option [ngValue]="1">Administrator 2</option>
              <option [ngValue]="2">Administrator 3</option>
            </select>
            <small>
              This choice locks the action to the owner and the selected coadministrator.
            </small>
          </label>
        }

        <section class="task-panel" aria-labelledby="team-actions-title">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Team checklist</span>
              <h3 id="team-actions-title">Complete the required steps</h3>
            </div>
            <button type="button" class="quiet-button" [disabled]="busy()" (click)="refreshCase()">
              Refresh
            </button>
          </div>

          <div class="task-list">
            @if (nextChiaPhase(); as phase) {
              <article>
                <span class="network-mark network-mark--chia">XCH</span>
                <div>
                  <strong>{{ chiaPhaseTitle(phase) }}</strong>
                  <small>{{ chiaPhaseHelp(phase) }}</small>
                </div>
                <button type="button" [disabled]="busy()" (click)="reviewChiaPhase(phase)">
                  Review
                </button>
              </article>
            } @else if (hasReceipt('CHIA', 'COMPLETE')) {
              <article class="is-done">
                <span class="network-mark network-mark--chia">XCH</span>
                <div>
                  <strong>Testnet11 change confirmed</strong>
                  <small>The exact Chia identity transition is recorded.</small>
                </div>
                <span class="done-mark">Done</span>
              </article>
            }

            @for (action of positiveEvmActions(); track action.actionId) {
              <article>
                <span class="network-mark">BASE</span>
                <div>
                  <strong>{{ action.title }}</strong>
                  <small>{{ actionHelp(action) }}</small>
                </div>
                @if (pendingSubmissionFor(action); as pending) {
                  <button type="button" [disabled]="busy()" (click)="observeEvm(pending)">
                    Check confirmation
                  </button>
                } @else {
                  <button type="button" [disabled]="busy()" (click)="reviewEvmAction(action)">
                    Review
                  </button>
                }
              </article>
            }

            @if (positiveEvmActions().length === 0 && recovery.approvalsComplete) {
              <article class="is-done">
                <span class="network-mark">BASE</span>
                <div>
                  <strong>Required Base approvals recorded</strong>
                  <small>The exact replacement and team authority are bound on-chain.</small>
                </div>
                <span class="done-mark">Done</span>
              </article>
            }
          </div>
        </section>

        @if (selectedEvmAction(); as action) {
          <section class="decision-receipt" aria-labelledby="evm-receipt-title">
            <header>
              <div>
                <span class="eyebrow">Decision receipt</span>
                <h3 id="evm-receipt-title">{{ action.title }}</h3>
              </div>
              <button
                type="button"
                class="close-button"
                aria-label="Close action review"
                (click)="closeActionReview()"
              >
                &times;
              </button>
            </header>
            <dl>
              <div><dt>Network</dt><dd>{{ baseNetworkLabel }}</dd></div>
              <div><dt>Funds moved</dt><dd>None</dd></div>
              <div><dt>Authority effect</dt><dd>{{ authorityEffect(action) }}</dd></div>
              <div><dt>Required signer</dt><dd>{{ signerLabel(action) }}</dd></div>
              <div><dt>Reversible</dt><dd>{{ isCancellation(action) ? 'This cancels the change' : 'Yes, during the safety delay' }}</dd></div>
              <div><dt>Expires</dt><dd>{{ formatTime(recovery.expiresAt) }}</dd></div>
            </dl>

            @if (safePackage(); as safe) {
              <div class="approval-list" aria-label="Safe approval status">
                @for (approval of safe.approvals; track approval.slot) {
                  <div>
                    <span [class]="approval.signed ? 'approval-dot is-signed' : 'approval-dot'"></span>
                    <div>
                      <strong>{{ approvalLabel(approval) }}</strong>
                      <small>{{ approval.signed ? 'Signed' : 'Waiting for exact wallet' }}</small>
                    </div>
                  </div>
                }
              </div>
            }

            @if (offlineGuardianPackage(); as offline) {
              <div class="offline-step">
                <strong>Sign with the recovery kit on a trusted second device</strong>
                <p>
                  Copy the public package, sign it on the standalone recovery page, and paste
                  back only its public result.
                </p>
                <div class="button-row">
                  <a routerLink="/recover-admin-access" target="_blank" rel="noopener">
                    Open recovery page
                  </a>
                  <button type="button" class="secondary-button" (click)="copyGuardianPackage(offline)">
                    Copy package
                  </button>
                </div>
                <label>
                  Signed result
                  <textarea
                    [(ngModel)]="offlineResultText"
                    rows="5"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="Paste the public signed result"
                  ></textarea>
                </label>
              </div>
            }

            <label class="check-row">
              <input type="checkbox" [(ngModel)]="evmReceiptConfirmed" />
              <span>
                I checked the network, signer, exact administrator change, safety delay, and
                zero-funds effect.
              </span>
            </label>

            <div class="button-row button-row--end">
              @if (action.execution === 'SAFE') {
                @if (mySafeApproval(); as approval) {
                  @if (!approval.signed) {
                    <button
                      type="button"
                      class="secondary-button"
                      [disabled]="busy() || !evmReceiptConfirmed"
                      (click)="signSafeApproval('injected')"
                    >
                      Sign with browser wallet
                    </button>
                    <button
                      type="button"
                      class="primary-button"
                      [disabled]="busy() || !evmReceiptConfirmed"
                      (click)="signSafeApproval('walletconnect')"
                    >
                      Sign with mobile or hardware
                    </button>
                  }
                } @else {
                  <span class="waiting-copy">This approval is assigned to another administrator.</span>
                }
                @if (safePackage()?.readyToBroadcast) {
                  <button
                    type="button"
                    class="primary-button"
                    [disabled]="busy() || !evmReceiptConfirmed"
                    (click)="broadcastSafe('injected')"
                  >
                    Submit approved action
                  </button>
                }
              } @else if (action.execution === 'OFFLINE_RELAY') {
                <button
                  type="button"
                  class="primary-button"
                  [disabled]="busy() || !evmReceiptConfirmed || !offlineResultText.trim()"
                  (click)="relayGuardianAction('injected')"
                >
                  Submit signed action
                </button>
              } @else {
                <button
                  type="button"
                  class="secondary-button"
                  [disabled]="busy() || !evmReceiptConfirmed"
                  (click)="broadcastDirect(action, 'injected')"
                >
                  Use browser wallet
                </button>
                <button
                  type="button"
                  class="primary-button"
                  [disabled]="busy() || !evmReceiptConfirmed"
                  (click)="broadcastDirect(action, 'walletconnect')"
                >
                  Use mobile or hardware
                </button>
              }
            </div>

            @if (pendingEvmTransaction(); as pending) {
              <div class="pending-confirmation">
                <strong>Transaction sent</strong>
                <span>Waiting for the required Base confirmations.</span>
                <button type="button" [disabled]="busy()" (click)="observeEvm(pending)">
                  Check confirmation
                </button>
              </div>
            }

            <details>
              <summary>Advanced evidence</summary>
              <code>{{ recovery.intentHash }}</code>
              <code>{{ action.to }}</code>
              @if (safePackage(); as safe) {
                <code>{{ safe.packageHash }}</code>
                <code>{{ safe.transactionHash }}</code>
              }
            </details>
          </section>
        }

        @if (chiaPackage(); as chia) {
          <section class="decision-receipt" aria-labelledby="chia-receipt-title">
            <header>
              <div>
                <span class="eyebrow">Decision receipt</span>
                <h3 id="chia-receipt-title">{{ chia.clearSigning.title }}</h3>
              </div>
              <button
                type="button"
                class="close-button"
                aria-label="Close Testnet11 review"
                (click)="closeActionReview()"
              >
                &times;
              </button>
            </header>
            <dl>
              <div><dt>Network</dt><dd>Testnet11</dd></div>
              <div><dt>Funds moved</dt><dd>None</dd></div>
              <div><dt>Approval rule</dt><dd>{{ chia.clearSigning.authorityRule }}</dd></div>
              <div><dt>Replacement</dt><dd>{{ short(chia.clearSigning.replacement) }}</dd></div>
              <div><dt>Safety delay</dt><dd>{{ chia.delayComplete ? 'Complete' : countdown(chia.executeAfter) }}</dd></div>
              <div><dt>Operations</dt><dd>Paused until both chains match</dd></div>
            </dl>

            @if (chia.actions.length) {
              <div class="chia-actions">
                @for (action of chia.actions; track action.actionId) {
                  <article [class.is-signed]="action.signed">
                    <div>
                      <strong>{{ action.title }}</strong>
                      <small>{{ action.signed ? 'Signature recorded' : action.summary }}</small>
                    </div>
                    @if (action.signed) {
                      <span class="done-mark">Signed</span>
                    } @else if (action.signerKind === 'BLS_RECOVERY') {
                      <span class="waiting-copy">
                        Chia recovery signing is unavailable while transaction
                        verification is completed. Keep your recovery phrase offline.
                        This case cannot finish until this step is supported.
                      </span>
                    } @else if (canSignChiaAction(action)) {
                      <div class="compact-buttons">
                        <button type="button" (click)="signChiaAction(action, 'injected')">
                          Browser
                        </button>
                        <button type="button" (click)="signChiaAction(action, 'walletconnect')">
                          Mobile
                        </button>
                      </div>
                    } @else {
                      <span class="waiting-copy">Administrator {{ action.signerSlot + 1 }}</span>
                    }
                  </article>
                }
              </div>
            }

            @if (offlineChiaPackage(); as offline) {
              <div class="offline-step">
                <strong>Authorize with the offline recovery kit</strong>
                <p>
                  The second device verifies every restricted BLS message before signing.
                </p>
                <div class="button-row">
                  <a routerLink="/recover-admin-access" target="_blank" rel="noopener">
                    Open recovery page
                  </a>
                  <button type="button" class="secondary-button" (click)="copyChiaPackage(offline)">
                    Copy package
                  </button>
                </div>
                <label>
                  Signed Testnet11 result
                  <textarea
                    [(ngModel)]="offlineChiaResultText"
                    rows="5"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="Paste the public signed result"
                  ></textarea>
                </label>
                <button
                  type="button"
                  class="primary-button"
                  [disabled]="busy() || !offlineChiaResultText.trim()"
                  (click)="submitOfflineChiaResult(offline)"
                >
                  Verify signed result
                </button>
              </div>
            }

            <label class="check-row">
              <input type="checkbox" [(ngModel)]="chiaReceiptConfirmed" />
              <span>
                I checked the Testnet11 action, exact replacement, approval rule, and
                zero-funds effect.
              </span>
            </label>
            <div class="button-row button-row--end">
              @if (chia.readyToSubmit) {
                <button
                  type="button"
                  class="primary-button"
                  [disabled]="busy() || !chiaReceiptConfirmed"
                  (click)="submitChia(chia)"
                >
                  {{ chia.phase === 'COMPLETE' ? 'Finish Testnet11 change' : chia.phase === 'CANCEL' ? 'Submit cancellation' : 'Start Testnet11 safety lock' }}
                </button>
              } @else {
                <span class="waiting-copy">
                  {{
                    chia.phase === 'COMPLETE' && !chia.delayComplete
                      ? 'Waiting for the safety delay.'
                      : 'Waiting for the required signatures.'
                  }}
                </span>
              }
              @if (recovery.chiaTransactionId) {
                <button type="button" class="secondary-button" [disabled]="busy()" (click)="observeChia()">
                  Check Testnet11 confirmation
                </button>
              }
            </div>
            <details>
              <summary>Advanced evidence</summary>
              <code>{{ chia.intentHash }}</code>
              <code>{{ chia.authorityCoinId }}</code>
              @if (chia.spendBundleId) {
                <code>{{ chia.spendBundleId }}</code>
              }
            </details>
          </section>
        }

        <details class="cancel-zone">
          <summary>Cancel this protected change</summary>
          <div>
            <strong>Cancellation restores the current administrator identity.</strong>
            <p>
              It cannot choose another wallet or move funds. Chia and Base must both
              record the same cancellation before operations resume.
            </p>
            <div class="cancel-actions">
              @if (canCancelChia()) {
                <button type="button" [disabled]="busy()" (click)="reviewChiaPhase('CANCEL')">
                  Review Testnet11 cancellation
                </button>
              }
              @for (action of cancellationEvmActions(); track action.actionId) {
                @if (pendingSubmissionFor(action); as pending) {
                  <button type="button" [disabled]="busy()" (click)="observeEvm(pending)">
                    Check cancellation confirmation
                  </button>
                } @else {
                  <button type="button" [disabled]="busy()" (click)="reviewEvmAction(action)">
                    {{ action.title }}
                  </button>
                }
              }
            </div>
          </div>
        </details>
      } @else {
        <section class="terminal-state">
          <strong>
            {{ recovery.state === 'COMPLETED' ? 'Protected change completed' : 'Protected change canceled' }}
          </strong>
          <span>
            {{
              recovery.state === 'COMPLETED'
                ? 'Chia and Base now agree on the administrator identity.'
                : 'The prior administrator identity remains in force.'
            }}
          </span>
        </section>
      }

      <details class="case-evidence">
        <summary>Advanced case evidence</summary>
        <code>{{ recovery.intentHash }}</code>
        <code>{{ recovery.caseId }}</code>
      </details>
    </section>
  `,
  styles: [
    `
      :host { display:block; }
      .case-workspace { margin-top:20px; border:1px solid #315f51; background:#081914; color:#edf8f3; }
      .case-header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; padding:20px; border-bottom:1px solid #244b3f; }
      .case-header h2,.section-heading h3,.decision-receipt h3 { margin:4px 0 0; letter-spacing:0; }
      .case-header p { max-width:720px; margin:7px 0 0; color:#a9bfb6; font-size:13px; line-height:1.5; }
      .eyebrow { color:#6ee5b1; font:700 10px/1.2 var(--font-mono); text-transform:uppercase; }
      .state { display:inline-flex; padding:6px 9px; border:1px solid #487c69; color:#bfe8d8; font:700 10px var(--font-mono); text-transform:uppercase; white-space:nowrap; }
      .state--attention { border-color:#ae8b38; color:#f2d57e; }
      .state--healthy { border-color:#42836a; color:#78e7b4; }
      .notice { display:grid; gap:4px; margin:14px 20px 0; padding:12px 14px; border-left:3px solid #57c895; background:#0e2a21; }
      .notice span { color:#b8ccc4; font-size:12px; }
      .notice--error { border-color:#c46a64; background:#2b1515; color:#ffc2b9; }
      .case-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-bottom:1px solid #244b3f; }
      .case-summary div { display:grid; gap:4px; padding:14px 18px; border-right:1px solid #244b3f; }
      .case-summary div:last-child { border-right:0; }
      .case-summary span { color:#809d91; font:10px var(--font-mono); text-transform:uppercase; }
      .case-summary strong { font-size:13px; }
      .progress { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:0; margin:0; padding:18px 20px; list-style:none; border-bottom:1px solid #244b3f; }
      .progress li { position:relative; display:flex; align-items:center; gap:8px; color:#79958a; }
      .progress li:not(:last-child)::after { content:''; position:absolute; left:31px; right:7px; top:12px; height:1px; background:#315f51; }
      .progress li > span { z-index:1; display:grid; place-items:center; width:24px; height:24px; flex:0 0 24px; border:1px solid #426e5e; background:#081914; font:700 10px var(--font-mono); }
      .progress li div { z-index:1; display:grid; gap:2px; padding-right:7px; background:#081914; }
      .progress strong { color:#b8ccc4; font-size:11px; }
      .progress small { font-size:9px; }
      .progress li.is-complete > span { border-color:#64d9a5; background:#123d2e; color:#7deab7; }
      .progress li.is-complete strong { color:#eefaf5; }
      .coadmin-choice { display:grid; gap:6px; margin:18px 20px 0; max-width:360px; color:#dceae4; font-size:12px; font-weight:700; }
      select,textarea { box-sizing:border-box; width:100%; border:1px solid #3d6b5b; border-radius:3px; background:#05100d; color:#eefaf5; }
      select { min-height:40px; padding:8px 10px; }
      textarea { padding:11px; resize:vertical; font:11px/1.45 var(--font-mono); }
      label small { color:#8da89d; font-size:10px; font-weight:400; line-height:1.45; }
      .task-panel { padding:20px; }
      .section-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; }
      .task-list { display:grid; gap:8px; margin-top:14px; }
      .task-list article,.chia-actions article { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:12px; padding:12px; border:1px solid #294f43; background:#0a211a; }
      .task-list article > div,.chia-actions article > div { display:grid; gap:3px; }
      .task-list small,.chia-actions small { color:#91aaa0; font-size:11px; line-height:1.4; }
      .network-mark { display:grid; place-items:center; width:44px; height:32px; border:1px solid #456f61; color:#82e6b9; font:700 9px var(--font-mono); }
      .network-mark--chia { border-color:#4b7393; color:#8fc9f4; }
      .is-done { opacity:.78; }
      .done-mark { color:#78e4b2; font:700 10px var(--font-mono); text-transform:uppercase; }
      button,a { min-height:38px; box-sizing:border-box; border-radius:3px; font-weight:700; cursor:pointer; }
      button { padding:8px 12px; border:1px solid #477963; background:#102b23; color:#ecf8f3; }
      button:disabled { cursor:not-allowed; opacity:.45; }
      button:focus,a:focus,select:focus,textarea:focus,input:focus { outline:2px solid #70e3ae; outline-offset:2px; }
      .quiet-button,.secondary-button { background:#0b211a; }
      .primary-button,.button-row a { display:inline-flex; align-items:center; justify-content:center; padding:8px 13px; border:1px solid #70e3ae; background:#70e3ae; color:#062018; text-decoration:none; }
      .decision-receipt { margin:0 20px 20px; padding:18px; border:1px solid #477461; background:#0b241c; }
      .decision-receipt > header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
      .close-button { min-width:36px; padding:4px; background:transparent; font-size:20px; }
      dl { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1px; margin:15px 0 0; background:#285044; }
      dl div { min-width:0; padding:11px; background:#071611; }
      dt { color:#82a598; font:9px var(--font-mono); text-transform:uppercase; }
      dd { margin:4px 0 0; overflow-wrap:anywhere; color:#e9f7f1; font-size:11px; }
      .approval-list { display:grid; gap:7px; margin-top:14px; }
      .approval-list > div { display:flex; align-items:center; gap:9px; padding:9px 11px; border:1px solid #2c5548; }
      .approval-list > div > div { display:grid; gap:2px; }
      .approval-list small { color:#8fa99e; font-size:10px; }
      .approval-dot { width:9px; height:9px; border:1px solid #67877b; border-radius:50%; }
      .approval-dot.is-signed { border-color:#6ee5b1; background:#6ee5b1; }
      .check-row { display:flex; align-items:flex-start; gap:9px; margin-top:15px; color:#cfe0d9; font-size:11px; line-height:1.45; }
      .check-row input { width:18px; height:18px; flex:0 0 18px; accent-color:#6ee5b1; }
      .button-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
      .button-row--end { justify-content:flex-end; align-items:center; }
      .waiting-copy { color:#9cb2a9; font-size:11px; }
      .offline-step,.pending-confirmation { margin-top:14px; padding:13px; border-left:3px solid #d0aa4d; background:#25200e; }
      .offline-step p { margin:5px 0 0; color:#c7c6ad; font-size:11px; line-height:1.5; }
      .offline-step label { display:grid; gap:6px; margin-top:12px; color:#e9eee7; font-size:11px; }
      .pending-confirmation { display:flex; align-items:center; flex-wrap:wrap; gap:8px; border-color:#5896c5; background:#0d2433; }
      .pending-confirmation span { flex:1; color:#b7cbd8; font-size:11px; }
      .chia-actions { display:grid; gap:7px; margin-top:14px; }
      .chia-actions article { grid-template-columns:minmax(0,1fr) auto; }
      .chia-actions article.is-signed { border-color:#3b705c; }
      .compact-buttons { display:flex !important; flex-direction:row; gap:6px !important; }
      details { margin-top:14px; color:#9db8ad; font-size:11px; }
      summary { cursor:pointer; font-weight:700; }
      details code { display:block; margin-top:7px; overflow-wrap:anywhere; color:#78dcae; font-size:9px; }
      .cancel-zone { margin:0 20px 18px; padding:13px 15px; border:1px solid #5b4434; background:#1d1510; }
      .cancel-zone > div { margin-top:12px; }
      .cancel-zone p { color:#b9aaa0; font-size:11px; line-height:1.5; }
      .cancel-actions { display:flex; flex-wrap:wrap; gap:8px; }
      .cancel-actions button { border-color:#80594a; background:#2a1813; }
      .terminal-state { display:grid; gap:4px; margin:20px; padding:16px; border-left:3px solid #69d6a4; background:#0e2d23; }
      .terminal-state span { color:#a9c2b8; font-size:12px; }
      .case-evidence { margin:0; padding:12px 20px 18px; border-top:1px solid #244b3f; }
      @media (max-width:820px) {
        .case-summary { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .case-summary div:nth-child(2) { border-right:0; }
        .progress { grid-template-columns:1fr; gap:9px; }
        .progress li::after { display:none; }
        dl { grid-template-columns:repeat(2,minmax(0,1fr)); }
      }
      @media (max-width:560px) {
        .case-header,.section-heading { flex-direction:column; }
        .case-summary,dl { grid-template-columns:1fr; }
        .case-summary div { border-right:0; }
        .task-list article { grid-template-columns:auto minmax(0,1fr); }
        .task-list article > button,.task-list .done-mark { grid-column:2; justify-self:start; }
        .decision-receipt { margin-inline:12px; }
        .task-panel { padding-inline:12px; }
      }
    `,
  ],
})
export class AdminRecoveryCaseActionsComponent {
  private readonly security = inject(AdminSecurityService);
  private readonly wallet = inject(EvmWalletService);

  @Input({ required: true }) recovery!: AdminRecoveryCase;
  @Input({ required: true }) current!: AdminSecurityStatus;
  @Output() readonly changed = new EventEmitter<void>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly selectedEvmAction = signal<EvmRecoveryAction | null>(null);
  readonly safePackage = signal<EvmSafeActionPackage | null>(null);
  readonly offlineGuardianPackage =
    signal<AdminRecoveryGuardianActionPackage | null>(null);
  readonly chiaPackage = signal<ChiaActionPackage | null>(null);
  readonly offlineChiaPackage =
    signal<AdminChiaRecoveryActionPackage | null>(null);
  readonly pendingEvmTransaction =
    signal<{ actionId: string; transactionHash: string } | null>(null);

  get baseNetworkLabel(): string {
    return this.recovery.intent.evmChainId === 8453 ? 'Base mainnet' : 'Base Sepolia';
  }

  positiveEvmActions(): EvmRecoveryAction[] {
    return (this.recovery?.actions ?? []).filter(
      (action) => !this.isCancellation(action),
    );
  }

  cancellationEvmActions(): EvmRecoveryAction[] {
    return (this.recovery?.actions ?? []).filter((action) =>
      this.isCancellation(action),
    );
  }

  nextChiaPhase(): ChiaPhase | null {
    if (!this.recovery) return null;
    if (this.hasReceipt('EVM', 'CANCEL') || this.hasReceipt('EVM', 'ROLLBACK')) {
      return null;
    }
    if (!this.hasReceipt('CHIA', 'PREPARE')) return 'PREPARE';
    if (
      !this.hasReceipt('CHIA', 'COMPLETE') &&
      !this.hasReceipt('CHIA', 'CANCEL') &&
      this.recovery.approvalsComplete &&
      this.recovery.delayComplete
    ) {
      return 'COMPLETE';
    }
    return null;
  }

  coadminSlot: 1 | 2 = 1;
  evmReceiptConfirmed = false;
  chiaReceiptConfirmed = false;
  offlineResultText = '';
  offlineChiaResultText = '';

  get caseTitle(): string {
    return {
      ROUTINE: 'Daily wallet replacement',
      LOST: 'Lost-wallet recovery',
      RECOVERY_KIT: 'Recovery-kit replacement',
    }[this.recovery.kind];
  }

  get caseHelp(): string {
    if (this.recovery.state === 'PARTIAL') {
      return 'One network has changed. Finish the exact matching transition before any other administrator work resumes.';
    }
    if (!this.recovery.approvalsComplete) {
      return 'Each required person reviews and signs the same replacement. No funds can move.';
    }
    if (!this.recovery.delayComplete) {
      return 'Approvals are complete. The current key can still cancel during the safety delay.';
    }
    return 'The delay has passed. Finish the exact approved change on both networks.';
  }

  get stateClass(): string {
    return this.recovery.state === 'COMPLETED'
      ? 'state state--healthy'
      : 'state state--attention';
  }

  get needsCoadminChoice(): boolean {
    return (
      this.recovery.slot === 0 &&
      this.recovery.kind !== 'LOST' &&
      this.current.actor.slot === 0 &&
      !this.selectedEvmAction() &&
      !this.chiaPackage()
    );
  }

  mySafeApproval(): EvmSafeApproval | null {
    return (
      this.safePackage()?.approvals.find(
        (approval) => approval.slot === this.current.actor.slot,
      ) ?? null
    );
  }

  canSignChiaAction(action: ChiaSigningAction): boolean {
    if (action.signerKind !== 'EIP712_DAILY') return false;
    if (action.signerSlot === this.current.actor.slot) return true;
    return (
      action.signerSlot === this.recovery.slot &&
      action.signerPublicKey.toLowerCase() ===
        this.recovery.intent.newDailyChiaKey.toLowerCase()
    );
  }

  canCancelChia(): boolean {
    return (
      this.hasReceipt('CHIA', 'PREPARE') &&
      !this.hasReceipt('CHIA', 'COMPLETE') &&
      !this.hasReceipt('CHIA', 'CANCEL')
    );
  }

  pendingSubmissionFor(
    action: EvmRecoveryAction,
  ): { actionId: string; transactionHash: string } | null {
    const pending = this.recovery.evmSubmissions.find(
      (submission) =>
        submission.actionId === action.actionId && submission.state === 'PENDING',
    );
    return pending
      ? {
          actionId: pending.actionId,
          transactionHash: pending.transactionHash,
        }
      : null;
  }

  async reviewEvmAction(action: EvmRecoveryAction): Promise<void> {
    await this.run(async () => {
      this.closeActionReview();
      this.selectedEvmAction.set(action);
      if (action.execution === 'SAFE') {
        this.safePackage.set(
          await this.security.getEvmSafePackage(
            this.recovery.caseId,
            this.safeRequest(action),
          ),
        );
      } else if (action.execution === 'OFFLINE_RELAY') {
        this.offlineGuardianPackage.set(
          createAdminRecoveryGuardianActionPackage(this.recovery, action),
        );
      }
      this.message.set('Review the decision receipt before connecting a wallet.');
    });
  }

  async reviewChiaPhase(phase: ChiaPhase): Promise<void> {
    await this.run(async () => {
      this.closeActionReview();
      const request = {
        phase,
        ...this.chiaCoadminSelection(),
      };
      this.chiaPackage.set(
        await this.security.getChiaPackage(this.recovery.caseId, request),
      );
      this.message.set('Review the Testnet11 receipt before collecting signatures.');
    });
  }

  async signSafeApproval(mode: WalletMode): Promise<void> {
    const safe = this.safePackage();
    const action = this.selectedEvmAction();
    const approval = this.mySafeApproval();
    if (!safe || !action || !approval || approval.signed || !this.evmReceiptConfirmed) {
      this.error.set('Review the receipt and load your unsigned approval first.');
      return;
    }
    await this.run(async () => {
      await this.connectExpected(approval.signerAddress, mode);
      const signature =
        approval.signatureKind === 'SAFE_MESSAGE'
          ? await this.wallet.signAuthorityV3SafeMessage(approval.typedData, {
              identitySafe: approval.identitySafe,
              transactionData: safe.transactionData,
            })
          : await this.wallet.signAuthorityV3SafeTransaction(approval.typedData, {
              safe: safe.executionSafe,
              transaction: safe.transaction,
            });
      this.safePackage.set(
        await this.security.submitEvmSafeSignature(this.recovery.caseId, {
          ...this.safeRequest(action),
          packageHash: safe.packageHash,
          signature,
        }),
      );
      this.message.set('Your exact Safe approval was recorded. It cannot authorize another action.');
    });
  }

  async broadcastSafe(mode: WalletMode): Promise<void> {
    const safe = this.safePackage();
    const action = this.selectedEvmAction();
    if (!safe?.readyToBroadcast || !safe.broadcastTransaction || !action) {
      this.error.set('The required Safe approvals are not complete.');
      return;
    }
    await this.run(async () => {
      await this.connectExpected(this.current.actor.wallet, mode);
      const transactionHash = await this.wallet.sendBaseSepoliaTransaction(
        safe.broadcastTransaction!,
      );
      await this.trackEvmSubmission(action, transactionHash);
    });
  }

  async broadcastDirect(action: EvmRecoveryAction, mode: WalletMode): Promise<void> {
    if (!this.evmReceiptConfirmed) {
      this.error.set('Confirm the decision receipt first.');
      return;
    }
    await this.run(async () => {
      const expected =
        action.execution === 'WALLET' ? action.signer : this.current.actor.wallet;
      await this.connectExpected(expected, mode);
      const transactionHash = await this.wallet.sendBaseSepoliaTransaction({
        chainId: this.recovery.intent.evmChainId,
        to: action.to,
        value: '0x0',
        data: action.data,
      });
      await this.trackEvmSubmission(action, transactionHash);
    });
  }

  async relayGuardianAction(mode: WalletMode): Promise<void> {
    const action = this.selectedEvmAction();
    const offline = this.offlineGuardianPackage();
    if (!action || !offline || !this.evmReceiptConfirmed) {
      this.error.set('Review the exact offline action first.');
      return;
    }
    await this.run(async () => {
      const result = parseAdminRecoveryGuardianActionResult(
        this.offlineResultText,
        offline,
      );
      const authorized = await this.security.authorizeRecoveryGuardian(
        this.recovery.caseId,
        {
          action: result.action,
          guardianSignature: result.guardianSignature,
        },
      );
      if (
        authorized.intentHash.toLowerCase() !== this.recovery.intentHash.toLowerCase() ||
        authorized.action !== offline.action ||
        authorized.guardianSigner.toLowerCase() !==
          offline.expectedGuardian.toLowerCase()
      ) {
        throw new Error('The recovery relay response differs from the reviewed action.');
      }
      await this.connectExpected(this.current.actor.wallet, mode);
      const transactionHash = await this.wallet.sendBaseSepoliaTransaction(
        authorized.relayTransaction,
      );
      await this.trackEvmSubmission(action, transactionHash);
    });
  }

  async signChiaAction(action: ChiaSigningAction, mode: WalletMode): Promise<void> {
    const chia = this.chiaPackage();
    if (!chia || action.signed || action.signerKind !== 'EIP712_DAILY') return;
    await this.run(async () => {
      const expectedWallet = computeAddress(action.signerPublicKey);
      await this.connectExpected(expectedWallet, mode);
      if (!action.typedData || !action.coinId || !action.delegatedPuzzleHash) {
        throw new Error('The Testnet11 signing request is incomplete.');
      }
      const signature = await this.wallet.signAuthorityV3ChiaAction(
        action.typedData,
        {
          coinId: action.coinId,
          delegatedPuzzleHash: action.delegatedPuzzleHash,
          compressedPubkey: action.signerPublicKey,
        },
      );
      this.chiaPackage.set(
        await this.security.submitChiaSignature(this.recovery.caseId, {
          phase: action.phase,
          actionId: action.actionId,
          signature,
          ...this.chiaCoadminSelection(),
        }),
      );
      this.message.set('The exact Testnet11 signature was recorded.');
    });
  }

  prepareOfflineChia(action: ChiaSigningAction): void {
    this.offlineChiaPackage.set(null);
    this.offlineChiaResultText = '';
    this.message.set(null);
    try {
      this.offlineChiaPackage.set(
        createAdminChiaRecoveryActionPackage(this.recovery, action),
      );
      this.offlineChiaResultText = '';
      this.error.set(null);
      this.message.set('The public offline Testnet11 package is ready.');
    } catch (error) {
      this.error.set(formatError(error));
    }
  }

  async submitOfflineChiaResult(
    offline: AdminChiaRecoveryActionPackage,
  ): Promise<void> {
    await this.run(async () => {
      const result = parseAdminChiaRecoveryActionResult(
        this.offlineChiaResultText,
        offline,
      );
      this.chiaPackage.set(
        await this.security.submitChiaSignature(this.recovery.caseId, {
          phase: offline.action.phase,
          actionId: result.actionId,
          signature: result.signature,
          ...this.chiaCoadminSelection(),
        }),
      );
      this.offlineChiaPackage.set(null);
      this.offlineChiaResultText = '';
      this.message.set('The restricted recovery signature was verified and recorded.');
    });
  }

  async submitChia(chia: ChiaActionPackage): Promise<void> {
    if (!chia.readyToSubmit || !this.chiaReceiptConfirmed) {
      this.error.set('Complete the required signatures and confirm the receipt first.');
      return;
    }
    await this.run(async () => {
      const submitted = await this.security.submitChiaPackage(
        this.recovery.caseId,
        {
          phase: chia.phase,
          ...this.chiaCoadminSelection(),
        },
      );
      this.chiaPackage.set(submitted);
      this.message.set(
        'The exact Testnet11 bundle reached the mempool. Confirmation is now being monitored.',
      );
      this.changed.emit();
    });
  }

  async observeChia(): Promise<void> {
    await this.run(async () => {
      await this.security.observeChia(this.recovery.caseId);
      this.message.set('The latest Testnet11 confirmation was recorded.');
      this.changed.emit();
    });
  }

  async observeEvm(pending: {
    actionId: string;
    transactionHash: string;
  }): Promise<void> {
    await this.run(async () => {
      await this.security.observeEvm(
        this.recovery.caseId,
        pending.transactionHash,
      );
      this.pendingEvmTransaction.set(null);
      this.message.set('The Base action is confirmed and recorded.');
      this.changed.emit();
    });
  }

  async copyGuardianPackage(
    value: AdminRecoveryGuardianActionPackage,
  ): Promise<void> {
    await this.copyText(JSON.stringify(value));
    this.message.set('The public recovery-kit action was copied.');
  }

  async copyChiaPackage(value: AdminChiaRecoveryActionPackage): Promise<void> {
    await this.copyText(JSON.stringify(value));
    this.message.set('The public Testnet11 recovery action was copied.');
  }

  refreshCase(): void {
    this.changed.emit();
  }

  clearPreparedPackages(): void {
    this.closeActionReview();
  }

  closeActionReview(): void {
    this.selectedEvmAction.set(null);
    this.safePackage.set(null);
    this.offlineGuardianPackage.set(null);
    this.chiaPackage.set(null);
    this.offlineChiaPackage.set(null);
    this.pendingEvmTransaction.set(null);
    this.offlineResultText = '';
    this.offlineChiaResultText = '';
    this.evmReceiptConfirmed = false;
    this.chiaReceiptConfirmed = false;
  }

  hasReceipt(
    chain: 'CHIA' | 'EVM',
    phase: 'PREPARE' | 'APPROVE' | 'EXECUTE' | 'CANCEL' | 'COMPLETE' | 'ROLLBACK',
  ): boolean {
    return this.recovery.receipts.some(
      (receipt) => receipt.chain === chain && receipt.phase === phase,
    );
  }

  isCancellation(action: EvmRecoveryAction): boolean {
    return /cancel|veto|rollback/i.test(action.actionId);
  }

  actionHelp(action: EvmRecoveryAction): string {
    if (action.execution === 'SAFE') {
      return action.signer.toLowerCase() === this.recovery.intent.rootSafe.toLowerCase()
        ? 'The owner and one coadministrator sign the same Safe action.'
        : 'The assigned administrator signs through their Identity Safe.';
    }
    if (action.execution === 'OFFLINE_RELAY') {
      return 'The recovery phrase signs offline; an administrator wallet only pays gas.';
    }
    if (action.execution === 'PERMISSIONLESS') {
      return 'Approvals are complete. Any administrator may pay gas for the exact action.';
    }
    return 'The named wallet confirms this exact replacement or cancellation.';
  }

  authorityEffect(action: EvmRecoveryAction): string {
    if (this.isCancellation(action)) return 'Restores the current identity';
    if (/execute|convergence/.test(action.actionId)) {
      return 'Applies or confirms the approved replacement';
    }
    return 'Approves only this exact replacement';
  }

  signerLabel(action: EvmRecoveryAction): string {
    if (action.execution === 'SAFE') return 'Authority V3 Safe';
    if (action.execution === 'PERMISSIONLESS') return 'Any gas-paying administrator';
    if (action.execution === 'OFFLINE_RELAY') return 'Offline recovery guardian';
    return this.short(action.signer);
  }

  approvalLabel(approval: EvmSafeApproval): string {
    if (approval.role === 'OWNER') return 'Owner';
    if (approval.role === 'COADMIN') {
      return `Coadministrator ${approval.slot + 1}`;
    }
    return `Administrator ${approval.slot + 1}`;
  }

  chiaPhaseTitle(phase: ChiaPhase): string {
    return {
      PREPARE: 'Start the Testnet11 safety lock',
      COMPLETE: 'Finish the approved Testnet11 change',
      CANCEL: 'Cancel the Testnet11 change',
    }[phase];
  }

  chiaPhaseHelp(phase: ChiaPhase): string {
    return {
      PREPARE: 'Collect exact wallet signatures and submit one bounded bundle.',
      COMPLETE: 'The delay and approvals are complete; apply only the committed key.',
      CANCEL: 'Restore the prior identity with the current wallet.',
    }[phase];
  }

  countdown(executeAfter: number): string {
    const seconds = Math.max(0, executeAfter - Math.floor(Date.now() / 1000));
    if (seconds === 0) return 'Ready now';
    const days = Math.floor(seconds / 86_400);
    const hours = Math.ceil((seconds % 86_400) / 3600);
    return days
      ? `${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'}`
      : `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  formatTime(epoch: number): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(epoch * 1000);
  }

  stateLabel(value: string): string {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  short(value: string): string {
    return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
  }

  private safeRequest(action: EvmRecoveryAction): {
    actionId: string;
    coadminSlot?: 1 | 2;
  } {
    if (action.signer.toLowerCase() !== this.recovery.intent.rootSafe.toLowerCase()) {
      return { actionId: action.actionId };
    }
    return {
      actionId: action.actionId,
      coadminSlot:
        this.current.actor.slot === 1 || this.current.actor.slot === 2
          ? this.current.actor.slot
          : this.coadminSlot,
    };
  }

  private chiaCoadminSelection(): { coadminSlot?: 1 | 2 } {
    if (this.recovery.kind === 'LOST') return {};
    if (this.recovery.slot === 1 || this.recovery.slot === 2) {
      return { coadminSlot: this.recovery.slot };
    }
    const recorded = this.recovery.chiaSignatures
      .map((signature) => signature.signerSlot)
      .find((slot): slot is 1 | 2 => slot === 1 || slot === 2);
    return { coadminSlot: recorded ?? this.coadminSlot };
  }

  private async connectExpected(
    expectedAddress: string,
    mode: WalletMode,
  ): Promise<void> {
    const address =
      mode === 'walletconnect'
        ? await this.wallet.connectWalletConnect({
            optionalChains: 'solslot',
            resetSession: true,
          })
        : await this.wallet.connectInjected();
    if (address.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error(
        `Connect ${this.short(expectedAddress)} for this exact action. The connected wallet is not authorized.`,
      );
    }
  }

  private async trackEvmSubmission(
    action: EvmRecoveryAction,
    transactionHash: string,
  ): Promise<void> {
    this.pendingEvmTransaction.set({
      actionId: action.actionId,
      transactionHash,
    });
    await this.recordPropagatedEvmSubmission(action, transactionHash);
    this.changed.emit();
    try {
      await this.security.observeEvm(this.recovery.caseId, transactionHash);
      this.pendingEvmTransaction.set(null);
      this.message.set('The Base action is confirmed and recorded.');
      this.changed.emit();
    } catch {
      this.message.set(
        'The transaction was sent. Leave this page open or return to Security & Access to check confirmation.',
      );
    }
  }

  private async recordPropagatedEvmSubmission(
    action: EvmRecoveryAction,
    transactionHash: string,
  ): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await this.security.recordEvmSubmission(this.recovery.caseId, {
          ...(action.execution === 'SAFE'
            ? this.safeRequest(action)
            : { actionId: action.actionId }),
          transactionHash,
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
        }
      }
    }
    throw new Error(
      `The transaction was sent but the coordinator has not seen it yet. Keep this hash: ${transactionHash}. ${formatError(lastError)}`,
    );
  }

  private async copyText(value: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard access is unavailable.');
    }
    await navigator.clipboard.writeText(value);
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      await operation();
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
