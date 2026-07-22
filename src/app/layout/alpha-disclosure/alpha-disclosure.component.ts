import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'pp-alpha-disclosure',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      *ngIf="visible"
      class="bg-[rgba(124,255,178,0.08)] border-b border-[rgba(124,255,178,0.18)] text-xs text-text-muted"
    >
      <div class="container-p flex flex-wrap items-center justify-between gap-2 py-2">
        <span>
          <strong class="text-[#7cffb2]">Testnet Alpha</strong> &mdash;
          {{ network }} only. Assets have no value.
          Pseudonymous telemetry is collected to improve the protocol.
          No seed phrases, keys, or proofs are transmitted.
        </span>
        <span class="flex items-center gap-3">
          <a
            [href]="statusUrl"
            target="_blank"
            rel="noopener"
            class="underline hover:text-text transition"
          >Status</a>
          <button
            class="underline hover:text-text transition"
            (click)="dismiss()"
            type="button"
          >Dismiss</button>
        </span>
      </div>
    </div>
  `,
})
export class AlphaDisclosureComponent {
  readonly network = environment.chiaNetwork;
  readonly statusUrl = 'https://solslot.com';
  visible = true;

  dismiss(): void {
    this.visible = false;
    try {
      sessionStorage.setItem('pp_alpha_dismissed', '1');
    } catch { /* private browsing */ }
  }

  constructor() {
    try {
      if (sessionStorage.getItem('pp_alpha_dismissed') === '1') {
        this.visible = false;
      }
    } catch { /* private browsing */ }
  }
}
