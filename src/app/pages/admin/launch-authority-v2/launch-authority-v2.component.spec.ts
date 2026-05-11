import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AdminAuthorityV2Service } from '../../../services/admin-authority-v2/admin-authority-v2.service';
import { AdminBootstrapService } from '../../../services/admin-bootstrap.service';
import { AdminSessionService } from '../../../services/admin-session.service';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import { ChiaWasmService } from '../../../services/chia-wasm.service';
import { Eip712LeafHashService } from '../../../services/eip712-leaf-hash.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { WalletCoinPickerService } from '../../../services/wallet-coin-picker.service';
import { OnChainStateService } from '../../../services/on-chain-state.service';
import { LaunchAuthorityV2Component } from './launch-authority-v2.component';

describe('LaunchAuthorityV2Component', () => {
  let fixture: ComponentFixture<LaunchAuthorityV2Component>;
  let session: jasmine.SpyObj<Pick<AdminSessionService, 'isAuthenticated'>>;
  let bootstrap: jasmine.SpyObj<
    Pick<
      AdminBootstrapService,
      | 'getBootstrapStatus'
      | 'finalizeBootstrap'
      | 'verifyRecoveryArtifacts'
      | 'getRecoveryAnchorPublishIntent'
      | 'createRecoveryAnchorCoinPreview'
    >
  >;
  let onChain: jasmine.SpyObj<Pick<OnChainStateService, 'getAuthorityV2'>>;
  let evmWallet: jasmine.SpyObj<Pick<EvmWalletService, 'recoverFirstAdminPubkey'>>;
  let eip712Leaf: jasmine.SpyObj<Pick<Eip712LeafHashService, 'compute' | 'computeMipsRoot1Of1'>>;

  const pubkey = `0x02${'11'.repeat(32)}`;
  const evmAddress = `0xAbCdEf${'0'.repeat(30)}1234`;
  const rawSignature = `0x${'99'.repeat(65)}`;
  const leaf = {
    leaf_hash: `0x${'aa'.repeat(32)}`,
    secp256k1_pubkey: pubkey,
    type_hash: `0x${'bb'.repeat(32)}`,
    prefix_and_domain_separator: `0x1901${'cc'.repeat(32)}`,
    network: 'testnet11' as const,
  };
  const mipsRoot = `0x${'dd'.repeat(32)}`;
  const launcherId = `0x${'ee'.repeat(32)}`;

  beforeEach(async () => {
    session = jasmine.createSpyObj('AdminSessionService', ['isAuthenticated']);
    bootstrap = jasmine.createSpyObj('AdminBootstrapService', [
      'getBootstrapStatus',
      'finalizeBootstrap',
      'verifyRecoveryArtifacts',
      'getRecoveryAnchorPublishIntent',
      'createRecoveryAnchorCoinPreview',
    ]);
    onChain = jasmine.createSpyObj('OnChainStateService', ['getAuthorityV2']);
    evmWallet = jasmine.createSpyObj('EvmWalletService', ['recoverFirstAdminPubkey']);
    eip712Leaf = jasmine.createSpyObj('Eip712LeafHashService', [
      'compute',
      'computeMipsRoot1Of1',
    ]);

    await TestBed.configureTestingModule({
      imports: [LaunchAuthorityV2Component],
      providers: [
        provideRouter([]),
        { provide: AdminSessionService, useValue: session },
        { provide: AdminBootstrapService, useValue: bootstrap },
        { provide: ChiaWasmService, useValue: { ready: () => true } },
        {
          provide: ChiaWalletService,
          useValue: {
            isConnected: () => false,
            hasGoby: () => false,
            hasSage: () => false,
            connectionKind: () => null,
            pubkey: () => null,
          },
        },
        {
          provide: AdminAuthorityV2Service,
          useValue: {
            computeAdminsHash: () => new Uint8Array(32),
            computeStateHash: () => new Uint8Array(32),
            makeInnerPuzzleHash: () => new Uint8Array(32),
            computeLaunchOutputs: () => ({
              launcherId: `0x${'ee'.repeat(32)}`,
              launcherCoin: {
                parentCoinInfo: `0x${'00'.repeat(32)}`,
                puzzleHash: `0x${'00'.repeat(32)}`,
                amount: 1n,
              },
              eveInnerPuzzleHash: `0x${'00'.repeat(32)}`,
              eveFullPuzzleHash: `0x${'00'.repeat(32)}`,
              eveCoin: {
                parentCoinInfo: `0x${'ee'.repeat(32)}`,
                puzzleHash: `0x${'00'.repeat(32)}`,
                amount: 1n,
              },
              launcherAnnouncementMessage: `0x${'00'.repeat(32)}`,
              launcherAnnouncementId: `0x${'00'.repeat(32)}`,
            }),
          },
        },
        { provide: EvmWalletService, useValue: evmWallet },
        { provide: Eip712LeafHashService, useValue: eip712Leaf },
        { provide: WalletCoinPickerService, useValue: {} },
        { provide: OnChainStateService, useValue: onChain },
      ],
    }).compileComponents();
  });

  async function create(): Promise<LaunchAuthorityV2Component> {
    fixture = TestBed.createComponent(LaunchAuthorityV2Component);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('shows permanent admin navigation without checking bootstrap status', async () => {
    session.isAuthenticated.and.returnValue(true);

    const component = await create();
    const text = fixture.nativeElement.textContent as string;

    expect(component.launchAccessMode()).toBe('permanent-admin');
    expect(bootstrap.getBootstrapStatus).not.toHaveBeenCalled();
    expect(text).toContain('← Admin desk');
    expect(text).not.toContain('Genesis bootstrap access');
  });

  it('shows temporary bootstrap warning for unlocked bootstrap access', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({
      locked: false,
      authenticated: true,
      expires_at: 1234,
    });

    const component = await create();
    const text = fixture.nativeElement.textContent as string;

    expect(component.launchAccessMode()).toBe('bootstrap');
    expect(bootstrap.getBootstrapStatus).toHaveBeenCalledOnceWith();
    expect(text).toContain('← Genesis ceremony');
    expect(text).toContain('Create first-admin authority');
    expect(text).toContain('Continue the same genesis ceremony');
    expect(text).toContain('Genesis bootstrap access');
    expect(text).toContain('This first-admin step was opened');
    expect(text).toContain('not permanent admin authority');
    expect(text).toContain('does not open the normal Admin Desk');
    expect(text).toContain('Bootstrap session expires at 1234');
  });

  it('shows locked bootstrap prompt when bootstrapper is locked', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: true, authenticated: false });

    const component = await create();
    const text = fixture.nativeElement.textContent as string;

    expect(component.launchAccessMode()).toBe('locked');
    expect(text).toContain('Bootstrap access unavailable');
    expect(text).toContain('The bootstrapper is locked');
  });

  it('shows missing bootstrap prompt when no bootstrap session is active', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: false, authenticated: false });

    const component = await create();
    const text = fixture.nativeElement.textContent as string;

    expect(component.launchAccessMode()).toBe('missing');
    expect(text).toContain('Bootstrap session unavailable');
    expect(text).toContain('Return to genesis to start or refresh the bootstrap session');
  });

  it('does not persist bootstrap credentials while checking access mode', async () => {
    const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: false, authenticated: true });

    await create();

    expect(setItem).not.toHaveBeenCalled();
  });

  it('recovers and displays the first-admin slot 0 artifact preview', async () => {
    session.isAuthenticated.and.returnValue(true);
    evmWallet.recoverFirstAdminPubkey.and.resolveTo({ pubkey, address: evmAddress });
    eip712Leaf.compute.and.returnValue(leaf);
    eip712Leaf.computeMipsRoot1Of1.and.returnValue({
      mips_root_hash: mipsRoot,
      shape: 'mofn1of1',
    });
    const component = await create();

    await component.recoverFirstAdminFromWallet();
    component.useFirstAdminAsController();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;

    expect(evmWallet.recoverFirstAdminPubkey).toHaveBeenCalledOnceWith();
    expect(eip712Leaf.compute).toHaveBeenCalledOnceWith(pubkey, 'testnet11');
    expect(component.adminRecordsInput()).toBe(`0 ${leaf.leaf_hash} 1`);
    expect(text).toContain('First admin recovered');
    expect(text).toContain('Admin slot:');
    expect(text).toContain('m_within:');
    expect(text).toContain(evmAddress);
    expect(text).toContain(pubkey);
    expect(text).toContain(leaf.leaf_hash);
    expect(text).toContain(leaf.type_hash);
    expect(text).toContain('Network/domain:');
    expect(text).toContain(leaf.prefix_and_domain_separator);
    expect(text).toContain(mipsRoot);
    expect(text).toContain('Wallet signature is proof-of-possession only');
    expect(text).not.toContain(rawSignature);
  });

  it('builds admin_records.json for admin slot 0 without secrets or signatures', async () => {
    session.isAuthenticated.and.returnValue(true);
    const component = await create();
    component.firstAdminLeaf.set(leaf);
    component.firstAdminAddress.set(evmAddress);
    component.submitState.set({ kind: 'submitted', launcherId, statusFromCoinset: null });

    const json = component.buildAdminRecordsJson();

    expect(json).not.toBeNull();
    const parsed = JSON.parse(json as string);
    expect(parsed).toEqual({
      version: 1,
      launcher_id: launcherId,
      admin_records: [
        {
          admin_idx: 0,
          m_within: 1,
          leaves: [
            {
              kind: 'eip712_member',
              leaf_hash: leaf.leaf_hash,
              evm_address: evmAddress.toLowerCase(),
              secp256k1_pubkey: leaf.secp256k1_pubkey,
              type_hash: leaf.type_hash,
              prefix_and_domain_separator: leaf.prefix_and_domain_separator,
            },
          ],
        },
      ],
    });
    const lower = (json as string).toLowerCase();
    for (const forbidden of [
      'populis_admin_token',
      'populis_bootstrap_session',
      'bootstrap_session',
      'bearer',
      'jwt',
      'secret',
      'signature',
      'nonce',
      rawSignature.toLowerCase(),
    ]) {
      expect(lower).not.toContain(forbidden);
    }
  });

  // ─── Phase 0 Brick 0.4E: bootstrap finalize UI ─────────────────────
  // The shared AdminAuthorityV2Service mock returns ``new Uint8Array(32)``
  // from ``computeAdminsHash``, so the real ``component.adminsHash``
  // computed signal resolves to ``0x`` + 64 zeros once a valid
  // ``adminRecordsInput`` is set.  We assert against that exact value
  // rather than overriding the signal so the finalize body that the
  // component sends really does match what the live wizard would emit.
  const adminsHash = `0x${'00'.repeat(32)}`;
  const mipsRootHash = `0x${'cd'.repeat(32)}`;
  const chainStateHash = `0x${'00'.repeat(32)}`;
  const protocol = {
    pool_launcher_id: `0x${'11'.repeat(32)}`,
    did_launcher_id: `0x${'22'.repeat(32)}`,
    tracker_launcher_id: `0x${'33'.repeat(32)}`,
    pgt_tail_hash: `0x${'44'.repeat(32)}`,
    pool_token_tail_hash: `0x${'55'.repeat(32)}`,
    pool_full_puzhash: `0x${'66'.repeat(32)}`,
    tracker_full_puzhash: `0x${'77'.repeat(32)}`,
  };
  const artifactHashes = {
    deployment_manifest_json: `sha256:${'01'.repeat(32)}`,
    admin_records_json: `sha256:${'12'.repeat(32)}`,
    portal_runtime_config_json: `sha256:${'23'.repeat(32)}`,
  };
  const recoveryAnchor = {
    version: 1,
    tag: 'POPULIS_BOOTSTRAP_V1',
    network: 'testnet11',
    admin_authority_v2_launcher_id: launcherId,
    authority_version: 1,
    bootstrap_manifest_hash: `sha256:${'34'.repeat(32)}`,
    portal_runtime_config_hash: `sha256:${'23'.repeat(32)}`,
    admin_records_hash: `sha256:${'12'.repeat(32)}`,
  };
  const verifiedRecoveryResponse = {
    verified: true,
    deployment_manifest_verified: false,
    live_authority_verified: false,
    network: 'testnet11',
    admin_authority_v2_launcher_id: launcherId,
    admins_hash: adminsHash,
    mips_root: mipsRootHash,
    authority_version: 1,
    bootstrap_manifest_hash: recoveryAnchor.bootstrap_manifest_hash,
    portal_runtime_config_hash: recoveryAnchor.portal_runtime_config_hash,
    admin_records_hash: recoveryAnchor.admin_records_hash,
    deployment_manifest_hash: null,
    error: null,
  };
  const publishIntent = {
    network: 'testnet11',
    marker_coin_amount_mojos: 1,
    admin_authority_v2_launcher_id: launcherId,
    authority_version: 1,
    bootstrap_manifest_hash: recoveryAnchor.bootstrap_manifest_hash,
    portal_runtime_config_hash: recoveryAnchor.portal_runtime_config_hash,
    admin_records_hash: recoveryAnchor.admin_records_hash,
    tag_memo_utf8: 'POPULIS_BOOTSTRAP_V1',
    tag_memo_hex: '0x504f50554c49535f424f4f5453545241505f5631',
    payload_memo_json: recoveryAnchor,
    payload_memo_utf8: JSON.stringify(recoveryAnchor),
    payload_memo_hex: `0x${'ab'.repeat(32)}`,
    memos_hex: ['0x504f50554c49535f424f4f5453545241505f5631', `0x${'ab'.repeat(32)}`],
    payload_hash: `sha256:${'45'.repeat(32)}`,
  };
  const createCoinPreview = {
    condition_opcode: 51,
    marker_puzzle_hash: `0x${'ef'.repeat(32)}`,
    marker_coin_amount_mojos: 1,
    tag_memo_hex: publishIntent.tag_memo_hex,
    payload_memo_hex: publishIntent.payload_memo_hex,
    memos_hex: publishIntent.memos_hex,
    condition_hex: [51, `0x${'ef'.repeat(32)}`, 1, publishIntent.memos_hex] as [
      number,
      string,
      number,
      [string, string],
    ],
    payload_hash: publishIntent.payload_hash,
  };
  const finalizedResponse = {
    locked: true,
    bootstrap_manifest: {
      version: 1,
      network: 'testnet11',
      protocol,
      admin_authority_v2: {
        launcher_id: launcherId,
        admins_hash: adminsHash,
        mips_root: mipsRootHash,
        authority_version: 1,
      },
      artifact_hashes: artifactHashes,
    },
    portal_runtime_config: {
      version: 1,
      network: 'testnet11',
      protocol,
      admin_authority_v2: {
        launcher_id: launcherId,
        admins_hash: adminsHash,
        mips_root: mipsRootHash,
        authority_version: 1,
        admin_records_hash: `sha256:${'12'.repeat(32)}`,
      },
    },
    bootstrap_recovery_anchor: recoveryAnchor,
  };

  function primeFinalizeReadyState(component: LaunchAuthorityV2Component): void {
    component.firstAdminLeaf.set(leaf);
    component.firstAdminAddress.set(evmAddress);
    component.submitState.set({
      kind: 'submitted',
      launcherId,
      statusFromCoinset: 'ACCEPTED',
    });
    component.adminRecordsInput.set(`0 ${leaf.leaf_hash} 1`);
    component.mipsRootHashInput.set(mipsRootHash);
    // ``computedPreview`` requires a non-empty 32-byte parent coin id;
    // without it the entire preview/submitted card stays hidden and
    // the finalize block never renders into the DOM.
    component.parentCoinIdInput.set(`0x${'ee'.repeat(32)}`);
  }

  function configureBootstrapMode(): void {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({
      locked: false,
      authenticated: true,
      expires_at: 1234,
    });
    bootstrap.verifyRecoveryArtifacts.and.resolveTo(verifiedRecoveryResponse);
    bootstrap.getRecoveryAnchorPublishIntent.and.resolveTo(publishIntent);
    bootstrap.createRecoveryAnchorCoinPreview.and.resolveTo(createCoinPreview);
    onChain.getAuthorityV2.and.resolveTo({
      enabled: true,
      launcher_id: launcherId,
      mips_root_hash: null,
      admins_hash: null,
      pending_ops_hash: null,
      authority_version: null,
      state_hash: chainStateHash,
      phase: '2-informational-only',
      gating_source: 'POPULIS_ADMIN_PUBKEY_ALLOWLIST',
      informational_only: true,
    });
  }

  it('hides the finalize action in permanent-admin mode even after launch', async () => {
    session.isAuthenticated.and.returnValue(true);
    const component = await create();
    primeFinalizeReadyState(component);
    fixture.detectChanges();

    expect(component.canFinalizeBootstrap()).toBeFalse();
    expect(fixture.nativeElement.textContent).not.toContain('Finalize genesis artifacts');
    expect(bootstrap.finalizeBootstrap).not.toHaveBeenCalled();
  });

  it('hides the finalize action when bootstrap session is missing', async () => {
    session.isAuthenticated.and.returnValue(false);
    bootstrap.getBootstrapStatus.and.resolveTo({ locked: false, authenticated: false });
    const component = await create();
    primeFinalizeReadyState(component);
    fixture.detectChanges();

    expect(component.canFinalizeBootstrap()).toBeFalse();
    expect(fixture.nativeElement.textContent).not.toContain('Finalize genesis artifacts');
  });

  it('shows the finalize action in bootstrap mode after launch + first admin', async () => {
    configureBootstrapMode();
    const component = await create();
    primeFinalizeReadyState(component);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(component.launchAccessMode()).toBe('bootstrap');
    expect(component.canFinalizeBootstrap()).toBeTrue();
    expect(text).toContain('Finish genesis · public artifacts');
    expect(text).toContain('Finalize genesis artifacts');
    expect(text).toContain('finish the genesis ceremony');
    expect(text).toContain('No raw signatures, session cookies, or one-shot tokens are sent');
  });

  it('finalizes public commitments and renders returned artifacts without secrets', async () => {
    configureBootstrapMode();
    const setItem = spyOn(Storage.prototype, 'setItem').and.callThrough();
    const response = {
      locked: true,
      bootstrap_manifest: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: launcherId,
          admins_hash: adminsHash,
          mips_root: mipsRootHash,
          authority_version: 1,
        },
        artifact_hashes: artifactHashes,
      },
      portal_runtime_config: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: launcherId,
          admins_hash: adminsHash,
          mips_root: mipsRootHash,
          authority_version: 1,
          admin_records_hash: `sha256:${'12'.repeat(32)}`,
        },
        read_only_api_url: 'https://api.populis.example',
        read_only_coinset_url: 'https://coinset.example',
      },
      bootstrap_recovery_anchor: recoveryAnchor,
    };
    bootstrap.finalizeBootstrap.and.resolveTo(response);
    const component = await create();
    primeFinalizeReadyState(component);
    fixture.detectChanges();

    await component.finalizeBootstrapArtifacts();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(bootstrap.finalizeBootstrap).toHaveBeenCalledOnceWith({
      admin_records: jasmine.objectContaining({
        version: 1,
        launcher_id: launcherId,
      }),
      admin_authority_launcher_id: launcherId,
      admins_hash: adminsHash,
      mips_root: mipsRootHash,
    });
    expect(bootstrap.verifyRecoveryArtifacts).toHaveBeenCalledOnceWith({
      bootstrap_recovery_anchor: recoveryAnchor,
      bootstrap_manifest: response.bootstrap_manifest,
      portal_runtime_config: response.portal_runtime_config,
      admin_records: jasmine.objectContaining({
        version: 1,
        launcher_id: launcherId,
      }),
    });
    expect(component.finalizeState().kind).toBe('finalized');
    expect(component.recoveryVerifyState().kind).toBe('verified');
    expect(component.recoveryChainState().kind).toBe('matched');
    expect(component.recoveryPublishIntentState().kind).toBe('ready');
    expect(onChain.getAuthorityV2).toHaveBeenCalledOnceWith();
    expect(bootstrap.getRecoveryAnchorPublishIntent).toHaveBeenCalledOnceWith();
    expect(component.bootstrapStatus()?.locked).toBeTrue();
    expect(component.launchAccessMode()).toBe('locked');

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Genesis finalized · bootstrapper locked');
    expect(text).toContain('bootstrap_manifest.json');
    expect(text).toContain('portal_runtime_config.json');
    expect(text).toContain('bootstrap_recovery_anchor.json');
    expect(text).toContain('Recovery verifier');
    expect(text).toContain('Verified. The recovery anchor, manifest');
    expect(text).toContain('Chain state matched');
    expect(text).toContain(chainStateHash);
    expect(text).toContain('Recovery anchor handoff');
    expect(text).toContain('Publish intent ready');
    expect(text).toContain(publishIntent.payload_hash);
    expect(text).toContain('marker coin memos');
    expect(text).toContain('This handoff is memo-only');
    expect(text).toContain('This check grants no admin access');
    expect(component.finalizedManifestJson()).toContain('"network": "testnet11"');
    expect(component.finalizedManifestJson()).toContain('"artifact_hashes"');
    expect(component.finalizedRuntimeJson()).toContain('"network": "testnet11"');
    expect(component.finalizedRuntimeJson()).toContain('"read_only_api_url": "https://api.populis.example"');
    expect(component.finalizedManifestJson()).toContain('"authority_version": 1');
    expect(component.finalizedRuntimeJson()).toContain('"authority_version": 1');
    expect(component.finalizedRecoveryAnchorJson()).toContain('"tag": "POPULIS_BOOTSTRAP_V1"');
    expect(component.finalizedRecoveryAnchorJson()).toContain('"bootstrap_manifest_hash"');
    expect(component.finalizedRecoveryAnchorJson()).toContain('"portal_runtime_config_hash"');
    expect(component.finalizedRecoveryAnchorJson()).toContain('"admin_records_hash"');
    expect(component.finalizedRecoveryAnchorJson()).toContain('"authority_version": 1');
    // The page legitimately contains the word "signature" in the
    // first-admin preview copy ("Wallet signature is proof-of-possession
    // only"), so we cannot ban that substring outright — instead we
    // assert the actual raw signature hex never reaches the DOM, plus a
    // tighter list of credential markers that should never appear in
    // public artifacts.
    const lower = text.toLowerCase();
    for (const forbidden of [
      'populis_admin_token',
      'populis_bootstrap_session',
      'bootstrap_session',
      'bearer ',
      'jwt_secret',
      'nonce',
      rawSignature.toLowerCase(),
    ]) {
      expect(lower).not.toContain(forbidden);
    }
    expect(setItem).not.toHaveBeenCalled();
  });

  it('surfaces finalize errors without locking the bootstrapper', async () => {
    configureBootstrapMode();
    bootstrap.finalizeBootstrap.and.rejectWith(new Error('410 bootstrap locked'));
    const component = await create();
    primeFinalizeReadyState(component);
    fixture.detectChanges();

    await component.finalizeBootstrapArtifacts();
    fixture.detectChanges();

    expect(component.finalizeState().kind).toBe('error');
    expect(component.finalizeError()).toContain('410 bootstrap locked');
    expect(component.bootstrapStatus()?.locked).toBeFalse();
    expect(bootstrap.verifyRecoveryArtifacts).not.toHaveBeenCalled();
    expect(bootstrap.getRecoveryAnchorPublishIntent).not.toHaveBeenCalled();
    expect(bootstrap.createRecoveryAnchorCoinPreview).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Finalize failed.');
  });

  it('surfaces recovery verifier rejection without granting authority', async () => {
    configureBootstrapMode();
    const response = {
      locked: true,
      bootstrap_manifest: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: launcherId,
          admins_hash: adminsHash,
          mips_root: mipsRootHash,
          authority_version: 1,
        },
        artifact_hashes: artifactHashes,
      },
      portal_runtime_config: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: launcherId,
          admins_hash: adminsHash,
          mips_root: mipsRootHash,
          authority_version: 1,
          admin_records_hash: `sha256:${'12'.repeat(32)}`,
        },
      },
      bootstrap_recovery_anchor: recoveryAnchor,
    };
    bootstrap.finalizeBootstrap.and.resolveTo(response);
    bootstrap.verifyRecoveryArtifacts.and.resolveTo({
      ...verifiedRecoveryResponse,
      verified: false,
      error: 'admin_records.json content hash mismatch',
    });
    const component = await create();
    primeFinalizeReadyState(component);
    fixture.detectChanges();

    await component.finalizeBootstrapArtifacts();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.finalizeState().kind).toBe('finalized');
    expect(component.recoveryVerifyState().kind).toBe('rejected');
    expect(onChain.getAuthorityV2).not.toHaveBeenCalled();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Verification rejected these public artifacts');
    expect(text).toContain('admin_records.json content hash mismatch');
    expect(text).toContain('This check grants no admin access');
  });

  it('surfaces recovery-anchor publish intent errors without failing finalized artifacts', async () => {
    configureBootstrapMode();
    const response = {
      locked: true,
      bootstrap_manifest: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: launcherId,
          admins_hash: adminsHash,
          mips_root: mipsRootHash,
          authority_version: 1,
        },
        artifact_hashes: artifactHashes,
      },
      portal_runtime_config: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: launcherId,
          admins_hash: adminsHash,
          mips_root: mipsRootHash,
          authority_version: 1,
          admin_records_hash: `sha256:${'12'.repeat(32)}`,
        },
      },
      bootstrap_recovery_anchor: recoveryAnchor,
    };
    bootstrap.finalizeBootstrap.and.resolveTo(response);
    bootstrap.getRecoveryAnchorPublishIntent.and.rejectWith(new Error('401 bootstrap session expired'));
    const component = await create();
    primeFinalizeReadyState(component);
    fixture.detectChanges();

    await component.finalizeBootstrapArtifacts();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.finalizeState().kind).toBe('finalized');
    expect(component.recoveryVerifyState().kind).toBe('verified');
    expect(component.recoveryPublishIntentState().kind).toBe('error');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Recovery anchor handoff');
    expect(text).toContain('Publish intent unavailable');
    expect(text).toContain('401 bootstrap session expired');
  });

  it('previews recovery marker coin CREATE_COIN without signing or broadcasting', async () => {
    configureBootstrapMode();
    const component = await create();
    primeFinalizeReadyState(component);
    component.finalizeState.set({
      kind: 'finalized',
      bootstrapManifest: finalizedResponse.bootstrap_manifest,
      portalRuntimeConfig: finalizedResponse.portal_runtime_config,
      bootstrapRecoveryAnchor: finalizedResponse.bootstrap_recovery_anchor,
    });
    component.recoveryPublishIntentState.set({ kind: 'ready', response: publishIntent });
    component.recoveryMarkerPuzzleHashInput.set(createCoinPreview.marker_puzzle_hash);
    fixture.detectChanges();

    await component.previewRecoveryAnchorMarkerCoin();
    fixture.detectChanges();

    expect(bootstrap.createRecoveryAnchorCoinPreview).toHaveBeenCalledOnceWith({
      marker_puzzle_hash: createCoinPreview.marker_puzzle_hash,
    });
    expect(component.recoveryCreateCoinPreviewState().kind).toBe('ready');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('CREATE_COIN preview ready');
    expect(text).toContain(`opcode=${createCoinPreview.condition_opcode}`);
    expect(text).toContain(createCoinPreview.marker_puzzle_hash);
    expect(text).toContain(createCoinPreview.payload_hash);
    expect(text).toContain('condition hex');
    expect(text).toContain('This handoff is memo-only');
  });

  it('rejects malformed marker puzzle hashes before preview API calls', async () => {
    configureBootstrapMode();
    const component = await create();
    primeFinalizeReadyState(component);
    component.finalizeState.set({
      kind: 'finalized',
      bootstrapManifest: finalizedResponse.bootstrap_manifest,
      portalRuntimeConfig: finalizedResponse.portal_runtime_config,
      bootstrapRecoveryAnchor: finalizedResponse.bootstrap_recovery_anchor,
    });
    component.recoveryPublishIntentState.set({ kind: 'ready', response: publishIntent });
    component.recoveryMarkerPuzzleHashInput.set('0x1234');
    fixture.detectChanges();

    await component.previewRecoveryAnchorMarkerCoin();
    fixture.detectChanges();

    expect(bootstrap.createRecoveryAnchorCoinPreview).not.toHaveBeenCalled();
    expect(component.recoveryCreateCoinPreviewState().kind).toBe('error');
    expect(fixture.nativeElement.textContent).toContain(
      'Marker puzzle hash must be a 32-byte hex string',
    );
  });

  it('surfaces live authority state-hash mismatch after verifier success', async () => {
    configureBootstrapMode();
    const response = {
      locked: true,
      bootstrap_manifest: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: launcherId,
          admins_hash: adminsHash,
          mips_root: mipsRootHash,
          authority_version: 1,
        },
        artifact_hashes: artifactHashes,
      },
      portal_runtime_config: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: launcherId,
          admins_hash: adminsHash,
          mips_root: mipsRootHash,
          authority_version: 1,
          admin_records_hash: `sha256:${'12'.repeat(32)}`,
        },
      },
      bootstrap_recovery_anchor: recoveryAnchor,
    };
    bootstrap.finalizeBootstrap.and.resolveTo(response);
    onChain.getAuthorityV2.and.resolveTo({
      enabled: true,
      launcher_id: launcherId,
      mips_root_hash: null,
      admins_hash: null,
      pending_ops_hash: null,
      authority_version: null,
      state_hash: `0x${'11'.repeat(32)}`,
      phase: '2-informational-only',
      gating_source: 'POPULIS_ADMIN_PUBKEY_ALLOWLIST',
      informational_only: true,
    });
    const component = await create();
    primeFinalizeReadyState(component);
    fixture.detectChanges();

    await component.finalizeBootstrapArtifacts();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.finalizeState().kind).toBe('finalized');
    expect(component.recoveryVerifyState().kind).toBe('verified');
    expect(component.recoveryChainState().kind).toBe('mismatch');
    expect(fixture.nativeElement.textContent).toContain(
      'Recovered authority coordinates do not match the live admin_authority_v2 chain state',
    );
  });

  it('surfaces unavailable live authority state hash without failing artifact verification', async () => {
    configureBootstrapMode();
    const response = {
      locked: true,
      bootstrap_manifest: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: launcherId,
          admins_hash: adminsHash,
          mips_root: mipsRootHash,
          authority_version: 1,
        },
        artifact_hashes: artifactHashes,
      },
      portal_runtime_config: {
        version: 1,
        network: 'testnet11',
        protocol,
        admin_authority_v2: {
          launcher_id: launcherId,
          admins_hash: adminsHash,
          mips_root: mipsRootHash,
          authority_version: 1,
          admin_records_hash: `sha256:${'12'.repeat(32)}`,
        },
      },
      bootstrap_recovery_anchor: recoveryAnchor,
    };
    bootstrap.finalizeBootstrap.and.resolveTo(response);
    onChain.getAuthorityV2.and.resolveTo({
      enabled: true,
      launcher_id: launcherId,
      mips_root_hash: null,
      admins_hash: null,
      pending_ops_hash: null,
      authority_version: null,
      state_hash: null,
      phase: '2-informational-only',
      gating_source: 'POPULIS_ADMIN_PUBKEY_ALLOWLIST',
      informational_only: true,
    });
    const component = await create();
    primeFinalizeReadyState(component);
    fixture.detectChanges();

    await component.finalizeBootstrapArtifacts();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.finalizeState().kind).toBe('finalized');
    expect(component.recoveryVerifyState().kind).toBe('verified');
    expect(component.recoveryChainState().kind).toBe('unavailable');
    expect(fixture.nativeElement.textContent).toContain(
      'Live admin_authority_v2 state hash is not available from chain yet',
    );
  });

  it('refuses to finalize without the required public commitments', async () => {
    configureBootstrapMode();
    const component = await create();
    component.submitState.set({
      kind: 'submitted',
      launcherId,
      statusFromCoinset: null,
    });
    fixture.detectChanges();

    await component.finalizeBootstrapArtifacts();

    expect(bootstrap.finalizeBootstrap).not.toHaveBeenCalled();
    expect(component.finalizeState().kind).toBe('error');
  });
});
