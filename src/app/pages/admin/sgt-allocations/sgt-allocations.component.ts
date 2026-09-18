import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { computeAddress } from 'ethers';

import { AdminWorkspaceNavComponent } from '../../../components/admin-workspace/admin-workspace-nav.component';
import {
  GovernanceProposalKind,
  GovernanceProposalRecord,
  GovernanceChainResult,
  GovernancePublicationAction,
  GovernancePublicationPackage,
  GovernanceQueueService,
  SgtSalePaymentOption,
  SgtSalePaymentRail,
  StarterGrantPreview,
} from '../../../services/governance-queue.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { GovernanceVaultVoteService } from '../../../services/governance-vault-vote.service';
import { SessionService } from '../../../services/session.service';
import { formatError } from '../../../utils/format-error';

@Component({
  selector: 'solslot-sgt-allocations',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AdminWorkspaceNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <solslot-admin-workspace-nav />

    <main class="allocation-page">
      <header class="page-header">
        <div>
          <span class="eyebrow">Governance participation</span>
          <h1>SGT allocations</h1>
          <p>
            Prepare company SGT sales and grants. The committee votes on one proposal at a
            time; the rest remain safely queued.
          </p>
        </div>
        <button type="button" class="secondary" (click)="reload()" [disabled]="loading()">
          {{ loading() ? 'Refreshing…' : 'Refresh' }}
        </button>
      </header>

      <section class="reserve-note" aria-label="SGT authority summary">
        <div>
          <strong>What SGT grants</strong>
          <span>Voting participation in protocol governance.</span>
        </div>
        <div>
          <strong>What SGT does not grant</strong>
          <span>No administrator key, company ownership, treasury access, or SmartDeed rights.</span>
        </div>
      </section>

      @if (error()) {
        <div class="message error" role="alert">
          <strong>Action not completed</strong>
          <span>{{ error() }}</span>
        </div>
      }
      @if (notice()) {
        <div class="message success" role="status">{{ notice() }}</div>
      }

      <section class="publication" aria-labelledby="starter-grants-title">
        <h2 id="starter-grants-title">Administrator starter SGT</h2>
        <p>Prepare one minimum proposal stake for each administrator from the company reserve.
          Every grant requires the owner plus one coadministrator and the existing SGT vote.</p>
        @for (slot of [0, 1, 2]; track slot) {
          <label>
            <span>{{ slot === 0 ? 'Owner administrator' : 'Administrator ' + (slot + 1) }} enrolled vault ID</span>
            <input [ngModel]="starterVaults[slot]" (ngModelChange)="setStarterVault(slot, $event)" class="mono" placeholder="0x…" />
          </label>
        }
        <button type="button" (click)="previewStarterGrants()" [disabled]="busy() || !starterRecipientsReady()">Review starter grants</button>
        @if (starterPreview(); as preview) {
          <p>{{ preview.amountPerAdministrator }} SGT per administrator; {{ preview.totalAmount }} SGT total.
            Confirm that each selected vault belongs to the named administrator.</p>
          <ol>
            @for (grant of preview.proposals; track grant.grantId) {
              <li>{{ grant.title }} — {{ grant.sgtAmount }} SGT <span class="mono">{{ grant.recipientVaultLauncherId }}</span></li>
            }
          </ol>
          <button type="button" (click)="queueStarterGrants()" [disabled]="busy()">Add reviewed starter grants to queue</button>
        }
      </section>

      <div class="workspace-grid">
        <section class="proposal-form" aria-labelledby="new-allocation-title">
          <div class="section-heading">
            <div>
              <span class="step">New proposal</span>
              <h2 id="new-allocation-title">Choose an allocation</h2>
            </div>
            <div class="segmented" aria-label="Allocation type">
              <button
                type="button"
                [class.active]="kind() === 'SGT_SALE'"
                (click)="kind.set('SGT_SALE')"
              >
                Sale
              </button>
              <button
                type="button"
                [class.active]="kind() === 'SGT_GRANT'"
                (click)="kind.set('SGT_GRANT')"
              >
                Grant
              </button>
            </div>
          </div>

          <label>
            <span>Proposal title</span>
            <input [(ngModel)]="title" maxlength="120" placeholder="Example: Allocate SGT to Abraham" />
          </label>

          <div class="two-col">
            <label>
              <span>SGT units</span>
              <input [(ngModel)]="sgtAmount" inputmode="numeric" placeholder="10000" />
              <small>Whole SGT units from the governed company reserve.</small>
            </label>
            <label>
              <span>Recipient vault ID</span>
              <input [(ngModel)]="recipientVaultLauncherId" class="mono" placeholder="0x…" />
              <small>The vault must have a current zkPassport approval. SGT is delivered to its protected vault address.</small>
            </label>
          </div>

          @if (kind() === 'SGT_SALE') {
            <div class="conditional-fields">
              <div class="two-col">
                <label>
                  <span>Company receives</span>
                  <div class="amount-input">
                    <input [(ngModel)]="paymentAmount" inputmode="decimal" placeholder="1.00" />
                    <select
                      [ngModel]="paymentRail"
                      (ngModelChange)="setPaymentRail($event)"
                      aria-label="Payment asset"
                    >
                      @for (rail of paymentRails(); track rail.id) {
                        <option [ngValue]="rail.id">{{ rail.label }}</option>
                      }
                    </select>
                  </div>
                  <small>{{ paymentHelp() }}</small>
                </label>
                <label>
                  <span>Offer available until</span>
                  <input [(ngModel)]="expiresLocal" type="datetime-local" />
                  <small>{{ expiryHelp() }}</small>
                </label>
              </div>
              <p class="plain-note">
                This proposal fixes the SGT amount, approved vault, price, treasury, and
                deadline. {{ settlementExplanation() }}
              </p>
            </div>
          } @else {
            <label>
              <span>Reason for the grant</span>
              <textarea
                [(ngModel)]="grantReason"
                rows="4"
                maxlength="500"
                placeholder="Describe the approved service, engagement, or governance purpose."
              ></textarea>
              <small>The proposal commits to a hash of this reason.</small>
            </label>
          }

          <div class="decision-receipt">
            <strong>{{ kind() === 'SGT_SALE' ? 'Sale decision' : 'Grant decision' }}</strong>
            <dl>
              <div><dt>SGT leaving reserve</dt><dd>{{ sgtAmount || 'Not entered' }}</dd></div>
              <div><dt>Recipient vault</dt><dd class="mono">{{ shortAddress(recipientVaultLauncherId) }}</dd></div>
              <div>
                <dt>Company proceeds</dt>
                <dd>{{ kind() === 'SGT_SALE' ? (paymentAmount || 'Not entered') + ' ' + paymentRailLabel() : 'None' }}</dd>
              </div>
              <div><dt>Authority</dt><dd>Owner + one coadministrator, then SGT vote</dd></div>
            </dl>
          </div>

          <button type="button" class="primary" (click)="createProposal()" [disabled]="busy() || !formReady()">
            {{ busy() ? 'Saving…' : 'Add to proposal queue' }}
          </button>
        </section>

        <section class="queue" aria-labelledby="proposal-queue-title">
          <div class="section-heading">
            <div>
              <span class="step">Governance tracker</span>
              <h2 id="proposal-queue-title">Committee proposal queue</h2>
            </div>
            <span class="queue-count">{{ openCount() }} open</span>
          </div>

          @if (loading() && proposals().length === 0) {
            <p class="empty">Loading the queue…</p>
          } @else if (proposals().length === 0) {
            <div class="empty">
              <strong>No proposals prepared</strong>
              <span>SGT allocations and funded SmartDeed redemptions appear here for review.</span>
            </div>
          } @else {
            <ol class="queue-list">
              @for (proposal of proposals(); track proposal.id) {
                <li [attr.data-state]="proposal.state">
                  <div class="queue-position">{{ proposal.state === 'ACTIVE' ? 'LIVE' : proposal.queuePosition }}</div>
                  <div class="queue-body">
                    <div class="queue-title">
                      <strong>{{ proposal.title }}</strong>
                      <span class="status">{{ stateLabel(proposal) }}</span>
                    </div>
                    <p>
                      {{ proposalSummary(proposal) }}
                    </p>
                    <div class="queue-actions">
                      @if (proposal.state === 'DRAFT') {
                        <button type="button" (click)="markReady(proposal)" [disabled]="busy()">
                          Send for review
                        </button>
                        <button type="button" class="text-button" (click)="cancel(proposal)" [disabled]="busy()">
                          Cancel
                        </button>
                      } @else if (proposal.state === 'READY') {
                        <label class="coadmin-choice">
                          <span>Second approver</span>
                          <select
                            [ngModel]="coadminFor(proposal)"
                            (ngModelChange)="setCoadmin(proposal, $event)"
                            [disabled]="proposal.publicationCoadminSlot !== null || busy()"
                          >
                            <option [ngValue]="1">Administrator 2</option>
                            <option [ngValue]="2">Administrator 3</option>
                          </select>
                        </label>
                        <button type="button" (click)="preparePublication(proposal)" [disabled]="busy()">
                          Review approvals
                        </button>
                      } @else if (proposal.state === 'ACTIVE') {
                        @if (canExecute(proposal)) {
                          @if (proposal.kind === 'FUNDED_REDEMPTION') {
                            <a routerLink="/admin/sales">Open exact funding instructions</a>
                            <button type="button" class="primary" (click)="execute(proposal)" [disabled]="busy()">
                              Check funding and create offers
                            </button>
                          } @else {
                            <button type="button" class="primary" (click)="execute(proposal)" [disabled]="busy()">
                              Finalize allocation
                            </button>
                          }
                        } @else if (!proposal.executionBundleId) {
                          <section class="vault-vote" aria-label="Vote with vault-held SGT">
                            <div>
                              <strong>Vote from your vault</strong>
                              <span>
                                Your selected SGT stays bound to the vault and unlocks after voting closes.
                              </span>
                            </div>
                            @if (connectedVault(); as vaultId) {
                              @if (googleVotingUnavailable()) {
                                <p role="status">Voting with Google Vault is not available in this alpha. You can still view your holdings.</p>
                              }
                              <label>
                                <span>SGT voting balance</span>
                                <input
                                  inputmode="numeric"
                                  [ngModel]="voteAmountFor(proposal)"
                                  (ngModelChange)="setVoteAmount(proposal, $event)"
                                  placeholder="10000"
                                  [attr.aria-label]="'SGT voting balance for ' + proposal.title"
                                />
                                <small>Enter one whole SGT balance held by this vault.</small>
                              </label>
                              <div class="vault-vote__footer">
                                <span class="mono">{{ shortAddress(vaultId) }}</span>
                                <button
                                  type="button"
                                  class="primary"
                                  (click)="castVote(proposal)"
                                  [disabled]="busy() || googleVotingUnavailable() || !positiveVoteAmount(proposal)"
                                >
                                  Review and vote
                                </button>
                              </div>
                            } @else {
                              <a routerLink="/connect">Connect a protocol vault to vote</a>
                            }
                          </section>
                        }
                        <button type="button" (click)="reconcile(proposal)" [disabled]="busy()">
                          {{ proposal.executionBundleId ? 'Confirm allocation' : 'Check chain status' }}
                        </button>
                      }
                    </div>
                    @if (chainResultFor(proposal); as chain) {
                      <div class="chain-progress" [attr.data-chain-state]="chain.chainState">
                        <strong>{{ chainHeading(chain.chainState) }}</strong>
                        <span>{{ chainSummary(proposal, chain) }}</span>
                      </div>
                    }
                    @if (proposal.saleOffer; as sale) {
                      <section class="sale-offer" aria-label="Governed SGT sale offer">
                        <div class="sale-offer__heading">
                          <div>
                            <span>Approved sale</span>
                            <strong>{{ saleStatusLabel(sale.status) }}</strong>
                          </div>
                          <span class="sale-status" [attr.data-status]="sale.status">{{ sale.status }}</span>
                        </div>
                        <p>{{ saleStatusSummary(proposal) }}</p>
                        <div class="sale-offer__actions">
                          @if (sale.status === 'AVAILABLE' && sale.offerFile) {
                            <button type="button" class="primary" (click)="copySaleOffer(proposal)" [disabled]="busy()">
                              Copy exact offer
                            </button>
                          }
                          @if (!['TAKEN', 'RETURNED'].includes(sale.status)) {
                            <button type="button" (click)="reconcile(proposal)" [disabled]="busy()">
                              Refresh sale status
                            </button>
                          }
                        </div>
                      </section>
                    }
                    @if (publicationFor(proposal); as publication) {
                      <section class="publication" aria-label="Proposal publication approvals">
                        <div class="publication-summary">
                          <div>
                            <span>Network</span>
                            <strong>{{ publication.network }}</strong>
                          </div>
                          <div>
                            <span>Approval rule</span>
                            <strong>{{ publication.authorityRule }}</strong>
                          </div>
                          <div>
                            <span>Committee vote</span>
                            <strong>Starts after owner submission</strong>
                          </div>
                        </div>
                        <ol class="approval-list">
                          @for (action of publication.actions; track action.actionId) {
                            <li>
                              <div>
                                <strong>{{ action.title }}</strong>
                                <span>{{ action.summary }}</span>
                              </div>
                              @if (action.signed) {
                                <span class="signed">Approved</span>
                              } @else {
                                <div class="sign-options">
                                  <button type="button" (click)="signAction(proposal, action, 'browser')" [disabled]="busy()">
                                    Browser wallet
                                  </button>
                                  <button type="button" (click)="signAction(proposal, action, 'mobile')" [disabled]="busy()">
                                    Mobile / hardware
                                  </button>
                                </div>
                              }
                            </li>
                          }
                        </ol>
                        @if (publication.readyToSubmit) {
                          <div class="submit-row">
                            <span>Both approvals are recorded. Only the owner wallet can submit.</span>
                            <button type="button" class="primary" (click)="submitPublication(proposal)" [disabled]="busy() || !isOwnerWallet(publication)">
                              Open committee vote
                            </button>
                          </div>
                        }
                      </section>
                    }
                    <details>
                      <summary>Chain evidence</summary>
                      <dl class="evidence">
                        <div><dt>Proposal hash</dt><dd>{{ proposal.proposalHash }}</dd></div>
                        <div><dt>Activation bundle</dt><dd>{{ proposal.activationBundleId || 'Not submitted' }}</dd></div>
                        <div><dt>Execution bundle</dt><dd>{{ proposal.executionBundleId || 'Not submitted' }}</dd></div>
                        <div><dt>Completion bundle</dt><dd>{{ proposal.completionBundleId || 'Not completed' }}</dd></div>
                        <div>
                          <dt>Allocation outputs</dt>
                          <dd>{{ proposal.expectedOutputCoinIds.length ? proposal.expectedOutputCoinIds.join(', ') : 'Not created' }}</dd>
                        </div>
                      </dl>
                    </details>
                  </div>
                </li>
              }
            </ol>
          }
        </section>
      </div>
    </main>
  `,
  styles: [
    `
      :host { display:block; min-height:100vh; background:#05120f; color:#edf9f4; }
      .allocation-page { width:min(1220px,calc(100% - 32px)); margin:0 auto; padding:42px 0 80px; }
      .page-header,.section-heading,.queue-title,.queue-actions { display:flex; align-items:center; justify-content:space-between; gap:16px; }
      .page-header { align-items:flex-end; padding-bottom:28px; border-bottom:1px solid #21483d; }
      h1,h2,p { margin:0; } h1 { margin-top:5px; font-size:clamp(32px,5vw,52px); letter-spacing:0; }
      h2 { margin-top:4px; font-size:22px; letter-spacing:0; }
      .eyebrow,.step { color:#70dfad; font:700 10px/1.2 var(--font-mono); text-transform:uppercase; }
      .page-header p { max-width:670px; margin-top:10px; color:#a9c2b8; font-size:14px; line-height:1.55; }
      button,a { font:600 12px var(--font-sans); }
      button { cursor:pointer; } button:disabled { cursor:not-allowed; opacity:.5; }
      .primary,.secondary,.segmented button,.queue-actions button { min-height:40px; border:1px solid #3d7864; padding:0 15px; }
      .primary { border-color:#66dfaa; background:#66dfaa; color:#04130f; }
      .secondary,.segmented button,.queue-actions button { background:#0b201a; color:#dff8ed; }
      .reserve-note { display:grid; grid-template-columns:1fr 1fr; margin:24px 0 30px; border-top:1px solid #21483d; border-bottom:1px solid #21483d; }
      .reserve-note div { display:grid; gap:4px; padding:15px 18px; } .reserve-note div + div { border-left:1px solid #21483d; }
      .reserve-note strong { font-size:12px; } .reserve-note span { color:#96b3a7; font-size:12px; }
      .workspace-grid { display:grid; grid-template-columns:minmax(0,1.08fr) minmax(360px,.92fr); gap:34px; align-items:start; }
      .proposal-form { display:grid; gap:19px; padding-right:34px; border-right:1px solid #21483d; }
      .segmented { display:flex; border:1px solid #315f50; } .segmented button { border:0; min-width:76px; }
      .segmented button.active { background:#66dfaa; color:#04130f; }
      label { display:grid; gap:7px; color:#dff7ed; font-size:12px; }
      label > span { font-weight:700; } small { color:#88a89a; font-size:11px; line-height:1.4; }
      input,textarea { width:100%; border:1px solid #315f50; border-radius:0; background:#071914; color:#f2fff9; padding:11px 12px; font:13px var(--font-sans); outline:none; box-sizing:border-box; }
      input:focus,textarea:focus { border-color:#6fe0ae; box-shadow:0 0 0 2px rgba(111,224,174,.12); }
      .mono { font-family:var(--font-mono) !important; }
      .two-col { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
      .conditional-fields { display:grid; gap:13px; }
      .amount-input { display:grid; grid-template-columns:1fr auto; } .amount-input input { border-right:0; }
      .amount-input b { display:grid; place-items:center; min-width:58px; border:1px solid #315f50; background:#0e261f; color:#79e6b5; font-size:11px; }
      .plain-note { padding:12px 14px; border-left:3px solid #67e7ad; background:#0b201a; color:#a9c2b8; font-size:12px; line-height:1.5; }
      .decision-receipt { padding:16px 0; border-top:1px solid #315f50; border-bottom:1px solid #315f50; }
      .decision-receipt > strong { font-size:13px; }
      .decision-receipt dl { display:grid; grid-template-columns:1fr 1fr; gap:12px 18px; margin:14px 0 0; }
      dl div { min-width:0; } dt { color:#88a89a; font-size:10px; text-transform:uppercase; } dd { margin:4px 0 0; overflow-wrap:anywhere; font-size:12px; }
      .message { display:grid; gap:4px; margin-bottom:20px; padding:13px 15px; border-left:3px solid; font-size:12px; }
      .message.error { border-color:#ef7c78; background:#2b1212; color:#ffd8d5; } .message.success { border-color:#67e7ad; background:#0d251e; }
      .queue-count,.status { border:1px solid #315f50; padding:5px 8px; color:#8fe6bd; font:700 9px var(--font-mono); text-transform:uppercase; }
      .queue-list { display:grid; gap:0; margin:18px 0 0; padding:0; list-style:none; border-top:1px solid #21483d; }
      .queue-list li { display:grid; grid-template-columns:52px 1fr; gap:14px; padding:17px 0; border-bottom:1px solid #21483d; }
      .queue-position { display:grid; width:42px; height:42px; place-items:center; border:1px solid #315f50; color:#70dfad; font:700 10px var(--font-mono); }
      .queue-body { min-width:0; } .queue-title strong { font-size:14px; }
      .queue-body > p { margin-top:5px; color:#a9c2b8; font-size:12px; }
      .queue-actions { justify-content:flex-start; margin-top:12px; }
      .vault-vote { display:grid; gap:12px; width:100%; padding:14px; border:1px solid #315f50; background:#081a15; }
      .vault-vote > div:first-child { display:grid; gap:4px; }
      .vault-vote > div:first-child span { color:#9db8ad; font-size:11px; line-height:1.45; }
      .vault-vote label { max-width:280px; }
      .vault-vote__footer { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .vault-vote__footer > span { color:#88a89a; font-size:10px; }
      .queue-actions span { color:#86a79a; font-size:11px; } .queue-actions a { color:#7fe5b7; }
      .chain-progress { display:grid; gap:4px; margin-top:12px; padding:12px 14px; border-left:3px solid #58b990; background:#0a1d17; }
      .chain-progress strong { font-size:12px; } .chain-progress span { color:#9db8ad; font-size:11px; line-height:1.45; }
      .chain-progress[data-chain-state='AWAITING_EXECUTE'] { border-color:#70dfad; background:#10271f; }
      .chain-progress[data-chain-state='EXECUTION_PENDING'] { border-color:#62b9e8; }
      .sale-offer { display:grid; gap:10px; margin-top:12px; padding:14px; border:1px solid #285246; background:#0a1a16; }
      .sale-offer__heading,.sale-offer__actions { display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .sale-offer__heading > div { display:grid; gap:3px; }
      .sale-offer__heading span:first-child { color:#7ea697; font:9px var(--font-mono); text-transform:uppercase; }
      .sale-offer p { margin:0; color:#a7beb5; font-size:11px; line-height:1.5; }
      .sale-status { padding:5px 7px; border:1px solid #37695a; color:#9ebbb0; font:9px var(--font-mono); }
      .sale-status[data-status='AVAILABLE'],.sale-status[data-status='TAKEN'] { color:#70dfad; border-color:#3b8068; }
      .sale-status[data-status='EXPIRED'],.sale-status[data-status='RETURNED'] { color:#e8c879; border-color:#775f2b; }
      select { min-height:40px; border:1px solid #315f50; background:#071914; color:#edf9f4; padding:0 10px; }
      .coadmin-choice { display:flex; align-items:center; gap:8px; }
      .coadmin-choice > span { color:#9ab4a9; font-size:11px; }
      .publication { display:grid; gap:14px; margin-top:14px; padding:15px; border:1px solid #315f50; background:#081a15; }
      .publication-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
      .publication-summary div { display:grid; gap:4px; }
      .publication-summary span { color:#88a89a; font-size:9px; text-transform:uppercase; }
      .publication-summary strong { font-size:11px; }
      .approval-list { display:grid; gap:0; margin:0; padding:0; list-style:none; border-top:1px solid #21483d; }
      .approval-list li { display:flex; grid-template-columns:none; align-items:center; justify-content:space-between; gap:14px; padding:12px 0; }
      .approval-list li > div:first-child { display:grid; gap:3px; }
      .approval-list li span { color:#91ada1; font-size:10px; line-height:1.4; }
      .signed { color:#70dfad !important; font-weight:700; text-transform:uppercase; }
      .sign-options { display:flex; gap:7px; flex:0 0 auto; }
      .submit-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-top:12px; border-top:1px solid #21483d; }
      .submit-row > span { color:#9ab4a9; font-size:11px; }
      .text-button { border-color:transparent !important; background:transparent !important; color:#9eb7ad !important; }
      details { margin-top:12px; } summary { color:#80aa98; font:11px var(--font-mono); cursor:pointer; }
      .evidence { display:grid; gap:8px; margin:10px 0 0; padding:10px; background:#06100e; }
      .evidence dd { color:#91ada1; font:10px/1.4 var(--font-mono); }
      .empty { display:grid; gap:5px; margin-top:18px; padding:24px 0; color:#91ada1; font-size:12px; }
      @media (max-width:900px) { .workspace-grid { grid-template-columns:1fr; } .proposal-form { padding:0 0 30px; border:0; border-bottom:1px solid #21483d; } }
      @media (max-width:620px) { .allocation-page { width:calc(100% - 22px); padding-top:24px; } .page-header,.section-heading { align-items:flex-start; flex-direction:column; } .reserve-note,.two-col,.decision-receipt dl { grid-template-columns:1fr; } .reserve-note div + div { border-left:0; border-top:1px solid #21483d; } }
      @media (max-width:620px) { .publication-summary { grid-template-columns:1fr; } .approval-list li,.submit-row { align-items:flex-start; flex-direction:column; } .sign-options { width:100%; flex-wrap:wrap; } }
      @media (max-width:620px) { .vault-vote__footer { align-items:stretch; flex-direction:column; } }
    `,
  ],
})
export class SgtAllocationsComponent {
  private readonly api = inject(GovernanceQueueService);
  private readonly wallet = inject(EvmWalletService);
  private readonly vote = inject(GovernanceVaultVoteService);
  readonly googleVotingUnavailable = this.vote.googleVotingUnavailable;
  private readonly vaultSession = inject(SessionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly executionPolls = new Map<string, ReturnType<typeof setTimeout>>();

  readonly proposals = signal<GovernanceProposalRecord[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly kind = signal<Exclude<GovernanceProposalKind, 'FUNDED_REDEMPTION'>>('SGT_SALE');
  readonly publications = signal<Record<string, GovernancePublicationPackage>>({});
  readonly coadmins = signal<Record<string, number>>({});
  readonly chainResults = signal<Record<string, GovernanceChainResult>>({});
  readonly voteAmounts = signal<Record<string, string>>({});
  readonly connectedVault = computed(() => this.vaultSession.session()?.vaultLauncherId ?? null);
  readonly paymentRails = signal<SgtSalePaymentOption[]>([
    { id: 'XCH', label: 'XCH', decimals: 12 },
  ]);
  readonly openCount = computed(
    () => this.proposals().filter((item) => !['EXECUTED', 'FAILED', 'CANCELED'].includes(item.state)).length,
  );

  title = '';
  sgtAmount = '';
  recipientVaultLauncherId = '';
  paymentRail: SgtSalePaymentRail = 'XCH';
  paymentAmount = '';
  expiresLocal = defaultExpiry();
  grantReason = '';
  starterVaults = ['', '', ''];
  readonly starterPreview = signal<StarterGrantPreview | null>(null);

  setStarterVault(slot: number, value: string): void {
    this.starterVaults[slot] = value.trim();
    this.starterPreview.set(null);
  }

  starterRecipientsReady(): boolean {
    const ids = this.starterVaults.map(value => value.toLowerCase());
    return ids.every(value => /^0x[0-9a-f]{64}$/.test(value)) && new Set(ids).size === 3;
  }

  async previewStarterGrants(): Promise<void> {
    if (!this.starterRecipientsReady() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const recipients = [...this.starterVaults];
      const preview = await this.api.previewStarterGrants(recipients);
      if (recipients.some((value, index) => value !== this.starterVaults[index])) {
        throw new Error('The recipient vaults changed. Review the starter grants again.');
      }
      this.starterPreview.set(preview);
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }

  async queueStarterGrants(): Promise<void> {
    const preview = this.starterPreview();
    if (!preview || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      for (const grant of preview.proposals) {
        if (this.proposals().some(item => item.bill['grantId'] === grant.grantId)) continue;
        const proposal = await this.api.create(grant);
        this.proposals.update(items => [...items, proposal]);
      }
      this.starterPreview.set(null);
      this.notice.set('Three starter grants are queued for owner-plus-one approval.');
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const timer of this.executionPolls.values()) clearTimeout(timer);
      this.executionPolls.clear();
    });
    void this.reload();
  }

  formReady(): boolean {
    if (this.title.trim().length < 3 || !positiveInteger(this.sgtAmount)) return false;
    if (!/^0x[0-9a-fA-F]{64}$/.test(this.recipientVaultLauncherId.trim())) return false;
    if (this.kind() === 'SGT_SALE') {
      return this.paymentToUnits() !== null && Number.isFinite(Date.parse(this.expiresLocal));
    }
    return this.grantReason.trim().length >= 8;
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [proposals, paymentRails] = await Promise.all([
        this.api.list(),
        this.api.allocationOptions(),
      ]);
      this.proposals.set(proposals);
      this.paymentRails.set(paymentRails);
      if (!paymentRails.some((rail) => rail.id === this.paymentRail)) {
        this.paymentRail = paymentRails[0]?.id ?? 'XCH';
      }
      const active = proposals.find((proposal) => proposal.state === 'ACTIVE');
      if (active) {
        const result = await this.api.reconcile(active.id);
        this.storeChainResult(result);
        if (result.proposal.state === 'ACTIVE' && result.proposal.executionBundleId) {
          this.scheduleExecutionCheck(result.proposal.id);
        }
      }
      for (const sale of proposals.filter(
        (proposal) =>
          proposal.kind === 'SGT_SALE' &&
          proposal.state === 'EXECUTED' &&
          !['TAKEN', 'RETURNED'].includes(proposal.saleOffer?.status || ''),
      )) {
        this.storeChainResult(await this.api.reconcile(sale.id));
      }
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.loading.set(false);
    }
  }

  async createProposal(): Promise<void> {
    if (!this.formReady()) return;
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const common = {
        title: this.title.trim(),
        sgtAmount: this.sgtAmount.trim(),
        recipientVaultLauncherId: this.recipientVaultLauncherId.trim(),
      };
      const proposal =
        this.kind() === 'SGT_SALE'
          ? await this.createSaleProposal(common)
          : await this.api.create({
              kind: 'SGT_GRANT',
              ...common,
              grantId: randomHex32(),
              reasonHash: await sha256Hex(this.grantReason.trim()),
            });
      this.proposals.update((items) => [...items, proposal]);
      this.notice.set('Proposal saved. A coadministrator can now review it before voting opens.');
      this.resetForm();
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }

  async markReady(proposal: GovernanceProposalRecord): Promise<void> {
    await this.transition(proposal, 'READY', 'Proposal is ready for owner-plus-one approval.');
  }

  async cancel(proposal: GovernanceProposalRecord): Promise<void> {
    await this.transition(proposal, 'CANCELED', 'Draft canceled. No on-chain action occurred.');
  }

  coadminFor(proposal: GovernanceProposalRecord): number {
    return proposal.publicationCoadminSlot ?? this.coadmins()[proposal.id] ?? 1;
  }

  setCoadmin(proposal: GovernanceProposalRecord, value: number): void {
    this.coadmins.update((items) => ({ ...items, [proposal.id]: Number(value) }));
  }

  publicationFor(proposal: GovernanceProposalRecord): GovernancePublicationPackage | null {
    return this.publications()[proposal.id] ?? null;
  }

  async preparePublication(proposal: GovernanceProposalRecord): Promise<void> {
    await this.runPublication(async () => {
      const value = await this.api.package(proposal.id, this.coadminFor(proposal));
      this.setPublication(value);
      this.notice.set('The exact owner-plus-one approval steps are ready.');
    });
  }

  async signAction(
    proposal: GovernanceProposalRecord,
    action: GovernancePublicationAction,
    mode: 'browser' | 'mobile',
  ): Promise<void> {
    await this.runPublication(async () => {
      if (!this.wallet.isConnected()) {
        if (mode === 'browser') await this.wallet.connectInjected();
        else await this.wallet.connectWalletConnect();
      }
      const expected = computeAddress(action.signerPublicKey).toLowerCase();
      if (this.wallet.address()?.toLowerCase() !== expected) {
        throw new Error('Connect the administrator wallet named on this approval step.');
      }
      const signature = await this.wallet.signAuthorityV3ChiaAction(action.typedData, {
        coinId: action.coinId,
        delegatedPuzzleHash: action.delegatedPuzzleHash,
        compressedPubkey: action.signerPublicKey,
      });
      this.setPublication(
        await this.api.sign(
          proposal.id,
          this.coadminFor(proposal),
          action.actionId,
          signature,
        ),
      );
      this.notice.set('The exact proposal approval was recorded.');
    });
  }

  isOwnerWallet(publication: GovernancePublicationPackage): boolean {
    const owner = publication.actions.find((item) => item.signerSlot === 0);
    return !!owner && this.wallet.address()?.toLowerCase() === computeAddress(owner.signerPublicKey).toLowerCase();
  }

  async submitPublication(proposal: GovernanceProposalRecord): Promise<void> {
    await this.runPublication(async () => {
      const result = await this.api.submit(proposal.id, this.coadminFor(proposal));
      this.replaceProposal(result.proposal);
      this.publications.update((items) => {
        const next = { ...items };
        delete next[proposal.id];
        return next;
      });
      this.notice.set('Proposal observed in the Testnet11 mempool. Committee voting is open.');
    });
  }

  async reconcile(proposal: GovernanceProposalRecord): Promise<void> {
    await this.runPublication(async () => {
      const result = await this.api.reconcile(proposal.id);
      this.storeChainResult(result);
      this.notice.set(`Chain status: ${result.chainState.toLowerCase().replaceAll('_', ' ')}.`);
    });
  }

  async execute(proposal: GovernanceProposalRecord): Promise<void> {
    await this.runPublication(async () => {
      const result = await this.api.execute(proposal.id);
      this.storeChainResult(result);
      this.scheduleExecutionCheck(proposal.id);
      if (proposal.kind === 'FUNDED_REDEMPTION') {
        this.notice.set('The approved wUSDC.b allocation is in the Testnet11 mempool. Permanent SmartDeed offers appear after confirmation.');
      } else {
        this.notice.set(
          proposal.bill['paymentRail'] === 'XCH' || proposal.bill['paymentRail'] === 'WUSDC_B'
            ? 'The approved allocation is in the Testnet11 mempool. Its exact Chia offer will appear after confirmation.'
            : 'The approved allocation is in the Testnet11 mempool. External payment remains locked to its exact purchase artifact.',
        );
      }
    });
  }

  voteAmountFor(proposal: GovernanceProposalRecord): string {
    return this.voteAmounts()[proposal.id] ?? '';
  }

  setVoteAmount(proposal: GovernanceProposalRecord, value: string): void {
    this.voteAmounts.update((items) => ({ ...items, [proposal.id]: String(value) }));
  }

  positiveVoteAmount(proposal: GovernanceProposalRecord): boolean {
    return positiveInteger(this.voteAmountFor(proposal));
  }

  async castVote(proposal: GovernanceProposalRecord): Promise<void> {
    const amount = this.voteAmountFor(proposal).trim();
    if (!positiveInteger(amount)) return;
    await this.runPublication(async () => {
      const result = await this.vote.vote(proposal.id, amount);
      this.notice.set(
        `${result.voteAmount} SGT was locked for this vote and observed in the Testnet11 mempool. Network fee: ${result.feeMojos} mojos.`,
      );
    });
  }

  stateLabel(proposal: GovernanceProposalRecord): string {
    if (proposal.state === 'ACTIVE' && proposal.executionBundleId) return 'Finalizing';
    if (proposal.state === 'ACTIVE' && this.canExecute(proposal)) return 'Approved';
    return ({ DRAFT: 'Draft', READY: 'Ready', ACTIVE: 'Voting', EXECUTED: 'Executed', FAILED: 'Not passed', CANCELED: 'Canceled' })[proposal.state] ?? proposal.state;
  }

  chainResultFor(proposal: GovernanceProposalRecord): GovernanceChainResult | null {
    return this.chainResults()[proposal.id] ?? null;
  }

  canExecute(proposal: GovernanceProposalRecord): boolean {
    return this.chainResultFor(proposal)?.chainState === 'AWAITING_EXECUTE' && !proposal.executionBundleId;
  }

  chainHeading(state: string): string {
    return ({
      VOTING: 'Committee vote in progress',
      AWAITING_EXECUTE: 'Committee approved',
      AWAITING_EXPIRE: 'Vote did not reach quorum',
      EXECUTION_PENDING: 'Allocation submitted',
      EXECUTED: 'Allocation confirmed',
      FAILED: 'Proposal closed without allocation',
      MEMPOOL_OR_WAITING: 'Waiting for proposal confirmation',
    } as Record<string, string>)[state] ?? 'Chain status updated';
  }

  chainSummary(proposal: GovernanceProposalRecord, chain: GovernanceChainResult): string {
    if (chain.chainState === 'AWAITING_EXECUTE') {
      if (proposal.kind === 'FUNDED_REDEMPTION') {
        return `The vote passed. Fund the exact ${this.wusdc(String(proposal.bill['totalPaymentAmount']))} allocation across ${proposal.bill['deedCount']} SmartDeeds.`;
      }
      return `The vote passed. Finalize the exact ${proposal.bill['sgtAmount']} SGT allocation; no new approval or destination can be added.`;
    }
    if (chain.chainState === 'EXECUTION_PENDING') {
      return 'The exact reserve allocation was observed in the mempool. This page will confirm its output coins on the next check.';
    }
    if (chain.chainState === 'VOTING') {
      const votes = chain.voteTally ? `${chain.voteTally} SGT counted` : 'Votes are being counted';
      const deadline = chain.votingDeadline ? new Date(chain.votingDeadline * 1000).toLocaleString() : 'the on-chain deadline';
      return `${votes}. Voting closes at ${deadline}.`;
    }
    return 'The status is reconstructed from the confirmed governance tracker and allocation output coins.';
  }

  proposalSummary(proposal: GovernanceProposalRecord): string {
    if (proposal.kind === 'FUNDED_REDEMPTION') {
      return `${this.wusdc(String(proposal.bill['totalPaymentAmount']))} · ${proposal.bill['deedCount']} permanent SmartDeed offers`;
    }
    return `${proposal.bill['sgtAmount']} SGT · ${proposal.kind === 'SGT_SALE' ? this.saleSummary(proposal) : 'governed grant'}`;
  }

  wusdc(value: string): string {
    return `${formatAssetUnits(value, 3)} wUSDC.b`;
  }

  saleSummary(proposal: GovernanceProposalRecord): string {
    const amount = String(proposal.bill['paymentAmount'] || '0');
    const rail = String(proposal.bill['paymentRail'] || 'XCH');
    if (rail === 'WUSDC_B') return `${formatAssetUnits(amount, 3)} wUSDC.b company proceeds`;
    if (rail === 'STRIPE') return `$${formatAssetUnits(amount, 2)} through Stripe`;
    if (rail === 'BASE_USDC') return `${formatAssetUnits(amount, 6)} USDC on Base Sepolia`;
    return `${formatAssetUnits(amount, 12)} XCH company proceeds`;
  }

  saleStatusLabel(status: NonNullable<GovernanceProposalRecord['saleOffer']>['status']): string {
    return ({
      AVAILABLE: 'Offer ready for the approved buyer',
      PENDING: 'Buyer transaction in the mempool',
      TAKEN: 'Payment and SGT delivery confirmed',
      EXPIRED: 'Offer window ended',
      RETURNED: 'Unsold SGT returned to the reserve',
    } as const)[status];
  }

  saleStatusSummary(proposal: GovernanceProposalRecord): string {
    const sale = proposal.saleOffer;
    if (!sale) return '';
    if (sale.status === 'AVAILABLE') {
      return `The immutable offer collects ${this.saleSummary(proposal)} and delivers ${proposal.bill['sgtAmount']} SGT to the approved protocol vault.`;
    }
    if (sale.status === 'PENDING') {
      return 'A spend of the exact sale coin is visible in the mempool. Wait for chain confirmation before treating the sale as complete.';
    }
    if (sale.status === 'TAKEN') {
      return 'The exact payment and recipient output were confirmed on Testnet11.';
    }
    if (sale.status === 'EXPIRED') {
      return 'This offer can no longer be accepted. The unchanged allocation remains recoverable to the governed reserve.';
    }
    return 'The sale coin was returned to the governed company reserve without changing its amount.';
  }

  async copySaleOffer(proposal: GovernanceProposalRecord): Promise<void> {
    const offer = proposal.saleOffer?.offerFile;
    if (!offer) return;
    try {
      await navigator.clipboard.writeText(offer);
      this.notice.set('The exact governed offer is copied and ready for the approved buyer.');
    } catch {
      this.error.set('Your browser blocked clipboard access. Allow clipboard permission and try again.');
    }
  }

  shortAddress(value: string): string {
    const clean = value.trim();
    return clean.length > 18 ? `${clean.slice(0, 10)}…${clean.slice(-7)}` : clean || 'Not entered';
  }

  paymentRailLabel(): string {
    return this.paymentRails().find((rail) => rail.id === this.paymentRail)?.label ?? this.paymentRail;
  }

  setPaymentRail(value: SgtSalePaymentRail): void {
    this.paymentRail = value;
    this.expiresLocal = saleExpiry(value);
  }

  expiryHelp(): string {
    if (this.paymentRail === 'STRIPE') {
      return 'The 11-to-14-day window allows a pending ACH payment to settle. Card payments use the same governed deadline.';
    }
    if (this.paymentRail === 'BASE_USDC') {
      return 'Base USDC quotes remain available for no more than 30 minutes.';
    }
    return 'Unsold SGT returns to the governed reserve after this time.';
  }

  paymentHelp(): string {
    return this.isExternalRail()
      ? 'Enter the approved USD price. The server adds the 1% protocol fee and derives the exact Stripe or Base amount.'
      : 'The exact payment and SGT delivery settle together in one Chia offer.';
  }

  settlementExplanation(): string {
    return this.isExternalRail()
      ? 'Delivery uses the existing 2-of-3 external-payment receipt and the same protected vault boundary as SmartDeeds.'
      : 'Payment and SGT delivery occur atomically through the generated Chia offer.';
  }

  private async transition(
    proposal: GovernanceProposalRecord,
    target: 'READY' | 'CANCELED',
    notice: string,
  ): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const updated = await this.api.transition(proposal, target);
      this.proposals.update((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      this.notice.set(notice);
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }

  private resetForm(): void {
    this.title = '';
    this.sgtAmount = '';
    this.recipientVaultLauncherId = '';
    this.paymentAmount = '';
    this.grantReason = '';
    this.expiresLocal = defaultExpiry();
  }

  private async createSaleProposal(common: {
    title: string;
    sgtAmount: string;
    recipientVaultLauncherId: string;
  }): Promise<GovernanceProposalRecord> {
    const saleId = randomHex32();
    const expiresAt = Math.floor(Date.parse(this.expiresLocal) / 1000);
    const amount = this.paymentToUnits();
    if (amount === null) throw new Error('Enter a valid sale price.');
    if (this.isExternalRail()) {
      return this.api.create({
        kind: 'SGT_SALE',
        ...common,
        saleId,
        paymentRail: this.paymentRail as 'STRIPE' | 'BASE_USDC',
        baseUsdAmountMinor: amount,
        expiresAt,
      });
    }
    return this.api.create({
      kind: 'SGT_SALE',
      ...common,
      saleId,
      paymentRail: this.paymentRail as 'XCH' | 'WUSDC_B',
      paymentAmount: amount,
      expiresAt,
    });
  }

  private setPublication(value: GovernancePublicationPackage): void {
    this.publications.update((items) => ({ ...items, [value.proposal.id]: value }));
    this.replaceProposal(value.proposal);
  }

  private replaceProposal(value: GovernanceProposalRecord): void {
    this.proposals.update((items) => items.map((item) => (item.id === value.id ? value : item)));
  }

  private storeChainResult(value: GovernanceChainResult): void {
    this.replaceProposal(value.proposal);
    this.chainResults.update((items) => ({ ...items, [value.proposal.id]: value }));
  }

  private scheduleExecutionCheck(proposalId: string, attempt = 0): void {
    const existing = this.executionPolls.get(proposalId);
    if (existing) clearTimeout(existing);
    if (attempt >= 30) return;
    const timer = setTimeout(async () => {
      this.executionPolls.delete(proposalId);
      const current = this.proposals().find((item) => item.id === proposalId);
      if (!current || current.state !== 'ACTIVE') return;
      try {
        const result = await this.api.reconcile(proposalId);
        this.storeChainResult(result);
        if (result.proposal.state === 'ACTIVE') {
          this.scheduleExecutionCheck(proposalId, attempt + 1);
        } else if (result.proposal.kind === 'FUNDED_REDEMPTION') {
          this.notice.set('The settlement is confirmed and permanent wUSDC.b offers are available to the approved SmartDeed vaults.');
        } else if (result.proposal.kind === 'SGT_SALE') {
          this.notice.set(
            result.proposal.bill['paymentRail'] === 'XCH' || result.proposal.bill['paymentRail'] === 'WUSDC_B'
              ? 'The allocation is confirmed and its exact Chia offer is ready.'
              : 'The allocation is confirmed and ready for its exact external payment receipt.',
          );
        }
      } catch (error) {
        this.error.set(formatError(error));
      }
    }, 8_000);
    this.executionPolls.set(proposalId, timer);
  }

  private async runPublication(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(formatError(error));
    } finally {
      this.busy.set(false);
    }
  }

  private paymentToUnits(): string | null {
    const selected = this.paymentRails().find((rail) => rail.id === this.paymentRail);
    const decimals = selected?.serverPriced ? 2 : selected?.decimals;
    return decimals === undefined ? null : decimalToUnits(this.paymentAmount, decimals);
  }

  private isExternalRail(): boolean {
    return this.paymentRail === 'STRIPE' || this.paymentRail === 'BASE_USDC';
  }
}

function positiveInteger(value: string): boolean {
  return /^(?:[1-9][0-9]*)$/.test(value.trim());
}

function decimalToUnits(value: string, decimals: number): string | null {
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimals}}))?$`).exec(value.trim());
  if (!match) return null;
  const scale = 10n ** BigInt(decimals);
  const result = BigInt(match[1]) * scale + BigInt((match[2] || '').padEnd(decimals, '0'));
  return result > 0n && result < 2n ** 64n ? result.toString() : null;
}

function formatAssetUnits(value: string, decimals: number): string {
  try {
    const units = BigInt(value);
    const scale = 10n ** BigInt(decimals);
    const whole = units / scale;
    const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return value;
  }
}

function randomHex32(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `0x${Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('')}`;
}

function defaultExpiry(): string {
  const value = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  value.setSeconds(0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function externalExpiry(): string {
  const value = new Date(Date.now() + 20 * 60 * 1000);
  value.setSeconds(0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function stripeExpiry(): string {
  const value = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
  value.setSeconds(0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function saleExpiry(rail: SgtSalePaymentRail): string {
  if (rail === 'STRIPE') return stripeExpiry();
  if (rail === 'BASE_USDC') return externalExpiry();
  return defaultExpiry();
}
