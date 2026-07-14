import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AdminSessionService } from '../../../services/admin-session.service';
import { MintDraftStorageService } from '../../../services/mint-draft-storage.service';
import {
  ProposeMintRequest,
  SmartDeedFilingStatus,
  SmartDeedSecurityStructure,
  SmartDeedSettlementBasis,
  SmartDeedTermsMetadata,
} from '../../../services/admin-api.service';
import {
  canonicalizeMintCollectionId,
  canonicalizeMintPropertyId,
} from '../../../utils/mint-property-id';
import { formatError } from '../../../utils/format-error';

/**
 * Compose a new DRAFT mint proposal.
 *
 * The fields map 1:1 to `solslot_api.mint_endpoints.ProposeMintRequest`.
 * Server-side validation handles the heavy lifting (length bounds,
 * royalty range, property_id canonicalisation per POP-CANON-014); the
 * client checks shape so the user gets immediate feedback before we
 * round-trip a 400.
 *
 * On success we navigate straight to `/admin/mint/{id}` (the detail
 * view); the user's next move is typically to publish the proposal,
 * which is a Step B path (501 today).
 */
@Component({
  selector: 'pp-admin-mint-new',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="container-p pt-12 pb-24 max-w-3xl">
      <header>
        <div class="mono text-[0.7rem] uppercase tracking-[0.25em] text-brand mb-2">
          Solslot · Admin Desk
        </div>
        <h1 class="font-display text-4xl md:text-5xl">New mint proposal.</h1>
        <p class="mt-3 text-text-muted text-sm max-w-xl">
          DRAFT mint proposals carry only operator metadata.  The four
          computed puzzle hashes (smart_deed_inner, eve_inner, deed_full,
          proposal_hash) are populated atomically when you publish the
          proposal on chain.
        </p>
      </header>

      <form class="mt-10 grid gap-8" (ngSubmit)="submit()" #f="ngForm">
        <fieldset class="card grid gap-5">
          <legend class="font-display text-2xl">Property</legend>

          <div>
            <label class="form-label">Property ID</label>
            <input
              [(ngModel)]="propertyId"
              name="property_id"
              required
              minlength="1"
              maxlength="128"
              placeholder="US-TX-Travis-12345"
            />
            <p class="form-hint">
              Server canonicalises with <code class="mono">strip().upper()</code>
              for uniqueness (POP-CANON-014).
            </p>
          </div>

          <div class="grid gap-5 sm:grid-cols-2">
            <div>
              <label class="form-label">Asset class</label>
              <input
                [(ngModel)]="assetClass"
                name="asset_class"
                required
                minlength="1"
                maxlength="64"
                placeholder="RWA-RE-RES"
              />
              <p class="form-hint">
                e.g. <span class="mono">RWA-RE-RES</span> for residential real estate.
              </p>
            </div>
            <div>
              <label class="form-label">Jurisdiction</label>
              <input
                [(ngModel)]="jurisdiction"
                name="jurisdiction"
                required
                minlength="1"
                maxlength="64"
                placeholder="US-TX-Travis"
              />
              <p class="form-hint">ISO-style jurisdiction code.</p>
            </div>
          </div>

          <div>
            <label class="form-label">Collection ID</label>
            <input
              [(ngModel)]="collectionId"
              name="collection_id"
              required
              minlength="1"
              maxlength="128"
              placeholder="US-TX-Travis-SFR-2026"
            />
            <p class="form-hint">
              Canonical collection for governed NAV pricing.
            </p>
          </div>
        </fieldset>

        <fieldset class="card grid gap-5">
          <legend class="font-display text-2xl">Economics</legend>

          <div>
            <label class="form-label">Par value (mojos)</label>
            <input
              [(ngModel)]="parValueRaw"
              name="par_value"
              required
              type="number"
              min="1"
              step="1"
              placeholder="1000000000"
            />
            <p class="form-hint">
              1 mojo = 1¢.  Current par:
              <span class="mono text-text">{{ parValueDisplay() }}</span>.
            </p>
          </div>

          <div>
            <label class="form-label">Share (ppm)</label>
            <input
              [(ngModel)]="sharePpmRaw"
              name="share_ppm"
              required
              type="number"
              min="1"
              max="1000000"
              step="1"
              placeholder="1000000"
            />
            <p class="form-hint">
              1000000 = 100% of the collection NAV. Current:
              <span class="mono text-text">{{ sharePpmDisplay() }}</span>.
            </p>
          </div>

          <div>
            <label class="form-label">Royalty payee puzzle hash</label>
            <input
              [(ngModel)]="royaltyPuzhash"
              name="royalty_puzhash"
              required
              minlength="66"
              maxlength="66"
              placeholder="0x{{ '0'.repeat(64) }}"
              class="mono"
            />
            <p class="form-hint">
              0x-prefixed 32-byte hex.  Where royalty payments land on each
              secondary-market sale of the deed.
            </p>
          </div>

          <div>
            <label class="form-label">Royalty (basis points)</label>
            <input
              [(ngModel)]="royaltyBpsRaw"
              name="royalty_bps"
              required
              type="number"
              min="0"
              max="10000"
              step="1"
              placeholder="250"
            />
            <p class="form-hint">
              0–10000 (= 0%–100%).  Current:
              <span class="mono text-text">{{ royaltyBpsDisplay() }}</span>.
            </p>
          </div>
        </fieldset>

        <fieldset class="card grid gap-5">
          <legend class="font-display text-2xl">Governance</legend>

          <div>
            <label class="form-label">Quorum required (SGT mojos)</label>
            <input
              [(ngModel)]="quorumRequiredRaw"
              name="quorum_required"
              required
              type="number"
              min="1"
              step="1"
              placeholder="100000000"
            />
            <p class="form-hint">
              Minimum SGT-mojos of YES votes for the proposal to pass.
              Snapshot from the protocol manifest's
              <code class="mono">quorum_bps × sgt_total_supply ÷ 10_000</code>.
            </p>
          </div>
        </fieldset>

        <fieldset class="card grid gap-5">
          <legend class="font-display text-2xl">Legal and security structure</legend>

          <div class="grid gap-5 sm:grid-cols-2">
            <div>
              <label class="form-label">Security structure</label>
              <select [(ngModel)]="securityStructure" name="security_structure" required>
                <option value="entity_ucc">Entity-level UCC security interest</option>
                <option value="real_property_lien">Real-property lien</option>
                <option value="deed_of_trust">Deed of trust</option>
                <option value="mortgage">Mortgage</option>
                <option value="hybrid">Hybrid UCC + real-property security</option>
                <option value="contract_only">Contractual rights; no lien stated</option>
                <option value="unsecured">Unsecured obligation</option>
                <option value="other">Other disclosed structure</option>
              </select>
            </div>
            <div>
              <label class="form-label">Filing / recording status</label>
              <select [(ngModel)]="filingStatus" name="filing_status" required>
                <option value="recorded">Recorded / filed</option>
                <option value="pending">Pending</option>
                <option value="intended">Intended; not confirmed</option>
                <option value="not_applicable">Not applicable</option>
                <option value="none">No filing stated</option>
              </select>
            </div>
          </div>

          <div>
            <label class="form-label">What the structure gives the holder</label>
            <textarea [(ngModel)]="securityDescription" name="security_description" rows="3" required minlength="20" maxlength="2000" placeholder="Describe the holder's rights and explicitly distinguish security from title, equity, occupancy, and management control."></textarea>
          </div>

          <div class="grid gap-5 sm:grid-cols-2">
            <div>
              <label class="form-label">Legal obligor</label>
              <input [(ngModel)]="obligor" name="obligor" required minlength="2" maxlength="256" placeholder="Full legal name" />
            </div>
            <div>
              <label class="form-label">Filing / recording reference</label>
              <input [(ngModel)]="filingReference" name="filing_reference" maxlength="256" placeholder="Instrument, filing, county, or UCC reference" />
            </div>
          </div>

          <div>
            <label class="form-label">Collateral description</label>
            <textarea [(ngModel)]="collateralDescription" name="collateral_description" rows="3" required minlength="10" maxlength="2000" placeholder="Identify the entity assets, real property, instrument, exclusions, and limitations."></textarea>
          </div>

          <div>
            <label class="form-label">Priority and senior claims</label>
            <textarea [(ngModel)]="priorityDescription" name="priority_description" rows="3" required minlength="10" maxlength="2000" placeholder="Describe priority, senior debt, permitted liens, subordination, and remedies."></textarea>
          </div>

          <div class="grid gap-5 sm:grid-cols-2">
            <div>
              <label class="form-label">Settlement / redemption basis</label>
              <select [(ngModel)]="settlementBasis" name="settlement_basis" required>
                <option value="nav_redemption">Governed collection-NAV redemption</option>
                <option value="governance_settlement">Governance-approved pool settlement</option>
                <option value="property_sale">Property sale proceeds</option>
                <option value="appraisal_buyout">Appraisal-based buyout</option>
                <option value="fixed_maturity">Stated maturity mechanics</option>
                <option value="hybrid">Multiple defined paths</option>
                <option value="other">Other disclosed method</option>
              </select>
            </div>
            <div>
              <label class="form-label">Definitive documents URL</label>
              <input [(ngModel)]="definitiveDocumentsUrl" name="definitive_documents_url" type="url" required maxlength="1000" placeholder="https://…" />
            </div>
          </div>

          <div>
            <label class="form-label">Settlement calculation and waterfall</label>
            <textarea [(ngModel)]="settlementDescription" name="settlement_description" rows="3" required minlength="20" maxlength="2000" placeholder="State inputs, valuation source, adjustments, expenses, priority, timing, and governance conditions."></textarea>
          </div>

          <div>
            <label class="form-label">Transfer and eligibility policy</label>
            <textarea [(ngModel)]="transferPolicy" name="transfer_policy" rows="3" required minlength="20" maxlength="2000" placeholder="Describe vault/pool paths, eligibility, zkPassport, restrictions, and available liquidity routes."></textarea>
          </div>

          <div>
            <label class="form-label">Document package SHA-256</label>
            <input [(ngModel)]="documentPackageHash" name="document_package_hash" required pattern="^sha256:[a-fA-F0-9]{64}$" placeholder="sha256:…" class="mono" />
            <p class="form-hint">Hash the exact definitive document package reviewed for this submission.</p>
          </div>
        </fieldset>

        <fieldset class="card grid gap-5">
          <legend class="font-display text-2xl">Additional off-chain metadata <span class="text-text-muted text-sm">(optional)</span></legend>

          <div>
            <label class="form-label">JSON</label>
            <textarea
              [(ngModel)]="offChainJson"
              name="off_chain_metadata"
              rows="6"
              class="mono text-xs"
              placeholder='&#123; "title": "16 Eaglecrest Dr", "photos": [], "attestations": [] &#125;'
            ></textarea>
            <p class="form-hint">
              Free-form blob keyed by the canonicalised property_id.  Title,
              address, photos, attestations, etc.  Must be valid JSON or
              empty.
            </p>
          </div>
        </fieldset>

        @if (error()) {
          <div class="rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            <div class="font-display text-base mb-1">Couldn't create proposal.</div>
            <div class="mono text-xs">{{ error() }}</div>
          </div>
        }

        <div class="flex flex-wrap gap-3 justify-end">
          <a routerLink="/admin" class="btn btn--ghost">Cancel</a>
          <button
            type="submit"
            class="btn btn--primary"
            [disabled]="busy() || !f.form.valid"
          >
            @if (busy()) {
              Submitting&hellip;
            } @else {
              Create DRAFT
            }
          </button>
        </div>
      </form>
    </section>
  `,
  styles: [
    `
      .form-label {
        display: block;
        font-family: var(--font-mono);
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--muted);
        margin-bottom: 0.5rem;
      }

      .form-hint {
        margin-top: 0.4rem;
        font-size: 0.78rem;
        color: var(--muted);
      }

      fieldset {
        border: 1px solid var(--border);
      }

      legend {
        padding: 0 0.5rem;
        margin-left: -0.5rem;
      }
    `,
  ],
})
export class MintNewComponent {
  private readonly drafts = inject(MintDraftStorageService);
  private readonly session = inject(AdminSessionService);
  private readonly router = inject(Router);

  // Form-bound fields are plain properties so ``[(ngModel)]`` works without
  // signal-aware bindings.  Reactive UI signals (``busy``, ``error``) stay
  // as signals because they're not bound through ngModel.
  propertyId = '';
  assetClass = '';
  collectionId = '';
  sharePpmRaw = '';
  jurisdiction = '';
  parValueRaw = '';
  royaltyPuzhash = '';
  royaltyBpsRaw = '';
  quorumRequiredRaw = '';
  securityStructure: SmartDeedSecurityStructure = 'entity_ucc';
  filingStatus: SmartDeedFilingStatus = 'pending';
  settlementBasis: SmartDeedSettlementBasis = 'nav_redemption';
  securityDescription = '';
  obligor = '';
  collateralDescription = '';
  filingReference = '';
  priorityDescription = '';
  settlementDescription = '';
  transferPolicy = '';
  definitiveDocumentsUrl = '';
  documentPackageHash = '';
  offChainJson = '';

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  parValueDisplay(): string {
    const n = Number(this.parValueRaw);
    if (!Number.isFinite(n) || n <= 0) return '—';
    const dollars = n / 100;
    return `\$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  royaltyBpsDisplay(): string {
    const n = Number(this.royaltyBpsRaw);
    if (!Number.isFinite(n) || n < 0 || n > 10_000) return '—';
    return `${n / 100}%`;
  }

  sharePpmDisplay(): string {
    const n = Number(this.sharePpmRaw);
    if (!Number.isFinite(n) || n < 1 || n > 1_000_000) return '—';
    return `${(n / 10_000).toLocaleString('en-US', {
      maximumFractionDigits: 4,
    })}%`;
  }

  async submit(): Promise<void> {
    this.error.set(null);
    let body: ProposeMintRequest;
    try {
      body = this.buildRequest();
    } catch (e) {
      this.error.set(formatError(e));
      return;
    }

    this.busy.set(true);
    try {
      // requireSession throws if the wallet-signed admin credential
      // has expired between route activation and form submission.
      // The admin guard already gates the page, so this is purely a
      // belt-and-suspenders check for stale tabs.
      const sess = this.session.requireSession();
      const proposal = this.drafts.create(body, sess.address);
      await this.router.navigate(['/admin/mint', proposal.id]);
    } catch (e) {
      this.error.set(formatError(e));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Convert form signals into the wire shape, validating the constraints
   * that aren't expressible via simple `[(ngModel)]` validators (custom
   * royalty_puzhash regex, JSON parse, integer coercion).  Throws on
   * validation failure so the caller can surface a friendly message.
   */
  private buildRequest(): ProposeMintRequest {
    const parValue = this.parseInteger(this.parValueRaw, 'par_value', { min: 1 });
    const sharePpm = this.parseInteger(this.sharePpmRaw, 'share_ppm', {
      min: 1,
      max: 1_000_000,
    });
    const royaltyBps = this.parseInteger(this.royaltyBpsRaw, 'royalty_bps', {
      min: 0,
      max: 10_000,
    });
    const quorumRequired = this.parseInteger(
      this.quorumRequiredRaw,
      'quorum_required',
      { min: 1 },
    );
    const royaltyPuzhash = this.normalizeBytes32(this.royaltyPuzhash);
    const customMetadata = this.parseOptionalJson(this.offChainJson);
    const smartDeedTerms = this.buildSmartDeedTerms();
    const offChainMetadata = {
      ...(customMetadata ?? {}),
      smartDeedTerms,
    };
    return {
      par_value: parValue,
      asset_class: this.assetClass.trim(),
      property_id: canonicalizeMintPropertyId(this.propertyId),
      collection_id: canonicalizeMintCollectionId(this.collectionId),
      share_ppm: sharePpm,
      jurisdiction: this.jurisdiction.trim(),
      royalty_puzhash: royaltyPuzhash,
      royalty_bps: royaltyBps,
      quorum_required: quorumRequired,
      ...(offChainMetadata !== undefined ? { off_chain_metadata: offChainMetadata } : {}),
    };
  }

  private parseInteger(
    raw: string,
    fieldName: string,
    bounds: { min?: number; max?: number },
  ): number {
    const trimmed = raw.trim();
    if (trimmed === '') throw new Error(`${fieldName} is required`);
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`${fieldName} must be a whole number`);
    }
    if (bounds.min !== undefined && n < bounds.min) {
      throw new Error(`${fieldName} must be ≥ ${bounds.min}`);
    }
    if (bounds.max !== undefined && n > bounds.max) {
      throw new Error(`${fieldName} must be ≤ ${bounds.max}`);
    }
    return n;
  }

  /** Accept either "0x"-prefixed or bare 64-char hex; canonicalise to lower 0x.. */
  private normalizeBytes32(raw: string): string {
    const trimmed = raw.trim().toLowerCase();
    const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new Error('royalty_puzhash must be a 32-byte hex string (64 hex chars)');
    }
    return '0x' + hex;
  }

  private buildSmartDeedTerms(): SmartDeedTermsMetadata {
    const definitiveDocumentsUrl = this.definitiveDocumentsUrl.trim();
    try {
      const url = new URL(definitiveDocumentsUrl);
      if (url.protocol !== 'https:') {
        throw new Error();
      }
    } catch {
      throw new Error('definitive_documents_url must be a valid HTTPS URL');
    }
    const documentPackageHash = this.documentPackageHash.trim().toLowerCase();
    if (!/^sha256:[a-f0-9]{64}$/.test(documentPackageHash)) {
      throw new Error('document_package_hash must be sha256 followed by 64 hex characters');
    }
    return {
      schemaVersion: 'solslot.smartdeed.submission.v2',
      securityStructure: this.securityStructure,
      securityDescription: this.requireText(this.securityDescription, 'security_description', 20),
      obligor: this.requireText(this.obligor, 'obligor', 2),
      collateralDescription: this.requireText(this.collateralDescription, 'collateral_description', 10),
      filingStatus: this.filingStatus,
      ...(this.filingReference.trim()
        ? { filingReference: this.filingReference.trim() }
        : {}),
      priorityDescription: this.requireText(this.priorityDescription, 'priority_description', 10),
      settlementBasis: this.settlementBasis,
      settlementDescription: this.requireText(this.settlementDescription, 'settlement_description', 20),
      transferPolicy: this.requireText(this.transferPolicy, 'transfer_policy', 20),
      definitiveDocumentsUrl,
      documentPackageHash,
    };
  }

  private requireText(raw: string, fieldName: string, minLength: number): string {
    const value = raw.trim();
    if (value.length < minLength) {
      throw new Error(`${fieldName} must contain at least ${minLength} characters`);
    }
    return value;
  }

  private parseOptionalJson(raw: string): Record<string, unknown> | undefined {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('off_chain_metadata must be valid JSON or empty');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('off_chain_metadata must be a JSON object (not array, null, or scalar)');
    }
    return parsed as Record<string, unknown>;
  }
}
