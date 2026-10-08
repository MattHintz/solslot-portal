import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { computeAddress } from 'ethers';

import {
  createAdminLostRecoveryPackage,
  parseAdminLostRecoveryResult,
} from '../../../services/admin-recovery-handoff';
import {
  AdminRecoveryCase,
  AdminSecurityService,
  PreparedKeyChange,
} from '../../../services/admin-security.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { SolslotProtocolArtifactService } from '../../../services/solslot-protocol-artifact.service';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'solslot-admin-lost-recovery',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="recovery-page">
      <header>
        <div>
          <span class="eyebrow">Protected administrator recovery</span>
          <h1>Replace a lost daily wallet</h1>
          <p>
            Your offline recovery kit authorizes one exact replacement. The replacement wallet
            pays the Base Sepolia fee; Solslot never receives your recovery phrase.
          </p>
        </div>
        <a routerLink="/admin/login">Return to sign-in</a>
      </header>

      <section class="safety">
        <strong>Stop if anyone is coaching you live</strong>
        <span>
          Close screen sharing and calls. No Solslot employee will ask for your 24 words,
          six-word backup password, or private keys.
        </span>
      </section>

      @if (error(); as detail) {
        <section class="notice notice--error" role="alert">
          <strong>Recovery stopped</strong>
          <span>{{ detail }}</span>
        </section>
      }
      @if (message(); as detail) {
        <section class="notice" role="status">
          <strong>Recovery update</strong>
          <span>{{ detail }}</span>
        </section>
      }

      @if (completedCase(); as recovery) {
        <section class="complete-panel">
          <span class="step">Request recorded</span>
          <h2>The seven-day safety period has started</h2>
          <p>
            Both other administrators must approve the exact replacement. The old wallet may
            veto it. Privileged operations remain paused until Chia and Base Sepolia match.
          </p>
          <dl>
            <div><dt>Administrator slot</dt><dd>{{ recovery.slot + 1 }}</dd></div>
            <div><dt>Replacement wallet</dt><dd>{{ recovery.intent.newDailyEvmKey }}</dd></div>
            <div><dt>Funds moved</dt><dd>None</dd></div>
            <div><dt>Case ID</dt><dd>{{ recovery.caseId }}</dd></div>
          </dl>
          <a class="primary" routerLink="/admin/login">Return to administrator sign-in</a>
        </section>
      } @else {
        <ol class="progress" aria-label="Recovery progress">
          <li [class.is-current]="!replacementPubkey()"><span>1</span>Replacement wallet</li>
          <li [class.is-current]="replacementPubkey() && !prepared()"><span>2</span>Review request</li>
          <li [class.is-current]="prepared()"><span>3</span>Offline approval</li>
        </ol>

        @if (!replacementPubkey()) {
          <section class="work-panel">
            <span class="step">Step 1</span>
            <h2>Connect the replacement wallet</h2>
            <p>
              Use a new wallet that you control. A signature proves its public key; no funds
              move. Keep the old wallet available if it is later recovered so it can veto.
            </p>

            <label>
              Administrator identity
              <select [(ngModel)]="selectedSlot">
                <option [ngValue]="0">Owner, administrator 1</option>
                <option [ngValue]="1">Coadministrator 2</option>
                <option [ngValue]="2">Coadministrator 3</option>
              </select>
            </label>

            <div class="wallet-actions">
              <button
                type="button"
                class="primary"
                [disabled]="busy() || !wallet.hasInjectedProvider()"
                data-ux-action="connect_wallet" (click)="connectReplacement('injected')"
              >
                Browser wallet
              </button>
              <button
                type="button"
                class="secondary"
                [disabled]="busy()"
                data-ux-action="connect_wallet" (click)="connectReplacement('walletconnect')"
              >
                Mobile or hardware wallet
              </button>
            </div>
            <p class="fine-print">
              MetaMask, Rabby, Coinbase Wallet, WalletConnect, Tangem, and compatible hardware
              wallets may be used.
            </p>
          </section>
        } @else if (!prepared()) {
          <section class="receipt">
            <span class="step">Step 2</span>
            <h2>Review the replacement</h2>
            <dl>
              <div><dt>Administrator slot</dt><dd>{{ selectedSlot + 1 }}</dd></div>
              <div><dt>Current wallet</dt><dd>{{ currentWallet() }}</dd></div>
              <div><dt>Replacement wallet</dt><dd>{{ replacementAddress() }}</dd></div>
              <div><dt>Safety delay</dt><dd>7 days</dd></div>
              <div><dt>Required approval</dt><dd>Both other administrators</dd></div>
              <div><dt>Funds moved</dt><dd>None</dd></div>
            </dl>
            <p>
              Starting recovery pauses every privileged Chia and EVM operation. It cannot
              change the owner-plus-one rule, treasury, or protocol destinations.
            </p>
            <div class="actions">
              <button type="button" class="secondary" (click)="resetReplacement()">
                Use another wallet
              </button>
              <button
                type="button"
                class="primary"
                [disabled]="busy()"
                (click)="prepareRecovery()"
              >
                {{ busy() ? 'Checking...' : 'Prepare exact recovery' }}
              </button>
            </div>
          </section>
        } @else if (prepared(); as request) {
          <section class="work-panel">
            <span class="step">Step 3</span>
            <h2>Authorize with the offline recovery kit</h2>
            <p>
              Move only the public package below to a separate trusted device. Enter the
              24-word phrase only on the standalone page, then bring back its signed result.
            </p>
            <div class="package-actions">
              <a
                class="primary"
                routerLink="/recover-admin-access"
                target="_blank"
                rel="noopener"
              >
                Open offline recovery page
              </a>
              <button type="button" class="secondary" (click)="copyPackage(request)">
                Copy recovery package
              </button>
            </div>
            <label>
              Signed result from the trusted device
              <textarea
                [(ngModel)]="signedResultText"
                rows="6"
                autocomplete="off"
                spellcheck="false"
                placeholder="Paste the public signed recovery result"
              ></textarea>
            </label>
            <label class="check-row">
              <input type="checkbox" [(ngModel)]="receiptConfirmed" />
              <span>
                I verified the administrator slot, replacement wallet, seven-day delay, and
                zero-funds receipt on the trusted device.
              </span>
            </label>
            <div class="actions">
              <button type="button" class="secondary" (click)="cancelPrepared()">
                Cancel before submission
              </button>
              <button
                type="button"
                class="primary"
                [disabled]="busy() || !receiptConfirmed"
                data-ux-action="submit_proposal" (click)="submitRecovery(request)"
              >
                {{ busy() ? 'Submitting...' : 'Submit protected recovery' }}
              </button>
            </div>
            <details>
              <summary>Advanced intent evidence</summary>
              <code>{{ request.intentHash }}</code>
              <code>{{ request.coordinator }}</code>
            </details>
          </section>
        }
      }

      <footer>
        <strong>No provider reset</strong>
        <span>
          If both the daily wallet and its recovery kit are unavailable, Solslot, Google,
          validators, and server operators cannot replace that administrator.
        </span>
      </footer>
    </main>
  `,
  styles: [
    `
      :host { display:block; min-height:100vh; background:#06110f; color:#effbf6; }
      .recovery-page { width:min(860px,calc(100% - 32px)); margin:0 auto; padding:40px 0 72px; }
      header { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding-bottom:22px; border-bottom:1px solid #285346; }
      header p { max-width:650px; margin:7px 0 0; color:#a9c2b8; line-height:1.55; }
      header a { flex:0 0 auto; color:#79e6b5; font-size:12px; }
      h1,h2,p { letter-spacing:0; } h1 { margin:6px 0 0; font-size:34px; } h2 { margin:5px 0 0; font-size:22px; }
      .eyebrow,.step { color:#6ee5b1; font:700 10px/1.2 var(--font-mono); text-transform:uppercase; }
      .safety,.notice { display:grid; gap:4px; margin-top:16px; padding:14px 16px; border-left:3px solid #e0bd54; background:#24200f; }
      .safety span,.notice span { color:#c7cbb9; font-size:12px; line-height:1.5; }
      .notice { border:1px solid #38705d; border-left-width:3px; background:#0d261f; }
      .notice--error { border-color:#a55757; background:#2b1515; color:#ffc0b7; }
      .progress { display:grid; grid-template-columns:repeat(3,1fr); gap:1px; margin:16px 0 0; padding:0; background:#254f42; list-style:none; }
      .progress li { display:flex; align-items:center; gap:8px; padding:12px; background:#091a16; color:#89a69b; font-size:12px; }
      .progress li span { display:grid; place-items:center; width:24px; height:24px; border:1px solid #416c5d; }
      .progress .is-current { color:#eefbf5; background:#123126; } .progress .is-current span { border-color:#75e9b5; color:#75e9b5; }
      .work-panel,.receipt,.complete-panel,footer { margin-top:16px; padding:20px; border:1px solid #285346; background:#091a16; }
      .work-panel > p,.receipt > p,.complete-panel > p { margin:7px 0 0; color:#a9c2b8; font-size:13px; line-height:1.55; }
      label { display:grid; gap:7px; margin-top:18px; color:#dcece6; font-size:12px; font-weight:700; }
      select,textarea { box-sizing:border-box; width:100%; padding:12px; border:1px solid #3c6e5d; border-radius:3px; background:#05100d; color:#effbf6; }
      textarea { resize:vertical; font:12px/1.5 var(--font-mono); }
      select:focus,textarea:focus,input:focus,button:focus,a:focus { outline:2px solid #73e7b2; outline-offset:2px; }
      .wallet-actions,.actions,.package-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:9px; margin-top:18px; }
      button,.primary,.secondary { display:inline-flex; align-items:center; justify-content:center; min-height:42px; padding:9px 14px; border:1px solid #4f8d77; border-radius:4px; font-weight:700; text-decoration:none; cursor:pointer; }
      button:disabled { cursor:not-allowed; opacity:.48; }
      .primary { border-color:#75e9b5; background:#75e9b5; color:#062018; }
      .secondary { background:#102a22; color:#effbf6; }
      .fine-print { color:#829b91 !important; font-size:11px !important; }
      dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; margin:16px 0 0; background:#285346; }
      dl div { padding:12px; background:#071511; }
      dt { color:#82a99a; font:10px var(--font-mono); text-transform:uppercase; } dd { margin:4px 0 0; overflow-wrap:anywhere; color:#e8f7f1; font-size:12px; }
      .check-row { display:flex; align-items:flex-start; gap:10px; font-weight:400; }
      .check-row input { width:18px; height:18px; accent-color:#6ee5b1; }
      details { margin-top:16px; color:#9ec5b5; } details summary { cursor:pointer; } details code { display:block; margin-top:8px; overflow-wrap:anywhere; color:#79e6b5; font-size:10px; }
      .complete-panel { border-color:#4f8d77; background:#0d251e; } .complete-panel .primary { margin-top:18px; }
      footer { display:grid; gap:4px; } footer span { color:#9fb6ad; font-size:12px; line-height:1.5; }
      @media (max-width:640px) { header { align-items:flex-start; flex-direction:column; } .progress,dl { grid-template-columns:1fr; } }
    `,
  ],
})
export class AdminLostRecoveryComponent implements OnInit {
  readonly wallet = inject(EvmWalletService);
  private readonly security = inject(AdminSecurityService);
  private readonly artifactService = inject(SolslotProtocolArtifactService);

  readonly replacementPubkey = signal('');
  readonly replacementAddress = signal('');
  readonly prepared = signal<PreparedKeyChange | null>(null);
  readonly completedCase = signal<AdminRecoveryCase | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  selectedSlot: 0 | 1 | 2 = 0;
  signedResultText = '';
  receiptConfirmed = false;

  async ngOnInit(): Promise<void> {
    if (!this.artifactService.isReady) {
      await this.artifactService.initialize();
    }
    if (!this.artifactService.isReady) {
      this.error.set(
        this.artifactService.failure ||
          'The signed Authority V3 release is not available.',
      );
    }
  }

  currentWallet(): string {
    const identity =
      this.artifactService.artifact?.adminAuthority.identityVaults[
        this.selectedSlot
      ];
    return identity ? computeAddress(identity.dailyCompressedPubkey) : 'Unavailable';
  }

  async connectReplacement(
    kind: 'injected' | 'walletconnect',
  ): Promise<void> {
    await this.run(async () => {
      if (kind === 'injected') {
        await this.wallet.connectInjected();
      } else {
        await this.wallet.connectWalletConnect({
          optionalChains: 'solslot',
          resetSession: true,
        });
      }
      const replacement = await this.wallet.recoverFirstAdminPubkey();
      const current = this.currentWallet();
      if (replacement.address.toLowerCase() === current.toLowerCase()) {
        throw new Error('Choose a new wallet, not the wallet being replaced.');
      }
      this.replacementAddress.set(replacement.address);
      this.replacementPubkey.set(replacement.pubkey);
      this.message.set('Replacement wallet verified. Review it before continuing.');
    });
  }

  async prepareRecovery(): Promise<void> {
    await this.run(async () => {
      const artifact = this.requireArtifact();
      const replacementPubkey = this.replacementPubkey();
      if (!replacementPubkey) throw new Error('Connect the replacement wallet first.');
      const kit = artifact.adminAuthority.recoveryKits[this.selectedSlot];
      const prepared = await this.security.prepareLost({
        ceremonyId: artifact.ceremony.ceremonyId,
        slot: this.selectedSlot,
        evmGuardian: kit.evmGuardian,
        recoveryBlsPubkey: kit.recoveryBlsPubkey,
        newDailyCompressedPubkey: replacementPubkey,
      });
      if (
        prepared.intent.slot !== this.selectedSlot ||
        prepared.intent.newDailyEvmKey.toLowerCase() !==
          this.replacementAddress().toLowerCase()
      ) {
        throw new Error('The prepared recovery differs from the reviewed replacement.');
      }
      createAdminLostRecoveryPackage(prepared);
      this.prepared.set(prepared);
      this.message.set('Exact recovery prepared. Authorize it on the trusted device.');
    });
  }

  async copyPackage(prepared: PreparedKeyChange): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable.');
      }
      await navigator.clipboard.writeText(
        JSON.stringify(createAdminLostRecoveryPackage(prepared)),
      );
      this.message.set('Public recovery package copied. It contains no secret.');
    } catch (error) {
      this.error.set(formatError(error));
    }
  }

  async submitRecovery(prepared: PreparedKeyChange): Promise<void> {
    await this.run(async () => {
      if (!this.receiptConfirmed) {
        throw new Error('Confirm the trusted-device receipt first.');
      }
      if (
        this.wallet.address()?.toLowerCase() !==
        prepared.intent.newDailyEvmKey.toLowerCase()
      ) {
        throw new Error('Reconnect the exact replacement wallet before submission.');
      }
      const signed = parseAdminLostRecoveryResult(
        this.signedResultText,
        prepared.intentHash,
      );
      const authorized = await this.security.authorizeLost({
        intent: prepared.intent,
        guardianSignature: signed.guardianSignature,
      });
      if (
        authorized.intentHash.toLowerCase() !== prepared.intentHash.toLowerCase() ||
        authorized.guardianSigner.toLowerCase() !==
          prepared.intent.oldRecoveryGuardian.toLowerCase()
      ) {
        throw new Error('The recovery relay authorization differs from the reviewed intent.');
      }
      const transactionHash = await this.wallet.sendBaseSepoliaTransaction(
        authorized.relayTransaction,
      );
      const recovery = await this.security.submitPrepared('LOST', {
        intent: prepared.intent,
        transactionHash,
        guardianSignature: signed.guardianSignature,
        recoveryBlsSignature: signed.recoveryBlsSignature,
      });
      this.completedCase.set(recovery);
      this.signedResultText = '';
      this.receiptConfirmed = false;
      this.message.set('Protected recovery recorded. The safety period is active.');
    });
  }

  resetReplacement(): void {
    this.replacementPubkey.set('');
    this.replacementAddress.set('');
    this.prepared.set(null);
    this.signedResultText = '';
    this.receiptConfirmed = false;
    this.error.set(null);
    this.message.set('Replacement selection cleared.');
  }

  cancelPrepared(): void {
    this.prepared.set(null);
    this.signedResultText = '';
    this.receiptConfirmed = false;
    this.message.set('The unsigned recovery request was cleared. Nothing was submitted.');
  }

  private requireArtifact() {
    const artifact = this.artifactService.artifact;
    if (!artifact) {
      throw new Error(
        this.artifactService.failure ||
          'The signed Authority V3 release is unavailable.',
      );
    }
    return artifact;
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
