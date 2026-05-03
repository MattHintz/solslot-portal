// scripts/copy-chia-wasm.mjs
//
// Postinstall helper that copies chia-wallet-sdk-wasm's compiled
// WebAssembly binary out of node_modules into src/assets/chia_wasm/
// so Angular's `@angular/build:application` builder picks it up via
// the asset glob in angular.json and serves it at
//
//     /assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm
//
// We copy because Angular's esbuild-based builder cannot handle the
// `import "./*.wasm"` statement that wasm-bindgen emits in the JS
// glue.  Solslot tried Vite plugins; that route is brittle (months of
// pain).  The clean alternative — used here and proven in solslot's
// production main.ts — is:
//   1. Postinstall-copy the .wasm to src/assets/chia_wasm/.
//   2. In main.ts, fetch() the .wasm at runtime, instantiate it
//      manually, and wire it into the JS glue via __wbg_set_wasm().
//   3. Stash the result on `window.ChiaSDK` for ChiaWasmService.
//
// This script is intentionally tiny and free of dependencies so a
// fresh `npm install` can run it without bootstrapping problems.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const src = join(
  repoRoot,
  'node_modules',
  'chia-wallet-sdk-wasm',
  'chia_wallet_sdk_wasm_bg.wasm',
);
const destDir = join(repoRoot, 'src', 'assets', 'chia_wasm');
const dest = join(destDir, 'chia_wallet_sdk_wasm_bg.wasm');

if (!existsSync(src)) {
  // Soft-fail: prevents `npm install` of a fresh checkout from
  // exploding if chia-wallet-sdk-wasm hasn't installed yet (the
  // postinstall script runs *after* dependency resolution, so this
  // path normally exists, but we guard against weird npm orderings).
  console.warn(
    `[copy-chia-wasm] ${src} not present; skipping. ` +
      `Re-run after \`npm install\` completes.`,
  );
  process.exit(0);
}

if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}

copyFileSync(src, dest);
console.log(`[copy-chia-wasm] copied chia_wallet_sdk_wasm_bg.wasm → ${dest}`);
