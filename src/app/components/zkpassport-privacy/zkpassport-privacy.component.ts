import { Component, Input } from '@angular/core';

/** Supplied ZKPassport brand artwork. This explains the provider, never verification status. */
@Component({
  selector: 'solslot-zkpassport-privacy',
  standalone: true,
  template: `
    <div class="zkp-privacy" [class.zkp-privacy--compact]="compact" [class.zkp-privacy--light]="theme === 'light'">
      <div class="zkp-privacy__brand">
        <img [src]="theme === 'light' ? 'assets/brand/zkpassport-globe-navy.svg' : 'assets/brand/zkpassport-globe-gold.svg'" width="32" height="32" alt="" />
        <div><strong>Private Identity Verification</strong><span>Powered by ZKPassport</span></div>
      </div>
      @if (showDetails) {
        <p>Your passport stays private. ZKPassport uses a zero-knowledge proof to confirm you are 18+ without sharing your identity document, name, birth date, or document number with Solslot. Solslot does not request or store those personal details through this verification.</p>
        <p class="zkp-privacy__retention">We retain your verification status and wallet-linked proof receipts; onchain receipts are public.</p>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; text-align: left; }
    .zkp-privacy { padding: 20px; border: 1px solid rgba(242,220,176,.22); border-radius: 16px; background: linear-gradient(180deg,rgba(242,220,176,.05),rgba(246,211,143,.05)); color: #e8eeeb; }
    .zkp-privacy__brand { display: flex; align-items: center; gap: 12px; }
    .zkp-privacy__brand img { flex: 0 0 32px; }
    .zkp-privacy__brand strong { display: block; color: #f2dcb0; font-size: 18px; font-weight: 700; line-height: 1.3; }
    .zkp-privacy__brand span { display: block; margin-top: 4px; font-size: 12px; line-height: 1.4; color: #d8e3dc; }
    .zkp-privacy p { margin: 16px 0 0; font-size: 14px; line-height: 1.65; }
    .zkp-privacy .zkp-privacy__retention { margin-top: 10px; font-size: 12px; color: #b9c7bf; }
    .zkp-privacy--compact { padding: 14px 16px; }
    .zkp-privacy--compact .zkp-privacy__brand strong { font-size: 15px; }
    .zkp-privacy--light { color: #24334c; border-color: rgba(26,46,130,.2); background: linear-gradient(180deg,rgba(33,57,163,.05),rgba(7,11,33,.05)); }
    .zkp-privacy--light .zkp-privacy__brand strong { color: #1a2e82; }
    .zkp-privacy--light .zkp-privacy__brand span, .zkp-privacy--light .zkp-privacy__retention { color: #536074; }
    @media(max-width:480px) { .zkp-privacy { padding: 16px; } .zkp-privacy__brand strong { font-size: 16px; } }
  `],
})
export class ZkPassportPrivacyComponent {
  @Input() compact = false;
  @Input() showDetails = false;
  @Input() theme: 'dark' | 'light' = 'dark';
}
