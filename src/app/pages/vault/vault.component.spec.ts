import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { SessionService } from '../../services/session.service';
import { VaultCredentialReceiptService } from '../../services/vault-credential-receipt.service';
import { VaultComponent } from './vault.component';

const LAUNCHER = `0x${'11'.repeat(32)}`;
const COIN = `0x${'22'.repeat(32)}`;

describe('VaultComponent credential authority', () => {
  let fixture: ComponentFixture<VaultComponent>;
  let receipts: jasmine.SpyObj<VaultCredentialReceiptService>;
  const vaultState = {
    vault_launcher_id: LAUNCHER,
    vault_full_puzhash: `0x${'33'.repeat(32)}`,
    p2_vault_puzhash: `0x${'44'.repeat(32)}`,
    auth_type: 'evm',
    owner_address: '0x0000000000000000000000000000000000000001',
    owner_pubkey: `0x02${'55'.repeat(32)}`,
    confirmed: true,
    confirmed_block_index: 100,
    current_coin_id: COIN,
    balance: { xch_mojos: 0, deeds: [] },
  };
  const session = {
    session: signal({
      schemaVersion: 2,
      protocolVersion: 'solslot-v2',
      experienceMode: 'testnet-alpha',
      network: 'testnet11',
      authType: 'evm',
      address: '0x0000000000000000000000000000000000000001',
      vaultLauncherId: LAUNCHER,
      createdAt: 1,
    }),
    vault: signal(vaultState),
    refreshVault: jasmine.createSpy().and.resolveTo(vaultState),
  };

  beforeEach(async () => {
    receipts = jasmine.createSpyObj<VaultCredentialReceiptService>(
      'VaultCredentialReceiptService',
      ['refresh', 'confirmedReceipt', 'clear'],
    );
    await TestBed.configureTestingModule({
      imports: [VaultComponent],
      providers: [
        { provide: SessionService, useValue: session },
        { provide: VaultCredentialReceiptService, useValue: receipts },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
      ],
    }).compileComponents();
  });

  it('shows confirmed only for a server receipt bound to the current coin', async () => {
    const receipt = {
      vaultLauncherId: LAUNCHER,
      network: 'testnet11',
      policyVersion: 2,
      identityAttestRoot: `0x${'66'.repeat(32)}`,
      attestationLeafHash: `0x${'66'.repeat(32)}`,
      attestationProof: { bitpath: 0, siblings: [] },
      bridgePolicyHash: `0x${'77'.repeat(32)}`,
      bridgeParentId: `0x${'88'.repeat(32)}`,
      bridgeAmount: 1,
      bridgeCoinId: `0x${'99'.repeat(32)}`,
      evmTxHash: `0x${'aa'.repeat(32)}`,
      chiaVaultCoinId: COIN,
      confirmedBlockIndex: 100,
      enrolledAt: 1,
    };
    receipts.refresh.and.resolveTo({
      vaultLauncherId: LAUNCHER,
      network: 'testnet11',
      policyVersion: 2,
      status: 'chia_confirmed',
      bridgePolicyHash: receipt.bridgePolicyHash,
      bridgeParentId: receipt.bridgeParentId,
      bridgeAmount: 1,
      bridgeCoinId: receipt.bridgeCoinId,
      createdAt: 1,
      updatedAt: 1,
      receipt,
    });
    receipts.confirmedReceipt.and.returnValue(receipt);

    fixture = TestBed.createComponent(VaultComponent);
    await settle();

    expect(fixture.componentInstance.credentialState()).toBe('confirmed');
    expect(receipts.confirmedReceipt).toHaveBeenCalledWith(LAUNCHER, COIN);
  });

  it('fails closed when the authoritative receipt endpoint is unavailable', async () => {
    receipts.refresh.and.rejectWith(new Error('404 receipt not found'));

    fixture = TestBed.createComponent(VaultComponent);
    await settle();

    expect(fixture.componentInstance.credentialState()).toBe('unavailable');
    expect(fixture.componentInstance.credentialReceipt()).toBeNull();
    expect(receipts.clear).toHaveBeenCalledWith(LAUNCHER);
  });
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
