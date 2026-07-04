import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  LegacyProRecallRecord,
  LegacyProRecallService,
} from '../../../services/legacy-pro-recall.service';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'pp-legacy-recall',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="container-p pt-12 pb-24">
      <header class="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
            Sols Lot · Deprecated Records
          </div>
          <h1 class="font-display text-4xl md:text-5xl">Legacy recall.</h1>
          <p class="mt-2 text-text-muted text-sm">
            Pro Account and Pro Vault records remain separate from Populis vaults.
          </p>
        </div>

        <a routerLink="/admin" class="btn btn--ghost">Admin desk</a>
      </header>

      <form class="mt-10 recall-search" (ngSubmit)="search()">
        <label class="mono text-xs uppercase tracking-[0.18em] text-text-muted" for="legacy-query">
          Customer, property, or vault
        </label>
        <div class="mt-3 flex flex-col gap-3 md:flex-row">
          <input
            id="legacy-query"
            name="legacyQuery"
            class="recall-input"
            [(ngModel)]="query"
            autocomplete="off"
            spellcheck="false"
            placeholder="email@example.com, vault id, property id"
          />
          <button class="btn btn--primary shrink-0" type="submit" [disabled]="loading()">
            Search
          </button>
        </div>
      </form>

      <div class="mt-8">
        @if (loading()) {
          <div class="mono text-sm text-text-muted">Searching legacy records&hellip;</div>
        } @else if (error()) {
          <div class="rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            <div class="font-display text-base mb-1">Legacy recall failed.</div>
            <div class="mono text-xs">{{ error() }}</div>
          </div>
        } @else if (searched() && records().length === 0) {
          <div class="card text-center text-text-muted">
            <div class="font-display text-2xl text-text">No legacy records found.</div>
          </div>
        } @else if (records().length > 0) {
          <div class="mono text-xs uppercase tracking-[0.18em] text-text-muted mb-3">
            {{ records().length }} deprecated record{{ records().length === 1 ? '' : 's' }}
          </div>
          <div class="grid gap-3">
            @for (record of records(); track record.source + ':' + record.id) {
              <article class="card">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div class="mono text-xs uppercase tracking-[0.18em] text-brand">
                      {{ record.source }}
                    </div>
                    <div class="mt-1 mono text-xs text-text-muted break-all">
                      {{ record.id }}
                    </div>
                  </div>
                  <span class="deprecated-pill">Deprecated</span>
                </div>
                <pre class="legacy-json mt-4">{{ formatRecord(record) }}</pre>
              </article>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .recall-search {
        max-width: 52rem;
      }

      .recall-input {
        min-height: 2.9rem;
        flex: 1 1 auto;
        border-radius: 0.5rem;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.035);
        color: var(--text);
        padding: 0.75rem 0.9rem;
        font-family: var(--font-mono);
        font-size: 0.86rem;
        outline: none;
      }

      .recall-input:focus {
        border-color: rgba(124, 255, 178, 0.65);
        box-shadow: 0 0 0 1px rgba(124, 255, 178, 0.16);
      }

      .deprecated-pill {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: rgba(255, 215, 128, 0.95);
        border: 1px solid rgba(255, 215, 128, 0.25);
        background: rgba(255, 215, 128, 0.08);
        border-radius: 999px;
        padding: 0.28rem 0.55rem;
      }

      .legacy-json {
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
        border-radius: 0.5rem;
        border: 1px solid var(--border);
        background: rgba(0, 0, 0, 0.22);
        color: rgba(234, 255, 247, 0.86);
        padding: 0.85rem;
        font-size: 0.76rem;
        line-height: 1.55;
      }
    `,
  ],
})
export class LegacyRecallComponent {
  private readonly recall = inject(LegacyProRecallService);

  query = '';
  readonly records = signal<LegacyProRecallRecord[]>([]);
  readonly loading = signal(false);
  readonly searched = signal(false);
  readonly error = signal<string | null>(null);

  async search(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const response = await this.recall.search(this.query);
      this.records.set(response.records);
      this.searched.set(true);
    } catch (e) {
      this.records.set([]);
      this.error.set(formatError(e));
    } finally {
      this.loading.set(false);
    }
  }

  formatRecord(record: LegacyProRecallRecord): string {
    return JSON.stringify(record.data, null, 2);
  }
}
