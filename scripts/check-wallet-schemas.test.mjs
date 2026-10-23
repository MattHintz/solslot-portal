import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { z } from 'zod';

// Exercise the actual locked consumers, including their older schema syntax.
// These imports intentionally fail if an update moves the consumer schemas:
// changing the dependency override then requires a new compatibility review.
const reownEntry = import.meta.resolve('@reown/appkit-wallet');
const reown = await import(new URL('../src/W3mFrameSchema.js', reownEntry));
const cdpEntry = import.meta.resolve('@coinbase/cdp-sdk');
const cdp = await import(new URL('./policies/evmSchema.js', cdpEntry));
const policies = await import(new URL('./policies/types.js', cdpEntry));
const requireFromCdp = createRequire(cdpEntry);
const { Abi, Address } = requireFromCdp('abitype/zod');

test('wallet consumers resolve the patched validator, in ESM and CommonJS', () => {
  const requireFromReown = createRequire(reownEntry);
  assert.equal(requireFromCdp('zod/package.json').version, '4.6.6');
  assert.equal(requireFromReown('zod/package.json').version, '4.6.6');
  assert.equal(createRequire(import.meta.url)('zod/package.json').version, '4.6.6');
});

for (const [name, schemaFor, input] of [
  ['array maximum', value => z.array(value).max(2), ['a', 'b', 'c']],
  ['array length', value => z.array(value).length(2), ['a', 'b', 'c']],
  ['set maximum', value => z.set(value).max(2), new Set(['a', 'b', 'c'])],
  ['map maximum', value => z.map(z.string(), value).max(2), new Map([['a', 'a'], ['b', 'b'], ['c', 'c']])],
]) {
  test(`${name} rejects oversized input before evaluating its children`, () => {
    let visited = 0;
    const schema = schemaFor(z.string().refine(() => { visited += 1; return true; }));
    const result = schema.safeParse(input);
    assert.equal(result.success, false);
    assert.equal(visited, 0);
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, 'too_big');
  });
}

test('Reown connection and network schemas accept valid messages and reject malformed ones', () => {
  assert.equal(reown.AppConnectEmailRequest.safeParse({ email: 'wallet@example.com' }).success, true);
  assert.equal(reown.AppConnectEmailRequest.safeParse({ email: 'not-an-email' }).success, false);
  for (const chainId of [1, 'eip155:1']) {
    assert.equal(reown.AppSwitchNetworkRequest.safeParse({ chainId }).success, true);
  }
  assert.equal(reown.AppSwitchNetworkRequest.safeParse({ chainId: {} }).success, false);
  const user = { address: '0x' + '1'.repeat(40), chainId: 1, email: null,
    accounts: [{ address: '0x' + '1'.repeat(40), type: 'eoa' }] };
  assert.equal(reown.FrameGetUserResponse.safeParse(user).success, true);
  assert.equal(reown.FrameGetUserResponse.safeParse({ ...user, accounts: [{ type: 'invalid' }] }).success, false);
});

test('Reown theme records retain their value validation', () => {
  assert.equal(reown.AppSyncThemeRequest.safeParse({ themeMode: 'dark',
    themeVariables: { accent: '#123456', radius: 4 }, w3mThemeVariables: { color: 'green' } }).success, true);
  assert.equal(reown.AppSyncThemeRequest.safeParse({ themeVariables: { accent: {} } }).success, false);
  assert.equal(reown.AppSyncThemeRequest.safeParse({ w3mThemeVariables: { color: 4 } }).success, false);
});

const criterion = {
  type: 'evmTypedDataField',
  types: { types: { Message: [{ name: 'body', type: 'string' }] }, primaryType: 'Message' },
  conditions: [{ match: '^hello$', path: 'body' }],
};

test('Coinbase legacy single-argument records preserve typed-data validation', () => {
  assert.equal(cdp.SignEvmTypedDataFieldCriterionSchema.safeParse(criterion).success, true);
  const malformed = structuredClone(criterion);
  malformed.types.types.Message[0].type = 42;
  assert.equal(cdp.SignEvmTypedDataFieldCriterionSchema.safeParse(malformed).success, false);
  assert.equal(cdp.SignEvmTypedDataFieldCriterionSchema.safeParse({ ...criterion, conditions: [] }).success, false);
});

test('Coinbase discriminated policy unions accept typed-data rules and reject invalid actions', () => {
  const rule = { action: 'accept', operation: 'signEvmTypedData', criteria: [criterion] };
  assert.equal(policies.CreatePolicyBodySchema.safeParse({ scope: 'account', rules: [rule] }).success, true);
  assert.equal(policies.CreatePolicyBodySchema.safeParse({ scope: 'account', rules: [{ ...rule, action: 'invalid' }] }).success, false);
  assert.equal(policies.CreatePolicyBodySchema.safeParse({ scope: 'account', rules: Array(11).fill(rule) }).success, false);
  assert.equal(policies.CreatePolicyBodySchema.safeParse({ scope: 'account', rules: [{ ...rule, operation: 'unknown' }] }).success, false);
});

test('the Coinbase ABI consumer still validates address and contract shapes', () => {
  assert.equal(Address.safeParse('0x' + '1'.repeat(40)).success, true);
  assert.equal(Address.safeParse('not-an-address').success, false);
  const abi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }] }];
  assert.equal(Abi.safeParse(abi).success, true);
  assert.equal(Abi.safeParse([{ ...abi[0], inputs: [{ name: 'owner', type: 'invalid' }] }]).success, false);
});
