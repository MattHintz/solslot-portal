import { AdminSessionService } from '../../../services/admin-session.service';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EvmWalletService } from '../../../services/evm-wallet.service';
import {
  OmnichainOwnershipActivationService,
  OwnershipActivationStatus,
} from '../../../services/omnichain-ownership-activation.service';
import { OmnichainOwnershipActivationComponent } from './omnichain-ownership-activation.component';

describe('OmnichainOwnershipActivationComponent', () => {
  const ownerAddress = '0x0E61D3Bb1148bDd802F747CaEa112333d156626a';
  const status: OwnershipActivationStatus = {
    schemaVersion: 2,
    state: 'AWAITING_APPROVALS',
    packageHash: `0x${'11'.repeat(32)}`,
    sourceSha: '22'.repeat(20),
    network: 'baseSepolia',
    chainId: 84532,
    phase: 'schedule',
    operationId: `0x${'33'.repeat(32)}`,
    rootSafe: '0xb7e02C216A2B3aF0cC4Ad8808fA169f2F0B19724',
    timelock: '0x5eC98d5a9C24C2a80957AB04630812C36807aad3',
    rootSafeTransactionHash: `0x${'44'.repeat(32)}`,
    deploymentArtifactHash: `0x${'45'.repeat(32)}`,
    ownershipIntentArtifactHash: `0x${'46'.repeat(32)}`,
    governanceArtifactHash: `0x${'47'.repeat(32)}`,
    review: {
      action: 'acceptOwnership',
      targets: [
        '0x4A467fd9137D8aC807E3CD7E109AB4d56f9Dfa9e',
        '0xbbEEa9bd3E8a8becdef7FC21503C295b32C62d3f',
      ],
      delaySeconds: 86400,
      operationId: `0x${'33'.repeat(32)}`,
    },
    scheduledFor: null,
    approvals: [
      {
        role: 'owner_identity',
        safe: '0x73a282e829dF5b7E12824a53F54c2FB6f07D13a5',
        allowedSigners: [ownerAddress],
        messageHash: `0x${'48'.repeat(32)}`,
        typedData: {
          domain: {
            chainId: 84532,
            verifyingContract: '0x73a282e829dF5b7E12824a53F54c2FB6f07D13a5',
          },
          types: {
            SafeMessage: [{ name: 'message', type: 'bytes' }],
          },
          primaryType: 'SafeMessage',
          message: { message: `0x${'49'.repeat(66)}` },
        },
        signed: false,
        signerAddress: null,
        signedAt: null,
      },
      {
        role: 'coadmin',
        safe: '0x428700faA2b6Ebc613435994C84dB27908964A88',
        allowedSigners: ['0xA3F7E31dbb66696488F3919b58F14b50E77a5E50'],
        messageHash: `0x${'50'.repeat(32)}`,
        typedData: {
          domain: {
            chainId: 84532,
            verifyingContract: '0x428700faA2b6Ebc613435994C84dB27908964A88',
          },
          types: {
            SafeMessage: [{ name: 'message', type: 'bytes' }],
          },
          primaryType: 'SafeMessage',
          message: { message: `0x${'51'.repeat(66)}` },
        },
        signed: false,
        signerAddress: null,
        signedAt: null,
      },
    ],
    broadcastTransaction: null,
    broadcast: null,
    submission: null,
  };

  let fixture: ComponentFixture<OmnichainOwnershipActivationComponent>;
  let component: OmnichainOwnershipActivationComponent;
  let api: jasmine.SpyObj<OmnichainOwnershipActivationService>;
  const walletAddress = signal<string | null>(ownerAddress);
  const wallet = {
    address: walletAddress,
    isConnected: computed(() => walletAddress() !== null),
    connectInjected: jasmine.createSpy('connectInjected'),
    connectWalletConnect: jasmine.createSpy('connectWalletConnect'),
    signSafeMessage: jasmine.createSpy('signSafeMessage'),
    sendBaseSepoliaTransaction: jasmine.createSpy('sendBaseSepoliaTransaction'),
  };

  beforeEach(async () => {
    api = jasmine.createSpyObj<OmnichainOwnershipActivationService>(
      'OmnichainOwnershipActivationService',
      ['get', 'sign', 'recordBroadcast'],
    );
    api.get.and.resolveTo(status);
    api.sign.and.resolveTo(status);
    walletAddress.set(ownerAddress);
    wallet.signSafeMessage.calls.reset();
    wallet.signSafeMessage.and.resolveTo(`0x${'52'.repeat(65)}`);

    await TestBed.configureTestingModule({
      imports: [OmnichainOwnershipActivationComponent],
      providers: [
        provideRouter([]),
        { provide: AdminSessionService, useValue: { connectionNotice: () => '', logoutAndRedirect: jasmine.createSpy('logoutAndRedirect') } },
        { provide: OmnichainOwnershipActivationService, useValue: api },
        { provide: EvmWalletService, useValue: wallet },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OmnichainOwnershipActivationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows the full sealed targets and operation facts', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain(status.review.targets[0]);
    expect(text).toContain(status.review.targets[1]);
    expect(text).toContain(status.packageHash);
    expect(text).toContain('Accept ownership only');
    expect(text).toContain('0 ETH');
    expect(text).toContain('24 hours');
  });

  it('will not sign until this wallet acknowledges this exact package', async () => {
    const approval = status.approvals[0];

    await component.sign(approval);

    expect(wallet.signSafeMessage).not.toHaveBeenCalled();
    expect(api.sign).not.toHaveBeenCalled();
    expect(component.actionError()).toContain('Review and acknowledge');

    component.setReviewAcknowledged(true, status, approval);
    await component.sign(approval);

    expect(wallet.signSafeMessage).toHaveBeenCalledOnceWith(
      approval.typedData,
      approval.safe,
    );
    expect(api.sign).toHaveBeenCalledOnceWith(`0x${'52'.repeat(65)}`);
    expect(component.reviewAcknowledgementKey()).toBeNull();
  });

  it('invalidates the acknowledgment when the connected wallet changes', () => {
    const approval = status.approvals[0];
    component.setReviewAcknowledged(true, status, approval);
    expect(component.reviewAcknowledged(status, approval)).toBeTrue();

    walletAddress.set('0xA3F7E31dbb66696488F3919b58F14b50E77a5E50');

    expect(component.reviewAcknowledged(status, approval)).toBeFalse();
  });
});
