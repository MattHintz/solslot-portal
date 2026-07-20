#!/usr/bin/env node

import fs from 'node:fs/promises';
import { mnemonicToSeedSync } from '@scure/bip39';

const sdk = await import('chia-wallet-sdk-wasm/chia_wallet_sdk_wasm_bg.js');
const fixture = JSON.parse(
  await fs.readFile(new URL('./fixtures/google-bls-testnet11-v1.json', import.meta.url), 'utf8'),
);
const wasmBytes = await fs.readFile(
  new URL('../src/assets/chia_wasm/chia_wallet_sdk_wasm_bg.wasm', import.meta.url),
);
const result = await WebAssembly.instantiate(wasmBytes, {
  './chia_wallet_sdk_wasm_bg.js': sdk,
});
sdk.__wbg_set_wasm(result.instance.exports);

assert(fixture.schema === 'solslot-google-vault-bls-v1', 'unexpected fixture schema');
assert(JSON.stringify(fixture.derivation.path) === JSON.stringify([12381, 8444, 2, 0]), 'wrong derivation path');
const message = fromHex(fixture.registration.message);

const seed = mnemonicToSeedSync(fixture.mnemonic);
const masterKey = sdk.SecretKey.fromSeed(seed);
const secretKey = masterKey.deriveUnhardenedPath(fixture.derivation.path);
const syntheticKey = secretKey.deriveSynthetic();
const clvm = new sdk.Clvm();
const signedMessage = clvm.pair(clvm.string('Chia Signed Message'), clvm.atom(message));
const digest = signedMessage.treeHash();
const signature = secretKey.sign(digest);
const actual = {
  publicKey: toHex(secretKey.publicKey().toBytes()),
  digest: toHex(digest),
  signature: toHex(signature.toBytes()),
};

for (const key of Object.keys(actual)) {
  if (actual[key] !== fixture.registration[key]) {
    throw new Error(`Google BLS ${key} vector mismatch: ${actual[key]}`);
  }
}

assert(toHex(syntheticKey.publicKey().toBytes()) === fixture.registration.syntheticPublicKey, 'synthetic key mismatch');

const parent = fromHex('01'.repeat(32));
const puzzleHash = fromHex('02'.repeat(32));
const aggMessage = fromHex('03'.repeat(32));
const base = fromHex('37a90eb5185a9c4439a91ddc98bbadce7b4feba060d50116a067de66bf236615');
const coin = new sdk.Coin(parent, puzzleHash, 530n);
const requests = {
  parent: [parent, 43],
  puzzle: [puzzleHash, 44],
  amount: [clvmInteger(530n), 45],
  puzzle_amount: [concat(puzzleHash, clvmInteger(530n)), 46],
  parent_amount: [concat(parent, clvmInteger(530n)), 47],
  parent_puzzle: [concat(parent, puzzleHash), 48],
  unsafe: [new Uint8Array(), null],
  me: [coin.coinId(), 0],
};
const signatures = [];
const publicKeys = [];
const finalMessages = [];
for (const [kind, [addendum, suffix]] of Object.entries(requests)) {
  const finalMessage =
    kind === 'unsafe'
      ? aggMessage
      : concat(
          aggMessage,
          addendum,
          kind === 'me' ? base : sdk.sha256(concat(base, Uint8Array.of(suffix))),
        );
  assert(toHex(finalMessage) === fixture.aggSig[kind], `AGG_SIG_${kind} message mismatch`);
  const signer = kind === 'puzzle' ? syntheticKey : secretKey;
  signatures.push(signer.sign(finalMessage));
  publicKeys.push(signer.publicKey());
  finalMessages.push(finalMessage);
}
const aggregate = sdk.Signature.aggregate(signatures);
assert(toHex(aggregate.toBytes()) === fixture.aggregateSignature, 'aggregate signature mismatch');
assert(sdk.PublicKey.aggregateVerify(publicKeys, finalMessages, aggregate), 'aggregate signature did not verify');

seed.fill(0);
digest.fill(0);
masterKey.free();
secretKey.free();
syntheticKey.free();
signature.free();
signedMessage.free();
clvm.free();
coin.free();
aggregate.free();
for (const item of signatures) item.free();
for (const item of publicKeys) item.free();
console.log('Google BLS registration, derivation, AGG_SIG, and aggregate vectors verified.');

function fromHex(hex) {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function toHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function concat(...values) {
  const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function clvmInteger(value) {
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  if ((bytes[0] & 0x80) !== 0) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
