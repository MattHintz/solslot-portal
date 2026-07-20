#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'src/environments/google-vault-runtime.ts');
const enabled = parseBoolean(process.env.SOLSLOT_GOOGLE_VAULT_ENABLED ?? 'false');
const oauthClientId = process.env.SOLSLOT_GOOGLE_OAUTH_CLIENT_ID ?? '';

if (enabled && !/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(oauthClientId)) {
  throw new Error('SOLSLOT_GOOGLE_OAUTH_CLIENT_ID must be a public Google Web client ID when Google Vault is enabled.');
}
if (!enabled && oauthClientId) {
  throw new Error('Refusing to embed SOLSLOT_GOOGLE_OAUTH_CLIENT_ID while Google Vault is disabled.');
}

const source = [
  '/** Generated at build time. Do not commit this file. */',
  'export const googleVaultRuntime = {',
  `  enabled: ${enabled},`,
  `  oauthClientId: ${JSON.stringify(oauthClientId)},`,
  '} as const;',
  '',
].join('\n');

await fs.writeFile(output, source, { encoding: 'utf8', mode: 0o600 });
console.log(`Prepared Google Vault runtime config (enabled=${enabled}).`);

function parseBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('SOLSLOT_GOOGLE_VAULT_ENABLED must be exactly true or false.');
}
