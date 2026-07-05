import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ChiaWasmService } from '../../services/chia-wasm.service';

@Component({
  selector: 'pp-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-24 pb-16">
      <div class="max-w-3xl">
        <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4 flex items-center gap-3">
          <span>Solslot Protocol · Testnet Alpha</span>
          <span
            class="inline-flex items-center gap-1.5 normal-case tracking-normal text-[0.65rem]"
            [class.text-brand]="wasmStatus().ok"
            [class.text-amber-400]="!wasmStatus().ok"
            [title]="wasmStatus().details"
          >
            <span
              class="inline-block w-1.5 h-1.5 rounded-full"
              [class.bg-brand]="wasmStatus().ok"
              [class.bg-amber-400]="!wasmStatus().ok"
            ></span>
            {{ wasmStatus().ok ? 'WASM ready' : 'WASM offline' }}
          </span>
        </div>
        <h1 class="text-5xl md:text-7xl leading-[1.02] tracking-tight">
          The Solslot operating layer for
          <span class="bg-gradient-to-r from-brand via-brand-2 to-brand-3 bg-clip-text text-transparent">
            SmartDeeds.
          </span>
        </h1>
        <p class="mt-8 text-lg md:text-xl text-text-muted leading-relaxed max-w-2xl">
          One command surface for Vault custody, Committee Coin voting,
          identity readiness, Moon alpha simulation, and operator checks. The
          market stays on Solslot; this console carries the protocol work
          underneath it.
        </p>
        <div class="mt-12 flex flex-wrap gap-4">
          <a routerLink="/connect" class="btn btn--primary">Vault Connect</a>
          <a href="/" class="btn btn--ghost">Solslot Market</a>
          <a href="/dashboard/asset-overview" class="btn btn--ghost">Legacy Vault Login</a>
        </div>
      </div>

      <div class="mt-24 grid gap-6 md:grid-cols-3">
        <div class="card">
          <div class="font-display text-2xl mb-2">Vault Connect</div>
          <p class="text-sm text-text-muted leading-relaxed">
            EVM and Chia wallet paths derive a Vault key from a signature, then
            route the user into custody setup without seed phrases or private
            key entry.
          </p>
        </div>
        <div class="card">
          <div class="font-display text-2xl mb-2">Operator clarity</div>
          <p class="text-sm text-text-muted leading-relaxed">
            Chain status, mint lifecycle, committee state, and execution
            diagnostics stay in one place so the webmaster can work without
            hunting across hidden tabs.
          </p>
        </div>
        <div class="card">
          <div class="font-display text-2xl mb-2">SmartDeeds rails</div>
          <p class="text-sm text-text-muted leading-relaxed">
            Testnet actions can exercise SmartDeeds, Vaults, Committee Coin,
            Chia testnet, and Base test rails. Sols remain a secondary-market
            swap readiness signal until liquidity is sufficient.
          </p>
        </div>
      </div>
    </section>
  `,
})
export class LandingComponent {
  private readonly chiaWasm = inject(ChiaWasmService);

  /**
   * Surface the WASM smoke-test result as a banner indicator so devs
   * can verify the chia-wallet-sdk-wasm bootstrap without opening
   * DevTools.  Re-evaluates whenever the ready signal flips.
   */
  readonly wasmStatus = computed(() => {
    // Touch the ready signal so the computed re-runs.
    void this.chiaWasm.ready();
    return this.chiaWasm.smokeTest();
  });
}
