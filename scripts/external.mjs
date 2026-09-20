import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const externalRoot = resolve(appRoot, 'external');
const workerRoot = resolve(externalRoot, 'desktop-commander');
const workerEntry = resolve(
  workerRoot,
  'node_modules',
  '@wonderwhy-er',
  'desktop-commander',
  'dist',
  'index.js',
);

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function inside(root, target) {
  const rel = relative(resolve(root), resolve(target));
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
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
  };
}

async function run(command, args, cwd = appRoot) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    });
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
    console.log(JSON.stringify({ worker: await workerState() }, null, 2));
    return;
  }
  if (action === 'install-worker') {
    console.log(JSON.stringify({ worker: await installWorker() }, null, 2));
    return;
  }
  throw new Error('Usage: node scripts/external.mjs [status|install-worker]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { appRoot, externalRoot, workerRoot, workerEntry, workerState, installWorker };
