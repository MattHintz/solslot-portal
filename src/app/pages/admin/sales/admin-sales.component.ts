import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import {
  CollectionApiService,
  CollectionWorkspace,
  PresaleSeries,
  PresaleVoucher,
  VoucherState,
} from '../../../services/collection-api.service';
import {
  AdminPurchaseOperation,
  AdminFundedRedemption,
  AdminSalesService,
  PurchaseOperationState,
  RedemptionFundingDestination,
} from '../../../services/admin-sales.service';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import { formatError } from '../../../utils/format-error';

type DeskFilter = 'ALL' | 'ATTENTION' | 'IN_PROGRESS' | 'COMPLETED';

@Component({
  selector: 'solslot-admin-sales',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AdminWorkspaceNavComponent],
  template: `
    <solslot-admin-workspace-nav />
    <main class="sales-desk">
      <header class="page-heading">
        <div>
          <span class="eyebrow">Customer operations</span>
          <h1>Sales & fulfillment</h1>
          <p>Follow each approved payment through delivery or an exact refund.</p>
        </div>
        <button type="button" class="button" (click)="reload()" [disabled]="loading()">
          {{ loading() ? 'Checking…' : 'Refresh' }}
        </button>
      </header>

      @if (errors().length) {
        <div class="notice notice--warning" role="status">
          <strong>Some information could not be refreshed</strong>
          <span>{{ errors().join(' ') }}</span>
        </div>
      }
      <section class="summary" aria-label="Fulfillment summary">
        <button type="button" [class.is-active]="filter() === 'ALL'" (click)="filter.set('ALL')">
          <span>All activity</span><strong>{{ totalCount() }}</strong>
        </button>
        <button type="button" [class.is-active]="filter() === 'ATTENTION'" (click)="filter.set('ATTENTION')">
          <span>Needs attention</span><strong>{{ attentionCount() }}</strong>
        </button>
        <button type="button" [class.is-active]="filter() === 'IN_PROGRESS'" (click)="filter.set('IN_PROGRESS')">
          <span>In progress</span><strong>{{ inProgressCount() }}</strong>
        </button>
        <button type="button" [class.is-active]="filter() === 'COMPLETED'" (click)="filter.set('COMPLETED')">
          <span>Completed</span><strong>{{ completedCount() }}</strong>
        </button>
      </section>

      @if (loading()) {
        <div class="empty" aria-live="polite">Checking payment and chain delivery state…</div>
      } @else {
        <section class="desk-section redemption-workspace">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Governed settlement</span>
              <h2>Fund SmartDeed redemptions</h2>
            </div>
            <span>{{ redemptions().length }} settlements</span>
          </div>

          <div class="redemption-create">
            <div class="redemption-copy">
              <strong>Turn approved property proceeds into permanent wUSDC.b offers</strong>
              <p>
                Choose a fully minted collection and the total amount received. Solslot calculates
                each deed's exact share, prepares one committee proposal, and keeps every funded
                offer available until its SmartDeed is redeemed.
              </p>
              @if (funding(); as destination) {
                <div class="funding-destination">
                  <span>Protected funding · {{ destination.network }}</span>
                  <strong>Funds move only after the committee vote passes.</strong>
                  <small>
                    The desk asks your Chia wallet for the exact wUSDC.b transfer and adds the
                    network fee separately. Amounts and destinations cannot be edited.
                  </small>
                  <details>
                    <summary>Advanced destination evidence</summary>
                    <dl>
                      <div><dt>Address</dt><dd>{{ destination.recipientAddress }}</dd></div>
                      <div><dt>Asset ID</dt><dd>{{ destination.assetId }}</dd></div>
                      <div><dt>CAT puzzle</dt><dd>{{ destination.catPuzzleHash }}</dd></div>
                    </dl>
                    <button type="button" class="text-button" (click)="copyFundingAddress(destination)">
                      Copy address
                    </button>
                  </details>
                </div>
              }
            </div>
            <form (ngSubmit)="createRedemption()">
              <label>
                <span>Property collection</span>
                <select name="redemptionCollection" [(ngModel)]="redemptionCollectionId" required>
                  <option value="">Choose a collection</option>
                  @for (collection of redeemableCollections(); track collection.id) {
                    <option [value]="collection.id">
                      {{ collection.dossier.title }} · {{ collection.deeds.length }} SmartDeeds
                    </option>
                  }
                </select>
              </label>
              <label>
                <span>Total proceeds available</span>
                <div class="money-input"><span>$</span><input name="redemptionAmount" [(ngModel)]="redemptionAmountUsd" inputmode="decimal" placeholder="0.00" required /></div>
                <small>Enter the exact collection proceeds available for all SmartDeeds.</small>
              </label>
              <label>
                <span>Proposal title</span>
                <input name="redemptionTitle" [(ngModel)]="redemptionTitle" maxlength="120" placeholder="Fund redemption for 127 Eastmoreland" required />
              </label>
              <button type="submit" class="button button--primary" [disabled]="creatingRedemption() || !canCreateRedemption()">
                {{ creatingRedemption() ? 'Preparing…' : 'Add to committee queue' }}
              </button>
            </form>
          </div>

          @if (!redemptions().length) {
            <div class="empty empty--small">
              <strong>No funded settlements yet</strong>
              <span>A proposal appears here after the owner prepares exact collection proceeds.</span>
            </div>
          } @else {
            <div class="operation-list">
              @for (redemption of redemptions(); track redemption.id) {
                <article class="operation operation--redemption">
                  <div class="asset">
                    <span class="asset-mark" data-kind="redemption">R</span>
                    <span>
                      <strong>{{ redemption.title }}</strong>
                      <small>{{ redemption.bill.deedCount }} SmartDeeds · {{ redemptionAmount(redemption) }}</small>
                    </span>
                  </div>
                  <div class="destination">
                    <span>Committee stage</span>
                    <strong>{{ redemptionStage(redemption) }}</strong>
                  </div>
                  <div class="state">
                    <strong [class]="redemption.state === 'EXECUTED' ? 'status status--done' : 'status'">
                      {{ redemption.availableOfferCount || 0 }} offers ready
                    </strong>
                    <small>{{ redemptionHelp(redemption) }}</small>
                  </div>
                  <div class="operation-actions">
                    @if (canFundRedemption(redemption)) {
                      @if (!chiaConnected() || chiaConnectionKind() === 'google') {
                        <span class="action-label">Connect the wallet holding wUSDC.b</span>
                        <div class="wallet-actions">
                          @if (hasGoby()) {
                            <button type="button" class="button button--compact" data-ux-action="connect_wallet" (click)="connectRedemptionWallet('goby')" [disabled]="!!connectingFundingWallet()">
                              Goby
                            </button>
                          }
                          @if (hasSage()) {
                            <button type="button" class="button button--compact" data-ux-action="connect_wallet" (click)="connectRedemptionWallet('sage')" [disabled]="!!connectingFundingWallet()">
                              Sage
                            </button>
                          }
                          <button type="button" class="button button--compact" data-ux-action="connect_wallet" (click)="connectRedemptionWallet('sage-walletconnect')" [disabled]="!!connectingFundingWallet()">
                            Sage mobile
                          </button>
                        </div>
                      } @else {
                        <button type="button" class="button button--primary button--compact" (click)="fundRedemption(redemption)" [disabled]="fundingRedemption() === redemption.id">
                          {{ fundingRedemption() === redemption.id ? 'Submitting…' : 'Fund exact settlement' }}
                        </button>
                        <span class="action-label">{{ chiaConnectionKind() }} connected</span>
                      }
                    } @else if (canResumeFunding(redemption)) {
                      <button type="button" class="button button--primary button--compact" (click)="resumeFunding(redemption)" [disabled]="fundingRedemption() === redemption.id">
                        {{ fundingRedemption() === redemption.id ? 'Checking…' : 'Resume submission' }}
                      </button>
                    } @else {
                      <a routerLink="/admin/sgt-allocations">Open proposal queue</a>
                    }
                  </div>
                  <details>
                    <summary>Allocation evidence</summary>
                    <dl>
                      <div><dt>Settlement</dt><dd>{{ redemption.bill.settlementId }}</dd></div>
                      <div><dt>Outputs</dt><dd>{{ redemption.expectedOutputCoinIds.length || 'Not funded yet' }}</dd></div>
                      @if (redemption.funding; as funded) {
                        <div><dt>Funding</dt><dd>{{ funded.status }}</dd></div>
                        <div><dt>Treasury coin</dt><dd>{{ funded.expectedFundingCoinId }}</dd></div>
                        <div><dt>Transaction</dt><dd>{{ funded.transactionId || 'Preparing' }}</dd></div>
                        <div><dt>Network fee</dt><dd>{{ funded.feeMojos || 'Preparing' }} mojos · {{ funded.feeTargetSeconds || '—' }} sec target</dd></div>
                        <div><dt>Provider</dt><dd>{{ funded.submissionProvider || 'Preparing' }}</dd></div>
                      }
                      @if (redemption.executionBlocker) {
                        <div><dt>Next action</dt><dd>{{ redemption.executionBlocker }}</dd></div>
                      }
                      @for (allocation of redemption.bill.allocations; track allocation.deedLauncherId) {
                        <div><dt>{{ allocation.sharePpm / 10000 | number: '1.0-2' }}%</dt><dd>{{ short(allocation.deedLauncherId) }} · {{ wusdc(allocation.paymentAmount) }}</dd></div>
                      }
                    </dl>
                  </details>
                </article>
              }
            </div>
          }
        </section>

        <section class="desk-section">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Direct sales</span>
              <h2>SmartDeed and SGT delivery</h2>
            </div>
            <span>{{ filteredPurchases().length }} shown</span>
          </div>

          @if (!filteredPurchases().length) {
            <div class="empty empty--small">
              <strong>No matching purchases</strong>
              <span>New approved purchases appear here as soon as their artifact is created.</span>
            </div>
          } @else {
            <div class="operation-list">
              @for (purchase of filteredPurchases(); track purchase.id) {
                <article class="operation">
                  <div class="asset">
                    <span class="asset-mark" [attr.data-kind]="purchase.deliveryKind">
                      {{ purchase.deliveryKind === 'sgt' ? 'SGT' : 'SD' }}
                    </span>
                    <span>
                      <strong>{{ purchaseTitle(purchase) }}</strong>
                      <small>{{ railLabel(purchase.rail) }} · {{ purchaseAmount(purchase) }}</small>
                    </span>
                  </div>
                  <div class="destination">
                    <span>Approved vault</span>
                    <strong [title]="purchase.vaultLauncherId">{{ short(purchase.vaultLauncherId) }}</strong>
                  </div>
                  <div class="state">
                    <strong [class]="purchaseStatusClass(purchase.state)">{{ purchaseStatus(purchase.state) }}</strong>
                    <small>{{ purchaseHelp(purchase.state) }}</small>
                  </div>
                  <time>{{ operationTime(purchase) | date: 'MMM d, h:mm a' }}</time>
                  @if (canCheckDelivery(purchase)) {
                    <button
                      type="button"
                      class="button button--compact"
                      (click)="checkDelivery(purchase)"
                      [disabled]="checkingPurchase() === purchase.purchaseId"
                    >
                      {{ checkingPurchase() === purchase.purchaseId ? 'Checking…' : 'Check delivery' }}
                    </button>
                  }
                  <details>
                    <summary>Evidence</summary>
                    <dl>
                      <div><dt>Operation</dt><dd>{{ purchase.id }}</dd></div>
                      <div><dt>Purchase</dt><dd>{{ purchase.purchaseId || 'Preparing' }}</dd></div>
                      <div><dt>Artifact</dt><dd>{{ purchase.artifactHash || 'Preparing' }}</dd></div>
                      @if (evidenceReference(purchase); as evidence) {
                        <div><dt>Settlement</dt><dd>{{ evidence }}</dd></div>
                      }
                    </dl>
                  </details>
                </article>
              }
            </div>
          }
        </section>

        <section class="desk-section">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Refundable reservations</span>
              <h2>Voucher delivery and refunds</h2>
            </div>
            <span>{{ filteredVouchers().length }} shown</span>
          </div>

          @if (!filteredVouchers().length) {
            <div class="empty empty--small">
              <strong>No matching reservations</strong>
              <span>Governed presale reservations appear after confirmed payment.</span>
            </div>
          } @else {
            <div class="operation-list">
              @for (item of filteredVouchers(); track item.campaign.termsHash + ':' + item.voucher.serial) {
                <article class="operation">
                  <div class="asset">
                    <span class="asset-mark" data-kind="voucher">V</span>
                    <span>
                      <strong>Reservation #{{ item.voucher.serial }}</strong>
                      <small>{{ voucherPaymentAmount(item.voucher) }} · {{ voucherRail(item.voucher) }}</small>
                    </span>
                  </div>
                  <div class="destination">
                    <span>Approved vault</span>
                    <strong [title]="item.voucher.vaultLauncherId">{{ short(item.voucher.vaultLauncherId) }}</strong>
                  </div>
                  <div class="state">
                    <strong [class]="voucherStatusClass(item.voucher.state)">{{ voucherStatus(item.voucher.state) }}</strong>
                    <small>{{ voucherHelp(item.voucher.state) }}</small>
                  </div>
                  <time>{{ item.voucher.updatedAt * 1000 | date: 'MMM d, h:mm a' }}</time>
                  <a [routerLink]="['/admin/collections', item.campaign.terms.collectionWorkspaceId]">Collection</a>
                </article>
              }
            </div>
          }
        </section>
      }

      <aside class="guardrail">
        <strong>Approved terms stay fixed</strong>
        <span>
          This desk cannot change the customer, vault, asset, amount, or SmartDeed. A retry or
          refund will appear only when the server can prepare that exact authorized action.
        </span>
      </aside>
    </main>
  `,
  styles: [
    `
      :host { display:block; min-height:100vh; background:#06110f; color:#eefbf5; }
      .sales-desk { width:min(1180px,calc(100% - 32px)); margin:0 auto; padding:38px 0 80px; }
      .page-heading,.section-heading,.asset { display:flex; align-items:center; justify-content:space-between; gap:16px; }
      .page-heading { align-items:flex-end; padding-bottom:22px; border-bottom:1px solid #245144; }
      .eyebrow { color:#67e7ad; font:700 10px/1.2 var(--font-mono, monospace); text-transform:uppercase; }
      h1,h2 { letter-spacing:0; } h1 { margin:7px 0; font-size:34px; } h2 { margin:5px 0; font-size:20px; }
      p,small,.guardrail span,.section-heading > span { color:#a9c2b8; }
      .button,.operation > a,.operation-actions > a { min-height:38px; box-sizing:border-box; border:1px solid #4f8d77; background:#123329; color:white; padding:9px 13px; text-decoration:none; cursor:pointer; }
      .button--compact { min-height:34px; padding:7px 10px; font-size:11px; white-space:nowrap; }
      .button--primary { border-color:#67e7ad; background:#67e7ad; color:#04130f; font-weight:750; }
      .button:disabled { opacity:.55; cursor:wait; }
      .summary { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; margin:20px 0; border:1px solid #245144; background:#245144; }
      .summary button { display:grid; gap:5px; padding:15px; border:0; background:#0a1a16; color:#eefbf5; text-align:left; cursor:pointer; }
      .summary button:hover,.summary button.is-active { background:#123329; box-shadow:inset 0 -3px #67e7ad; }
      .summary span { color:#8fb5a6; font-size:11px; } .summary strong { font-size:23px; }
      .desk-section { margin-top:18px; border:1px solid #245144; background:#0a1a16; }
      .section-heading { padding:17px 18px; border-bottom:1px solid #245144; }
      .section-heading > span { font-size:11px; }
      .operation-list { display:grid; }
      .operation { display:grid; grid-template-columns:minmax(220px,1.5fr) minmax(145px,1fr) minmax(150px,1fr) 110px auto; gap:14px; align-items:center; padding:14px 16px; border-bottom:1px solid #18392f; }
      .operation:last-child { border-bottom:0; }
      .asset { justify-content:flex-start; min-width:0; }
      .asset > span:last-child,.destination,.state { display:grid; gap:3px; min-width:0; }
      .asset-mark { display:grid; flex:0 0 38px; width:38px; height:38px; place-items:center; border:1px solid #3b7b65; color:#76e0b2; font:700 10px var(--font-mono, monospace); }
      .asset-mark[data-kind='sgt'] { border-color:#557af5; color:#9eb7ff; }
      .asset-mark[data-kind='voucher'] { border-color:#b28c4c; color:#f2cf83; }
      .asset-mark[data-kind='redemption'] { border-color:#58a7db; color:#8ed5ff; }
      .asset small,.destination strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .destination span { color:#78998c; font-size:10px; text-transform:uppercase; }
      .destination strong { font:11px var(--font-mono, monospace); }
      time { color:#77998c; font:10px var(--font-mono, monospace); }
      .status { color:#e8c66a; } .status--done { color:#67e7ad; } .status--attention { color:#ffad9a; }
      details { position:relative; }
      summary { color:#8de1bb; font-size:11px; cursor:pointer; list-style:none; }
      summary::-webkit-details-marker { display:none; }
      details[open] { grid-column:1/-1; padding:12px; border:1px solid #2c5b4b; background:#071512; }
      details dl { display:grid; gap:8px; margin:0; }
      details dl div { display:grid; grid-template-columns:90px 1fr; gap:10px; }
      dt { color:#78998c; font-size:10px; text-transform:uppercase; }
      dd { min-width:0; margin:0; overflow-wrap:anywhere; font:10px var(--font-mono, monospace); }
      .empty { display:grid; min-height:180px; place-content:center; gap:6px; text-align:center; color:#a9c2b8; }
      .empty--small { min-height:120px; }
      .notice { display:grid; gap:4px; margin-top:16px; padding:12px 14px; }
      .notice--warning { border:1px solid #856d38; background:#221e11; color:#f0d892; }
      .guardrail { display:grid; grid-template-columns:auto 1fr; gap:12px; margin-top:18px; padding:14px; border-left:3px solid #67e7ad; background:#0a1a16; font-size:12px; }
      .redemption-create { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(320px,.8fr); gap:24px; padding:20px 18px; border-bottom:1px solid #245144; }
      .redemption-copy p { max-width:640px; margin:8px 0 18px; font-size:13px; line-height:1.55; }
      .redemption-create form { display:grid; gap:13px; }
      .redemption-create label { display:grid; gap:6px; color:#b9d0c7; font-size:11px; }
      .redemption-create input,.redemption-create select { width:100%; min-height:42px; box-sizing:border-box; border:1px solid #315f50; border-radius:0; background:#071512; color:#eefbf5; padding:9px 10px; }
      .redemption-create small { color:#78998c; }
      .money-input { display:grid; grid-template-columns:32px 1fr; align-items:center; border:1px solid #315f50; background:#071512; }
      .money-input > span { text-align:center; color:#67e7ad; }
      .money-input input { border:0; }
      .funding-destination { display:grid; grid-template-columns:1fr auto; gap:5px 12px; align-items:center; padding:12px; border-left:3px solid #58a7db; background:#091c1b; }
      .funding-destination span { grid-column:1/-1; color:#8fb5a6; font-size:10px; text-transform:uppercase; }
      .funding-destination strong { font:11px var(--font-mono,monospace); }
      .funding-destination small { grid-column:1/-1; color:#f0d892; line-height:1.45; }
      .funding-destination details { grid-column:1/-1; }
      .funding-destination details[open] { padding:10px; }
      .text-button { border:0; background:transparent; color:#8de1bb; padding:0; cursor:pointer; text-decoration:underline; }
      .operation-actions { display:grid; gap:7px; justify-items:start; }
      .wallet-actions { display:flex; flex-wrap:wrap; gap:6px; }
      .action-label { color:#8fb5a6; font-size:10px; line-height:1.35; }
      .operation--redemption { grid-template-columns:minmax(220px,1.5fr) minmax(145px,1fr) minmax(180px,1fr) auto; }
      @media (max-width:900px) { .operation { grid-template-columns:1.4fr 1fr 1fr; } .operation time { display:none; } .redemption-create { grid-template-columns:1fr; } }
      @media (max-width:680px) { .sales-desk { width:min(100% - 20px,1180px); padding-top:24px; } .page-heading { align-items:flex-start; flex-direction:column; } .summary { grid-template-columns:repeat(2,1fr); } .operation { grid-template-columns:1fr auto; } .destination,.state { grid-column:1/-1; } .operation > a { justify-self:start; } .guardrail { grid-template-columns:1fr; } }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSalesComponent {
  private readonly collections = inject(CollectionApiService);
  private readonly sales = inject(AdminSalesService);
  private readonly chiaWallet = inject(ChiaWalletService);

  readonly series = signal<PresaleSeries[]>([]);
  readonly purchases = signal<AdminPurchaseOperation[]>([]);
  readonly collectionsList = signal<CollectionWorkspace[]>([]);
  readonly redemptions = signal<AdminFundedRedemption[]>([]);
  readonly funding = signal<RedemptionFundingDestination | null>(null);
  readonly loading = signal(true);
  readonly errors = signal<string[]>([]);
  readonly checkingPurchase = signal<string | null>(null);
  readonly creatingRedemption = signal(false);
  readonly fundingRedemption = signal<string | null>(null);
  readonly connectingFundingWallet = signal<'goby' | 'sage' | 'sage-walletconnect' | null>(null);
  readonly chiaConnected = this.chiaWallet.isConnected;
  readonly chiaConnectionKind = this.chiaWallet.connectionKind;
  readonly filter = signal<DeskFilter>('ALL');
  redemptionCollectionId = '';
  redemptionAmountUsd = '';
  redemptionTitle = '';
  readonly redeemableCollections = computed(() =>
    this.collectionsList().filter((collection) =>
      collection.deeds.length > 0
      && collection.deeds.every((deed) => !!deed.deedLauncherId && (deed.confirmationHeight || 0) > 0),
    ),
  );
  readonly vouchers = computed(() =>
    this.series().flatMap((campaign) =>
      campaign.vouchers.map((voucher) => ({ campaign, voucher })),
    ),
  );
  readonly filteredPurchases = computed(() =>
    this.purchases().filter((purchase) => this.matchesPurchaseFilter(purchase.state)),
  );
  readonly filteredVouchers = computed(() =>
    this.vouchers().filter(({ voucher }) => this.matchesVoucherFilter(voucher.state)),
  );
  readonly totalCount = computed(() => this.purchases().length + this.vouchers().length + this.redemptions().length);
  readonly attentionCount = computed(
    () => this.purchases().filter((item) => this.purchaseGroup(item.state) === 'ATTENTION').length
      + this.vouchers().filter(({ voucher }) => this.voucherGroup(voucher.state) === 'ATTENTION').length,
  );
  readonly inProgressCount = computed(
    () => this.purchases().filter((item) => this.purchaseGroup(item.state) === 'IN_PROGRESS').length
      + this.vouchers().filter(({ voucher }) => this.voucherGroup(voucher.state) === 'IN_PROGRESS').length,
  );
  readonly completedCount = computed(
    () => this.purchases().filter((item) => this.purchaseGroup(item.state) === 'COMPLETED').length
      + this.vouchers().filter(({ voucher }) => this.voucherGroup(voucher.state) === 'COMPLETED').length,
  );

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.errors.set([]);
    const [purchases, presales, redemptions, collections] = await Promise.allSettled([
      this.sales.listPurchases(),
      this.collections.listPresales(),
      this.sales.listRedemptions(),
      this.collections.list(),
    ]);
    const errors: string[] = [];
    if (purchases.status === 'fulfilled') this.purchases.set(purchases.value);
    else errors.push(`Direct purchases: ${formatError(purchases.reason)}`);
    if (presales.status === 'fulfilled') this.series.set(presales.value);
    else errors.push(`Reservations: ${formatError(presales.reason)}`);
    if (redemptions.status === 'fulfilled') {
      this.redemptions.set(redemptions.value.redemptions);
      this.funding.set(redemptions.value.funding);
    } else errors.push(`Redemptions: ${formatError(redemptions.reason)}`);
    if (collections.status === 'fulfilled') this.collectionsList.set(collections.value.collections);
    else errors.push(`Collections: ${formatError(collections.reason)}`);
    this.errors.set(errors);
    this.loading.set(false);
  }

  canCreateRedemption(): boolean {
    return !!this.redemptionCollectionId
      && !!this.redemptionTitle.trim()
      && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/.test(this.redemptionAmountUsd.trim())
      && Number(this.redemptionAmountUsd) > 0;
  }

  async createRedemption(): Promise<void> {
    if (!this.canCreateRedemption() || this.creatingRedemption()) return;
    this.creatingRedemption.set(true);
    this.errors.set([]);
    try {
      await this.sales.createRedemption({
        collectionId: this.redemptionCollectionId,
        title: this.redemptionTitle.trim(),
        totalPaymentUsd: this.redemptionAmountUsd.trim(),
      });
      this.redemptionCollectionId = '';
      this.redemptionAmountUsd = '';
      this.redemptionTitle = '';
      await this.reload();
    } catch (error) {
      this.errors.set([`Redemption proposal: ${formatError(error)}`]);
    } finally {
      this.creatingRedemption.set(false);
    }
  }

  async copyFundingAddress(destination: RedemptionFundingDestination): Promise<void> {
    try {
      await navigator.clipboard.writeText(destination.recipientAddress);
    } catch {
      this.errors.set(['Copy failed. Select the address from the evidence panel and copy it manually.']);
    }
  }

  hasGoby(): boolean {
    return this.chiaWallet.hasGoby();
  }

  hasSage(): boolean {
    return this.chiaWallet.hasSage();
  }

  async connectRedemptionWallet(
    kind: 'goby' | 'sage' | 'sage-walletconnect',
  ): Promise<void> {
    if (this.connectingFundingWallet()) return;
    this.connectingFundingWallet.set(kind);
    this.errors.set([]);
    try {
      if (kind === 'goby') await this.chiaWallet.connectGoby();
      else if (kind === 'sage') await this.chiaWallet.connectSage();
      else await this.chiaWallet.connectSageWalletConnect();
    } catch (error) {
      this.errors.set([`Chia wallet: ${formatError(error)}`]);
    } finally {
      this.connectingFundingWallet.set(null);
    }
  }

  canFundRedemption(redemption: AdminFundedRedemption): boolean {
    return redemption.state === 'ACTIVE'
      && redemption.chainState === 'AWAITING_EXECUTE'
      && !redemption.funding;
  }

  canResumeFunding(redemption: AdminFundedRedemption): boolean {
    return redemption.funding?.status === 'SUBMITTING';
  }

  async fundRedemption(redemption: AdminFundedRedemption): Promise<void> {
    if (!this.canFundRedemption(redemption) || this.fundingRedemption()) return;
    const destination = this.funding();
    if (!destination) {
      this.errors.set(['The signed redemption treasury is unavailable. Refresh before funding.']);
      return;
    }
    const connection = this.chiaConnectionKind();
    if (connection !== 'goby' && connection !== 'sage' && connection !== 'sage-walletconnect') {
      this.errors.set(['Connect Goby or Sage to fund this settlement with wUSDC.b.']);
      return;
    }
    const amount = BigInt(redemption.bill.totalPaymentAmount);
    const confirmed = window.confirm(
      `Fund ${this.wusdc(redemption.bill.totalPaymentAmount)} for ${redemption.title}?\n\n`
      + `Network: ${destination.network}\n`
      + `Asset: wUSDC.b (${this.short(destination.assetId)})\n`
      + `Purpose: create permanent redemption offers for ${redemption.bill.deedCount} SmartDeeds\n\n`
      + 'Your wallet builds a zero-fee CAT transfer. Solslot verifies every input and output, then adds a bounded medium-speed XCH fee from the protocol fee till.',
    );
    if (!confirmed) return;

    this.fundingRedemption.set(redemption.id);
    this.errors.set([]);
    try {
      const bundle = await this.chiaWallet.transfer({
        targetPuzzleHash: destination.recipientPuzzleHash,
        amount,
        assetId: destination.assetId,
        memos: [
          'SOLSLOT_REDEMPTION_FUNDING_V1',
          redemption.id,
          redemption.bill.settlementId,
        ],
      });
      await this.sales.submitRedemptionFunding(redemption.id, bundle);
      await this.reload();
    } catch (error) {
      this.errors.set([`Redemption funding: ${formatError(error)}`]);
    } finally {
      this.fundingRedemption.set(null);
    }
  }

  async resumeFunding(redemption: AdminFundedRedemption): Promise<void> {
    if (!this.canResumeFunding(redemption) || this.fundingRedemption()) return;
    this.fundingRedemption.set(redemption.id);
    this.errors.set([]);
    try {
      await this.sales.resumeRedemptionFunding(redemption.id);
      await this.reload();
    } catch (error) {
      this.errors.set([`Funding recovery: ${formatError(error)}`]);
    } finally {
      this.fundingRedemption.set(null);
    }
  }

  fundingStatus(redemption: AdminFundedRedemption): string {
    const funding = redemption.funding;
    if (!funding) return 'Awaiting approved funding';
    if (funding.status === 'CONFIRMED') return `Funding confirmed at height ${funding.confirmedHeight}`;
    if (funding.status === 'SUBMITTED') return 'Funding seen in the mempool';
    if (funding.status === 'SUBMITTING') return 'Submission can be safely resumed';
    return 'Wallet funding must be signed again';
  }

  redemptionAmount(redemption: AdminFundedRedemption): string {
    return this.wusdc(redemption.bill.totalPaymentAmount);
  }

  wusdc(amount: string): string {
    const value = this.integer(amount);
    return value === null ? 'Amount unavailable' : `${this.usd(value, 3)} wUSDC.b`;
  }

  redemptionStage(redemption: AdminFundedRedemption): string {
    return {
      DRAFT: 'Draft',
      READY: 'Awaiting owner + coadmin',
      ACTIVE: 'Committee vote open',
      EXECUTED: 'Funded on-chain',
      FAILED: 'Needs review',
      CANCELED: 'Canceled',
    }[redemption.state];
  }

  redemptionHelp(redemption: AdminFundedRedemption): string {
    if (redemption.state === 'EXECUTED') {
      const available = redemption.availableOfferCount || 0;
      return available === redemption.bill.deedCount
        ? 'Every SmartDeed has a permanent offer'
        : `${available} of ${redemption.bill.deedCount} remain unredeemed`;
    }
    if (redemption.state === 'ACTIVE' && redemption.chainState === 'AWAITING_EXECUTE') {
      return redemption.funding
        ? this.fundingStatus(redemption)
        : 'Vote passed. Fund the exact settlement to unlock execution';
    }
    if (redemption.state === 'ACTIVE') return 'Committee vote is still open';
    if (redemption.state === 'READY') return 'Collect owner-plus-one approval';
    if (redemption.state === 'DRAFT') return 'Send the exact allocation for review';
    return 'No customer redemption is available';
  }

  purchaseTitle(purchase: AdminPurchaseOperation): string {
    if (purchase.deliveryKind === 'sgt') return `${purchase.quantity.toLocaleString()} SGT`;
    const launcher = String(purchase.artifact?.['deedLauncherId'] || '');
    return launcher ? `SmartDeed ${this.short(launcher)}` : 'SmartDeed purchase';
  }

  purchaseAmount(purchase: AdminPurchaseOperation): string {
    const minor = this.integer(purchase.artifact?.['grossUsdAmountMinor']);
    return minor === null ? 'Price fixed in artifact' : this.usd(minor);
  }

  railLabel(rail: AdminPurchaseOperation['rail']): string {
    return {
      chia_xch: 'XCH offer',
      chia_cat: 'Chia CAT offer',
      base_usdc: 'Base USDC',
      stripe: 'Stripe',
    }[rail];
  }

  purchaseStatus(state: PurchaseOperationState): string {
    return {
      created: 'Starting',
      zk_verified: 'Vault approved',
      artifact_ready: 'Ready for payment',
      payment_pending: 'Payment pending',
      paid: 'Payment confirmed',
      protocol_verified: 'Payment verified',
      finalized: 'Delivered',
      failed: 'Failed',
      expired: 'Expired',
      refund_pending: 'Refund pending',
      manual_review: 'Review required',
    }[state];
  }

  purchaseHelp(state: PurchaseOperationState): string {
    if (state === 'payment_pending') return 'Waiting for the payment provider';
    if (state === 'paid' || state === 'protocol_verified') return 'Awaiting exact vault delivery';
    if (state === 'finalized') return 'Chain confirmation recorded';
    if (state === 'manual_review') return 'Owner and coadministrator should inspect evidence';
    if (state === 'refund_pending') return 'Exact original-payment refund is processing';
    if (state === 'failed' || state === 'expired') return 'No delivery is authorized';
    return 'No administrator action needed';
  }

  purchaseStatusClass(state: PurchaseOperationState): string {
    const group = this.purchaseGroup(state);
    if (group === 'COMPLETED') return 'status status--done';
    if (group === 'ATTENTION') return 'status status--attention';
    return 'status';
  }

  voucherPaymentAmount(voucher: PresaleVoucher): string {
    if (voucher.paymentRail === 'STRIPE_USD') return this.usd(BigInt(voucher.paymentPrincipal));
    if (voucher.paymentRail === 'BASE_SEPOLIA_USDC') return this.usd(BigInt(voucher.paymentPrincipal), 6);
    return `${(voucher.paymentPrincipal / 1_000_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 12 })} XCH`;
  }

  voucherRail(voucher: PresaleVoucher): string {
    if (voucher.paymentRail === 'STRIPE_USD') return 'Stripe USD';
    return voucher.paymentRail === 'BASE_SEPOLIA_USDC' ? 'Base USDC' : 'XCH offer';
  }

  voucherStatus(state: VoucherState): string {
    return {
      PENDING_ISSUANCE: 'Preparing receipt',
      ISSUANCE_SUBMITTED: 'Receipt submitted',
      ESCROWED: 'Refundable',
      REFUNDING: 'Refund processing',
      REFUNDED: 'Refunded',
      REDEEMING: 'Delivering deed',
      REDEEMED: 'Deed delivered',
    }[state];
  }

  voucherHelp(state: VoucherState): string {
    if (state === 'ESCROWED') return 'Funds remain protected';
    if (state === 'REDEEMED') return 'SmartDeed confirmed';
    if (state === 'REFUNDED') return 'Exact paid asset returned';
    return 'Deterministic processing';
  }

  voucherStatusClass(state: VoucherState): string {
    const group = this.voucherGroup(state);
    if (group === 'COMPLETED') return 'status status--done';
    if (group === 'ATTENTION') return 'status status--attention';
    return 'status';
  }

  operationTime(purchase: AdminPurchaseOperation): string | number | null {
    return purchase.updatedAt || purchase.createdAt;
  }

  evidenceReference(purchase: AdminPurchaseOperation): string {
    const evidence = purchase.settlementEvidence;
    for (const key of [
      'expectedDeliveryCoinId',
      'expectedSmartDeedCoinId',
      'expectedSgtCoinId',
      'expectedOutputCoinId',
      'spendBundleId',
      'transactionId',
      'payment_intent_id',
    ]) {
      const value = evidence[key];
      if (typeof value === 'string' && value) return value;
    }
    return '';
  }

  canCheckDelivery(purchase: AdminPurchaseOperation): boolean {
    return purchase.rail === 'stripe'
      && !!purchase.purchaseId
      && ['paid', 'protocol_verified'].includes(purchase.state);
  }

  async checkDelivery(purchase: AdminPurchaseOperation): Promise<void> {
    if (!purchase.purchaseId || !this.canCheckDelivery(purchase)) return;
    this.checkingPurchase.set(purchase.purchaseId);
    this.errors.set([]);
    try {
      await this.sales.reconcilePurchase(purchase.purchaseId);
      await this.reload();
    } catch (error) {
      this.errors.set([`Delivery check: ${formatError(error)}`]);
    } finally {
      this.checkingPurchase.set(null);
    }
  }

  short(value: string): string {
    return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-7)}` : value;
  }

  private matchesPurchaseFilter(state: PurchaseOperationState): boolean {
    return this.filter() === 'ALL' || this.purchaseGroup(state) === this.filter();
  }

  private matchesVoucherFilter(state: VoucherState): boolean {
    return this.filter() === 'ALL' || this.voucherGroup(state) === this.filter();
  }

  private purchaseGroup(state: PurchaseOperationState): Exclude<DeskFilter, 'ALL'> {
    if (state === 'finalized') return 'COMPLETED';
    if (['failed', 'expired', 'refund_pending', 'manual_review'].includes(state)) return 'ATTENTION';
    return 'IN_PROGRESS';
  }

  private voucherGroup(state: VoucherState): Exclude<DeskFilter, 'ALL'> {
    if (state === 'REDEEMED' || state === 'REFUNDED') return 'COMPLETED';
    if (state === 'REFUNDING') return 'ATTENTION';
    return 'IN_PROGRESS';
  }

  private integer(value: unknown): bigint | null {
    const text = String(value ?? '');
    return /^(0|[1-9][0-9]*)$/.test(text) ? BigInt(text) : null;
  }

  private usd(minor: bigint, decimals = 2): string {
    const divisor = 10n ** BigInt(decimals);
    const dollars = minor / divisor;
    const cents = (minor % divisor).toString().padStart(decimals, '0');
    return `$${dollars.toLocaleString()}.${cents.slice(0, 2)}`;
  }
}
