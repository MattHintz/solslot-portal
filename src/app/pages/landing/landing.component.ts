import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'pp-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-24 pb-16">
      <div class="max-w-3xl">
        <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4">
          Populis Protocol · Testnet 11
        </div>
        <h1 class="text-5xl md:text-7xl leading-[1.02] tracking-tight">
          The members-only on-chain
          <span class="bg-gradient-to-r from-brand via-brand-2 to-brand-3 bg-clip-text text-transparent">
            vault for real assets.
          </span>
        </h1>
        <p class="mt-8 text-lg md:text-xl text-text-muted leading-relaxed max-w-2xl">
          Connect an EVM wallet or a Chia wallet. We'll spin up your private
          vault singleton on Chia testnet, key-bound to your signature. No
          custodians. No off-chain servers. Deeds, tokens, and offers live
          inside the puzzle itself.
        </p>
        <div class="mt-12 flex flex-wrap gap-4">
          <a routerLink="/connect" class="btn btn--primary">Connect & Create Vault</a>
          <a href="https://populis.xyz" target="_blank" rel="noopener" class="btn btn--ghost">Read the white-paper</a>
        </div>
      </div>

      <div class="mt-24 grid gap-6 md:grid-cols-3">
        <div class="card">
          <div class="font-display text-2xl mb-2">EVM-native sign-in</div>
          <p class="text-sm text-text-muted leading-relaxed">
            MetaMask, Coinbase Wallet, Rabby, WalletConnect. We derive your
            Populis public key from a single EIP-712 signature &mdash; your
            vault inherits the same security you already trust on Ethereum.
          </p>
        </div>
        <div class="card">
          <div class="font-display text-2xl mb-2">Chia wallets too</div>
          <p class="text-sm text-text-muted leading-relaxed">
            Sage or Goby already holding XCH? Connect directly and get a
            BLS-keyed vault &mdash; no extra seed phrase to juggle. Both auth
            paths mint puzzle-compatible singletons the protocol treats
            identically.
          </p>
        </div>
        <div class="card">
          <div class="font-display text-2xl mb-2">Gated smart deeds</div>
          <p class="text-sm text-text-muted leading-relaxed">
            Every deed lives inside a vault or a pool &mdash; never floating
            on the open market. Secondary sales happen through on-chain offers
            that only other member vaults can take.
          </p>
        </div>
      </div>
    </section>
  `,
})
export class LandingComponent {}
