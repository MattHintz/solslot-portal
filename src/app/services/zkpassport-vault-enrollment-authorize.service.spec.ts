import { TestBed } from '@angular/core/testing';

import { AUTH_TYPE_BLS, AUTH_TYPE_SECP256K1, AUTH_TYPE_SECP256R1 } from '../utils/chia-hash';
import { ChiaWalletService } from './chia-wallet.service';
import { ChiaWasmService } from './chia-wasm.service';
import { EvmWalletService } from './evm-wallet.service';
import { ZkPassportVaultEnrollmentSpendPackage, ZkPassportVaultEnrollmentSpendService } from './zkpassport-vault-enrollment-spend.service';
import {
  buildVaultEnrollmentTypedData,
  compactSignatureFromEvm,
  ZkPassportVaultEnrollmentAuthorizeService,
} from './zkpassport-vault-enrollment-authorize.service';

const VAULT_COIN_ID = '0x' + '11'.repeat(32);
const OWNER_PUBKEY = '0x02' + '22'.repeat(32);
const VALIDATOR_SIG_A = '0x' + 'aa'.repeat(96);
const VALIDATOR_SIG_B = '0x' + 'bb'.repeat(96);
const OWNER_SIG = '0x' + 'cc'.repeat(96);

class MockSignature {
  constructor(private readonly bytes: Uint8Array) {}

  static fromBytes(bytes: Uint8Array): MockSignature {
    return new MockSignature(bytes);
  }

  static aggregate(signatures: MockSignature[]): MockSignature {
    const out = new Uint8Array(96);
    out[0] = signatures.length;
    for (let i = 0; i < signatures.length; i++) {
      out[i + 1] = signatures[i].bytes[0];
    }
    return new MockSignature(out);
  }

  toBytes(): Uint8Array {
    return this.bytes;
  }

  free(): void {}
}

describe('ZkPassportVaultEnrollmentAuthorizeService', () => {
  let service: ZkPassportVaultEnrollmentAuthorizeService;
  let spendBuilder: jasmine.SpyObj<ZkPassportVaultEnrollmentSpendService>;
  let chiaWallet: jasmine.SpyObj<ChiaWalletService>;
  let evm: jasmine.SpyObj<EvmWalletService>;

  beforeEach(() => {
    spendBuilder = jasmine.createSpyObj<ZkPassportVaultEnrollmentSpendService>(
      'ZkPassportVaultEnrollmentSpendService',
      ['buildFromChain'],
    );
    chiaWallet = jasmine.createSpyObj<ChiaWalletService>('ChiaWalletService', ['signSpendBundle']);
    evm = jasmine.createSpyObj<EvmWalletService>('EvmWalletService', ['signTypedData', 'recoverCompressedPubkey']);
    chiaWallet.signSpendBundle.and.resolveTo({
      coinSpends: [basePackage().coinSpends[1]],
      aggregatedSignature: OWNER_SIG,
    });

    TestBed.configureTestingModule({
      providers: [
        ZkPassportVaultEnrollmentAuthorizeService,
        { provide: ZkPassportVaultEnrollmentSpendService, useValue: spendBuilder },
        { provide: ChiaWalletService, useValue: chiaWallet },
        { provide: EvmWalletService, useValue: evm },
        { provide: ChiaWasmService, useValue: { sdk: () => ({ Signature: MockSignature }) } },
      ],
    });
    service = TestBed.inject(ZkPassportVaultEnrollmentAuthorizeService);
  });

  it('finalizes a spend bundle by aggregating validator and owner BLS signatures', () => {
    const fullBundle = service.finalizeSpendBundle(basePackage(), OWNER_SIG);
    expect(fullBundle.coinSpends.length).toBe(2);
    expect(fullBundle.aggregatedSignature).toBe(`0x03aabbcc${'00'.repeat(92)}`);
  });

  it('asks the Chia wallet to sign only the vault spend for a BLS vault package', async () => {
    const packageState = basePackage();
    const result = await service.authorizeBlsPackage(packageState);
    expect(chiaWallet.signSpendBundle).toHaveBeenCalledOnceWith([packageState.coinSpends[1]]);
    expect(result.signedSpendBundle.aggregatedSignature).toBe(`0x03aabbcc${'00'.repeat(92)}`);
  });

  it('signs EVM typed data and rebuilds with compact signature data without Chia wallet signing', async () => {
    const evmSignature = `0x${'01'.repeat(32)}${'02'.repeat(32)}1b`;
    const secpPackage = basePackage(AUTH_TYPE_SECP256K1, compactSignatureFromEvm(evmSignature));
    spendBuilder.buildFromChain.and.resolveTo(secpPackage);
    evm.signTypedData.and.resolveTo(evmSignature);
    evm.recoverCompressedPubkey.and.returnValue(OWNER_PUBKEY);

    const result = await service.authorizeFromChain(baseAuthorizationArgs(AUTH_TYPE_SECP256K1));

    expect(evm.signTypedData).toHaveBeenCalledWith(buildVaultEnrollmentTypedData(baseAuthorizationArgs().newIdentityAttestRoot, VAULT_COIN_ID));
    expect(spendBuilder.buildFromChain).toHaveBeenCalledWith(jasmine.objectContaining({
      authType: AUTH_TYPE_SECP256K1,
      signatureData: compactSignatureFromEvm(evmSignature),
    }));
    expect(chiaWallet.signSpendBundle).not.toHaveBeenCalled();
    expect(result.signedSpendBundle.aggregatedSignature).toBe(`0x02aabb${'00'.repeat(93)}`);
  });

  it('rejects passkey authorization until passkey assertion capture is wired', async () => {
    await expectAsync(service.authorizeFromChain(baseAuthorizationArgs(AUTH_TYPE_SECP256R1))).toBeRejectedWithError(/passkey/);
  });

  it('normalizes high-s EVM signatures to compact low-s form', () => {
    const highS = 'ff'.repeat(32);
    const compact = compactSignatureFromEvm(`0x${'11'.repeat(32)}${highS}1b`);
    expect(compact).toMatch(/^0x[0-9a-f]{128}$/);
    expect(compact.slice(2, 66)).toBe('11'.repeat(32));
    expect(compact.slice(66)).not.toBe(highS);
  });
});

function basePackage(authType = AUTH_TYPE_BLS, vaultSignatureData = '0x'): ZkPassportVaultEnrollmentSpendPackage {
  return {
    status: 'unsigned',
    backendSigning: false,
    spendCase: '0x7a',
    authType,
    vaultLauncherId: '0x' + '33'.repeat(32),
    vaultCoin: {
      parentCoinInfo: '0x' + '44'.repeat(32),
      puzzleHash: '0x' + '55'.repeat(32),
      amount: 1,
      coinId: VAULT_COIN_ID,
    },
    bridgeCoin: {
      parentCoinInfo: '0x' + '66'.repeat(32),
      puzzleHash: '0x' + '77'.repeat(32),
      amount: 1,
      coinId: '0x' + '88'.repeat(32),
    },
    bridgePolicyHash: '0x' + '77'.repeat(32),
    vaultInnerPuzzleHash: '0x' + '99'.repeat(32),
    vaultFullPuzzleHash: '0x' + '55'.repeat(32),
    lineageProof: {
      parentParentCoinInfo: '0x' + '44'.repeat(32),
      parentInnerPuzzleHash: null,
      parentAmount: 1,
    },
    signerIndices: [0, 1],
    validatorSignatures: [
      { validatorPubkey: '0x' + '01'.repeat(48), signature: VALIDATOR_SIG_A },
      { validatorPubkey: '0x' + '02'.repeat(48), signature: VALIDATOR_SIG_B },
    ],
    vaultSignatureData,
    coinSpends: [
      {
        coin: { parentCoinInfo: '0x' + '66'.repeat(32), puzzleHash: '0x' + '77'.repeat(32), amount: 1 },
        puzzleReveal: '0xff01ff80',
        solution: '0xff8080',
      },
      {
        coin: { parentCoinInfo: '0x' + '44'.repeat(32), puzzleHash: '0x' + '55'.repeat(32), amount: 1 },
        puzzleReveal: '0xff02ff80',
        solution: '0xff8180',
      },
    ],
    unsignedSpendBundle: { coinSpends: [], aggregatedSignature: null },
  };
}

function baseAuthorizationArgs(authType = AUTH_TYPE_BLS) {
  return {
    vaultLauncherId: '0x' + '33'.repeat(32),
    vaultCoinId: VAULT_COIN_ID,
    ownerPubkey: OWNER_PUBKEY,
    authType,
    bridgePolicyHash: '0x' + '77'.repeat(32),
    bridgeParentId: '0x' + '66'.repeat(32),
    bridgeAmount: 1,
    newIdentityAttestRoot: '0x' + 'aa'.repeat(32),
    attestationLeafHash: '0x' + 'aa'.repeat(32),
    scopedNullifier: '0x' + 'bb'.repeat(32),
    nullifierType: 1,
    serviceScopeHash: '0x' + 'cc'.repeat(32),
    serviceSubscopeHash: '0x' + 'dd'.repeat(32),
    proofTimestamp: 1,
    signerIndices: [0, 1],
    validatorSignatures: [
      { validatorPubkey: '0x' + '01'.repeat(48), signature: VALIDATOR_SIG_A },
      { validatorPubkey: '0x' + '02'.repeat(48), signature: VALIDATOR_SIG_B },
    ],
    currentTimestamp: 2,
  };
}
