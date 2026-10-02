import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminStatusRefresh } from '../../services/admin-status-refresh.service';

@Component({
  selector: 'solslot-admin-refresh-status',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="refresh-status">
      <div>
        <span role="status" aria-live="polite">
          {{ state().pausedReason() || state().error() || (state().refreshing() ? 'Updating status…' : 'Auto-refresh is on') }}
        </span>
        @if (state().lastUpdated(); as updated) {
          <small>Last checked {{ updated | date: 'h:mm:ss a' }}</small>
        } @else {
          <small>Waiting for the first successful check</small>
        }
        @if (state().pausedReason()?.startsWith('Sign in')) { <a routerLink="/admin/login">Sign in again</a> }
      </div>
      <button type="button" (click)="state().refresh()"
        [disabled]="state().refreshing() || !!state().pausedReason()">
        {{ state().refreshing() ? 'Updating…' : 'Refresh now' }}
      </button>
    </div>
  `,
  styles: [`
    .refresh-status { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:12px 0; color:var(--muted, #a9c2b8); font-size:13px; }
    .refresh-status > div { display:grid; gap:3px; } small { color:var(--muted, #90ab9f); } a { color:var(--accent, #8bf0bd); }
    button { flex-shrink:0; border:1px solid var(--accent, #4f8d77); background:var(--accent-soft, #123329); color:var(--text, #eefbf5); padding:9px 12px; border-radius:4px; cursor:pointer; min-height:44px; }
    button:disabled { opacity:.55; cursor:default; } button:focus-visible { outline:2px solid var(--accent, #8bf0bd); outline-offset:3px; }
    @media(max-width:520px) { .refresh-status { align-items:flex-start; } }
  `],
})
export class AdminRefreshStatusComponent {
  readonly state = input.required<AdminStatusRefresh>();
}
