import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// ─────────────────────────────────────────────────────────────────────────
// Chia Wallet SDK WASM bootstrap.
//
// We use the same pattern proven in production by solslot's portal
// (research/solslot-frontend/slui/src/main.ts):
//
//   1. The .wasm binary lives at /assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm
//      (copied from node_modules by scripts/copy-chia-wasm.mjs at postinstall;
//      Angular's asset glob in angular.json picks it up at build time).
//
//   2. The JS "glue" — wasm-bindgen's exported bindings — comes from npm
//      via a direct deep import of the package's
//      `chia_wallet_sdk_wasm_bg.js`.  We deliberately bypass the package's
//      own `chia_wallet_sdk_wasm.js` entrypoint because that file does
//      `import * as wasm from "./chia_wallet_sdk_wasm_bg.wasm"`, which
//      Angular's esbuild-based @angular/build:application builder cannot
//      resolve (no built-in WASM loader; vite-plugin-wasm doesn't apply
//      here).  Hand-instantiating sidesteps that entirely.
//
//   3. After fetching + instantiating the .wasm, we call
//      __wbg_set_wasm() (a wasm-bindgen helper exported by the glue) to
//      complete the bidirectional wiring, then stash the SDK object on
//      `window.ChiaSDK` so ChiaWasmService can pick it up via DI without
//      having to await module imports inside Angular's injector.
//
// We deliberately bootstrap Angular *after* WASM init resolves.  This adds
// roughly 100–300ms to first paint on cold load (5.4MB binary, decoded on
// the main thread) but means every Angular service can synchronously
// assume the SDK is ready when it asks for it via ChiaWasmService.
// ─────────────────────────────────────────────────────────────────────────

// @ts-ignore — deep-import path; types come from chia_wallet_sdk_wasm.d.ts.
import * as wasmExports from 'chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js';

const WASM_URL = '/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm';

async function initializeChiaWasm(): Promise<void> {
  try {
    const response = await fetch(WASM_URL);
    if (!response.ok) {
      throw new Error(
        `[main] Failed to fetch ${WASM_URL}: ${response.status} ${response.statusText}`,
      );
    }
    const bytes = await response.arrayBuffer();

    // wasm-bindgen's emitted glue treats `./chia_wallet_sdk_wasm_bg.js`
    // as the host module name during instantiation; pass the imported
    // namespace through so the WASM's imported callbacks resolve.
    const result = await WebAssembly.instantiate(bytes, {
      './chia_wallet_sdk_wasm_bg.js': wasmExports as unknown as WebAssembly.ModuleImports,
    });

    const setWasm = (wasmExports as any).__wbg_set_wasm;
    if (typeof setWasm !== 'function') {
      throw new Error(
        '[main] chia_wallet_sdk_wasm_bg.js is missing __wbg_set_wasm. ' +
          'Did the SDK package format change?',
      );
    }
    setWasm(result.instance.exports);

    (window as any).ChiaSDK = wasmExports;
    console.info('[main] Chia WASM ready.');
  } catch (err) {
    console.error('[main] Chia WASM init failed:', err);
    // Re-throw so tests + dev tooling see the failure surface; in
    // production the app will still bootstrap (no Chia ops will work
    // until the user reloads, which is the same behaviour as a network
    // failure during initial load).
    throw err;
  }
}

initializeChiaWasm()
  .catch((err) => {
    // Swallow here so Angular bootstraps even when WASM init fails;
    // ChiaWasmService surfaces the disabled state to the UI.
    console.error('[main] Continuing with Chia WASM disabled:', err);
  })
  .finally(() => {
    bootstrapApplication(App, appConfig).catch((err) => console.error(err));
  });
