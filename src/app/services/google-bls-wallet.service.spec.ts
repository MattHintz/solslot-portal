import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { ChiaWasmService } from './chia-wasm.service';
import { buildAggSigMessage, GoogleBlsWalletService } from './google-bls-wallet.service';

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
              Clvm: class {
                pair = jasmine.createSpy('pair').and.callFake(() => ({ free: () => undefined, treeHash: () => new Uint8Array(32).fill(7) }));
                string = jasmine.createSpy('string');
                atom = jasmine.createSpy('atom');
                free() {}
              },
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

  it('refuses direct generic spend signing before loading or executing WASM', () => {
    service.unlock(MNEMONIC);
    const sdk = spyOn(TestBed.inject(ChiaWasmService), 'sdk').and.callThrough();
    expect(() => service.signSpendBundle([{
      coin: { parentCoinInfo: '0x' + '11'.repeat(32), puzzleHash: '0x' + '22'.repeat(32), amount: 1 },
      puzzleReveal: '0x80', solution: '0x80',
    }])).toThrowError(/Google Vault transactions are not available/);
    expect(sdk).not.toHaveBeenCalled();
  });

  it('keeps CHIP-0002 owner authentication available while transaction signing is paused', () => {
    service.unlock(MNEMONIC);
    expect(service.signChip0002Message('11'.repeat(32))).toBe('0x' + '00'.repeat(96));
    expect(child.sign).toHaveBeenCalledTimes(1);
    expect(synthetic.sign).not.toHaveBeenCalled();
  });

  it('rejects malformed spend inputs without reading any provider-controlled fields', () => {
    service.unlock(MNEMONIC);
    const inspect = jasmine.createSpy('inspect').and.throwError('must not inspect');
    const spend = Object.defineProperty({}, 'coin', { get: inspect });
    for (const input of [[], [spend], null, undefined]) {
      expect(() => service.signSpendBundle(input as any)).toThrowError(/Google Vault transactions are not available/);
    }
    expect(inspect).not.toHaveBeenCalled();
    expect(child.sign).not.toHaveBeenCalled();
    expect(synthetic.sign).not.toHaveBeenCalled();
  });

  it('rechecks network and activation at the direct spend entry point after unlock', () => {
    service.unlock(MNEMONIC);
    environment.googleVaultEnabled = false;
    expect(() => service.signSpendBundle([])).toThrowError(/enabled Testnet11/);
    environment.googleVaultEnabled = true;
    environment.chiaNetwork = 'mainnet';
    expect(() => service.signSpendBundle([])).toThrowError(/enabled Testnet11/);
    expect(child.sign).not.toHaveBeenCalled();
  });

  it('rejects unsafe aggregate-signature messages before using coin or SDK state', () => {
    expect(() => buildAggSigMessage('unsafe', Uint8Array.of(42), null as any,
      new Uint8Array(32), new Uint8Array(32), null as any)).toThrowError(/AGG_SIG_UNSAFE/);
  });
});

function secretKey(byte: number) {
  return {
    free: jasmine.createSpy('free'),
    publicKey: () => publicKey(byte),
    sign: jasmine.createSpy('sign').and.callFake(() => ({ free: () => undefined, toBytes: () => new Uint8Array(96) })),
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
