import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import {
  AdminRecoveryBackupCryptoService,
  AdminRecoveryBackupEnvelope,
} from '../../../services/admin-recovery-backup-crypto.service';
import { AdminRecoveryDriveService } from '../../../services/admin-recovery-drive.service';
import {
  AdminRecoveryPublicIdentity,
  AdminRecoveryKitService,
} from '../../../services/admin-recovery-kit.service';
import {
  createAdminRecoveryDrillPackage,
  parseAdminRecoveryDrillResult,
} from '../../../services/admin-recovery-handoff';
import {
  AdminKeyChangeKind,
  AdminRecoveryKitCandidate,
  AdminRecoveryCase,
  AdminSecurityService,
  AdminSecurityStatus,
  PreparedKeyChange,
  RecoveryDrillChallenge,
} from '../../../services/admin-security.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { AdminLaunchService } from '../../../services/admin-launch.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { SolslotProtocolArtifactService } from '../../../services/solslot-protocol-artifact.service';
import { environment } from '../../../../environments/environment';
import { formatError } from '../../../utils/format-error';
import { AdminRecoveryCaseActionsComponent } from './admin-recovery-case-actions.component';

type RecoverySetupStage = 'closed' | 'phrase' | 'verify';
type ChangeFlowKind = Extract<AdminKeyChangeKind, 'ROUTINE' | 'RECOVERY_KIT'>;

@Component({
  selector: 'solslot-admin-authority',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    AdminWorkspaceNavComponent,
    AdminRecoveryCaseActionsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session.isAuthenticated()) {
      <solslot-admin-workspace-nav />
    }

    <main class="security-page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Security & Access</span>
          <h1>Protect administrator access</h1>
          <p>
            Check your daily wallet, prove your offline recovery kit, and use the protected
            process if a wallet is lost or replaced.
          </p>
        </div>
        <a
          [routerLink]="launchSecurity ? '/admin/genesis' : '/admin'"
          class="secondary-action"
        >
          {{ launchSecurity ? 'Back to launch' : 'Back to tasks' }}
        </a>
      </header>

      @if (launchSignInRequired()) {
        <section class="notice" role="status" aria-live="polite">
          <div>
            <strong>Sign in to continue</strong>
            <span>Your administrator session ended. Your saved recovery records are unchanged.</span>
            @if (setupStage() !== 'closed') {
              <span>Keep this page open. Your unfinished recovery setup stays here while you reconnect.</span>
            }
          </div>
          <div class="session-actions">
            <button type="button" class="primary-action" [disabled]="busy()"
              (click)="reconnectLaunch('injected')">Sign in with browser wallet</button>
            <button type="button" class="secondary-action" [disabled]="busy()"
              (click)="reconnectLaunch('walletconnect')">Use mobile or hardware wallet</button>
          </div>
        </section>
      }
      @if (error(); as detail) {
        <section class="notice notice--error" role="alert">
          <div>
            <strong>Action needs attention</strong>
            <span>{{ detail }}</span>
          </div>
          @if (!launchSignInRequired()) {
            <button type="button" (click)="reload()">Try again</button>
          }
        </section>
      }
      @if (message(); as detail) {
        <section class="notice" role="status">
          <div>
            <strong>Saved</strong>
            <span>{{ detail }}</span>
          </div>
        </section>
      }

      <section class="approval-rule" aria-labelledby="approval-rule-title">
        <span class="rule-mark" aria-hidden="true">2</span>
        <div>
          <span class="eyebrow">Permanent approval rule</span>
          <h2 id="approval-rule-title">Owner plus either coadministrator</h2>
          <p>
            The owner must participate in normal administrator decisions. The two
            coadministrators cannot act without the owner, and no one person can act alone.
          </p>
        </div>
        <span class="state state--fixed">Cannot be changed by recovery</span>
      </section>

      @if (loading()) {
        <section class="loading-state" aria-live="polite">
          <strong>Checking protected access...</strong>
          <span>Solslot is comparing the administrator records with current chain evidence.</span>
        </section>
      } @else if (status(); as current) {
        @if (current.operationsFrozen) {
          <section class="freeze-notice" role="alert">
            <strong>Administrator operations are paused</strong>
            <span>
              A protected key change is active. No other privileged Chia or EVM action can
              proceed until both chains match or the exact change is canceled.
            </span>
          </section>
        }

        <section class="summary-grid" aria-label="Administrator security summary">
          <article>
            <span class="eyebrow">Signed in</span>
            <h2>{{ current.actor.role }}</h2>
            <p>Authority slot {{ current.actor.slot + 1 }}</p>
            <code>{{ short(current.actor.wallet) }}</code>
          </article>
          <article>
            <span class="eyebrow">Your recovery kit</span>
            <h2>{{ current.myRecoveryKit ? 'Tested and recorded' : 'Setup required' }}</h2>
            <p>
              {{
                current.myRecoveryKit
                  ? 'Revision ' + current.myRecoveryKit.revision + ' passed the restore drill.'
                  : 'Create an offline kit before ceremony readiness can pass.'
              }}
            </p>
            <span
              [class]="current.myRecoveryKit ? 'state state--healthy' : 'state state--attention'"
            >
              {{ current.myRecoveryKit ? 'Ready' : 'Your action' }}
            </span>
          </article>
          <article>
            <span class="eyebrow">Team recovery coverage</span>
            <h2>{{ current.recoveryKits.length }} of 3 ready</h2>
            <p>Each administrator keeps a separate recovery phrase and guardian.</p>
            <span [class]="current.recoveryReady ? 'state state--healthy' : 'state state--waiting'">
              {{ current.recoveryReady ? 'Launch check passed' : 'Waiting for team' }}
            </span>
          </article>
        </section>

        @if (!current.myRecoveryKit && setupStage() === 'closed') {
          <section class="next-action">
            <div>
              <span class="eyebrow">Your next security task</span>
              <h2>Create and test your recovery kit</h2>
              <p>
                You will write down one 24-word phrase, restore it on a second device, and
                prove both recovery keys. Solslot receives only public keys and signatures.
              </p>
            </div>
            <button type="button" class="primary-action" (click)="beginRecoverySetup()">
              Start secure setup
            </button>
          </section>
        }

        @if (setupStage() !== 'closed') {
          <section class="setup-panel" aria-labelledby="recovery-setup-title">
            <header>
              <div>
                <span class="eyebrow">Private recovery setup</span>
                <h2 id="recovery-setup-title">
                  {{ setupStage() === 'phrase' ? 'Save your recovery phrase' : 'Test it elsewhere' }}
                </h2>
              </div>
              <button type="button" class="close-button" aria-label="Cancel setup" (click)="cancelSetup()">
                &times;
              </button>
            </header>

            @if (setupStage() === 'phrase') {
              <div class="warning">
                <strong>Only you should see these words</strong>
                <span>
                  Never paste them into email, chat, cloud notes, a support ticket, or any
                  Solslot form other than the standalone recovery page on your second device.
                </span>
              </div>

              <ol class="phrase-grid" aria-label="24-word administrator recovery phrase">
                @for (word of recoveryWords(); track $index) {
                  <li><span>{{ $index + 1 }}</span><strong>{{ word }}</strong></li>
                }
              </ol>

              <div class="setup-copy">
                <h3>1. Make the offline copy</h3>
                <p>
                  Write all 24 words, in order, on paper or metal. Store it away from your
                  daily wallet and computer.
                </p>
                <label class="check-row">
                  <input type="checkbox" [(ngModel)]="offlineCopyConfirmed" />
                  <span>I made an offline copy and checked every word.</span>
                </label>
              </div>

              <div class="setup-copy">
                <h3>2. Confirm the copy before leaving this screen</h3>
                <p>Enter the words from your offline copy. This stays only in page memory.</p>
                <textarea
                  [(ngModel)]="confirmationPhrase"
                  rows="4"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="Enter all 24 words in order"
                ></textarea>
              </div>

              <div class="backup-choice">
                <label class="check-row">
                  <input
                    type="checkbox"
                    [(ngModel)]="driveBackupRequested"
                    [disabled]="!googleBackupAvailable"
                  />
                  <span>
                    Add the recommended encrypted Google Drive backup
                    @if (!googleBackupAvailable) {
                      <small>Not enabled in this deployment</small>
                    }
                  </span>
                </label>
                <p>
                  Drive receives only an encrypted file in private app data. Keep its separate
                  six-word password away from the 24-word phrase.
                </p>
              </div>

              <div class="panel-actions">
                <button type="button" class="secondary-button" (click)="cancelSetup()">Cancel</button>
                <button
                  type="button"
                  class="primary-action"
                  [disabled]="busy()"
                  (click)="prepareRecoveryDrill(current)"
                >
                  {{ busy() ? 'Preparing...' : 'Continue to second-device test' }}
                </button>
              </div>
            } @else if (challenge(); as drill) {
              @if (driveBackupRequested && backupPassword()) {
                <div class="backup-password">
                  <span class="eyebrow">Separate Drive backup password</span>
                  <strong>{{ backupPassword() }}</strong>
                  <p>
                    Store these six words separately from the 24-word phrase. Solslot cannot
                    recover either one.
                  </p>
                  <button type="button" class="secondary-button" (click)="copyBackupPassword()">
                    Copy six words
                  </button>
                  <label class="check-row">
                    <input type="checkbox" [(ngModel)]="backupPasswordStored" />
                    <span>I stored the six-word password separately.</span>
                  </label>
                </div>
              }

              <div class="device-test">
                <span class="step-number">1</span>
                <div>
                  <h3>Open the recovery test on a second device</h3>
                  <p>
                    Type the 24 words from your offline copy into the standalone page. The
                    second device signs this one-time test and clears the phrase afterward.
                  </p>
                  <div class="inline-actions">
                    <a
                      routerLink="/recover-admin-access"
                      target="_blank"
                      rel="noopener"
                      class="primary-action"
                    >
                      Open standalone recovery page
                    </a>
                    <button type="button" class="secondary-button" (click)="copyDrillPackage(drill)">
                      Copy one-time test
                    </button>
                  </div>
                </div>
              </div>

              <div class="device-test">
                <span class="step-number">2</span>
                <div>
                  <h3>Bring back the signed test result</h3>
                  <p>
                    Paste only the signed result from the second device. It contains no phrase,
                    password, or private key.
                  </p>
                  <textarea
                    [(ngModel)]="remoteProofText"
                    rows="5"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="Paste the signed recovery test result"
                  ></textarea>
                </div>
              </div>

              <div class="panel-actions">
                <button type="button" class="secondary-button" (click)="cancelSetup()">Cancel</button>
                <button
                  type="button"
                  class="primary-action"
                  [disabled]="busy()"
                  (click)="completeRecoverySetup(current)"
                >
                  {{ busy() ? 'Verifying...' : 'Verify and finish' }}
                </button>
              </div>
            }
          </section>
        }

        @if (current.pendingRecoveryKit; as candidate) {
          @if (!current.activeRecovery && setupStage() === 'closed') {
          <section class="next-action activation-action" aria-labelledby="activate-kit-title">
            <div>
              <span class="eyebrow">Test passed</span>
              <h2 id="activate-kit-title">Activate your tested recovery kit</h2>
              <p>
                Your old recovery kit still protects this slot. Connect your current daily
                wallet to start the protected replacement, then the team can review the exact
                change.
              </p>
            </div>
            <button
              type="button"
              class="primary-action"
              [disabled]="busy()"
              (click)="prepareRecoveryKitChange(current, candidate)"
            >
              {{ busy() ? 'Connecting...' : 'Connect current wallet' }}
            </button>
          </section>
          }
        }

        @if (rotationOpen() && !preparedChange()) {
          <section class="change-panel" aria-labelledby="rotation-title">
            <header>
              <div>
                <span class="eyebrow">Daily wallet rotation</span>
                <h2 id="rotation-title">Choose the replacement wallet</h2>
                <p>
                  This first connection identifies the new wallet only. It cannot start the
                  change or move funds.
                </p>
              </div>
              <button type="button" class="close-button" aria-label="Close wallet rotation" (click)="cancelChangeFlow()">
                &times;
              </button>
            </header>
            @if (replacementWallet(); as replacement) {
              <div class="wallet-confirmation">
                <span class="state state--healthy">Replacement verified</span>
                <strong>{{ short(replacement.address) }}</strong>
                <p>
                  Next, switch to the current administrator wallet shown on this page. That
                  wallet must start the protected 24-hour change.
                </p>
              </div>
              <div class="panel-actions">
                <button type="button" class="secondary-button" (click)="cancelChangeFlow()">Cancel</button>
                <button
                  type="button"
                  class="primary-action"
                  [disabled]="busy()"
                  (click)="prepareRoutineChange(current)"
                >
                  {{ busy() ? 'Checking current wallet...' : 'Connect current wallet' }}
                </button>
              </div>
            } @else {
              <div class="wallet-options" aria-label="Replacement wallet connection choices">
                <button type="button" [disabled]="busy()" (click)="connectReplacementWallet('injected')">
                  <strong>Browser wallet</strong>
                  <span>MetaMask, Coinbase Wallet, or another installed wallet</span>
                </button>
                <button type="button" [disabled]="busy()" (click)="connectReplacementWallet('walletconnect')">
                  <strong>Mobile or hardware wallet</strong>
                  <span>WalletConnect, Tangem, or a compatible signing wallet</span>
                </button>
              </div>
            }
          </section>
        }

        @if (preparedChange(); as prepared) {
          <section class="decision-receipt" aria-labelledby="change-receipt-title">
            <header>
              <div>
                <span class="eyebrow">Decision receipt</span>
                <h2 id="change-receipt-title">{{ prepared.clearSigning.title }}</h2>
                <p>Check every line before the wallet asks you to approve the transaction.</p>
              </div>
              <span class="state state--attention">Not submitted</span>
            </header>
            <dl>
              <div><dt>Network</dt><dd>Base Sepolia</dd></div>
              <div><dt>Administrator</dt><dd>Slot {{ prepared.clearSigning.slot + 1 }}</dd></div>
              <div><dt>Current wallet</dt><dd>{{ short(prepared.clearSigning.oldWallet) }}</dd></div>
              <div><dt>Replacement</dt><dd>{{ short(prepared.clearSigning.newWallet) }}</dd></div>
              <div><dt>Funds moved</dt><dd>{{ prepared.clearSigning.financialEffect }}</dd></div>
              <div><dt>Safety delay</dt><dd>{{ delayLabel(prepared.clearSigning.delaySeconds) }}</dd></div>
              <div><dt>Approval rule</dt><dd>Owner plus either coadministrator</dd></div>
              <div><dt>During review</dt><dd>Administrator operations pause</dd></div>
            </dl>
            <p class="receipt-effect">{{ prepared.clearSigning.authorityEffect }}</p>
            <label class="check-row">
              <input type="checkbox" [(ngModel)]="changeReceiptConfirmed" />
              <span>
                I verified the current wallet, replacement, network, delay, and no-funds-move
                effect.
              </span>
            </label>
            <div class="panel-actions">
              <button type="button" class="secondary-button" (click)="cancelChangeFlow()">Cancel</button>
              <button
                type="button"
                class="primary-action"
                [disabled]="busy() || !changeReceiptConfirmed"
                (click)="submitPreparedChange(current)"
              >
                {{ busy() ? 'Submitting...' : 'Start protected change' }}
              </button>
            </div>
            <details>
              <summary>Advanced transaction evidence</summary>
              <code>{{ prepared.intentHash }}</code>
              <code>{{ prepared.coordinator }}</code>
            </details>
          </section>
        }

        @if (current.activeRecovery; as recovery) {
          <solslot-admin-recovery-case-actions
            [recovery]="recovery"
            [current]="current"
            (changed)="reload()"
          />
        }

        @if (current.myRecoveryKit && setupStage() === 'closed') {
          <section class="access-actions" aria-labelledby="access-actions-title">
            <div class="section-heading">
              <div>
                <span class="eyebrow">Protected changes</span>
                <h2 id="access-actions-title">Change access without changing authority</h2>
              </div>
            </div>
            <div class="action-list">
              <article>
                <div>
                  <strong>Replace your daily wallet</strong>
                  <span>
                    Use when you still control the current wallet. Requires owner plus one,
                    replacement acceptance, a 24-hour delay, and an old-key veto.
                  </span>
                </div>
                <button
                  type="button"
                  [disabled]="!!current.activeRecovery"
                  (click)="beginRoutineRotation()"
                >
                  Rotate wallet
                </button>
              </article>
              <article>
                <div>
                  <strong>Recover a lost daily wallet</strong>
                  <span>
                    Uses your offline recovery kit, both other administrators, replacement
                    acceptance, and a seven-day delay.
                  </span>
                </div>
                <a routerLink="/admin/recover-wallet">Start recovery</a>
              </article>
              <article>
                <div>
                  <strong>Replace your recovery kit</strong>
                  <span>
                    Prove a new phrase before the existing recovery keys are replaced. The old
                    kit remains valid until both chains confirm the change.
                  </span>
                </div>
                <button
                  type="button"
                  [disabled]="!!current.activeRecovery"
                  (click)="beginRecoverySetup()"
                >
                  Create replacement
                </button>
              </article>
            </div>
          </section>
        }

        <section class="team-coverage" aria-labelledby="team-coverage-title">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Recovery readiness</span>
              <h2 id="team-coverage-title">Three separate administrator kits</h2>
            </div>
            <span>{{ current.recoveryKits.length }} of 3 tested</span>
          </div>
          <div class="coverage-list">
            @for (slot of authoritySlots; track slot) {
              @if (kitForSlot(current, slot); as kit) {
                <article>
                  <span class="slot-number">{{ slot + 1 }}</span>
                  <div>
                    <strong>{{ slot === 0 ? 'Owner' : 'Coadministrator ' + (slot + 1) }}</strong>
                    <small>
                      Recovery revision {{ kit.revision }} tested
                      {{ formatTime(kit.drillVerifiedAt) }}
                    </small>
                  </div>
                  <span class="state state--healthy">Ready</span>
                </article>
              } @else {
                <article>
                  <span class="slot-number">{{ slot + 1 }}</span>
                  <div>
                    <strong>{{ slot === 0 ? 'Owner' : 'Coadministrator ' + (slot + 1) }}</strong>
                    <small>This administrator still needs to complete the private drill.</small>
                  </div>
                  <span class="state state--waiting">Waiting</span>
                </article>
              }
            }
          </div>
        </section>

        <section class="safety-guide">
          <div>
            <span class="eyebrow">Daily safety</span>
            <h2>Three rules that prevent most administrator losses</h2>
          </div>
          <ol>
            <li>
              <strong>Keep recovery words offline</strong>
              <span>Solslot support will never ask for the 24 words or six-word password.</span>
            </li>
            <li>
              <strong>Read the decision receipt</strong>
              <span>Network, replacement wallet, effect, delay, and approvers must all match.</span>
            </li>
            <li>
              <strong>Stop if anything is unfamiliar</strong>
              <span>Reject unknown Chia effects or EVM calls and contact both other admins.</span>
            </li>
            <li>
              <strong>Total loss has no bypass</strong>
              <span>
                If both the daily wallet and recovery kit are lost, neither Solslot nor a
                provider can reset the authority slot.
              </span>
            </li>
          </ol>
        </section>

        <details class="evidence">
          <summary>Advanced Authority V3 evidence</summary>
          <dl>
            <div><dt>Ceremony</dt><dd>{{ current.actor.ceremonyId }}</dd></div>
            <div>
              <dt>Authority launcher</dt>
              <dd>{{ current.authority?.launcher_id || 'Created during genesis' }}</dd>
            </div>
            <div>
              <dt>Operational MIPS root</dt>
              <dd>{{ artifactService.artifact?.adminAuthority?.operationalMipsRootHash || 'Pending' }}</dd>
            </div>
            <div>
              <dt>Source manifest</dt>
              <dd>{{ artifactService.artifact?.adminAuthority?.sourceManifestHash || 'Pending' }}</dd>
            </div>
          </dl>
          <a routerLink="/admin/trust-roots">Open all trust roots</a>
        </details>
      }
    </main>
  `,
  styles: [
    `
      :host { display:block; min-height:100vh; background:#06110f; color:#eefbf5; }
      .security-page { width:min(1120px,calc(100% - 32px)); margin:0 auto; padding:36px 0 80px; }
      .page-header,.section-heading,.approval-rule,.next-action,.setup-panel header,.notice,.active-case { display:flex; align-items:center; justify-content:space-between; gap:20px; }
      .page-header { align-items:flex-end; padding-bottom:22px; border-bottom:1px solid #245144; }
      .page-header p { max-width:680px; margin:7px 0 0; color:#a9c2b8; }
      h1,h2,h3,p { letter-spacing:0; } h1 { margin:7px 0 0; font-size:36px; } h2 { margin:5px 0 0; font-size:21px; } h3 { margin:0; font-size:15px; }
      .eyebrow { color:#6ee5b1; font:700 10px/1.2 var(--font-mono); text-transform:uppercase; }
      .secondary-action,.primary-action,.secondary-button,.action-list a,.action-list button { display:inline-flex; align-items:center; justify-content:center; min-height:40px; padding:9px 13px; border:1px solid #4f8d77; border-radius:4px; text-decoration:none; font-weight:700; cursor:pointer; }
      .primary-action { border-color:#75e9b5; background:#75e9b5; color:#062018; }
      .secondary-action,.secondary-button,.action-list a,.action-list button { background:#102a22; color:#effbf6; }
      button:disabled { cursor:not-allowed; opacity:.48; }
      .approval-rule { display:grid; grid-template-columns:auto 1fr auto; margin-top:20px; padding:20px; border:1px solid #3c7461; background:#0d251e; }
      .approval-rule p { margin:6px 0 0; color:#a9c2b8; font-size:13px; }
      .rule-mark,.slot-number,.step-number { display:grid; place-items:center; flex:0 0 auto; border:1px solid #67e7ad; color:#67e7ad; font:700 13px var(--font-mono); }
      .rule-mark { width:48px; height:48px; font-size:22px; } .slot-number,.step-number { width:34px; height:34px; }
      .state { display:inline-flex; width:max-content; padding:5px 8px; border:1px solid #567369; color:#b9cdc5; font:700 10px var(--font-mono); text-transform:uppercase; }
      .state--healthy,.state--fixed { border-color:#4f8d77; color:#75e9b5; }
      .state--attention { border-color:#b69842; color:#ffe19a; } .state--waiting { color:#b8c8c2; }
      .notice,.freeze-notice { margin-top:16px; padding:13px 15px; border:1px solid #376a59; background:#0c241d; }
      .notice > div { display:grid; gap:3px; } .notice span,.freeze-notice span { color:#b2c9c0; font-size:12px; }
      .notice--error { border-color:#8e4d4d; background:#281313; color:#ffc1b7; }
      .notice button,.close-button { border:0; background:none; color:inherit; cursor:pointer; }
      .freeze-notice { display:grid; gap:4px; border-color:#a6843e; background:#26210e; }
      .loading-state { display:grid; place-content:center; min-height:260px; margin-top:16px; border:1px solid #245144; color:#a9c2b8; text-align:center; }
      .summary-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:16px; }
      .summary-grid article { display:grid; align-content:start; gap:7px; min-height:175px; padding:18px; border:1px solid #245144; background:#091a16; }
      .summary-grid p,.summary-grid code { margin:0; color:#a9c2b8; font-size:12px; overflow-wrap:anywhere; }
      .next-action { align-items:flex-end; margin-top:16px; padding:20px; border:1px solid #4f8d77; background:#103126; }
      .next-action p { max-width:690px; margin:7px 0 0; color:#b7cfc5; }
      .setup-panel,.change-panel,.decision-receipt,.active-case,.access-actions,.team-coverage,.safety-guide,.evidence { margin-top:16px; padding:20px; border:1px solid #245144; background:#091a16; }
      .setup-panel header { padding-bottom:15px; border-bottom:1px solid #245144; }
      .change-panel header,.decision-receipt header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding-bottom:15px; border-bottom:1px solid #245144; }
      .change-panel header p,.decision-receipt header p,.wallet-confirmation p { max-width:680px; margin:6px 0 0; color:#b2c6be; font-size:12px; line-height:1.55; }
      .close-button { font-size:27px; color:#aac1b8; }
      .warning,.backup-password { display:grid; gap:5px; margin-top:16px; padding:14px; border-left:3px solid #e0bd54; background:#25200f; }
      .warning span,.backup-password p,.setup-copy p,.backup-choice p,.device-test p,.active-case p { margin:0; color:#b2c6be; font-size:12px; line-height:1.55; }
      .phrase-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin:16px 0; padding:0; list-style:none; }
      .phrase-grid li { display:flex; gap:8px; align-items:center; min-width:0; padding:10px; border:1px solid #315c4e; background:#07130f; }
      .phrase-grid li span { color:#658b7d; font:10px var(--font-mono); } .phrase-grid li strong { overflow-wrap:anywhere; font:13px var(--font-mono); }
      .setup-copy,.backup-choice { margin-top:16px; padding:16px; border:1px solid #1d4035; }
      .setup-copy p,.backup-choice p { margin-top:6px; }
      .check-row { display:flex; align-items:flex-start; gap:10px; margin-top:12px; color:#dcece6; font-size:13px; }
      .check-row input { width:18px; height:18px; accent-color:#67e7ad; } .check-row span { display:grid; gap:3px; }
      textarea,input[type='text'] { box-sizing:border-box; width:100%; margin-top:10px; padding:12px; border:1px solid #3c6e5d; border-radius:3px; background:#06110f; color:#f1fbf7; font:12px/1.55 var(--font-mono); }
      textarea:focus,input:focus { outline:2px solid #67e7ad; outline-offset:2px; }
      .panel-actions,.inline-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:9px; margin-top:17px; }
      .backup-password strong { margin:5px 0; color:#fff0b5; font:15px/1.5 var(--font-mono); }
      .device-test { display:flex; align-items:flex-start; gap:14px; margin-top:16px; padding:16px; border:1px solid #315c4e; }
      .device-test > div { flex:1; min-width:0; } .device-test p { margin-top:5px; }
      .activation-action { border-color:#75e9b5; }
      .wallet-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:16px; }
      .wallet-options button { display:grid; gap:5px; min-height:92px; padding:15px; border:1px solid #315c4e; background:#071510; color:#effbf6; text-align:left; cursor:pointer; }
      .wallet-options span { color:#a9c2b8; font-size:12px; line-height:1.45; }
      .wallet-confirmation { display:grid; gap:7px; margin-top:16px; padding:16px; border:1px solid #3c7461; background:#0d251e; }
      .decision-receipt { border-color:#4f8d77; background:#0d251e; }
      .decision-receipt dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; margin:16px 0 0; background:#245144; }
      .decision-receipt dl div { padding:12px; background:#071510; }
      .receipt-effect { margin:14px 0 0; padding:12px; border-left:3px solid #75e9b5; background:#071510; color:#c7dbd3; font-size:12px; line-height:1.55; }
      .decision-receipt details { margin-top:15px; }
      .active-case { align-items:flex-start; flex-wrap:wrap; border-color:#b08e42; background:#201c0e; }
      .active-case > div:first-child { flex:1 1 380px; } .active-case dl { display:grid; grid-template-columns:repeat(2,minmax(130px,1fr)); gap:10px; flex:1 1 350px; margin:0; }
      dt { color:#86a89a; font:10px var(--font-mono); text-transform:uppercase; } dd { margin:4px 0 0; color:#d7e9e1; overflow-wrap:anywhere; }
      .active-case details { flex-basis:100%; } details summary { color:#82d8b2; cursor:pointer; } details code { display:block; margin-top:8px; overflow-wrap:anywhere; color:#9fb8ae; font-size:10px; }
      .action-list,.coverage-list { display:grid; gap:1px; margin-top:16px; background:#245144; }
      .action-list article,.coverage-list article { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:15px; background:#071510; }
      .action-list article > div,.coverage-list article > div { display:grid; flex:1; gap:4px; }
      .action-list span,.coverage-list small { color:#a9c2b8; font-size:12px; line-height:1.5; }
      .coverage-list article { justify-content:flex-start; }
      .safety-guide { display:grid; grid-template-columns:minmax(220px,.8fr) 1.5fr; gap:28px; }
      .safety-guide ol { display:grid; gap:12px; margin:0; padding-left:22px; }
      .safety-guide li { color:#67e7ad; } .safety-guide li strong,.safety-guide li span { display:block; }
      .safety-guide li strong { color:#eefbf5; } .safety-guide li span { margin-top:3px; color:#a9c2b8; font-size:12px; }
      .evidence > summary { color:#9fb8ae; } .evidence dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:15px; }
      .evidence dl div { padding:11px; border:1px solid #1d4035; } .evidence a { display:inline-block; margin-top:13px; color:#75e9b5; }
      .notice > .session-actions { display:flex; flex-direction:column; gap:8px; flex-shrink:0; }
      .session-actions button.primary-action { border:1px solid #75e9b5; background:#75e9b5; color:#062018; }
      .session-actions button.secondary-action { border:1px solid #4f8d77; background:#102a22; color:#effbf6; }
      @media (max-width:620px) { .notice { align-items:stretch; flex-direction:column; } }
      @media (max-width:820px) { .summary-grid,.wallet-options { grid-template-columns:1fr; } .phrase-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .safety-guide { grid-template-columns:1fr; } }
      @media (max-width:620px) { .page-header,.next-action { align-items:flex-start; flex-direction:column; } .approval-rule { grid-template-columns:auto 1fr; } .approval-rule > .state { grid-column:2; } .phrase-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .action-list article { align-items:flex-start; flex-direction:column; } .active-case dl,.decision-receipt dl,.evidence dl { grid-template-columns:1fr; } }
    `,
  ],
})
export class AdminAuthorityComponent implements OnInit, OnDestroy {
  private readonly security = inject(AdminSecurityService);
  private readonly recoveryKit = inject(AdminRecoveryKitService);
  private readonly backupCrypto = inject(AdminRecoveryBackupCryptoService);
  private readonly recoveryDrive = inject(AdminRecoveryDriveService);
  private readonly evmWallet = inject(EvmWalletService);
  private readonly launch = inject(AdminLaunchService);
  readonly launchSecurity = inject(ActivatedRoute).snapshot.data['launchSecurity'] === true;

  readonly session = inject(AdminSessionService);
  readonly artifactService = inject(SolslotProtocolArtifactService);
  readonly status = signal<AdminSecurityStatus | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly launchSignInRequired = signal(false);
  readonly message = signal<string | null>(null);
  readonly setupStage = signal<RecoverySetupStage>('closed');
  readonly recoveryPhrase = signal('');
  readonly recoveryIdentity = signal<AdminRecoveryPublicIdentity | null>(null);
  readonly challenge = signal<RecoveryDrillChallenge | null>(null);
  readonly backupPassword = signal('');
  readonly backupEnvelope = signal<AdminRecoveryBackupEnvelope | null>(null);
  readonly rotationOpen = signal(false);
  readonly replacementWallet = signal<{ address: string; pubkey: string } | null>(null);
  readonly preparedChange = signal<PreparedKeyChange | null>(null);
  readonly preparedChangeKind = signal<ChangeFlowKind | null>(null);
  readonly recoveryWords = computed(() => this.recoveryPhrase().split(' ').filter(Boolean));

  readonly authoritySlots = [0, 1, 2] as const;
  readonly googleBackupAvailable =
    environment.googleVaultEnabled && environment.chiaNetwork === 'testnet11';

  confirmationPhrase = '';
  remoteProofText = '';
  offlineCopyConfirmed = false;
  driveBackupRequested = this.googleBackupAvailable;
  backupPasswordStored = false;
  changeReceiptConfirmed = false;

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  ngOnDestroy(): void {
    this.clearPrivateSetup();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.loadStatus();
    } catch (error) {
      await this.handleError(error);
    } finally {
      this.loading.set(false);
    }
  }

  async reconnectLaunch(kind: 'injected' | 'walletconnect'): Promise<void> {
    if (!this.launchSecurity || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const wallet = kind === 'injected'
        ? await this.evmWallet.connectInjected()
        : await this.evmWallet.connectWalletConnect({ resetSession: true });
      const current = this.status();
      if (current && wallet.toLowerCase() !== current.actor.wallet.toLowerCase()) {
        throw new Error('Use the same administrator wallet to continue this recovery setup.');
      }
      const challenge = await this.launch.resumeChallenge(wallet);
      if (current && challenge.ceremonyBinding?.ceremonyId !== current.actor.ceremonyId) {
        throw new Error('This sign-in belongs to a different launch. Your recovery setup has not changed.');
      }
      const signature = await this.evmWallet.signLaunchAction(challenge.typedData, challenge.ceremonyBinding);
      await this.launch.resumeLogin(wallet, challenge.nonce, signature);
      await this.loadStatus();
      this.message.set('Signed in. Continue your recovery setup where you left off.');
    } catch (error) {
      await this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async requireLaunchSession(): Promise<void> {
    if (!this.launchSecurity) return;
    // The launch cookie expires independently of the post-genesis admin JWT.
    // Check its authoritative endpoint before the shared security endpoint.
    const workspace = await this.launch.workspace();
    const current = this.status();
    if (workspace.session.setup || !workspace.session.wallet) {
      throw new Error('Finish administrator wallet enrollment before setting up recovery.');
    }
    if (current && (
      workspace.launch.ceremonyId !== current.actor.ceremonyId ||
      workspace.session.slot !== current.actor.slot + 1 ||
      workspace.session.wallet.toLowerCase() !== current.actor.wallet.toLowerCase()
    )) {
      throw new Error('The signed-in administrator changed. Reconnect the original wallet to continue.');
    }
  }

  private async loadStatus(): Promise<void> {
    await this.requireLaunchSession();
    const next = await this.security.status();
    const current = this.status();
    if (this.launchSecurity && current && (
      next.actor.ceremonyId !== current.actor.ceremonyId ||
      next.actor.slot !== current.actor.slot ||
      next.actor.wallet.toLowerCase() !== current.actor.wallet.toLowerCase()
    )) {
      throw new Error('The signed-in administrator changed. Reconnect the original wallet to continue.');
    }
    this.status.set(next);
    this.launchSignInRequired.set(false);
  }

  private async handleError(error: unknown): Promise<void> {
    let sessionExpired = error instanceof HttpErrorResponse && error.status === 401;
    // A cookie can expire between the workspace check and a security request.
    // Confirm this legacy fallback is an expired launch session, not an outage.
    if (this.launchSecurity && error instanceof HttpErrorResponse && error.status === 503 &&
      formatError(error) === 'Admin desk is disabled (no chain-verified admin records).') {
      try {
        await this.launch.workspace();
      } catch (sessionError) {
        sessionExpired = sessionError instanceof HttpErrorResponse && sessionError.status === 401;
      }
    }
    if (this.launchSecurity && sessionExpired) {
      this.launchSignInRequired.set(true);
      this.error.set(null);
      this.message.set(null);
      return;
    }
    this.error.set(formatError(error));
  }

  beginRecoverySetup(): void {
    this.error.set(null);
    this.message.set(null);
    this.clearPrivateSetup();
    try {
      const created = this.recoveryKit.create();
      this.recoveryPhrase.set(created.mnemonic);
      this.recoveryIdentity.set({
        recoveryBlsPubkey: created.recoveryBlsPubkey,
        evmGuardian: created.evmGuardian,
      });
      this.setupStage.set('phrase');
    } catch (error) {
      this.error.set(formatError(error));
    }
  }

  cancelSetup(): void {
    this.clearPrivateSetup();
    this.setupStage.set('closed');
    this.message.set('Recovery setup was canceled. No recovery secret was saved by Solslot.');
  }

  async prepareRecoveryDrill(current: AdminSecurityStatus): Promise<void> {
    await this.run(async () => {
      const mnemonic = normalizeWords(this.recoveryPhrase());
      if (!this.offlineCopyConfirmed) {
        throw new Error('Confirm that you made and checked the offline copy.');
      }
      if (normalizeWords(this.confirmationPhrase) !== mnemonic) {
        throw new Error('The confirmation does not match the 24-word recovery phrase.');
      }
      const identity = this.recoveryIdentity();
      if (!identity) throw new Error('Create the recovery kit again.');
      const challenge = await this.security.prepareRecoveryDrill(
        identity.evmGuardian,
        identity.recoveryBlsPubkey,
      );
      this.challenge.set(challenge);
      if (this.driveBackupRequested) {
        const password = this.recoveryKit.generateBackupPassword();
        const envelope = await this.backupCrypto.encrypt({
          mnemonic,
          password,
          ceremonyId: current.actor.ceremonyId,
          slot: current.actor.slot,
          revision: challenge.revision,
          recoveryBlsPubkey: identity.recoveryBlsPubkey,
          evmGuardian: identity.evmGuardian,
        });
        this.backupPassword.set(password);
        this.backupEnvelope.set(envelope);
      }
      this.recoveryKit.clear();
      this.setupStage.set('verify');
      this.message.set('The one-time recovery test is ready for your second device.');
    });
  }

  async completeRecoverySetup(current: AdminSecurityStatus): Promise<void> {
    await this.run(async () => {
      const drill = this.challenge();
      if (!drill) throw new Error('Prepare a fresh recovery test first.');
      const proof = parseAdminRecoveryDrillResult(this.remoteProofText, drill.challengeId);
      let backup: {
        status: 'NOT_CONFIGURED' | 'VERIFIED';
        revision?: number;
        ciphertextHash?: string;
      } = { status: 'NOT_CONFIGURED' };

      if (this.driveBackupRequested) {
        if (!this.backupPasswordStored) {
          throw new Error('Confirm that the separate six-word Drive password is stored.');
        }
        const envelope = this.backupEnvelope();
        if (!envelope) throw new Error('Prepare the encrypted Drive backup again.');
        const existing = await this.recoveryDrive.load({
          ceremonyId: current.actor.ceremonyId,
          slot: current.actor.slot,
        });
        if (existing) {
          await this.recoveryDrive.replace(envelope, {
            ceremonyId: current.actor.ceremonyId,
            slot: current.actor.slot,
          });
        } else {
          await this.recoveryDrive.create(envelope);
        }
        backup = {
          status: 'VERIFIED',
          revision: envelope.revision,
          ciphertextHash: await this.recoveryDrive.ciphertextHash(envelope),
        };
      }

      const result = await this.security.completeRecoveryDrill({
        challengeId: drill.challengeId,
        evmSignature: proof.evmSignature,
        blsSignature: proof.blsSignature,
        offlineCopyConfirmed: true,
        secondDeviceConfirmed: true,
        backup,
      });
      this.clearPrivateSetup();
      this.setupStage.set('closed');
      await this.reload();
      this.message.set(
        result.recoveryKitCandidate
          ? 'Recovery test passed. Connect your current daily wallet to activate the new kit.'
          : result.notice,
      );
    });
  }

  beginRoutineRotation(): void {
    this.error.set(null);
    this.message.set(null);
    this.cancelChangeFlow();
    this.rotationOpen.set(true);
  }

  cancelChangeFlow(): void {
    this.rotationOpen.set(false);
    this.replacementWallet.set(null);
    this.preparedChange.set(null);
    this.preparedChangeKind.set(null);
    this.changeReceiptConfirmed = false;
  }

  async connectReplacementWallet(mode: 'injected' | 'walletconnect'): Promise<void> {
    await this.run(async () => {
      if (mode === 'walletconnect') {
        await this.evmWallet.connectWalletConnect({
          optionalChains: 'solslot',
          resetSession: true,
        });
      } else {
        await this.evmWallet.connectInjected();
      }
      const replacement = await this.evmWallet.recoverFirstAdminPubkey();
      const current = this.status();
      if (
        current &&
        replacement.address.toLowerCase() === current.actor.wallet.toLowerCase()
      ) {
        throw new Error('Choose a different wallet as the replacement.');
      }
      this.replacementWallet.set(replacement);
      this.message.set('Replacement wallet verified. Switch to the current administrator wallet.');
    });
  }

  async prepareRoutineChange(current: AdminSecurityStatus): Promise<void> {
    const replacement = this.replacementWallet();
    if (!replacement) {
      this.error.set('Connect and verify the replacement wallet first.');
      return;
    }
    await this.run(async () => {
      await this.connectCurrentWallet(current);
      const prepared = await this.security.prepareRoutine(replacement.pubkey);
      this.validatePreparedChange(prepared, current, 'ROUTINE', {
        newWallet: replacement.address,
      });
      this.preparedChange.set(prepared);
      this.preparedChangeKind.set('ROUTINE');
      this.changeReceiptConfirmed = false;
      this.rotationOpen.set(false);
      this.message.set('The exact wallet rotation is ready for your review.');
    });
  }

  async prepareRecoveryKitChange(
    current: AdminSecurityStatus,
    candidate: AdminRecoveryKitCandidate,
  ): Promise<void> {
    await this.run(async () => {
      await this.connectCurrentWallet(current);
      const prepared = await this.security.prepareRecoveryKit(candidate.challengeId);
      this.validatePreparedChange(prepared, current, 'RECOVERY_KIT', {
        newGuardian: candidate.evmGuardian,
        newRecoveryBlsKey: candidate.recoveryBlsPubkey,
      });
      this.preparedChange.set(prepared);
      this.preparedChangeKind.set('RECOVERY_KIT');
      this.changeReceiptConfirmed = false;
      this.message.set('The exact recovery-kit replacement is ready for your review.');
    });
  }

  async submitPreparedChange(current: AdminSecurityStatus): Promise<void> {
    const prepared = this.preparedChange();
    const kind = this.preparedChangeKind();
    if (!prepared || !kind || !this.changeReceiptConfirmed) {
      this.error.set('Review and confirm the decision receipt first.');
      return;
    }
    await this.run(async () => {
      await this.requireCurrentWallet(current);
      if (prepared.intent.expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new Error('This prepared change expired. Prepare it again.');
      }
      const transactionHash = await this.evmWallet.sendBaseSepoliaTransaction(
        prepared.prepareTransaction,
      );
      await this.security.submitPrepared(kind, {
        intent: prepared.intent,
        transactionHash,
      });
      this.cancelChangeFlow();
      await this.reload();
      this.message.set(
        'Protected change started. Administrator operations are paused while the team reviews it.',
      );
    });
  }

  async copyDrillPackage(drill: RecoveryDrillChallenge): Promise<void> {
    await this.copyText(
      JSON.stringify(createAdminRecoveryDrillPackage(drill)),
    );
    this.message.set('The one-time recovery test was copied. It contains no secret.');
  }

  async copyBackupPassword(): Promise<void> {
    const value = this.backupPassword();
    if (!value) return;
    await this.copyText(value);
    this.message.set('The separate six-word backup password was copied.');
  }

  kitForSlot(current: AdminSecurityStatus, slot: 0 | 1 | 2) {
    return current.recoveryKits.find((kit) => kit.slot === slot) ?? null;
  }

  caseTitle(recovery: AdminRecoveryCase): string {
    return {
      ROUTINE: 'Daily wallet replacement in progress',
      LOST: 'Lost-wallet recovery in progress',
      RECOVERY_KIT: 'Recovery-kit replacement in progress',
    }[recovery.kind];
  }

  caseHelp(recovery: AdminRecoveryCase): string {
    if (recovery.state === 'PARTIAL') {
      return 'One chain has changed and every other administrator operation remains paused. Finish the exact matching transition or cancel both sides.';
    }
    if (!recovery.approvalsComplete) {
      return 'The exact replacement is waiting for the required administrator and replacement-wallet approvals.';
    }
    if (!recovery.delayComplete) {
      return 'Approvals are recorded. The old key can still veto this change during the safety delay.';
    }
    return 'The safety delay has passed. Either administrator may complete the exact committed change.';
  }

  stateLabel(value: string): string {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  countdown(executeAfter: number): string {
    const seconds = Math.max(0, executeAfter - Math.floor(Date.now() / 1000));
    if (seconds === 0) return 'Ready to complete';
    const days = Math.floor(seconds / 86_400);
    const hours = Math.ceil((seconds % 86_400) / 3600);
    return days ? `${days} day${days === 1 ? '' : 's'}, ${hours} hours` : `${hours} hours`;
  }

  delayLabel(seconds: number): string {
    if (seconds % 86_400 === 0) {
      const days = seconds / 86_400;
      return `${days} day${days === 1 ? '' : 's'}`;
    }
    const hours = Math.ceil(seconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  formatTime(epoch: number): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(epoch * 1000);
  }

  short(value: string): string {
    return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      await this.requireLaunchSession();
      await operation();
    } catch (error) {
      await this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async connectCurrentWallet(current: AdminSecurityStatus): Promise<void> {
    const connected = this.evmWallet.address();
    if (!connected || connected.toLowerCase() !== current.actor.wallet.toLowerCase()) {
      await this.evmWallet.connectInjected();
    }
    await this.requireCurrentWallet(current);
  }

  private async requireCurrentWallet(current: AdminSecurityStatus): Promise<void> {
    const connected = this.evmWallet.address();
    if (!connected || connected.toLowerCase() !== current.actor.wallet.toLowerCase()) {
      throw new Error(
        `Connect the current administrator wallet ${this.short(current.actor.wallet)}.`,
      );
    }
  }

  private validatePreparedChange(
    prepared: PreparedKeyChange,
    current: AdminSecurityStatus,
    kind: ChangeFlowKind,
    expected: {
      newWallet?: string;
      newGuardian?: string;
      newRecoveryBlsKey?: string;
    },
  ): void {
    if (
      prepared.intent.kind !== kind ||
      prepared.intent.slot !== current.actor.slot ||
      prepared.clearSigning.slot !== current.actor.slot ||
      prepared.intent.oldDailyEvmKey.toLowerCase() !== current.actor.wallet.toLowerCase() ||
      prepared.clearSigning.oldWallet.toLowerCase() !== current.actor.wallet.toLowerCase() ||
      prepared.clearSigning.financialEffect !== 'No funds move.' ||
      prepared.clearSigning.operationsFreeze !== true ||
      prepared.clearSigning.oldKeyCanVeto !== true
    ) {
      throw new Error('The prepared key change does not match this administrator slot.');
    }
    if (
      expected.newWallet &&
      (prepared.intent.newDailyEvmKey.toLowerCase() !== expected.newWallet.toLowerCase() ||
        prepared.clearSigning.newWallet.toLowerCase() !== expected.newWallet.toLowerCase())
    ) {
      throw new Error('The prepared change does not match the selected replacement wallet.');
    }
    if (
      expected.newGuardian &&
      prepared.intent.newRecoveryGuardian.toLowerCase() !== expected.newGuardian.toLowerCase()
    ) {
      throw new Error('The prepared change does not match the tested recovery guardian.');
    }
    if (
      expected.newRecoveryBlsKey &&
      prepared.intent.newRecoveryBlsKey.toLowerCase() !==
        expected.newRecoveryBlsKey.toLowerCase()
    ) {
      throw new Error('The prepared change does not match the tested Chia recovery key.');
    }
  }

  private clearPrivateSetup(): void {
    this.recoveryKit.clear();
    this.recoveryPhrase.set('');
    this.recoveryIdentity.set(null);
    this.challenge.set(null);
    this.backupPassword.set('');
    this.backupEnvelope.set(null);
    this.confirmationPhrase = '';
    this.remoteProofText = '';
    this.offlineCopyConfirmed = false;
    this.backupPasswordStored = false;
  }

  private async copyText(value: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard access is unavailable. Select and copy the text manually.');
    }
    await navigator.clipboard.writeText(value);
  }
}

function normalizeWords(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
