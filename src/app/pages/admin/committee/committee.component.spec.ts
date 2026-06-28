import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CommitteeComponent } from './committee.component';
import {
  DecodedBill,
  GovernanceTrackerReaderService,
  TrackerStateSnapshot,
} from '../../../services/governance-tracker-reader.service';

describe('CommitteeComponent', () => {
  let fixture: ComponentFixture<CommitteeComponent>;
  let component: CommitteeComponent;
  let tracker: jasmine.SpyObj<Pick<GovernanceTrackerReaderService, 'readCurrentState'>>;

  function setUp(snapshot: TrackerStateSnapshot | Error): void {
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
    expect(text).toContain('500,000 PGT');
    expect(text).toContain('Voting window: 300s');
  });

  // ── OPEN state rendering ────────────────────────────────────────────

  it('renders OPEN state with bill summary and a disabled Vote YES button', async () => {
    const mintBill: DecodedBill = {
      kind: 'MINT',
      deedFullPuzzleHash: '0x' + '02'.repeat(32),
    };
    setUp({
      kind: 'OPEN',
      proposalHash: '0x' + '01'.repeat(32),
      bill: mintBill,
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
    expect(text).toContain('250,000 / 500,000 PGT (50%)');
    const voteBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Vote YES'),
    );
    expect(voteBtn).withContext('Vote YES button rendered').toBeTruthy();
    expect(voteBtn?.hasAttribute('disabled')).toBeTrue();
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
      component.billHeadline({ kind: 'MINT', deedFullPuzzleHash: '0x00' }),
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
    });
    expect(json).toContain('"totalAmount": "123"');
    expect(json).toContain('"numDeeds": "4"');
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

  it('uniformly returns false from canVote() in this brick', () => {
    setUp({
      kind: 'IDLE',
      spendCount: 0,
      lastSpendBlockIndex: null,
      quorumRequired: 500_000n,
      minProposalStake: 10_000n,
      votingWindowSeconds: 300n,
    });
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
});
