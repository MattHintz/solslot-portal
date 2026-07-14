import { TestBed } from '@angular/core/testing';

import { SolslotApiService, type ZkPassportEnrollmentRecord } from './solslot-api.service';
import { VaultCredentialReceiptService } from './vault-credential-receipt.service';

const VAULT = '0x' + '11'.repeat(32);
const ROOT = '0x' + '22'.repeat(32);
const LEAF = '0x' + '33'.repeat(32);
const POLICY = '0x' + '44'.repeat(32);
const PARENT = '0x' + '55'.repeat(32);
const BRIDGE_COIN = '0x' + '66'.repeat(32);
const TX = '0x' + '77'.repeat(32);
const CURRENT_COIN = '0x' + '88'.repeat(32);

describe('VaultCredentialReceiptService', () => {
  let service: VaultCredentialReceiptService;
  let api: jasmine.SpyObj<SolslotApiService>;

  beforeEach(() => {
    localStorage.clear();
    api = jasmine.createSpyObj<SolslotApiService>('SolslotApiService', [
      'getZkPassportEnrollment',
    ]);
    TestBed.configureTestingModule({
      providers: [{ provide: SolslotApiService, useValue: api }],
    });
    service = TestBed.inject(VaultCredentialReceiptService);
  });

  afterEach(() => localStorage.clear());

  it('deletes the retired local proof cache and never promotes it', () => {
    localStorage.setItem('SOLSLOT_ZKPASSPORT_PROOFS_V2', JSON.stringify(record()));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: SolslotApiService, useValue: api }],
    });
    service = TestBed.inject(VaultCredentialReceiptService);

    expect(localStorage.getItem('SOLSLOT_ZKPASSPORT_PROOFS_V2')).toBeNull();
    expect(service.confirmedReceipt(VAULT, CURRENT_COIN)).toBeNull();
  });

  it('accepts only a freshly fetched chia_confirmed receipt for the live coin', async () => {
    api.getZkPassportEnrollment.and.resolveTo(record());

    await service.refresh(VAULT);

    expect(service.confirmedReceipt(VAULT, CURRENT_COIN)?.identityAttestRoot).toBe(ROOT);
  });

  it('clears authority when the API has no indexed enrollment', async () => {
    api.getZkPassportEnrollment.and.resolveTo(record());
    await service.refresh(VAULT);
    expect(service.confirmedReceipt(VAULT, CURRENT_COIN)).not.toBeNull();

    api.getZkPassportEnrollment.and.resolveTo(null);
    await service.refresh(VAULT);

    expect(service.confirmedReceipt(VAULT, CURRENT_COIN)).toBeNull();
  });

  it('rejects a receipt whose stamped coin is not the current Chia vault coin', async () => {
    api.getZkPassportEnrollment.and.resolveTo(record());
    await service.refresh(VAULT);

    expect(service.confirmedReceipt(VAULT, '0x' + '99'.repeat(32))).toBeNull();
  });

  it('rejects pending, empty-root, and retired-policy receipts', async () => {
    api.getZkPassportEnrollment.and.resolveTo(record({ status: 'stamp_pending' }));
    await service.refresh(VAULT);
    expect(service.confirmedReceipt(VAULT, CURRENT_COIN)).toBeNull();

    api.getZkPassportEnrollment.and.resolveTo(record({}, {
      identityAttestRoot: '0x4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a',
    }));
    await service.refresh(VAULT);
    expect(service.confirmedReceipt(VAULT, CURRENT_COIN)).toBeNull();

    api.getZkPassportEnrollment.and.resolveTo(record({ policyVersion: 1 }));
    await expectAsync(service.refresh(VAULT)).toBeRejectedWithError(/retired policy/);
    expect(service.confirmedReceipt(VAULT, CURRENT_COIN)).toBeNull();
  });
});

function record(
  overrides: Partial<ZkPassportEnrollmentRecord> = {},
  receiptOverrides: Partial<NonNullable<ZkPassportEnrollmentRecord['receipt']>> = {},
): ZkPassportEnrollmentRecord {
  return {
    vaultLauncherId: VAULT,
    network: 'testnet11',
    policyVersion: 2,
    status: 'chia_confirmed',
    bridgePolicyHash: POLICY,
    bridgeParentId: PARENT,
    bridgeAmount: 1,
    bridgeCoinId: BRIDGE_COIN,
    createdAt: 1,
    updatedAt: 2,
    receipt: {
      vaultLauncherId: VAULT,
      network: 'testnet11',
      policyVersion: 2,
      identityAttestRoot: ROOT,
      attestationLeafHash: LEAF,
      attestationProof: { bitpath: 0, siblings: [] },
      bridgePolicyHash: POLICY,
      bridgeParentId: PARENT,
      bridgeAmount: 1,
      bridgeCoinId: BRIDGE_COIN,
      evmTxHash: TX,
      chiaVaultCoinId: CURRENT_COIN,
      confirmedBlockIndex: 123,
      enrolledAt: 1,
      ...receiptOverrides,
    },
    ...overrides,
  };
}
