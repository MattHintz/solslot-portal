import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PropertyDossierComponent } from '../../../components/property-dossier/property-dossier.component';
import { AdminSessionService } from '../../../services/admin-session.service';
import {
  CollectionApiService,
  CollectionAsset,
  CollectionDeed,
  CollectionFeatureStatus,
  CollectionWorkspace,
} from '../../../services/collection-api.service';
import {
  CollectionMintCoordinatorService,
  CollectionMintPreview,
} from '../../../services/collection-mint-coordinator.service';
import { PublishRunResult } from '../../../services/mint-proposal-v2/mint-proposal-v2-publish-runner.service';
import { PropertyAmendmentService } from '../../../services/property-amendment.service';
import {
  PROPERTY_DOSSIER_SCHEMA,
  PropertyDossierDraftV1,
  PropertyDossierV1,
} from '../../../services/property-metadata/property-dossier';
import { formatError } from '../../../utils/format-error';

type EditorSection =
  | 'overview'
  | 'property'
  | 'media'
  | 'economics'
  | 'operations'
  | 'legal'
  | 'risks'
  | 'documents'
  | 'allocation'
  | 'review'
  | 'governance';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

@Component({
  selector: 'pp-collection-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PropertyDossierComponent],
  template: `
    <main class="editor-shell">
      @if (loading()) {
        <div class="page-state mono">Loading shared collection workspace…</div>
      } @else if (loadError()) {
        <section class="page-state page-state--error">
          <strong>Collection could not be loaded</strong>
          <span>{{ loadError() }}</span>
          <a routerLink="/admin/collections" class="btn btn--ghost">Back to collections</a>
        </section>
      } @else if (workspace(); as collection) {
        @if (draftModel; as draft) {
          <header class="editor-header">
            <div class="title-block">
              <a routerLink="/admin/collections">Collections</a>
              <div>
                <span class="state" [attr.data-state]="collection.state">{{ collection.state }}</span>
                <h1>{{ draft.title }}</h1>
                <p class="mono">{{ collection.id }} · revision {{ collection.revision }}</p>
              </div>
            </div>
            <div class="header-actions">
              <span class="save-state" [attr.data-state]="saveState()">{{ saveLabel() }}</span>
              <button type="button" class="btn btn--ghost" (click)="reload()">Refresh</button>
              @if (canEdit()) {
                <button type="button" class="btn btn--primary" (click)="saveNow(false, true)">Save</button>
              }
            </div>
          </header>

          @if (saveState() === 'conflict') {
            <section class="conflict-bar">
              <div><strong>Another browser saved a newer revision.</strong><span>Your unsaved fields are still here.</span></div>
              <button type="button" (click)="resolveConflict('reload')">Load server revision</button>
              <button type="button" (click)="resolveConflict('overwrite')">Apply my edits to latest</button>
            </section>
          }

          <div class="editor-layout">
            <nav class="section-nav" aria-label="Collection workspace sections">
              @for (item of sections; track item.id) {
                <button
                  type="button"
                  [class.is-active]="activeSection() === item.id"
                  [class.has-issues]="sectionIssueCount(item.id) > 0"
                  (click)="activeSection.set(item.id)"
                >
                  <span>{{ item.label }}</span>
                  @if (sectionIssueCount(item.id)) { <small>{{ sectionIssueCount(item.id) }}</small> }
                </button>
              }
            </nav>

            <section class="editor-main">
              @switch (activeSection()) {
                @case ('overview') {
                  <div class="section-head"><span>Collection</span><h2>Overview</h2></div>
                  <fieldset [disabled]="!canEdit()">
                    <label class="full">Property title<input type="text" [(ngModel)]="draft.title" (ngModelChange)="changed()" maxlength="180" /></label>
                    <label class="full">Investor summary<textarea rows="8" [(ngModel)]="draft.summary" (ngModelChange)="changed()" maxlength="4000"></textarea></label>
                  </fieldset>
                  <aside class="section-note"><strong>Owner</strong><span class="mono">{{ collection.ownerSubject }}</span></aside>
                }

                @case ('property') {
                  <div class="section-head"><span>Asset identity</span><h2>Property</h2></div>
                  <fieldset [disabled]="!canEdit()">
                    <label class="span-2">Street address<input type="text" [(ngModel)]="draft.property!.address.line1" (ngModelChange)="changed()" /></label>
                    <label>Unit / suite<input type="text" [(ngModel)]="draft.property!.address.line2" (ngModelChange)="changed()" /></label>
                    <label>City<input type="text" [(ngModel)]="draft.property!.address.city" (ngModelChange)="changed()" /></label>
                    <label>State / region<input type="text" [(ngModel)]="draft.property!.address.region" (ngModelChange)="changed()" /></label>
                    <label>Postal code<input type="text" [(ngModel)]="draft.property!.address.postalCode" (ngModelChange)="changed()" /></label>
                    <label>Country code<input type="text" [(ngModel)]="draft.property!.address.country" (ngModelChange)="changed()" maxlength="2" /></label>
                    <label>Property type<input type="text" [(ngModel)]="draft.property!.propertyType" (ngModelChange)="changed()" /></label>
                    <label>Year built<input type="number" [(ngModel)]="draft.property!.yearBuilt" (ngModelChange)="changed()" /></label>
                    <label>Bedrooms<input type="text" [(ngModel)]="draft.property!.bedrooms" (ngModelChange)="changed()" /></label>
                    <label>Bathrooms<input type="text" [(ngModel)]="draft.property!.bathrooms" (ngModelChange)="changed()" /></label>
                    <label>Interior square feet<input type="text" [(ngModel)]="draft.property!.interiorSquareFeet" (ngModelChange)="changed()" /></label>
                    <label>Lot square feet<input type="text" [(ngModel)]="draft.property!.lotSquareFeet" (ngModelChange)="changed()" /></label>
                    <label>Latitude<input type="text" [(ngModel)]="draft.property!.latitude" (ngModelChange)="changed()" /></label>
                    <label>Longitude<input type="text" [(ngModel)]="draft.property!.longitude" (ngModelChange)="changed()" /></label>
                  </fieldset>
                }

                @case ('media') {
                  <div class="section-head"><span>Verified assets</span><h2>Property media</h2></div>
                  @if (canEdit()) {
                    <div class="upload-strip">
                      <label>Role<select [(ngModel)]="mediaRole"><option value="hero">Hero</option><option value="gallery">Gallery</option><option value="floorplan">Floor plan</option><option value="other">Other</option></select></label>
                      <label class="span-2">Alt text<input type="text" [(ngModel)]="mediaAlt" /></label>
                      <label class="file-control">Image<input type="file" accept="image/*" (change)="uploadMedia($event)" [disabled]="mediaUploading()" /></label>
                    </div>
                  }
                  @if (mediaError()) { <p class="inline-error">{{ mediaError() }}</p> }
                  <div class="asset-table">
                    @for (asset of draft.media; track asset.assetId) {
                      <article>
                        <div><strong>{{ asset.alt }}</strong><span>{{ asset.role }} · {{ asset.mimeType || 'upload pending' }}</span></div>
                        <span class="asset-state" [attr.data-state]="assetStatus(asset.assetId)?.state">{{ assetStatus(asset.assetId)?.state || 'DRAFT' }}</span>
                        @if (canEdit()) { <button type="button" (click)="removeMedia($index)">Remove</button> }
                      </article>
                    } @empty { <p class="empty-row">No media uploaded.</p> }
                  </div>
                }

                @case ('economics') {
                  <div class="section-head"><span>Decision-grade figures</span><h2>Economics</h2></div>
                  <fieldset [disabled]="!canEdit()">
                    <h3>Valuation</h3>
                    <label>As-of date<input type="date" [(ngModel)]="draft.valuation!.asOfDate" (ngModelChange)="changed()" /></label>
                    <label>Market value, minor units<input type="text" inputmode="numeric" [(ngModel)]="draft.valuation!.marketValueMinor" (ngModelChange)="changed()" /></label>
                    <label>Currency<input type="text" [(ngModel)]="draft.valuation!.currency" (ngModelChange)="changed()" maxlength="3" /></label>
                    <label>Method<input type="text" [(ngModel)]="draft.valuation!.method" (ngModelChange)="changed()" /></label>
                    <label class="span-2">Source<input type="text" [(ngModel)]="draft.valuation!.source" (ngModelChange)="changed()" /></label>
                    <h3>Offering terms</h3>
                    <label>Target raise, minor units<input type="text" inputmode="numeric" [(ngModel)]="draft.offering!.targetRaiseMinor" (ngModelChange)="changed()" /></label>
                    <label>Currency<input type="text" [(ngModel)]="draft.offering!.currency" (ngModelChange)="changed()" maxlength="3" /></label>
                    <label>Collection par, mojos<input type="text" inputmode="numeric" [(ngModel)]="draft.offering!.parValueMojos" (ngModelChange)="changed()" /></label>
                    <label>Minimum investment, minor units<input type="text" inputmode="numeric" [(ngModel)]="draft.offering!.minimumInvestmentMinor" (ngModelChange)="changed()" /></label>
                    <label>Projected return, bps<input type="text" inputmode="numeric" [(ngModel)]="draft.offering!.projectedReturnBps" (ngModelChange)="changed()" /></label>
                    <label>Term, months<input type="text" inputmode="numeric" [(ngModel)]="draft.offering!.termMonths" (ngModelChange)="changed()" /></label>
                    <label>Asset class<input type="text" [(ngModel)]="draft.offering!.assetClass" (ngModelChange)="changed()" placeholder="RWA-RE-RES" /></label>
                    <label>Jurisdiction<input type="text" [(ngModel)]="draft.offering!.jurisdiction" (ngModelChange)="changed()" placeholder="US-TX" /></label>
                    <label class="span-2">Royalty puzzle hash<input class="mono" type="text" [(ngModel)]="draft.offering!.royaltyPuzhash" (ngModelChange)="changed()" placeholder="0x…" /></label>
                    <label>Royalty, bps<input type="text" inputmode="numeric" [(ngModel)]="draft.offering!.royaltyBps" (ngModelChange)="changed()" /></label>
                    <label>Governance quorum, SGT mojos<input type="text" inputmode="numeric" [(ngModel)]="draft.offering!.governanceQuorum" (ngModelChange)="changed()" /></label>
                    <h3>Capital</h3>
                    <label>Debt balance, minor units<input type="text" inputmode="numeric" [(ngModel)]="draft.capital!.debtBalanceMinor" (ngModelChange)="changed()" /></label>
                    <label>Debt rate, bps<input type="text" inputmode="numeric" [(ngModel)]="draft.capital!.debtRateBps" (ngModelChange)="changed()" /></label>
                    <label>Debt maturity<input type="date" [(ngModel)]="draft.capital!.debtMaturityDate" (ngModelChange)="changed()" /></label>
                    <label>Debt currency<input type="text" [(ngModel)]="draft.capital!.currency" (ngModelChange)="changed()" maxlength="3" /></label>
                  </fieldset>
                }

                @case ('operations') {
                  <div class="section-head"><span>Property performance</span><h2>Operations</h2></div>
                  <fieldset [disabled]="!canEdit()">
                    <label>Occupancy status<input type="text" [(ngModel)]="draft.operations!.occupancyStatus" (ngModelChange)="changed()" /></label>
                    <label>Manager<input type="text" [(ngModel)]="draft.operations!.manager" (ngModelChange)="changed()" /></label>
                    <label>Monthly gross rent, minor units<input type="text" inputmode="numeric" [(ngModel)]="draft.operations!.monthlyGrossRentMinor" (ngModelChange)="changed()" /></label>
                    <label>Annual operating expense, minor units<input type="text" inputmode="numeric" [(ngModel)]="draft.operations!.annualOperatingExpenseMinor" (ngModelChange)="changed()" /></label>
                    <label>Currency<input type="text" [(ngModel)]="draft.operations!.currency" (ngModelChange)="changed()" maxlength="3" /></label>
                    <label class="span-2">Lease summary<textarea rows="7" [(ngModel)]="draft.operations!.leaseSummary" (ngModelChange)="changed()"></textarea></label>
                    <h3>Planned uses</h3>
                    @for (use of draft.capital!.plannedUses; track $index) {
                      <label>Use<input type="text" [(ngModel)]="use.label" (ngModelChange)="changed()" /></label>
                      <label>Amount, minor units<input type="text" inputmode="numeric" [(ngModel)]="use.amountMinor" (ngModelChange)="changed()" /></label>
                      <button class="row-remove" type="button" (click)="removePlannedUse($index)">Remove use</button>
                    }
                    <button class="row-add" type="button" (click)="addPlannedUse()">Add planned use</button>
                  </fieldset>
                }

                @case ('legal') {
                  <div class="section-head"><span>Rights and collateral</span><h2>Legal structure</h2></div>
                  <fieldset [disabled]="!canEdit()">
                    <label class="span-2">Issuer legal name<input type="text" [(ngModel)]="draft.legal!.issuerLegalName" (ngModelChange)="changed()" /></label>
                    <label>Security structure<input type="text" [(ngModel)]="draft.legal!.securityStructure" (ngModelChange)="changed()" /></label>
                    <label>Filing status<input type="text" [(ngModel)]="draft.legal!.filingStatus" (ngModelChange)="changed()" /></label>
                    <label class="span-2">Filing reference<input type="text" [(ngModel)]="draft.legal!.filingReference" (ngModelChange)="changed()" /></label>
                    <label class="span-2">Collateral summary<textarea rows="6" [(ngModel)]="draft.legal!.collateralSummary" (ngModelChange)="changed()"></textarea></label>
                    <label class="span-2">Priority description<textarea rows="4" [(ngModel)]="draft.legal!.priorityDescription" (ngModelChange)="changed()"></textarea></label>
                    <label>Settlement basis<input type="text" [(ngModel)]="draft.legal!.settlementBasis" (ngModelChange)="changed()" /></label>
                    <label class="span-2">Transfer policy<textarea rows="6" [(ngModel)]="draft.legal!.transferPolicy" (ngModelChange)="changed()"></textarea></label>
                  </fieldset>
                }

                @case ('risks') {
                  <div class="section-head"><span>Investor review</span><h2>Risk register</h2></div>
                  <fieldset class="stacked" [disabled]="!canEdit()">
                    @for (risk of draft.risks; track $index) {
                      <article class="repeat-row">
                        <div class="field-grid">
                          <label>Risk ID<input type="text" [(ngModel)]="risk.riskId" (ngModelChange)="changed()" /></label>
                          <label>Severity<select [(ngModel)]="risk.severity" (ngModelChange)="changed()"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
                          <label class="span-2">Title<input type="text" [(ngModel)]="risk.title" (ngModelChange)="changed()" /></label>
                          <label class="span-2">Detail<textarea rows="5" [(ngModel)]="risk.detail" (ngModelChange)="changed()"></textarea></label>
                        </div>
                        <button type="button" (click)="removeRisk($index)">Remove risk</button>
                      </article>
                    } @empty { <p class="empty-row">No risks entered.</p> }
                    <button class="row-add" type="button" (click)="addRisk()">Add risk</button>
                  </fieldset>
                }

                @case ('documents') {
                  <div class="section-head"><span>Evidence package</span><h2>Documents and sources</h2></div>
                  @if (canEdit()) {
                    <div class="upload-strip">
                      <label class="span-2">Document title<input type="text" [(ngModel)]="documentTitle" /></label>
                      <label>Category<input type="text" [(ngModel)]="documentCategory" /></label>
                      <label class="file-control">File<input type="file" accept="application/pdf,image/*" (change)="uploadDocument($event)" [disabled]="documentUploading()" /></label>
                    </div>
                  }
                  @if (documentError()) { <p class="inline-error">{{ documentError() }}</p> }
                  <div class="asset-table">
                    @for (asset of draft.documents; track asset.assetId) {
                      <article><div><strong>{{ asset.title }}</strong><span>{{ asset.category }} · {{ asset.mimeType || 'upload pending' }}</span></div><span class="asset-state" [attr.data-state]="assetStatus(asset.assetId)?.state">{{ assetStatus(asset.assetId)?.state || 'DRAFT' }}</span>@if (canEdit()) { <button type="button" (click)="removeDocument($index)">Remove</button> }</article>
                    } @empty { <p class="empty-row">No documents uploaded.</p> }
                  </div>
                  <fieldset class="stacked" [disabled]="!canEdit()">
                    <h3>Disclosures</h3>
                    @for (disclosure of draft.disclosures; track $index) {
                      <div class="inline-row"><textarea rows="2" [(ngModel)]="draft.disclosures[$index]" (ngModelChange)="changed()"></textarea><button type="button" (click)="removeDisclosure($index)">Remove</button></div>
                    }
                    <button class="row-add" type="button" (click)="addDisclosure()">Add disclosure</button>
                    <h3>Data sources</h3>
                    @for (source of draft.dataSources; track $index) {
                      <article class="repeat-row"><div class="field-grid"><label>Name<input type="text" [(ngModel)]="source.name" (ngModelChange)="changed()" /></label><label>As-of date<input type="date" [(ngModel)]="source.asOfDate" (ngModelChange)="changed()" /></label><label class="span-2">HTTPS URL<input type="url" [(ngModel)]="source.url" (ngModelChange)="changed()" /></label></div><button type="button" (click)="removeSource($index)">Remove source</button></article>
                    }
                    <button class="row-add" type="button" (click)="addSource()">Add data source</button>
                    <h3>Property history</h3>
                    @for (event of draft.history; track $index) {
                      <article class="repeat-row"><div class="field-grid"><label>Date<input type="date" [(ngModel)]="event.date" (ngModelChange)="changed()" /></label><label>Title<input type="text" [(ngModel)]="event.title" (ngModelChange)="changed()" /></label><label class="span-2">Detail<textarea rows="3" [(ngModel)]="event.detail" (ngModelChange)="changed()"></textarea></label></div><button type="button" (click)="removeHistory($index)">Remove event</button></article>
                    }
                    <button class="row-add" type="button" (click)="addHistory()">Add history event</button>
                  </fieldset>
                }

                @case ('allocation') {
                  <div class="section-head"><span>Immutable after first proposal</span><h2>Deed allocation</h2></div>
                  <div class="allocation-total" [class.is-complete]="allocationTotal() === 1000000"><strong>{{ allocationTotal() | number }} ppm</strong><span>{{ allocationTotal() === 1000000 ? 'Complete' : 'Must equal 1,000,000 ppm' }}</span></div>
                  <fieldset class="stacked" [disabled]="!canEdit() || collection.allocationLocked">
                    @for (deed of draft.deedAllocation; track $index) {
                      <article class="repeat-row allocation-row">
                        <div class="field-grid"><label>Deed ID<input class="mono" type="text" [(ngModel)]="deed.deedId" (ngModelChange)="changed()" /></label><label>Share, ppm<input type="number" min="1" max="1000000" [(ngModel)]="deed.sharePpm" (ngModelChange)="changed()" /></label><label class="span-2">Par value, mojos<input type="text" inputmode="numeric" [(ngModel)]="deed.parValueMojos" (ngModelChange)="changed()" /></label></div>
                        <button type="button" (click)="removeDeed($index)">Remove deed</button>
                      </article>
                    } @empty { <p class="empty-row">No SmartDeeds planned.</p> }
                    <button class="row-add" type="button" (click)="addDeed()">Add SmartDeed</button>
                  </fieldset>
                  @if (collection.allocationLocked) { <aside class="section-note"><strong>Allocation locked</strong><span>The first governed proposal fixed this issuance plan.</span></aside> }
                }

                @case ('review') {
                  <div class="section-head"><span>Publication gate</span><h2>Review and seal</h2></div>
                  <div class="readiness" [class.is-ready]="collection.readiness.ready"><strong>{{ collection.readiness.ready ? 'Ready to seal' : collection.readiness.issues.length + ' checks remain' }}</strong><span>{{ collection.readiness.canonicalByteSize || 0 | number }} / {{ feature()?.maxCanonicalBytes || 24576 | number }} canonical bytes</span></div>
                  @if (collection.readiness.issues.length) {
                    <div class="issue-list">@for (issue of collection.readiness.issues; track $index) { <button type="button" (click)="openIssue(issue.path)"><strong>{{ issue.message }}</strong><span class="mono">{{ issue.path }}</span></button> }</div>
                  }
                  <div class="review-actions">
                    @if (canEdit()) { <button class="btn btn--ghost" type="button" (click)="submitForReview()">Submit for review</button> }
                    @if (isOwner() && (collection.state === 'DRAFT' || collection.state === 'REVIEW')) { <button class="btn btn--primary" type="button" (click)="seal()" [disabled]="!collection.readiness.ready || sealing()">{{ sealing() ? 'Sealing…' : 'Seal immutable dossier' }}</button> }
                    @if (sealError()) { <span class="inline-error">{{ sealError() }}</span> }
                  </div>
                  <section class="comments">
                    <div class="section-head section-head--small"><span>Team review</span><h2>Comments</h2></div>
                    @for (comment of collection.comments; track comment.id) {
                      <article [class.is-resolved]="comment.resolved"><div><strong>{{ comment.section }}</strong><span class="mono">{{ comment.actorSubject }}</span></div><p>{{ comment.body }}</p>@if (!comment.resolved) { <button type="button" (click)="resolveComment(comment.id)">Resolve</button> }</article>
                    }
                    <div class="comment-form"><textarea rows="3" [(ngModel)]="commentBody" placeholder="Add a review comment"></textarea><button type="button" (click)="addComment()" [disabled]="!commentBody.trim()">Comment</button></div>
                  </section>
                  <div class="preview-band"><pp-property-dossier [workspace]="previewWorkspace()" /></div>
                }

                @case ('governance') {
                  <div class="section-head"><span>RC16 governed issuance</span><h2>Governance status</h2></div>
                  @if (collection.state === 'DRAFT' || collection.state === 'REVIEW') {
                    <section class="locked-state"><strong>Seal the dossier first</strong><span>Proposal hashes cannot be prepared from mutable metadata.</span></section>
                  } @else {
                    <dl class="commitment-grid"><div><dt>Metadata root</dt><dd class="mono">{{ collection.metadataRoot }}</dd></div><div><dt>Anchor ID</dt><dd class="mono">{{ collection.metadataAnchorId || 'Assigned by first proposal' }}</dd></div><div><dt>Payload</dt><dd>{{ collection.canonicalByteSize | number }} bytes</dd></div><div><dt>Network</dt><dd>{{ feature()?.network || 'testnet11' }}</dd></div></dl>
                    <div class="wallet-binding"><div><strong>Owner signing member</strong><span class="mono">{{ ownerMemberHash() || 'Not derived' }}</span></div><button type="button" (click)="deriveOwnerHash()" [disabled]="ownerHashBusy()">{{ ownerHashBusy() ? 'Deriving…' : 'Derive from wallet' }}</button></div>
                    @if (governanceError()) { <p class="inline-error">{{ governanceError() }}</p> }
                    <div class="proposal-list">
                      @for (deed of collection.deeds; track deed.deedId) {
                        <article>
                          <div><strong class="mono">{{ deed.deedId }}</strong><span>{{ deed.sharePpm | number }} ppm · {{ deed.proposalState }}</span></div>
                          @if (deed.proposalId) { <a [routerLink]="['/admin/mint', deed.proposalId]">Open proposal</a> } @else { <button type="button" (click)="prepareProposal(deed)" [disabled]="!ownerMemberHash() || proposalBusy()">Review proposal</button> }
                        </article>
                      }
                    </div>
                    @if (mintPreview(); as preview) {
                      <section class="sign-review">
                        <div class="section-head section-head--small"><span>Wallet signing review</span><h2>{{ preview.deedId }}</h2></div>
                        <dl class="commitment-grid"><div><dt>Proposal ID</dt><dd class="mono">{{ preview.proposalId }}</dd></div><div><dt>Metadata root</dt><dd class="mono">{{ preview.metadataRoot }}</dd></div><div><dt>Anchor</dt><dd class="mono">{{ preview.metadataAnchorId || 'This deed launcher' }}</dd></div><div><dt>Payload</dt><dd>{{ preview.canonicalByteSize | number }} bytes</dd></div><div><dt>Estimated consensus cost</dt><dd>{{ preview.estimatedConsensusCost | number }} cost units</dd></div><div><dt>Governance threshold</dt><dd>{{ preview.governanceThreshold | number }} SGT mojos</dd></div><div><dt>Network</dt><dd>{{ preview.network }}</dd></div><div><dt>Wallet</dt><dd class="mono">{{ preview.walletSubject }}</dd></div></dl>
                        <button class="btn btn--primary" type="button" (click)="publishProposal()" [disabled]="proposalBusy()">{{ proposalBusy() ? 'Waiting for wallet…' : 'Sign and publish proposal' }}</button>
                      </section>
                    }
                    @if (publishResult(); as result) { <section class="publish-result" [attr.data-kind]="result.kind"><strong>{{ publishResultTitle(result) }}</strong><span>{{ publishResultDetail(result) }}</span></section> }
                    @if (collection.anchorEvidence.length) { <button class="btn btn--ghost" type="button" (click)="refreshEvidence()">Refresh chain reconstruction</button> }
                    @if (collection.state === 'PUBLISHED' && isOwner()) {
                      <section class="amendment-panel">
                        <div class="section-head section-head--small"><span>Owner-signed, not SGT-governed</span><h2>Operational update</h2></div>
                        @if (!amendmentOpen()) {
                          <button class="btn btn--ghost" type="button" (click)="openAmendment()">Draft operational update</button>
                        } @else {
                          <div class="field-grid">
                            <label class="span-2">Investor summary<textarea rows="4" [(ngModel)]="amendmentForm.summary"></textarea></label>
                            <label>Valuation as-of date<input type="date" [(ngModel)]="amendmentForm.valuationAsOfDate" /></label>
                            <label>Market value, minor units<input type="text" inputmode="numeric" [(ngModel)]="amendmentForm.marketValueMinor" /></label>
                            <label>Valuation method<input type="text" [(ngModel)]="amendmentForm.valuationMethod" /></label>
                            <label>Valuation source<input type="text" [(ngModel)]="amendmentForm.valuationSource" /></label>
                            <label>Occupancy status<input type="text" [(ngModel)]="amendmentForm.occupancyStatus" /></label>
                            <label>Manager<input type="text" [(ngModel)]="amendmentForm.manager" /></label>
                            <label>Monthly gross rent, minor units<input type="text" inputmode="numeric" [(ngModel)]="amendmentForm.monthlyGrossRentMinor" /></label>
                            <label>Annual operating expense, minor units<input type="text" inputmode="numeric" [(ngModel)]="amendmentForm.annualOperatingExpenseMinor" /></label>
                            <label class="span-2">Lease summary<textarea rows="4" [(ngModel)]="amendmentForm.leaseSummary"></textarea></label>
                            <label>Effective date<input type="date" [(ngModel)]="amendmentForm.effectiveDate" /></label>
                            <label class="span-2">Reason<textarea rows="3" [(ngModel)]="amendmentForm.reason"></textarea></label>
                          </div>
                          @if (amendmentError()) { <p class="inline-error">{{ amendmentError() }}</p> }
                          <div class="review-actions"><button class="btn btn--ghost" type="button" (click)="amendmentOpen.set(false)">Cancel</button><button class="btn btn--primary" type="button" (click)="publishAmendment()" [disabled]="amendmentBusy()">{{ amendmentBusy() ? 'Waiting for owner signature…' : 'Sign and append update' }}</button></div>
                        }
                      </section>
                    }
                  }
                }
              }
            </section>

            <aside class="review-rail">
              <div><span class="rail-label">Readiness</span><strong>{{ collection.readiness.ready ? 'Ready' : collection.readiness.issues.length + ' checks' }}</strong></div>
              <div><span class="rail-label">Allocation</span><strong>{{ allocationTotal() | number }} ppm</strong></div>
              <div><span class="rail-label">Assets</span><strong>{{ pinnedAssetCount() }} / {{ collection.assets.length }} verified</strong></div>
              <div><span class="rail-label">Open comments</span><strong>{{ openCommentCount() }}</strong></div>
              <button type="button" (click)="activeSection.set('review')">Open review</button>
            </aside>
          </div>
        }
      }
    </main>
  `,
  styles: [
    `
      .editor-shell { max-width:1500px; margin:0 auto; padding:1rem var(--pad-x) 5rem; }
      .editor-header { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:space-between; gap:1rem; min-height:4.5rem; border-bottom:1px solid var(--border); background:rgba(2,11,11,.96); }
      .title-block,.header-actions,.title-block > div { display:flex; align-items:center; gap:1rem; min-width:0; }
      .title-block > a { color:var(--accent); font-size:.68rem; }
      .title-block h1 { max-width:35rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 1rem var(--font-sans); letter-spacing:0; }
      .title-block p { color:var(--muted); font-size:.58rem; }
      .state { padding:.25rem .4rem; border:1px solid var(--border); border-radius:4px; color:var(--muted); font:600 .54rem var(--font-mono); }
      .state[data-state='SEALED'],.state[data-state='PUBLISHED'] { color:var(--accent); border-color:rgba(124,255,178,.3); }
      .save-state { color:var(--muted); font:.62rem var(--font-mono); }
      .save-state[data-state='error'],.save-state[data-state='conflict'] { color:#ffaaa1; }
      .editor-layout { display:grid; grid-template-columns:12rem minmax(0,1fr) 13rem; gap:1.25rem; padding-top:1.25rem; }
      .section-nav { position:sticky; top:5.75rem; align-self:start; display:grid; }
      .section-nav button { display:flex; align-items:center; justify-content:space-between; gap:.5rem; padding:.6rem .65rem; border:0; border-left:2px solid transparent; background:none; color:var(--muted); text-align:left; font-size:.68rem; cursor:pointer; }
      .section-nav button.is-active { color:var(--text); border-left-color:var(--accent); background:rgba(124,255,178,.05); }
      .section-nav button.has-issues small { color:#ffaaa1; }
      .editor-main { min-width:0; padding:0 1.25rem 3rem; border-inline:1px solid var(--border); }
      .section-head { margin-bottom:1.25rem; padding-bottom:.75rem; border-bottom:1px solid var(--border); }
      .section-head span,.rail-label { color:var(--accent); font:600 .57rem var(--font-mono); text-transform:uppercase; letter-spacing:.12em; }
      .section-head h2 { margin-top:.3rem; font:600 1.55rem var(--font-sans); letter-spacing:0; }
      .section-head--small h2 { font-size:1rem; }
      fieldset,.field-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; margin:0; padding:0; border:0; }
      fieldset h3 { grid-column:1/-1; margin:1rem 0 0; font:600 .82rem var(--font-sans); letter-spacing:0; }
      fieldset.stacked { grid-template-columns:1fr; }
      label { display:grid; align-content:start; gap:.35rem; color:var(--muted); font-size:.66rem; }
      input,textarea,select { min-width:0; border-radius:5px; font-size:.76rem; }
      input[type='number'],input[type='date'],input[type='url'] { width:100%; border:1px solid rgba(246,241,232,.18); border-radius:5px; background:rgba(0,0,0,.22); color:var(--text); padding:.78rem .85rem; }
      textarea { resize:vertical; }
      .full,.span-2 { grid-column:1/-1; }
      .review-rail { position:sticky; top:5.75rem; align-self:start; display:grid; gap:1px; border:1px solid var(--border); background:var(--border); }
      .review-rail > div { display:flex; flex-direction:column; padding:.75rem; background:var(--bg-2); }
      .review-rail strong { margin-top:.2rem; font-size:.72rem; }
      .review-rail button,.row-add,.row-remove,.repeat-row > button,.inline-row button,.asset-table button,.proposal-list button,.proposal-list a,.wallet-binding button,.comments button,.issue-list button,.conflict-bar button { border:1px solid var(--border); border-radius:4px; background:none; color:var(--text); padding:.55rem .7rem; font:600 .61rem var(--font-mono); cursor:pointer; }
      .review-rail > button { border:0; border-top:1px solid var(--border); border-radius:0; background:var(--bg-2); color:var(--accent); }
      .asset-table,.proposal-list,.issue-list { display:grid; gap:1px; background:var(--border); border:1px solid var(--border); }
      .asset-table article,.proposal-list article { display:grid; grid-template-columns:1fr auto auto; align-items:center; gap:1rem; padding:.85rem; background:var(--bg-2); }
      .asset-table article > div,.proposal-list article > div { display:flex; flex-direction:column; min-width:0; }
      .asset-table span,.proposal-list span { color:var(--muted); font-size:.62rem; }
      .asset-state { color:#ffd071 !important; font:600 .58rem var(--font-mono); }
      .asset-state[data-state='PINNED'] { color:var(--accent) !important; }
      .repeat-row { display:grid; grid-template-columns:1fr auto; align-items:end; gap:1rem; padding:1rem; border:1px solid var(--border); border-radius:6px; }
      .inline-row { display:grid; grid-template-columns:1fr auto; align-items:start; gap:.75rem; }
      .allocation-total,.readiness { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem; padding:.85rem 1rem; border:1px solid rgba(255,170,161,.35); border-radius:6px; background:rgba(255,170,161,.05); font-size:.7rem; }
      .allocation-total.is-complete,.readiness.is-ready { border-color:rgba(124,255,178,.35); background:rgba(124,255,178,.05); }
      .issue-list button { display:flex; flex-direction:column; align-items:flex-start; border:0; border-radius:0; background:var(--bg-2); text-align:left; }
      .issue-list span { color:var(--muted); }
      .review-actions { display:flex; align-items:center; gap:.75rem; margin:1rem 0 2rem; }
      .comments { padding-top:1rem; border-top:1px solid var(--border); }
      .comments article { display:grid; grid-template-columns:11rem 1fr auto; gap:1rem; padding:.85rem 0; border-bottom:1px solid var(--border); font-size:.7rem; }
      .comments article.is-resolved { opacity:.55; }
      .comments article div { display:flex; flex-direction:column; }
      .comments article span { color:var(--muted); overflow:hidden; text-overflow:ellipsis; }
      .comment-form { display:grid; grid-template-columns:1fr auto; gap:.75rem; margin-top:1rem; }
      .preview-band { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--border); }
      .commitment-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; margin:0 0 1rem; border:1px solid var(--border); background:var(--border); }
      .commitment-grid div { min-width:0; padding:.8rem; background:var(--bg-2); }
      .commitment-grid dt { color:var(--muted); font:.56rem var(--font-mono); text-transform:uppercase; }
      .commitment-grid dd { margin:.3rem 0 0; overflow-wrap:anywhere; font-size:.7rem; }
      .wallet-binding { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin:1rem 0; padding:.85rem; border:1px solid var(--border); }
      .wallet-binding div { display:flex; flex-direction:column; min-width:0; }
      .wallet-binding span { color:var(--muted); overflow:hidden; text-overflow:ellipsis; }
      .sign-review { margin-top:1rem; padding:1rem; border:1px solid rgba(124,255,178,.3); border-radius:6px; background:rgba(124,255,178,.04); }
      .publish-result { display:flex; flex-direction:column; gap:.25rem; margin-top:1rem; padding:.85rem; border-left:2px solid #ffaaa1; background:rgba(255,170,161,.05); font-size:.7rem; }
      .publish-result[data-kind='submitted'] { border-left-color:var(--accent); background:rgba(124,255,178,.05); }
      .publish-result span { color:var(--muted); }
      .amendment-panel { margin-top:2rem; padding-top:1.25rem; border-top:1px solid var(--border); }
      .page-state { display:flex; min-height:65vh; flex-direction:column; align-items:center; justify-content:center; gap:.75rem; color:var(--muted); text-align:center; }
      .page-state--error strong { color:#ffaaa1; }
      @media (max-width:1100px) { .editor-layout { grid-template-columns:10rem minmax(0,1fr); } .review-rail { display:none; } }
      @media (max-width:760px) { .editor-header { position:static; align-items:flex-start; flex-direction:column; padding:.75rem 0; } .title-block { align-items:flex-start; flex-direction:column; } .editor-layout { grid-template-columns:1fr; } .section-nav { position:static; display:flex; overflow-x:auto; border-bottom:1px solid var(--border); } .section-nav button { flex:0 0 auto; border-left:0; border-bottom:2px solid transparent; } .section-nav button.is-active { border-bottom-color:var(--accent); } .editor-main { padding-inline:0; border:0; } fieldset,.field-grid,.upload-strip,.commitment-grid { grid-template-columns:1fr; } .span-2,.full { grid-column:auto; } .comments article,.asset-table article,.proposal-list article { grid-template-columns:1fr; } }
    `,
  ],
})
export class CollectionEditorComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CollectionApiService);
  private readonly session = inject(AdminSessionService);
  private readonly mint = inject(CollectionMintCoordinatorService);
  private readonly amendments = inject(PropertyAmendmentService);

  readonly sections: Array<{ id: EditorSection; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'property', label: 'Property' },
    { id: 'media', label: 'Media' },
    { id: 'economics', label: 'Economics' },
    { id: 'operations', label: 'Operations' },
    { id: 'legal', label: 'Legal' },
    { id: 'risks', label: 'Risks' },
    { id: 'documents', label: 'Documents' },
    { id: 'allocation', label: 'Deed allocation' },
    { id: 'review', label: 'Review' },
    { id: 'governance', label: 'Governance' },
  ];
  readonly workspace = signal<CollectionWorkspace | null>(null);
  readonly feature = signal<CollectionFeatureStatus | null>(null);
  readonly activeSection = signal<EditorSection>('overview');
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saveState = signal<SaveState>('idle');
  readonly saveError = signal<string | null>(null);
  readonly sealing = signal(false);
  readonly sealError = signal<string | null>(null);
  readonly mediaUploading = signal(false);
  readonly mediaError = signal<string | null>(null);
  readonly documentUploading = signal(false);
  readonly documentError = signal<string | null>(null);
  readonly ownerMemberHash = signal('');
  readonly ownerHashBusy = signal(false);
  readonly governanceError = signal<string | null>(null);
  readonly proposalBusy = signal(false);
  readonly mintPreview = signal<CollectionMintPreview | null>(null);
  readonly publishResult = signal<PublishRunResult | null>(null);
  readonly conflictServer = signal<CollectionWorkspace | null>(null);
  readonly amendmentOpen = signal(false);
  readonly amendmentBusy = signal(false);
  readonly amendmentError = signal<string | null>(null);

  draftModel: PropertyDossierDraftV1 | null = null;
  mediaRole: 'hero' | 'gallery' | 'floorplan' | 'other' = 'hero';
  mediaAlt = '';
  documentTitle = '';
  documentCategory = 'legal';
  commentBody = '';
  amendmentForm: OperationalUpdateForm = emptyOperationalUpdate();

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private editGeneration = 0;
  private activeSave: Promise<boolean> | null = null;
  private saveQueued = false;

  constructor() {
    void this.reload();
  }

  ngOnDestroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }

  async reload(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loadError.set('Missing collection identifier.');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [feature, collection] = await Promise.all([this.api.featureStatus(), this.api.get(id)]);
      this.feature.set(feature);
      this.applyWorkspace(collection);
    } catch (error) {
      this.loadError.set(formatError(error));
    } finally {
      this.loading.set(false);
    }
  }

  canEdit(): boolean {
    const state = this.workspace()?.state;
    return state === 'DRAFT' || state === 'REVIEW';
  }

  isOwner(): boolean {
    const owner = this.workspace()?.ownerSubject.toLowerCase();
    const subject = this.session.subject()?.toLowerCase();
    return Boolean(owner && subject && owner === subject);
  }

  changed(): void {
    if (!this.canEdit()) return;
    this.editGeneration += 1;
    this.saveQueued = Boolean(this.activeSave);
    this.saveState.set('dirty');
    this.scheduleSave();
  }

  async saveNow(submitForReview = false, force = false): Promise<boolean> {
    if (!this.canEdit() || !this.draftModel || !this.workspace()) return true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.activeSave) {
      this.saveQueued = true;
      await this.activeSave;
      return force || submitForReview || this.saveQueued
        ? this.saveNow(submitForReview, false)
        : this.saveState() !== 'error' && this.saveState() !== 'conflict';
    }
    const task = this.performSave(submitForReview);
    this.activeSave = task;
    try {
      return await task;
    } finally {
      this.activeSave = null;
      if (this.saveQueued && this.saveState() !== 'conflict') {
        this.saveQueued = false;
        this.scheduleSave(120);
      }
    }
  }

  async resolveConflict(choice: 'reload' | 'overwrite'): Promise<void> {
    const latest = this.conflictServer();
    if (!latest || !this.draftModel) return;
    if (choice === 'reload') {
      this.applyWorkspace(latest);
      return;
    }
    this.draftModel.revision = latest.revision;
    this.workspace.set({ ...latest, dossier: this.draftModel });
    this.conflictServer.set(null);
    this.saveState.set('dirty');
    await this.saveNow(false, true);
  }

  async submitForReview(): Promise<void> {
    await this.saveNow(true, true);
  }

  async seal(): Promise<void> {
    this.sealError.set(null);
    this.sealing.set(true);
    try {
      if (!(await this.saveNow(false, true))) return;
      const collection = this.workspace();
      if (!collection) return;
      this.applyWorkspace(await this.api.seal(collection.id, collection.revision));
      this.activeSection.set('governance');
    } catch (error) {
      this.sealError.set(formatError(error));
    } finally {
      this.sealing.set(false);
    }
  }

  async uploadMedia(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const collection = this.workspace();
    if (!file || !collection || !this.draftModel) return;
    if (!this.mediaAlt.trim()) {
      this.mediaError.set('Alt text is required.');
      input.value = '';
      return;
    }
    this.mediaUploading.set(true);
    this.mediaError.set(null);
    try {
      const assetId = uniqueAssetId(file.name, 'media');
      const asset = await this.api.uploadAsset(collection.id, file, {
        assetId,
        kind: 'MEDIA',
        role: this.mediaRole,
        alt: this.mediaAlt.trim(),
      });
      this.draftModel.media.push({
        assetId,
        role: this.mediaRole,
        alt: this.mediaAlt.trim(),
        uris: verifiedUris(asset),
        sha256: asset.actualSha256 || undefined,
        cid: asset.ipfsCid || undefined,
        mimeType: asset.actualMimeType || undefined,
        byteSize: asset.actualByteSize || undefined,
      });
      this.mediaAlt = '';
      this.changed();
      await this.saveNow(false, true);
    } catch (error) {
      this.mediaError.set(formatError(error));
    } finally {
      this.mediaUploading.set(false);
      input.value = '';
    }
  }

  async uploadDocument(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const collection = this.workspace();
    if (!file || !collection || !this.draftModel) return;
    if (!this.documentTitle.trim() || !this.documentCategory.trim()) {
      this.documentError.set('Document title and category are required.');
      input.value = '';
      return;
    }
    this.documentUploading.set(true);
    this.documentError.set(null);
    try {
      const assetId = uniqueAssetId(file.name, 'document');
      const asset = await this.api.uploadAsset(collection.id, file, {
        assetId,
        kind: 'DOCUMENT',
        title: this.documentTitle.trim(),
        category: this.documentCategory.trim(),
      });
      this.draftModel.documents.push({
        assetId,
        title: this.documentTitle.trim(),
        category: this.documentCategory.trim(),
        uris: verifiedUris(asset),
        sha256: asset.actualSha256 || undefined,
        cid: asset.ipfsCid || undefined,
        mimeType: asset.actualMimeType || undefined,
        byteSize: asset.actualByteSize || undefined,
      });
      this.documentTitle = '';
      this.changed();
      await this.saveNow(false, true);
    } catch (error) {
      this.documentError.set(formatError(error));
    } finally {
      this.documentUploading.set(false);
      input.value = '';
    }
  }

  removeMedia(index: number): void { this.draftModel?.media.splice(index, 1); this.changed(); }
  removeDocument(index: number): void { this.draftModel?.documents.splice(index, 1); this.changed(); }
  addRisk(): void { this.draftModel?.risks.push({ severity: 'medium' }); this.changed(); }
  removeRisk(index: number): void { this.draftModel?.risks.splice(index, 1); this.changed(); }
  addPlannedUse(): void { this.draftModel?.capital?.plannedUses.push({}); this.changed(); }
  removePlannedUse(index: number): void { this.draftModel?.capital?.plannedUses.splice(index, 1); this.changed(); }
  addDisclosure(): void { this.draftModel?.disclosures.push(''); this.changed(); }
  removeDisclosure(index: number): void { this.draftModel?.disclosures.splice(index, 1); this.changed(); }
  addSource(): void { this.draftModel?.dataSources.push({}); this.changed(); }
  removeSource(index: number): void { this.draftModel?.dataSources.splice(index, 1); this.changed(); }
  addHistory(): void { this.draftModel?.history.push({}); this.changed(); }
  removeHistory(index: number): void { this.draftModel?.history.splice(index, 1); this.changed(); }
  addDeed(): void { this.draftModel?.deedAllocation.push({}); this.changed(); }
  removeDeed(index: number): void { this.draftModel?.deedAllocation.splice(index, 1); this.changed(); }

  allocationTotal(): number {
    return this.draftModel?.deedAllocation.reduce((total, deed) => total + (deed.sharePpm || 0), 0) || 0;
  }

  assetStatus(assetId: string): CollectionAsset | null {
    return this.workspace()?.assets.find((asset) => asset.assetId === assetId) || null;
  }

  pinnedAssetCount(): number {
    return this.workspace()?.assets.filter((asset) => asset.state === 'PINNED').length || 0;
  }

  openCommentCount(): number {
    return this.workspace()?.comments.filter((comment) => !comment.resolved).length || 0;
  }

  sectionIssueCount(section: EditorSection): number {
    const prefix = issuePrefix(section);
    return this.workspace()?.readiness.issues.filter((issue) => issue.path.startsWith(prefix)).length || 0;
  }

  openIssue(path: string): void {
    this.activeSection.set(sectionForPath(path));
  }

  async addComment(): Promise<void> {
    const collection = this.workspace();
    if (!collection || !this.commentBody.trim()) return;
    try {
      await this.api.addComment(collection.id, this.activeSection(), this.commentBody.trim());
      this.commentBody = '';
      this.applyWorkspace(await this.api.get(collection.id));
    } catch (error) {
      this.saveError.set(formatError(error));
    }
  }

  async resolveComment(commentId: string): Promise<void> {
    const collection = this.workspace();
    if (!collection) return;
    try {
      await this.api.resolveComment(collection.id, commentId);
      this.applyWorkspace(await this.api.get(collection.id));
    } catch (error) {
      this.saveError.set(formatError(error));
    }
  }

  previewWorkspace(): CollectionWorkspace {
    const collection = this.workspace();
    if (!collection || !this.draftModel) throw new Error('Collection preview is unavailable.');
    return { ...collection, dossier: this.draftModel };
  }

  async deriveOwnerHash(): Promise<void> {
    this.ownerHashBusy.set(true);
    this.governanceError.set(null);
    try {
      const result = await this.mint.deriveOwnerMemberHash();
      this.ownerMemberHash.set(result.hash);
    } catch (error) {
      this.governanceError.set(formatError(error));
    } finally {
      this.ownerHashBusy.set(false);
    }
  }

  async prepareProposal(deed: CollectionDeed): Promise<void> {
    const collection = this.workspace();
    if (!collection) return;
    this.proposalBusy.set(true);
    this.governanceError.set(null);
    this.publishResult.set(null);
    try {
      this.mintPreview.set(await this.mint.prepare(collection, deed, this.ownerMemberHash()));
    } catch (error) {
      this.governanceError.set(formatError(error));
    } finally {
      this.proposalBusy.set(false);
    }
  }

  async publishProposal(): Promise<void> {
    const preview = this.mintPreview();
    const collection = this.workspace();
    if (!preview || !collection) return;
    this.proposalBusy.set(true);
    this.governanceError.set(null);
    try {
      const result = await this.mint.publish(preview);
      this.publishResult.set(result);
      if (result.kind === 'submitted' && result.apiResponse.pushed) {
        this.applyWorkspace(await this.api.get(collection.id));
        this.mintPreview.set(null);
      }
    } catch (error) {
      this.governanceError.set(formatError(error));
    } finally {
      this.proposalBusy.set(false);
    }
  }

  async refreshEvidence(): Promise<void> {
    const collection = this.workspace();
    if (!collection) return;
    try {
      this.applyWorkspace(await this.api.refreshChainEvidence(collection.id));
    } catch (error) {
      this.governanceError.set(formatError(error));
    }
  }

  openAmendment(): void {
    const collection = this.workspace();
    if (!collection) return;
    const dossier = collection.dossier as PropertyDossierV1;
    this.amendmentForm = {
      summary: dossier.summary,
      valuationAsOfDate: dossier.valuation.asOfDate,
      marketValueMinor: dossier.valuation.marketValueMinor,
      valuationMethod: dossier.valuation.method,
      valuationSource: dossier.valuation.source,
      occupancyStatus: dossier.operations.occupancyStatus,
      monthlyGrossRentMinor: dossier.operations.monthlyGrossRentMinor,
      annualOperatingExpenseMinor: dossier.operations.annualOperatingExpenseMinor,
      manager: dossier.operations.manager || '',
      leaseSummary: dossier.operations.leaseSummary || '',
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: '',
    };
    this.amendmentError.set(null);
    this.amendmentOpen.set(true);
  }

  async publishAmendment(): Promise<void> {
    const collection = this.workspace();
    if (!collection) return;
    this.amendmentBusy.set(true);
    this.amendmentError.set(null);
    try {
      const dossier = structuredClone(collection.dossier) as PropertyDossierV1;
      const changedFields: string[] = [];
      assignChanged(dossier, 'summary', this.amendmentForm.summary, '/summary', changedFields);
      assignChanged(dossier.valuation, 'asOfDate', this.amendmentForm.valuationAsOfDate, '/valuation/asOfDate', changedFields);
      assignChanged(dossier.valuation, 'marketValueMinor', this.amendmentForm.marketValueMinor, '/valuation/marketValueMinor', changedFields);
      assignChanged(dossier.valuation, 'method', this.amendmentForm.valuationMethod, '/valuation/method', changedFields);
      assignChanged(dossier.valuation, 'source', this.amendmentForm.valuationSource, '/valuation/source', changedFields);
      assignChanged(dossier.operations, 'occupancyStatus', this.amendmentForm.occupancyStatus, '/operations/occupancyStatus', changedFields);
      assignChanged(dossier.operations, 'monthlyGrossRentMinor', this.amendmentForm.monthlyGrossRentMinor, '/operations/monthlyGrossRentMinor', changedFields);
      assignChanged(dossier.operations, 'annualOperatingExpenseMinor', this.amendmentForm.annualOperatingExpenseMinor, '/operations/annualOperatingExpenseMinor', changedFields);
      assignChanged(dossier.operations, 'manager', this.amendmentForm.manager || undefined, '/operations/manager', changedFields);
      assignChanged(dossier.operations, 'leaseSummary', this.amendmentForm.leaseSummary || undefined, '/operations/leaseSummary', changedFields);
      const signed = await this.amendments.sign(
        collection,
        dossier,
        this.amendmentForm.reason,
        this.amendmentForm.effectiveDate,
        changedFields,
      );
      this.applyWorkspace(
        await this.api.appendAmendment(
          collection.id,
          collection.revision,
          signed.dossier,
          signed.amendment,
        ),
      );
      this.amendmentOpen.set(false);
    } catch (error) {
      this.amendmentError.set(formatError(error));
    } finally {
      this.amendmentBusy.set(false);
    }
  }

  publishResultTitle(result: PublishRunResult): string {
    if (result.kind === 'submitted') return result.apiResponse.pushed ? 'Proposal submitted' : 'Network rejected proposal';
    return `Proposal stopped at ${result.kind}`;
  }

  publishResultDetail(result: PublishRunResult): string {
    if (result.kind === 'submitted') return result.apiResponse.status;
    if ('error' in result) return result.error;
    if ('reason' in result) return result.reason;
    return 'Review wallet, governance, and chain readiness before retrying.';
  }

  saveLabel(): string {
    const labels: Record<SaveState, string> = {
      idle: 'No unsaved changes', dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved',
      error: this.saveError() || 'Save failed', conflict: 'Revision conflict',
    };
    return labels[this.saveState()];
  }

  private scheduleSave(delay = 800): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), delay);
  }

  private async performSave(submitForReview: boolean): Promise<boolean> {
    const collection = this.workspace();
    if (!collection || !this.draftModel) return false;
    const generation = this.editGeneration;
    this.saveState.set('saving');
    this.saveError.set(null);
    try {
      const payload = cleanDraft(this.draftModel, collection.revision);
      const saved = await this.api.update(collection.id, payload, collection.revision, submitForReview);
      if (generation === this.editGeneration) {
        this.applyWorkspace(saved);
      } else {
        this.draftModel.revision = saved.revision;
        this.workspace.set({ ...saved, dossier: this.draftModel });
        this.saveQueued = true;
      }
      this.saveState.set(this.saveQueued ? 'dirty' : 'saved');
      return true;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        try {
          const latest = await this.api.get(collection.id);
          this.conflictServer.set(latest);
        } catch {}
        this.saveState.set('conflict');
      } else {
        this.saveError.set(formatError(error));
        this.saveState.set('error');
      }
      return false;
    }
  }

  private applyWorkspace(collection: CollectionWorkspace): void {
    this.workspace.set(collection);
    this.draftModel = normalizeDraft(collection.dossier);
    this.conflictServer.set(null);
    this.saveQueued = false;
    this.saveState.set('saved');
  }
}

function normalizeDraft(value: PropertyDossierDraftV1): PropertyDossierDraftV1 {
  const draft = structuredClone(value);
  draft.schemaVersion = PROPERTY_DOSSIER_SCHEMA;
  draft.media ||= [];
  draft.documents ||= [];
  draft.risks ||= [];
  draft.history ||= [];
  draft.disclosures ||= [];
  draft.dataSources ||= [];
  draft.deedAllocation ||= [];
  draft.property ||= { address: {} };
  draft.property.address ||= {};
  draft.valuation ||= {};
  draft.offering ||= {};
  draft.operations ||= {};
  draft.capital ||= { plannedUses: [] };
  draft.capital.plannedUses ||= [];
  draft.legal ||= {};
  return draft;
}

function cleanDraft(value: PropertyDossierDraftV1, revision: number): PropertyDossierDraftV1 {
  const cleaned = stripEmpty(structuredClone(value)) as PropertyDossierDraftV1;
  cleaned.schemaVersion = PROPERTY_DOSSIER_SCHEMA;
  cleaned.revision = revision;
  cleaned.media ||= [];
  cleaned.documents ||= [];
  cleaned.risks ||= [];
  cleaned.history ||= [];
  cleaned.disclosures ||= [];
  cleaned.dataSources ||= [];
  cleaned.deedAllocation ||= [];
  return cleaned;
}

function stripEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEmpty);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined && child !== null && child !== '')
        .map(([key, child]) => [key, stripEmpty(child)]),
    );
  }
  return value;
}

function uniqueAssetId(filename: string, prefix: string): string {
  const stem = filename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
  return `${prefix}-${stem || 'asset'}-${Date.now().toString(36)}`;
}

function verifiedUris(asset: CollectionAsset): string[] {
  if (!asset.verifiedHttpsUrl || !asset.ipfsCid) return [];
  return [asset.verifiedHttpsUrl, `ipfs://${asset.ipfsCid}`];
}

function issuePrefix(section: EditorSection): string {
  const map: Partial<Record<EditorSection, string>> = {
    overview: '/summary', property: '/property', media: '/media', economics: '/valuation',
    operations: '/operations', legal: '/legal', risks: '/risks', documents: '/documents',
    allocation: '/deedAllocation',
  };
  return map[section] || '/';
}

function sectionForPath(path: string): EditorSection {
  if (path.startsWith('/property')) return 'property';
  if (path.startsWith('/media') || path.startsWith('/assets')) return 'media';
  if (path.startsWith('/valuation') || path.startsWith('/offering') || path.startsWith('/capital')) return 'economics';
  if (path.startsWith('/operations')) return 'operations';
  if (path.startsWith('/legal')) return 'legal';
  if (path.startsWith('/risks')) return 'risks';
  if (path.startsWith('/documents') || path.startsWith('/dataSources') || path.startsWith('/disclosures')) return 'documents';
  if (path.startsWith('/deedAllocation')) return 'allocation';
  return 'overview';
}

interface OperationalUpdateForm {
  summary: string;
  valuationAsOfDate: string;
  marketValueMinor: string;
  valuationMethod: string;
  valuationSource: string;
  occupancyStatus: string;
  monthlyGrossRentMinor: string;
  annualOperatingExpenseMinor: string;
  manager: string;
  leaseSummary: string;
  effectiveDate: string;
  reason: string;
}

function emptyOperationalUpdate(): OperationalUpdateForm {
  return {
    summary: '', valuationAsOfDate: '', marketValueMinor: '', valuationMethod: '',
    valuationSource: '', occupancyStatus: '', monthlyGrossRentMinor: '',
    annualOperatingExpenseMinor: '', manager: '', leaseSummary: '', effectiveDate: '', reason: '',
  };
}

function assignChanged<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K],
  path: string,
  changedFields: string[],
): void {
  if (target[key] === value) return;
  target[key] = value;
  changedFields.push(path);
}
