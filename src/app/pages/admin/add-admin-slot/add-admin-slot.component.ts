import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  AdminAuthorityV2Service,
  AdminRecord,
  AdminRosterSpendPackagePreflight,
  bytesToHexPrefixed,
} from '../../../services/admin-authority-v2/admin-authority-v2.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import {
  AdminAuthorityV2LiveSingletonLookup,
  AdminRosterUpdatePrepareResponse,
  AdminRosterUpdateService,
} from '../../../services/admin-roster-update.service';
import { ChiaWasmService } from '../../../services/chia-wasm.service';
import {
  Eip712LeafHash,
  Eip712LeafHashService,
} from '../../../services/eip712-leaf-hash.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { formatError } from '../../../utils/format-error';
import { environment } from '../../../../environments/environment';

type Preview = {
  launcherId: string;
  currentAuthorityVersion: number;
  currentMipsRootHash: string;
  currentAdminsHash: string;
  currentStateHash: string;
  newAuthorityVersion: number;
  newAdminSlotIndex: number;
  newThreshold: number;
  newAdminsHash: string;
  newMipsRootHash: string;
  newStateHash: string;
  rosterUpdateBindingHash: string;
  pendingOpsHash: string;
  currentAdminRecords: AdminRecord[];
  adminRecords: AdminRecord[];
  currentAdminRecordsArtifact: AdminRecordsArtifact;
  updatedAdminRecordsArtifact: AdminRecordsArtifact;
  newMipsMemberHashes: string[];
};

type AdminRecordsArtifact = {
  version: number;
  launcher_id: string;
  admin_records: ExpandedAdminRecord[];
};

type ExpandedAdminRecord = {
  admin_idx: number;
  m_within: number;
  leaves: ExpandedLeaf[];
};

type ExpandedLeaf = {
  kind: 'eip712_member';
  leaf_hash: string;
  evm_address: string;
  secp256k1_pubkey: string;
  type_hash: string;
  prefix_and_domain_separator: string;
};

const SPEND_ADMIN_ROSTER_UPDATE = 0x07;

@Component({
  selector: 'pp-add-admin-slot',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="container-p pt-12 pb-24">
      <header class="flex flex-wrap items-start justify-between gap-6">
        <div>
          <a routerLink="/admin" class="mono text-xs text-brand hover:underline">
            ← Admin desk
          </a>
          <div class="mono mt-5 text-[0.7rem] uppercase tracking-[0.25em] text-brand">
            Authority v2 · Add admin slot
          </div>
          <h1 class="font-display mt-2 text-4xl md:text-5xl">
            Vote in the next admin.
          </h1>
          <p class="mt-3 max-w-3xl text-sm text-text-muted">
            Capture a cold/hardware EVM wallet as admin slot {{ nextSlotIndex() }}, preview
            the new roster commitment, and export the updated public artifacts. On-chain
            submission stays gated until the roster-update spend signer is wired.
          </p>
        </div>
        <div class="rounded-card border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200 max-w-md">
          <div class="font-display text-lg text-red-100">Current risk: single-key admin</div>
          <p class="mt-2 text-xs leading-5">
            Slot 0 currently has one EIP-712 leaf with <span class="mono">m_within=1</span>.
            The safer next state is a two-slot authority with a protocol-level
            <span class="mono">2-of-2</span> MIPS root.
          </p>
        </div>
      </header>

      <div class="mt-8 grid gap-4 md:grid-cols-3">
        <div class="card">
          <div class="mono text-xs uppercase tracking-[0.2em] text-text-muted">Authority</div>
          <dl class="mt-3 grid gap-2 text-sm">
            <div>
              <dt class="text-text-muted">launcher_id</dt>
              <dd class="mono break-all">{{ launcherId() || 'not configured' }}</dd>
            </div>
            <div>
              <dt class="text-text-muted">network</dt>
              <dd class="mono">{{ network }}</dd>
            </div>
            <div>
              <dt class="text-text-muted">spend tag</dt>
              <dd class="mono">0x07 ADMIN_ROSTER_UPDATE</dd>
            </div>
          </dl>
        </div>

        <div class="card">
          <div class="mono text-xs uppercase tracking-[0.2em] text-text-muted">Current admin</div>
          @if (currentAdminLeaf(); as current) {
            <dl class="mt-3 grid gap-2 text-sm">
              <div>
                <dt class="text-text-muted">slot</dt>
                <dd class="mono">0</dd>
              </div>
              <div>
                <dt class="text-text-muted">address</dt>
                <dd class="mono break-all">{{ currentAddress() }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">leaf_hash</dt>
                <dd class="mono break-all">{{ current.leaf_hash }}</dd>
              </div>
            </dl>
          } @else {
            <p class="mt-3 text-sm text-text-muted">
              Sign in as the existing admin first. The page uses your admin session pubkey to
              reconstruct slot 0 without asking the wallet to sign again.
            </p>
          }
        </div>

        <div class="card">
          <div class="mono text-xs uppercase tracking-[0.2em] text-text-muted">Version bump</div>
          <label class="mt-3 block text-xs text-text-muted" for="current-version">
            Current authority_version
          </label>
          <input
            id="current-version"
            class="input mt-1 w-32"
            type="number"
            min="1"
            [value]="currentAuthorityVersion()"
            (input)="setCurrentAuthorityVersion($any($event.target).value)"
          />
          <div class="mt-3 text-sm">
            New version: <span class="mono text-brand">{{ newAuthorityVersion() }}</span>
          </div>
        </div>
      </div>

      <section class="card mt-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 class="font-display text-2xl">1. Capture the new admin wallet</h2>
            <p class="mt-1 text-sm text-text-muted">
              Switch your EVM wallet to the cold/hardware account you want to add, then recover
              its compressed secp256k1 pubkey locally. The proof-of-possession signature is not
              stored in exported artifacts.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn--ghost"
              [disabled]="connectingEvm() !== null"
              (click)="connectInjected()"
            >
              {{ connectingEvm() === 'injected' ? 'Connecting…' : 'Connect injected' }}
            </button>
            <button
              type="button"
              class="btn btn--ghost"
              [disabled]="connectingEvm() !== null"
              (click)="connectWalletConnect()"
            >
              {{ connectingEvm() === 'walletconnect' ? 'Connecting…' : 'WalletConnect' }}
            </button>
            <button
              type="button"
              class="btn btn--primary"
              [disabled]="recoveringNewAdmin() || !evmConnected()"
              (click)="recoverNewAdminFromWallet()"
            >
              {{ recoveringNewAdmin() ? 'Recovering…' : 'Use connected wallet as slot ' + nextSlotIndex() }}
            </button>
          </div>
        </div>

        @if (evmConnectError()) {
          <div class="mt-4 rounded-card border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            {{ evmConnectError() }}
          </div>
        }
        @if (newAdminError()) {
          <div class="mt-4 rounded-card border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            {{ newAdminError() }}
          </div>
        }

        <div class="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <div class="text-xs text-text-muted">Connected EVM wallet</div>
            <div class="mono mt-1 break-all text-sm">{{ evmAddress() ?? 'not connected' }}</div>
          </div>
          @if (newAdminLeaf(); as leaf) {
            <div>
              <div class="text-xs text-text-muted">New admin leaf hash</div>
              <div class="mono mt-1 break-all text-sm text-brand">{{ leaf.leaf_hash }}</div>
            </div>
          }
        </div>
      </section>

      <section class="card mt-6">
        <h2 class="font-display text-2xl">2. Preview roster update</h2>
        @if (preview(); as p) {
          <div class="mt-5 grid gap-4 md:grid-cols-2">
            <dl class="grid gap-3 text-sm">
              <div>
                <dt class="text-text-muted">new admin slot index</dt>
                <dd class="mono text-brand">{{ p.newAdminSlotIndex }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">new MIPS quorum</dt>
                <dd class="mono">{{ p.newThreshold }} of {{ p.adminRecords.length }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">new authority_version</dt>
                <dd class="mono">{{ p.newAuthorityVersion }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">pending_ops_hash</dt>
                <dd class="mono break-all">{{ p.pendingOpsHash }}</dd>
              </div>
            </dl>
            <dl class="grid gap-3 text-sm">
              <div>
                <dt class="text-text-muted">new admins_hash</dt>
                <dd class="mono break-all text-brand">{{ p.newAdminsHash }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">new mips_root</dt>
                <dd class="mono break-all text-brand">{{ p.newMipsRootHash }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">new state_hash</dt>
                <dd class="mono break-all text-brand">{{ p.newStateHash }}</dd>
              </div>
            </dl>
          </div>

          <div class="mt-6 grid gap-4 lg:grid-cols-2">
            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <h3 class="font-display text-xl">Updated admin_records.json</h3>
                <button class="btn btn--ghost text-xs" type="button" (click)="downloadAdminRecordsJson()">
                  Download
                </button>
              </div>
              <pre class="mono max-h-96 overflow-auto rounded-card bg-black/30 p-4 text-xs">{{ adminRecordsJson() }}</pre>
            </div>
            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <h3 class="font-display text-xl">Roster update preview</h3>
                <div class="flex gap-2">
                  <button class="btn btn--ghost text-xs" type="button" (click)="copyPreviewJson()">
                    Copy
                  </button>
                  <button class="btn btn--ghost text-xs" type="button" (click)="downloadPreviewJson()">
                    Download
                  </button>
                </div>
              </div>
              <pre class="mono max-h-96 overflow-auto rounded-card bg-black/30 p-4 text-xs">{{ previewJson() }}</pre>
            </div>
          </div>
        } @else {
          <div class="mt-4 rounded-card border border-white/10 bg-white/5 p-4 text-sm text-text-muted">
            {{ previewBlocker() }}
          </div>
        }
      </section>

      <section class="card mt-6 border-yellow-500/40 bg-yellow-500/5">
        <h2 class="font-display text-2xl text-yellow-100">3. Sign and submit</h2>
        <div class="mt-4 rounded-card border border-yellow-500/30 bg-black/20 p-4 text-sm text-yellow-100/85">
          <div class="font-display text-lg text-yellow-100">Activation status: candidate only</div>
          <ul class="mt-2 grid gap-2 text-xs leading-5">
            <li>
              Slot {{ preview()?.newAdminSlotIndex ?? 1 }} cannot use the admin desk, propose admin
              spends, or authorize KYC/admin actions until the roster update spend confirms on chain.
            </li>
            <li>
              The wallet may still register or use its own regular user vault if the normal vault flow
              supports it; that is separate from admin authority.
            </li>
            <li>
              After activation, authority version {{ newAuthorityVersion() }} uses a
              <span class="mono">{{ preview()?.newThreshold ?? 2 }}-of-{{ preview()?.adminRecords?.length ?? 2 }}</span>
              MIPS root, so protocol admin spends require the updated quorum path.
            </li>
          </ul>
        </div>
        <p class="mt-2 text-sm text-yellow-100/80">
          The local preview/export above is the protocol input boundary. The current admin must
          eventually authorize a singleton spend using
          <span class="mono">SPEND_ADMIN_ROSTER_UPDATE = 0x07</span>, but the backend is only an
          optional admin cross-check and not the authority source.
        </p>
        <div class="mt-5 rounded-card border border-white/10 bg-black/20 p-4">
          <div class="font-display text-lg text-yellow-100">Optional API cross-checks</div>
          <p class="mt-2 text-xs leading-5 text-yellow-100/80">
            These admin-only API calls compare the local preview against the backend's configured
            view and can query coinset through the API. They are optional conveniences: the exported
            roster inputs remain usable by an independent local signer, and the JWT stays in memory.
          </p>
          <dl class="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt class="text-text-muted">API JWT status</dt>
              <dd class="mono break-all text-brand">{{ prepareApiJwtStatus() }}</dd>
            </div>
            <div>
              <dt class="text-text-muted">API auth subject</dt>
              <dd class="mono break-all text-brand">{{ currentAddress() || 'not signed in' }}</dd>
            </div>
          </dl>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              class="btn btn--ghost"
              type="button"
              [disabled]="!currentAddress() || !evmConnected() || preparingApiJwt() || lookingUpLiveSingleton() || preparingRosterUpdate()"
              (click)="authorizeRosterUpdateApi()"
            >
              {{ preparingApiJwt() ? 'Authorizing…' : 'Authorize optional API checks' }}
            </button>
            <button
              class="btn btn--ghost"
              type="button"
              [disabled]="!prepareApiJwt() || preparingApiJwt() || lookingUpLiveSingleton() || preparingRosterUpdate()"
              (click)="lookupLiveSingletonWithApi()"
            >
              {{ lookingUpLiveSingleton() ? 'Looking up singleton…' : 'Optional API live singleton lookup' }}
            </button>
            <button
              class="btn btn--primary"
              type="button"
              [disabled]="!preview() || !prepareApiJwt() || preparingApiJwt() || lookingUpLiveSingleton() || preparingRosterUpdate()"
              (click)="prepareRosterUpdateWithApi()"
            >
              {{ preparingRosterUpdate() ? 'Cross-checking…' : 'Cross-check preview with API' }}
            </button>
          </div>
          @if (prepareError()) {
            <div class="mt-4 rounded-card border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {{ prepareError() }}
            </div>
          }
          @if (liveSingletonLookup(); as lookup) {
            <dl class="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt class="text-text-muted">live singleton status</dt>
                <dd class="mono break-all text-brand">{{ lookup.lookup_status }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">lineage verification</dt>
                <dd class="mono break-all text-brand">{{ lookup.lineage_verification_status }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">expected full puzzle hash</dt>
                <dd class="mono break-all text-brand">{{ lookup.expected_full_puzzle_hash }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">candidates found</dt>
                <dd class="mono break-all text-brand">{{ lookup.candidates_found }}</dd>
              </div>
              @if (lookup.selected_coin; as coin) {
                <div>
                  <dt class="text-text-muted">live singleton coin id</dt>
                  <dd class="mono break-all text-brand">{{ coin.coin_id }}</dd>
                </div>
                <div>
                  <dt class="text-text-muted">live singleton amount</dt>
                  <dd class="mono break-all text-brand">{{ coin.amount }}</dd>
                </div>
              }
            </dl>
          }
          @if (preparedRosterUpdate(); as prepared) {
            <dl class="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt class="text-text-muted">API cross-check status</dt>
                <dd class="mono break-all text-brand">{{ prepared.submission_status }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">local/API comparison</dt>
                <dd class="mono break-all text-brand">{{ optionalApiCrossCheckStatus() }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">activation status</dt>
                <dd class="mono break-all text-brand">{{ prepared.activation_status }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">roster_update_binding_hash</dt>
                <dd class="mono break-all text-brand">{{ prepared.roster_update_binding_hash }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">API new_state_hash</dt>
                <dd class="mono break-all text-brand">{{ prepared.new_state_hash }}</dd>
              </div>
              <div>
                <dt class="text-text-muted">API mirrored spend intent</dt>
                <dd class="mono break-all text-brand">
                  {{ prepared.spend_intent.spend_name }} · 0x{{ prepared.spend_intent.spend_tag.toString(16).padStart(2, '0') }}
                </dd>
              </div>
              <div>
                <dt class="text-text-muted">validation scope</dt>
                <dd class="mono break-all text-brand">{{ prepared.spend_intent.validation_scope }}</dd>
              </div>
            </dl>
            <div class="mt-4 rounded-card border border-white/10 bg-black/20 p-3">
              <div class="mono text-[0.65rem] uppercase tracking-[0.18em] text-text-muted">
                Still missing for local live submission
              </div>
              <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-yellow-100/80">
                @for (item of localMissingForLiveSubmission(); track item) {
                  <li>{{ item }}</li>
                }
              </ul>
            </div>
          }
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <button class="btn btn--ghost" type="button" (click)="downloadUnsignedRosterSpendPackageJson()" [disabled]="!preview()">
            Download unsigned roster spend package
          </button>
          <button class="btn btn--ghost" type="button" disabled>
            Submit roster update spend unavailable
          </button>
        </div>
        @if (unsignedRosterSpendPreflight(); as preflight) {
          <div class="mt-4 rounded-card border border-white/10 bg-black/20 p-4 text-sm">
            <div class="font-display text-lg" [class.text-brand]="preflight.ok" [class.text-red-200]="!preflight.ok">
              Unsigned package preflight: {{ preflight.status }}
            </div>
            @if (preflight.failures.length) {
              <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-red-200">
                @for (failure of preflight.failures; track failure) {
                  <li>{{ failure }}</li>
                }
              </ul>
            } @else {
              <p class="mt-2 text-xs text-text-muted">
                Local-only contract, hash, append-only roster, and credential-leak checks pass.
              </p>
            }
          </div>
        }
      </section>

      @if (copyConfirmation()) {
        <div class="fixed bottom-6 right-6 rounded-card bg-brand px-4 py-3 text-sm text-black shadow-xl">
          {{ copyConfirmation() }}
        </div>
      }
    </section>
  `,
})
export class AddAdminSlotComponent {
  private readonly session = inject(AdminSessionService);
  private readonly wasm = inject(ChiaWasmService);
  private readonly v2 = inject(AdminAuthorityV2Service);
  private readonly rosterUpdate = inject(AdminRosterUpdateService);
  private readonly eip712Leaf = inject(Eip712LeafHashService);
  private readonly evmWallet = inject(EvmWalletService);

  readonly network = environment.chiaNetwork;
  readonly currentAuthorityVersion = signal(1);
  readonly connectingEvm = signal<'injected' | 'walletconnect' | null>(null);
  readonly evmConnectError = signal<string | null>(null);
  readonly recoveringNewAdmin = signal(false);
  readonly newAdminError = signal<string | null>(null);
  readonly newAdminLeaf = signal<Eip712LeafHash | null>(null);
  readonly newAdminAddress = signal<string | null>(null);
  readonly prepareApiJwt = signal<string | null>(null);
  readonly prepareApiJwtExpiresAt = signal<number | null>(null);
  readonly preparingApiJwt = signal(false);
  readonly lookingUpLiveSingleton = signal(false);
  readonly liveSingletonLookup = signal<AdminAuthorityV2LiveSingletonLookup | null>(null);
  readonly preparingRosterUpdate = signal(false);
  readonly prepareError = signal<string | null>(null);
  readonly preparedRosterUpdate = signal<AdminRosterUpdatePrepareResponse | null>(null);
  readonly copyConfirmation = signal<string | null>(null);

  readonly wasmReady = computed(() => this.wasm.ready());
  readonly launcherId = computed(() => environment.populisProtocol.adminAuthorityV2LauncherId || '');
  readonly currentMipsRootHash = computed(() =>
    normalizeHex(environment.populisProtocol.adminAuthorityV2MipsRootHash || ''),
  );
  readonly currentAddress = computed(() => normalizeHex(this.session.subject() ?? ''));
  readonly currentPubkey = computed(() => normalizeHex(this.session.pubkey() ?? ''));
  readonly evmConnected = computed(() => this.evmWallet.isConnected());
  readonly evmAddress = computed(() => this.evmWallet.address());
  readonly nextSlotIndex = computed(() => this.currentAdminLeaf() ? 1 : 0);
  readonly newAuthorityVersion = computed(() => this.currentAuthorityVersion() + 1);
  readonly prepareApiJwtStatus = computed(() => {
    const exp = this.prepareApiJwtExpiresAt();
    if (!this.prepareApiJwt() || !exp) return 'not requested';
    return `expires ${new Date(exp * 1000).toLocaleString()}`;
  });

  readonly currentAdminLeaf = computed<Eip712LeafHash | null>(() => {
    if (!this.wasmReady()) return null;
    const pubkey = this.currentPubkey();
    if (!isHexLength(pubkey, 33)) return null;
    try {
      return this.eip712Leaf.compute(pubkey, this.network);
    } catch {
      return null;
    }
  });

  readonly previewBlocker = computed(() => {
    if (!this.launcherId()) return 'Set adminAuthorityV2LauncherId in the portal environment first.';
    if (!this.currentMipsRootHash()) return 'Set adminAuthorityV2MipsRootHash before building roster spend inputs.';
    if (!this.wasmReady()) return 'Waiting for chia-wallet-sdk WASM.';
    if (!this.currentAdminLeaf()) return 'Sign in as the current admin so slot 0 can be reconstructed.';
    if (!this.newAdminLeaf()) return 'Capture the new admin wallet to compute its EIP-712 leaf.';
    if (this.currentAdminLeaf()?.leaf_hash.toLowerCase() === this.newAdminLeaf()?.leaf_hash.toLowerCase()) {
      return 'The new admin wallet must be different from the current admin wallet.';
    }
    if (this.currentAuthorityVersion() < 1) return 'Current authority_version must be at least 1.';
    return 'Ready.';
  });

  readonly preview = computed<Preview | null>(() => {
    const launcherId = this.launcherId();
    const currentMipsRootHash = this.currentMipsRootHash();
    const currentLeaf = this.currentAdminLeaf();
    const newLeaf = this.newAdminLeaf();
    const currentAddress = this.currentAddress();
    const newAddress = this.newAdminAddress();
    if (!launcherId || !currentMipsRootHash || !currentLeaf || !newLeaf || !currentAddress || !newAddress) return null;
    if (currentLeaf.leaf_hash.toLowerCase() === newLeaf.leaf_hash.toLowerCase()) return null;
    if (this.currentAuthorityVersion() < 1) return null;

    const currentArtifact: AdminRecordsArtifact = {
      version: 1,
      launcher_id: launcherId,
      admin_records: [
        expandedRecord(0, currentAddress, currentLeaf),
      ],
    };
    const artifact: AdminRecordsArtifact = {
      version: 1,
      launcher_id: launcherId,
      admin_records: [
        currentArtifact.admin_records[0],
        expandedRecord(1, normalizeHex(newAddress), newLeaf),
      ],
    };
    const currentAdminRecords: AdminRecord[] = currentArtifact.admin_records.map((record) => ({
      adminIdx: record.admin_idx,
      leaves: record.leaves.map((leaf) => leaf.leaf_hash),
      mWithin: record.m_within,
    }));
    const adminRecords: AdminRecord[] = artifact.admin_records.map((record) => ({
      adminIdx: record.admin_idx,
      leaves: record.leaves.map((leaf) => leaf.leaf_hash),
      mWithin: record.m_within,
    }));
    const newThreshold = adminSupermajorityThreshold(adminRecords.length);
    const mips = this.eip712Leaf.computeMipsRootEip712MOfN(
      [currentLeaf.secp256k1_pubkey, newLeaf.secp256k1_pubkey],
      newThreshold,
      this.network,
    );
    const currentAdminsHash = bytesToHexPrefixed(this.v2.computeAdminsHash(currentAdminRecords));
    const newAdminsHash = bytesToHexPrefixed(this.v2.computeAdminsHash(adminRecords));
    const pendingOpsHash = AdminAuthorityV2Service.EMPTY_LIST_HASH;
    const currentStateHash = bytesToHexPrefixed(
      this.v2.computeStateHash({
        mipsRootHash: currentMipsRootHash,
        adminsHash: currentAdminsHash,
        pendingOpsHash,
        authorityVersion: this.currentAuthorityVersion(),
      }),
    );
    const newStateHash = bytesToHexPrefixed(
      this.v2.computeStateHash({
        mipsRootHash: mips.mips_root_hash,
        adminsHash: newAdminsHash,
        pendingOpsHash,
        authorityVersion: this.newAuthorityVersion(),
      }),
    );
    const rosterUpdateBindingHash = bytesToHexPrefixed(
      this.v2.computeRosterUpdateBindingHash({
        currentMipsRootHash,
        currentAdminsHash,
        currentPendingOpsHash: pendingOpsHash,
        currentAuthorityVersion: this.currentAuthorityVersion(),
        newAdminsHash,
        newMipsRootHash: mips.mips_root_hash,
        newAuthorityVersion: this.newAuthorityVersion(),
      }),
    );

    return {
      launcherId,
      currentAuthorityVersion: this.currentAuthorityVersion(),
      currentMipsRootHash,
      currentAdminsHash,
      currentStateHash,
      newAuthorityVersion: this.newAuthorityVersion(),
      newAdminSlotIndex: 1,
      newThreshold,
      newAdminsHash,
      newMipsRootHash: mips.mips_root_hash,
      newStateHash,
      rosterUpdateBindingHash,
      pendingOpsHash,
      currentAdminRecords,
      adminRecords,
      currentAdminRecordsArtifact: currentArtifact,
      updatedAdminRecordsArtifact: artifact,
      newMipsMemberHashes: mips.member_hashes.map(normalizeHex),
    };
  });

  readonly optionalApiCrossCheckStatus = computed(() => {
    const p = this.preview();
    const prepared = this.preparedRosterUpdate();
    if (!p || !prepared) return 'not checked';
    const mismatches: string[] = [];
    if (!sameHex(prepared.launcher_id, p.launcherId)) mismatches.push('launcher_id');
    if (prepared.current_authority_version !== p.currentAuthorityVersion) mismatches.push('current_authority_version');
    if (prepared.new_authority_version !== p.newAuthorityVersion) mismatches.push('new_authority_version');
    if (!sameHex(prepared.current_mips_root_hash, p.currentMipsRootHash)) mismatches.push('current_mips_root_hash');
    if (!sameHex(prepared.current_admins_hash, p.currentAdminsHash)) mismatches.push('current_admins_hash');
    if (!sameHex(prepared.current_pending_ops_hash, p.pendingOpsHash)) mismatches.push('current_pending_ops_hash');
    if (!sameHex(prepared.new_mips_root_hash, p.newMipsRootHash)) mismatches.push('new_mips_root_hash');
    if (!sameHex(prepared.new_admins_hash, p.newAdminsHash)) mismatches.push('new_admins_hash');
    if (!sameHex(prepared.new_pending_ops_hash, p.pendingOpsHash)) mismatches.push('new_pending_ops_hash');
    if (!sameHex(prepared.new_state_hash, p.newStateHash)) mismatches.push('new_state_hash');
    if (!sameHex(prepared.roster_update_binding_hash, p.rosterUpdateBindingHash)) mismatches.push('roster_update_binding_hash');
    if (prepared.spend_intent.spend_tag !== SPEND_ADMIN_ROSTER_UPDATE) mismatches.push('spend_tag');
    if (!sameHex(prepared.spend_intent.current_state_hash, p.currentStateHash)) mismatches.push('current_state_hash');
    if (!sameHex(prepared.spend_intent.new_state_hash, p.newStateHash)) mismatches.push('spend_intent.new_state_hash');
    if (!sameHex(prepared.spend_intent.roster_update_binding_hash, p.rosterUpdateBindingHash)) mismatches.push('spend_intent.roster_update_binding_hash');
    if (prepared.spend_intent.validation_scope !== 'prepare_only_no_broadcast') mismatches.push('validation_scope');
    return mismatches.length ? `mismatch: ${mismatches.join(', ')}` : 'matches local preview';
  });

  readonly localMissingForLiveSubmission = computed(() => {
    const missing = [
      'current MIPS puzzle reveal matching current.mips_root_hash',
      'current MIPS solution authorized by the active admin quorum',
      'wallet signing and coinset push_transaction wiring for the singleton spend',
    ];
    if (!this.liveSingletonLookup()?.selected_coin) {
      missing.unshift('live singleton coin id and amount from wallet or coinset client');
    }
    return missing;
  });

  readonly adminRecordsJson = computed(() => {
    const p = this.preview();
    return p ? JSON.stringify(p.updatedAdminRecordsArtifact, null, 2) : '';
  });

  readonly previewJson = computed(() => {
    const p = this.preview();
    if (!p) return '';
    return JSON.stringify(
      {
        spend_tag: SPEND_ADMIN_ROSTER_UPDATE,
        spend_name: 'ADMIN_ROSTER_UPDATE',
        launcher_id: p.launcherId,
        current_authority_version: p.currentAuthorityVersion,
        current_mips_root_hash: p.currentMipsRootHash,
        current_admins_hash: p.currentAdminsHash,
        current_state_hash: p.currentStateHash,
        new_authority_version: p.newAuthorityVersion,
        new_admin_slot_index: p.newAdminSlotIndex,
        new_threshold: p.newThreshold,
        new_admins_hash: p.newAdminsHash,
        new_mips_root_hash: p.newMipsRootHash,
        pending_ops_hash: p.pendingOpsHash,
        new_state_hash: p.newStateHash,
        roster_update_binding_hash: p.rosterUpdateBindingHash,
        admin_records: p.updatedAdminRecordsArtifact,
        submission_status: 'preview_only_roster_spend_signer_not_wired',
      },
      null,
      2,
    );
  });

  readonly unsignedRosterSpendPackageJson = computed(() => {
    const p = this.preview();
    if (!p) return '';
    const prepared = this.preparedRosterUpdate();
    const liveSingleton = this.liveSingletonLookup();
    return JSON.stringify(
      {
        version: 1,
        kind: 'admin_authority_v2_roster_update_unsigned_package',
        network: this.network,
        package_status: 'unsigned_package_only',
        signing_status: 'not_signed',
        broadcast_status: 'not_built_not_submitted',
        backend_dependency: 'optional_admin_cross_check_only',
        launcher_id: p.launcherId,
        activation_status: 'candidate_not_active_until_admin_roster_update_confirms',
        spend_intent: {
          kind: 'admin_authority_v2_roster_update',
          spend_tag: SPEND_ADMIN_ROSTER_UPDATE,
          spend_name: 'ADMIN_ROSTER_UPDATE',
          launcher_id: p.launcherId,
          current_state_hash: p.currentStateHash,
          new_state_hash: p.newStateHash,
          roster_update_binding_hash: p.rosterUpdateBindingHash,
          binding_hash_source: 'local_admin_authority_v2_service',
          validation_scope: 'local_unsigned_package_no_broadcast',
        },
        current: {
          authority_version: p.currentAuthorityVersion,
          mips_root_hash: p.currentMipsRootHash,
          admins_hash: p.currentAdminsHash,
          state_hash: p.currentStateHash,
          pending_ops_hash: p.pendingOpsHash,
          admin_records: p.currentAdminRecordsArtifact.admin_records,
        },
        update: {
          new_authority_version: p.newAuthorityVersion,
          new_admin_record: p.updatedAdminRecordsArtifact.admin_records[p.newAdminSlotIndex],
          new_threshold: p.newThreshold,
          new_mips_member_hashes: p.newMipsMemberHashes,
          new_mips_root_hash: p.newMipsRootHash,
          new_admins_hash: p.newAdminsHash,
          new_pending_ops_hash: p.pendingOpsHash,
          new_state_hash: p.newStateHash,
          roster_update_binding_hash: p.rosterUpdateBindingHash,
          updated_admin_records: p.updatedAdminRecordsArtifact.admin_records,
        },
        live_singleton: {
          source: liveSingleton?.selected_coin ? 'optional_api_lookup' : 'operator_wallet_or_coinset_client',
          required_amount: 1,
          selected_coin: liveSingleton?.selected_coin ?? null,
        },
        required_local_signer_inputs: this.localMissingForLiveSubmission(),
        optional_attachments: {
          api_cross_check_status: this.optionalApiCrossCheckStatus(),
          api_cross_check: prepared,
          api_live_singleton_lookup: liveSingleton,
        },
      },
      null,
      2,
    );
  });

  readonly unsignedRosterSpendPreflight = computed<AdminRosterSpendPackagePreflight | null>(() => {
    const json = this.unsignedRosterSpendPackageJson();
    if (!json) return null;
    try {
      return this.v2.validateUnsignedRosterSpendPackage(JSON.parse(json) as unknown);
    } catch (e) {
      return {
        ok: false,
        status: 'fails local checks',
        failures: [`local preflight failed to parse package: ${formatError(e)}`],
      };
    }
  });

  constructor() {
    effect((onCleanup) => {
      const msg = this.copyConfirmation();
      if (!msg) return;
      const t = setTimeout(() => this.copyConfirmation.set(null), 3000);
      onCleanup(() => clearTimeout(t));
    });
  }

  setCurrentAuthorityVersion(value: string): void {
    const n = Number(value);
    this.currentAuthorityVersion.set(Number.isInteger(n) && n >= 1 ? n : 1);
    this.preparedRosterUpdate.set(null);
    this.prepareError.set(null);
  }

  async connectInjected(): Promise<void> {
    await this.connectEvm('injected');
  }

  async connectWalletConnect(): Promise<void> {
    await this.connectEvm('walletconnect');
  }

  async recoverNewAdminFromWallet(): Promise<void> {
    if (this.recoveringNewAdmin()) return;
    this.newAdminError.set(null);
    if (!this.evmConnected()) {
      this.newAdminError.set('Connect the new admin EVM wallet first.');
      return;
    }
    this.recoveringNewAdmin.set(true);
    try {
      const { pubkey, address } = await this.evmWallet.recoverFirstAdminPubkey();
      const leaf = this.eip712Leaf.compute(pubkey, this.network);
      this.newAdminLeaf.set(leaf);
      this.newAdminAddress.set(normalizeHex(address));
      this.preparedRosterUpdate.set(null);
      this.prepareError.set(null);
    } catch (e) {
      this.newAdminError.set(formatError(e));
    } finally {
      this.recoveringNewAdmin.set(false);
    }
  }

  downloadAdminRecordsJson(): void {
    const json = this.adminRecordsJson();
    if (!json) return;
    this.downloadJson('admin_records.json', json);
  }

  downloadPreviewJson(): void {
    const json = this.previewJson();
    if (!json) return;
    this.downloadJson('admin_authority_v2_add_admin_slot_preview.json', json);
  }

  downloadUnsignedRosterSpendPackageJson(): void {
    const json = this.unsignedRosterSpendPackageJson();
    if (!json) return;
    this.downloadJson('admin_authority_v2_roster_update_unsigned_package.json', json);
  }

  async copyPreviewJson(): Promise<void> {
    const json = this.previewJson();
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      this.copyConfirmation.set('Copied roster preview.');
    } catch {
      this.copyConfirmation.set('Copy failed — select and copy manually.');
    }
  }

  async authorizeRosterUpdateApi(): Promise<void> {
    if (this.preparingApiJwt()) return;
    const owner = this.currentAddress();
    const walletAddress = normalizeHex(this.evmAddress() ?? '');
    if (!owner) {
      this.prepareError.set('Sign in as the current admin first.');
      return;
    }
    if (!walletAddress) {
      this.prepareError.set('Connect the current admin EVM wallet first.');
      return;
    }
    if (owner.toLowerCase() !== walletAddress.toLowerCase()) {
      this.prepareError.set(
        `Connect the current admin wallet ${owner}; connected wallet is ${walletAddress}.`,
      );
      return;
    }
    this.prepareError.set(null);
    this.preparedRosterUpdate.set(null);
    this.prepareApiJwt.set(null);
    this.prepareApiJwtExpiresAt.set(null);
    this.liveSingletonLookup.set(null);
    this.preparingApiJwt.set(true);
    try {
      const challenge = await this.rosterUpdate.requestAdminChallenge(owner);
      const signature = await this.evmWallet.signTypedData(challenge.typed_data);
      const login = await this.rosterUpdate.loginAdmin({
        owner,
        nonce: challenge.nonce,
        signature,
        auth_type: 'evm',
      });
      this.prepareApiJwt.set(login.jwt);
      this.prepareApiJwtExpiresAt.set(login.expires_at);
    } catch (e) {
      this.prepareError.set(formatError(e));
    } finally {
      this.preparingApiJwt.set(false);
    }
  }

  async lookupLiveSingletonWithApi(): Promise<void> {
    const jwt = this.prepareApiJwt();
    if (!jwt) {
      this.prepareError.set('Authorize optional API checks with the current admin wallet first.');
      return;
    }
    this.prepareError.set(null);
    this.lookingUpLiveSingleton.set(true);
    try {
      const lookup = await this.rosterUpdate.lookupLiveSingleton(jwt);
      this.liveSingletonLookup.set(lookup);
    } catch (e) {
      this.prepareError.set(formatError(e));
    } finally {
      this.lookingUpLiveSingleton.set(false);
    }
  }

  async prepareRosterUpdateWithApi(): Promise<void> {
    const p = this.preview();
    if (!p) {
      this.prepareError.set(this.previewBlocker());
      return;
    }
    const jwt = this.prepareApiJwt();
    if (!jwt) {
      this.prepareError.set('Authorize optional API checks with the current admin wallet first.');
      return;
    }
    this.prepareError.set(null);
    this.preparedRosterUpdate.set(null);
    this.preparingRosterUpdate.set(true);
    try {
      const prepared = await this.rosterUpdate.prepare(jwt, {
        updated_admin_records: p.updatedAdminRecordsArtifact as unknown as Record<string, unknown>,
        current_authority_version: p.currentAuthorityVersion,
        current_mips_root_hash: p.currentMipsRootHash,
        current_admins_hash: p.currentAdminsHash,
        current_pending_ops_hash: p.pendingOpsHash,
        new_authority_version: p.newAuthorityVersion,
        new_mips_root_hash: p.newMipsRootHash,
      });
      this.preparedRosterUpdate.set(prepared);
    } catch (e) {
      this.prepareError.set(formatError(e));
    } finally {
      this.preparingRosterUpdate.set(false);
    }
  }

  private async connectEvm(kind: 'injected' | 'walletconnect'): Promise<void> {
    if (this.connectingEvm()) return;
    this.evmConnectError.set(null);
    this.connectingEvm.set(kind);
    try {
      if (kind === 'injected') {
        await this.evmWallet.connectInjected();
      } else {
        await this.evmWallet.connectWalletConnect();
      }
    } catch (e) {
      this.evmConnectError.set(formatError(e));
    } finally {
      this.connectingEvm.set(null);
    }
  }

  private downloadJson(filename: string, json: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

function expandedRecord(adminIdx: number, address: string, leaf: Eip712LeafHash): ExpandedAdminRecord {
  return {
    admin_idx: adminIdx,
    m_within: 1,
    leaves: [
      {
        kind: 'eip712_member',
        leaf_hash: normalizeHex(leaf.leaf_hash),
        evm_address: normalizeHex(address),
        secp256k1_pubkey: normalizeHex(leaf.secp256k1_pubkey),
        type_hash: normalizeHex(leaf.type_hash),
        prefix_and_domain_separator: normalizeHex(leaf.prefix_and_domain_separator),
      },
    ],
  };
}

function adminSupermajorityThreshold(adminCount: number): number {
  if (!Number.isInteger(adminCount) || adminCount < 1) {
    throw new Error('admin_count must be >= 1');
  }
  return Math.floor((2 * adminCount + 2) / 3);
}

function normalizeHex(value: string): string {
  const lower = value.trim().toLowerCase();
  if (!lower) return '';
  return lower.startsWith('0x') ? lower : `0x${lower}`;
}

function sameHex(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}

function isHexLength(value: string, bytes: number): boolean {
  const normalized = normalizeHex(value);
  return new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(normalized);
}
