import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from '../dist/paths.js';
import { appRoot, tunnelState, workerState } from './external.mjs';

const tunnelDirectory = resolve(dataDir(), 'tunnel');
const stateFile = resolve(tunnelDirectory, 'process.json');
const runtimeKeyName = 'DWB_TUNNEL_RUNTIME_KEY';

function ensurePosix() {
  if (process.platform === 'win32')
    throw new Error('Use the Windows tunnel runtime on Windows.');
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function shellQuote(value) {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value))
    throw new Error('Command paths cannot contain NUL or newlines.');
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function sanitizedTunnelEnv(source = process.env) {
  const env = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue;
    if (
      /^(CONTROL_PLANE_|TUNNEL_CLIENT_|MCP_|HARPOON_|HEALTH_|ADMIN_UI_|CLOUDFLARED_|LOG_|DWB_)/.test(
        name,
      ) ||
      ['OPENAI_API_KEY', 'OPEN_WEB_UI', 'ALLOW_REMOTE_UI'].includes(name)
    )
      continue;
    env[name] = value;
  }
  return env;
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readState() {
  try {
    return await json(stateFile);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function psInfo(pid) {
  return new Promise((resolveInfo) => {
    const child = spawn('/bin/ps', ['-p', String(pid), '-o', 'pid=', '-o', 'pgid=', '-o', 'command='], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', () => resolveInfo(null));
    child.once('exit', (code) => {
      if (code !== 0) return resolveInfo(null);
      const line = output.trim();
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return resolveInfo(null);
      resolveInfo({ pid: Number(match[1]), pgid: Number(match[2]), command: match[3] });
    });
  });
}

async function verifiedProcess(state) {
  if (
    !state ||
    !Number.isInteger(state.pid) ||
    !Number.isInteger(state.pgid) ||
    typeof state.executable !== 'string' ||
    typeof state.profileFile !== 'string'
  )
    return null;
  if (!processAlive(state.pid)) return null;
  const info = await psInfo(state.pid);
  if (!info || info.pid !== state.pid || info.pgid !== state.pgid || info.pgid !== state.pid)
    return null;
  if (!info.command.includes(state.executable) || !info.command.includes(state.profileFile))
    return null;
  return info;
}

async function acquireStartLock() {
  await mkdir(tunnelDirectory, { recursive: true, mode: 0o700 });
  const lockPath = resolve(tunnelDirectory, 'start.lock');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(String(process.pid) + '\n');
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await handle.close().catch(() => {});
        await unlink(lockPath).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        stale = !processAlive(Number((await readFile(lockPath, 'utf8')).trim()));
      } catch (readError) {
        if (readError?.code === 'ENOENT') continue;
        stale = true;
      }
      if (stale) {
        await unlink(lockPath).catch((unlinkError) => {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        });
        continue;
      }
      await new Promise((done) => setTimeout(done, 50));
    }
  }
  throw new Error('DWB_TUNNEL_START_LOCK_TIMEOUT: another tunnel operation did not finish.');
}

async function probeReady(state) {
  try {
    const raw = (await readFile(state.healthFile, 'utf8')).trim();
    const base = new URL(raw);
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1')
      throw new Error('Unexpected tunnel health URL.');
    const ready = new URL('/readyz', base);
    const response = await fetch(ready, { signal: AbortSignal.timeout(1000) });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function status() {
  ensurePosix();
  const state = await readState();
  const processInfo = await verifiedProcess(state);
  if (!processInfo) return { state: 'stopped', ready: false };
  const ready = await probeReady(state);
  return {
    state: ready ? 'ready' : 'starting',
    ready,
    pid: state.pid,
    pgid: state.pgid,
    tunnelId: state.tunnelId,
    startedAt: state.startedAt,
  };
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return !processAlive(pid);
}

async function stop() {
  ensurePosix();
  const release = await acquireStartLock();
  try {
    const state = await readState();
    const processInfo = await verifiedProcess(state);
    if (!processInfo) {
      await unlink(stateFile).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      return { stopped: false, reason: 'not-running' };
    }

    process.kill(-state.pgid, 'SIGTERM');
    let exited = await waitForExit(state.pid, 3000);
    if (!exited) {
      const stillOwned = await verifiedProcess(state);
      if (!stillOwned)
        throw new Error('Tunnel process identity changed while waiting for shutdown.');
      process.kill(-state.pgid, 'SIGKILL');
      exited = await waitForExit(state.pid, 2000);
    }
    if (!exited) throw new Error('Could not stop the DWB tunnel process group.');

    await unlink(stateFile).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await rm(state.profileFile, { force: true }).catch(() => {});
    await rm(state.healthFile, { force: true }).catch(() => {});
    return { stopped: true };
  } finally {
    await release();
  }
}

async function start(tunnelId) {
  ensurePosix();
  if (!/^tunnel_[A-Za-z0-9_-]+$/.test(tunnelId || ''))
    throw new Error('Tunnel ID must start with tunnel_ and contain no spaces.');

  const apiKey = String(process.env[runtimeKeyName] || '').trim();
  if (!apiKey || /[\r\n]/.test(apiKey))
    throw new Error(`Set ${runtimeKeyName} to the runtime API key before starting MCP.`);

  const release = await acquireStartLock();
  try {
    const existing = await readState();
    if (await verifiedProcess(existing))
      throw new Error('MCP is already running. Stop it before changing the connection.');

    const tunnel = await tunnelState();
    if (!tunnel.ready) throw new Error(tunnel.message || 'Managed tunnel-client is not ready.');
    const worker = await workerState();
    if (!worker.ready) throw new Error(worker.message || 'Managed Desktop Commander is not ready.');

    const configFile = resolve(
      process.env.DWB_CONFIG_FILE || resolve(dataDir(), 'config.json'),
    );
    const config = await json(configFile);
    const configuredWorker = await realpath(config.workerEntry);
    const managedWorker = await realpath(worker.entry);
    if (configuredWorker !== managedWorker)
      throw new Error('Run Setup so DWB uses its managed Desktop Commander before starting MCP.');

    const tunnelMcp = fileURLToPath(new URL('tunnel-mcp.mjs', import.meta.url));
    const command = [process.execPath, tunnelMcp].map(shellQuote).join(' ');
    const runId = randomUUID().replaceAll('-', '');
    const profileFile = resolve(tunnelDirectory, runId + '.profile.json');
    const healthFile = resolve(tunnelDirectory, runId + '.health');
    const logFile = resolve(tunnelDirectory, runId + '.log');

    const profile = {
      config_version: 1,
      control_plane: {
        base_url: 'https://api.openai.com',
        tunnel_id: tunnelId,
        api_key: `env:${runtimeKeyName}`,
      },
      health: { listen_addr: '127.0.0.1:0', url_file: healthFile },
      admin_ui: { open_browser: false },
      log: { level: 'info', format: 'json', file: logFile },
      mcp: { commands: [{ channel: 'main', command }] },
    };
    await writeFile(profileFile, JSON.stringify(profile, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });

    const env = {
      ...sanitizedTunnelEnv(),
      [runtimeKeyName]: apiKey,
      DWB_DATA_DIR: dataDir(),
      DWB_CONFIG_FILE: configFile,
    };
    const child = spawn(tunnel.entry, ['run', '--config', profileFile], {
      cwd: appRoot,
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn);
      child.once('error', rejectSpawn);
    });
    child.unref();

    const state = {
      pid: child.pid,
      pgid: child.pid,
      executable: tunnel.entry,
      executableName: basename(tunnel.entry),
      tunnelId,
      profileFile,
      healthFile,
      logFile,
      runId,
      startedAt: new Date().toISOString(),
    };
    await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n', {
      mode: 0o600,
    });

    const identity = await verifiedProcess(state);
    if (!identity) {
      try {
        process.kill(-state.pgid, 'SIGKILL');
      } catch {}
      await unlink(stateFile).catch(() => {});
      throw new Error('tunnel-client started but process ownership could not be verified.');
    }

    return { started: true, pid: state.pid, tunnelId, profileFile, healthFile, logFile };
  } finally {
    process.env[runtimeKeyName] = '';
    await release();
  }
}

function parseArgs(argv) {
  const action = argv[2] || 'status';
  const tunnelIndex = argv.indexOf('--tunnel-id');
  return {
    action,
    tunnelId: tunnelIndex >= 0 ? argv[tunnelIndex + 1] : undefined,
  };
}

async function main() {
  const { action, tunnelId } = parseArgs(process.argv);
  if (action === 'status') console.log(JSON.stringify(await status(), null, 2));
  else if (action === 'start') console.log(JSON.stringify(await start(tunnelId), null, 2));
  else if (action === 'stop') console.log(JSON.stringify(await stop(), null, 2));
  else throw new Error('Usage: node scripts/tunnel-runtime-posix.mjs [status|start --tunnel-id ID|stop]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export {
  shellQuote,
  sanitizedTunnelEnv,
  psInfo,
  verifiedProcess,
  status,
  start,
  stop,
};
