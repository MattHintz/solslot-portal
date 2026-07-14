import { TestBed } from '@angular/core/testing';

import { WalletUxStateService } from './wallet-ux-state.service';

describe('WalletUxStateService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('persists only the public last wallet kind preference', () => {
    const service = TestBed.inject(WalletUxStateService);

    service.setLastWalletKind('chia');

    expect(service.lastWalletKind()).toBe('chia');
    const raw = localStorage.getItem('SOLSLOT_WALLET_UX_V2');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(parsed['version']).toBe(2);
    expect(parsed['lastWalletKind']).toBe('chia');
    expect(typeof parsed['updatedAt']).toBe('number');
    expect(raw).not.toContain('signature');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('nonce');
  });

  it('restores a valid saved wallet kind on startup', () => {
    localStorage.setItem(
      'SOLSLOT_WALLET_UX_V2',
      JSON.stringify({ version: 2, lastWalletKind: 'evm', updatedAt: 123 }),
    );

    const service = TestBed.inject(WalletUxStateService);

    expect(service.lastWalletKind()).toBe('evm');
  });

  it('drops malformed or unexpected stored values', () => {
    localStorage.setItem(
      'SOLSLOT_WALLET_UX_V2',
      JSON.stringify({ version: 2, lastWalletKind: 'signature', updatedAt: 123 }),
    );

    const service = TestBed.inject(WalletUxStateService);

    expect(service.lastWalletKind()).toBeNull();
    expect(localStorage.getItem('SOLSLOT_WALLET_UX_V2')).toBeNull();
  });
});
