import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ChiaWalletService } from '../chia-wallet.service';
import { ChiaWasmService } from '../chia-wasm.service';
import { CommitteeApiService } from '../committee-api.service';
import { CoinsetService } from '../coinset.service';
import {
  GovernanceTrackerReaderService,
  IdleStateProposeInputs,
} from '../governance-tracker-reader.service';
import { SgtCoinDiscoveryService } from '../sgt-driver/sgt-coin-discovery.service';
import { SgtDriverService } from '../sgt-driver/sgt-driver.service';
import { WalletCoinPickerService } from '../wallet-coin-picker.service';
import { MintProposalV2Service } from './mint-proposal-v2.service';
import { MintPublishService } from './mint-publish.service';
import { MintPublishSpendBuilderService } from './mint-publish-spend-builder.service';
import {
  MintProposalV2PublishRunnerService,
  PublishMintArgs,
} from './mint-proposal-v2-publish-runner.service';
import { coinId } from '../../utils/chia-hash';
import { environment } from '../../../environments/environment';

const TRACKER_LAUNCHER = '0x' + 'bb'.repeat(32);
const PROPOSAL_HASH = '0x' + 'ee'.repeat(32);
const PROPOSAL_DATA_HASH = '0x' + 'cd'.repeat(32);
const BILL_OP_HEX = '0xff4d80';
const SGT_PUZZLE_HASH = '0x' + 'ff'.repeat(32);
const SGT_LOCKED_CAT_PUZZLE_HASH = '0x' + '31'.repeat(32);
const XCH_COIN_ID = '0x' + '99'.repeat(32);
// Shared 32-byte value used by the fake Clvm so the XCH-parent
// WRONG_PUZZLE_HASH guard (deserialize().treeHash() === coin.puzzleHash)
// passes deterministically.
const FAKE_PH = new Uint8Array(32).fill(0x77);
const REGISTRY_COIN_SPEND = {
  coin: {
    parentCoinInfo: '0x' + 'f6'.repeat(32),
    puzzleHash: '0x' + '08'.repeat(32),
    amount: 1n,
  },
  puzzleReveal: '0xff01',
  solution: '0xff80',
};

function bytes(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function idleInputs(): IdleStateProposeInputs {
  return {
    trackerCoin: {
      parentCoinInfo: '0x' + '11'.repeat(32),
      puzzleHash: '0x' + '22'.repeat(32),
      amount: 1,
    },
    trackerInnerPuzzleHex: '0xff80',
    trackerLauncherId: TRACKER_LAUNCHER,
    lineageProof: {
      parentName: '0x' + '33'.repeat(32),
      innerPuzzleHash: '0x' + '44'.repeat(32),
      amount: 1,
    },
  };
}

function defaultArgs(overrides: Partial<PublishMintArgs> = {}): PublishMintArgs {
  return {
    propertyIdCanon: '0x' + '01'.repeat(32),
    collectionIdCanon: '0x' + '09'.repeat(32),
    sharePpm: 750_000,
    parValueMojos: 1_000_000,
    assetClass: 1,
    jurisdictionHex: '0x5553',
    royaltyPuzhash: '0x' + '02'.repeat(32),
    royaltyBps: 250,
    quorumThreshold: 5000,
    ownerMemberHash: '0x' + '03'.repeat(32),
    govMemberHash: '0x' + '04'.repeat(32),
    protocolDidSingletonStructHex: '0xff80',
    protocolDidPuzhash: '0x' + '05'.repeat(32),
    p2PoolModHash: '0x' + '06'.repeat(32),
    p2VaultModHash: '0x' + '07'.repeat(32),
    propertyRegistryPuzzleHash: '0x' + '08'.repeat(32),
    propertyRegistryCoinSpend: REGISTRY_COIN_SPEND,
    firstVoteAmount: 10_000,
    votingWindowSeconds: 86_400,
    nowSeconds: 1_000_000,
    ...overrides,
  };
}

function makeMockedRunner(overrides: {
  pubkey?: string | null;
  idle?: IdleStateProposeInputs | null;
  idleThrows?: boolean;
  discoverKind?: 'found' | 'no-coins' | 'sgt-not-deployed' | 'governance-not-deployed';
  coins?: Array<{ parentCoinInfo: string; puzzleHash: string; amount: number; confirmedBlockIndex: number }>;
  pickerThrows?: boolean;
  coinRecordNull?: boolean;
  signImpl?: jasmine.Spy;
  buildEveImpl?: jasmine.Spy;
  buildRegistryAssertImpl?: jasmine.Spy;
  buildTrackerImpl?: jasmine.Spy;
  buildSgtImpl?: jasmine.Spy;
  publishImpl?: jasmine.Spy;
}): {
  service: MintProposalV2PublishRunnerService;
  signSpy: jasmine.Spy;
  publishSpy: jasmine.Spy;
  registryAssertSpy: jasmine.Spy;
} {
  const signSpy =
    overrides.signImpl ??
    jasmine.createSpy('signSpendBundle').and.resolveTo({
      coinSpends: [],
      aggregatedSignature: '0x' + 'a0'.repeat(96),
    });
  const wallet = {
    pubkey: () => overrides.pubkey ?? null,
    signSpendBundle: signSpy,
  } as unknown as ChiaWalletService;

  const wasm = {
    sdk: () => ({
      Clvm: class {
        createCoin() {
          return { __cond: true };
        }
        delegatedSpend() {
          return {
            puzzle: { serialize: () => new Uint8Array([0x01]) },
            solution: { serialize: () => new Uint8Array([0x80]) },
          };
        }
        standardSpend() {
          return {
            puzzle: { serialize: () => new Uint8Array([0x01]) },
            solution: { serialize: () => new Uint8Array([0x80]) },
          };
        }
        spendStandardCoin() {
          /* no-op */
        }
        coinSpends() {
          return [
            {
              coin: {
                parentCoinInfo: bytes(0x11),
                puzzleHash: FAKE_PH,
                amount: 1_000_000n,
              },
              puzzleReveal: new Uint8Array([0x01]),
              solution: new Uint8Array([0x80]),
            },
          ];
        }
        deserialize() {
          return {
            treeHash: () => FAKE_PH,
            serialize: () => new Uint8Array([0x01]),
            curry: () => ({ treeHash: () => FAKE_PH, serialize: () => new Uint8Array([0x01]) }),
          };
        }
      },
      Coin: class {
        coinId() {
          return hexToBytesLocal(XCH_COIN_ID);
        }
        parentCoinInfo = bytes(0x11);
        puzzleHash = bytes(0x22);
        amount = 1_000_000n;
      },
      PublicKey: { fromBytes: () => ({}) },
      standardPuzzleHash: () => bytes(0xdd),
    }),
  } as unknown as ChiaWasmService;

  const tracker = {
    getIdleStateProposeInputs: overrides.idleThrows
      ? jasmine.createSpy('getIdleStateProposeInputs').and.rejectWith(
          new Error('reconstructed tracker full puzzle hash mismatch'),
        )
      : jasmine
          .createSpy('getIdleStateProposeInputs')
          .and.resolveTo('idle' in overrides ? overrides.idle : idleInputs()),
  } as unknown as GovernanceTrackerReaderService;

  const discoveryResult =
    overrides.discoverKind === 'sgt-not-deployed'
      ? { kind: 'sgt-not-deployed' as const }
      : overrides.discoverKind === 'governance-not-deployed'
        ? { kind: 'governance-not-deployed' as const }
        : overrides.discoverKind === 'no-coins'
          ? { kind: 'no-coins' as const, catSgtFreePuzzleHash: SGT_PUZZLE_HASH }
          : {
              kind: 'found' as const,
              catSgtFreePuzzleHash: SGT_PUZZLE_HASH,
              coins: overrides.coins ?? [
                {
                  parentCoinInfo: '0x' + '55'.repeat(32),
                  puzzleHash: SGT_PUZZLE_HASH,
                  amount: 10_000,
                  confirmedBlockIndex: 1,
                },
              ],
              totalMojos: BigInt(10_000),
            };
  const discovery = {
    discover: jasmine.createSpy('discover').and.resolveTo(discoveryResult),
  } as unknown as SgtCoinDiscoveryService;

  const sgt = {
    trackerStructHash: jasmine.createSpy('trackerStructHash').and.returnValue(bytes(0x10)),
    sgtLockedInnerHash: jasmine.createSpy('sgtLockedInnerHash').and.returnValue(bytes(0x20)),
    sgtTailHash: jasmine.createSpy('sgtTailHash').and.returnValue(bytes(0x30)),
    catSgtFreePuzzleHash: jasmine
      .createSpy('catSgtFreePuzzleHash')
      .and.returnValue(bytes(0x31)),
  } as unknown as SgtDriverService;

  const publish = {
    buildMintPublishArtifacts: jasmine.createSpy('buildMintPublishArtifacts').and.returnValue({
      smartDeedInnerPuzhash: '0x' + 'aa'.repeat(32),
      eveInnerPuzhash: '0x' + 'ab'.repeat(32),
      deedFullPuzhash: '0x' + 'ac'.repeat(32),
      proposalHash: PROPOSAL_HASH,
      deedLauncherId: '0x' + 'ad'.repeat(32),
      proposalSingletonLauncherId: '0x' + 'ae'.repeat(32),
      proposalDataHash: PROPOSAL_DATA_HASH,
      billOpProgramHex: BILL_OP_HEX,
      billOpProgramHash: PROPOSAL_HASH,
      deedSingletonStructProgramHex: '0xff80',
      deedSingletonStructProgramHash: '0x' + 'af'.repeat(32),
      proposalSingletonStructProgramHex: '0xff80',
      proposalSingletonStructProgramHash: '0x' + 'b0'.repeat(32),
    }),
    deedLauncherPuzzleHash: jasmine.createSpy('deedLauncherPuzzleHash').and.returnValue(bytes(0x40)),
  } as unknown as MintPublishService;

  const v2 = {
    makeInnerPuzzleHex: jasmine.createSpy('makeInnerPuzzleHex').and.returnValue('0xffabcd'),
  } as unknown as MintProposalV2Service;

  const registryAssertSpy =
    overrides.buildRegistryAssertImpl ??
    jasmine
      .createSpy('buildPropertyRegistryAssertConditionHex')
      .and.returnValue('0xff03');
  const spendBuilder = {
    buildProposalEveLaunchSpend:
      overrides.buildEveImpl ??
      jasmine.createSpy('buildProposalEveLaunchSpend').and.returnValue({
        parentConditionsHex: ['0xff01', '0xff02'],
        launcherCoinSpend: {
          coin: { parentCoinInfo: XCH_COIN_ID, puzzleHash: '0x' + 'ee'.repeat(32), amount: 1n },
          puzzleReveal: '0xff01',
          solution: '0xff80',
        },
        eveCoin: { parentCoinInfo: '0x' + 'ee'.repeat(32), puzzleHash: '0x' + 'ef'.repeat(32), amount: 1n },
        eveFullPuzzleHash: '0x' + 'ef'.repeat(32),
      }),
    buildPropertyRegistryAssertConditionHex: registryAssertSpy,
    buildTrackerProposeCoinSpend:
      overrides.buildTrackerImpl ??
      jasmine.createSpy('buildTrackerProposeCoinSpend').and.returnValue({
        coin: idleInputs().trackerCoin,
        puzzleReveal: '0xff01',
        solution: '0xff80',
      }),
    buildSgtFirstVoteCoinSpend:
      overrides.buildSgtImpl ??
      jasmine.createSpy('buildSgtFirstVoteCoinSpend').and.returnValue({
        coin: { parentCoinInfo: '0x' + '55'.repeat(32), puzzleHash: SGT_PUZZLE_HASH, amount: 10_000 },
        puzzleReveal: '0xff01',
        solution: '0xff80',
      }),
  } as unknown as MintPublishSpendBuilderService;

  const coinPicker = {
    pickLargestUnspentCoinForPuzzleHash: overrides.pickerThrows
      ? jasmine.createSpy('pick').and.rejectWith(new Error('No unspent coins'))
      : jasmine.createSpy('pick').and.resolveTo({
          coinId: XCH_COIN_ID,
          address: 'txch1xxx',
          puzzleHash: '0x' + 'dd'.repeat(32),
          amount: 1_000_000n,
        }),
  } as unknown as WalletCoinPickerService;

  const coinset = {
    getCoinRecordByName: jasmine.createSpy('getCoinRecordByName').and.resolveTo(
      overrides.coinRecordNull
        ? null
        : {
            coin: {
              parent_coin_info: '0x' + '11'.repeat(32),
              puzzle_hash: '0x' + 'dd'.repeat(32),
              amount: 1_000_000,
            },
            coinbase: false,
            confirmed_block_index: 1,
            spent_block_index: 0,
            timestamp: 0,
          },
    ),
  } as unknown as CoinsetService;

  const publishSpy =
    overrides.publishImpl ??
    jasmine.createSpy('publishProposal').and.resolveTo({
      pushed: true,
      status: 'SUCCESS',
      spendBundleId: '0x' + 'bb'.repeat(32),
    });
  const api = {
    publishProposal: publishSpy,
  } as unknown as CommitteeApiService;

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ChiaWalletService, useValue: wallet },
      { provide: ChiaWasmService, useValue: wasm },
      { provide: CoinsetService, useValue: coinset },
      { provide: GovernanceTrackerReaderService, useValue: tracker },
      { provide: SgtCoinDiscoveryService, useValue: discovery },
      { provide: SgtDriverService, useValue: sgt },
      { provide: MintPublishService, useValue: publish },
      { provide: MintProposalV2Service, useValue: v2 },
      { provide: MintPublishSpendBuilderService, useValue: spendBuilder },
      { provide: WalletCoinPickerService, useValue: coinPicker },
      { provide: CommitteeApiService, useValue: api },
    ],
  });

  const service = TestBed.inject(MintProposalV2PublishRunnerService);
  return { service, signSpy, publishSpy, registryAssertSpy };
}

function hexToBytesLocal(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe('MintProposalV2PublishRunnerService', () => {
  let originalSgtTailGenesisCoinId: string;

  beforeEach(() => {
    originalSgtTailGenesisCoinId = environment.solslotProtocol.sgtGenesisCoinId;
    (environment.solslotProtocol as { sgtGenesisCoinId: string }).sgtGenesisCoinId =
      '0x' + 'a0'.repeat(32);
  });

  afterEach(() => {
    (environment.solslotProtocol as { sgtGenesisCoinId: string }).sgtGenesisCoinId =
      originalSgtTailGenesisCoinId;
  });

  const PUBKEY = '0x' + 'a0'.repeat(48);

  it('rejects non-positive first-vote amount', async () => {
    const { service } = makeMockedRunner({ pubkey: PUBKEY });
    const res = await service.publishMint(defaultArgs({ firstVoteAmount: 0 }));
    expect(res.kind).toBe('invalid-input');
  });

  it('rejects non-positive voting window', async () => {
    const { service } = makeMockedRunner({ pubkey: PUBKEY });
    const res = await service.publishMint(defaultArgs({ votingWindowSeconds: 0 }));
    expect(res.kind).toBe('invalid-input');
  });

  it("returns 'property-registry-spend-required' before signing when registry spend is missing", async () => {
    const { service, signSpy } = makeMockedRunner({ pubkey: PUBKEY });
    const args = defaultArgs();
    delete args.propertyRegistryCoinSpend;

    const res = await service.publishMint(args);

    expect(res.kind).toBe('property-registry-spend-required');
    expect(signSpy).not.toHaveBeenCalled();
  });

  it("returns 'wallet-not-connected' when no pubkey", async () => {
    const { service } = makeMockedRunner({ pubkey: null });
    const res = await service.publishMint(defaultArgs());
    expect(res.kind).toBe('wallet-not-connected');
  });

  it("returns 'tracker-not-idle' when tracker is not IDLE", async () => {
    const { service } = makeMockedRunner({ pubkey: PUBKEY, idle: null });
    const res = await service.publishMint(defaultArgs());
    expect(res.kind).toBe('tracker-not-idle');
  });

  it("returns 'tracker-read-failed' when the reader throws", async () => {
    const { service } = makeMockedRunner({ pubkey: PUBKEY, idleThrows: true });
    const res = await service.publishMint(defaultArgs());
    expect(res.kind).toBe('tracker-read-failed');
  });

  it("returns 'sgt-not-deployed' when the genesis coin id is empty", async () => {
    (environment.solslotProtocol as { sgtGenesisCoinId: string }).sgtGenesisCoinId = '';
    const { service } = makeMockedRunner({ pubkey: PUBKEY });
    const res = await service.publishMint(defaultArgs());
    expect(res.kind).toBe('sgt-not-deployed');
  });

  it("returns 'no-sgt-coins' when discovery surfaces no-coins", async () => {
    const { service } = makeMockedRunner({ pubkey: PUBKEY, discoverKind: 'no-coins' });
    const res = await service.publishMint(defaultArgs());
    expect(res.kind).toBe('no-sgt-coins');
  });

  it("returns 'no-sgt-coin-matches-stake' when no coin equals the stake", async () => {
    const { service } = makeMockedRunner({
      pubkey: PUBKEY,
      coins: [
        { parentCoinInfo: '0x' + '55'.repeat(32), puzzleHash: SGT_PUZZLE_HASH, amount: 9_999, confirmedBlockIndex: 1 },
      ],
    });
    const res = await service.publishMint(defaultArgs({ firstVoteAmount: 10_000 }));
    expect(res.kind).toBe('no-sgt-coin-matches-stake');
    if (res.kind === 'no-sgt-coin-matches-stake') {
      expect(res.availableAmounts).toEqual([9_999]);
      expect(res.requestedAmount).toBe(BigInt(10_000));
    }
  });

  it("returns 'no-xch-coin' when the picker throws", async () => {
    const { service } = makeMockedRunner({ pubkey: PUBKEY, pickerThrows: true });
    const res = await service.publishMint(defaultArgs());
    expect(res.kind).toBe('no-xch-coin');
  });

  it("returns 'xch-coin-vanished' when the coin record is gone", async () => {
    const { service } = makeMockedRunner({ pubkey: PUBKEY, coinRecordNull: true });
    const res = await service.publishMint(defaultArgs());
    expect(res.kind).toBe('xch-coin-vanished');
  });

  it("surfaces 'spend-builder-failed' when a builder throws", async () => {
    const failing = jasmine
      .createSpy('buildTrackerProposeCoinSpend')
      .and.throwError(new Error("does not match coin's claimed puzzle hash"));
    const { service } = makeMockedRunner({ pubkey: PUBKEY, buildTrackerImpl: failing });
    const res = await service.publishMint(defaultArgs());
    expect(res.kind).toBe('spend-builder-failed');
    if (res.kind === 'spend-builder-failed') {
      expect(res.error).toMatch(/does not match/);
    }
  });

  it('happy path: signs a 5-spend bundle + POSTs to the committee API', async () => {
    const { service, signSpy, publishSpy } = makeMockedRunner({ pubkey: PUBKEY });
    const res = await service.publishMint(defaultArgs({ proposalId: 'draft-123' }));
    expect(res.kind).toBe('submitted');
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    // The bundle handed to the wallet must contain exactly 5 spends:
    // XCH parent, Artifact A launcher, tracker PROPOSE, SGT lock, registry registration.
    const passed = signSpy.calls.mostRecent().args[0] as unknown[];
    expect(passed.length).toBe(5);
    expect(passed[4]).toBe(REGISTRY_COIN_SPEND);
    // The API call must forward the draft id for correlation.
    const [, proposalArg] = publishSpy.calls.mostRecent().args;
    expect(proposalArg).toBe('draft-123');
    if (res.kind === 'submitted') {
      expect(res.apiResponse.pushed).toBe(true);
      expect(res.xchCoinId).toBe(XCH_COIN_ID);
      expect(res.artifacts.proposalHash).toBe(PROPOSAL_HASH);
      expect(res.pickedSgtCoin.amount).toBe(10_000);
      expect(res.sgtLockCoinId).toBe(
        coinId(
          coinId('0x' + '55'.repeat(32), SGT_PUZZLE_HASH, 10_000),
          SGT_LOCKED_CAT_PUZZLE_HASH,
          10_000,
        ),
      );
      // deadline = nowSeconds (1_000_000) + window (86_400).
      expect(res.votingDeadline).toBe(BigInt(1_086_400));
    }
  });

  it('forwards the re-derivation guard metadata as the third API arg', async () => {
    const { service, publishSpy } = makeMockedRunner({ pubkey: PUBKEY });
    await service.publishMint(
      defaultArgs({
        propertyIdCanon: '0x' + '01'.repeat(32),
        collectionIdCanon: '0x' + '09'.repeat(32),
        sharePpm: 750_000,
        parValueMojos: 1_000_000,
        assetClass: 1,
        jurisdictionHex: '0x5553',
        royaltyPuzhash: '0x' + '02'.repeat(32),
        royaltyBps: 250,
        quorumThreshold: 5000,
        ownerMemberHash: '0x' + '03'.repeat(32),
        govMemberHash: '0x' + '04'.repeat(32),
      }),
    );
    const [, , metadataArg] = publishSpy.calls.mostRecent().args;
    expect(metadataArg).toEqual({
      property_id_canon: '0x' + '01'.repeat(32),
      collection_id_canon: '0x' + '09'.repeat(32),
      share_ppm: 750_000,
      property_registry_puzzle_hash: '0x' + '08'.repeat(32),
      par_value_mojos: 1_000_000,
      asset_class: 1,
      jurisdiction: '0x5553',
      royalty_puzhash: '0x' + '02'.repeat(32),
      royalty_bps: 250,
      quorum_threshold: 5000,
      owner_member_hash: '0x' + '03'.repeat(32),
      gov_member_hash: '0x' + '04'.repeat(32),
    });
  });

  it('builds the property-registry assertion from the draft metadata', async () => {
    const { service, registryAssertSpy } = makeMockedRunner({ pubkey: PUBKEY });
    await service.publishMint(
      defaultArgs({
        propertyIdCanon: '0x' + '09'.repeat(32),
        propertyRegistryPuzzleHash: '0x' + '08'.repeat(32),
      }),
    );
    expect(registryAssertSpy).toHaveBeenCalledOnceWith({
      propertyRegistryPuzzleHash: '0x' + '08'.repeat(32),
      propertyIdCanon: '0x' + '09'.repeat(32),
    });
  });

  it('narrows bigint metadata inputs to JS numbers for JSON serialisation', async () => {
    const { service, publishSpy } = makeMockedRunner({ pubkey: PUBKEY });
    await service.publishMint(
      defaultArgs({
        parValueMojos: 1_000_000n,
        sharePpm: 750_000n,
        assetClass: 1n,
        royaltyBps: 250n,
        quorumThreshold: 5000n,
      }),
    );
    const [, , metadataArg] = publishSpy.calls.mostRecent().args;
    expect(metadataArg.par_value_mojos).toBe(1_000_000);
    expect(metadataArg.share_ppm).toBe(750_000);
    expect(metadataArg.asset_class).toBe(1);
    expect(metadataArg.royalty_bps).toBe(250);
    expect(metadataArg.quorum_threshold).toBe(5000);
    expect(typeof metadataArg.par_value_mojos).toBe('number');
    expect(typeof metadataArg.share_ppm).toBe('number');
  });

  it('normalises unprefixed hex metadata fields to 0x form', async () => {
    const { service, publishSpy } = makeMockedRunner({ pubkey: PUBKEY });
    await service.publishMint(
      defaultArgs({
        propertyIdCanon: '01'.repeat(32),
        collectionIdCanon: '09'.repeat(32),
        propertyRegistryPuzzleHash: '08'.repeat(32),
        jurisdictionHex: '5553',
        royaltyPuzhash: '02'.repeat(32),
        ownerMemberHash: '03'.repeat(32),
        govMemberHash: '04'.repeat(32),
      }),
    );
    const [, , metadataArg] = publishSpy.calls.mostRecent().args;
    expect(metadataArg.property_id_canon).toBe('0x' + '01'.repeat(32));
    expect(metadataArg.collection_id_canon).toBe('0x' + '09'.repeat(32));
    expect(metadataArg.property_registry_puzzle_hash).toBe('0x' + '08'.repeat(32));
    expect(metadataArg.jurisdiction).toBe('0x5553');
    expect(metadataArg.royalty_puzhash).toBe('0x' + '02'.repeat(32));
    expect(metadataArg.owner_member_hash).toBe('0x' + '03'.repeat(32));
    expect(metadataArg.gov_member_hash).toBe('0x' + '04'.repeat(32));
  });

  it('maps the signed bundle into the API wire shape', async () => {
    const signSpy = jasmine.createSpy('signSpendBundle').and.resolveTo({
      coinSpends: [
        {
          coin: { parentCoinInfo: '55'.repeat(32), puzzleHash: 'ff'.repeat(32), amount: 1 },
          puzzleReveal: 'ff01',
          solution: 'ff80',
        },
      ],
      aggregatedSignature: 'a0'.repeat(96),
    });
    const { service, publishSpy } = makeMockedRunner({ pubkey: PUBKEY, signImpl: signSpy });
    await service.publishMint(defaultArgs());
    const [bundleArg] = publishSpy.calls.mostRecent().args;
    // Hex fields must be 0x-normalised; amount must be a JS number.
    expect(bundleArg.coin_spends[0].coin.parent_coin_info).toBe('0x' + '55'.repeat(32));
    expect(bundleArg.coin_spends[0].coin.amount).toBe(1);
    expect(bundleArg.coin_spends[0].puzzle_reveal).toBe('0xff01');
    expect(bundleArg.aggregated_signature).toBe('0x' + 'a0'.repeat(96));
  });

  it("returns 'publish-failed' (with the signed bundle) when the API throws", async () => {
    const failing = jasmine
      .createSpy('publishProposal')
      .and.rejectWith(new Error('502 Bad Gateway'));
    const { service } = makeMockedRunner({ pubkey: PUBKEY, publishImpl: failing });
    const res = await service.publishMint(defaultArgs());
    expect(res.kind).toBe('publish-failed');
    if (res.kind === 'publish-failed') {
      expect(res.error).toMatch(/502/);
      // The signed bundle is preserved so the UI can offer a manual retry.
      expect(res.signedBundle.aggregatedSignature).toBe('0x' + 'a0'.repeat(96));
    }
  });

  it('surfaces a mempool rejection as submitted with pushed:false', async () => {
    const rejected = jasmine.createSpy('publishProposal').and.resolveTo({
      pushed: false,
      status: 'ASSERT_ANNOUNCE_CONSUMED_FAILED',
      spendBundleId: '0x' + 'cc'.repeat(32),
    });
    const { service } = makeMockedRunner({ pubkey: PUBKEY, publishImpl: rejected });
    const res = await service.publishMint(defaultArgs());
    expect(res.kind).toBe('submitted');
    if (res.kind === 'submitted') {
      expect(res.apiResponse.pushed).toBe(false);
      expect(res.apiResponse.status).toMatch(/ASSERT_ANNOUNCE/);
    }
  });

  it('computes the voting deadline from nowSeconds + window', async () => {
    const { service } = makeMockedRunner({ pubkey: PUBKEY });
    const res = await service.publishMint(
      defaultArgs({ nowSeconds: 2_000_000, votingWindowSeconds: 100 }),
    );
    if (res.kind === 'submitted') {
      expect(res.votingDeadline).toBe(BigInt(2_000_100));
    } else {
      fail(`expected submitted, got ${res.kind}`);
    }
  });

});
