import { MAINNET_RECOVERY_DRILL } from './recovery-drill-mainnet.fixture';
import { TestBed } from '@angular/core/testing';
import { getBytes } from 'ethers';

import { AdminRecoveryKitService } from './admin-recovery-kit.service';
import { ChiaWasmService } from './chia-wasm.service';
import { RECOVERY_DRILL_API_FIXTURES, RECOVERY_LOST_API_FIXTURE } from './recovery-drill-api.fixture';

describe('AdminRecoveryKitService signing boundaries', () => {
  let service: AdminRecoveryKitService;
  let blsSign: jasmine.Spy;
  let guardianSign: jasmine.Spy;
  let signedMessages: Uint8Array[];
  const mnemonic = 'abandon '.repeat(23) + 'art';
  const publicKey = String(RECOVERY_DRILL_API_FIXTURES[0].payload['recoveryBlsPubkey']);

  beforeEach(() => {
    signedMessages = [];
    const signature = () => ({ free() {}, toBytes: () => new Uint8Array(96) });
    blsSign = jasmine.createSpy('BLS signing').and.callFake((message: Uint8Array) => {
      signedMessages.push(new Uint8Array(message));
      return signature();
    });
    const child = { free() {}, publicKey: () => ({ free() {}, toBytes: () => getBytes(publicKey) }), sign: blsSign };
    const sdk = {
      SecretKey: { fromSeed: () => ({ free() {}, deriveUnhardenedPath: () => child }) },
      Signature: { aggregate: signature },
    };
    TestBed.configureTestingModule({ providers: [{ provide: ChiaWasmService, useValue: { sdk: () => sdk } }] });
    service = TestBed.inject(AdminRecoveryKitService);
    service.unlock(mnemonic);
    guardianSign = spyOn((service as any).evmGuardian, 'signTypedData').and.resolveTo('0x' + '12'.repeat(65));
  });

  afterEach(() => service.clear());

  for (const fixture of [...RECOVERY_DRILL_API_FIXTURES, MAINNET_RECOVERY_DRILL]) {
    it(`signs the API-derived restore drill for slot ${fixture.payload['slot']} and revision ${fixture.payload['revision']}`, async () => {
      const challenge = structuredClone(fixture.challenge);
      await service.signDrill(challenge);
      expect(signedMessages).toEqual([getBytes(challenge.blsSigningDigest)]);
      expect(guardianSign).toHaveBeenCalledTimes(1);
    });
  }

  for (const mutation of ['chain', 'version', 'digest']) {
    it(`rejects mainnet recovery ${mutation} drift before signing`, async () => {
      const challenge = structuredClone(MAINNET_RECOVERY_DRILL.challenge);
      if (mutation === 'chain') challenge.evmTypedData.domain.chainId = 84532;
      if (mutation === 'version') challenge.evmTypedData.domain.version = '1';
      if (mutation === 'digest') challenge.blsSigningDigest = RECOVERY_DRILL_API_FIXTURES[0].challenge.blsSigningDigest;
      await expectAsync(service.signDrill(challenge)).toBeRejected();
      expect(blsSign).not.toHaveBeenCalled();
      expect(guardianSign).not.toHaveBeenCalled();
    });
  }

  for (const field of ['blsSigningDigest', 'challengeHash'] as const) {
    it(`rejects a replaced ${field} before either key signs`, async () => {
      const challenge = structuredClone(RECOVERY_DRILL_API_FIXTURES[0].challenge);
      challenge[field] = '0x' + '99'.repeat(32);
      await expectAsync(service.signDrill(challenge)).toBeRejected();
      expect(blsSign).not.toHaveBeenCalled();
      expect(guardianSign).not.toHaveBeenCalled();
    });
  }

  it('rejects message-only Chia recovery actions before signing', () => {
    const action = { signerKind: 'BLS_RECOVERY', blsPairs: [{ publicKey, message: '0x' + '55'.repeat(32) }] } as any;
    expect(() => service.signBlsAction(action)).toThrowError(/Chia recovery signing is unavailable/);
    expect(blsSign).not.toHaveBeenCalled();
    expect(guardianSign).not.toHaveBeenCalled();
  });

  function lostArguments() {
    const prepared = structuredClone(RECOVERY_LOST_API_FIXTURE);
    return { ...prepared, guardianTypedData: prepared.guardianTypedData!, recoveryBlsDigest: prepared.recoveryBlsDigest! };
  }

  it('preserves the API-derived standalone LOST authorization', async () => {
    const args = lostArguments();
    await service.signLostKeyAuthorization(args);
    expect(signedMessages).toEqual([getBytes(args.recoveryBlsDigest)]);
    expect(guardianSign).toHaveBeenCalledTimes(1);
  });

  for (const field of ['recoveryBlsDigest', 'intentHash'] as const) {
    it(`rejects a directly substituted LOST ${field} before either signature`, async () => {
      const args = lostArguments();
      args[field] = '0x' + '99'.repeat(32);
      await expectAsync(service.signLostKeyAuthorization(args)).toBeRejected();
      expect(blsSign).not.toHaveBeenCalled();
      expect(guardianSign).not.toHaveBeenCalled();
    });
  }

  it('signs its local LOST snapshot after caller mutation during guardian signing', async () => {
    const args = lostArguments();
    const expectedDigest = getBytes(args.recoveryBlsDigest);
    guardianSign.and.callFake(async () => {
      args.recoveryBlsDigest = '0x' + '99'.repeat(32);
      args.intent.newDailyEvmKey = args.intent.oldDailyEvmKey;
      return '0x' + '12'.repeat(65);
    });
    await service.signLostKeyAuthorization(args);
    expect(signedMessages).toEqual([expectedDigest]);
  });

  for (const mutate of [
    (value: any) => value.evmTypedData.message.slot = 3,
    (value: any) => value.evmTypedData.message.slot = '0',
    (value: any) => value.evmTypedData.message.expiresAt = value.expiresAt + 1,
    (value: any) => value.evmTypedData.message.nonce = '0xgg',
    (value: any) => value.evmTypedData.message.extra = 'unreviewed',
  ]) {
    it('rejects alternate malformed drill fields before key use', async () => {
      const challenge = structuredClone(RECOVERY_DRILL_API_FIXTURES[0].challenge);
      mutate(challenge);
      await expectAsync(service.signDrill(challenge)).toBeRejected();
      expect(blsSign).not.toHaveBeenCalled();
      expect(guardianSign).not.toHaveBeenCalled();
    });
  }
});
