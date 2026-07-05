import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';

import { ChiaWalletService } from '../../services/chia-wallet.service';
import { EvmWalletService } from '../../services/evm-wallet.service';
import { OfferDetail } from '../../services/offer-domain';
import { OfferSourceService } from '../../services/offer-source.service';
import { VaultState } from '../../services/populis-api.service';
import { PersistedSession, SessionService } from '../../services/session.service';
import { VaultAcceptOfferLifecycleService } from '../../services/vault-accept-offer-lifecycle.service';
import {
  VaultAcceptOfferProofParams,
  ZkPassportAcceptOfferProofService,
} from '../../services/zkpassport-accept-offer-proof.service';
import { OfferDetailComponent } from './offer-detail.component';

const VAULT_LAUNCHER_ID = '0x' + '11'.repeat(32);

class MockSessionService {
  readonly session = signal<PersistedSession | null>(null);
  readonly vault = signal<VaultState | null>(null);
  refreshVault = jasmine.createSpy('refreshVault').and.resolveTo(null);
}

class MockEvmWalletService {
  private readonly _address = signal<string | null>(null);
  readonly address = this._address.asReadonly();

  setAddress(address: string | null): void {
    this._address.set(address);
  }
}

class MockChiaWalletService {
  private readonly _pubkey = signal<string | null>(null);
  readonly pubkey = this._pubkey.asReadonly();

  setPubkey(pubkey: string | null): void {
    this._pubkey.set(pubkey);
  }
}

class MockZkPassportAcceptOfferProofService {
  requireProofParams = jasmine.createSpy('requireProofParams').and.throwError('missing proof');
}

class MockVaultAcceptOfferLifecycleService {
  authorizeEligibleAcceptOffer = jasmine
    .createSpy('authorizeEligibleAcceptOffer')
    .and.callFake(async () => acceptAuthorization());
  commitAuthorizedAcceptOffer = jasmine
    .createSpy('commitAuthorizedAcceptOffer')
    .and.callFake(async (authorization) => ({
      ...authorization,
      pushResponse: { success: true, status: 'SUCCESS' },
      confirmedVaultCoinId: '0x' + '99'.repeat(32),
      confirmedBlockIndex: 42,
    }));
}

describe('OfferDetailComponent', () => {
  let fixture: ComponentFixture<OfferDetailComponent>;
  let component: OfferDetailComponent;
  let session: MockSessionService;
  let evm: MockEvmWalletService;
  let offerSource: jasmine.SpyObj<OfferSourceService>;
  let proofService: MockZkPassportAcceptOfferProofService;
  let lifecycle: MockVaultAcceptOfferLifecycleService;

  beforeEach(async () => {
    session = new MockSessionService();
    evm = new MockEvmWalletService();
    offerSource = jasmine.createSpyObj<OfferSourceService>('OfferSourceService', ['offerById']);
    offerSource.offerById.and.returnValue(sourceOffer());
    proofService = new MockZkPassportAcceptOfferProofService();
    lifecycle = new MockVaultAcceptOfferLifecycleService();

    await TestBed.configureTestingModule({
      imports: [OfferDetailComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'testnet-deed-001' } } },
        },
        { provide: SessionService, useValue: session },
        { provide: EvmWalletService, useValue: evm },
        { provide: ChiaWalletService, useClass: MockChiaWalletService },
        { provide: OfferSourceService, useValue: offerSource },
        { provide: ZkPassportAcceptOfferProofService, useValue: proofService },
        { provide: VaultAcceptOfferLifecycleService, useValue: lifecycle },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OfferDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders an unconnected member state with a wallet connect action', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(offerSource.offerById).toHaveBeenCalledWith('testnet-deed-001');
    expect(text).toContain('Source-backed deed offer');
    expect(component.eligibility().state).toBe('NM:UNCONNECTED');
    expect(text).toContain('NM:UNCONNECTED');
    expect(text).toContain('Connect wallet');
    expect(text).toContain('Member path');
    expect(text).toContain('NM:NO_VAULT');
  });

  it('routes a connected member without a vault to create-vault with the offer return target', async () => {
    evm.setAddress('0x0e61d3bb1148bdd802f747caea112333d156626a');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(component.eligibility().state).toBe('NM:NO_VAULT');
    expect(text).toContain('Create vault');
    const link = linkByText('Create vault');
    expect(link).toBeTruthy();
    expect(decodeURIComponent(link!.getAttribute('href') ?? '')).toContain(
      '/create-vault?returnTo=/offers/testnet-deed-001',
    );
    expect(component.returnQueryParams()).toEqual({
      returnTo: '/offers/testnet-deed-001',
    });
  });

  it('routes a confirmed vault without zkPassport proof to enrollment with the offer return target', async () => {
    setConfirmedVault();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(component.eligibility().state).toBe('NM:ZK_REQUIRED');
    expect(proofService.requireProofParams).toHaveBeenCalledWith(VAULT_LAUNCHER_ID);
    expect(text).toContain('Enroll zkPassport');
    const link = linkByText('Enroll zkPassport');
    expect(link).toBeTruthy();
    expect(decodeURIComponent(link!.getAttribute('href') ?? '')).toContain(
      '/vault?returnTo=/offers/testnet-deed-001&intent=zkpassport',
    );
  });

  it('enables acceptance authorization for an eligible vault with confirmed zkPassport proof', () => {
    setConfirmedVault();
    proofService.requireProofParams.and.returnValue(acceptOfferProof());
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button.btn--primary') as HTMLButtonElement;
    expect(component.eligibility().state).toBe('EM:ELIGIBLE');
    expect(fixture.nativeElement.textContent).toContain('EM:ZK_CONFIRMED');
    expect(button.textContent).toContain('Authorize acceptance');
    expect(button.disabled).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('EM:ACCEPT_AUTH_REQUIRED');
  });

  it('authorizes an eligible BLS accept package without auto-submitting it', async () => {
    setConfirmedVault('chia_bls');
    proofService.requireProofParams.and.returnValue(acceptOfferProof());
    fixture.detectChanges();

    await component.authorizeAcceptOffer();
    fixture.detectChanges();

    expect(component.acceptStatus()).toBe('authorized');
    expect(lifecycle.authorizeEligibleAcceptOffer).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        offerDetail: jasmine.objectContaining({ id: 'testnet-deed-001' }),
        context: jasmine.objectContaining({ vaultLauncherId: VAULT_LAUNCHER_ID }),
        authorizationArgs: jasmine.objectContaining({
          vaultLauncherId: VAULT_LAUNCHER_ID,
          vaultCoinId: '0x' + '44'.repeat(32),
          ownerPubkey: '0x' + 'aa'.repeat(48),
          authType: 1,
          poolLauncherId: '0x' + '55'.repeat(32),
          poolInnerPuzzleHash: '0x' + '66'.repeat(32),
        }),
      }),
    );
    expect(lifecycle.commitAuthorizedAcceptOffer).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Signed accept package ready.');
    expect(fixture.nativeElement.textContent).toContain('Submit signed bundle');
  });

  it('submits only after a signed accept package exists', async () => {
    setConfirmedVault('chia_bls');
    proofService.requireProofParams.and.returnValue(acceptOfferProof());
    fixture.detectChanges();

    await component.authorizeAcceptOffer();
    await component.commitAcceptOffer();
    fixture.detectChanges();

    expect(component.acceptStatus()).toBe('confirmed');
    expect(lifecycle.commitAuthorizedAcceptOffer).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Offer acceptance confirmed on chain.');
    expect(fixture.nativeElement.textContent).toContain('0x' + '99'.repeat(32));
  });

  it('reports missing local acceptance context before calling the lifecycle service', async () => {
    setConfirmedVault('chia_bls', { currentCoinId: null });
    proofService.requireProofParams.and.returnValue(acceptOfferProof());
    fixture.detectChanges();

    await component.authorizeAcceptOffer();
    fixture.detectChanges();

    expect(component.acceptStatus()).toBe('error');
    expect(lifecycle.authorizeEligibleAcceptOffer).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('current vault coin id');
  });

  it('reports unsupported EVM vault acceptance before calling the lifecycle service', async () => {
    setConfirmedVault('evm');
    proofService.requireProofParams.and.returnValue(acceptOfferProof());
    fixture.detectChanges();

    await component.authorizeAcceptOffer();
    fixture.detectChanges();

    expect(component.acceptStatus()).toBe('error');
    expect(lifecycle.authorizeEligibleAcceptOffer).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('supports BLS vault authorization only');
  });

  it('refreshes chain state through SessionService', async () => {
    await component.refreshVault();

    expect(session.refreshVault).toHaveBeenCalledOnceWith();
  });

  function setConfirmedVault(
    authType: PersistedSession['authType'] = 'evm',
    overrides: { currentCoinId?: string | null } = {},
  ): void {
    const ownerPubkey = authType === 'chia_bls' ? '0x' + 'aa'.repeat(48) : '0x02' + 'aa'.repeat(32);
    session.session.set({
      authType,
      address: authType === 'chia_bls' ? ownerPubkey : '0x0e61d3bb1148bdd802f747caea112333d156626a',
      vaultLauncherId: VAULT_LAUNCHER_ID,
      compressedPubkey: ownerPubkey,
      createdAt: 1,
    });
    session.vault.set({
      vault_launcher_id: VAULT_LAUNCHER_ID,
      vault_full_puzhash: '0x' + '22'.repeat(32),
      p2_vault_puzhash: '0x' + '33'.repeat(32),
      auth_type: authType,
      owner_address: authType === 'evm' ? '0x0e61d3bb1148bdd802f747caea112333d156626a' : null,
      owner_pubkey: ownerPubkey,
      confirmed: true,
      confirmed_block_index: 10,
      current_coin_id: overrides.currentCoinId === undefined ? '0x' + '44'.repeat(32) : overrides.currentCoinId,
      balance: { xch_mojos: 0, deeds: [] },
    });
  }

  function linkByText(text: string): HTMLAnchorElement | null {
    return (
      Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[]
    ).find((link) => (link.textContent ?? '').includes(text)) ?? null;
  }

  function acceptOfferProof(): VaultAcceptOfferProofParams {
    return {
      identityAttestRoot: '0x' + 'a1'.repeat(32),
      attestationLeafHash: '0x' + 'a2'.repeat(32),
      attestationProof: {
        bitpath: 0,
        siblings: [],
      },
    };
  }

  function sourceOffer(overrides: Partial<OfferDetail> = {}): OfferDetail {
    return {
      id: 'testnet-deed-001',
      title: 'Source-backed deed offer',
      deedLauncherId: '0x' + '33'.repeat(32),
      state: 'OP:OFFER_READY',
      terms: {
        deedLauncherId: '0x' + '33'.repeat(32),
        tokenAmount: 100_000,
        priceMojos: 1_000_000,
        acceptedAsset: 'XCH',
        expiresAt: null,
      },
      artifact: {
        artifactId: 'testnet-artifact-001',
        deedLauncherId: '0x' + '33'.repeat(32),
        artifactHash: null,
        rawOffer: null,
        poolLauncherId: '0x' + '55'.repeat(32),
        poolInnerPuzzleHash: '0x' + '66'.repeat(32),
      },
      gatingPolicy: {
        requiresZkPassport: true,
      },
      ...overrides,
    };
  }

});

function acceptAuthorization(): any {
  return {
    packageState: {
      spendCase: '0x61',
      expectedNextVaultCoin: {
        coinId: '0x' + '88'.repeat(32),
        puzzleHash: '0x' + '22'.repeat(32),
        amount: 1,
      },
    },
    signedSpendBundle: {
      coinSpends: [],
      aggregatedSignature: '0x' + 'ab'.repeat(96),
    },
  };
}
