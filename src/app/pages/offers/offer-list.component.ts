import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { OfferSourceService } from '../../services/offer-source.service';
import { formatError } from '../../utils/format-error';

@Component({
  selector: 'pp-offer-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-14 pb-24">
      <header class="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
            Solslot · Member Desk
          </div>
          <h1 class="font-display text-4xl md:text-5xl">SmartDeed offers</h1>
          <p class="mt-3 max-w-3xl text-sm leading-relaxed text-text-muted">
            Browse governed real-estate SmartDeed offers. Connect a vault and complete zkPassport enrollment to accept.
          </p>
          <p class="mt-3 max-w-3xl text-xs leading-relaxed text-text-muted">
            Offers originate on chain: a deed proposal is minted by governance
            (<span class="mono">OP:MINTED</span>) and becomes purchasable only
            once its offer artifact is published
            (<span class="mono">OP:OFFER_READY</span>). This feed reflects that
            lifecycle — nothing appears here until a deed is minted and offer-ready.
          </p>
        </div>
        <div class="flex flex-wrap gap-3">
          <a routerLink="/vault" class="btn btn--ghost">My vault</a>
          <a routerLink="/create-vault" class="btn btn--primary">Create vault</a>
        </div>
      </header>

      @if (loading()) {
        <div class="mt-10 text-sm text-text-muted">Loading offers…</div>
      }

      @if (error(); as message) {
        <section class="notice notice--error mt-6" role="alert">
          <strong>Could not load offers</strong>
          <span>{{ message }}</span>
        </section>
      }

      @if (!loading() && !error() && offers().length === 0) {
        <div class="mt-10 empty-state">
          <strong>No offer-ready deeds yet</strong>
          <span>
            An offer appears here after a deed proposal is minted by governance
            and its offer artifact is published (<span class="mono">OP:OFFER_READY</span>).
          </span>
        </div>
      }

      @if (readyOffers().length > 0) {
        <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          @for (offer of readyOffers(); track offer.id) {
            <a
              [routerLink]="['/offers', offer.id]"
              class="card group hover:border-brand/40 transition-colors"
            >
              <div class="flex items-start justify-between gap-3">
                <h2 class="font-display text-xl group-hover:text-brand transition-colors">
                  {{ offer.title }}
                </h2>
                <span class="state-pill" [attr.data-state]="offer.state">
                  {{ stateLabel(offer.state) }}
                </span>
              </div>
              <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Price</div>
                  <div class="mono mt-1">{{ offer.terms.priceMojos | number }} mojo</div>
                </div>
                <div>
                  <div class="uppercase text-xs tracking-[0.2em] text-text-muted">Tokens</div>
                  <div class="mono mt-1">{{ offer.terms.tokenAmount | number }}</div>
                </div>
              </div>
              <div class="mt-4 text-xs text-text-muted mono break-all">
                {{ offer.deedLauncherId }}
              </div>
            </a>
          }
        </div>
      }

      @if (unavailableOffers().length > 0) {
        <div class="mt-8">
          <div class="mono text-xs uppercase tracking-[0.2em] text-text-muted mb-3">
            Not currently acceptable
          </div>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            @for (offer of unavailableOffers(); track offer.id) {
              <div class="card opacity-60" aria-disabled="true">
                <div class="flex items-start justify-between gap-3">
                  <h2 class="font-display text-xl">{{ offer.title }}</h2>
                  <span class="state-pill" [attr.data-state]="offer.state">
                    {{ stateLabel(offer.state) }}
                  </span>
                </div>
                <div class="mt-4 text-xs text-text-muted mono break-all">
                  {{ offer.deedLauncherId }}
                </div>
              </div>
            }
          </div>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .state-pill {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.15em;
        padding: 0.15rem 0.4rem;
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #d4d4d8;
      }
      .state-pill[data-state='OP:OFFER_READY'] {
        color: #7cffb2;
        border-color: rgba(124, 255, 178, 0.4);
      }
      .state-pill[data-state='OP:OFFER_UNAVAILABLE'] {
        color: #fca5a5;
        border-color: rgba(248, 113, 113, 0.4);
      }
    `,
  ],
})
export class OfferListComponent {
  private readonly offerSource = inject(OfferSourceService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly offers = computed(() => {
    try {
      return this.offerSource.listOffers();
    } catch (e) {
      this.error.set(formatError(e));
      return [];
    }
  });

  readonly readyOffers = computed(() =>
    this.offers().filter((offer) => offer.state === 'OP:OFFER_READY'),
  );

  readonly unavailableOffers = computed(() =>
    this.offers().filter((offer) => offer.state !== 'OP:OFFER_READY'),
  );

  stateLabel(state: string): string {
    return state.replace('OP:', '').replace('EM:', '');
  }

  constructor() {
    // Allow async sources to settle without blocking first render.
    queueMicrotask(() => this.loading.set(false));
  }
}
