import { Injectable, signal, computed } from '@angular/core';

/**
 * Chia wallet service.
 *
 * Supports the two most common injected-wallet bridges:
 *   - Goby   — `window.chia` (and `window.goby` alias)
 *   - Sage   — `window.sage` (v2 API + WalletConnect Chia namespace)
 *
 * Returns the user's master BLS public key (48-byte G1 element) which will
 * be curried into the vault singleton as OWNER_PUBKEY (AUTH_TYPE_BLS = 1).
 *
 * For signing we request `signMessage` against the Populis registration
 * challenge.  The backend then re-verifies the BLS signature and launches
 * the vault.
 */
@Injectable({ providedIn: 'root' })
export class ChiaWalletService {
  private readonly _state = signal<ChiaState>({ kind: 'disconnected' });
  readonly state = this._state.asReadonly();

  readonly isConnected = computed(() => this._state().kind === 'connected');
  readonly pubkey = computed(() => {
    const s = this._state();
    return s.kind === 'connected' ? s.pubkey : null;
  });
  readonly connectionKind = computed(() => {
    const s = this._state();
    return s.kind === 'connected' ? s.connection : null;
  });

  hasGoby(): boolean {
    return typeof window !== 'undefined' && !!(window as WindowWithChia).chia;
  }

  hasSage(): boolean {
    return typeof window !== 'undefined' && !!(window as WindowWithChia).sage;
  }

  /** Connect to Goby (browser extension). */
  async connectGoby(): Promise<string> {
    const goby = (window as WindowWithChia).chia;
    if (!goby) throw new Error('Goby wallet extension not detected');

    const connected = await goby.request({ method: 'connect' });
    if (!connected) throw new Error('Goby connect rejected');

    const pubkey = (await goby.request({
      method: 'getPublicKeys',
      params: { limit: 1 },
    })) as string[];
    if (!pubkey || pubkey.length === 0) {
      throw new Error('Goby returned no public keys');
    }
    const blsHex = normalizeHex(pubkey[0]);
    this._state.set({ kind: 'connected', pubkey: blsHex, connection: 'goby' });
    return blsHex;
  }

  /** Connect to Sage (browser + WC bridge). */
  async connectSage(): Promise<string> {
    const sage = (window as WindowWithChia).sage;
    if (!sage) throw new Error('Sage wallet not detected');

    const accounts = (await sage.request({
      method: 'chia_getPublicKeys',
      params: {},
    })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error('Sage returned no public keys');
    }
    const blsHex = normalizeHex(accounts[0]);
    this._state.set({ kind: 'connected', pubkey: blsHex, connection: 'sage' });
    return blsHex;
  }

  /**
   * Sign an arbitrary message with the user's master BLS key.
   *
   * Returns a 96-byte BLS signature, hex-encoded.  The backend verifies it
   * against the Populis registration challenge + the reported pubkey.
   */
  async signMessage(message: string): Promise<string> {
    const state = this._state();
    if (state.kind !== 'connected') throw new Error('Not connected');

    if (state.connection === 'goby') {
      const goby = (window as WindowWithChia).chia;
      if (!goby) throw new Error('Goby no longer available');
      const sig = (await goby.request({
        method: 'signMessageByAddress',
        params: { message },
      })) as { signature: string };
      return normalizeHex(sig.signature);
    }

    if (state.connection === 'sage') {
      const sage = (window as WindowWithChia).sage;
      if (!sage) throw new Error('Sage no longer available');
      const sig = (await sage.request({
        method: 'chia_signMessageByAddress',
        params: { message },
      })) as { signature: string };
      return normalizeHex(sig.signature);
    }

    throw new Error(`Unsupported Chia connection: ${state.connection}`);
  }

  disconnect(): void {
    this._state.set({ kind: 'disconnected' });
  }
}

export type ChiaState =
  | { kind: 'disconnected' }
  | { kind: 'connected'; pubkey: string; connection: 'goby' | 'sage' };

interface ChiaInjected {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
}

interface WindowWithChia extends Window {
  chia?: ChiaInjected;
  goby?: ChiaInjected;
  sage?: ChiaInjected;
}

function normalizeHex(s: string): string {
  return s.startsWith('0x') ? s : '0x' + s;
}
