import { TestBed } from '@angular/core/testing';

import { ACCEPT_OFFER_PROTOCOL_VECTOR } from './accept-offer-vector.fixture';
import { MemberOfferContext, OfferDetail } from './offer-domain';
import {
  VaultAcceptOfferAuthorizationArgs,
  VaultAcceptOfferAuthorizationResult,
  VaultAcceptOfferAuthorizeService,
} from './vault-accept-offer-authorize.service';
import {
  VaultAcceptOfferCommitResult,
  VaultAcceptOfferCommitService,
} from './vault-accept-offer-commit.service';
import { VaultAcceptOfferSpendPackage } from './vault-accept-offer-spend.service';
import {
  AuthorizeEligibleAcceptOfferArgs,
  OfferNotEligibleError,
  VaultAcceptOfferLifecycleService,
} from './vault-accept-offer-lifecycle.service';

const vector = ACCEPT_OFFER_PROTOCOL_VECTOR.inputs;
const PACKAGE_VAULT_COIN_ID = '0x' + '0a'.repeat(32);
const VAULT_FULL_PUZZLE_HASH = '0x' + '0b'.repeat(32);
const NEXT_VAULT_COIN_ID = '0x' + '0c'.repeat(32);

describe('VaultAcceptOfferLifecycleService', () => {
  let service: VaultAcceptOfferLifecycleService;
  let authorize: jasmine.SpyObj<VaultAcceptOfferAuthorizeService>;
  let commit: jasmine.SpyObj<VaultAcceptOfferCommitService>;

  beforeEach(() => {
    authorize = jasmine.createSpyObj<VaultAcceptOfferAuthorizeService>(
      'VaultAcceptOfferAuthorizeService',
      ['authorizeFromChain'],
    );
    commit = jasmine.createSpyObj<VaultAcceptOfferCommitService>(
      'VaultAcceptOfferCommitService',
      ['commitAuthorizedAcceptOffer'],
    );
    authorize.authorizeFromChain.and.resolveTo(authorizationResult());
    commit.commitAuthorizedAcceptOffer.and.resolveTo(commitResult());

    TestBed.configureTestingModule({
      providers: [
        VaultAcceptOfferLifecycleService,
        { provide: VaultAcceptOfferAuthorizeService, useValue: authorize },
        { provide: VaultAcceptOfferCommitService, useValue: commit },
      ],
    });
    service = TestBed.inject(VaultAcceptOfferLifecycleService);
  });

  it('authorizes an eligible offer and forwards context.currentTimestamp', async () => {
    const args = baseArgs();

    const result = await service.authorizeEligibleAcceptOffer(args);

    expect(authorize.authorizeFromChain).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        vaultLauncherId: vector.vaultLauncherId,
        currentTimestamp: vector.currentTimestamp,
      }),
    );
    expect(result.signedSpendBundle.aggregatedSignature).toMatch(/^0x[0-9a-f]{192}$/);
  });

  it('falls back to authorizationArgs.currentTimestamp when context omits it', async () => {
    const args = baseArgs({ omitContextTimestamp: true });

    await service.authorizeEligibleAcceptOffer(args);

    expect(authorize.authorizeFromChain).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        currentTimestamp: vector.currentTimestamp,
      }),
    );
  });

  it('rejects with OfferNotEligibleError when zkPassport is unconfirmed', async () => {
    const args = baseArgs({ context: { zkPassportProofConfirmed: false } });

    await expectAsync(service.authorizeEligibleAcceptOffer(args)).toBeRejectedWith(
      jasmine.any(OfferNotEligibleError),
    );
    expect(authorize.authorizeFromChain).not.toHaveBeenCalled();
  });

  it('rejects expired or unavailable offers before authorizing', async () => {
    const args = baseArgs({
      offerOverrides: { state: 'OP:OFFER_UNAVAILABLE' },
    });

    await expectAsync(service.authorizeEligibleAcceptOffer(args)).toBeRejectedWithError(
      /OFFER_UNAVAILABLE/,
    );
    expect(authorize.authorizeFromChain).not.toHaveBeenCalled();
  });

  it('rejects when the vault is not in the offer allowlist', async () => {
    const args = baseArgs({
      offerOverrides: {
        gatingPolicy: {
          requiresZkPassport: true,
          allowedVaultLauncherIds: ['0x' + 'ff'.repeat(32)],
        },
      },
    });

    await expectAsync(service.authorizeEligibleAcceptOffer(args)).toBeRejectedWithError(
      /NOT_ELIGIBLE/,
    );
    expect(authorize.authorizeFromChain).not.toHaveBeenCalled();
  });

  it('delegates commit to the commit service with options forwarded', async () => {
    const auth = authorizationResult();
    const options = { timeoutMs: 1_000, delayMsOverride: 0 };

    const result = await service.commitAuthorizedAcceptOffer(auth, options);

    expect(commit.commitAuthorizedAcceptOffer).toHaveBeenCalledOnceWith(auth, options);
    expect(result.confirmedVaultCoinId).toBe(NEXT_VAULT_COIN_ID);
  });
});

function baseArgs(overrides: {
  context?: Partial<MemberOfferContext>;
  offerOverrides?: Partial<OfferDetail>;
  omitContextTimestamp?: boolean;
} = {}): AuthorizeEligibleAcceptOfferArgs {
  const offerDetail: OfferDetail = {
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
    gatingPolicy: { requiresZkPassport: true },
    ...overrides.offerOverrides,
  };
  const context: MemberOfferContext = {
    walletConnected: true,
    vaultLauncherId: vector.vaultLauncherId,
    vaultConfirmed: true,
    zkPassportProofConfirmed: true,
    chainStateFresh: true,
    currentTimestamp: overrides.omitContextTimestamp ? undefined : vector.currentTimestamp,
    ...overrides.context,
  };
  const authorizationArgs: VaultAcceptOfferAuthorizationArgs = {
    vaultLauncherId: vector.vaultLauncherId,
    vaultCoinId: PACKAGE_VAULT_COIN_ID,
    ownerPubkey: vector.ownerPubkey,
    authType: vector.authType,
    membersMerkleRoot: vector.membersMerkleRoot,
    poolLauncherId: vector.poolLauncherId,
    bridgePolicyHash: '0x' + '00'.repeat(32),
    offer: offerDetail,
    poolInnerPuzzleHash: vector.poolInnerPuzzleHash,
    currentTimestamp: vector.currentTimestamp,
  };
  return { offerDetail, context, authorizationArgs };
}

function authorizationResult(): VaultAcceptOfferAuthorizationResult {
  return {
    packageState: packageState(),
    signedSpendBundle: {
      coinSpends: [],
      aggregatedSignature: '0x' + 'ee'.repeat(96),
    },
  };
}

function commitResult(): VaultAcceptOfferCommitResult {
  return {
    ...authorizationResult(),
    pushResponse: { success: true, status: 'SUCCESS' },
    confirmedVaultCoinId: NEXT_VAULT_COIN_ID,
    confirmedBlockIndex: 12,
  };
}

function packageState(): VaultAcceptOfferSpendPackage {
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
      coinId: NEXT_VAULT_COIN_ID,
    },
    lineageProof: {
      parentParentCoinInfo: '0x' + '22'.repeat(32),
      parentInnerPuzzleHash: null,
      parentAmount: 1,
    },
    acceptOfferInnerSolution: '0xff80',
    acceptOfferInnerSolutionTreeHash: '0x' + '0b'.repeat(32),
    vaultSignatureData: '0x',
    coinSpends: [],
    unsignedSpendBundle: { coinSpends: [], aggregatedSignature: null },
  };
}
