import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AdminSessionService } from '../../services/admin-session.service';

@Component({
  selector: 'solslot-admin-workspace-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="workspace-nav" aria-label="Administrator workspace">
      <a class="workspace-brand" routerLink="/admin" aria-label="Solslot administrator home">
        <span class="brand-mark" aria-hidden="true">S</span>
        <span>
          <strong>Solslot</strong>
          <small>Admin</small>
        </span>
      </a>

      <div class="workspace-links">
        <a
          routerLink="/admin"
          routerLinkActive="is-active" ariaCurrentWhenActive="page"
          [routerLinkActiveOptions]="{ exact: true }"
        >
          Admin desk
        </a>
        <a routerLink="/admin/collections" routerLinkActive="is-active" ariaCurrentWhenActive="page">Properties</a>
        <a routerLink="/admin/mint" routerLinkActive="is-active" ariaCurrentWhenActive="page">Mint proposals</a>
        <a routerLink="/admin/approvals" routerLinkActive="is-active" ariaCurrentWhenActive="page">Approvals</a>
        <a routerLink="/admin/sgt-allocations" routerLinkActive="is-active" ariaCurrentWhenActive="page">SGT sales & grants</a>
        <a routerLink="/committee" routerLinkActive="is-active" ariaCurrentWhenActive="page">Committee desk</a>
        <a routerLink="/admin/genesis" routerLinkActive="is-active" ariaCurrentWhenActive="page">Setup & launch</a>
        <a routerLink="/admin/sales" routerLinkActive="is-active" ariaCurrentWhenActive="page">Sales</a>
        <a routerLink="/admin/system-health" routerLinkActive="is-active" ariaCurrentWhenActive="page">Health</a>
        <a routerLink="/admin/genesis/security" routerLinkActive="is-active" ariaCurrentWhenActive="page">Security</a>
      </div>

      <div class="workspace-account">
        <span>
          <strong>Administrator</strong>
          <small>Secure workspace</small>
        </span>
        <button type="button" [attr.aria-expanded]="helpOpen()" aria-controls="admin-help-panel" (click)="helpOpen.set(!helpOpen())">Help</button>
        <button type="button" (click)="signOut()">Sign out</button>
      </div>
    </nav>

    @if (helpOpen()) {
      <div class="help-shell" (keydown.escape)="helpOpen.set(false)">
        <button
          type="button"
          class="help-backdrop"
          aria-label="Close administrator help"
          (click)="helpOpen.set(false)"
        ></button>
        <section class="help-panel" id="admin-help-panel" role="region" aria-labelledby="admin-help-title">
          <header>
            <div>
              <small>Administrator guide</small>
              <h2 id="admin-help-title">Where should I start?</h2>
            </div>
            <button type="button" class="help-close" (click)="helpOpen.set(false)">
              <span aria-hidden="true">&times;</span>
              <span class="sr-only">Close help</span>
            </button>
          </header>

          <div class="help-next">
            <strong>Start at the Admin desk</strong>
            <p>
              Check assigned work, then choose a desk. Properties prepares SmartDeeds;
              Mint proposals tracks issuance; SGT sales & grants manages governance allocations.
            </p>
            <a routerLink="/admin" (click)="helpOpen.set(false)">Open Admin desk</a>
          </div>

          <ol>
            <li>
              <strong>Read before connecting</strong>
              <span>Check the site address and make sure your wallet is on the named network.</span>
            </li>
            <li>
              <strong>Compare the decision receipt</strong>
              <span>Purpose, amount, recipient, and result must match the wallet request.</span>
            </li>
            <li>
              <strong>Reject anything unexpected</strong>
              <span>Solslot will never ask for a recovery phrase or private key.</span>
            </li>
          </ol>

          <div class="help-emergency">
            <strong>Wallet lost or possibly compromised?</strong>
            <p>
              Stop signing. Tell the owner and another administrator immediately, then open
              Security & Access for the protected replacement procedure.
            </p>
            <a routerLink="/admin/genesis/security" (click)="helpOpen.set(false)">
              Open Security & Access
            </a>
          </div>
        </section>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        position: sticky;
        top: 0;
        z-index: 40;
        border-bottom: 1px solid #21483d;
        background: rgba(4, 18, 15, 0.96);

      }
      .workspace-nav {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 22px;
        width: min(1240px, calc(100% - 32px));
        min-height: 58px;
        margin: 0 auto;
      }
      .workspace-brand,
      .workspace-account,
      .workspace-links {
        display: flex;
        align-items: center;
      }
      .workspace-brand {
        gap: 9px;
        color: #effcf7;
        text-decoration: none;
      }
      .brand-mark {
        display: grid;
        width: 30px;
        height: 30px;
        place-items: center;
        border: 1px solid #5fcf9f;
        color: #79e6b5;
        font-weight: 800;
      }
      .workspace-brand > span:last-child,
      .workspace-account > span {
        display: grid;
        line-height: 1.1;
      }
      .workspace-brand strong {
        font-size: 13px;
      }
      .workspace-brand small,
      .workspace-account small {
        margin-top: 3px;
        color: #8dac9f;
        font: 10px/1.1 var(--font-mono);
      }
      .workspace-links {
        flex-wrap: wrap;
        min-width: 0;
        gap: 4px;
        overflow: visible;
      }
      .workspace-links::-webkit-scrollbar {
        display: none;
      }
      .workspace-links a {
        flex: 0 0 auto;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        padding: 10px 9px;
        border-bottom: 2px solid transparent;
        color: #a9c2b8;
        font-size: 13px;
        text-decoration: none;
      }
      .workspace-links a:hover,
      .workspace-links a.is-active {
        border-bottom-color: #67e7ad;
        color: #f3fff9;
      }
      .workspace-account {
        gap: 12px;
      }
      .workspace-account > span {
        min-width: 0;
        text-align: right;
      }
      .workspace-account strong {
        color: #d9f7e9;
        font-size: 11px;
      }
      .workspace-account button {
        border: 0;
        background: none;
        color: #85dcb5;
        min-height: 44px;
        padding: 8px;
        font: 13px var(--font-sans);
        cursor: pointer;
      }
      .workspace-account button:hover {
        color: #fff;
      }
      .help-shell {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        justify-items: end;
      }
      .help-backdrop {
        position: absolute;
        inset: 0;
        border: 0;
        background: rgba(0, 0, 0, 0.66);
      }
      .help-panel {
        position: relative;
        width: min(420px, 100%);
        height: 100%;
        overflow-y: auto;
        padding: 24px;
        border-left: 1px solid #326754;
        background: #071713;
        box-shadow: -18px 0 50px rgba(0, 0, 0, 0.32);
      }
      .help-panel header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 18px;
        border-bottom: 1px solid #21483d;
      }
      .help-panel header small {
        color: #67e7ad;
        font: 700 10px/1.2 var(--font-mono);
        text-transform: uppercase;
      }
      .help-panel h2 {
        margin: 5px 0 0;
        color: #effcf7;
        font-size: 24px;
        letter-spacing: 0;
      }
      .help-close {
        display: grid;
        width: 34px;
        height: 34px;
        place-items: center;
        border: 1px solid #326754 !important;
        color: #d7f4e6 !important;
        font-size: 22px !important;
      }
      .help-next,
      .help-emergency {
        display: grid;
        gap: 6px;
        margin-top: 18px;
        padding: 16px;
        border-left: 3px solid #67e7ad;
        background: #0d251e;
      }
      .help-emergency {
        border-left-color: #e6c96f;
        background: #1a1b11;
      }
      .help-panel p {
        margin: 0;
        color: #a9c2b8;
        font-size: 12px;
        line-height: 1.55;
      }
      .help-panel a {
        width: max-content;
        margin-top: 4px;
        color: #86e9bd;
        font-size: 12px;
      }
      .help-panel ol {
        display: grid;
        gap: 15px;
        margin: 22px 0;
        padding-left: 22px;
      }
      .help-panel li {
        padding-left: 5px;
        color: #67e7ad;
      }
      .help-panel li strong,
      .help-panel li span {
        display: block;
      }
      .help-panel li strong {
        color: #effcf7;
        font-size: 13px;
      }
      .help-panel li span {
        margin-top: 3px;
        color: #a9c2b8;
        font-size: 12px;
        line-height: 1.5;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
      }
      @media (max-width: 1100px) {
        :host { position: relative; }
        .workspace-nav { grid-template-columns: 1fr auto; gap: 4px 12px; padding-top: 8px; }
        .workspace-links { grid-row: 2; grid-column: 1 / -1; padding-bottom: 6px; }
        .workspace-account { grid-row: 1; grid-column: 2; }
        .workspace-account > span {
          display: none;
        }
      }
      @media (max-width: 560px) {
        .workspace-nav {
          width: calc(100% - 20px);
          gap: 12px;
        }
        .workspace-brand small {
          display: none;
        }
        .workspace-links a {
          padding-inline: 7px;
        }
        .workspace-account {
          gap: 0;
        }
      }
    `,
  ],
})
export class AdminWorkspaceNavComponent {
  private readonly injector = inject(Injector);
  readonly externalSignOut = input(false);
  readonly signOutRequested = output<void>();
  readonly helpOpen = signal(false);

  signOut(): void {
    if (this.externalSignOut()) {
      this.signOutRequested.emit();
      return;
    }
    this.injector.get(AdminSessionService).logoutAndRedirect();
  }
}
