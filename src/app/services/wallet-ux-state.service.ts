import { Injectable, signal } from '@angular/core';

export type LastWalletKind = 'evm' | 'chia' | 'google';

interface StoredWalletUxState {
  version: 2;
  lastWalletKind: LastWalletKind;
  updatedAt: number;
}

const STORAGE_KEY = 'SOLSLOT_WALLET_UX_V2';

@Injectable({ providedIn: 'root' })
export class WalletUxStateService {
  private readonly _lastWalletKind = signal<LastWalletKind | null>(this.loadLastWalletKind());
  readonly lastWalletKind = this._lastWalletKind.asReadonly();

  setLastWalletKind(kind: LastWalletKind): void {
    this._lastWalletKind.set(kind);
    if (typeof window === 'undefined') return;
    const state: StoredWalletUxState = {
      version: 2,
      lastWalletKind: kind,
      updatedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  clear(): void {
    this._lastWalletKind.set(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private loadLastWalletKind(): LastWalletKind | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredWalletUxState>;
      if (parsed.version === 2 && isLastWalletKind(parsed.lastWalletKind)) {
        return parsed.lastWalletKind;
      }
    } catch {}
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function isLastWalletKind(value: unknown): value is LastWalletKind {
  return value === 'evm' || value === 'chia' || value === 'google';
}
