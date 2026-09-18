import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { GovernanceQueueService } from '../../../services/governance-queue.service';
import { EvmWalletService } from '../../../services/evm-wallet.service';
import { GovernanceVaultVoteService } from '../../../services/governance-vault-vote.service';
import { SessionService } from '../../../services/session.service';
import { SgtAllocationsComponent } from './sgt-allocations.component';

describe('SgtAllocationsComponent', () => {
  let fixture: ComponentFixture<SgtAllocationsComponent>;
  let component: SgtAllocationsComponent;
  let api: jasmine.SpyObj<GovernanceQueueService>;
  let wallet: jasmine.SpyObj<EvmWalletService>;
  let vote: jasmine.SpyObj<GovernanceVaultVoteService>;
  const googleUnavailable = signal(false);
  const vaultSession = signal<any>(null);

  beforeEach(async () => {
    api = jasmine.createSpyObj<GovernanceQueueService>('GovernanceQueueService', [
      'list',
      'allocationOptions',
      'create',
      'transition',
      'package',
      'sign',
      'submit',
      'reconcile',
      'execute',
      'previewStarterGrants',
    ]);
    wallet = jasmine.createSpyObj<EvmWalletService>('EvmWalletService', [
      'connectInjected',
      'connectWalletConnect',
      'signAuthorityV3ChiaAction',
    ], {
      isConnected: signal(false),
      address: signal<string | null>(null),
    });
    googleUnavailable.set(false);
    vaultSession.set(null);
    vote = jasmine.createSpyObj<GovernanceVaultVoteService>('GovernanceVaultVoteService', ['vote'], { googleVotingUnavailable: googleUnavailable });
    api.list.and.resolveTo([]);
    api.allocationOptions.and.resolveTo([
      { id: 'XCH', label: 'XCH', decimals: 12 },
      { id: 'WUSDC_B', label: 'wUSDC.b', decimals: 3, assetId: `0x${'22'.repeat(32)}` },
      { id: 'STRIPE', label: 'Stripe USD', decimals: 2, serverPriced: true },
      { id: 'BASE_USDC', label: 'Base Sepolia USDC', decimals: 6, serverPriced: true },
    ]);
    await TestBed.configureTestingModule({
      imports: [SgtAllocationsComponent],
      providers: [
        provideRouter([]),
        { provide: GovernanceQueueService, useValue: api },
        { provide: EvmWalletService, useValue: wallet },
        { provide: GovernanceVaultVoteService, useValue: vote },
        { provide: SessionService, useValue: { session: vaultSession } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SgtAllocationsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('explains SGT authority boundaries and starts with an empty queue', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('What SGT grants');
    expect(text).toContain('No administrator key');
    expect(text).toContain('No proposals prepared');
  });

  it('reviews three current-stake grants and resumes a partially saved queue without duplicates', async () => {
    const recipients = ['11', '22', '33'].map(value => '0x' + value.repeat(32));
    const grants = recipients.map((recipientVaultLauncherId, index) => ({
      kind: 'SGT_GRANT' as const, title: `Administrator ${index + 1} starter SGT`, sgtAmount: '15000',
      recipientVaultLauncherId, grantId: '0x' + `${index + 4}4`.repeat(32), reasonHash: '0x' + '55'.repeat(32),
    }));
    api.previewStarterGrants.and.resolveTo({ proposals: grants, amountPerAdministrator: '15000',
      totalAmount: '45000', statutesCoinId: '0x' + '66'.repeat(32), authorityRule: 'Owner plus one' });
    recipients.forEach((value, index) => component.setStarterVault(index, value));
    await component.previewStarterGrants();
    expect(api.create).not.toHaveBeenCalled();
    expect(component.starterPreview()?.totalAmount).toBe('45000');
    let count = 0;
    api.create.and.callFake(async (grant) => {
      if (++count === 2) throw new Error('Temporary connection failure');
      return { id: `GOV-${count}`, kind: 'SGT_GRANT', state: 'DRAFT', bill: grant } as any;
    });
    await component.queueStarterGrants();
    expect(component.proposals().length).toBe(1);
    await component.queueStarterGrants();
    expect(component.proposals().length).toBe(3);
    expect(api.create.calls.allArgs().filter(args => args[0] === grants[0]).length).toBe(1);
    expect(api.sign).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('converts ordinary XCH to exact mojos before creating a sale draft', async () => {
    api.create.and.resolveTo({
      id: 'GOV-1',
      kind: 'SGT_SALE',
      state: 'DRAFT',
      title: 'Committee participation sale',
      bill: { sgtAmount: '25000', paymentAmount: '2500000000000' },
      revision: 1,
      queuePosition: 1,
    } as any);
    component.title = 'Committee participation sale';
    component.sgtAmount = '25000';
    component.recipientVaultLauncherId = `0x${'11'.repeat(32)}`;
    component.paymentAmount = '2.5';
    component.expiresLocal = '2030-01-01T00:00';

    await component.createProposal();

    expect(api.create).toHaveBeenCalled();
    const request = api.create.calls.mostRecent().args[0];
    expect(request.kind).toBe('SGT_SALE');
    if (request.kind === 'SGT_SALE' && request.paymentRail === 'XCH') {
      expect(request.paymentAmount).toBe('2500000000000');
      expect(request.paymentRail).toBe('XCH');
      expect(request.recipientVaultLauncherId).toBe(`0x${'11'.repeat(32)}`);
    }
    expect(component.notice()).toContain('Proposal saved');
  });

  it('uses the server-named wUSDC.b rail and exact CAT units without accepting an asset id', async () => {
    api.create.and.resolveTo({
      id: 'GOV-USDC',
      kind: 'SGT_SALE',
      state: 'DRAFT',
      title: 'Stablecoin committee participation sale',
      bill: { sgtAmount: '25000', paymentAmount: '125050', paymentRail: 'WUSDC_B' },
      revision: 1,
      queuePosition: 1,
    } as any);
    component.title = 'Stablecoin committee participation sale';
    component.sgtAmount = '25000';
    component.recipientVaultLauncherId = `0x${'11'.repeat(32)}`;
    component.paymentRail = 'WUSDC_B';
    component.paymentAmount = '125.05';
    component.expiresLocal = '2030-01-01T00:00';

    await component.createProposal();

    const request = api.create.calls.mostRecent().args[0];
    expect(request.kind).toBe('SGT_SALE');
    if (request.kind === 'SGT_SALE' && request.paymentRail === 'WUSDC_B') {
      expect(request.paymentRail).toBe('WUSDC_B');
      expect(request.paymentAmount).toBe('125050');
      expect('paymentAssetId' in request).toBeFalse();
    }
  });

  it('sends ordinary USD for a server-priced Stripe sale without a client rail amount', async () => {
    api.create.and.resolveTo({
      id: 'GOV-STRIPE',
      kind: 'SGT_SALE',
      state: 'DRAFT',
      title: 'Stripe committee participation sale',
      bill: { sgtAmount: '25000', paymentAmount: '101000', paymentRail: 'STRIPE' },
      revision: 1,
      queuePosition: 1,
    } as any);
    component.title = 'Stripe committee participation sale';
    component.sgtAmount = '25000';
    component.recipientVaultLauncherId = `0x${'11'.repeat(32)}`;
    component.paymentRail = 'STRIPE';
    component.paymentAmount = '1000.00';
    component.expiresLocal = '2030-01-01T00:00';

    await component.createProposal();

    const request = api.create.calls.mostRecent().args[0];
    expect(request.kind).toBe('SGT_SALE');
    if (request.kind === 'SGT_SALE' && request.paymentRail === 'STRIPE') {
      expect(request.baseUsdAmountMinor).toBe('100000');
      expect('paymentAmount' in request).toBeFalse();
    }
  });

  it('uses a bank-settlement window for Stripe and a short quote for Base USDC', () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-08-01T12:00:00Z'));
    try {
      component.setPaymentRail('STRIPE');
      const stripeLifetime = Date.parse(component.expiresLocal) - Date.now();
      expect(stripeLifetime).toBeGreaterThanOrEqual(11 * 24 * 60 * 60 * 1000);
      expect(stripeLifetime).toBeLessThanOrEqual(14 * 24 * 60 * 60 * 1000);
      expect(component.expiryHelp()).toContain('ACH');

      component.setPaymentRail('BASE_USDC');
      const baseLifetime = Date.parse(component.expiresLocal) - Date.now();
      expect(baseLifetime).toBeGreaterThan(0);
      expect(baseLifetime).toBeLessThanOrEqual(30 * 60 * 1000);
      expect(component.expiryHelp()).toContain('30 minutes');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('turns a passed committee vote into one exact finalization action', async () => {
    const proposal = {
      id: 'GOV-7',
      kind: 'SGT_GRANT',
      state: 'ACTIVE',
      title: 'Governed grant',
      bill: { sgtAmount: '10000' },
      revision: 3,
      queuePosition: 1,
      executionBundleId: null,
      expectedOutputCoinIds: [],
    } as any;
    api.list.and.resolveTo([proposal]);
    api.reconcile.and.resolveTo({
      proposal,
      chainState: 'AWAITING_EXECUTE',
      voteTally: '500000',
      votingDeadline: 1_900_000_000,
    });
    await component.reload();
    fixture.detectChanges();

    const finalize = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Finalize allocation')) as HTMLButtonElement;
    expect(finalize).toBeTruthy();

    const submitted = {
      ...proposal,
      revision: 4,
      executionBundleId: '0x' + '77'.repeat(32),
      expectedOutputCoinIds: ['0x' + '78'.repeat(32)],
    };
    api.execute.and.resolveTo({
      proposal: submitted,
      chainState: 'EXECUTION_PENDING',
      submission: { spendBundleId: submitted.executionBundleId },
    });
    await component.execute(proposal);

    expect(api.execute).toHaveBeenCalledOnceWith('GOV-7');
    expect(component.proposals()[0].executionBundleId).toBe(submitted.executionBundleId);
    expect(component.notice()).toContain('mempool');
  });

  it('shows the generated offer only after the governed sale coin is confirmed', () => {
    component.proposals.set([
      {
        id: 'GOV-SALE',
        kind: 'SGT_SALE',
        state: 'EXECUTED',
        title: 'Approved SGT sale',
        bill: { sgtAmount: '25000', paymentAmount: '9500000' },
        revision: 6,
        queuePosition: 1,
        executionBundleId: '0x' + '81'.repeat(32),
        expectedOutputCoinIds: ['0x' + '82'.repeat(32)],
        saleOffer: {
          offerId: '0x' + '83'.repeat(32),
          offerFile: 'offer1exact',
          saleCoinId: '0x' + '84'.repeat(32),
          status: 'AVAILABLE',
          publishedAt: 1_800_000_000,
          confirmedHeight: 100,
          spentHeight: null,
        },
      } as any,
    ]);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Offer ready for the approved buyer');
    expect(text).toContain('Copy exact offer');
    expect(text).toContain('approved protocol vault');
  });

  it('keeps active allocation voting inside the queue UI', async () => {
    const proposal = {
      id: 'GOV-VOTE',
      kind: 'SGT_GRANT',
      state: 'ACTIVE',
      title: 'Vote inside the queue',
      bill: { sgtAmount: '10000' },
      revision: 3,
      queuePosition: 1,
      executionBundleId: null,
      expectedOutputCoinIds: [],
    } as any;
    component.proposals.set([proposal]);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Vote from your vault');
    expect(text).toContain('Connect a protocol vault to vote');
    expect(text).not.toContain('Open committee vote');
  });
  it('shows the Google voting limitation and disables the primary vote control', () => {
    googleUnavailable.set(true);
    vaultSession.set({ vaultLauncherId: '0x' + '11'.repeat(32), walletSource: 'google' });
    const proposal = { id: 'GOV-VOTE', kind: 'SGT_GRANT', state: 'ACTIVE', title: 'Allocation',
      bill: { sgtAmount: '10000' }, revision: 3, queuePosition: 1,
      executionBundleId: null, expectedOutputCoinIds: [] } as any;
    component.proposals.set([proposal]);
    component.setVoteAmount(proposal, '10000');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Voting with Google Vault is not available in this alpha.');
    const button = [...root.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Review and vote')!;
    expect(button.disabled).toBeTrue();
    button.click();
    expect(vote.vote).not.toHaveBeenCalled();
    googleUnavailable.set(false);
    fixture.detectChanges();
    expect(button.disabled).toBeFalse();
  });

});
