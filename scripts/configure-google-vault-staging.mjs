#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const required = ['gcp-project', 'oauth-client-id', 'release-sha'];
for (const key of required) {
  if (!args[key]) fail(`Missing required --${key}.`);
}
if (!args['confirm-oauth-prerequisites'] || !args['confirm-cloudflare-access']) {
  fail(
    'Manual prerequisites must be confirmed with --confirm-oauth-prerequisites and --confirm-cloudflare-access.',
  );
}
if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(args['gcp-project'])) fail('Invalid GCP project ID.');
if (!/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(args['oauth-client-id'])) {
  fail('Invalid public Google Web OAuth client ID.');
}
if (!/^[0-9a-f]{40}$/.test(args['release-sha'])) fail('--release-sha must be a lowercase 40-character commit SHA.');

requireCommand('gcloud');
requireCommand('gh');
if (run('git', ['status', '--porcelain']).trim()) {
  fail('Refusing to configure staging from a dirty worktree. Commit the exact release first.');
}

const repository = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
run('gh', ['api', `repos/${repository}/commits/${args['release-sha']}`]);
const workflowRef = currentPushedBranch(repository, args['release-sha']);
run('gh', ['workflow', 'view', 'deploy-ceremony-portal.yml', '--ref', workflowRef]);

// This enables only the Drive API. Browser OAuth-client origins, consent mode,
// authorized domain, and test users are deliberately console-managed prerequisites.
run('gcloud', ['services', 'enable', 'drive.googleapis.com', '--project', args['gcp-project']]);
run('gh', ['api', '--method', 'PUT', `repos/${repository}/environments/staging`]);
run('gh', ['variable', 'set', 'SOLSLOT_GOOGLE_VAULT_ENABLED', '--env', 'staging', '--body', 'true']);
run('gh', [
  'variable',
  'set',
  'SOLSLOT_GOOGLE_OAUTH_CLIENT_ID',
  '--env',
  'staging',
  '--body',
  args['oauth-client-id'],
]);

const requiredSecrets = new Set(['SERVER_IP', 'SSH_USER', 'SSH_PRIVATE_KEY', 'SSH_PASSPHRASE']);
const secrets = JSON.parse(run('gh', ['secret', 'list', '--env', 'staging', '--json', 'name']));
const missingSecrets = [...requiredSecrets].filter((name) => !secrets.some((item) => item.name === name));
if (missingSecrets.length) {
  fail(`The staging environment is missing deployment secret names: ${missingSecrets.join(', ')}.`);
}

console.log('Manual prerequisites recorded: dedicated staging Web OAuth client, testing-mode test users, and Cloudflare Access administrators.');
const dispatchStartedAt = new Date();
run('gh', [
  'workflow',
  'run',
  'deploy-ceremony-portal.yml',
  '--ref',
  workflowRef,
  '-f',
  'target=staging',
  '-f',
  `release_sha=${args['release-sha']}`,
]);

const runId = await findWorkflowRun(workflowRef, dispatchStartedAt);
run('gh', ['run', 'watch', runId, '--exit-status']);
await verifyDeployment(args['release-sha']);
console.log(`Google Vault staging deployment verified for ${args['release-sha']}.`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) fail(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    if (key.startsWith('confirm-')) {
      parsed[key] = true;
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--')) fail(`Missing value for ${value}.`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function requireCommand(name) {
  try {
    run(name, ['--version']);
  } catch {
    fail(`Required command is unavailable: ${name}.`);
  }
}

function run(command, commandArgs) {
  return execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

async function findWorkflowRun(workflowRef, dispatchStartedAt) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const output = run('gh', [
      'run',
      'list',
      '--workflow',
      'deploy-ceremony-portal.yml',
      '--event',
      'workflow_dispatch',
      '--limit',
      '20',
      '--json',
      'databaseId,headBranch,createdAt,status',
    ]);
    const matching = JSON.parse(output).find(
      (item) =>
        item.headBranch === workflowRef &&
        new Date(item.createdAt).getTime() >= dispatchStartedAt.getTime() - 5_000,
    );
    if (matching) return String(matching.databaseId);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
  fail('GitHub did not create a staging release workflow run for the requested SHA.');
}

function currentPushedBranch(repository, releaseSha) {
  const branch = run('git', ['branch', '--show-current']).trim();
  if (!branch) fail('Run this script from a named, pushed release branch. Detached HEAD is not supported.');
  try {
    run('git', ['merge-base', '--is-ancestor', releaseSha, branch]);
  } catch {
    fail(`The current branch ${branch} does not contain the requested release SHA.`);
  }
  try {
    run('gh', ['api', `repos/${repository}/branches/${encodeURIComponent(branch)}`]);
  } catch {
    fail(`Push the current release branch ${branch} to GitHub before configuring staging.`);
  }
  return branch;
}

async function verifyDeployment(releaseSha) {
  const base = 'https://staging.solslot.com/genesis-admin';
  const release = await fetch(`${base}/release.json`, { cache: 'no-store' });
  if (!release.ok) fail(`Staging release manifest failed: HTTP ${release.status}.`);
  const manifest = await release.json();
  if (manifest.commit !== releaseSha || manifest.googleVaultEnabled !== true || !manifest.googleVaultRuntimeConfigSha256) {
    fail('Staging release manifest does not prove the requested Google Vault-enabled SHA.');
  }
  const headers = await fetch(`${base}/`, { method: 'HEAD', cache: 'no-store' });
  const csp = headers.headers.get('content-security-policy') || '';
  for (const origin of ['https://accounts.google.com', 'https://oauth2.googleapis.com', 'https://www.googleapis.com']) {
    if (!csp.includes(origin)) fail(`Staging CSP is missing ${origin}.`);
  }
}

function fail(message) {
  throw new Error(message);
}
