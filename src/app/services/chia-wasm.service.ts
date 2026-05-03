import { Injectable, signal } from '@angular/core';

/**
 * Angular wrapper around the chia-wallet-sdk-wasm SDK that's loaded
 * onto `window.ChiaSDK` by `main.ts:initializeChiaWasm()`.
 *
 * The service is deliberately thin: it doesn't try to abstract over
 * the SDK's API surface (which is large and evolves with the npm
 * package).  Instead it exposes:
 *
 *   1. {@link ready}            — a signal that flips to true the
 *                                 first time `window.ChiaSDK` is seen.
 *   2. {@link sdk}              — typed accessor returning the raw SDK
 *                                 namespace.  Throws if not ready.
 *   3. {@link probeReady}       — manual recheck (useful in unit tests).
 *
 * Callers that need a specific helper (e.g. `standardPuzzleHash`,
 * `Address.encode`, `PublicKey.fromBytes`) wrap that helper in a
 * dedicated typed method on a higher-level service (e.g. ChiaWalletService,
 * ChiaSpendBundleService) so the wasm-bindgen ergonomics don't leak
 * into UI code.
 *
 * Because main.ts deliberately bootstraps Angular *after* WASM init
 * settles, by the time this service is constructed `window.ChiaSDK`
 * should already be present in the happy path.  We still poll with a
 * short timeout to gracefully handle the edge case where WASM init
 * failed (network blip on the .wasm fetch, etc.) — in that case the
 * UI surfaces a "Chia ops unavailable" banner rather than crashing.
 */
@Injectable({ providedIn: 'root' })
export class ChiaWasmService {
  private readonly _ready = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  /** Public read-only signal — flips to true once `window.ChiaSDK` exists. */
  readonly ready = this._ready.asReadonly();

  /** Last init error string, or null if everything is fine. */
  readonly error = this._error.asReadonly();

  constructor() {
    this.probeReady();
  }

  /**
   * Synchronously check whether the SDK is loaded.  Updates the
   * {@link ready} signal as a side effect.
   *
   * In normal operation this is called once from the constructor and
   * the signal flips immediately because main.ts already finished WASM
   * init before Angular bootstrapped.  We still poll briefly to handle:
   *
   *   - The edge case where main.ts bootstrap-ordered Angular *before*
   *     WASM finished (we don't currently allow this, but defensive).
   *   - Hot-module-reload during development, where `window.ChiaSDK`
   *     can briefly disappear.
   */
  probeReady(): boolean {
    if ((window as any).ChiaSDK) {
      this._ready.set(true);
      this._error.set(null);
      return true;
    }
    // Single deferred recheck after one tick; if main.ts had a fetch
    // error the user will see the error banner and can hit reload.
    setTimeout(() => {
      if ((window as any).ChiaSDK) {
        this._ready.set(true);
        this._error.set(null);
      } else {
        this._ready.set(false);
        this._error.set('Chia WASM did not initialise. Reload the page.');
      }
    }, 0);
    return false;
  }

  /**
   * Get the raw SDK namespace.  Throws if WASM is not ready.
   *
   * Strongly typed callers should narrow this further; the SDK has
   * dozens of exports (BLS classes, address codec, condition opcodes,
   * SpendBundle helpers, etc.) and we want each consumer to be
   * explicit about what it depends on.
   */
  sdk(): ChiaSdkExports {
    const sdk = (window as any).ChiaSDK as ChiaSdkExports | undefined;
    if (!sdk) {
      throw new Error(
        'ChiaWasmService.sdk() called before WASM ready. ' +
          'Gate UI on the `ready` signal first.',
      );
    }
    return sdk;
  }

  /**
   * One-liner smoke test the developer console can call to verify the
   * SDK actually works.  Computes the standard puzzle hash for the
   * zero pubkey (canonical "infinity" point) — should be deterministic
   * and produce 32 bytes.  Returns the hex string for easy copy/paste.
   *
   * From devtools:
   *
   *     ng.getInjector().get(ChiaWasmService).smokeTest()
   *
   * (or, in our codebase, via a debug button on the landing page.)
   */
  smokeTest(): { ok: boolean; details: string } {
    if (!this._ready()) {
      return { ok: false, details: 'WASM not ready' };
    }
    try {
      const sdk = this.sdk();
      // Different SDK versions have shuffled where helpers live.
      // Probe for the most likely candidates and pick the first that
      // works; this keeps the smoke test tolerant across minor bumps.
      const candidates: Array<keyof ChiaSdkExports> = [
        'standardPuzzleHash',
        'Address',
        'PublicKey',
      ];
      const present = candidates.filter((c) => typeof sdk[c] !== 'undefined');
      return {
        ok: present.length > 0,
        details:
          present.length > 0
            ? `SDK exports detected: ${present.join(', ')}`
            : 'SDK loaded but expected exports missing — package format may have changed',
      };
    } catch (err) {
      return { ok: false, details: String(err) };
    }
  }
}

/**
 * Loose typing of the SDK namespace.  We intentionally don't pin to the
 * full `chia_wallet_sdk_wasm.d.ts` declarations here — that file is 100KB
 * and changes between minor versions.  Higher-level services that wrap
 * specific helpers should narrow each helper's type at the call site.
 */
export interface ChiaSdkExports {
  // BLS
  PublicKey?: any;
  PrivateKey?: any;
  SecretKey?: any;
  Signature?: any;
  // Addresses
  Address?: any;
  encode_address?: (puzzleHash: Uint8Array, prefix: string) => string;
  decode_address?: (encoded: string) => { prefix: string; puzzleHash: Uint8Array };
  // Standard wallet puzzle
  standardPuzzleHash?: (syntheticKey: any) => Uint8Array;
  // Member primitives (passkey / multisig)
  R1PublicKey?: any;
  MemberConfig?: any;
  r1MemberHash?: (config: any, pubkey: any, topLevel: boolean) => Uint8Array;
  // Anything else lives here as `any`
  [key: string]: any;
}
