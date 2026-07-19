import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  PoolEconomicsV2ActionPreviewService,
  type PoolV2ActionPreview,
  type PoolV2ActionPreviewKind,
} from '../../../services/pool-economics-v2-action-preview.service';
import {
  PoolEconomicsV2ChainStateService,
  type PoolV2ChainStateEvidence,
} from '../../../services/pool-economics-v2-chain-state.service';
import {
  PoolEconomicsV2ComposeDryRunService,
  type PoolV2ComposeDryRunResult,
} from '../../../services/pool-economics-v2-compose-dry-run.service';
import {
  PoolEconomicsV2DeedWitnessService,
  type PoolV2DeedWitnessEvidence,
} from '../../../services/pool-economics-v2-deed-witness.service';
import {
  PoolEconomicsV2ExecutionRunnerService,
  type PoolV2ExecutionBundle,
  type PoolV2ExecutionKind,
} from '../../../services/pool-economics-v2-execution-runner.service';
import {
  PoolEconomicsV2NavRegistryChainStateService,
  type CollectionNavRegistryEvidence,
} from '../../../services/pool-economics-v2-nav-registry-chain-state.service';
import {
  type CollectionNavEvidenceInput,
  type PoolEconomicStateInput,
  PoolEconomicsV2Service,
  type ReserveAcquisitionQuote,
  type SpecificDeedSwapQuote,
  TOKEN_MELT,
  TOKEN_MINT,
  type TrueRedemptionQuote,
} from '../../../services/pool-economics-v2.service';
import {
  PoolEconomicsV2TokenAuthorizationService,
  type PoolV2TokenAuthorizationMaterial,
  type PoolV2TokenAuthorizationSpendBuild,
} from '../../../services/pool-economics-v2-token-authorization.service';
import type { UnsignedCoinSpend } from '../../../services/chia-wallet.service';
import type {
  PoolV2CoinSpendBuild,
  PoolSingletonSpendContext,
  PoolV2BundleWitnesses,
  PoolV2RequiredAnnouncement,
} from '../../../services/pool-economics-v2-spend-builder.service';
import {
  PoolEconomicsV2SpendBuilderService,
  SINGLETON_LAUNCHER_HASH,
} from '../../../services/pool-economics-v2-spend-builder.service';
import { formatError } from '../../../utils/format-error';

type QuotePreview<T> =
  | { kind: 'ok'; quote: T; deedNavMojos: bigint; circulatingSupplyBefore: bigint }
  | { kind: 'error'; message: string };

type BuilderPreview =
  | { kind: 'ok'; preview: PoolV2ActionPreview }
  | { kind: 'error'; message: string };

type ComposeDryRunPreview =
  | { kind: 'ok'; result: PoolV2ComposeDryRunResult }
  | { kind: 'error'; message: string };

type ExecutionBundlePreview =
  | {
      kind: 'ok';
      result: PoolV2ExecutionBundle<
        SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote
      >;
    }
  | { kind: 'error'; message: string };

type ExecutionSubmitPreview =
  | { kind: 'submitted'; status: string | null }
  | { kind: 'error'; message: string };

type TokenWitnessRequirementsPreview =
  | { kind: 'ok'; requirements: PoolV2RequiredAnnouncement[] }
  | { kind: 'applied'; message: string }
  | { kind: 'error'; message: string };

type TokenTailMaterialPreview =
  | { kind: 'ok'; material: PoolV2TokenAuthorizationMaterial }
  | { kind: 'error'; message: string };

type TokenAuthorizationSpendPreview =
  | { kind: 'ok'; build: PoolV2TokenAuthorizationSpendBuild }
  | { kind: 'error'; message: string };

type ConfirmedPoolV2ChainStateEvidence = Extract<PoolV2ChainStateEvidence, { kind: 'confirmed' }>;
type ConfirmedPoolV2DeedWitnessEvidence = Extract<
  PoolV2DeedWitnessEvidence,
  { kind: 'confirmed-redeem' | 'confirmed-deposit' }
>;

interface ParsedInputs {
  state: PoolEconomicStateInput;
  collectionNavMojos: bigint;
  sharePpm: bigint;
  sellerTokenPrice: bigint;
}

interface ParsedExecutionPackage {
  pool: PoolSingletonSpendContext;
  state: PoolEconomicStateInput;
  deedId: string;
  deedLauncherId?: string;
  collectionIdCanon: string;
  sharePpm: bigint;
  navEvidence: CollectionNavEvidenceInput;
  witnesses: PoolV2BundleWitnesses;
  buyerVaultLauncherId?: string;
  buyerVaultCoinId?: string;
  buyerOwnerPubkey?: string;
  buyerAuthType?: bigint;
  buyerMembersMerkleRoot?: string;
  buyerIdentityAttestRoot?: string;
  buyerBridgePolicyHash?: string;
  vaultLauncherId?: string;
  launcherPuzzleHash?: string;
  treasuryReservePuzhash?: string;
  protocolTreasuryPuzhash?: string;
  governanceRewardsPuzhash?: string;
  governanceRewardsRoot?: string;
  tokenCoinId?: string;
  propertyIdCanon?: string;
  parValueMojos?: bigint;
  assetClass?: bigint;
  sellerPuzhash?: string;
  sellerTokenPrice?: bigint;
  mintTokenCoinId?: string | null;
}

@Component({
  selector: 'pp-pool-economics-v2',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="container-p pt-12 pb-24">
      <header class="flex flex-wrap items-end justify-between gap-6">
        <div>
          <a routerLink="/admin" class="mono text-xs text-text-muted hover:text-brand">
            Admin desk
          </a>
          <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mt-4 mb-2">
            Pool Economic V2
          </div>
          <h1 class="font-display text-4xl md:text-5xl">Redemption economics.</h1>
          <p class="mt-3 text-sm text-text-muted max-w-2xl">
            Global pool-token NAV, deed swaps, burns, reserve-first acquisitions.
          </p>
        </div>
      </header>

      <section class="chain-panel mt-10" data-testid="chain-state-panel">
        <div class="chain-panel__head">
          <div>
            <div class="mono text-xs uppercase text-text-muted">On-chain pool state</div>
            <h2 class="font-display text-2xl mt-1">{{ chainStatusTitle() }}</h2>
            <div class="mono text-[0.7rem] text-text-muted mt-1 break-all">
              {{ chainStatusDetail() }}
            </div>
          </div>
          <div class="flex flex-wrap gap-2 justify-end">
            <button
              class="btn btn--ghost text-xs"
              type="button"
              (click)="refreshChainState()"
              [disabled]="chainLoading()"
            >
              @if (chainLoading()) { Reading&hellip; } @else { Refresh }
            </button>
            <button
              class="btn btn--primary text-xs"
              type="button"
              (click)="applyChainState()"
              [disabled]="!canApplyChainState()"
            >
              Apply to quotes
            </button>
          </div>
        </div>

        @if (chainError()) {
          <div class="error-box mt-4">{{ chainError() }}</div>
        } @else if (chainEvidence(); as evidence) {
          @if (evidence.kind === 'confirmed') {
            <dl class="metric-grid metric-grid--wide mt-4">
              <div>
                <dt>Total NAV locked</dt>
                <dd>{{ formatMojos(evidence.state.totalNavLockedMojos) }}</dd>
              </div>
              <div>
                <dt>Deeds</dt>
                <dd>{{ formatTokens(evidence.state.deedCount) }}</dd>
              </div>
              <div>
                <dt>Total supply</dt>
                <dd>{{ formatTokens(evidence.state.totalPoolTokenSupply) }}</dd>
              </div>
              <div>
                <dt>Treasury reserve</dt>
                <dd>{{ formatTokens(evidence.state.treasuryReserveTokens) }}</dd>
              </div>
              <div>
                <dt>Last transition</dt>
                <dd>{{ evidence.spendCaseLabel }}</dd>
              </div>
              <div>
                <dt>Live puzzle hash</dt>
                <dd class="hash-dd">{{ evidence.livePuzzleHash }}</dd>
              </div>
            </dl>
          } @else {
            <div class="mono text-xs text-text-muted mt-4">
              {{ chainEvidenceMessage(evidence) }}
            </div>
          }
        } @else {
          <div class="mono text-xs text-text-muted mt-4">
            Refresh to read the configured pool singleton from chain.
          </div>
        }
      </section>

      <div class="mt-10 grid gap-6 xl:grid-cols-[minmax(280px,420px)_1fr]">
        <form class="grid gap-6" aria-label="Pool Economic V2 inputs">
          <fieldset class="panel grid gap-4">
            <legend class="font-display text-xl">Pool state</legend>
            <label>
              <span class="form-label">Total NAV locked (mojos)</span>
              <input
                class="mono"
                name="total_nav_locked_mojos"
                [(ngModel)]="totalNavLockedMojosInput"
                inputmode="numeric"
              />
            </label>
            <div class="grid gap-4 sm:grid-cols-2">
              <label>
                <span class="form-label">Deed count</span>
                <input
                  class="mono"
                  name="deed_count"
                  [(ngModel)]="deedCountInput"
                  inputmode="numeric"
                />
              </label>
              <label>
                <span class="form-label">Treasury reserve tokens</span>
                <input
                  class="mono"
                  name="treasury_reserve_tokens"
                  [(ngModel)]="treasuryReserveTokensInput"
                  inputmode="numeric"
                />
              </label>
            </div>
            <label>
              <span class="form-label">Total pool-token supply</span>
              <input
                class="mono"
                name="total_pool_token_supply"
                [(ngModel)]="totalPoolTokenSupplyInput"
                inputmode="numeric"
              />
            </label>
          </fieldset>

          <fieldset class="panel grid gap-4">
            <legend class="font-display text-xl">Deed pricing</legend>
            <label>
              <span class="form-label">Collection NAV (mojos)</span>
              <input
                class="mono"
                name="collection_nav_mojos"
                [(ngModel)]="collectionNavMojosInput"
                inputmode="numeric"
              />
            </label>
            <label>
              <span class="form-label">Share (ppm)</span>
              <input
                class="mono"
                name="share_ppm"
                [(ngModel)]="sharePpmInput"
                inputmode="numeric"
              />
            </label>
            <label>
              <span class="form-label">Collection id canon</span>
              <input
                class="mono"
                name="collection_id_canon"
                [(ngModel)]="collectionIdCanonInput"
                (ngModelChange)="navRegistryEvidence.set(null); navRegistryError.set(null)"
              />
            </label>
            <div class="nav-registry-box">
              <button
                class="btn btn--ghost text-xs"
                type="button"
                (click)="refreshNavRegistryEvidence()"
                [disabled]="!canReadNavRegistryEvidence()"
              >
                @if (navRegistryLoading()) { Reading&hellip; } @else { Read NAV registry }
              </button>
              <div class="mono text-[0.68rem] text-text-muted break-all">
                {{ navRegistryStatus() }}
              </div>
            </div>
            <label>
              <span class="form-label">Seller price for acquisition</span>
              <input
                class="mono"
                name="seller_token_price"
                [(ngModel)]="sellerTokenPriceInput"
                inputmode="numeric"
              />
            </label>
          </fieldset>
        </form>

        <div class="grid gap-4">
          <section class="summary-band">
            <div>
              <div class="mono text-xs uppercase text-text-muted">Circulating supply</div>
              <div class="font-display text-2xl">{{ circulatingSupplyLabel() }}</div>
            </div>
            <div>
              <div class="mono text-xs uppercase text-text-muted">Pool-token NAV</div>
              <div class="font-display text-2xl">{{ poolTokenNavLabel() }}</div>
            </div>
            <div>
              <div class="mono text-xs uppercase text-text-muted">Deed NAV</div>
              <div class="font-display text-2xl">{{ deedNavLabel() }}</div>
            </div>
          </section>

          <div class="grid gap-4 lg:grid-cols-2">
            <section class="result-panel" data-testid="swap-panel">
              <div class="panel-head">
                <div>
                  <h2 class="font-display text-2xl">Swap for deed</h2>
                  <div class="mono text-xs text-text-muted">Specific deed swap</div>
                </div>
                <span class="pill">supply unchanged</span>
              </div>

              @if (swapPreview(); as preview) {
                @if (preview.kind === 'ok') {
                  <dl class="metric-grid">
                    <div>
                      <dt>Buyer pays</dt>
                      <dd>{{ formatTokens(preview.quote.buyerPaysTokens) }}</dd>
                    </div>
                    <div>
                      <dt>Principal to reserve</dt>
                      <dd>{{ formatTokens(preview.quote.principalTokens) }}</dd>
                    </div>
                    <div>
                      <dt>Protocol treasury fee</dt>
                      <dd>{{ formatTokens(preview.quote.fee.protocolTreasuryTokens) }}</dd>
                    </div>
                    <div>
                      <dt>SGT rewards fee</dt>
                      <dd>{{ formatTokens(preview.quote.fee.governanceRewardsTokens) }}</dd>
                    </div>
                    <div>
                      <dt>Reserve after</dt>
                      <dd>{{ formatTokens(preview.quote.treasuryReserveTokensAfter) }}</dd>
                    </div>
                    <div>
                      <dt>Circulating after</dt>
                      <dd>{{ formatTokens(preview.quote.circulatingSupplyAfter) }}</dd>
                    </div>
                  </dl>
                  @if (swapBuilderPreview(); as builder) {
                    <div class="builder-preview">
                      @if (builder.kind === 'ok') {
                        <div class="builder-title">Builder preview</div>
                        <dl class="builder-grid">
                          <div>
                            <dt>Spend case</dt>
                            <dd>{{ builder.preview.spendCase }}</dd>
                          </div>
                          <div>
                            <dt>Action tag</dt>
                            <dd>{{ formatActionTag(builder.preview.actionTag) }}</dd>
                          </div>
                          <div>
                            <dt>Witness spends</dt>
                            <dd>
                              {{ builder.preview.requiredWitnessCoinSpends }} /
                              {{ builder.preview.maxWitnessCoinSpends }}
                            </dd>
                          </div>
                          <div>
                            <dt>Bundle spend limit</dt>
                            <dd>{{ builder.preview.unsignedBundleCoinSpendLimit }}</dd>
                          </div>
                        </dl>
                        <div class="announcement-list">
                          @for (item of builder.preview.requiredAnnouncements; track announcementKey(item)) {
                            <div class="announcement-row">
                              <span>{{ item.role }}</span>
                              <span>{{ item.kind }}</span>
                            </div>
                          }
                        </div>
                        <details class="message-details">
                          <summary>Action messages</summary>
                          <dl>
                            <div>
                              <dt>Pool action</dt>
                              <dd class="hash-line">{{ builder.preview.poolActionMessage }}</dd>
                            </div>
                            <div>
                              <dt>Deed</dt>
                              <dd class="hash-line">{{ builder.preview.deedMessage }}</dd>
                            </div>
                            @if (builder.preview.tokenSettlementPaymentMessage) {
                              <div>
                                <dt>Token settlement</dt>
                                <dd class="hash-line">{{ builder.preview.tokenSettlementPaymentMessage }}</dd>
                              </div>
                            }
                          </dl>
                        </details>
                        <div class="dry-run-box">
                          <button
                            class="btn btn--ghost text-xs"
                            type="button"
                            (click)="runSwapComposeDryRun()"
                            [disabled]="composeDryRunBusy() === 'specific-deed-swap'"
                          >
                            @if (composeDryRunBusy() === 'specific-deed-swap') {
                              Running&hellip;
                            } @else {
                              Dry-run compose
                            }
                          </button>
                          @if (swapComposeDryRun(); as dryRun) {
                            @if (dryRun.kind === 'ok') {
                              <div class="ok-box">
                                Compose dry-run passed:
                                {{ dryRun.result.coinSpendCount }} coin spends,
                                {{ dryRun.result.witnessCoinSpendCount }} witnesses.
                              </div>
                              <div class="dry-run-roles">{{ dryRunWitnessRoles(dryRun.result) }}</div>
                            } @else {
                              <div class="error-box">{{ dryRun.message }}</div>
                            }
                          }
                        </div>
                      } @else {
                        <div class="error-box">{{ builder.message }}</div>
                      }
                    </div>
                  }
                } @else {
                  <div class="error-box">{{ preview.message }}</div>
                }
              }
            </section>

            <section class="result-panel" data-testid="redemption-panel">
              <div class="panel-head">
                <div>
                  <h2 class="font-display text-2xl">Redeem and burn</h2>
                  <div class="mono text-xs text-text-muted">True redemption</div>
                </div>
                <span class="pill pill--burn">CAT melt</span>
              </div>

              @if (redemptionPreview(); as preview) {
                @if (preview.kind === 'ok') {
                  <dl class="metric-grid">
                    <div>
                      <dt>Burn amount</dt>
                      <dd>{{ formatTokens(preview.quote.principalTokens) }}</dd>
                    </div>
                    <div>
                      <dt>Total supply after</dt>
                      <dd>{{ formatTokens(preview.quote.totalSupplyAfter) }}</dd>
                    </div>
                    <div>
                      <dt>Reserve after</dt>
                      <dd>{{ formatTokens(preview.quote.treasuryReserveTokensAfter) }}</dd>
                    </div>
                    <div>
                      <dt>Circulating after</dt>
                      <dd>{{ formatTokens(preview.quote.circulatingSupplyAfter) }}</dd>
                    </div>
                    <div>
                      <dt>NAV locked after</dt>
                      <dd>{{ formatMojos(preview.quote.totalNavLockedAfter) }}</dd>
                    </div>
                    <div>
                      <dt>Deeds after</dt>
                      <dd>{{ formatTokens(preview.quote.deedCountAfter) }}</dd>
                    </div>
                  </dl>
                  @if (redemptionBuilderPreview(); as builder) {
                    <div class="builder-preview">
                      @if (builder.kind === 'ok') {
                        <div class="builder-title">Builder preview</div>
                        <dl class="builder-grid">
                          <div>
                            <dt>Spend case</dt>
                            <dd>{{ builder.preview.spendCase }}</dd>
                          </div>
                          <div>
                            <dt>Action tag</dt>
                            <dd>{{ formatActionTag(builder.preview.actionTag) }}</dd>
                          </div>
                          <div>
                            <dt>Witness spends</dt>
                            <dd>
                              {{ builder.preview.requiredWitnessCoinSpends }} /
                              {{ builder.preview.maxWitnessCoinSpends }}
                            </dd>
                          </div>
                          <div>
                            <dt>Token authorizations</dt>
                            <dd>{{ builder.preview.tokenAuthorizationCount }}</dd>
                          </div>
                        </dl>
                        <div class="announcement-list">
                          @for (item of builder.preview.requiredAnnouncements; track announcementKey(item)) {
                            <div class="announcement-row">
                              <span>{{ item.role }}</span>
                              <span>{{ item.kind }}</span>
                            </div>
                          }
                        </div>
                        <details class="message-details">
                          <summary>Action messages</summary>
                          <dl>
                            <div>
                              <dt>Pool action</dt>
                              <dd class="hash-line">{{ builder.preview.poolActionMessage }}</dd>
                            </div>
                            <div>
                              <dt>Deed</dt>
                              <dd class="hash-line">{{ builder.preview.deedMessage }}</dd>
                            </div>
                          </dl>
                        </details>
                        <div class="dry-run-box">
                          <button
                            class="btn btn--ghost text-xs"
                            type="button"
                            (click)="runRedemptionComposeDryRun()"
                            [disabled]="composeDryRunBusy() === 'true-redemption'"
                          >
                            @if (composeDryRunBusy() === 'true-redemption') {
                              Running&hellip;
                            } @else {
                              Dry-run compose
                            }
                          </button>
                          @if (redemptionComposeDryRun(); as dryRun) {
                            @if (dryRun.kind === 'ok') {
                              <div class="ok-box">
                                Compose dry-run passed:
                                {{ dryRun.result.coinSpendCount }} coin spends,
                                {{ dryRun.result.witnessCoinSpendCount }} witnesses.
                              </div>
                              <div class="dry-run-roles">{{ dryRunWitnessRoles(dryRun.result) }}</div>
                            } @else {
                              <div class="error-box">{{ dryRun.message }}</div>
                            }
                          }
                        </div>
                      } @else {
                        <div class="error-box">{{ builder.message }}</div>
                      }
                    </div>
                  }
                } @else {
                  <div class="error-box">{{ preview.message }}</div>
                }
              }
            </section>
          </div>

          <section class="result-panel" data-testid="acquisition-panel">
            <div class="panel-head">
              <div>
                <h2 class="font-display text-2xl">Reserve acquisition</h2>
                <div class="mono text-xs text-text-muted">Treasury reserve first</div>
              </div>
              <span class="pill">bounded payment</span>
            </div>

            @if (acquisitionPreview(); as preview) {
              @if (preview.kind === 'ok') {
                <dl class="metric-grid metric-grid--wide">
                  <div>
                    <dt>Seller receives reserve tokens</dt>
                    <dd>{{ formatTokens(preview.quote.sellerReceivesReserveTokens) }}</dd>
                  </div>
                  <div>
                    <dt>Fresh mint shortfall</dt>
                    <dd>{{ formatTokens(preview.quote.freshMintShortfallTokens) }}</dd>
                  </div>
                  <div>
                    <dt>Total supply after</dt>
                    <dd>{{ formatTokens(preview.quote.totalSupplyAfter) }}</dd>
                  </div>
                  <div>
                    <dt>Reserve after</dt>
                    <dd>{{ formatTokens(preview.quote.treasuryReserveTokensAfter) }}</dd>
                  </div>
                  <div>
                    <dt>NAV locked after</dt>
                    <dd>{{ formatMojos(preview.quote.totalNavLockedAfter) }}</dd>
                  </div>
                  <div>
                    <dt>Deeds after</dt>
                    <dd>{{ formatTokens(preview.quote.deedCountAfter) }}</dd>
                  </div>
                </dl>
                @if (acquisitionBuilderPreview(); as builder) {
                  <div class="builder-preview">
                    @if (builder.kind === 'ok') {
                      <div class="builder-title">Builder preview</div>
                      <dl class="builder-grid builder-grid--wide">
                        <div>
                          <dt>Spend case</dt>
                          <dd>{{ builder.preview.spendCase }}</dd>
                        </div>
                        <div>
                          <dt>Action tag</dt>
                          <dd>{{ formatActionTag(builder.preview.actionTag) }}</dd>
                        </div>
                        <div>
                          <dt>Witness spends</dt>
                          <dd>
                            {{ builder.preview.requiredWitnessCoinSpends }} /
                            {{ builder.preview.maxWitnessCoinSpends }}
                          </dd>
                        </div>
                        <div>
                          <dt>Token outputs</dt>
                          <dd>{{ builder.preview.tokenOutputCount }}</dd>
                        </div>
                        <div>
                          <dt>Token authorizations</dt>
                          <dd>{{ builder.preview.tokenAuthorizationCount }}</dd>
                        </div>
                        <div>
                          <dt>Bundle spend limit</dt>
                          <dd>{{ builder.preview.unsignedBundleCoinSpendLimit }}</dd>
                        </div>
                      </dl>
                      <div class="announcement-list">
                        @for (item of builder.preview.requiredAnnouncements; track announcementKey(item)) {
                          <div class="announcement-row">
                            <span>{{ item.role }}</span>
                            <span>{{ item.kind }}</span>
                          </div>
                        }
                      </div>
                      <details class="message-details">
                        <summary>Action messages</summary>
                        <dl>
                          <div>
                            <dt>Pool action</dt>
                            <dd class="hash-line">{{ builder.preview.poolActionMessage }}</dd>
                          </div>
                          <div>
                            <dt>Deed</dt>
                            <dd class="hash-line">{{ builder.preview.deedMessage }}</dd>
                          </div>
                          @if (builder.preview.tokenSettlementPaymentMessage) {
                            <div>
                              <dt>Token settlement</dt>
                              <dd class="hash-line">{{ builder.preview.tokenSettlementPaymentMessage }}</dd>
                            </div>
                          }
                        </dl>
                      </details>
                      <div class="dry-run-box">
                        <button
                          class="btn btn--ghost text-xs"
                          type="button"
                          (click)="runAcquisitionComposeDryRun()"
                          [disabled]="composeDryRunBusy() === 'reserve-acquisition'"
                        >
                          @if (composeDryRunBusy() === 'reserve-acquisition') {
                            Running&hellip;
                          } @else {
                            Dry-run compose
                          }
                        </button>
                        @if (acquisitionComposeDryRun(); as dryRun) {
                          @if (dryRun.kind === 'ok') {
                            <div class="ok-box">
                              Compose dry-run passed:
                              {{ dryRun.result.coinSpendCount }} coin spends,
                              {{ dryRun.result.witnessCoinSpendCount }} witnesses.
                            </div>
                            <div class="dry-run-roles">{{ dryRunWitnessRoles(dryRun.result) }}</div>
                          } @else {
                            <div class="error-box">{{ dryRun.message }}</div>
                          }
                        }
                      </div>
                    } @else {
                      <div class="error-box">{{ builder.message }}</div>
                    }
                  </div>
                }
              } @else {
                <div class="error-box">{{ preview.message }}</div>
              }
            }
          </section>

          <section class="result-panel execution-panel" data-testid="execution-panel">
            <div class="panel-head">
              <div>
                <h2 class="font-display text-2xl">Execution package</h2>
                <div class="mono text-xs text-text-muted">Witness preflight</div>
              </div>
              <span class="pill">coinset direct</span>
            </div>

            <div class="execution-grid">
              <label>
                <span class="form-label">Action</span>
                <select
                  class="mono"
                  name="execution_kind"
                  [(ngModel)]="executionKindInput"
                  (ngModelChange)="executionBundle.set(null); executionSubmit.set(null); deedWitnessEvidence.set(null); deedWitnessError.set(null)"
                >
                  <option value="specific-deed-swap">Swap for deed</option>
                  <option value="true-redemption">Redeem and burn</option>
                  <option value="reserve-acquisition">Reserve acquisition</option>
                </select>
              </label>
              <div class="deed-witness-box">
                <div class="grid gap-4 md:grid-cols-2">
                  <label>
                    <span class="form-label">Deed launcher id</span>
                    <input
                      class="mono"
                      name="deed_launcher_id"
                      [(ngModel)]="deedLauncherIdInput"
                      (ngModelChange)="deedWitnessEvidence.set(null); deedWitnessError.set(null)"
                    />
                  </label>
                  <label>
                    <span class="form-label">Destination vault launcher id</span>
                    <input
                      class="mono"
                      name="destination_vault_launcher_id"
                      [(ngModel)]="destinationVaultLauncherIdInput"
                      (ngModelChange)="deedWitnessEvidence.set(null); deedWitnessError.set(null)"
                    />
                  </label>
                </div>
                <div class="grid gap-4 md:grid-cols-3">
                  <label>
                    <span class="form-label">Property id canon</span>
                    <input
                      class="mono"
                      name="witness_property_id_canon"
                      [(ngModel)]="propertyIdCanonInput"
                      (ngModelChange)="deedWitnessEvidence.set(null); deedWitnessError.set(null)"
                    />
                  </label>
                  <label>
                    <span class="form-label">Par value mojos</span>
                    <input
                      class="mono"
                      name="witness_par_value_mojos"
                      [(ngModel)]="parValueMojosInput"
                      inputmode="numeric"
                      (ngModelChange)="deedWitnessEvidence.set(null); deedWitnessError.set(null)"
                    />
                  </label>
                  <label>
                    <span class="form-label">Asset class</span>
                    <input
                      class="mono"
                      name="witness_asset_class"
                      [(ngModel)]="assetClassInput"
                      inputmode="numeric"
                      (ngModelChange)="deedWitnessEvidence.set(null); deedWitnessError.set(null)"
                    />
                  </label>
                </div>
                <label>
                  <span class="form-label">Pool launcher puzzle hash</span>
                  <input
                    class="mono"
                    name="pool_launcher_puzzle_hash"
                    [(ngModel)]="launcherPuzzleHashInput"
                    (ngModelChange)="deedWitnessEvidence.set(null); deedWitnessError.set(null)"
                  />
                </label>
                <label>
                  <span class="form-label">Current smart-deed inner puzzle hex</span>
                  <textarea
                    class="mono deed-inner-textarea"
                    name="deed_inner_puzzle_hex"
                    [(ngModel)]="deedInnerPuzzleHexInput"
                    (ngModelChange)="deedWitnessEvidence.set(null); deedWitnessError.set(null)"
                    spellcheck="false"
                  ></textarea>
                </label>
                <div class="flex flex-wrap items-center gap-3">
                  <button
                    class="btn btn--ghost text-xs"
                    type="button"
                    (click)="buildDeedWitness()"
                    [disabled]="!canBuildDeedWitness()"
                  >
                    @if (deedWitnessLoading()) { Building&hellip; } @else { Build deed witness }
                  </button>
                  <div class="mono text-[0.68rem] text-text-muted break-all">
                    {{ deedWitnessStatus() }}
                  </div>
                </div>
              </div>
              <div class="token-witness-box">
                <div class="grid gap-4 md:grid-cols-2">
                  <label>
                    <span class="form-label">Token settlement puzzle hash</span>
                    <input
                      class="mono"
                      name="token_settlement_puzzle_hash"
                      [(ngModel)]="tokenSettlementPuzzleHashInput"
                      (ngModelChange)="tokenWitnessPreview.set(null)"
                    />
                  </label>
                  <label>
                    <span class="form-label">Token authorization spends JSON</span>
                    <textarea
                      class="mono token-witness-textarea"
                      name="token_authorization_spends_json"
                      [(ngModel)]="tokenAuthorizationSpendsText"
                      (ngModelChange)="tokenWitnessPreview.set(null)"
                      spellcheck="false"
                    ></textarea>
                  </label>
                </div>
                <label>
                  <span class="form-label">Token settlement spend JSON</span>
                  <textarea
                    class="mono token-witness-textarea"
                    name="token_settlement_spend_json"
                    [(ngModel)]="tokenSettlementSpendText"
                    (ngModelChange)="tokenWitnessPreview.set(null)"
                    spellcheck="false"
                  ></textarea>
                </label>
                <div class="grid gap-4 md:grid-cols-2">
                  <label>
                    <span class="form-label">Token CAT coin JSON</span>
                    <textarea
                      class="mono token-witness-textarea"
                      name="token_authorization_coin_json"
                      [(ngModel)]="tokenAuthorizationCoinText"
                      (ngModelChange)="tokenAuthorizationSpendPreview.set(null)"
                      spellcheck="false"
                    ></textarea>
                  </label>
                  <label>
                    <span class="form-label">Token CAT lineage JSON</span>
                    <textarea
                      class="mono token-witness-textarea"
                      name="token_authorization_lineage_json"
                      [(ngModel)]="tokenAuthorizationLineageText"
                      (ngModelChange)="tokenAuthorizationSpendPreview.set(null)"
                      spellcheck="false"
                    ></textarea>
                  </label>
                </div>
                <div class="grid gap-4 md:grid-cols-2">
                  <label>
                    <span class="form-label">Token inner puzzle hex</span>
                    <textarea
                      class="mono token-witness-textarea"
                      name="token_authorization_inner_puzzle_hex"
                      [(ngModel)]="tokenAuthorizationInnerPuzzleHex"
                      (ngModelChange)="tokenAuthorizationSpendPreview.set(null)"
                      spellcheck="false"
                    ></textarea>
                  </label>
                  <label>
                    <span class="form-label">Token inner solution hex</span>
                    <textarea
                      class="mono token-witness-textarea"
                      name="token_authorization_inner_solution_hex"
                      [(ngModel)]="tokenAuthorizationInnerSolutionHex"
                      (ngModelChange)="tokenAuthorizationSpendPreview.set(null)"
                      spellcheck="false"
                    ></textarea>
                  </label>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                  <button
                    class="btn btn--ghost text-xs"
                    type="button"
                    (click)="describeTokenWitnessRequirements()"
                    [disabled]="executionBusy() !== null"
                  >
                    Token requirements
                  </button>
                  <button
                    class="btn btn--ghost text-xs"
                    type="button"
                    (click)="applyTokenWitnesses()"
                    [disabled]="executionBusy() !== null"
                  >
                    Apply token witnesses
                  </button>
                  <button
                    class="btn btn--ghost text-xs"
                    type="button"
                    (click)="buildTokenTailMaterial()"
                    [disabled]="executionBusy() !== null"
                  >
                    Build token TAIL material
                  </button>
                  <button
                    class="btn btn--ghost text-xs"
                    type="button"
                    (click)="buildTokenAuthorizationSpend()"
                    [disabled]="executionBusy() !== null"
                  >
                    Build token CAT spend
                  </button>
                  <div class="mono text-[0.68rem] text-text-muted break-all">
                    {{ tokenWitnessStatus() }}
                  </div>
                </div>
                <div class="mono text-[0.68rem] text-text-muted break-all">
                  {{ tokenTailMaterialStatus() }}
                </div>
                <div class="mono text-[0.68rem] text-text-muted break-all">
                  {{ tokenAuthorizationSpendStatus() }}
                </div>
                @if (tokenWitnessPreview(); as preview) {
                  @if (preview.kind === 'ok') {
                    <div class="announcement-list">
                      @for (item of preview.requirements; track announcementKey(item)) {
                        <div class="announcement-row">
                          <span>{{ item.role }}</span>
                          <span>{{ item.kind }}</span>
                        </div>
                      }
                    </div>
                  } @else if (preview.kind === 'error') {
                    <div class="error-box">{{ preview.message }}</div>
                  }
                }
                @if (tokenTailMaterialText) {
                  <label>
                    <span class="form-label">Token TAIL material JSON</span>
                    <textarea
                      class="mono token-witness-textarea"
                      name="token_tail_material_json"
                      [ngModel]="tokenTailMaterialText"
                      [ngModelOptions]="{ standalone: true }"
                      readonly
                      spellcheck="false"
                    ></textarea>
                  </label>
                }
              </div>
              <label>
                <span class="form-label">Package JSON</span>
                <textarea
                  class="mono execution-textarea"
                  name="execution_package"
                  [(ngModel)]="executionPackageText"
                  (ngModelChange)="executionBundle.set(null); executionSubmit.set(null)"
                  spellcheck="false"
                ></textarea>
              </label>
            </div>

            <div class="execution-actions">
              <button
                class="btn btn--ghost text-xs"
                type="button"
                (click)="prefillExecutionPackage()"
                [disabled]="!canPrefillExecutionPackage()"
              >
                Prefill from chain
              </button>
              <button
                class="btn btn--ghost text-xs"
                type="button"
                (click)="preflightExecutionPackage()"
                [disabled]="executionBusy() !== null"
              >
                @if (executionBusy() && executionBusy() !== 'submit') {
                  Composing&hellip;
                } @else {
                  Preflight compose
                }
              </button>
              <button
                class="btn btn--primary text-xs"
                type="button"
                (click)="submitExecutionBundle()"
                [disabled]="!canSubmitExecutionBundle()"
              >
                @if (executionBusy() === 'submit') {
                  Submitting&hellip;
                } @else {
                  Submit to coinset
                }
              </button>
            </div>

            @if (executionBundle(); as bundle) {
              @if (bundle.kind === 'ok') {
                <div class="ok-box mt-4">
                  Execution preflight passed:
                  {{ bundle.result.coinSpends.length }} coin spends,
                  {{ bundle.result.witnessSummary.length }} witnesses.
                </div>
                <dl class="builder-grid mt-4">
                  <div>
                    <dt>Spend case</dt>
                    <dd>{{ bundle.result.spendCase }}</dd>
                  </div>
                  <div>
                    <dt>Action tag</dt>
                    <dd>{{ formatActionTag(bundle.result.actionTag) }}</dd>
                  </div>
                  <div>
                    <dt>Aggregate signature</dt>
                    <dd class="hash-line">{{ bundle.result.signaturelessSpendBundle.aggregatedSignature }}</dd>
                  </div>
                  <div>
                    <dt>Witness roles</dt>
                    <dd class="hash-line">{{ executionWitnessRoles(bundle.result) }}</dd>
                  </div>
                </dl>
              } @else {
                <div class="error-box mt-4">{{ bundle.message }}</div>
              }
            }

            @if (executionSubmit(); as submit) {
              @if (submit.kind === 'submitted') {
                <div class="ok-box mt-4">Submitted: {{ submit.status ?? 'accepted' }}</div>
              } @else {
                <div class="error-box mt-4">{{ submit.message }}</div>
              }
            }
          </section>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .panel,
      .result-panel,
      .chain-panel,
      .summary-band {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.03);
      }

      .panel {
        padding: 1.25rem;
      }

      fieldset {
        min-inline-size: 0;
      }

      legend {
        padding: 0 0.45rem;
        margin-left: -0.45rem;
      }

      .form-label {
        display: block;
        margin-bottom: 0.35rem;
        font-family: var(--font-mono);
        font-size: 0.7rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .summary-band {
        display: grid;
        gap: 1rem;
        padding: 1rem;
      }

      @media (min-width: 768px) {
        .summary-band {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      .result-panel {
        padding: 1.25rem;
      }

      .chain-panel {
        padding: 1.25rem;
      }

      .chain-panel__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .panel-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .pill {
        flex: 0 0 auto;
        border: 1px solid rgba(124, 255, 178, 0.35);
        border-radius: 999px;
        padding: 0.25rem 0.55rem;
        font-family: var(--font-mono);
        font-size: 0.65rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #7cffb2;
        background: rgba(124, 255, 178, 0.08);
      }

      .pill--burn {
        border-color: rgba(255, 180, 90, 0.38);
        color: #ffcf8a;
        background: rgba(255, 180, 90, 0.08);
      }

      .metric-grid {
        display: grid;
        gap: 0.75rem;
      }

      @media (min-width: 640px) {
        .metric-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .metric-grid--wide {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      dt {
        font-family: var(--font-mono);
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }

      dd {
        margin-top: 0.15rem;
        font-family: var(--font-display);
        font-size: 1.28rem;
        color: var(--text);
        overflow-wrap: anywhere;
      }

      .hash-dd {
        font-family: var(--font-mono);
        font-size: 0.72rem;
        line-height: 1.45;
      }

      .error-box {
        border: 1px solid rgba(255, 120, 120, 0.35);
        border-radius: 8px;
        padding: 0.85rem;
        color: rgb(255, 170, 170);
        background: rgba(255, 120, 120, 0.08);
        font-family: var(--font-mono);
        font-size: 0.78rem;
      }

      .builder-preview {
        margin-top: 1rem;
        border-top: 1px solid var(--border);
        padding-top: 1rem;
      }

      .builder-title {
        font-family: var(--font-mono);
        font-size: 0.68rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 0.75rem;
      }

      .builder-grid {
        display: grid;
        gap: 0.75rem;
      }

      @media (min-width: 640px) {
        .builder-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .builder-grid--wide {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      .builder-grid dd {
        font-size: 1rem;
      }

      .announcement-list {
        display: grid;
        gap: 0.4rem;
        margin-top: 0.85rem;
      }

      .announcement-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.75rem;
        align-items: center;
        border: 1px solid rgba(234, 255, 247, 0.1);
        border-radius: 8px;
        padding: 0.45rem 0.55rem;
        font-family: var(--font-mono);
        font-size: 0.68rem;
        color: var(--muted);
      }

      .message-details {
        margin-top: 0.8rem;
        font-family: var(--font-mono);
        font-size: 0.72rem;
        color: var(--muted);
      }

      .message-details summary {
        cursor: pointer;
      }

      .message-details dl {
        display: grid;
        gap: 0.65rem;
        margin-top: 0.7rem;
      }

      .hash-line {
        font-family: var(--font-mono);
        font-size: 0.68rem;
        line-height: 1.45;
      }

      .dry-run-box {
        display: grid;
        gap: 0.6rem;
        justify-items: start;
        margin-top: 0.9rem;
      }

      .ok-box {
        border: 1px solid rgba(124, 255, 178, 0.35);
        border-radius: 8px;
        padding: 0.7rem;
        color: #9dffc5;
        background: rgba(124, 255, 178, 0.08);
        font-family: var(--font-mono);
        font-size: 0.72rem;
      }

      .dry-run-roles {
        font-family: var(--font-mono);
        font-size: 0.68rem;
        color: var(--muted);
        overflow-wrap: anywhere;
      }

      .execution-panel {
        margin-top: 1rem;
      }

      .execution-grid {
        display: grid;
        gap: 1rem;
      }

      .execution-textarea {
        min-height: 15rem;
        resize: vertical;
        line-height: 1.45;
      }

      .deed-witness-box,
      .token-witness-box {
        display: grid;
        gap: 0.9rem;
        border: 1px solid rgba(234, 255, 247, 0.1);
        border-radius: 8px;
        padding: 0.9rem;
      }

      .deed-inner-textarea,
      .token-witness-textarea {
        min-height: 6.5rem;
        resize: vertical;
        line-height: 1.45;
      }

      .execution-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem;
        margin-top: 1rem;
      }

      .nav-registry-box {
        display: grid;
        gap: 0.55rem;
        justify-items: start;
      }
    `,
  ],
})
export class PoolEconomicsV2Component implements OnInit {
  private readonly economics = inject(PoolEconomicsV2Service);
  private readonly actionPreview = inject(PoolEconomicsV2ActionPreviewService);
  private readonly composeDryRun = inject(PoolEconomicsV2ComposeDryRunService);
  private readonly executionRunner = inject(PoolEconomicsV2ExecutionRunnerService);
  private readonly spendBuilder = inject(PoolEconomicsV2SpendBuilderService);
  private readonly chainState = inject(PoolEconomicsV2ChainStateService);
  private readonly navRegistry = inject(PoolEconomicsV2NavRegistryChainStateService);
  private readonly deedWitness = inject(PoolEconomicsV2DeedWitnessService);
  private readonly tokenAuthorization = inject(PoolEconomicsV2TokenAuthorizationService);

  readonly chainEvidence = signal<PoolV2ChainStateEvidence | null>(null);
  readonly chainLoading = signal(false);
  readonly chainError = signal<string | null>(null);
  readonly navRegistryEvidence = signal<CollectionNavRegistryEvidence | null>(null);
  readonly navRegistryLoading = signal(false);
  readonly navRegistryError = signal<string | null>(null);
  readonly deedWitnessEvidence = signal<PoolV2DeedWitnessEvidence | null>(null);
  readonly deedWitnessLoading = signal(false);
  readonly deedWitnessError = signal<string | null>(null);
  readonly composeDryRunBusy = signal<PoolV2ActionPreviewKind | null>(null);
  readonly swapComposeDryRun = signal<ComposeDryRunPreview | null>(null);
  readonly redemptionComposeDryRun = signal<ComposeDryRunPreview | null>(null);
  readonly acquisitionComposeDryRun = signal<ComposeDryRunPreview | null>(null);
  readonly executionBusy = signal<PoolV2ExecutionKind | 'submit' | null>(null);
  readonly executionBundle = signal<ExecutionBundlePreview | null>(null);
  readonly executionSubmit = signal<ExecutionSubmitPreview | null>(null);
  readonly tokenWitnessPreview = signal<TokenWitnessRequirementsPreview | null>(null);
  readonly tokenTailMaterialPreview = signal<TokenTailMaterialPreview | null>(null);
  readonly tokenAuthorizationSpendPreview = signal<TokenAuthorizationSpendPreview | null>(null);

  totalNavLockedMojosInput = '1000000000';
  deedCountInput = '4';
  totalPoolTokenSupplyInput = '1000000000';
  treasuryReserveTokensInput = '200000000';
  collectionNavMojosInput = '1000000000';
  sharePpmInput = '250000';
  collectionIdCanonInput = '';
  sellerTokenPriceInput = '300000000';
  executionKindInput: PoolV2ExecutionKind = 'specific-deed-swap';
  deedLauncherIdInput = '';
  deedInnerPuzzleHexInput = '';
  destinationVaultLauncherIdInput = '';
  propertyIdCanonInput = '';
  parValueMojosInput = '';
  assetClassInput = '1';
  launcherPuzzleHashInput = SINGLETON_LAUNCHER_HASH;
  tokenSettlementPuzzleHashInput = '';
  tokenSettlementSpendText = '';
  tokenAuthorizationSpendsText = '[]';
  tokenTailMaterialText = '';
  tokenAuthorizationCoinText = '';
  tokenAuthorizationLineageText = '{}';
  tokenAuthorizationInnerPuzzleHex = '';
  tokenAuthorizationInnerSolutionHex = '';
  executionPackageText = '';

  ngOnInit(): void {
    void this.refreshChainState();
  }

  async refreshChainState(): Promise<void> {
    if (this.chainLoading()) return;
    this.chainLoading.set(true);
    this.chainError.set(null);
    try {
      this.chainEvidence.set(await this.chainState.readCurrentState());
    } catch (e) {
      this.chainEvidence.set(null);
      this.chainError.set(formatError(e));
    } finally {
      this.chainLoading.set(false);
    }
  }

  applyChainState(): void {
    const evidence = this.chainEvidence();
    if (!evidence || evidence.kind !== 'confirmed') return;
    this.totalNavLockedMojosInput = evidence.state.totalNavLockedMojos.toString();
    this.deedCountInput = evidence.state.deedCount.toString();
    this.totalPoolTokenSupplyInput = evidence.state.totalPoolTokenSupply.toString();
    this.treasuryReserveTokensInput = evidence.state.treasuryReserveTokens.toString();
  }

  canApplyChainState(): boolean {
    return !this.chainLoading() && this.chainEvidence()?.kind === 'confirmed';
  }

  async refreshNavRegistryEvidence(): Promise<void> {
    if (!this.canReadNavRegistryEvidence()) return;
    this.navRegistryLoading.set(true);
    this.navRegistryError.set(null);
    try {
      const evidence = await this.navRegistry.readCollectionNav({
        collectionIdCanon: this.collectionIdCanonInput.trim(),
      });
      this.navRegistryEvidence.set(evidence);
      if (evidence.kind === 'confirmed-present') {
        this.collectionIdCanonInput = evidence.collectionIdCanon;
        this.collectionNavMojosInput = evidence.navValueMojos.toString();
      }
    } catch (e) {
      this.navRegistryEvidence.set(null);
      this.navRegistryError.set(formatError(e));
    } finally {
      this.navRegistryLoading.set(false);
    }
  }

  canReadNavRegistryEvidence(): boolean {
    return (
      !this.navRegistryLoading() &&
      /^0x[0-9a-fA-F]{64}$/.test(this.collectionIdCanonInput.trim())
    );
  }

  navRegistryStatus(): string {
    if (this.navRegistryLoading()) return 'Reading collection NAV registry.';
    if (this.navRegistryError()) return this.navRegistryError()!;
    const evidence = this.navRegistryEvidence();
    if (!evidence) return 'No NAV registry evidence loaded.';
    switch (evidence.kind) {
      case 'confirmed-present':
        return (
          `NAV ${evidence.navValueMojos.toString()} mojos - root ` +
          `${this.shortHex(evidence.collectionNavRoot)} - version ${evidence.registryVersion.toString()}`
        );
      case 'mismatch':
        return 'Collection id is not registered in the live NAV registry.';
      case 'not-configured':
      case 'read-failed':
        return evidence.error;
      case 'not-launched':
        return evidence.error;
      case 'not-spent':
        return 'Collection NAV registry is still at eve state.';
    }
  }

  async buildDeedWitness(): Promise<void> {
    const poolEvidence = this.chainEvidence();
    if (!this.canBuildDeedWitness() || poolEvidence?.kind !== 'confirmed') return;
    this.deedWitnessLoading.set(true);
    this.deedWitnessError.set(null);
    try {
      const common = {
        deedLauncherId: this.deedLauncherIdInput.trim(),
        deedInnerPuzzleHex: this.deedInnerPuzzleHexInput.trim(),
        pool: poolEvidence.poolContext,
        launcherPuzzleHash: this.launcherPuzzleHashInput.trim() || SINGLETON_LAUNCHER_HASH,
        collectionIdCanon: this.collectionIdCanonInput.trim(),
        sharePpm: this.sharePpmInput.trim() || '250000',
      };
      const evidence =
        this.executionKindInput === 'reserve-acquisition'
          ? await this.deedWitness.buildDepositWitness({
              ...common,
              propertyIdCanon: this.propertyIdCanonInput.trim(),
              parValueMojos: this.parValueMojosInput.trim(),
              assetClass: this.assetClassInput.trim(),
            })
          : await this.deedWitness.buildRedeemWitness({
              ...common,
              vaultLauncherId: this.destinationVaultLauncherIdInput.trim(),
            });
      this.deedWitnessEvidence.set(evidence);
      if (evidence.kind === 'confirmed-redeem') {
        this.destinationVaultLauncherIdInput = evidence.vaultLauncherId;
        this.launcherPuzzleHashInput = evidence.launcherPuzzleHash;
        this.collectionIdCanonInput = evidence.collectionIdCanon;
        this.sharePpmInput = evidence.sharePpm.toString();
      } else if (evidence.kind === 'confirmed-deposit') {
        this.launcherPuzzleHashInput = evidence.launcherPuzzleHash;
        this.propertyIdCanonInput = evidence.propertyIdCanon;
        this.parValueMojosInput = evidence.parValueMojos.toString();
        this.assetClassInput = evidence.assetClass.toString();
        this.collectionIdCanonInput = evidence.collectionIdCanon;
        this.sharePpmInput = evidence.sharePpm.toString();
      }
    } catch (e) {
      this.deedWitnessEvidence.set(null);
      this.deedWitnessError.set(formatError(e));
    } finally {
      this.deedWitnessLoading.set(false);
    }
  }

  canBuildDeedWitness(): boolean {
    const needsVault = this.executionKindInput !== 'reserve-acquisition';
    const hasVault =
      !needsVault || /^0x[0-9a-fA-F]{64}$/.test(this.destinationVaultLauncherIdInput.trim());
    const hasDepositMetadata =
      needsVault ||
      (/^0x[0-9a-fA-F]{64}$/.test(this.propertyIdCanonInput.trim()) &&
        /^[0-9]+$/.test(this.parValueMojosInput.trim()) &&
        /^[0-9]+$/.test(this.assetClassInput.trim()));
    return (
      !this.deedWitnessLoading() &&
      this.chainEvidence()?.kind === 'confirmed' &&
      /^0x[0-9a-fA-F]{64}$/.test(this.deedLauncherIdInput.trim()) &&
      hasVault &&
      hasDepositMetadata &&
      this.deedInnerPuzzleHexInput.trim().length > 2 &&
      /^0x[0-9a-fA-F]+$/.test(this.deedInnerPuzzleHexInput.trim()) &&
      /^0x[0-9a-fA-F]{64}$/.test(this.collectionIdCanonInput.trim())
    );
  }

  deedWitnessStatus(): string {
    if (this.deedWitnessLoading()) return 'Building smart-deed witness.';
    if (this.deedWitnessError()) return this.deedWitnessError()!;
    const evidence = this.deedWitnessEvidence();
    if (!evidence) return 'No deed witness loaded.';
    switch (evidence.kind) {
      case 'confirmed-redeem':
        return (
          `deed ${this.shortHex(evidence.deedCoinId)} -> vault ` +
          `${this.shortHex(evidence.vaultLauncherId)}`
        );
      case 'confirmed-deposit':
        return `deed ${this.shortHex(evidence.deedCoinId)} -> pool deposit`;
      case 'mismatch':
        return `${evidence.reason} mismatch: expected ${evidence.expected}, got ${evidence.actual}.`;
      case 'not-launched':
        return `No launched deed singleton was found for ${this.shortHex(evidence.deedLauncherId)}.`;
      case 'not-spent':
        return 'Deed singleton has not reached a smart-deed spendable state yet.';
      case 'read-failed':
        return evidence.error;
    }
  }

  canPrefillExecutionPackage(): boolean {
    return !this.chainLoading() && this.executionBusy() === null && this.chainEvidence()?.kind === 'confirmed';
  }

  prefillExecutionPackage(): void {
    const evidence = this.chainEvidence();
    if (!evidence || evidence.kind !== 'confirmed') {
      this.executionBundle.set({ kind: 'error', message: 'confirmed pool chain state is required' });
      return;
    }
    this.executionPackageText = JSON.stringify(this.executionPackageDraft(evidence), null, 2);
    this.executionBundle.set(null);
    this.executionSubmit.set(null);
  }

  chainStatusTitle(): string {
    if (this.chainLoading()) return 'Reading pool singleton.';
    if (this.chainError()) return 'Chain read failed.';
    const evidence = this.chainEvidence();
    if (!evidence) return 'Not checked yet.';
    switch (evidence.kind) {
      case 'confirmed':
        return 'Live Pool Economic V2 state confirmed.';
      case 'not-configured':
        return 'Pool launcher not configured.';
      case 'not-launched':
        return 'Pool singleton not launched.';
      case 'not-spent':
        return 'Pool singleton is still at eve state.';
      case 'read-failed':
        return 'Pool chain read failed.';
    }
  }

  chainStatusDetail(): string {
    const evidence = this.chainEvidence();
    if (this.chainLoading()) return 'Walking lineage and replaying the latest spend.';
    if (this.chainError()) return 'The local reader threw before returning evidence.';
    if (!evidence) return 'No chain evidence loaded.';
    switch (evidence.kind) {
      case 'confirmed':
        return (
          `coin ${this.shortHex(evidence.liveCoinId)} - block ${evidence.confirmedBlockIndex} - ` +
          `depth ${evidence.lineageDepth} - spend ${evidence.spendCaseLabel}`
        );
      case 'not-configured':
        return evidence.error;
      case 'not-launched':
        return `launcher ${this.shortHex(evidence.launcherId)}`;
      case 'not-spent':
        return `live coin ${this.shortHex(evidence.liveCoinId)} - block ${evidence.confirmedBlockIndex}`;
      case 'read-failed':
        return evidence.error;
    }
  }

  chainEvidenceMessage(evidence: PoolV2ChainStateEvidence): string {
    switch (evidence.kind) {
      case 'not-configured':
      case 'read-failed':
        return evidence.error;
      case 'not-launched':
        return `No launched pool singleton was found for ${this.shortHex(evidence.launcherId)}.`;
      case 'not-spent':
        return 'The pool launcher has not produced a spendable economic state yet.';
      case 'confirmed':
        return 'Confirmed.';
    }
  }

  swapPreview(): QuotePreview<SpecificDeedSwapQuote> {
    return this.preview((inputs) =>
      this.economics.quoteSpecificDeedSwap({
        state: inputs.state,
        collectionNavMojos: inputs.collectionNavMojos,
        sharePpm: inputs.sharePpm,
      }),
    );
  }

  redemptionPreview(): QuotePreview<TrueRedemptionQuote> {
    return this.preview((inputs) =>
      this.economics.quoteTrueRedemption({
        state: inputs.state,
        collectionNavMojos: inputs.collectionNavMojos,
        sharePpm: inputs.sharePpm,
      }),
    );
  }

  acquisitionPreview(): QuotePreview<ReserveAcquisitionQuote> {
    return this.preview((inputs) =>
      this.economics.quoteReserveAcquisition({
        state: inputs.state,
        collectionNavMojos: inputs.collectionNavMojos,
        sharePpm: inputs.sharePpm,
        sellerTokenPrice: inputs.sellerTokenPrice,
      }),
    );
  }

  swapBuilderPreview(): BuilderPreview {
    return this.builderPreview((inputs) =>
      this.actionPreview.specificDeedSwap({
        state: inputs.state,
        collectionNavMojos: inputs.collectionNavMojos,
        sharePpm: inputs.sharePpm,
        sellerTokenPrice: inputs.sellerTokenPrice,
      }),
    );
  }

  redemptionBuilderPreview(): BuilderPreview {
    return this.builderPreview((inputs) =>
      this.actionPreview.trueRedemption({
        state: inputs.state,
        collectionNavMojos: inputs.collectionNavMojos,
        sharePpm: inputs.sharePpm,
        sellerTokenPrice: inputs.sellerTokenPrice,
      }),
    );
  }

  acquisitionBuilderPreview(): BuilderPreview {
    return this.builderPreview((inputs) =>
      this.actionPreview.reserveAcquisition({
        state: inputs.state,
        collectionNavMojos: inputs.collectionNavMojos,
        sharePpm: inputs.sharePpm,
        sellerTokenPrice: inputs.sellerTokenPrice,
      }),
    );
  }

  runSwapComposeDryRun(): void {
    this.runComposeDryRun('specific-deed-swap', this.swapComposeDryRun, (inputs) =>
      this.composeDryRun.specificDeedSwap(inputs),
    );
  }

  runRedemptionComposeDryRun(): void {
    this.runComposeDryRun('true-redemption', this.redemptionComposeDryRun, (inputs) =>
      this.composeDryRun.trueRedemption(inputs),
    );
  }

  runAcquisitionComposeDryRun(): void {
    this.runComposeDryRun('reserve-acquisition', this.acquisitionComposeDryRun, (inputs) =>
      this.composeDryRun.reserveAcquisition(inputs),
    );
  }

  dryRunWitnessRoles(result: PoolV2ComposeDryRunResult): string {
    return result.witnessSummary.map((w) => w.role).join(', ');
  }

  preflightExecutionPackage(): void {
    const kind = this.executionKindInput;
    if (this.executionBusy()) return;
    this.executionBusy.set(kind);
    this.executionSubmit.set(null);
    try {
      const pkg = this.parseExecutionPackage();
      switch (kind) {
        case 'specific-deed-swap':
          this.executionBundle.set({
            kind: 'ok',
            result: this.executionRunner.composeSpecificDeedSwap({
              pool: pkg.pool,
              state: pkg.state,
              deedId: pkg.deedId,
              deedLauncherId: requiredParsedString(pkg.deedLauncherId, 'deedLauncherId'),
              propertyIdCanon: requiredParsedString(pkg.propertyIdCanon, 'propertyIdCanon'),
              parValueMojos: requiredParsedBigint(pkg.parValueMojos, 'parValueMojos'),
              assetClass: requiredParsedBigint(pkg.assetClass, 'assetClass'),
              buyerVaultLauncherId: requiredParsedString(pkg.buyerVaultLauncherId, 'buyerVaultLauncherId'),
              launcherPuzzleHash: pkg.launcherPuzzleHash,
              buyerVaultCoinId: requiredParsedString(pkg.buyerVaultCoinId, 'buyerVaultCoinId'),
              buyerOwnerPubkey: requiredParsedString(pkg.buyerOwnerPubkey, 'buyerOwnerPubkey'),
              buyerAuthType: requiredParsedBigint(pkg.buyerAuthType, 'buyerAuthType'),
              buyerMembersMerkleRoot: requiredParsedString(pkg.buyerMembersMerkleRoot, 'buyerMembersMerkleRoot'),
              buyerIdentityAttestRoot: requiredParsedString(pkg.buyerIdentityAttestRoot, 'buyerIdentityAttestRoot'),
              buyerBridgePolicyHash: requiredParsedString(pkg.buyerBridgePolicyHash, 'buyerBridgePolicyHash'),
              collectionIdCanon: pkg.collectionIdCanon,
              sharePpm: pkg.sharePpm,
              navEvidence: pkg.navEvidence,
              treasuryReservePuzhash: requiredParsedString(pkg.treasuryReservePuzhash, 'treasuryReservePuzhash'),
              protocolTreasuryPuzhash: requiredParsedString(pkg.protocolTreasuryPuzhash, 'protocolTreasuryPuzhash'),
              governanceRewardsPuzhash: requiredParsedString(pkg.governanceRewardsPuzhash, 'governanceRewardsPuzhash'),
              governanceRewardsRoot: requiredParsedString(pkg.governanceRewardsRoot, 'governanceRewardsRoot'),
              witnesses: pkg.witnesses,
            }),
          });
          break;
        case 'true-redemption':
          this.executionBundle.set({
            kind: 'ok',
            result: this.executionRunner.composeTrueRedemption({
              pool: pkg.pool,
              state: pkg.state,
              deedId: pkg.deedId,
              deedLauncherId: requiredParsedString(pkg.deedLauncherId, 'deedLauncherId'),
              propertyIdCanon: requiredParsedString(pkg.propertyIdCanon, 'propertyIdCanon'),
              parValueMojos: requiredParsedBigint(pkg.parValueMojos, 'parValueMojos'),
              assetClass: requiredParsedBigint(pkg.assetClass, 'assetClass'),
              vaultLauncherId: requiredParsedString(pkg.vaultLauncherId, 'vaultLauncherId'),
              launcherPuzzleHash: pkg.launcherPuzzleHash,
              collectionIdCanon: pkg.collectionIdCanon,
              sharePpm: pkg.sharePpm,
              navEvidence: pkg.navEvidence,
              tokenCoinId: requiredParsedString(pkg.tokenCoinId, 'tokenCoinId'),
              witnesses: pkg.witnesses,
            }),
          });
          break;
        case 'reserve-acquisition':
          this.executionBundle.set({
            kind: 'ok',
            result: this.executionRunner.composeReserveAcquisition({
              pool: pkg.pool,
              state: pkg.state,
              deedId: pkg.deedId,
              deedLauncherId: requiredParsedString(pkg.deedLauncherId, 'deedLauncherId'),
              propertyIdCanon: requiredParsedString(pkg.propertyIdCanon, 'propertyIdCanon'),
              parValueMojos: requiredParsedBigint(pkg.parValueMojos, 'parValueMojos'),
              assetClass: requiredParsedBigint(pkg.assetClass, 'assetClass'),
              collectionIdCanon: pkg.collectionIdCanon,
              sharePpm: pkg.sharePpm,
              navEvidence: pkg.navEvidence,
              sellerPuzhash: requiredParsedString(pkg.sellerPuzhash, 'sellerPuzhash'),
              sellerTokenPrice: requiredParsedBigint(pkg.sellerTokenPrice, 'sellerTokenPrice'),
              mintTokenCoinId: pkg.mintTokenCoinId,
              witnesses: pkg.witnesses,
            }),
          });
          break;
      }
    } catch (e) {
      this.executionBundle.set({ kind: 'error', message: formatError(e) });
    } finally {
      this.executionBusy.set(null);
    }
  }

  async submitExecutionBundle(): Promise<void> {
    const bundle = this.executionBundle();
    if (bundle?.kind !== 'ok' || this.executionBusy()) return;
    this.executionBusy.set('submit');
    this.executionSubmit.set(null);
    try {
      const res = await this.executionRunner.submitSignaturelessBundle(bundle.result);
      this.executionSubmit.set({ kind: 'submitted', status: res.status });
    } catch (e) {
      this.executionSubmit.set({ kind: 'error', message: formatError(e) });
    } finally {
      this.executionBusy.set(null);
    }
  }

  canSubmitExecutionBundle(): boolean {
    return this.executionBundle()?.kind === 'ok' && this.executionBusy() === null;
  }

  describeTokenWitnessRequirements(): void {
    try {
      const pkg = this.parseExecutionPackage();
      const requirements = this.tokenRequirementsForPackage(pkg);
      this.tokenWitnessPreview.set({
        kind: 'ok',
        requirements: requirements.filter((r) =>
          r.role === 'token_settlement' || r.role === 'token_authorization',
        ),
      });
    } catch (e) {
      this.tokenWitnessPreview.set({ kind: 'error', message: formatError(e) });
    }
  }

  buildTokenTailMaterial(): void {
    try {
      const pkg = this.parseExecutionPackage();
      const poolSpend = this.poolSpendForPackage(pkg);
      const auth = poolSpend.spec.tokenAuthorizations[0];
      if (!auth) {
        throw new Error('this action does not require a pool-token mint/melt authorization');
      }
      const mintOrMelt = normaliseAuthMintOrMelt(auth.mintOrMelt);
      const material = this.tokenAuthorization.buildForAuthorization({
        pool: pkg.pool,
        tokenCoinId: auth.tokenCoinId,
        mintOrMelt,
        amount: auth.amount,
      });
      const requirement = this.tokenRequirementsForPackage(pkg).find((r) =>
        r.role === 'token_authorization' &&
        r.sourceId === material.tokenCoinId &&
        r.message === material.announcementMessage
      );
      if (requirement?.announcementId && requirement.announcementId !== material.expectedPuzzleAnnouncementId) {
        throw new Error(
          `token TAIL announcement ${material.expectedPuzzleAnnouncementId} does not match ` +
            `required announcement ${requirement.announcementId}`,
        );
      }
      this.tokenTailMaterialText = JSON.stringify(tokenTailMaterialJson(material), null, 2);
      this.tokenTailMaterialPreview.set({ kind: 'ok', material });
    } catch (e) {
      this.tokenTailMaterialText = '';
      this.tokenTailMaterialPreview.set({ kind: 'error', message: formatError(e) });
    }
  }

  buildTokenAuthorizationSpend(): void {
    try {
      const pkg = this.parseExecutionPackage();
      const poolSpend = this.poolSpendForPackage(pkg);
      const auth = poolSpend.spec.tokenAuthorizations[0];
      if (!auth) {
        throw new Error('this action does not require a pool-token mint/melt authorization');
      }
      const tokenCoin = readCoinInput(
        asRecord(JSON.parse(this.tokenAuthorizationCoinText.trim()), 'token CAT coin'),
      );
      const lineage = readTokenLineageProof(
        this.tokenAuthorizationLineageText.trim()
          ? asRecord(JSON.parse(this.tokenAuthorizationLineageText.trim()), 'token CAT lineage')
          : {},
      );
      const build = this.tokenAuthorization.buildTokenAuthorizationCoinSpend({
        pool: pkg.pool,
        tokenCoin,
        tokenLineageProof: lineage,
        tokenInnerPuzzleHex: requiredParsedString(
          this.tokenAuthorizationInnerPuzzleHex.trim(),
          'token inner puzzle hex',
        ),
        tokenInnerSolutionHex: requiredParsedString(
          this.tokenAuthorizationInnerSolutionHex.trim(),
          'token inner solution hex',
        ),
        mintOrMelt: normaliseAuthMintOrMelt(auth.mintOrMelt),
        amount: auth.amount,
      });
      const requirement = this.tokenRequirementsForPackage(pkg).find((r) =>
        r.role === 'token_authorization' &&
        r.sourceId === build.material.tokenCoinId &&
        r.message === build.material.announcementMessage
      );
      if (requirement?.announcementId && requirement.announcementId !== build.material.expectedPuzzleAnnouncementId) {
        throw new Error(
          `token CAT announcement ${build.material.expectedPuzzleAnnouncementId} does not match ` +
            `required announcement ${requirement.announcementId}`,
        );
      }
      this.tokenAuthorizationSpendsText = JSON.stringify([coinSpendJson(build.coinSpend)], null, 2);
      this.tokenTailMaterialText = JSON.stringify(tokenTailMaterialJson(build.material), null, 2);
      this.tokenTailMaterialPreview.set({ kind: 'ok', material: build.material });
      this.tokenAuthorizationSpendPreview.set({ kind: 'ok', build });
      this.tokenWitnessPreview.set(null);
    } catch (e) {
      this.tokenAuthorizationSpendPreview.set({ kind: 'error', message: formatError(e) });
    }
  }

  applyTokenWitnesses(): void {
    const previous = this.executionPackageText;
    try {
      const root = asRecord(JSON.parse(this.executionPackageText.trim()), 'execution package');
      const action = mutableActionRecord(root, this.executionKindInput);
      const witnessRecord = { ...(asOptionalRecord(action['witnesses']) ?? {}) };
      const settlementPuzzleHash = this.tokenSettlementPuzzleHashInput.trim();
      if (settlementPuzzleHash) {
        witnessRecord['tokenSettlementPuzzleHash'] = settlementPuzzleHash;
      }
      if (this.tokenSettlementSpendText.trim()) {
        witnessRecord['tokenSettlementSpend'] = parseCoinSpendJsonText(
          this.tokenSettlementSpendText,
          'tokenSettlementSpend',
        );
      }
      if (this.tokenAuthorizationSpendsText.trim()) {
        witnessRecord['tokenAuthorizationSpends'] = parseCoinSpendArrayJsonText(
          this.tokenAuthorizationSpendsText,
          'tokenAuthorizationSpends',
        );
      }
      action['witnesses'] = witnessRecord;

      this.executionPackageText = JSON.stringify(root, null, 2);
      const pkg = this.parseExecutionPackage();
      const tokenRequirements = this.tokenRequirementsForPackage(pkg).filter((r) =>
        r.role === 'token_settlement' || r.role === 'token_authorization',
      );
      const expectsSettlement = tokenRequirements.some((r) => r.role === 'token_settlement');
      const authExpected = tokenRequirements.filter((r) => r.role === 'token_authorization').length;
      const authActual = Array.isArray(witnessRecord['tokenAuthorizationSpends'])
        ? witnessRecord['tokenAuthorizationSpends'].length
        : 0;
      const hasSettlementSpend =
        witnessRecord['tokenSettlementSpend'] !== null &&
        witnessRecord['tokenSettlementSpend'] !== undefined;
      if (expectsSettlement && !hasSettlementSpend) {
        throw new Error('tokenSettlementSpend is required for this action');
      }
      if (!expectsSettlement && hasSettlementSpend) {
        throw new Error('tokenSettlementSpend is not used by this action');
      }
      if (authActual !== authExpected) {
        throw new Error(
          `expected ${authExpected} token authorization spend(s), got ${authActual}`,
        );
      }
      this.executionBundle.set(null);
      this.executionSubmit.set(null);
      this.tokenWitnessPreview.set({
        kind: 'applied',
        message:
          `Applied ${expectsSettlement ? 1 : 0} settlement witness and ` +
          `${authActual} token authorization witness(es).`,
      });
    } catch (e) {
      this.executionPackageText = previous;
      this.tokenWitnessPreview.set({ kind: 'error', message: formatError(e) });
    }
  }

  tokenWitnessStatus(): string {
    const preview = this.tokenWitnessPreview();
    if (!preview) return 'No token witness requirements loaded.';
    if (preview.kind === 'error') return preview.message;
    if (preview.kind === 'applied') return preview.message;
    const settlement = preview.requirements.filter((r) => r.role === 'token_settlement').length;
    const authorizations = preview.requirements.filter((r) => r.role === 'token_authorization').length;
    return `${settlement} settlement witness, ${authorizations} token authorization witness(es).`;
  }

  tokenTailMaterialStatus(): string {
    const preview = this.tokenTailMaterialPreview();
    if (!preview) return 'No token TAIL material built.';
    if (preview.kind === 'error') return preview.message;
    const material = preview.material;
    return (
      `TAIL ${this.shortHex(material.tailPuzzleHash)} asserts ` +
      `${this.shortHex(material.expectedPuzzleAnnouncementId)}`
    );
  }

  tokenAuthorizationSpendStatus(): string {
    const preview = this.tokenAuthorizationSpendPreview();
    if (!preview) return 'No token CAT authorization spend built.';
    if (preview.kind === 'error') return preview.message;
    const build = preview.build;
    return (
      `CAT ${this.shortHex(build.tokenFullPuzzleHash)} ` +
      `delta ${build.extraDelta.toString()} child ${build.childTokenAmount.toString()}`
    );
  }

  executionWitnessRoles(
    result: PoolV2ExecutionBundle<
      SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote
    >,
  ): string {
    return result.witnessSummary.map((w) => w.role).join(', ');
  }

  announcementKey(item: { role: string; kind: string; sourceId: string }): string {
    return `${item.role}:${item.kind}:${item.sourceId}`;
  }

  formatActionTag(value: number): string {
    return `0x${value.toString(16).padStart(8, '0')}`;
  }

  circulatingSupplyLabel(): string {
    try {
      return this.formatTokens(this.economics.circulatingSupply(this.parseInputs().state));
    } catch (e) {
      return formatError(e);
    }
  }

  deedNavLabel(): string {
    try {
      const inputs = this.parseInputs();
      return this.formatMojos(
        this.economics.deedNavMojos(inputs.collectionNavMojos, inputs.sharePpm),
      );
    } catch (e) {
      return formatError(e);
    }
  }

  poolTokenNavLabel(): string {
    try {
      const state = this.economics.normaliseState(this.parseInputs().state);
      const circulating = state.totalPoolTokenSupply - state.treasuryReserveTokens;
      return `${this.formatRatio(state.totalNavLockedMojos, circulating)} mojos/token`;
    } catch (e) {
      return formatError(e);
    }
  }

  formatTokens(value: bigint): string {
    return formatBigInt(value);
  }

  formatMojos(value: bigint): string {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const dollars = absolute / 100n;
    const cents = (absolute % 100n).toString().padStart(2, '0');
    return `${negative ? '-' : ''}$${formatBigInt(dollars)}.${cents}`;
  }

  private preview<T>(
    buildQuote: (inputs: ParsedInputs) => T,
  ): QuotePreview<T> {
    try {
      const inputs = this.parseInputs();
      return {
        kind: 'ok',
        quote: buildQuote(inputs),
        deedNavMojos: this.economics.deedNavMojos(inputs.collectionNavMojos, inputs.sharePpm),
        circulatingSupplyBefore: this.economics.circulatingSupply(inputs.state),
      };
    } catch (e) {
      return { kind: 'error', message: formatError(e) };
    }
  }

  private builderPreview(
    build: (inputs: ParsedInputs) => PoolV2ActionPreview,
  ): BuilderPreview {
    try {
      return { kind: 'ok', preview: build(this.parseInputs()) };
    } catch (e) {
      return { kind: 'error', message: formatError(e) };
    }
  }

  private runComposeDryRun(
    kind: PoolV2ActionPreviewKind,
    target: { set(value: ComposeDryRunPreview): void },
    build: (inputs: ParsedInputs) => PoolV2ComposeDryRunResult,
  ): void {
    if (this.composeDryRunBusy()) return;
    this.composeDryRunBusy.set(kind);
    try {
      const inputs = this.parseInputs();
      target.set({ kind: 'ok', result: build(inputs) });
    } catch (e) {
      target.set({ kind: 'error', message: formatError(e) });
    } finally {
      this.composeDryRunBusy.set(null);
    }
  }

  private parseExecutionPackage(): ParsedExecutionPackage {
    const raw = this.executionPackageText.trim();
    if (!raw) {
      throw new Error('execution package JSON is required');
    }
    const root = asRecord(JSON.parse(raw), 'execution package');
    const action = asOptionalRecord(root[this.executionKindInput]) ??
      asOptionalRecord(root[actionSnake(this.executionKindInput)]) ??
      root;
    const records = [action, root];
    const inputs = this.parseInputs();
    return {
      pool: readPoolContext(readRecordFrom(records, ['pool'], 'pool')),
      state: root['state'] ? readState(asRecord(root['state'], 'state')) : inputs.state,
      deedId: readStringFrom(records, ['deedId', 'deed_id'], 'deedId'),
      deedLauncherId: readOptionalStringFrom(records, ['deedLauncherId', 'deed_launcher_id']),
      collectionIdCanon: readStringFrom(
        records,
        ['collectionIdCanon', 'collection_id_canon'],
        'collectionIdCanon',
      ),
      sharePpm: readOptionalBigintFrom(records, ['sharePpm', 'share_ppm']) ?? inputs.sharePpm,
      navEvidence: readNavEvidence(readRecordFrom(records, ['navEvidence', 'nav_evidence'], 'navEvidence')),
      witnesses: readWitnesses(readRecordFrom(records, ['witnesses'], 'witnesses')),
      buyerVaultLauncherId: readOptionalStringFrom(records, [
        'buyerVaultLauncherId',
        'buyer_vault_launcher_id',
      ]),
      buyerVaultCoinId: readOptionalStringFrom(records, ['buyerVaultCoinId', 'buyer_vault_coin_id']),
      buyerOwnerPubkey: readOptionalStringFrom(records, ['buyerOwnerPubkey', 'buyer_owner_pubkey']),
      buyerAuthType: readOptionalBigintFrom(records, ['buyerAuthType', 'buyer_auth_type']),
      buyerMembersMerkleRoot: readOptionalStringFrom(records, [
        'buyerMembersMerkleRoot',
        'buyer_members_merkle_root',
      ]),
      buyerIdentityAttestRoot: readOptionalStringFrom(records, [
        'buyerIdentityAttestRoot',
        'buyer_identity_attest_root',
      ]),
      buyerBridgePolicyHash: readOptionalStringFrom(records, [
        'buyerBridgePolicyHash',
        'buyer_bridge_policy_hash',
      ]),
      vaultLauncherId: readOptionalStringFrom(records, ['vaultLauncherId', 'vault_launcher_id']),
      launcherPuzzleHash: readOptionalStringFrom(records, ['launcherPuzzleHash', 'launcher_puzzle_hash']),
      treasuryReservePuzhash: readOptionalStringFrom(records, [
        'treasuryReservePuzhash',
        'treasury_reserve_puzhash',
      ]),
      protocolTreasuryPuzhash: readOptionalStringFrom(records, [
        'protocolTreasuryPuzhash',
        'protocol_treasury_puzhash',
      ]),
      governanceRewardsPuzhash: readOptionalStringFrom(records, [
        'governanceRewardsPuzhash',
        'governance_rewards_puzhash',
      ]),
      governanceRewardsRoot: readOptionalStringFrom(records, [
        'governanceRewardsRoot',
        'governance_rewards_root',
      ]),
      tokenCoinId: readOptionalStringFrom(records, ['tokenCoinId', 'token_coin_id']),
      propertyIdCanon: readOptionalStringFrom(records, ['propertyIdCanon', 'property_id_canon']),
      parValueMojos: readOptionalBigintFrom(records, ['parValueMojos', 'par_value_mojos']),
      assetClass: readOptionalBigintFrom(records, ['assetClass', 'asset_class']),
      sellerPuzhash: readOptionalStringFrom(records, ['sellerPuzhash', 'seller_puzhash']),
      sellerTokenPrice: readOptionalBigintFrom(records, ['sellerTokenPrice', 'seller_token_price']),
      mintTokenCoinId: readOptionalStringFrom(records, ['mintTokenCoinId', 'mint_token_coin_id']),
    };
  }

  private tokenRequirementsForPackage(pkg: ParsedExecutionPackage): PoolV2RequiredAnnouncement[] {
    return this.spendBuilder.describePoolV2RequiredAnnouncements({
      poolSpend: this.poolSpendForPackage(pkg),
      deedId: pkg.deedId,
      navEvidence: pkg.navEvidence,
      tokenSettlementPuzzleHash:
        this.tokenSettlementPuzzleHashInput.trim() || pkg.witnesses.tokenSettlementPuzzleHash,
    });
  }

  private poolSpendForPackage(
    pkg: ParsedExecutionPackage,
  ): PoolV2CoinSpendBuild<SpecificDeedSwapQuote | TrueRedemptionQuote | ReserveAcquisitionQuote> {
    switch (this.executionKindInput) {
      case 'specific-deed-swap':
        return this.spendBuilder.buildSpecificDeedSwapCoinSpend({
          ...pkg.pool,
          state: pkg.state,
          deedId: pkg.deedId,
          deedLauncherId: requiredParsedString(pkg.deedLauncherId, 'deedLauncherId'),
          propertyIdCanon: requiredParsedString(pkg.propertyIdCanon, 'propertyIdCanon'),
          parValueMojos: requiredParsedBigint(pkg.parValueMojos, 'parValueMojos'),
          assetClass: requiredParsedBigint(pkg.assetClass, 'assetClass'),
          buyerVaultLauncherId: requiredParsedString(pkg.buyerVaultLauncherId, 'buyerVaultLauncherId'),
          launcherPuzzleHash: pkg.launcherPuzzleHash,
          buyerVaultCoinId: requiredParsedString(pkg.buyerVaultCoinId, 'buyerVaultCoinId'),
          buyerOwnerPubkey: requiredParsedString(pkg.buyerOwnerPubkey, 'buyerOwnerPubkey'),
          buyerAuthType: requiredParsedBigint(pkg.buyerAuthType, 'buyerAuthType'),
          buyerMembersMerkleRoot: requiredParsedString(pkg.buyerMembersMerkleRoot, 'buyerMembersMerkleRoot'),
          buyerIdentityAttestRoot: requiredParsedString(pkg.buyerIdentityAttestRoot, 'buyerIdentityAttestRoot'),
          buyerBridgePolicyHash: requiredParsedString(pkg.buyerBridgePolicyHash, 'buyerBridgePolicyHash'),
          collectionIdCanon: pkg.collectionIdCanon,
          sharePpm: pkg.sharePpm,
          navEvidence: pkg.navEvidence,
          treasuryReservePuzhash: requiredParsedString(pkg.treasuryReservePuzhash, 'treasuryReservePuzhash'),
          protocolTreasuryPuzhash: requiredParsedString(pkg.protocolTreasuryPuzhash, 'protocolTreasuryPuzhash'),
          governanceRewardsPuzhash: requiredParsedString(pkg.governanceRewardsPuzhash, 'governanceRewardsPuzhash'),
          governanceRewardsRoot: requiredParsedString(pkg.governanceRewardsRoot, 'governanceRewardsRoot'),
        });
      case 'true-redemption':
        return this.spendBuilder.buildTrueRedemptionCoinSpend({
          ...pkg.pool,
          state: pkg.state,
          deedId: pkg.deedId,
          deedLauncherId: requiredParsedString(pkg.deedLauncherId, 'deedLauncherId'),
          propertyIdCanon: requiredParsedString(pkg.propertyIdCanon, 'propertyIdCanon'),
          parValueMojos: requiredParsedBigint(pkg.parValueMojos, 'parValueMojos'),
          assetClass: requiredParsedBigint(pkg.assetClass, 'assetClass'),
          vaultLauncherId: requiredParsedString(pkg.vaultLauncherId, 'vaultLauncherId'),
          launcherPuzzleHash: pkg.launcherPuzzleHash,
          collectionIdCanon: pkg.collectionIdCanon,
          sharePpm: pkg.sharePpm,
          navEvidence: pkg.navEvidence,
          tokenCoinId: requiredParsedString(pkg.tokenCoinId, 'tokenCoinId'),
        });
      case 'reserve-acquisition':
        return this.spendBuilder.buildReserveAcquisitionCoinSpend({
          ...pkg.pool,
          state: pkg.state,
          deedId: pkg.deedId,
          deedLauncherId: requiredParsedString(pkg.deedLauncherId, 'deedLauncherId'),
          propertyIdCanon: requiredParsedString(pkg.propertyIdCanon, 'propertyIdCanon'),
          parValueMojos: requiredParsedBigint(pkg.parValueMojos, 'parValueMojos'),
          assetClass: requiredParsedBigint(pkg.assetClass, 'assetClass'),
          collectionIdCanon: pkg.collectionIdCanon,
          sharePpm: pkg.sharePpm,
          navEvidence: pkg.navEvidence,
          sellerPuzhash: requiredParsedString(pkg.sellerPuzhash, 'sellerPuzhash'),
          sellerTokenPrice: requiredParsedBigint(pkg.sellerTokenPrice, 'sellerTokenPrice'),
          mintTokenCoinId: pkg.mintTokenCoinId,
        });
    }
  }

  private parseInputs(): ParsedInputs {
    return {
      state: {
        totalNavLockedMojos: this.parseWhole(this.totalNavLockedMojosInput, 'total NAV locked'),
        deedCount: this.parseWhole(this.deedCountInput, 'deed count'),
        totalPoolTokenSupply: this.parseWhole(this.totalPoolTokenSupplyInput, 'total pool-token supply'),
        treasuryReserveTokens: this.parseWhole(this.treasuryReserveTokensInput, 'treasury reserve tokens'),
      },
      collectionNavMojos: this.parseWhole(this.collectionNavMojosInput, 'collection NAV', 1n),
      sharePpm: this.parseWhole(this.sharePpmInput, 'share ppm', 1n),
      sellerTokenPrice: this.parseWhole(this.sellerTokenPriceInput, 'seller token price', 1n),
    };
  }

  private parseWhole(raw: string, label: string, min = 0n): bigint {
    const trimmed = raw.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      throw new Error(`${label} must be a whole number`);
    }
    const value = BigInt(trimmed);
    if (value < min) {
      throw new Error(`${label} must be at least ${min.toString()}`);
    }
    return value;
  }

  private executionPackageDraft(evidence: ConfirmedPoolV2ChainStateEvidence): Record<string, unknown> {
    const navEvidence = this.navRegistryEvidence();
    const confirmedNav = navEvidence?.kind === 'confirmed-present' ? navEvidence : null;
    const deedEvidence = this.deedWitnessEvidence();
    const confirmedDeed = isConfirmedDeedWitness(deedEvidence) ? deedEvidence : null;
    const collectionIdCanon =
      confirmedDeed?.collectionIdCanon ?? confirmedNav?.collectionIdCanon ?? this.collectionIdCanonInput.trim();
    const sharePpm = confirmedDeed?.sharePpm.toString() ?? (this.sharePpmInput.trim() || '250000');
    return {
      pool: poolContextJson(evidence.poolContext),
      state: stateJson(evidence.state),
      deedId: confirmedDeed?.deedCoinId ?? '',
      collectionIdCanon,
      sharePpm,
      navEvidence: confirmedNav
        ? navEvidenceJson(confirmedNav.navEvidence)
        : {
            registryCoinId: '',
            registryPuzzleHash: '',
            collectionIdCanon,
            navValueMojos: this.collectionNavMojosInput.trim() || '',
            collectionNavRoot: '',
            registryVersion: '',
          },
      ...actionDraftFields(this.executionKindInput, this.sellerTokenPriceInput),
      ...deedWitnessActionFields(this.executionKindInput, confirmedDeed),
      witnesses: {
        navEvidenceSpend: confirmedNav ? coinSpendJson(confirmedNav.navEvidenceSpend) : null,
        deedSpend: confirmedDeed ? coinSpendJson(confirmedDeed.deedSpend) : null,
        vaultAcceptOfferSpend: null,
        tokenSettlementPuzzleHash: '',
        tokenSettlementSpend: null,
        tokenAuthorizationSpends: [],
      },
    };
  }

  private formatRatio(numerator: bigint, denominator: bigint, decimals = 6): string {
    if (denominator <= 0n) throw new Error('circulating supply must be positive');
    const scale = 10n ** BigInt(decimals);
    const scaled = (numerator * scale) / denominator;
    const whole = scaled / scale;
    const fraction = (scaled % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return fraction ? `${formatBigInt(whole)}.${fraction}` : formatBigInt(whole);
  }

  private shortHex(value: string): string {
    return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
  }
}

function formatBigInt(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}`;
}

function actionSnake(kind: PoolV2ExecutionKind): string {
  return kind.replace(/-/g, '_');
}

function mutableActionRecord(
  root: Record<string, unknown>,
  kind: PoolV2ExecutionKind,
): Record<string, unknown> {
  return asOptionalRecord(root[kind]) ?? asOptionalRecord(root[actionSnake(kind)]) ?? root;
}

function parseCoinSpendJsonText(raw: string, label: string): Record<string, unknown> {
  const record = asRecord(JSON.parse(raw), label);
  assertCoinSpendJsonShape(record, label);
  return record;
}

function parseCoinSpendArrayJsonText(raw: string, label: string): Record<string, unknown>[] {
  const parsed = JSON.parse(raw);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  return records.map((item, index) => {
    const record = asRecord(item, `${label}[${index}]`);
    assertCoinSpendJsonShape(record, `${label}[${index}]`);
    return record;
  });
}

function assertCoinSpendJsonShape(record: Record<string, unknown>, label: string): void {
  const coin = asRecord(record['coin'], `${label}.coin`);
  readStringFrom([coin], ['parentCoinInfo', 'parent_coin_info'], `${label}.coin.parentCoinInfo`);
  readStringFrom([coin], ['puzzleHash', 'puzzle_hash'], `${label}.coin.puzzleHash`);
  readBigintFrom([coin], ['amount'], `${label}.coin.amount`);
  readStringFrom([record], ['puzzleReveal', 'puzzle_reveal'], `${label}.puzzleReveal`);
  readStringFrom([record], ['solution'], `${label}.solution`);
}

function stateJson(state: {
  totalNavLockedMojos: bigint;
  deedCount: bigint;
  totalPoolTokenSupply: bigint;
  treasuryReserveTokens: bigint;
}): Record<string, string> {
  return {
    totalNavLockedMojos: state.totalNavLockedMojos.toString(),
    deedCount: state.deedCount.toString(),
    totalPoolTokenSupply: state.totalPoolTokenSupply.toString(),
    treasuryReserveTokens: state.treasuryReserveTokens.toString(),
  };
}

function poolContextJson(context: PoolSingletonSpendContext): Record<string, unknown> {
  return {
    poolLauncherId: context.poolLauncherId,
    poolCoin: {
      parentCoinInfo: context.poolCoin.parentCoinInfo,
      puzzleHash: context.poolCoin.puzzleHash,
      amount: stringifyBigintLike(context.poolCoin.amount),
      coinId: context.poolCoin.coinId ?? '',
    },
    poolInnerPuzzleHex: context.poolInnerPuzzleHex,
    lineageProof: {
      parentName: context.lineageProof.parentName ?? '',
      innerPuzzleHash: context.lineageProof.innerPuzzleHash ?? '',
      amount:
        context.lineageProof.amount === undefined || context.lineageProof.amount === null
          ? ''
          : stringifyBigintLike(context.lineageProof.amount),
    },
  };
}

function navEvidenceJson(evidence: CollectionNavEvidenceInput): Record<string, string> {
  return {
    registryCoinId: evidence.registryCoinId,
    registryPuzzleHash: evidence.registryPuzzleHash,
    collectionIdCanon: evidence.collectionIdCanon,
    navValueMojos: stringifyBigintLike(evidence.navValueMojos),
    collectionNavRoot: evidence.collectionNavRoot,
    registryVersion: stringifyBigintLike(evidence.registryVersion),
  };
}

function coinSpendJson(spend: UnsignedCoinSpend): Record<string, unknown> {
  return {
    coin: {
      parentCoinInfo: spend.coin.parentCoinInfo,
      puzzleHash: spend.coin.puzzleHash,
      amount: stringifyBigintLike(spend.coin.amount),
    },
    puzzleReveal: spend.puzzleReveal,
    solution: spend.solution,
  };
}

function actionDraftFields(
  kind: PoolV2ExecutionKind,
  sellerTokenPriceInput: string,
): Record<string, string | null> {
  switch (kind) {
    case 'specific-deed-swap':
      return {
        buyerVaultLauncherId: '',
        launcherPuzzleHash: '',
        buyerVaultCoinId: '',
        buyerOwnerPubkey: '',
        buyerAuthType: '',
        buyerMembersMerkleRoot: '',
        buyerIdentityAttestRoot: '',
        buyerBridgePolicyHash: '',
        treasuryReservePuzhash: '',
        protocolTreasuryPuzhash: '',
        governanceRewardsPuzhash: '',
        governanceRewardsRoot: '',
      };
    case 'true-redemption':
      return {
        vaultLauncherId: '',
        launcherPuzzleHash: '',
        tokenCoinId: '',
      };
    case 'reserve-acquisition':
      return {
        propertyIdCanon: '',
        parValueMojos: '',
        assetClass: '',
        sellerPuzhash: '',
        sellerTokenPrice: sellerTokenPriceInput.trim() || '',
        mintTokenCoinId: null,
      };
  }
}

function deedWitnessActionFields(
  kind: PoolV2ExecutionKind,
  witness: ConfirmedPoolV2DeedWitnessEvidence | null,
): Record<string, string> {
  if (!witness) return {};
  switch (kind) {
    case 'specific-deed-swap':
      if (witness.kind !== 'confirmed-redeem') return {};
      return {
        buyerVaultLauncherId: witness.vaultLauncherId,
        launcherPuzzleHash: witness.launcherPuzzleHash,
      };
    case 'true-redemption':
      if (witness.kind !== 'confirmed-redeem') return {};
      return {
        vaultLauncherId: witness.vaultLauncherId,
        launcherPuzzleHash: witness.launcherPuzzleHash,
      };
    case 'reserve-acquisition':
      if (witness.kind !== 'confirmed-deposit') return {};
      return {
        propertyIdCanon: witness.propertyIdCanon,
        parValueMojos: witness.parValueMojos.toString(),
        assetClass: witness.assetClass.toString(),
      };
  }
}

function isConfirmedDeedWitness(
  evidence: PoolV2DeedWitnessEvidence | null,
): evidence is ConfirmedPoolV2DeedWitnessEvidence {
  return evidence?.kind === 'confirmed-redeem' || evidence?.kind === 'confirmed-deposit';
}

function stringifyBigintLike(value: string | number | bigint): string {
  return typeof value === 'bigint' ? value.toString() : String(value);
}

function normaliseAuthMintOrMelt(value: number): typeof TOKEN_MINT | typeof TOKEN_MELT {
  if (value === TOKEN_MINT) return TOKEN_MINT;
  if (value === TOKEN_MELT) return TOKEN_MELT;
  throw new Error('mintOrMelt must be TOKEN_MINT or TOKEN_MELT');
}

function tokenTailMaterialJson(
  material: PoolV2TokenAuthorizationMaterial,
): Record<string, string | number | string[]> {
  return {
    tailPuzzleHash: material.tailPuzzleHash,
    tailPuzzleReveal: material.tailPuzzleReveal,
    tailSolution: material.tailSolution,
    poolFullPuzzleHash: material.poolFullPuzzleHash,
    poolInnerPuzzleHash: material.poolInnerPuzzleHash,
    poolCoinId: material.poolCoinId,
    tokenCoinId: material.tokenCoinId,
    mintOrMelt: material.mintOrMelt,
    amount: material.amount.toString(),
    announcementMessage: material.announcementMessage,
    expectedPuzzleAnnouncementId: material.expectedPuzzleAnnouncementId,
    assertedPuzzleAnnouncementIds: material.assertedPuzzleAnnouncementIds,
    assertedCoinIds: material.assertedCoinIds,
  };
}

function requiredParsedString(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function requiredParsedBigint(value: bigint | undefined, label: string): bigint {
  if (value === undefined) throw new Error(`${label} is required`);
  return value;
}

function readPoolContext(record: Record<string, unknown>): PoolSingletonSpendContext {
  const lineage = readOptionalRecordFrom([record], ['lineageProof', 'lineage_proof']) ?? {};
  return {
    poolLauncherId: readStringFrom([record], ['poolLauncherId', 'pool_launcher_id'], 'poolLauncherId'),
    poolCoin: readCoinInput(readRecordFrom([record], ['poolCoin', 'pool_coin'], 'poolCoin')),
    poolInnerPuzzleHex: readStringFrom(
      [record],
      ['poolInnerPuzzleHex', 'pool_inner_puzzle_hex'],
      'poolInnerPuzzleHex',
    ),
    lineageProof: {
      parentName: readOptionalStringFrom([lineage], ['parentName', 'parent_name']),
      innerPuzzleHash: readOptionalStringFrom([lineage], ['innerPuzzleHash', 'inner_puzzle_hash']),
      amount: readOptionalBigintFrom([lineage], ['amount']),
    },
  };
}

function readCoinInput(record: Record<string, unknown>): {
  parentCoinInfo: string;
  puzzleHash: string;
  amount: bigint;
  coinId?: string;
} {
  return {
    parentCoinInfo: readStringFrom([record], ['parentCoinInfo', 'parent_coin_info'], 'parentCoinInfo'),
    puzzleHash: readStringFrom([record], ['puzzleHash', 'puzzle_hash'], 'puzzleHash'),
    amount: readBigintFrom([record], ['amount'], 'amount'),
    coinId: readOptionalStringFrom([record], ['coinId', 'coin_id']),
  };
}

function readTokenLineageProof(record: Record<string, unknown>): {
  parentName?: string;
  innerPuzzleHash?: string;
  amount?: bigint;
} {
  return {
    parentName: readOptionalStringFrom([record], ['parentName', 'parent_name']),
    innerPuzzleHash: readOptionalStringFrom([record], ['innerPuzzleHash', 'inner_puzzle_hash']),
    amount: readOptionalBigintFrom([record], ['amount']),
  };
}

function readState(record: Record<string, unknown>): PoolEconomicStateInput {
  return {
    totalNavLockedMojos: readBigintFrom(
      [record],
      ['totalNavLockedMojos', 'total_nav_locked_mojos'],
      'totalNavLockedMojos',
    ),
    deedCount: readBigintFrom([record], ['deedCount', 'deed_count'], 'deedCount'),
    totalPoolTokenSupply: readBigintFrom(
      [record],
      ['totalPoolTokenSupply', 'total_pool_token_supply'],
      'totalPoolTokenSupply',
    ),
    treasuryReserveTokens: readBigintFrom(
      [record],
      ['treasuryReserveTokens', 'treasury_reserve_tokens'],
      'treasuryReserveTokens',
    ),
  };
}

function readNavEvidence(record: Record<string, unknown>): CollectionNavEvidenceInput {
  return {
    registryCoinId: readStringFrom([record], ['registryCoinId', 'registry_coin_id'], 'registryCoinId'),
    registryPuzzleHash: readStringFrom(
      [record],
      ['registryPuzzleHash', 'registry_puzzle_hash'],
      'registryPuzzleHash',
    ),
    collectionIdCanon: readStringFrom(
      [record],
      ['collectionIdCanon', 'collection_id_canon'],
      'collectionIdCanon',
    ),
    navValueMojos: readBigintFrom([record], ['navValueMojos', 'nav_value_mojos'], 'navValueMojos'),
    collectionNavRoot: readStringFrom(
      [record],
      ['collectionNavRoot', 'collection_nav_root'],
      'collectionNavRoot',
    ),
    registryVersion: readBigintFrom([record], ['registryVersion', 'registry_version'], 'registryVersion'),
  };
}

function readWitnesses(record: Record<string, unknown>): PoolV2BundleWitnesses {
  const tokenAuthorizationSpends = readOptionalArrayFrom(
    [record],
    ['tokenAuthorizationSpends', 'token_authorization_spends'],
  );
  return {
    navEvidenceSpend: readCoinSpend(
      readRecordFrom([record], ['navEvidenceSpend', 'nav_evidence_spend'], 'navEvidenceSpend'),
    ),
    deedSpend: readCoinSpend(readRecordFrom([record], ['deedSpend', 'deed_spend'], 'deedSpend')),
    vaultAcceptOfferSpend: readOptionalRecordFrom(
      [record],
      ['vaultAcceptOfferSpend', 'vault_accept_offer_spend'],
    )
      ? readCoinSpend(
          readRecordFrom(
            [record],
            ['vaultAcceptOfferSpend', 'vault_accept_offer_spend'],
            'vaultAcceptOfferSpend',
          ),
        )
      : null,
    tokenSettlementPuzzleHash: readOptionalStringFrom(
      [record],
      ['tokenSettlementPuzzleHash', 'token_settlement_puzzle_hash'],
    ),
    tokenSettlementSpend: readOptionalRecordFrom(
      [record],
      ['tokenSettlementSpend', 'token_settlement_spend'],
    )
      ? readCoinSpend(
          readRecordFrom([record], ['tokenSettlementSpend', 'token_settlement_spend'], 'tokenSettlementSpend'),
        )
      : null,
    tokenAuthorizationSpends: tokenAuthorizationSpends
      ? tokenAuthorizationSpends.map((item, index) =>
          readCoinSpend(asRecord(item, `tokenAuthorizationSpends[${index}]`)),
        )
      : [],
  };
}

function readCoinSpend(record: Record<string, unknown>): UnsignedCoinSpend {
  return {
    coin: readCoinInput(readRecordFrom([record], ['coin'], 'coin')),
    puzzleReveal: readStringFrom([record], ['puzzleReveal', 'puzzle_reveal'], 'puzzleReveal'),
    solution: readStringFrom([record], ['solution'], 'solution'),
  };
}

function readRecordFrom(
  records: Record<string, unknown>[],
  keys: string[],
  label: string,
): Record<string, unknown> {
  const value = readOptionalValueFrom(records, keys);
  if (value === undefined) throw new Error(`${label} is required`);
  return asRecord(value, label);
}

function readOptionalRecordFrom(
  records: Record<string, unknown>[],
  keys: string[],
): Record<string, unknown> | null {
  const value = readOptionalValueFrom(records, keys);
  return value === undefined ? null : asRecord(value, keys[0]);
}

function readStringFrom(
  records: Record<string, unknown>[],
  keys: string[],
  label: string,
): string {
  const value = readOptionalValueFrom(records, keys);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function readOptionalStringFrom(
  records: Record<string, unknown>[],
  keys: string[],
): string | undefined {
  const value = readOptionalValueFrom(records, keys);
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${keys[0]} must be a string`);
  }
  return value.trim();
}

function readBigintFrom(
  records: Record<string, unknown>[],
  keys: string[],
  label: string,
): bigint {
  const value = readOptionalValueFrom(records, keys);
  if (value === undefined) throw new Error(`${label} is required`);
  return valueToBigint(value, label);
}

function readOptionalBigintFrom(
  records: Record<string, unknown>[],
  keys: string[],
): bigint | undefined {
  const value = readOptionalValueFrom(records, keys);
  return value === undefined || value === null || value === ''
    ? undefined
    : valueToBigint(value, keys[0]);
}

function readOptionalArrayFrom(
  records: Record<string, unknown>[],
  keys: string[],
): unknown[] | null {
  const value = readOptionalValueFrom(records, keys);
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new Error(`${keys[0]} must be an array`);
  }
  return value;
}

function readOptionalValueFrom(
  records: Record<string, unknown>[],
  keys: string[],
): unknown | undefined {
  for (const record of records) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        return record[key];
      }
    }
  }
  return undefined;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  return value === undefined || value === null ? null : asRecord(value, 'record');
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function valueToBigint(value: unknown, label: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
    return BigInt(value);
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw new Error(`${label} must be a whole number`);
}
