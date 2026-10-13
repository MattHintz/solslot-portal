import manifest from '../../assets/chia_wasm/runtime-integrity.json';

let runtime:Record<string,any>|null=null;
let loading:Promise<void>|null=null;

export function verifiedChiaRuntime():Record<string,any> {
  if(!runtime)throw new Error('The verified Chia signing runtime is unavailable. Reload the page.');
  return runtime;
}

/** Integrity is pinned by the reviewed static release, never by an API reply. */
export function initializeVerifiedChiaRuntime():Promise<void> {
  if(runtime)return Promise.resolve();
  if(!loading)loading=load();
  return loading;
}

async function load():Promise<void> {
  const read=async(name:keyof typeof manifest.files):Promise<ArrayBuffer>=>{
    const url=new URL('assets/chia_wasm/'+name,document.baseURI);
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin',redirect:'error'});
    if(!response.ok || response.url!==url.href)throw new Error('The Chia signing runtime could not be loaded.');
    const bytes=await response.arrayBuffer(),expected=manifest.files[name];
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
    if(bytes.byteLength!==expected.bytes || digest!==expected.sha256)throw new Error('The Chia signing runtime does not match this release.');
    return bytes;
  };
  // Glue is compiled into the reviewed application bundle. The release check
  // compares that package input with the pinned source bytes; no blob scripts
  // or additional script origins are introduced by wallet review.
  // @ts-ignore Package exposes its generated glue without a separate declaration.
  const sdk=await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js') as Record<string,any>;
  const wasm=await read('chia_wallet_sdk_wasm_bg.wasm');
  const result=await WebAssembly.instantiate(wasm,{'./chia_wallet_sdk_wasm_bg.js':sdk});
  if(typeof sdk['__wbg_set_wasm']!=='function')throw new Error('The Chia signing runtime initializer is missing.');
  sdk['__wbg_set_wasm'](result.instance.exports);
  runtime=Object.freeze({...sdk});
}
