import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChiaSingletonReaderService } from '../../../services/chia-singleton-reader.service';
import { CoinsetService } from '../../../services/coinset.service';
import { SolslotPublicArtifact } from '../../../services/solslot-api.service';
import { SolslotProtocolArtifactService } from '../../../services/solslot-protocol-artifact.service';
import { TrustRootsComponent } from './trust-roots.component';

describe('TrustRootsComponent', () => {
  let fixture: ComponentFixture<TrustRootsComponent>;
  let singleton: jasmine.SpyObj<ChiaSingletonReaderService>;
  let coinset: jasmine.SpyObj<CoinsetService>;
  let artifactService: {
    artifact: SolslotPublicArtifact | null;
    failure: string;
  };

  beforeEach(async () => {
    singleton = jasmine.createSpyObj('ChiaSingletonReaderService', ['walkLineage']);
    coinset = jasmine.createSpyObj('CoinsetService', ['getCoinRecordByName']);
    artifactService = { artifact: artifact(), failure: '' };
    await TestBed.configureTestingModule({
      imports: [TrustRootsComponent],
      providers: [
        provideRouter([]),
        { provide: ChiaSingletonReaderService, useValue: singleton },
        { provide: CoinsetService, useValue: coinset },
        { provide: SolslotProtocolArtifactService, useValue: artifactService },
      ],
    }).compileComponents();
  });

  it('shows exactly the eight signed V2 ceremony roots', () => {
    create();
    const text = normalizedText();

    expect(text).toContain('Signed artifact verified');
    expect(text).toContain('SGT genesis');
    expect(text).toContain('Pool V3');
    expect(text).toContain('Protocol DID');
    expect(text).toContain('Governance');
    expect(text).toContain('NAV registry');
    expect(text).toContain('Protocol config');
    expect(text).toContain('Admin authority');
    expect(text).toContain('Vault version registry');
    expect(fixture.nativeElement.querySelectorAll('article.card').length).toBe(8);
    expect(text).not.toContain('Launch A.3');
  });

  it('fails closed when this build has no verified artifact', () => {
    artifactService.artifact = null;
    artifactService.failure = 'Artifact signature quorum is unavailable.';
    create();

    const text = normalizedText();
    expect(text).toContain('Protocol writes locked');
    expect(text).toContain('Signed artifact unavailable');
    expect(text).toContain('Artifact signature quorum is unavailable.');
    expect(fixture.nativeElement.querySelectorAll('article.card').length).toBe(0);
  });

  it('checks the genesis coin and all seven singleton lineages', async () => {
    const signedArtifact = artifactService.artifact!;
    coinset.getCoinRecordByName.and.resolveTo({
      confirmed_block_index: signedArtifact.ceremony.confirmedBlockIndex,
    } as never);
    singleton.walkLineage.and.callFake(
      async (launcherId: string) =>
        ({
          launcherId,
          launcherCoinId: launcherId,
          launcher: {
            confirmed_block_index: signedArtifact.ceremony.confirmedBlockIndex,
          },
          nodes: [
            {
              coinId: launcherId,
              parentCoinId: hex(50),
              puzzleHash: hex(51),
              amount: 1,
              confirmedBlockIndex: signedArtifact.ceremony.confirmedBlockIndex,
              spentBlockIndex: signedArtifact.ceremony.confirmedBlockIndex,
              isLauncher: true,
            },
            {
              coinId: hex(52),
              parentCoinId: launcherId,
              puzzleHash: hex(53),
              amount: 1,
              confirmedBlockIndex: signedArtifact.ceremony.confirmedBlockIndex,
              spentBlockIndex: null,
              isLauncher: false,
            },
          ],
        }) as never,
    );
    create();

    await fixture.componentInstance.verifyAll();
    fixture.detectChanges();

    expect(coinset.getCoinRecordByName).toHaveBeenCalledOnceWith(signedArtifact.sgtGenesisCoinId);
    expect(singleton.walkLineage).toHaveBeenCalledTimes(7);
    expect(fixture.componentInstance.confirmedCount()).toBe(8);
    expect(normalizedText()).toContain('8 of 8 verified');
  });

  it('does not accept a singleton launched outside the signed ceremony block', async () => {
    const signedArtifact = artifactService.artifact!;
    singleton.walkLineage.and.resolveTo({
      launcherId: signedArtifact.launcherIds.pool,
      launcherCoinId: signedArtifact.launcherIds.pool,
      launcher: {
        confirmed_block_index: signedArtifact.ceremony.confirmedBlockIndex + 1,
      },
      nodes: [
        { isLauncher: true, spentBlockIndex: 10 },
        { isLauncher: false, spentBlockIndex: null },
      ],
    } as never);
    create();

    await fixture.componentInstance.verifyRoot(
      fixture.componentInstance.roots().find((root) => root.key === 'pool')!,
    );

    expect(fixture.componentInstance.status('pool').kind).toBe('error');
  });

  function create(): void {
    fixture = TestBed.createComponent(TrustRootsComponent);
    fixture.detectChanges();
  }

  function normalizedText(): string {
    return String(fixture.nativeElement.textContent).replace(/\s+/g, ' ').trim();
  }
});

function artifact(): SolslotPublicArtifact {
  const launchers = {
    pool: hex(1),
    did: hex(2),
    governance: hex(3),
    navRegistry: hex(4),
    protocolConfig: hex(5),
    adminAuthority: hex(6),
    vaultVersionRegistry: hex(7),
    propertyRegistry: hex(20),
  };
  return {
    schemaVersion: 2,
    protocolVersion: 'solslot-v2',
    network: 'testnet11',
    evmChainId: 11155111,
    reviewClass: 'internal-engineering-testnet',
    testOnly: true,
    auditStatus: 'unaudited',
    buildTimestamp: '2026-07-14T00:00:00Z',
    artifactHash: hex(8),
    sourceShas: {
      protocol: '1'.repeat(40),
      evm: '2'.repeat(40),
      api: '3'.repeat(40),
      customerWeb: '4'.repeat(40),
      adminPortal: '5'.repeat(40),
    },
    ceremony: {
      ceremonyId: 'ceremony-1',
      planHash: hex(9),
      spendBundleId: hex(10),
      confirmedBlockIndex: 1_234,
      requiredChiaConfirmations: 3,
    },
    launcherIds: launchers,
    puzzleHashes: {
      poolInnerPuzzleHash: hex(11),
      didInnerPuzzleHash: hex(21),
      didFullPuzzleHash: hex(22),
      propertyRegistryFullPuzzleHash: hex(23),
      p2PoolModHash: hex(24),
      p2VaultModHash: hex(25),
    },
    sgtGenesisCoinId: hex(12),
    sgtTailHash: hex(13),
    governanceStruct: {
      treeHash: hex(14),
      launcherId: launchers.governance,
      serialized: '0xff80',
      mintExecuteCosignerPubkey: `0x${'2b'.repeat(48)}`,
    },
    protocolDid: {
      launcherId: launchers.did,
      singletonStruct: '0xff80',
      innerPuzzleHash: hex(21),
      fullPuzzleHash: hex(22),
    },
    propertyRegistry: {
      launcherId: launchers.propertyRegistry,
      governanceBlsPubkey: `0x${'31'.repeat(48)}`,
      currentPuzzleHash: hex(23),
    },
    protocolParameters: {
      smartDeedPuzzleVersion: 3,
      poolPuzzleVersion: 3,
      sgtTotalSupply: 1_000_000,
      quorumBps: 6_667,
      votingWindowSeconds: 86_400,
      minProposalStake: 1,
    },
    stateVersions: {
      navRegistry: 1,
      protocolConfig: 2,
      adminAuthority: 2,
      vault: 2,
      propertyRegistry: 0,
    },
    adminAuthority: {
      threshold: 2,
      rosterHash: hex(15),
      mipsRootHash: hex(16),
      compressedPubkeys: [compressed(1), compressed(2), compressed(3)],
    },
    validatorSet: {
      threshold: 2,
      pubkeys: [compressed(4), compressed(5), compressed(6)],
    },
    bridgePolicy: {
      policyVersion: 2,
      policyHash: hex(17),
      initialCoinCount: 32,
      lowWaterMark: 8,
      parentCoinIds: Array.from({ length: 32 }, (_, index) => hex(30 + index)),
      bridgeCoinIds: Array.from({ length: 32 }, (_, index) => hex(70 + index)),
    },
    canonicalVaultParamsHash: hex(18),
    evmAddresses: {
      forwarder: address(1),
      verifierAdapter: address(2),
      attestationEmitter: address(3),
    },
    signaturePolicy: { type: 'eip712', threshold: 2, rosterHash: hex(15) },
    retiredCoordinates: [hex(19)],
    signatures: [],
  };
}

function hex(seed: number): string {
  return `0x${seed.toString(16).padStart(2, '0').repeat(32)}`;
}

function address(seed: number): string {
  return `0x${seed.toString(16).padStart(2, '0').repeat(20)}`;
}

function compressed(seed: number): string {
  return `0x02${seed.toString(16).padStart(2, '0').repeat(32)}`;
}
