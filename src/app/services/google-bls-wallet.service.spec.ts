import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { ChiaWasmService } from './chia-wasm.service';
import { GoogleBlsWalletService } from './google-bls-wallet.service';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

describe('GoogleBlsWalletService', () => {
  let service: GoogleBlsWalletService;
  let master: ReturnType<typeof secretKey>;
  let child: ReturnType<typeof secretKey>;
  let synthetic: ReturnType<typeof secretKey>;
  let originalEnabled: boolean;
  let originalNetwork: typeof environment.chiaNetwork;

  beforeEach(() => {
    originalEnabled = environment.googleVaultEnabled;
    originalNetwork = environment.chiaNetwork;
    environment.googleVaultEnabled = true;
    environment.chiaNetwork = 'testnet11';
    master = secretKey(1);
    child = secretKey(2);
    synthetic = secretKey(3);
    master.deriveUnhardenedPath.and.returnValue(child);
    child.deriveSynthetic.and.returnValue(synthetic);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ChiaWasmService,
          useValue: {
            sdk: () => ({
              SecretKey: { fromSeed: () => master },
              Signature: { aggregate: () => ({ free: () => undefined, toBytes: () => new Uint8Array(96) }) },
              Coin: class {},
              Clvm: class {},
              sha256: (value: Uint8Array) => value,
            }),
          },
        },
      ],
    });
    service = TestBed.inject(GoogleBlsWalletService);
  });

  afterEach(() => {
    environment.googleVaultEnabled = originalEnabled;
    environment.chiaNetwork = originalNetwork;
  });

  it('uses the selected Chia all-unhardened path and recognises its synthetic key', () => {
    const owner = service.unlock(MNEMONIC);

    expect(master.deriveUnhardenedPath).toHaveBeenCalledOnceWith([12381, 8444, 2, 0]);
    expect(owner).toBe(publicKeyHex(2));
    expect((service as any).keyForPublicKey(publicKey(2))).toBe(child);
    expect((service as any).keyForPublicKey(publicKey(3))).toBe(synthetic);
  });

  it('rejects unknown signature keys and signing while locked', () => {
    service.unlock(MNEMONIC);
    expect(() => (service as any).keyForPublicKey(publicKey(99))).toThrowError(/unknown BLS public key/);

    service.lock();
    expect(() => service.signChip0002Message('00'.repeat(32))).toThrowError(/Google vault is locked/);
  });

  it('fails closed when the runtime feature flag is disabled', () => {
    environment.googleVaultEnabled = false;
    expect(() => service.unlock(MNEMONIC)).toThrowError(/enabled Testnet11/);
  });

  it('fails closed outside Testnet11 even when the feature is misconfigured on', () => {
    environment.chiaNetwork = 'mainnet';
    expect(() => service.unlock(MNEMONIC)).toThrowError(/Testnet11/);
  });
});

function secretKey(byte: number) {
  return {
    free: jasmine.createSpy('free'),
    publicKey: () => publicKey(byte),
    sign: () => ({ free: () => undefined, toBytes: () => new Uint8Array(96) }),
    deriveSynthetic: jasmine.createSpy('deriveSynthetic'),
    deriveUnhardenedPath: jasmine.createSpy('deriveUnhardenedPath'),
  };
}

function publicKey(byte: number) {
  return {
    free: jasmine.createSpy('free'),
    toBytes: () => new Uint8Array(48).fill(byte),
  };
}

function publicKeyHex(byte: number): string {
  return `0x${byte.toString(16).padStart(2, '0').repeat(48)}`;
}
