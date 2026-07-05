import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { EvmWalletService } from '../../services/evm-wallet.service';
import { ChiaWalletService } from '../../services/chia-wallet.service';
import { PopulisApiService } from '../../services/populis-api.service';
import { SessionService } from '../../services/session.service';
import { VaultDiscoveryService } from '../../services/vault-discovery.service';
import { formatError } from '../../utils/format-error';

type Phase =
  | 'idle'
  | 'requesting_challenge'
  | 'awaiting_signature'
  | 'discovering_vault'
  | 'building_launcher'
  | 'broadcasting'
  | 'waiting_confirmation'
  | 'done'
  | 'logging_in'
  | 'error';

@Component({
  selector: 'pp-create-vault',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="container-p pt-16 pb-24 max-w-3xl">
      <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-4">Step 2 of 2</div>
      <h1 class="font-display text-4xl md:text-5xl">Create your vault.</h1>
      <p class="mt-4 text-text-muted max-w-xl">
        You'll sign a single EIP-712 (or BLS) message. Solslot recovers your
        public key from the signature, curries it into a Vault singleton
        puzzle, and launches the coin on {{ networkLabel }} &mdash; funded by
        the testnet faucet.
      </p>

      <div class="card mt-10 space-y-4">
        <div class="flex items-baseline justify-between">
          <span class="uppercase text-xs tracking-[0.2em] text-text-muted">Method</span>
          <span class="mono text-sm">{{ viaLabel() }}</span>
        </div>
        <div class="flex items-baseline justify-between">
          <span class="uppercase text-xs tracking-[0.2em] text-text-muted">Signer</span>
          <span class="mono text-sm">{{ signerAddress() ?? '—' }}</span>
        </div>
        <div class="flex items-baseline justify-between" *ngIf="pubkey()">
          <span class="uppercase text-xs tracking-[0.2em] text-text-muted">Your Solslot pubkey</span>
          <span class="mono text-xs text-brand break-all">{{ pubkey() }}</span>
        </div>

        <div class="flex items-baseline justify-between">
          <span class="uppercase text-xs tracking-[0.2em] text-text-muted">Status</span>
          <span class="mono text-sm">{{ phase() }}</span>
        </div>
        <div *ngIf="launcherId()">
          <span class="uppercase text-xs tracking-[0.2em] text-text-muted block mb-2">Vault launcher id</span>
          <span class="mono text-xs break-all">{{ launcherId() }}</span>
        </div>
      </div>

      <div class="mt-8 flex flex-wrap gap-3">
        <button
          class="btn btn--primary"
          (click)="start()"
          [disabled]="phase() !== 'idle' && phase() !== 'error' && phase() !== 'done'"
          type="button"
        >
          Sign &amp; Launch
        </button>
        <button class="btn btn--ghost" (click)="cancel()" type="button">Back</button>
      </div>

      @if (error()) {
        <div class="mt-6 rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300 whitespace-pre-wrap">
          {{ error() }}
        </div>
      }

      @if (phase() === 'done') {
        <div class="mt-8 card border-brand/40 bg-brand-soft">
          <div class="font-display text-2xl mb-2">Vault created.</div>
          <p class="text-sm text-text-muted">
            Your vault singleton is in the mempool. Once it confirms, deeds
            and tokens sent to its address will be spendable via your
            wallet signature.
          </p>
          <button class="btn btn--primary mt-4" (click)="openVault()" type="button">
            Open my vault →
          </button>
        </div>
      }
    </section>
  `,
})
export class CreateVaultComponent {
  private readonly evm = inject(EvmWalletService);
  private readonly chia = inject(ChiaWalletService);
  private readonly api = inject(PopulisApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly discovery = inject(VaultDiscoveryService);

  readonly phase = signal<Phase>('idle');
  readonly error = signal<string | null>(null);
  readonly launcherId = signal<string | null>(null);
  readonly pubkey = signal<string | null>(null);
  readonly returnTo = signal<string | null>(
    safeReturnTo(this.route.snapshot.queryParamMap.get('returnTo')),
  );

  readonly networkLabel = 'testnet11';

  readonly via = computed<'evm' | 'chia'>(() => {
    const q = this.route.snapshot.queryParamMap.get('via');
    return q === 'chia' ? 'chia' : 'evm';
  });

  viaLabel(): string {
    return this.via() === 'evm' ? 'EVM wallet (EIP-712 signature)' : 'Chia wallet (BLS signature)';
  }

  signerAddress(): string | null {
    if (this.via() === 'evm') return this.evm.address();
    const p = this.chia.pubkey();
    return p ? p.slice(0, 14) + '…' + p.slice(-8) : null;
  }

  async start(): Promise<void> {
    this.error.set(null);
    this.launcherId.set(null);
    try {
      if (this.via() === 'evm') {
        await this.launchEvm();
      } else {
        await this.launchChia();
      }
    } catch (e) {
      this.phase.set('error');
      this.error.set(formatError(e));
    }
  }

  private async launchEvm(): Promise<void> {
    const address = this.evm.address();
    if (!address) {
      await this.router.navigate(['/connect'], {
        queryParams: this.returnQueryParams(),
      });
      return;
    }

    // Step 1: get a challenge + signature to derive the pubkey.
    // The same signature drives both vault discovery (chain-only) and
    // registration (faucet-funded launcher), so the user only ever signs
    // once regardless of whether they're a returning or first-time user.
    this.phase.set('requesting_challenge');
    const challenge = await this.api.requestChallenge(address, 'evm');
    if (!challenge.typed_data) {
      throw new Error('Backend did not return EIP-712 typed data for this challenge');
    }

    this.phase.set('awaiting_signature');
    const signature = await this.evm.signTypedData(challenge.typed_data);

    const compressedPubkey = this.evm.recoverCompressedPubkey(challenge.typed_data, signature);
    this.pubkey.set(compressedPubkey);

    // Step 2: chain-only discovery — find an existing vault for this pubkey.
    // No backend involvement: queries coinset.org by the deterministic
    // CHIP-22 hint sha256("populis-vault-discovery-v1"||auth_type||pubkey).
    this.phase.set('discovering_vault');
    const existing = await this.discovery.discoverEvmVault(compressedPubkey);

    if (existing) {
      // Returning user — log them in to the vault that's already on chain.
      this.phase.set('logging_in');
      this.launcherId.set(existing.vaultLauncherId);
      this.session.setEvmSession(address, existing.vaultLauncherId, compressedPubkey);
      await this.session.refreshVault();
      // Skip the "Vault created" UI; route straight to the vault dashboard.
      await this.navigateAfterVaultLoaded();
      return;
    }

    // Step 3: first-time user — register a new vault via the backend faucet.
    this.phase.set('building_launcher');
    const res = await this.api.registerEvmVault({
      address,
      nonce: challenge.nonce,
      signature,
    });

    this.phase.set('broadcasting');
    this.launcherId.set(res.vault_launcher_id);
    this.session.setEvmSession(address, res.vault_launcher_id, compressedPubkey);

    this.phase.set('waiting_confirmation');
    await this.session.refreshVault();
    this.phase.set('done');
  }

  private async launchChia(): Promise<void> {
    const pk = this.chia.pubkey();
    if (!pk) {
      await this.router.navigate(['/connect'], {
        queryParams: this.returnQueryParams(),
      });
      return;
    }

    // Chia BLS: pubkey is already known (no signature needed for discovery).
    // Discover existing vault on chain BEFORE asking for a signature.
    this.phase.set('discovering_vault');
    const existing = await this.discovery.discoverChiaVault(pk);

    if (existing) {
      this.phase.set('logging_in');
      this.launcherId.set(existing.vaultLauncherId);
      this.session.setChiaSession(pk, existing.vaultLauncherId);
      await this.session.refreshVault();
      await this.navigateAfterVaultLoaded();
      return;
    }

    this.phase.set('requesting_challenge');
    const challenge = await this.api.requestChallenge(pk, 'chia_bls');

    this.phase.set('awaiting_signature');
    const signature = await this.chia.signMessage(challenge.nonce);

    this.phase.set('building_launcher');
    const res = await this.api.registerChiaVault({
      bls_pubkey: pk,
      nonce: challenge.nonce,
      signature,
    });

    this.phase.set('broadcasting');
    this.launcherId.set(res.vault_launcher_id);
    this.session.setChiaSession(pk, res.vault_launcher_id);

    this.phase.set('waiting_confirmation');
    await this.session.refreshVault();
    this.phase.set('done');
  }

  openVault(): void {
    const target = this.returnTo();
    if (target) {
      void this.router.navigateByUrl(target);
      return;
    }
    void this.router.navigate(['/vault']);
  }

  cancel(): void {
    const target = this.returnTo();
    if (target) {
      void this.router.navigateByUrl(target);
      return;
    }
    void this.router.navigate(['/connect']);
  }

  private async navigateAfterVaultLoaded(): Promise<void> {
    const target = this.returnTo();
    if (target) {
      await this.router.navigateByUrl(target);
      return;
    }
    await this.router.navigate(['/vault']);
  }

  private returnQueryParams(): Record<string, string> {
    const target = this.returnTo();
    return target ? { returnTo: target } : {};
  }
}

function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
