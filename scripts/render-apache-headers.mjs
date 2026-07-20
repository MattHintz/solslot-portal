#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2));
const source = await fs.readFile(path.join(root, 'public/_headers'), 'utf8');
const headers = parseRootHeaders(source);

const lines = [
  'Options -Indexes',
  'RewriteEngine On',
  `RewriteBase ${options.baseHref}`,
  'RewriteCond %{REQUEST_FILENAME} !-f',
  'RewriteCond %{REQUEST_FILENAME} !-d',
  'RewriteRule ^ index.html [L]',
  ...Object.entries(headers).map(([name, value]) => `Header always set ${name} "${escapeApache(value)}"`),
  '',
];
await fs.writeFile(path.resolve(options.output), lines.join('\n'), 'utf8');

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) values.set(args[index], args[index + 1]);
  const output = values.get('--output');
  const baseHref = values.get('--base-href') || '/';
  if (!output || !baseHref.startsWith('/') || !baseHref.endsWith('/')) {
    throw new Error('Usage: render-apache-headers.mjs --output <file> --base-href </path/>');
  }
  return { output, baseHref };
}

function parseRootHeaders(text) {
  const headers = {};
  let inRoot = false;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      inRoot = raw.trim() === '/*';
      continue;
    }
    if (!inRoot || !raw.includes(':')) continue;
    const [name, ...rest] = raw.trim().split(':');
    headers[name] = rest.join(':').trim();
  }
  if (!headers['Content-Security-Policy']) throw new Error('public/_headers must define a root CSP.');
  return headers;
}

function escapeApache(value) {
  return value.replaceAll('"', '\\"');
}
