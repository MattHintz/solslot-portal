import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../src/app/services/singleton-output-state.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { reconstructSingletonOutput } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const sdk = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
const wasm = await WebAssembly.instantiate(await fs.readFile(new URL('../src/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm', import.meta.url)), {
  './chia_wallet_sdk_wasm_bg.js': sdk,
});
sdk.__wbg_set_wasm(wasm.instance.exports);
const clvm = new sdk.Clvm();
const vectors = JSON.parse(await fs.readFile(new URL('./fixtures/current-output.json', import.meta.url), 'utf8'));
const bytes = value => Uint8Array.from(Buffer.from(value, 'hex'));
let checks = 0;
for (const v of vectors) {
  const args = [clvm, bytes(v.reveal), bytes(v.solution), bytes(v.parentPuzzleHash), bytes(v.currentPuzzleHash), v.kind, bytes(v.moduleHash)];
  assert.equal(Buffer.from(reconstructSingletonOutput(...args)).toString('hex'), v.output, v.name);
  checks++;
  for (const index of [3, 4, 6]) {
    const bad = [...args]; bad[index] = new Uint8Array(32);
    assert.throws(() => reconstructSingletonOutput(...bad), undefined, v.name + ' rejects unbound evidence');
    checks++;
  }
  if (v.name !== 'vault-state-preserved') {
    const stale = [...args]; stale[4] = bytes(v.parentPuzzleHash);
    assert.throws(() => reconstructSingletonOutput(...stale), /current chain coin/);
    checks++;
  }
}
console.log(`${checks} current-output checks passed with the real WASM SDK and Python-generated vectors.`);
