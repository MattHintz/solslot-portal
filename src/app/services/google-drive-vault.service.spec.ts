import { TestBed } from '@angular/core/testing';

import { environment } from '../../environments/environment';
import { GoogleDriveVaultError, GoogleDriveVaultService } from './google-drive-vault.service';
import { GOOGLE_VAULT_DERIVATION, SolslotVaultBackupEnvelope } from './vault-backup-crypto.service';

const ENVELOPE: SolslotVaultBackupEnvelope = {
  format: 'solslot-google-vault',
  version: 1,
  protocol: 'solslot-v2',
  network: 'testnet11',
  publicKey: `0x${'11'.repeat(48)}`,
  launcherId: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  derivation: GOOGLE_VAULT_DERIVATION,
  kdf: {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 600_000,
    salt: btoa('1234567890abcdef'),
  },
  cipher: {
    name: 'AES-GCM',
    iv: btoa('123456789012'),
  },
  ciphertext: btoa('authenticated-ciphertext'),
};

describe('GoogleDriveVaultService', () => {
  let service: GoogleDriveVaultService;
  let originalClientId: string;
  let originalEnabled: boolean;
  let originalNetwork: typeof environment.chiaNetwork;
  let originalGoogle: Window['google'];

  beforeEach(() => {
    originalClientId = environment.googleOAuthClientId;
    originalEnabled = environment.googleVaultEnabled;
    originalNetwork = environment.chiaNetwork;
    environment.googleOAuthClientId = 'test-client.apps.googleusercontent.com';
    environment.googleVaultEnabled = true;
    environment.chiaNetwork = 'testnet11';
    originalGoogle = window.google;
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (options) => ({
            requestAccessToken: () =>
              options.callback({ access_token: 'memory-only-token', expires_in: 3600 }),
          }),
          revoke: (_token, callback) => callback(),
        },
      },
    };
    TestBed.configureTestingModule({});
    service = TestBed.inject(GoogleDriveVaultService);
  });

  afterEach(() => {
    environment.googleOAuthClientId = originalClientId;
    environment.googleVaultEnabled = originalEnabled;
    environment.chiaNetwork = originalNetwork;
    window.google = originalGoogle;
  });

  it('loads the single backup from Drive appDataFolder', async () => {
    spyOn(window, 'fetch').and.callFake(async (input) => {
      const url = String(input);
      if (url.includes('spaces=appDataFolder')) {
        return jsonResponse({ files: [{ id: 'backup-id', name: 'solslot_vault_backup_v1.json', size: '512' }] });
      }
      return jsonResponse(ENVELOPE);
    });

    await expectAsync(service.loadBackup()).toBeResolvedTo(ENVELOPE);
    const calls = (window.fetch as jasmine.Spy).calls.allArgs();
    expect(calls[0][0]).toContain('spaces=appDataFolder');
    expect(calls[0][1].headers.Authorization).toBe('Bearer memory-only-token');
  });

  it('refuses duplicate backups rather than choosing one silently', async () => {
    spyOn(window, 'fetch').and.resolveTo(
      jsonResponse({
        files: [
          { id: 'one', name: 'solslot_vault_backup_v1.json' },
          { id: 'two', name: 'solslot_vault_backup_v1.json' },
        ],
      }),
    );

    await expectAsync(service.loadBackup()).toBeRejectedWithError(
      GoogleDriveVaultError,
      /Multiple SolSlot vault backups/,
    );
  });

  it('creates then verifies a new backup without persisting the access token', async () => {
    let listCount = 0;
    spyOn(window, 'fetch').and.callFake(async (input) => {
      const url = String(input);
      if (url.includes('spaces=appDataFolder')) {
        listCount += 1;
        return jsonResponse(
          listCount === 1
            ? { files: [] }
            : { files: [{ id: 'backup-id', name: 'solslot_vault_backup_v1.json', size: '512' }] },
        );
      }
      if (url.includes('/upload/')) return jsonResponse({ id: 'backup-id', name: 'solslot_vault_backup_v1.json', size: '512' });
      return jsonResponse(ENVELOPE);
    });

    await expectAsync(service.createBackup(ENVELOPE)).toBeResolved();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('uses bounded RFC 2387 multipart/related rather than FormData', async () => {
    spyOn(window, 'fetch').and.callFake(async (input, init) => {
      const url = String(input);
      if (url.includes('spaces=appDataFolder')) return jsonResponse({ files: [] });
      if (url.includes('/upload/')) {
        expect((init?.headers as Record<string, string> | undefined)?.['Content-Type']).toMatch(
          /^multipart\/related; boundary=solslot-google-vault-/,
        );
        expect(init?.body instanceof FormData).toBeFalse();
        return jsonResponse({ id: 'backup-id', name: 'solslot_vault_backup_v1.json', size: '512' });
      }
      return jsonResponse(ENVELOPE);
    });

    await expectAsync(service.createBackup(ENVELOPE)).toBeResolved();
  });

  it('read-back verifies a password-reset replacement', async () => {
    let uploaded = false;
    spyOn(window, 'fetch').and.callFake(async (input) => {
      const url = String(input);
      if (url.includes('spaces=appDataFolder')) {
        return jsonResponse({ files: [{ id: 'backup-id', name: 'solslot_vault_backup_v1.json', size: '512' }] });
      }
      if (url.includes('/upload/')) {
        uploaded = true;
        return jsonResponse({ id: 'backup-id', name: 'solslot_vault_backup_v1.json', size: '512' });
      }
      return jsonResponse(uploaded ? ENVELOPE : { ...ENVELOPE, ciphertext: 'wrong' });
    });

    await expectAsync(service.replaceBackup(ENVELOPE)).toBeResolved();
  });

  it('does not revoke the Google grant on ordinary disconnect', async () => {
    const revoke = spyOn(window.google!.accounts!.oauth2!, 'revoke').and.callThrough();
    await service.authorize();
    await service.disconnect();
    expect(revoke).not.toHaveBeenCalled();
    await service.authorize();
    await service.revokeGoogleAccess();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('clears authorization after a 401', async () => {
    spyOn(window, 'fetch').and.resolveTo(new Response('', { status: 401 }));

    await expectAsync(service.loadBackup()).toBeRejectedWithError(
      GoogleDriveVaultError,
      /session expired/,
    );
    expect(service.connected()).toBeFalse();
  });

  it('refuses OAuth outside Testnet11 even when the feature is misconfigured on', async () => {
    environment.chiaNetwork = 'mainnet';
    await expectAsync(service.authorize()).toBeRejectedWithError(
      GoogleDriveVaultError,
      /Testnet11/,
    );
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
