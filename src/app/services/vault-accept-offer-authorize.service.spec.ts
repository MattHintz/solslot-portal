import { TestBed } from '@angular/core/testing';

import { ACCEPT_OFFER_PROTOCOL_VECTOR } from './accept-offer-vector.fixture';
import { ChiaWalletService } from './chia-wallet.service';
import { OfferDetail } from './offer-domain';
import { ZkPassportAcceptOfferProofService } from './zkpassport-accept-offer-proof.service';
import {
  ChainVaultAcceptOfferBuildRequest,
  VaultAcceptOfferSpendPackage,
  VaultAcceptOfferSpendService,
} from './vault-accept-offer-spend.service';
import {
  VaultAcceptOfferAuthorizationArgs,
  VaultAcceptOfferAuthorizeService,
} from './vault-accept-offer-authorize.service';

const vector = ACCEPT_OFFER_PROTOCOL_VECTOR.inputs;
const OWNER_SIG = '0x' + 'cc'.repeat(96);
const PACKAGE_VAULT_COIN_ID = '0x7e193f5ac51a93ef7bb89ef48e01bfed3ea9d11744b042fe7e2aa46555a68ad1';
const VAULT_FULL_PUZZLE_HASH = '0x6ee104b3af5f13601cdf0381136a18b491d9b3d8202891d8992c59a4a61897e0';
const proofParams = {
  identityAttestRoot: vector.identityAttestRoot,
  attestationLeafHash: vector.attestationLeafHash,
  attestationProof: vector.attestationProof,
};

describe('VaultAcceptOfferAuthorizeService', () => {
  let service: VaultAcceptOfferAuthorizeService;
  let spendBuilder: jasmine.SpyObj<VaultAcceptOfferSpendService>;
  let proofService: jasmine.SpyObj<ZkPassportAcceptOfferProofService>;
  let chiaWallet: jasmine.SpyObj<ChiaWalletService>;

  beforeEach(() => {
    spendBuilder = jasmine.createSpyObj<VaultAcceptOfferSpendService>(
      'VaultAcceptOfferSpendService',
      ['buildFromChain'],
    );
    proofService = jasmine.createSpyObj<ZkPassportAcceptOfferProofService>(
      'ZkPassportAcceptOfferProofService',
      ['refreshAndRequireProofParams'],
    );
    chiaWallet = jasmine.createSpyObj<ChiaWalletService>('ChiaWalletService', ['signSpendBundle']);
    chiaWallet.signSpendBundle.and.resolveTo({
      coinSpends: [basePackage().coinSpends[0]],
      aggregatedSignature: OWNER_SIG,
    });

    TestBed.configureTestingModule({
      providers: [
        VaultAcceptOfferAuthorizeService,
        { provide: VaultAcceptOfferSpendService, useValue: spendBuilder },
        { provide: ZkPassportAcceptOfferProofService, useValue: proofService },
        { provide: ChiaWalletService, useValue: chiaWallet },
      ],
    });
    service = TestBed.inject(VaultAcceptOfferAuthorizeService);
  });

  it('asks the Chia wallet to sign only the vault spend for an unsigned BLS accept-offer package', async () => {
    const packageState = basePackage();

    const result = await service.authorizePackage(packageState);

    expect(chiaWallet.signSpendBundle).toHaveBeenCalledOnceWith([packageState.coinSpends[0]]);
    expect(result.packageState).toBe(packageState);
    expect(result.signedSpendBundle.coinSpends).toEqual(packageState.coinSpends);
    expect(result.signedSpendBundle.aggregatedSignature).toBe(OWNER_SIG);
  });

  it('injects stored proof params before building and signing from chain', async () => {
    const authorizedInput: ChainVaultAcceptOfferBuildRequest = {
      ...baseAuthorizationArgs(),
      ...proofParams,
      currentTimestamp: vector.currentTimestamp,
      signatureData: null,
    };
    proofService.refreshAndRequireProofParams.and.resolveTo(proofParams);
    spendBuilder.buildFromChain.and.resolveTo(basePackage());

    const result = await service.authorizeFromChain(baseAuthorizationArgs());

    expect(proofService.refreshAndRequireProofParams).toHaveBeenCalledOnceWith(
      vector.vaultLauncherId,
      PACKAGE_VAULT_COIN_ID,
    );
    expect(spendBuilder.buildFromChain).toHaveBeenCalledOnceWith(authorizedInput);
    expect(result.signedSpendBundle.aggregatedSignature).toBe(OWNER_SIG);
  });

  it('rejects non-BLS authorization before building or signing', async () => {
    await expectAsync(service.authorizeFromChain({
      ...baseAuthorizationArgs(),
      authType: 2,
    })).toBeRejectedWithError(/BLS-only/);

    expect(proofService.refreshAndRequireProofParams).not.toHaveBeenCalled();
    expect(spendBuilder.buildFromChain).not.toHaveBeenCalled();
    expect(chiaWallet.signSpendBundle).not.toHaveBeenCalled();
  });

  it('rejects malformed packages before wallet signing', async () => {
    await expectAsync(service.authorizePackage({
      ...basePackage(),
      spendCase: '0x7a' as '0x61',
    })).toBeRejectedWithError(/unsupported spend case/);

    await expectAsync(service.authorizePackage({
      ...basePackage(),
      coinSpends: [],
      unsignedSpendBundle: { coinSpends: [], aggregatedSignature: null },
    })).toBeRejectedWithError(/vault coin spend/);

    expect(chiaWallet.signSpendBundle).not.toHaveBeenCalled();
  });

  it('rejects malformed BLS signatures when finalizing', () => {
    expect(() => service.finalizeSpendBundle(basePackage(), '0x' + 'aa'.repeat(95))).toThrowError(/96 bytes/);
  });
});

function basePackage(): VaultAcceptOfferSpendPackage {
  return {
    status: 'unsigned',
    backendSigning: false,
    spendCase: '0x61',
    authType: vector.authType,
    vaultLauncherId: vector.vaultLauncherId,
    offerId: 'offer-vector',
    offerArtifactId: 'artifact-vector',
    deedLauncherId: vector.deedLauncherId,
    tokenAmount: vector.tokenAmount,
    poolInnerPuzzleHash: vector.poolInnerPuzzleHash,
    identityAttestRoot: vector.identityAttestRoot,
    attestationLeafHash: vector.attestationLeafHash,
    attestationProof: vector.attestationProof,
    vaultCoin: {
      parentCoinInfo: vector.vaultLauncherId,
      puzzleHash: VAULT_FULL_PUZZLE_HASH,
      amount: vector.vaultAmount,
      coinId: PACKAGE_VAULT_COIN_ID,
    },
    vaultInnerPuzzleHash: vector.vaultInnerPuzzleHash,
    vaultFullPuzzleHash: VAULT_FULL_PUZZLE_HASH,
    expectedNextVaultCoin: {
      parentCoinInfo: PACKAGE_VAULT_COIN_ID,
      puzzleHash: VAULT_FULL_PUZZLE_HASH,
      amount: vector.vaultAmount,
      coinId: '0x' + '12'.repeat(32),
    },
    lineageProof: {
      parentParentCoinInfo: '0x' + '22'.repeat(32),
      parentInnerPuzzleHash: null,
      parentAmount: 1,
    },
    acceptOfferInnerSolution: ACCEPT_OFFER_PROTOCOL_VECTOR.expected.serializedSolution,
    acceptOfferInnerSolutionTreeHash: ACCEPT_OFFER_PROTOCOL_VECTOR.expected.solutionTreeHash,
    vaultSignatureData: '0x',
    coinSpends: [
      {
        coin: {
          parentCoinInfo: vector.vaultLauncherId,
          puzzleHash: VAULT_FULL_PUZZLE_HASH,
          amount: vector.vaultAmount,
        },
        puzzleReveal: '0xff02ff80',
        solution: '0xff8180',
      },
    ],
    unsignedSpendBundle: {
      coinSpends: [],
      aggregatedSignature: null,
    },
  };
}

function baseAuthorizationArgs(): VaultAcceptOfferAuthorizationArgs {
  return {
    vaultLauncherId: vector.vaultLauncherId,
    vaultCoinId: PACKAGE_VAULT_COIN_ID,
    ownerPubkey: vector.ownerPubkey,
    authType: vector.authType,
    membersMerkleRoot: vector.membersMerkleRoot,
    poolLauncherId: vector.poolLauncherId,
    bridgePolicyHash: '0x' + '00'.repeat(32),
    offer: offer(),
    poolInnerPuzzleHash: vector.poolInnerPuzzleHash,
    currentTimestamp: vector.currentTimestamp,
  };
}

function offer(overrides: Partial<OfferDetail> = {}): OfferDetail {
  return {
    id: 'offer-vector',
    title: 'Vector offer',
    deedLauncherId: vector.deedLauncherId,
    state: 'OP:OFFER_READY',
    terms: {
      deedLauncherId: vector.deedLauncherId,
      tokenAmount: vector.tokenAmount,
      priceMojos: 1,
      acceptedAsset: 'xch',
      expiresAt: null,
    },
    artifact: {
      artifactId: 'artifact-vector',
      deedLauncherId: vector.deedLauncherId,
      artifactHash: null,
      rawOffer: null,
    },
    gatingPolicy: {
      requiresZkPassport: true,
    },
    ...overrides,
  };
}
