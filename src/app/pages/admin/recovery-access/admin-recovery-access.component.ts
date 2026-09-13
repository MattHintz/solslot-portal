import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { getAddress } from 'ethers';

import {
  AdminChiaRecoveryActionPackage,
  AdminLostRecoveryPackage,
  AdminRecoveryDrillPackage,
  AdminRecoveryGuardianActionPackage,
  createAdminChiaRecoveryActionResult,
  createAdminLostRecoveryResult,
  createAdminRecoveryDrillResult,
  createAdminRecoveryGuardianActionResult,
  parseAdminChiaRecoveryActionPackage,
  parseAdminLostRecoveryPackage,
  parseAdminRecoveryDrillPackage,
  parseAdminRecoveryGuardianActionPackage,
} from '../../../services/admin-recovery-handoff';
import { AdminRecoveryKitService } from '../../../services/admin-recovery-kit.service';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'solslot-admin-recovery-access',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="recovery-shell">
      <header class="page-header">
        <div>
          <span class="eyebrow">Offline administrator recovery</span>
          <h1>Administrator recovery</h1>
          <p>
            This page checks a recovery request, signs it locally, and returns only public
            signatures. It never contacts the Solslot API.
          </p>
        </div>
        <a routerLink="/admin/genesis">Return to launch</a>
      </header>

      <section class="security-callout">
        <strong>Use a separate trusted device</strong>
        <span>
          Check the Solslot address, close screen sharing, and disconnect if anyone asks to
          watch. Solslot support will never ask for these words.
        </span>
      </section>

      @if (error(); as detail) {
        <section class="notice notice--error" role="alert">
          <strong>Do not continue</strong>
          <span>{{ detail }}</span>
        </section>
      }
      @if (message(); as detail) {
        <section class="notice" role="status">
          <strong>Ready</strong>
          <span>{{ detail }}</span>
        </section>
      }

      @if (
        !reviewedPackage() &&
        !reviewedLostPackage() &&
        !reviewedGuardianPackage() &&
        !reviewedChiaPackage()
      ) {
        <section class="work-panel" aria-labelledby="package-title">
          <span class="step">Step 1 of 3</span>
          <h2 id="package-title">Check the recovery request</h2>
          <p>Paste the public package copied from Security & Access.</p>
          <label>
            Recovery package
            <textarea
              [(ngModel)]="packageText"
              rows="8"
              autocomplete="off"
              spellcheck="false"
              placeholder="Paste the recovery package"
            ></textarea>
          </label>
          <div class="actions">
            <button type="button" class="primary" (click)="reviewPackage()">
              Review request
            </button>
          </div>
        </section>
      } @else {
        @if (reviewedPackage(); as drillPackage) {
          <section class="receipt" aria-labelledby="receipt-title">
            <div>
              <span class="step">Verified test</span>
              <h2 id="receipt-title">Confirm what this signature does</h2>
            </div>
            <dl>
              <div><dt>Purpose</dt><dd>Recovery-kit restore test only</dd></div>
              <div><dt>Funds moved</dt><dd>None</dd></div>
              <div><dt>Authority changed</dt><dd>No</dd></div>
              <div><dt>Administrator slot</dt><dd>{{ administratorSlot(drillPackage) }}</dd></div>
              <div><dt>Daily wallet</dt><dd>{{ dailyWallet(drillPackage) }}</dd></div>
              <div><dt>Expires</dt><dd>{{ expiry(drillPackage) }}</dd></div>
            </dl>
            <details>
              <summary>Advanced checksum</summary>
              <code>{{ drillPackage.checksum }}</code>
              <p>Compare this checksum with the original device before entering the phrase.</p>
            </details>
          </section>
        } @else if (reviewedLostPackage(); as lostPackage) {
          <section class="receipt receipt--recovery" aria-labelledby="receipt-title">
            <div>
              <span class="step">Verified lost-wallet request</span>
              <h2 id="receipt-title">Replace one administrator wallet</h2>
            </div>
            <dl>
              <div><dt>Purpose</dt><dd>Recover lost daily wallet</dd></div>
              <div><dt>Funds moved</dt><dd>None</dd></div>
              <div><dt>Administrator slot</dt><dd>{{ lostPackage.intent.slot + 1 }}</dd></div>
              <div><dt>Replacement wallet</dt><dd>{{ lostPackage.intent.newDailyEvmKey }}</dd></div>
              <div><dt>Safety delay</dt><dd>7 days</dd></div>
              <div><dt>Expires</dt><dd>{{ lostExpiry(lostPackage) }}</dd></div>
            </dl>
            <p>
              Signing starts the exact owner-and-both-coadministrator recovery. All privileged
              operations remain paused until Chia and Base Sepolia match.
            </p>
            <details>
              <summary>Advanced evidence</summary>
              <code>{{ lostPackage.intentHash }}</code>
              <code>{{ lostPackage.checksum }}</code>
              <p>The page recomputed the full intent hash and Chia recovery digest locally.</p>
            </details>
          </section>
        } @else if (reviewedGuardianPackage(); as guardianPackage) {
          <section class="receipt receipt--recovery" aria-labelledby="receipt-title">
            <div>
              <span class="step">Verified recovery-kit request</span>
              <h2 id="receipt-title">
                {{
                  guardianPackage.action === 'ACCEPT'
                    ? 'Approve the new recovery kit'
                    : 'Cancel the recovery-kit replacement'
                }}
              </h2>
            </div>
            <dl>
              <div>
                <dt>Purpose</dt>
                <dd>{{ guardianActionPurpose(guardianPackage) }}</dd>
              </div>
              <div><dt>Funds moved</dt><dd>None</dd></div>
              <div>
                <dt>Administrator slot</dt>
                <dd>{{ guardianPackage.intent.slot + 1 }}</dd>
              </div>
              <div>
                <dt>Recovery guardian</dt>
                <dd>{{ guardianPackage.expectedGuardian }}</dd>
              </div>
              <div><dt>Network</dt><dd>Base Sepolia</dd></div>
              <div>
                <dt>Safety effect</dt>
                <dd>
                  {{
                    guardianPackage.action === 'ACCEPT'
                      ? '24-hour delay continues'
                      : 'Exact replacement is canceled'
                  }}
                </dd>
              </div>
            </dl>
            <p>
              This signature is restricted to this one recovery-kit action. The connected
              wallet on the original device pays gas and receives no recovery authority.
            </p>
            <details>
              <summary>Advanced evidence</summary>
              <code>{{ guardianPackage.intentHash }}</code>
              <code>{{ guardianPackage.checksum }}</code>
            </details>
          </section>
        } @else if (reviewedChiaPackage()) {
          <section class="receipt receipt--recovery" role="status">
            <h2>Chia recovery signing is unavailable</h2>
            <p>This page needs the complete recovery transaction before it can verify and sign it. Do not enter your recovery phrase for this request.</p>
          </section>
        }

        @if (!resultText() && !reviewedChiaPackage()) {
          <section class="work-panel" aria-labelledby="phrase-title">
            <span class="step">Step 2 of 3</span>
            <h2 id="phrase-title">Restore from your offline copy</h2>
            <p>
              Type all 24 words in order. They remain in this page's memory only and are
              cleared immediately after signing.
            </p>
            <label>
              Administrator recovery phrase
              <textarea
                [(ngModel)]="phrase"
                rows="5"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                placeholder="Enter all 24 words in order"
              ></textarea>
            </label>
            <label class="check-row">
              <input type="checkbox" [(ngModel)]="trustedDeviceConfirmed" />
              <span>I am using a trusted second device with no screen sharing.</span>
            </label>
            <div class="actions">
              <button type="button" class="secondary" (click)="reset()">Use another test</button>
              <button
                type="button"
                class="primary"
                [disabled]="busy() || !trustedDeviceConfirmed"
                (click)="signReviewed()"
              >
                {{
                  busy()
                    ? 'Signing locally...'
                    : reviewedLostPackage()
                      ? 'Authorize lost-wallet recovery'
                      : reviewedGuardianPackage()?.action === 'ACCEPT'
                        ? 'Approve recovery kit'
                      : reviewedGuardianPackage()?.action === 'VETO'
                          ? 'Cancel replacement'
                        : reviewedChiaPackage()
                          ? 'Authorize Testnet11 recovery'
                      : 'Sign recovery test'
                }}
              </button>
            </div>
          </section>
        } @else if (resultText()) {
          <section class="work-panel result-panel" aria-labelledby="result-title">
            <span class="step">Step 3 of 3</span>
            <h2 id="result-title">Return the signed result</h2>
            <p>
              The recovery phrase and private keys have been cleared. Copy this public result
              to the original device to continue.
            </p>
            <textarea
              [ngModel]="resultText()"
              rows="6"
              readonly
              spellcheck="false"
              aria-label="Signed administrator recovery result"
            ></textarea>
            <div class="actions">
              <button type="button" class="secondary" (click)="reset()">Clear and close</button>
              <button type="button" class="primary" (click)="copyResult()">Copy signed result</button>
            </div>
          </section>
        }
      }

      <footer>
        <strong>Total-loss rule</strong>
        <span>
          If both the daily wallet and this recovery kit are unavailable, there is no support
          bypass or provider reset.
        </span>
        <a href="recovery-page-manifest.json" download>
          Download this release's recovery-page checksum manifest
        </a>
      </footer>
    </main>
  `,
  styles: [
    `
      :host { display:block; min-height:100vh; background:#06110f; color:#effbf6; }
      .recovery-shell { width:min(780px,calc(100% - 32px)); margin:0 auto; padding:40px 0 70px; }
      .page-header { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding-bottom:22px; border-bottom:1px solid #285346; }
      .page-header p { max-width:590px; margin:7px 0 0; color:#a9c2b8; line-height:1.55; }
      .page-header a { flex:0 0 auto; color:#79e6b5; font-size:12px; }
      h1,h2,p { letter-spacing:0; } h1 { margin:6px 0 0; font-size:34px; } h2 { margin:5px 0 0; font-size:21px; }
      .eyebrow,.step { color:#6ee5b1; font:700 10px/1.2 var(--font-mono); text-transform:uppercase; }
      .security-callout,.notice { display:grid; gap:4px; margin-top:16px; padding:14px 16px; border-left:3px solid #e0bd54; background:#24200f; }
      .security-callout span,.notice span { color:#c7cbb9; font-size:12px; line-height:1.5; }
      .notice { border:1px solid #38705d; border-left-width:3px; background:#0d261f; }
      .notice--error { border-color:#a55757; background:#2b1515; color:#ffc0b7; }
      .work-panel,.receipt,footer { margin-top:16px; padding:20px; border:1px solid #285346; background:#091a16; }
      .work-panel > p,.receipt > p { margin:7px 0 0; color:#a9c2b8; font-size:13px; line-height:1.55; }
      label { display:grid; gap:7px; margin-top:18px; color:#dcece6; font-size:12px; font-weight:700; }
      textarea { box-sizing:border-box; width:100%; padding:12px; resize:vertical; border:1px solid #3c6e5d; border-radius:3px; background:#05100d; color:#effbf6; font:12px/1.5 var(--font-mono); }
      textarea:focus,input:focus,button:focus,a:focus { outline:2px solid #73e7b2; outline-offset:2px; }
      .actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:9px; margin-top:18px; }
      button { min-height:40px; padding:9px 14px; border:1px solid #4f8d77; border-radius:4px; font-weight:700; cursor:pointer; }
      button:disabled { cursor:not-allowed; opacity:.48; }
      .primary { border-color:#75e9b5; background:#75e9b5; color:#062018; }
      .secondary { background:#102a22; color:#effbf6; }
      .receipt { border-color:#4b826f; background:#0c251e; }
      .receipt--recovery { border-color:#d4ad48; }
      .receipt dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; margin:16px 0 0; background:#285346; }
      .receipt dl div { padding:12px; background:#071511; }
      dt { color:#82a99a; font:10px var(--font-mono); text-transform:uppercase; } dd { margin:4px 0 0; overflow-wrap:anywhere; color:#e8f7f1; font-size:12px; }
      details { margin-top:14px; color:#9ec5b5; } details summary { cursor:pointer; } details code { display:block; margin-top:9px; overflow-wrap:anywhere; color:#79e6b5; font-size:10px; }
      details p { margin:6px 0 0; color:#98afa6; font-size:11px; }
      .check-row { display:flex; align-items:flex-start; gap:10px; font-weight:400; }
      .check-row input { width:18px; height:18px; accent-color:#6ee5b1; }
      .result-panel { border-color:#4f8d77; }
      footer { display:grid; gap:4px; color:#d8e9e2; } footer span { color:#9fb6ad; font-size:12px; line-height:1.5; } footer a { width:max-content; margin-top:6px; color:#79e6b5; font-size:11px; }
      @media (max-width:620px) { .page-header { align-items:flex-start; flex-direction:column; } .receipt dl { grid-template-columns:1fr; } }
    `,
  ],
})
export class AdminRecoveryAccessComponent implements OnDestroy {
  private readonly recoveryKit = inject(AdminRecoveryKitService);

  readonly reviewedPackage = signal<AdminRecoveryDrillPackage | null>(null);
  readonly reviewedLostPackage = signal<AdminLostRecoveryPackage | null>(null);
  readonly reviewedGuardianPackage =
    signal<AdminRecoveryGuardianActionPackage | null>(null);
  readonly reviewedChiaPackage =
    signal<AdminChiaRecoveryActionPackage | null>(null);
  readonly resultText = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  packageText = '';
  phrase = '';
  trustedDeviceConfirmed = false;

  ngOnDestroy(): void {
    this.clearSecrets();
  }

  reviewPackage(): void {
    this.clearSecrets();
    this.resultText.set('');
    this.reviewedPackage.set(null);
    this.reviewedLostPackage.set(null);
    this.reviewedGuardianPackage.set(null);
    this.reviewedChiaPackage.set(null);
    this.trustedDeviceConfirmed = false;
    this.error.set(null);
    this.message.set(null);
    try {
      const envelope = JSON.parse(this.packageText) as { purpose?: unknown };
      if (envelope.purpose === 'Solslot administrator lost-wallet recovery') {
        const parsed = parseAdminLostRecoveryPackage(this.packageText);
        if (parsed.intent.expiresAt <= Math.floor(Date.now() / 1000)) {
          throw new Error('This lost-wallet recovery has expired. Prepare a new one.');
        }
        this.reviewedLostPackage.set(parsed);
        this.reviewedPackage.set(null);
        this.reviewedGuardianPackage.set(null);
      } else if (
        envelope.purpose ===
        'Solslot administrator recovery-kit guardian action'
      ) {
        const parsed = parseAdminRecoveryGuardianActionPackage(this.packageText);
        if (parsed.intent.expiresAt <= Math.floor(Date.now() / 1000)) {
          throw new Error('This recovery-kit action has expired. Prepare a new one.');
        }
        this.reviewedGuardianPackage.set(parsed);
        this.reviewedLostPackage.set(null);
        this.reviewedPackage.set(null);
        this.reviewedChiaPackage.set(null);
      } else if (
        envelope.purpose ===
        'Solslot administrator Testnet11 recovery action'
      ) {
        const parsed = parseAdminChiaRecoveryActionPackage(this.packageText);
        if (parsed.intent.expiresAt <= Math.floor(Date.now() / 1000)) {
          throw new Error('This Testnet11 recovery action has expired. Prepare a new one.');
        }
        this.reviewedChiaPackage.set(parsed);
        this.reviewedGuardianPackage.set(null);
        this.reviewedLostPackage.set(null);
        this.reviewedPackage.set(null);
      } else {
        const parsed = parseAdminRecoveryDrillPackage(this.packageText);
        if (parsed.challenge.expiresAt <= Math.floor(Date.now() / 1000)) {
          throw new Error('This one-time recovery test has expired. Prepare a new one.');
        }
        this.reviewedPackage.set(parsed);
        this.reviewedLostPackage.set(null);
        this.reviewedGuardianPackage.set(null);
        this.reviewedChiaPackage.set(null);
      }
      this.packageText = '';
      this.message.set(
        'The package fields were checked. Review the receipt; your recovery key will be checked before signing.',
      );
    } catch (error) {
      this.error.set(formatError(error));
    }
  }

  async signReviewed(): Promise<void> {
    const drillPackage = this.reviewedPackage();
    if (drillPackage) {
      await this.signTest(drillPackage);
      return;
    }
    const lostPackage = this.reviewedLostPackage();
    if (lostPackage) {
      await this.signLostRecovery(lostPackage);
      return;
    }
    const guardianPackage = this.reviewedGuardianPackage();
    if (guardianPackage) {
      await this.signGuardianAction(guardianPackage);
      return;
    }
    const chiaPackage = this.reviewedChiaPackage();
    if (chiaPackage) {
      await this.signChiaRecovery(chiaPackage);
      return;
    }
    this.error.set('Review a recovery package first.');
  }

  async signTest(drillPackage: AdminRecoveryDrillPackage): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      if (!this.trustedDeviceConfirmed) {
        throw new Error('Confirm that this is a trusted second device.');
      }
      if (drillPackage.challenge.expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new Error('This one-time recovery test has expired. Prepare a new one.');
      }
      const guardian = String(
        drillPackage.challenge.evmTypedData.message['evmGuardian'] || '',
      );
      this.recoveryKit.unlock(this.phrase, { evmGuardian: getAddress(guardian) });
      const signatures = await this.recoveryKit.signDrill(drillPackage.challenge);
      this.resultText.set(
        JSON.stringify(
          createAdminRecoveryDrillResult(drillPackage.challenge.challengeId, signatures),
        ),
      );
      this.message.set('The test was signed locally. Your phrase and keys were cleared.');
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.clearSecrets();
      this.busy.set(false);
    }
  }

  async copyResult(): Promise<void> {
    const value = this.resultText();
    if (!value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(value);
      this.message.set('The public signed result was copied.');
    } catch (error) {
      this.error.set(formatError(error));
    }
  }

  reset(): void {
    this.clearSecrets();
    this.packageText = '';
    this.reviewedPackage.set(null);
    this.reviewedLostPackage.set(null);
    this.reviewedGuardianPackage.set(null);
    this.reviewedChiaPackage.set(null);
    this.resultText.set('');
    this.trustedDeviceConfirmed = false;
    this.error.set(null);
    this.message.set('Private recovery data was cleared from this page.');
  }

  administratorSlot(drillPackage: AdminRecoveryDrillPackage): number {
    return Number(drillPackage.challenge.evmTypedData.message['slot']) + 1;
  }

  dailyWallet(drillPackage: AdminRecoveryDrillPackage): string {
    return String(drillPackage.challenge.evmTypedData.message['dailyWallet'] || '');
  }

  expiry(drillPackage: AdminRecoveryDrillPackage): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(drillPackage.challenge.expiresAt * 1000);
  }

  lostExpiry(lostPackage: AdminLostRecoveryPackage): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(lostPackage.intent.expiresAt * 1000);
  }

  guardianActionPurpose(
    guardianPackage: AdminRecoveryGuardianActionPackage,
  ): string {
    return guardianPackage.action === 'ACCEPT'
      ? 'Accept the tested replacement recovery kit'
      : 'Veto the exact recovery-kit replacement';
  }

  private clearSecrets(): void {
    this.phrase = '';
    this.recoveryKit.clear();
  }

  private async signLostRecovery(
    lostPackage: AdminLostRecoveryPackage,
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      if (!this.trustedDeviceConfirmed) {
        throw new Error('Confirm that this is a trusted second device.');
      }
      if (lostPackage.intent.expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new Error('This lost-wallet recovery has expired. Prepare a new one.');
      }
      this.recoveryKit.unlock(this.phrase, {
        evmGuardian: getAddress(lostPackage.intent.oldRecoveryGuardian),
        recoveryBlsPubkey: lostPackage.intent.oldRecoveryBlsKey,
      });
      const signatures = await this.recoveryKit.signLostKeyAuthorization({
        intent: lostPackage.intent,
        intentHash: lostPackage.intentHash,
        coordinator: lostPackage.coordinator,
        guardianTypedData: lostPackage.guardianTypedData,
        recoveryBlsDigest: lostPackage.recoveryBlsDigest,
      });
      this.resultText.set(
        JSON.stringify(
          createAdminLostRecoveryResult(lostPackage.intentHash, signatures),
        ),
      );
      this.message.set(
        'The exact recovery was authorized locally. Your phrase and keys were cleared.',
      );
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.clearSecrets();
      this.busy.set(false);
    }
  }

  private async signGuardianAction(
    guardianPackage: AdminRecoveryGuardianActionPackage,
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      if (!this.trustedDeviceConfirmed) {
        throw new Error('Confirm that this is a trusted second device.');
      }
      if (guardianPackage.intent.expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new Error('This recovery-kit action has expired. Prepare a new one.');
      }
      const expectedBls =
        guardianPackage.action === 'ACCEPT'
          ? guardianPackage.intent.newRecoveryBlsKey
          : guardianPackage.intent.oldRecoveryBlsKey;
      this.recoveryKit.unlock(this.phrase, {
        evmGuardian: getAddress(guardianPackage.expectedGuardian),
        recoveryBlsPubkey: expectedBls,
      });
      const guardianSignature =
        await this.recoveryKit.signRecoveryGuardianAction({
          action: guardianPackage.action,
          intentHash: guardianPackage.intentHash,
          coordinator: guardianPackage.coordinator,
          expectedGuardian: guardianPackage.expectedGuardian,
          typedData: guardianPackage.guardianTypedData,
        });
      this.resultText.set(
        JSON.stringify(
          createAdminRecoveryGuardianActionResult(
            guardianPackage,
            guardianSignature,
          ),
        ),
      );
      this.message.set(
        'The exact recovery-kit action was signed locally. Your phrase and keys were cleared.',
      );
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.clearSecrets();
      this.busy.set(false);
    }
  }

  private async signChiaRecovery(
    _chiaPackage: AdminChiaRecoveryActionPackage,
  ): Promise<void> {
    this.clearSecrets();
    this.resultText.set('');
    this.error.set('Chia recovery signing is unavailable until this page can verify the complete recovery transaction.');
  }
}
