import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await readFile(resolve(root,'src/assets/chia_wasm/runtime-integrity.json'),'utf8'));
for(const [file,pinned] of Object.entries(manifest.files)){
  for(const location of ['src/assets/chia_wasm','node_modules/chia-wallet-sdk-wasm']){
    const bytes=await readFile(resolve(root,location,file));
    assert.equal(bytes.length,pinned.bytes,`${location}/${file} length differs from the reviewed runtime`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),pinned.sha256,`${location}/${file} differs from the reviewed runtime`);
  }
}
console.log('Admin Chia runtime package and deployed assets match the pinned release bytes.');
