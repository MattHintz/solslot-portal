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
import { LaunchAuthorityV2Component } from './launch-authority-v2.component';

describe('LaunchAuthorityV2Component', () => {
  let fixture: ComponentFixture<LaunchAuthorityV2Component>;
  let session: jasmine.SpyObj<Pick<AdminSessionService, 'isAuthenticated'>>;
  let bootstrap: jasmine.SpyObj<Pick<AdminBootstrapService, 'getBootstrapStatus'>>;
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
    bootstrap = jasmine.createSpyObj('AdminBootstrapService', ['getBootstrapStatus']);
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
            computeLaunchOutputs: () => null,
          },
        },
        { provide: EvmWalletService, useValue: evmWallet },
        { provide: Eip712LeafHashService, useValue: eip712Leaf },
        { provide: WalletCoinPickerService, useValue: {} },
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
    expect(text).not.toContain('Temporary bootstrap access');
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
    expect(text).toContain('← Genesis bootstrap');
    expect(text).toContain('Temporary bootstrap access');
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
});
