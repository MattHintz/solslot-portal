import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Real CLI entrypoint; every external command and HTTP response is a disposable fixture.
// The child receives no inherited credentials and PATH contains only these three shims.
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'configure-google-vault-staging.mjs');
const SHA = 'a'.repeat(40);
const TAG = 'solslot-v2-alpha-rc27.41-20260907';
const defaults = [
  '--gcp-project', 'solslot-test-fixture',
  '--oauth-client-id', '123456-fixture.apps.googleusercontent.com',
  '--release-sha', SHA, '--release-tag', TAG,
  '--confirm-oauth-prerequisites', '--confirm-cloudflare-access',
];
const shim = String.raw`
import fs from 'node:fs';
import path from 'node:path';
const config = JSON.parse(fs.readFileSync(process.env.SOLSLOT_HELPER_FIXTURE, 'utf8'));
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SOLSLOT_HELPER_TRACE, JSON.stringify({ command, args }) + '\n');
const output = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
const fail = message => { process.stderr.write(message + '\n'); process.exit(1); };
if (args[0] === '--version') {
  output('synthetic test command');
} else if (command === 'git') {
  if (args[0] === 'status') output(config.dirty ? ' M fixture' : '');
  else if (args[0] === 'branch') output('release-fixture');
  else if (args[0] !== 'merge-base') fail('Unexpected git command');
} else if (command === 'gcloud') {
  if (JSON.stringify(args) !== JSON.stringify(['services','enable','drive.googleapis.com','--project','solslot-test-fixture'])) fail('Unexpected cloud command');
} else if (command === 'gh') {
  if (args[0] === 'repo' && args[1] === 'view') output('fixture/portal');
  else if (args[0] === 'api' && args[1] === 'repos/fixture/portal/commits/' + config.sha) output({ sha: config.sha });
  else if (args[0] === 'api' && args[1] === 'repos/fixture/portal/commits/tags/' + config.tag) {
    if (config.missingRemoteTag) fail('tag not found');
    output(config.remoteTagSha || config.sha);
  } else if (args[0] === 'api' && args[1] === 'repos/fixture/portal/branches/release-fixture') output({ name: 'release-fixture' });
  else if (args[0] === 'api' && args[1] === '--method' && args[2] === 'PUT' && args[3] === 'repos/fixture/portal/environments/staging') output({});
  else if (args[0] === 'workflow' && args[1] === 'view') output('synthetic workflow');
  else if (args[0] === 'secret' && args[1] === 'list') output((config.missingSecrets ? [] : ['SERVER_IP','SSH_USER','SSH_PRIVATE_KEY','SSH_PASSPHRASE']).map(name => ({ name })));
  else if (args[0] === 'variable' && args[1] === 'set') {
    if (!args.includes('staging')) fail('Unexpected variable environment');
  } else if (args[0] === 'workflow' && args[1] === 'run') {
    if (!args.includes('release_tag=' + config.tag)) fail('Required coordinated release tag omitted from dispatch');
    if (!args.includes('release_sha=' + config.sha) || !args.includes('target=staging')) fail('Wrong release dispatch identity');
  } else if (args[0] === 'run' && args[1] === 'list') output([{ databaseId: 1001, headBranch: 'release-fixture', createdAt: new Date().toISOString(), status: 'completed' }]);
  else if (args[0] !== 'run' || args[1] !== 'watch' || args[2] !== '1001') fail('Unexpected GitHub command');
} else fail('Unexpected command');
`;
const hook = String.raw`
import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync(process.env.SOLSLOT_HELPER_FIXTURE, 'utf8'));
globalThis.fetch = async (url, options = {}) => {
  fs.appendFileSync(process.env.SOLSLOT_HELPER_TRACE, JSON.stringify({ command: 'fetch', args: [url, options.method || 'GET'] }) + '\n');
  const base = 'https://staging.solslot.com/genesis-admin';
  if (url === base + '/release.json') return new Response(JSON.stringify({
    commit: config.sha, release: config.tag, environment: 'staging',
    baseHref: '/genesis-admin/', testOnly: true,
    googleVaultEnabled: true, googleVaultRuntimeConfigSha256: '1'.repeat(64),
    ...config.manifest,
  }));
  if (url === base + '/' && options.method === 'HEAD') return new Response(null, { headers: {
    'content-security-policy': 'connect-src https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com',
  } });
  throw new Error('Unexpected HTTP request refused by fixture');
};
`;

function runCase(options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'solslot-staging-helper-'));
  try {
    const bin = path.join(directory, 'bin');
    mkdirSync(bin);
    const trace = path.join(directory, 'trace.jsonl');
    const fixture = path.join(directory, 'fixture.json');
    const cli = path.join(bin, 'fixture-cli.mjs');
    const http = path.join(directory, 'http-fixture.mjs');
    writeFileSync(trace, '');
    writeFileSync(fixture, JSON.stringify({ sha: SHA, tag: TAG, ...options.fixture }));
    writeFileSync(cli, '#!' + process.execPath + '\n' + shim);
    chmodSync(cli, 0o700);
    for (const name of ['git', 'gh', 'gcloud']) symlinkSync(cli, path.join(bin, name));
    writeFileSync(http, hook);
    const result = spawnSync(process.execPath, ['--import', http, script, ...(options.args || defaults)], {
      cwd: directory,
      env: { PATH: bin, HOME: directory, LANG: 'C.UTF-8', SOLSLOT_HELPER_FIXTURE: fixture, SOLSLOT_HELPER_TRACE: trace },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    return { ...result, calls: readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function mutations(calls) {
  return calls.filter(({ command, args }) =>
    (command === 'gcloud' && args[0] === 'services') ||
    (command === 'gh' && (
      (args[0] === 'variable' && args[1] === 'set') ||
      (args[0] === 'api' && args[1] === '--method') ||
      (args[0] === 'workflow' && args[1] === 'run')
    )));
}
function without(key) {
  const values = [...defaults];
  const index = values.indexOf(key);
  values.splice(index, key.startsWith('--confirm-') ? 1 : 2);
  return values;
}

test('dispatches SHA and coordinated tag, then verifies the same staging identity', () => {
  const result = runCase();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /deployment verified/);
  const dispatch = result.calls.find(call => call.command === 'gh' && call.args[0] === 'workflow' && call.args[1] === 'run');
  assert.ok(dispatch.args.includes('release_tag=' + TAG));
  assert.ok(dispatch.args.includes('release_sha=' + SHA));
  assert.ok(dispatch.args.includes('target=staging'));
  const tagLookup = result.calls.findIndex(call => call.args[1] === 'repos/fixture/portal/commits/tags/' + TAG);
  assert.ok(tagLookup >= 0, 'Must resolve the explicit tag namespace, not an ambiguous branch name');
  assert.ok(tagLookup <
    result.calls.findIndex(call => call.command === 'gcloud' && call.args[0] === 'services'));
  assert.deepEqual(result.calls.filter(call => call.command === 'fetch').map(call => call.args), [
    ['https://staging.solslot.com/genesis-admin/release.json', 'GET'],
    ['https://staging.solslot.com/genesis-admin/', 'HEAD'],
  ]);
});

for (const key of ['--release-tag', '--confirm-oauth-prerequisites', '--confirm-cloudflare-access']) {
  test('requires ' + key + ' before any external command', () => {
    const result = runCase({ args: without(key) });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 0);
  });
}
test('rejects an uncoordinated tag before any external command', () => {
  const args = [...defaults];
  args[args.indexOf('--release-tag') + 1] = 'uncoordinated-tag';
  const result = runCase({ args });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release-tag/);
  assert.equal(result.calls.length, 0);
});
for (const [name, fixture] of [
  ['tag resolving to another commit', { remoteTagSha: 'b'.repeat(40) }],
  ['missing remote tag', { missingRemoteTag: true }],
  ['dirty source worktree', { dirty: true }],
  ['missing deployment secret names', { missingSecrets: true }],
]) {
  test('rejects ' + name + ' before configuration mutation or dispatch', () => {
    const result = runCase({ fixture });
    assert.notEqual(result.status, 0);
    assert.deepEqual(mutations(result.calls), []);
  });
}
for (const [name, manifest] of [
  ['wrong tag', { release: 'solslot-v2-alpha-rc27.40-20260906' }],
  ['wrong commit', { commit: 'b'.repeat(40) }],
  ['wrong environment', { environment: 'production' }],
  ['wrong mount', { baseHref: '/' }],
  ['non-test release', { testOnly: false }],
  ['disabled Google Vault', { googleVaultEnabled: false }],
  ['missing runtime config hash', { googleVaultRuntimeConfigSha256: '' }],
]) {
  test('does not claim successful deployment for ' + name, () => {
    const result = runCase({ fixture: { manifest } });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /deployment verified/);
    assert.deepEqual(result.calls.filter(call => call.command === 'fetch').map(call => call.args[0]), [
      'https://staging.solslot.com/genesis-admin/release.json',
    ]);
  });
}
