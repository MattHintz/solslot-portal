#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const portalDir = resolve(scriptDir, '..');
const workspaceDir = resolve(portalDir, '..');
const apiDir = resolve(workspaceDir, 'solslot-api');
const logsDir = resolve(portalDir, '.dev-stack');
const args = new Set(process.argv.slice(2));

const apiPort = readPort(['SOLSLOT_API_PORT'], 8787);
const portalPort = readPort(['SOLSLOT_PORTAL_PORT'], 4200);
const apiHost = process.env.SOLSLOT_API_HOST || '127.0.0.1';
const portalHost = process.env.SOLSLOT_PORTAL_HOST || '0.0.0.0';
const reuseExisting =
  !args.has('--no-reuse') &&
  process.env.SOLSLOT_STACK_REUSE !== 'false';
const apiUrl = `http://127.0.0.1:${apiPort}`;
const portalUrl = `http://127.0.0.1:${portalPort}`;
const childProcesses = [];
let shuttingDown = false;

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: npm run dev:stack -- [--no-reuse]

Starts the local Solslot stack:
  API    http://127.0.0.1:${apiPort}
  Portal http://127.0.0.1:${portalPort}

Environment overrides:
  SOLSLOT_API_PORT      API port, default 8787
  SOLSLOT_PORTAL_PORT   portal port, default 4200
  SOLSLOT_API_HOST      API bind host, default 127.0.0.1
  SOLSLOT_PORTAL_HOST   portal bind host, default 0.0.0.0
  SOLSLOT_STACK_REUSE   false to fail instead of reusing healthy existing services
`);
  process.exit(0);
}

mkdirSync(logsDir, { recursive: true });

main().catch((error) => {
  console.error(format('stack', error instanceof Error ? error.message : String(error)));
  shutdown(1);
});

async function main() {
  preflight();

  log('stack', `workspace: ${workspaceDir}`);
  log('stack', `api: ${apiUrl}`);
  log('stack', `portal: ${portalUrl}`);
  log('stack', `logs: ${logsDir}`);

  const apiAlreadyHealthy = await apiHealthy();
  const portalAlreadyHealthy = await portalHealthy();

  if (apiAlreadyHealthy && reuseExisting) {
    log('api', `reusing existing API on ${apiUrl}`);
  } else {
    await assertPortAvailable('api', '127.0.0.1', apiPort, apiAlreadyHealthy);
    startApi();
  }

  if (portalAlreadyHealthy && reuseExisting) {
    log('portal', `reusing existing portal on ${portalUrl}`);
  } else {
    await assertPortAvailable('portal', '127.0.0.1', portalPort, portalAlreadyHealthy);
    startPortal();
  }

  await waitFor('api', apiHealthy, 90_000);
  await waitFor('portal', portalHealthy, 120_000);
  await reportBootstrapStatus();

  log('stack', 'ready');
  log('stack', `open ${portalUrl}`);
  log('stack', 'press Ctrl+C to stop services started by this runner');

  process.stdin.resume();
}

function preflight() {
  assertExists(resolve(apiDir, '.env'), 'solslot-api/.env is missing. Copy solslot-api/.env.example to .env and configure the API first.');
  assertExists(resolve(apiDir, '.venv/bin/uvicorn'), 'solslot-api/.venv/bin/uvicorn is missing. Run: cd solslot-api && python3 -m venv .venv && .venv/bin/pip install -e . -e ../solslot-protocol');
  assertExists(resolve(portalDir, 'node_modules/.bin/ng'), 'solslot-portal/node_modules/.bin/ng is missing. Run: cd solslot-portal && npm install');

  const envPath = resolve(apiDir, '.env');
  const mode = statSync(envPath).mode & 0o777;
  if (mode & 0o077) {
    log('api', `warning: solslot-api/.env mode is ${mode.toString(8)}; if it contains secrets, run chmod 600 solslot-api/.env`);
  }
}

function startApi() {
  startProcess('api', resolve(apiDir, '.venv/bin/uvicorn'), [
    'solslot_api.app:app',
    '--host',
    apiHost,
    '--port',
    String(apiPort),
    '--reload',
  ], apiDir, {
    PYTHONUNBUFFERED: '1',
  });
}

function startPortal() {
  startProcess('portal', resolve(portalDir, 'node_modules/.bin/ng'), [
    'serve',
    '--host',
    portalHost,
    '--port',
    String(portalPort),
    '--poll',
    '2000',
  ], portalDir, {
    CHOKIDAR_USEPOLLING: 'true',
    WATCHPACK_POLLING: 'true',
  });
}

function startProcess(name, command, commandArgs, cwd, extraEnv) {
  const logStream = createWriteStream(join(logsDir, `${name}.log`), { flags: 'a' });
  log(name, `$ ${command} ${commandArgs.join(' ')}`);
  const child = spawn(command, commandArgs, {
    cwd,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  childProcesses.push({ name, child });
  pipeLines(name, child.stdout, logStream);
  pipeLines(name, child.stderr, logStream);
  child.on('exit', (code, signal) => {
    logStream.end();
    if (!shuttingDown) {
      log('stack', `${name} exited with ${signal ?? code}`);
      shutdown(code === 0 ? 0 : 1);
    }
  });
}

function pipeLines(name, stream, logStream) {
  const rl = readline.createInterface({ input: stream });
  rl.on('line', (line) => {
    const rendered = format(name, line);
    console.log(rendered);
    logStream.write(`${new Date().toISOString()} ${line}\n`);
  });
}

async function waitFor(name, probe, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probe()) {
      log(name, 'healthy');
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`${name} did not become healthy within ${timeoutMs / 1000}s`);
}

async function apiHealthy() {
  const result = await fetchJson(`${apiUrl}/health`);
  return result.ok;
}

async function portalHealthy() {
  const result = await fetchText(portalUrl);
  return result.ok;
}

async function reportBootstrapStatus() {
  const result = await fetchJson(`${apiUrl}/admin/bootstrap/status`);
  if (!result.ok) {
    log('api', 'bootstrap status unavailable');
    return;
  }
  const body = result.body;
  const locked = body && typeof body === 'object' && 'locked' in body ? body.locked : 'unknown';
  const authenticated = body && typeof body === 'object' && 'authenticated' in body ? body.authenticated : 'unknown';
  log('api', `bootstrap status: locked=${locked} authenticated=${authenticated}`);
}

async function fetchJson(url) {
  try {
    const response = await fetchWithTimeout(url, 5_000);
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

async function fetchText(url) {
  try {
    const response = await fetchWithTimeout(url, 5_000);
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function assertPortAvailable(name, host, port, alreadyHealthy) {
  if (alreadyHealthy) {
    if (reuseExisting) return;
    throw new Error(`${name} is already running on ${host}:${port}. Stop it or rerun without --no-reuse.`);
  }
  if (await tcpListening(host, port)) {
    throw new Error(`${name} port ${host}:${port} is occupied but did not answer its health check. Stop that process or set ${name === 'api' ? 'SOLSLOT_API_PORT' : 'SOLSLOT_PORTAL_PORT'}.`);
  }
}

function tcpListening(host, port) {
  return new Promise((resolveListening) => {
    const socket = net.createConnection({ host, port, timeout: 1_000 });
    socket.on('connect', () => {
      socket.destroy();
      resolveListening(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolveListening(false);
    });
    socket.on('error', () => resolveListening(false));
  });
}

function readPort(keys, fallback) {
  const activeKey = keys.find((key) => process.env[key]);
  const raw = activeKey ? process.env[activeKey] : undefined;
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${activeKey} must be a TCP port number`);
  }
  return parsed;
}

function assertExists(path, message) {
  if (!existsSync(path)) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function log(name, message) {
  console.log(format(name, message));
}

function format(name, message) {
  return `[${new Date().toLocaleTimeString()}] [${name}] ${message}`;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of childProcesses) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (process.platform !== 'win32') {
        process.kill(-child.pid, 'SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
    } catch {}
  }
  setTimeout(() => process.exit(code), childProcesses.length > 0 ? 500 : 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
