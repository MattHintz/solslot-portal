import { TestBed } from '@angular/core/testing';

import { SessionService } from './session.service';
import { VaultCredentialReceiptService } from './vault-credential-receipt.service';
import {
  ZkPassportAcceptOfferProofService,
  ZkPassportEnrollmentRequiredError,
} from './zkpassport-accept-offer-proof.service';

const VAULT_LAUNCHER_ID = '0x' + '11'.repeat(32);
const CURRENT_COIN_ID = '0x' + '22'.repeat(32);

describe('ZkPassportAcceptOfferProofService', () => {
  let service: ZkPassportAcceptOfferProofService;
  let receipts: jasmine.SpyObj<VaultCredentialReceiptService>;

  beforeEach(() => {
    receipts = jasmine.createSpyObj<VaultCredentialReceiptService>(
      'VaultCredentialReceiptService',
      ['confirmedReceipt', 'refresh'],
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: VaultCredentialReceiptService, useValue: receipts },
        {
          provide: SessionService,
          useValue: {
            vault: () => ({
              vault_launcher_id: VAULT_LAUNCHER_ID,
              current_coin_id: CURRENT_COIN_ID,
            }),
          },
        },
      ],
    });
    service = TestBed.inject(ZkPassportAcceptOfferProofService);
  });

  it('injects only a server-confirmed receipt bound to the live vault coin', () => {
    receipts.confirmedReceipt.and.returnValue(receipt());

    const built = service.withProofParams(VAULT_LAUNCHER_ID, {
      deedLauncherId: '0x' + '77'.repeat(32),
      tokenAmount: 100,
    });

    expect(receipts.confirmedReceipt).toHaveBeenCalledOnceWith(
      VAULT_LAUNCHER_ID,
      CURRENT_COIN_ID,
    );
    expect(built).toEqual(jasmine.objectContaining({
      identityAttestRoot: '0x' + '33'.repeat(32),
      attestationLeafHash: '0x' + '44'.repeat(32),
      attestationProof: { bitpath: 1, siblings: ['0x' + '55'.repeat(32)] },
    }));
  });

  it('refreshes from the server before returning authoritative proof parameters', async () => {
    receipts.refresh.and.resolveTo({} as never);
    receipts.confirmedReceipt.and.returnValue(receipt());

    const proof = await service.refreshAndRequireProofParams(
      VAULT_LAUNCHER_ID,
      CURRENT_COIN_ID,
    );

    expect(receipts.refresh).toHaveBeenCalledOnceWith(VAULT_LAUNCHER_ID);
    expect(proof.identityAttestRoot).toBe('0x' + '33'.repeat(32));
  });

  it('blocks offer building when the API/current-coin gate has no confirmed receipt', () => {
    receipts.confirmedReceipt.and.returnValue(null);
    const builder = jasmine.createSpy('acceptOfferBuilder');

    expect(() =>
      service.buildWithProof(
        VAULT_LAUNCHER_ID,
        { deedLauncherId: '0x' + '77'.repeat(32) },
        builder,
      ),
    ).toThrowError(ZkPassportEnrollmentRequiredError, /enrollment is required/);
    expect(builder).not.toHaveBeenCalled();
  });
});

function receipt() {
  return {
    vaultLauncherId: VAULT_LAUNCHER_ID,
    network: 'testnet11',
    policyVersion: 2,
    identityAttestRoot: '0x' + '33'.repeat(32),
    attestationLeafHash: '0x' + '44'.repeat(32),
    attestationProof: { bitpath: 1, siblings: ['0x' + '55'.repeat(32)] },
    bridgePolicyHash: '0x' + '66'.repeat(32),
    bridgeParentId: '0x' + '77'.repeat(32),
    bridgeAmount: 1,
    bridgeCoinId: '0x' + '88'.repeat(32),
    evmTxHash: '0x' + '99'.repeat(32),
    chiaVaultCoinId: CURRENT_COIN_ID,
    confirmedBlockIndex: 123,
    enrolledAt: 1,
  };
}
