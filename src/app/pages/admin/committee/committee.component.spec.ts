import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CommitteeComponent } from './committee.component';
import { ChiaWalletService } from '../../../services/chia-wallet.service';
import {
  CommitteeVoteRunnerService,
  VoteRunResult,
} from '../../../services/sgt-driver/committee-vote-runner.service';
import {
  DecodedBill,
  GovernanceTrackerReaderService,
  TrackerStateSnapshot,
} from '../../../services/governance-tracker-reader.service';

describe('CommitteeComponent', () => {
  let fixture: ComponentFixture<CommitteeComponent>;
  let component: CommitteeComponent;
  let tracker: jasmine.SpyObj<Pick<GovernanceTrackerReaderService, 'readCurrentState'>>;
  let walletConnected = false;
  let runnerCastVote: jasmine.Spy;

  const b32 = (byte: string) => '0x' + byte.repeat(32);
  const mintBill = (): DecodedBill => ({
    kind: 'MINT',
    deedFullPuzzleHash: b32('02'),
    propertyIdCanon: b32('03'),
    propertyRegistryPuzzleHash: b32('04'),
  });

  function setUp(
    snapshot: TrackerStateSnapshot | Error,
    opts: {
      walletConnected?: boolean;
      castVoteResult?: VoteRunResult;
    } = {},
  ): void {
    walletConnected = opts.walletConnected ?? false;
    runnerCastVote = jasmine.createSpy('castVote').and.resolveTo(
      opts.castVoteResult ?? { kind: 'wallet-not-connected' },
    );
    tracker = jasmine.createSpyObj('GovernanceTrackerReaderService', ['readCurrentState']);
    if (snapshot instanceof Error) {
      tracker.readCurrentState.and.rejectWith(snapshot);
    } else {
      tracker.readCurrentState.and.resolveTo(snapshot);
    }
    TestBed.configureTestingModule({
      imports: [CommitteeComponent],
      providers: [
        provideRouter([]),
        { provide: GovernanceTrackerReaderService, useValue: tracker },
        {
          provide: ChiaWalletService,
          useValue: {
            isConnected: () => walletConnected,
            pubkey: () => (walletConnected ? '0x' + 'a0'.repeat(48) : null),
          },
        },
        {
          provide: CommitteeVoteRunnerService,
          useValue: { castVote: runnerCastVote },
        },
      ],
    });
    fixture = TestBed.createComponent(CommitteeComponent);
    component = fixture.componentInstance;
  }

  async function flushReload(): Promise<void> {
    fixture.detectChanges();
    // Allow the constructor-kicked reload() promise to resolve.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ── Boot ────────────────────────────────────────────────────────────

  it('reads tracker state on construction and stores the snapshot', async () => {
    const snap: TrackerStateSnapshot = {
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 500_000n,
      minProposalStake: 10_000n,
      votingWindowSeconds: 300n,
    };
    setUp(snap);
    await flushReload();
    expect(tracker.readCurrentState).toHaveBeenCalledTimes(1);
    expect(component.snapshot()).toEqual(snap);
    expect(component.error()).toBeNull();
    expect(component.openCount()).toBe(0);
    expect(component.lastCheckedAt()).toBeGreaterThan(0);
  });

  it('surfaces the reader error and clears the snapshot', async () => {
    setUp(new Error('coinset timeout'));
    await flushReload();
    expect(component.snapshot()).toBeNull();
    expect(component.error()).toContain('coinset timeout');
  });

  it('renders the IDLE empty card with quorum threshold and window from env', async () => {
    setUp({
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 500_000n,
      minProposalStake: 10_000n,
      votingWindowSeconds: 300n,
    });
    await flushReload();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No open proposal');
    expect(text).toContain('500,000 SGT');
    expect(text).toContain('Voting window: 300s');
  });

  // ── OPEN state rendering ────────────────────────────────────────────

  it('renders OPEN state with bill summary and a Vote YES button', async () => {
    setUp({
      kind: 'OPEN',
      proposalHash: '0x' + '01'.repeat(32),
      bill: mintBill(),
      voteTally: 250_000n,
      votingDeadlineSeconds: BigInt(Math.floor(Date.now() / 1000) + 600),
      quorumRequired: 500_000n,
      spendCount: 1,
      lastSpendBlockIndex: 5,
    });
    await flushReload();
    const host: HTMLElement = fixture.nativeElement;
    const text = host.textContent ?? '';
    expect(text).toContain('MINT — spawn deed coin');
    expect(text).toContain('proposal_hash 0x' + '01'.repeat(32));
    expect(text).toContain('250,000 / 500,000 SGT (50%)');
    expect(text).toContain('GC:VOTING');
    expect(text).toContain('Committee can vote on this MINT proposal.');
    const voteBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Vote YES'),
    );
    expect(voteBtn).withContext('Vote YES button rendered').toBeTruthy();
    // Disabled by default — no wallet, no amount input.
    expect(voteBtn?.hasAttribute('disabled')).toBeTrue();
  });

  it('renders AWAITING_EXECUTE MINT proposals as GC:PASSED with execute action', async () => {
    setUp({
      kind: 'AWAITING_EXECUTE',
      proposalHash: '0x' + '01'.repeat(32),
      bill: mintBill(),
      voteTally: 800_000n,
      votingDeadlineSeconds: BigInt(Math.floor(Date.now() / 1000) - 60),
      quorumRequired: 500_000n,
      spendCount: 2,
      lastSpendBlockIndex: 9,
    });
    await flushReload();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('GC:PASSED');
    expect(text).toContain('Execute the passed MINT proposal.');
    expect(text).toContain('offer artifacts wait for MINTED evidence');
  });

  it('renders AWAITING_EXPIRE MINT proposals as GC:FAILED without offer-ready language', async () => {
    setUp({
      kind: 'AWAITING_EXPIRE',
      proposalHash: '0x' + '01'.repeat(32),
      bill: mintBill(),
      voteTally: 100_000n,
      votingDeadlineSeconds: BigInt(Math.floor(Date.now() / 1000) - 60),
      quorumRequired: 500_000n,
      spendCount: 2,
      lastSpendBlockIndex: 9,
    });
    await flushReload();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('GC:FAILED');
    expect(text).toContain('Expire the failed MINT proposal.');
    expect(text).toContain('No deed or member purchase artifact will be produced.');
    expect(text).not.toContain('OP:OFFER_READY');
    expect(text).not.toContain('offer-ready');
  });

  it('shows AWAITING_EXECUTE pill once the deadline has passed and quorum is met', async () => {
    setUp({
      kind: 'AWAITING_EXECUTE',
      proposalHash: '0x' + '01'.repeat(32),
      bill: { kind: 'FREEZE', newPoolStatus: 0 },
      voteTally: 800_000n,
      votingDeadlineSeconds: BigInt(Math.floor(Date.now() / 1000) - 60),
      quorumRequired: 500_000n,
      spendCount: 2,
      lastSpendBlockIndex: 9,
    });
    await flushReload();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-state="AWAITING_EXECUTE"]')).toBeTruthy();
    expect(host.textContent ?? '').toContain('FREEZE pool');
  });

  // ── Bill renderers (units) ──────────────────────────────────────────

  it('renders headlines for every bill kind', () => {
    setUp({
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 500_000n,
      minProposalStake: 10_000n,
      votingWindowSeconds: 300n,
    });
    fixture.detectChanges();
    expect(
      component.billHeadline({
        kind: 'MINT',
        deedFullPuzzleHash: '0x00',
        propertyIdCanon: '0x00',
        propertyRegistryPuzzleHash: '0x00',
      }),
    ).toContain('MINT');
    expect(
      component.billHeadline({ kind: 'FREEZE', newPoolStatus: 0 }),
    ).toContain('FREEZE pool');
    expect(
      component.billHeadline({ kind: 'FREEZE', newPoolStatus: 1 }),
    ).toContain('UNFREEZE pool');
    expect(
      component.billHeadline({
        kind: 'SETTLE',
        splitxchRoot: '0x00',
        totalAmount: 1n,
        numDeeds: 1n,
        deedReleasesHash: '0x' + '00'.repeat(32),
      }),
    ).toContain('SETTLE');
    expect(
      component.billHeadline({
        kind: 'VAULT_VERSION',
        newVaultInnerModHash: '0x00',
        newCanonicalParamsHash: '0x00',
        newVaultVersion: 2n,
      }),
    ).toContain('v2');
    expect(
      component.billHeadline({ kind: 'UNKNOWN', tagHex: '0x5a' }),
    ).toContain('Unknown');
  });

  it('serialises bigint fields in the bill JSON detail block', () => {
    setUp({
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 500_000n,
      minProposalStake: 10_000n,
      votingWindowSeconds: 300n,
    });
    fixture.detectChanges();
    const json = component.billDetailJson({
      kind: 'SETTLE',
      splitxchRoot: '0x0a',
      totalAmount: 123n,
      numDeeds: 4n,
      deedReleasesHash: '0x' + '0d'.repeat(32),
    });
    expect(json).toContain('"totalAmount": "123"');
    expect(json).toContain('"numDeeds": "4"');
    expect(json).toContain('"deedReleasesHash"');
  });

  // ── Helpers ─────────────────────────────────────────────────────────

  it('clamps progressPct to [0, 100] and returns 0 for non-open snapshots', async () => {
    setUp({
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 500_000n,
      minProposalStake: 10_000n,
      votingWindowSeconds: 300n,
    });
    await flushReload();
    const idle = component.snapshot() as TrackerStateSnapshot;
    expect(component.progressPct(idle)).toBe(0);

    const open: TrackerStateSnapshot = {
      kind: 'OPEN',
      proposalHash: '0x01',
      bill: { kind: 'FREEZE', newPoolStatus: 0 },
      voteTally: 1_500_000n,
      votingDeadlineSeconds: BigInt(Math.floor(Date.now() / 1000) + 60),
      quorumRequired: 500_000n,
      spendCount: 1,
      lastSpendBlockIndex: 5,
    };
    expect(component.progressPct(open)).toBe(100);
  });

  it('returns "closed" from formatRemaining once the deadline has elapsed', () => {
    setUp({
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 500_000n,
      minProposalStake: 10_000n,
      votingWindowSeconds: 300n,
    });
    fixture.detectChanges();
    expect(component.formatRemaining(BigInt(Math.floor(Date.now() / 1000) - 1))).toBe('closed');
  });

  // ── Vote button gating ──────────────────────────────────────────────

  it('canVote returns false for any non-OPEN state', () => {
    setUp({
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 500_000n,
      minProposalStake: 10_000n,
      votingWindowSeconds: 300n,
    });
    fixture.detectChanges();
    const idle: TrackerStateSnapshot = {
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 1n,
      minProposalStake: 1n,
      votingWindowSeconds: 300n,
    };
    expect(component.canVote(idle)).toBeFalse();
  });

  it('canVote returns false for OPEN when wallet is not connected', () => {
    setUp(
      {
        kind: 'IDLE',
        spendCount: 0,
        lastSpendBlockIndex: null,
        quorumRequired: 500_000n,
        minProposalStake: 10_000n,
        votingWindowSeconds: 300n,
      },
      { walletConnected: false },
    );
    fixture.detectChanges();
    const open: TrackerStateSnapshot = {
      kind: 'OPEN',
      proposalHash: '0x01',
      bill: { kind: 'FREEZE', newPoolStatus: 0 },
      voteTally: 1n,
      votingDeadlineSeconds: BigInt(Math.floor(Date.now() / 1000) + 60),
      quorumRequired: 1n,
      spendCount: 1,
      lastSpendBlockIndex: 5,
    };
    expect(component.canVote(open)).toBeFalse();
  });

  it('canVote returns true for OPEN when wallet is connected', () => {
    setUp(
      {
        kind: 'IDLE',
        spendCount: 0,
        lastSpendBlockIndex: null,
        quorumRequired: 500_000n,
        minProposalStake: 10_000n,
        votingWindowSeconds: 300n,
      },
      { walletConnected: true },
    );
    fixture.detectChanges();
    const open: TrackerStateSnapshot = {
      kind: 'OPEN',
      proposalHash: '0x01',
      bill: { kind: 'FREEZE', newPoolStatus: 0 },
      voteTally: 1n,
      votingDeadlineSeconds: BigInt(Math.floor(Date.now() / 1000) + 60),
      quorumRequired: 1n,
      spendCount: 1,
      lastSpendBlockIndex: 5,
    };
    expect(component.canVote(open)).toBeTrue();
  });

  it('hasValidAmount only accepts positive integers', () => {
    setUp({
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 500_000n,
      minProposalStake: 10_000n,
      votingWindowSeconds: 300n,
    });
    fixture.detectChanges();
    component.voteAmountInput = '';
    expect(component.hasValidAmount()).toBeFalse();
    component.voteAmountInput = '0';
    expect(component.hasValidAmount()).toBeFalse();
    component.voteAmountInput = 'abc';
    expect(component.hasValidAmount()).toBeFalse();
    component.voteAmountInput = '100';
    expect(component.hasValidAmount()).toBeTrue();
  });

  // ── Vote submission ─────────────────────────────────────────────────

  it('submitVote no-ops when no valid amount is set', async () => {
    setUp(
      {
        kind: 'IDLE',
        spendCount: 0,
        lastSpendBlockIndex: null,
        quorumRequired: 500_000n,
        minProposalStake: 10_000n,
        votingWindowSeconds: 300n,
      },
      { walletConnected: true },
    );
    fixture.detectChanges();
    await component.submitVote();
    expect(runnerCastVote).not.toHaveBeenCalled();
    expect(component.lastVoteResult()).toBeNull();
  });

  it('submitVote calls the runner with the typed BigInt amount and stores the result', async () => {
    setUp(
      {
        kind: 'IDLE',
        spendCount: 0,
        lastSpendBlockIndex: null,
        quorumRequired: 500_000n,
        minProposalStake: 10_000n,
        votingWindowSeconds: 300n,
      },
      {
        walletConnected: true,
        castVoteResult: {
          kind: 'submitted',
          apiResponse: {
            pushed: true,
            status: 'SUCCESS',
            spendBundleId: '0x' + 'bb'.repeat(32),
          },
          pickedCoin: {
            parentCoinInfo: '0x' + '55'.repeat(32),
            puzzleHash: '0x' + 'ff'.repeat(32),
            amount: 250_000,
            confirmedBlockIndex: 1,
          },
          voterInnerPuzzleHash: '0x' + 'dd'.repeat(32),
        },
      },
    );
    fixture.detectChanges();
    component.voteAmountInput = '250000';
    await component.submitVote();
    expect(runnerCastVote).toHaveBeenCalledTimes(1);
    expect(runnerCastVote.calls.mostRecent().args[0]).toEqual({
      additionalVoteAmount: BigInt(250_000),
    });
    const result = component.lastVoteResult();
    expect(result?.kind).toBe('submitted');
    expect(component.voteResultOk(result!)).toBeTrue();
  });

  it('submitVote stores the failure result without throwing on runner pre-flight errors', async () => {
    setUp(
      {
        kind: 'IDLE',
        spendCount: 0,
        lastSpendBlockIndex: null,
        quorumRequired: 500_000n,
        minProposalStake: 10_000n,
        votingWindowSeconds: 300n,
      },
      {
        walletConnected: true,
        castVoteResult: {
          kind: 'no-coin-matches-vote-amount',
          availableAmounts: [100, 200],
          requestedAmount: BigInt(300),
        },
      },
    );
    fixture.detectChanges();
    component.voteAmountInput = '300';
    await component.submitVote();
    const result = component.lastVoteResult();
    expect(result?.kind).toBe('no-coin-matches-vote-amount');
    expect(component.voteResultOk(result!)).toBeFalse();
    expect(component.voteResultDetail(result!)).toContain('100, 200');
  });

  it('voteResultHeadline covers every runner result kind', () => {
    setUp({
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 500_000n,
      minProposalStake: 10_000n,
      votingWindowSeconds: 300n,
    });
    fixture.detectChanges();
    const cases: VoteRunResult[] = [
      {
        kind: 'submitted',
        apiResponse: {
          pushed: true,
          status: 'SUCCESS',
          spendBundleId: '0x' + 'aa'.repeat(32),
        },
        pickedCoin: {
          parentCoinInfo: '0x',
          puzzleHash: '0x',
          amount: 1,
          confirmedBlockIndex: 0,
        },
        voterInnerPuzzleHash: '0x',
      },
      { kind: 'invalid-input', reason: 'additional-vote-amount-must-be-positive' },
      { kind: 'wallet-not-connected' },
      { kind: 'tracker-not-open' },
      { kind: 'sgt-not-deployed' },
      {
        kind: 'no-sgt-coins',
        discovery: { kind: 'no-coins', catSgtFreePuzzleHash: '0x' + 'ff'.repeat(32) },
      },
      {
        kind: 'no-coin-matches-vote-amount',
        availableAmounts: [],
        requestedAmount: BigInt(1),
      },
      { kind: 'spend-builder-failed', error: 'boom' },
    ];
    for (const c of cases) {
      expect(component.voteResultHeadline(c)).toBeTruthy();
      expect(component.voteResultDetail(c)).toBeTruthy();
    }
  });
});
