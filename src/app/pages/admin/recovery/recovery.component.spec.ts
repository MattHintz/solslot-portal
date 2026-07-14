import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { sha256 } from 'ethers';

import {
  AdminBootstrapService,
  BootstrapRecoveryAnchorVerifyResponse,
} from '../../../services/admin-bootstrap.service';
import {
  DiscoveredRecoveryAnchor,
  RecoveryAnchorDiscoveryReport,
  RecoveryAnchorDiscoveryService,
} from '../../../services/recovery-anchor-discovery.service';
import { RecoveryComponent } from './recovery.component';

const launcherId = `0x${'88'.repeat(32)}`;
const adminsHash = `0x${'aa'.repeat(32)}`;
const mipsRoot = `0x${'bb'.repeat(32)}`;
const protocol = {
  pool_launcher_id: `0x${'11'.repeat(32)}`,
  did_launcher_id: `0x${'22'.repeat(32)}`,
};
const adminRecords = {
  version: 1,
  launcher_id: launcherId,
  admin_records: [
    {
      admin_idx: 0,
      m_within: 1,
      eip712_member: {
        leaf_hash: `0x${'01'.repeat(32)}`,
        evm_address: `0x${'12'.repeat(20)}`,
        secp256k1_pubkey: `0x02${'34'.repeat(32)}`,
      },
    },
  ],
};
const portalRuntimeConfig = {
  version: 1,
  network: 'testnet11',
  protocol,
  admin_authority_v2: {
    launcher_id: launcherId,
    admins_hash: adminsHash,
    mips_root: mipsRoot,
    authority_version: 1,
    admin_records_hash: contentHash(adminRecords),
  },
};
const bootstrapManifest = {
  version: 1,
  network: 'testnet11',
  protocol,
  admin_authority_v2: {
    launcher_id: launcherId,
    admins_hash: adminsHash,
    mips_root: mipsRoot,
    authority_version: 1,
  },
  artifact_hashes: {
    admin_records_json: contentHash(adminRecords),
    portal_runtime_config_json: contentHash(portalRuntimeConfig),
  },
};
const recoveryAnchorPayload = {
  version: 1,
  tag: 'SOLSLOT_BOOTSTRAP_V2',
  network: 'testnet11',
  admin_authority_v2_launcher_id: launcherId,
  authority_version: 1,
  bootstrap_manifest_hash: contentHash(bootstrapManifest),
  portal_runtime_config_hash: contentHash(portalRuntimeConfig),
  admin_records_hash: contentHash(adminRecords),
};
const discoveredAnchor: DiscoveredRecoveryAnchor = {
  markerCoinId: `0x${'cc'.repeat(32)}`,
  parentCoinId: `0x${'dd'.repeat(32)}`,
  markerPuzzleHash: `0x${'ee'.repeat(32)}`,
  markerCoinAmountMojos: 1,
  confirmedBlockIndex: 123,
  spentBlockIndex: 0,
  timestamp: 1_700_000_000,
  tagMemoUtf8: 'SOLSLOT_BOOTSTRAP_V2',
  payloadMemoUtf8: JSON.stringify(recoveryAnchorPayload),
  payloadHash: contentHash(recoveryAnchorPayload),
  bootstrapRecoveryAnchor: recoveryAnchorPayload,
};
const discoveryReport: RecoveryAnchorDiscoveryReport = {
  tagMemoUtf8: 'SOLSLOT_BOOTSTRAP_V2',
  tagMemoHex: '0x534f4c534c4f545f424f4f5453545241505f5632',
  scannedCandidateCount: 1,
  anchors: [discoveredAnchor],
  rejectedCandidates: [],
};
const verifiedResponse: BootstrapRecoveryAnchorVerifyResponse = {
  verified: true,
  deployment_manifest_verified: false,
  live_authority_verified: false,
  network: 'testnet11',
  admin_authority_v2_launcher_id: launcherId,
  admins_hash: adminsHash,
  mips_root: mipsRoot,
  authority_version: 1,
  bootstrap_manifest_hash: recoveryAnchorPayload.bootstrap_manifest_hash,
  portal_runtime_config_hash: recoveryAnchorPayload.portal_runtime_config_hash,
  admin_records_hash: recoveryAnchorPayload.admin_records_hash,
};

describe('RecoveryComponent', () => {
  let fixture: ComponentFixture<RecoveryComponent>;
  let component: RecoveryComponent;
  let discovery: jasmine.SpyObj<RecoveryAnchorDiscoveryService>;
  let bootstrap: jasmine.SpyObj<AdminBootstrapService>;

  beforeEach(async () => {
    discovery = jasmine.createSpyObj<RecoveryAnchorDiscoveryService>(
      'RecoveryAnchorDiscoveryService',
      ['discoverAnchors'],
    );
    bootstrap = jasmine.createSpyObj<AdminBootstrapService>('AdminBootstrapService', [
      'verifyRecoveryArtifacts',
    ]);
    discovery.discoverAnchors.and.resolveTo(discoveryReport);
    bootstrap.verifyRecoveryArtifacts.and.resolveTo(verifiedResponse);

    await TestBed.configureTestingModule({
      imports: [RecoveryComponent],
      providers: [
        provideRouter([]),
        { provide: RecoveryAnchorDiscoveryService, useValue: discovery },
        { provide: AdminBootstrapService, useValue: bootstrap },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecoveryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('scans chain anchors and renders the selected recovery payload', async () => {
    await component.scanAnchors();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(discovery.discoverAnchors).toHaveBeenCalledOnceWith();
    expect(component.selectedAnchor()?.markerCoinId).toBe(discoveredAnchor.markerCoinId);
    expect(text).toContain('Found 1 verified anchor');
    expect(text).toContain(launcherId);
    expect(text).toContain('bootstrap_recovery_anchor.json payload');
  });

  it('renders rejected anchor candidate reasons for operator review', async () => {
    discovery.discoverAnchors.and.resolveTo({
      ...discoveryReport,
      scannedCandidateCount: 2,
      rejectedCandidates: [
        {
          markerCoinId: `0x${'99'.repeat(32)}`,
          parentCoinId: `0x${'98'.repeat(32)}`,
          confirmedBlockIndex: 456,
          reason: 'parent spend puzzle/solution unavailable',
        },
      ],
    });

    await component.scanAnchors();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Rejected 1 malformed candidate');
    expect(text).toContain('Rejected candidate details');
    expect(text).toContain(`marker=0x${'99'.repeat(32)}`);
    expect(text).toContain('parent spend puzzle/solution unavailable');
  });

  it('verifies pasted artifacts after local hash checks pass', async () => {
    await component.scanAnchors();
    component.bootstrapManifestText.set(JSON.stringify(bootstrapManifest));
    component.portalRuntimeConfigText.set(JSON.stringify(portalRuntimeConfig));
    component.adminRecordsText.set(JSON.stringify(adminRecords));
    fixture.detectChanges();

    expect(component.localHashChecks().map((check) => check.status)).toEqual([
      'match',
      'match',
      'match',
    ]);

    await component.verifyArtifacts();
    fixture.detectChanges();

    expect(bootstrap.verifyRecoveryArtifacts).toHaveBeenCalledOnceWith({
      bootstrap_recovery_anchor: recoveryAnchorPayload,
      bootstrap_manifest: bootstrapManifest,
      portal_runtime_config: portalRuntimeConfig,
      admin_records: adminRecords,
      deployment_manifest: null,
    });
    expect(component.verifyState().kind).toBe('verified');
    expect(fixture.nativeElement.textContent).toContain('Recovery artifacts verified');
  });

  it('refuses to call the verifier when a local artifact hash mismatches', async () => {
    await component.scanAnchors();
    component.bootstrapManifestText.set(JSON.stringify(bootstrapManifest));
    component.portalRuntimeConfigText.set(JSON.stringify(portalRuntimeConfig));
    component.adminRecordsText.set(JSON.stringify({ ...adminRecords, tampered: true }));
    fixture.detectChanges();

    await component.verifyArtifacts();
    fixture.detectChanges();

    expect(bootstrap.verifyRecoveryArtifacts).not.toHaveBeenCalled();
    expect(component.verifyState().kind).toBe('error');
    expect(fixture.nativeElement.textContent).toContain('admin_records.json mismatch');
  });

  it('surfaces verifier rejections without treating artifacts as restored', async () => {
    bootstrap.verifyRecoveryArtifacts.and.resolveTo({
      verified: false,
      deployment_manifest_verified: false,
      live_authority_verified: false,
      error: 'admin_records.json content hash mismatch',
    });
    await component.scanAnchors();
    component.bootstrapManifestText.set(JSON.stringify(bootstrapManifest));
    component.portalRuntimeConfigText.set(JSON.stringify(portalRuntimeConfig));
    component.adminRecordsText.set(JSON.stringify(adminRecords));
    fixture.detectChanges();

    await component.verifyArtifacts();
    fixture.detectChanges();

    expect(component.verifyState().kind).toBe('rejected');
    expect(fixture.nativeElement.textContent).toContain('Verifier rejected artifacts');
    expect(fixture.nativeElement.textContent).not.toContain('Recovery artifacts verified');
  });
});

function contentHash(value: unknown): string {
  return `sha256:${sha256(new TextEncoder().encode(canonicalJson(value))).slice(2)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
