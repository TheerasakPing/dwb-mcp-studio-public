import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from '../dist/paths.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const externalRoot = resolve(
  process.env.DWB_EXTERNAL_DIR ||
    (process.platform === 'darwin' ? resolve(dataDir(), 'external') : resolve(appRoot, 'external')),
);
const workerRoot = resolve(externalRoot, 'desktop-commander');
const workerEntry = resolve(
  workerRoot,
  'node_modules',
  '@wonderwhy-er',
  'desktop-commander',
  'dist',
  'index.js',
);
const tunnelRoot = resolve(externalRoot, 'tunnel-client');
const tunnelEntry = resolve(tunnelRoot, 'tunnel-client');

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function physicalPath(value) {
  let current = resolve(value);
  const suffix = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    suffix.unshift(basename(current));
    current = parent;
  }
  try {
    current = realpathSync.native(current);
  } catch {}
  return resolve(current, ...suffix);
}

function inside(root, target) {
  const rel = relative(physicalPath(root), physicalPath(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function assertManagedPath(path) {
  const full = resolve(path);
  if (!inside(externalRoot, full))
    throw new Error('External installation must stay inside this DWB folder.');

  let current = full;
  while (inside(externalRoot, current)) {
    if (await exists(current)) {
      const info = await lstat(current);
      if (info.isSymbolicLink())
        throw new Error('Managed external path ancestors cannot be symbolic links.');
    }
    if (current === externalRoot) break;
    current = dirname(current);
  }
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

async function acquireInstallLock() {
  await mkdir(externalRoot, { recursive: true });
  await assertManagedPath(externalRoot);
  const lockPath = resolve(externalRoot, 'install.lock');

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

  throw new Error('DWB_EXTERNAL_INSTALL_LOCK_TIMEOUT: another installation did not finish.');
}

async function validateWorker(entry = workerEntry) {
  const actualEntry = await realpath(entry);
  const packageRoot = resolve(dirname(actualEntry), '..');
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));

  if (
    packageJson.name !== '@wonderwhy-er/desktop-commander' ||
    packageJson.version !== '0.2.50'
  )
    throw new Error('This DWB version requires Desktop Commander 0.2.50.');

  const expectedEntry = await realpath(resolve(packageRoot, 'dist', 'index.js'));
  if (actualEntry !== expectedEntry)
    throw new Error('Worker entry must be Desktop Commander dist/index.js.');

  if (!inside(workerRoot, actualEntry))
    throw new Error('Desktop Commander resolved outside the managed worker directory.');

  const configPath = await realpath(resolve(packageRoot, 'dist', 'config.js'));
  if (!inside(workerRoot, configPath))
    throw new Error('Desktop Commander config resolved outside the managed worker directory.');

  const source = await readFile(configPath, 'utf8');
  if (
    !source.includes('export const USER_HOME = os.homedir();') &&
    !source.includes('export const USER_HOME = process.env.DWB_DC_CONFIG_HOME || os.homedir();')
  )
    throw new Error(
      'Desktop Commander config layout is incompatible with worker isolation. External installation was not modified.',
    );

  return {
    ready: true,
    version: String(packageJson.version),
    entry: actualEntry,
    config: configPath,
  };
}

async function workerState() {
  try {
    await assertManagedPath(workerRoot);
    return await validateWorker();
  } catch (error) {
    return {
      ready: false,
      version: null,
      entry: workerEntry,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function npmInvocation(args) {
  if (process.env.npm_execpath)
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  const bundledNpm = resolve(appRoot, 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(bundledNpm))
    return { command: process.execPath, args: [bundledNpm, ...args] };
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
  };
}

async function run(command, args, cwd = appRoot) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => process.stderr.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(
            `External installer command failed (${code ?? signal ?? 'unknown'}): ${command}`,
          ),
        );
    });
  });
}

async function runCapture(command, args, cwd = appRoot) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun(stdout.trim());
      else
        rejectRun(
          new Error(
            `External installer command failed (${code ?? signal ?? 'unknown'}): ${command}\n${stderr.trim()}`,
          ),
        );
    });
  });
}

function tunnelAsset() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('The Node tunnel installer currently supports macOS Apple Silicon only.');
  return {
    version: '0.0.11',
    url: 'https://github.com/openai/tunnel-client/releases/download/v0.0.11/tunnel-client-v0.0.11-darwin-arm64.zip',
    sha256: '3685443b057614ff932d2d477dab94be2082e60bcf4e8b4e378bebc89121b714',
  };
}

async function tunnelState() {
  try {
    await assertManagedPath(tunnelRoot);
    const actualEntry = await realpath(tunnelEntry);
    if (!inside(tunnelRoot, actualEntry))
      throw new Error('Tunnel client resolved outside the managed tunnel directory.');
    const version = await runCapture(actualEntry, ['--version']);
    if (!/^0\.0\.11(?:\+|\s|$)/.test(version))
      throw new Error('This DWB version requires tunnel-client 0.0.11.');
    return { ready: true, version, entry: actualEntry };
  } catch (error) {
    return {
      ready: false,
      version: null,
      entry: tunnelEntry,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function safeArchiveEntry(name) {
  if (!name || name.includes('\\') || name.includes(':') || name.startsWith('/')) return false;
  const normalized = name.endsWith('/') ? name.slice(0, -1) : name;
  if (!normalized) return false;
  const parts = normalized.split('/');
  return !parts.some((part) => part === '..' || part === '');
}

async function rejectExtractedLinks(root) {
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      const info = await lstat(child);
      if (info.isSymbolicLink())
        throw new Error('Tunnel archive may not contain symbolic links.');
      if (info.isDirectory()) await walk(child);
    }
  }
  await walk(root);
}

async function findTunnelBinary(root) {
  const matches = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && entry.name === 'tunnel-client') matches.push(child);
    }
  }
  await walk(root);
  if (matches.length !== 1)
    throw new Error(`Expected exactly one tunnel-client binary in archive, found ${matches.length}.`);
  return matches[0];
}

async function installTunnel() {
  const release = await acquireInstallLock();
  let stage = null;
  try {
    const current = await tunnelState();
    if (current.ready) return current;
    if (await exists(tunnelRoot))
      throw new Error(
        'Tunnel installation is incomplete or unsupported. Rename external/tunnel-client to keep a backup, then retry.',
      );

    const asset = tunnelAsset();
    stage = resolve(externalRoot, '.install-tunnel-' + randomUUID().replaceAll('-', ''));
    await assertManagedPath(stage);
    await mkdir(stage, { recursive: false });
    const archive = resolve(stage, 'download.zip');
    const unpacked = resolve(stage, 'package');

    const response = await fetch(asset.url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Tunnel download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== asset.sha256)
      throw new Error('Tunnel download checksum did not match the pinned upstream release.');
    await writeFile(archive, bytes, { flag: 'wx', mode: 0o600 });

    const listing = await runCapture('/usr/bin/unzip', ['-Z1', archive]);
    const entries = listing.split(/\r?\n/).filter(Boolean);
    if (!entries.length || entries.some((name) => !safeArchiveEntry(name)))
      throw new Error('Unexpected path in tunnel archive.');

    await mkdir(unpacked, { recursive: false });
    await run('/usr/bin/unzip', ['-q', archive, '-d', unpacked]);
    await rejectExtractedLinks(unpacked);

    const binary = await findTunnelBinary(unpacked);
    await chmod(binary, 0o755);
    const version = await runCapture(binary, ['--version']);
    if (!/^0\.0\.11(?:\+|\s|$)/.test(version))
      throw new Error('Downloaded tunnel-client did not pass the pinned version check.');

    const packageDir = dirname(binary);
    await assertManagedPath(tunnelRoot);
    if (packageDir === unpacked) {
      await rename(unpacked, tunnelRoot);
    } else {
      await rename(packageDir, tunnelRoot);
      await rm(unpacked, { recursive: true, force: true });
    }
    stage = resolve(stage);
    await rm(stage, { recursive: true, force: true });
    stage = null;

    const installed = await tunnelState();
    if (!installed.ready) throw new Error(installed.message || 'Tunnel validation failed.');
    return { ...installed, installed: true, sha256: asset.sha256 };
  } finally {
    if (
      stage &&
      inside(externalRoot, stage) &&
      /^\.install-tunnel-[a-f0-9]{32}$/.test(stage.split(/[\\/]/).at(-1) || '')
    )
      await rm(stage, { recursive: true, force: true }).catch(() => {});
    await release();
  }
}

async function installWorker() {
  const release = await acquireInstallLock();
  let stage = null;
  try {
    const current = await workerState();
    if (current.ready) return current;

    if (await exists(workerRoot))
      throw new Error(
        'Desktop Commander installation is incomplete or unsupported. Rename external/desktop-commander to keep a backup, then retry.',
      );

    stage = resolve(externalRoot, '.install-worker-' + randomUUID().replaceAll('-', ''));
    await assertManagedPath(stage);
    await mkdir(stage, { recursive: false });

    const npm = npmInvocation([
      'install',
      '--prefix',
      stage,
      '--save-exact',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org',
      '@wonderwhy-er/desktop-commander@0.2.50',
    ]);
    await run(npm.command, npm.args);

    const stagedEntry = resolve(
      stage,
      'node_modules',
      '@wonderwhy-er',
      'desktop-commander',
      'dist',
      'index.js',
    );

    const actualEntry = await realpath(stagedEntry);
    if (!inside(stage, actualEntry))
      throw new Error('Staged Desktop Commander entry escaped the staging directory.');

    const packageRoot = resolve(dirname(actualEntry), '..');
    const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
    if (
      packageJson.name !== '@wonderwhy-er/desktop-commander' ||
      packageJson.version !== '0.2.50'
    )
      throw new Error('Downloaded Desktop Commander did not match the pinned package/version.');

    const configPath = await realpath(resolve(packageRoot, 'dist', 'config.js'));
    if (!inside(stage, configPath))
      throw new Error('Staged Desktop Commander config escaped the staging directory.');

    const configSource = await readFile(configPath, 'utf8');
    if (
      !configSource.includes('export const USER_HOME = os.homedir();') &&
      !configSource.includes(
        'export const USER_HOME = process.env.DWB_DC_CONFIG_HOME || os.homedir();',
      )
    )
      throw new Error('Downloaded Desktop Commander config layout is incompatible.');

    await assertManagedPath(workerRoot);
    await rename(stage, workerRoot);
    stage = null;

    const installed = await validateWorker();
    return { ...installed, installed: true };
  } finally {
    if (stage && inside(externalRoot, stage) && /^\.install-worker-[a-f0-9]{32}$/.test(stage.split(/[\\/]/).at(-1) || ''))
      await rm(stage, { recursive: true, force: true }).catch(() => {});
    await release();
  }
}

async function main() {
  const action = process.argv[2] || 'status';
  if (action === 'status') {
    console.log(JSON.stringify({ worker: await workerState(), tunnel: await tunnelState() }, null, 2));
    return;
  }
  if (action === 'install-worker') {
    console.log(JSON.stringify({ worker: await installWorker() }, null, 2));
    return;
  }
  if (action === 'install-tunnel') {
    console.log(JSON.stringify({ tunnel: await installTunnel() }, null, 2));
    return;
  }
  if (action === 'install') {
    console.log(
      JSON.stringify(
        { worker: await installWorker(), tunnel: await installTunnel() },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(
    'Usage: node scripts/external.mjs [status|install-worker|install-tunnel|install]',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export {
  appRoot,
  externalRoot,
  workerRoot,
  workerEntry,
  workerState,
  installWorker,
  tunnelRoot,
  tunnelEntry,
  tunnelState,
  installTunnel,
};
