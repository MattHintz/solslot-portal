import { TestBed } from '@angular/core/testing';

import {
  GOOGLE_VAULT_DERIVATION,
  GOOGLE_VAULT_MAX_BACKUP_BYTES,
  SolslotVaultBackupEnvelope,
  VaultBackupCryptoError,
  VaultBackupCryptoService,
} from './vault-backup-crypto.service';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const PUBLIC_KEY = `0x${'11'.repeat(48)}`;
const PASSWORD = 'correct horse battery staple';

describe('VaultBackupCryptoService', () => {
  let service: VaultBackupCryptoService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VaultBackupCryptoService);
  });

  it('generates a valid 24-word recovery phrase', () => {
    expect(service.generateMnemonic().split(' ')).toHaveSize(24);
  });

  it('encrypts and restores a versioned authenticated backup', async () => {
    const envelope = await service.encrypt({
      mnemonic: MNEMONIC,
      password: PASSWORD,
      publicKey: PUBLIC_KEY,
    });

    expect(envelope.ciphertext).not.toContain('abandon');
    expect(envelope.publicKey).toBe(PUBLIC_KEY);
    expect(envelope.kdf.iterations).toBe(600_000);
    expect(envelope.derivation).toEqual(GOOGLE_VAULT_DERIVATION);

    const restored = await service.decrypt(envelope, PASSWORD);
    expect(restored.mnemonic).toBe(MNEMONIC);
  });

  it('uses fresh salt and IV for every encryption', async () => {
    const first = await encrypt(service);
    const second = await encrypt(service);

    expect(second.kdf.salt).not.toBe(first.kdf.salt);
    expect(second.cipher.iv).not.toBe(first.cipher.iv);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it('rejects wrong passwords and authenticated metadata tampering', async () => {
    const envelope = await encrypt(service);
    await expectAsync(service.decrypt(envelope, 'this is the wrong password')).toBeRejectedWithError(
      VaultBackupCryptoError,
      /incorrect or the backup is damaged/,
    );

    const tampered: SolslotVaultBackupEnvelope = {
      ...envelope,
      launcherId: `0x${'22'.repeat(32)}`,
    };
    await expectAsync(service.decrypt(tampered, PASSWORD)).toBeRejectedWithError(
      VaultBackupCryptoError,
      /incorrect or the backup is damaged/,
    );
  });

  it('rejects weak passwords and malformed public keys', async () => {
    await expectAsync(
      service.encrypt({ mnemonic: MNEMONIC, password: 'short', publicKey: PUBLIC_KEY }),
    ).toBeRejectedWithError(VaultBackupCryptoError, /at least 12/);
    await expectAsync(
      service.encrypt({ mnemonic: MNEMONIC, password: PASSWORD, publicKey: '0x12' }),
    ).toBeRejectedWithError(VaultBackupCryptoError, /backup is invalid/);
  });

  it('rejects downgraded KDF settings, malformed derivation, and oversized ciphertexts', async () => {
    const envelope = await encrypt(service);
    const downgraded = { ...envelope, kdf: { ...envelope.kdf, iterations: 100_000 } };
    expect(() => service.parse(downgraded)).toThrowError(VaultBackupCryptoError, /invalid/);

    const wrongPath = { ...envelope, derivation: { ...GOOGLE_VAULT_DERIVATION, path: [12381, 8444, 2, 1] } };
    expect(() => service.parse(wrongPath)).toThrowError(VaultBackupCryptoError, /invalid/);

    expect(() => service.parse({ ...envelope, untrusted: true })).toThrowError(
      VaultBackupCryptoError,
      /invalid/,
    );

    const oversized = { ...envelope, ciphertext: btoa('a'.repeat(GOOGLE_VAULT_MAX_BACKUP_BYTES + 1)) };
    expect(() => service.parse(oversized)).toThrowError(VaultBackupCryptoError, /invalid/);
  });
});

function encrypt(service: VaultBackupCryptoService): Promise<SolslotVaultBackupEnvelope> {
  return service.encrypt({ mnemonic: MNEMONIC, password: PASSWORD, publicKey: PUBLIC_KEY });
}
