import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AdminGenesisService, GenesisCeremony } from '../../../services/admin-genesis.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { GenesisComponent } from './genesis.component';

describe('GenesisComponent', () => {
  const ceremonyId = '0x' + '11'.repeat(32);
  const typedData = {
    domain: { name: 'Solslot Protocol', version: '2', chainId: 11155111 },
    types: {},
    primaryType: 'SolslotGenesisPlan',
    message: {},
  };
  const baseCeremony = (state = 'draft'): GenesisCeremony => ({
    ceremony_id: ceremonyId,
    state,
    network: 'testnet11',
    evm_chain_id: 11155111,
    source_shas: {
      protocol: '1'.repeat(40),
      evm: '2'.repeat(40),
      api: '3'.repeat(40),
      legacyBackend: '4'.repeat(40),
      customerWeb: '5'.repeat(40),
      adminPortal: '6'.repeat(40),
    },
    invitations: [1, 2, 3].map((slot) => ({ slot })),
    plan_signatures: [],
    artifact_signatures: [],
  });

  let fixture: ComponentFixture<GenesisComponent>;
  let component: GenesisComponent;
  let genesis: jasmine.SpyObj<AdminGenesisService>;
  const walletAddress = signal<string | null>(null);
  const wallet = {
    address: walletAddress,
    connectInjected: jasmine.createSpy('connectInjected'),
    connectWalletConnect: jasmine.createSpy('connectWalletConnect'),
    signTypedData: jasmine.createSpy('signTypedData'),
  };

  beforeEach(async () => {
    genesis = jasmine.createSpyObj<AdminGenesisService>('AdminGenesisService', [
      'createDraft',
      'getCeremony',
      'issueInvitation',
      'prepareInvitation',
      'acceptInvitation',
      'freezeRoster',
      'createPlan',
      'preparePlanSignature',
      'signPlan',
      'preflight',
      'broadcast',
      'confirm',
      'createArtifact',
      'prepareArtifactSignature',
      'signArtifact',
      'finalize',
      'abandon',
    ]);
    walletAddress.set(null);
    wallet.connectInjected.calls.reset();
    wallet.connectWalletConnect.calls.reset();
    wallet.signTypedData.calls.reset();

    await TestBed.configureTestingModule({
      imports: [GenesisComponent],
      providers: [
        provideRouter([]),
        { provide: AdminGenesisService, useValue: genesis },
        { provide: EvmWalletService, useValue: wallet },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GenesisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the complete V2 ceremony gate instead of the retired deploy flow', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Genesis ceremony console');
    expect(text).toContain('Three independent wallet slots');
    expect(text).toContain('Pre-broadcast gate');
    expect(text).toContain('Post-chain artifact quorum');
    expect(text).toContain('Write lock last');
    expect(text).not.toContain('admin slot 0');
    expect(text).not.toContain('deployment_manifest.json');
  });

  it('creates a draft only from all five frozen source commits', async () => {
    genesis.createDraft.and.resolveTo(baseCeremony());
    component.tokenInput.set('operator-token');
    component.sourceShasJson.set(JSON.stringify(baseCeremony().source_shas));

    await component.createDraft();

    expect(genesis.createDraft).toHaveBeenCalledOnceWith(
      'operator-token',
      baseCeremony().source_shas,
    );
    expect(component.ceremonyIdInput()).toBe(ceremonyId);
    expect(component.message()).toContain('five frozen commits');
  });

  it('enrolls an invited administrator with the connected wallet signature', async () => {
    const address = '0x' + 'ab'.repeat(20);
    walletAddress.set(address);
    wallet.signTypedData.and.resolveTo('0xsigned');
    genesis.prepareInvitation.and.resolveTo({
      ceremonyId,
      slot: 2,
      expiresAt: 1234,
      typedData,
    });
    genesis.acceptInvitation.and.resolveTo({
      ceremonyId,
      slot: 2,
      enrolled: true,
      state: 'roster_open',
    });
    component.invitationTokenInput.set('fragment-token');

    await component.acceptInvitation();

    expect(genesis.prepareInvitation).toHaveBeenCalledOnceWith('fragment-token', address);
    expect(wallet.signTypedData).toHaveBeenCalledOnceWith(typedData);
    expect(genesis.acceptInvitation).toHaveBeenCalledOnceWith(
      'fragment-token',
      address,
      '0xsigned',
    );
    expect(component.ceremonyIdInput()).toBe(ceremonyId);
  });

  it('recovers the hash-only plan envelope and records a slot-bound signature', async () => {
    const planned = { ...baseCeremony('plan_ready'), plan_hash: '0x' + '22'.repeat(32) };
    const approved = {
      ...planned,
      state: 'plan_approved',
      plan_signatures: [{ slot: 1, compressed_pubkey: '0x02', signature: '0xsigned' }],
    };
    component.ceremony.set(planned);
    component.signerSlotInput.set(1);
    walletAddress.set('0x' + 'ab'.repeat(20));
    wallet.signTypedData.and.resolveTo('0xsigned');
    genesis.preparePlanSignature.and.resolveTo({ ceremonyId, slot: 1, typedData });
    genesis.signPlan.and.resolveTo(approved);

    await component.signPlan();

    expect(genesis.preparePlanSignature).toHaveBeenCalledOnceWith(ceremonyId, 1);
    expect(wallet.signTypedData).toHaveBeenCalledOnceWith(typedData);
    expect(genesis.signPlan).toHaveBeenCalledOnceWith(ceremonyId, 1, '0xsigned');
    expect(component.ceremony()?.state).toBe('plan_approved');
  });

  it('will not broadcast until a reviewed preflight is explicitly armed', async () => {
    component.ceremony.set(baseCeremony('plan_approved'));
    component.tokenInput.set('operator-token');
    genesis.preflight.and.resolveTo({
      ready: true,
      ceremonyId,
      planHash: '0x' + '22'.repeat(32),
      spendBundleId: '0x' + '33'.repeat(32),
      spendCount: 48,
      reviewClass: 'internal-engineering-testnet',
      auditStatus: 'unaudited',
      auditApprovalHash: '0x' + '44'.repeat(32),
    });

    await component.broadcast();
    expect(genesis.broadcast).not.toHaveBeenCalled();

    await component.runPreflight();
    expect(component.broadcastArmed()).toBeFalse();
    component.broadcastArmed.set(true);
    spyOn(window, 'confirm').and.returnValue(false);
    await component.broadcast();
    expect(genesis.broadcast).not.toHaveBeenCalled();
  });

  it('keeps malformed operator JSON fail-closed', async () => {
    component.sourceShasJson.set('{bad json');
    component.tokenInput.set('operator-token');

    await component.createDraft();

    expect(genesis.createDraft).not.toHaveBeenCalled();
    expect(component.error()).toContain('Invalid ceremony JSON');
  });
});
