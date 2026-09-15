// Rebuilds dist/ only when src/ or tsconfig.json changed since the last build,
// so the pre* test hooks stay correct when a suite runs standalone without
// recompiling once per suite during `npm test`.
//
// A stamp file is used rather than comparing dist/ mtimes because `incremental`
// tsc leaves unchanged output files untouched.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(projectRoot, 'src');
const distDir = resolve(projectRoot, 'dist');
const stampPath = resolve(distDir, '.build-stamp');
const tscBin = resolve(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

function newestInput() {
  return Math.max(newestMtime(srcDir), statSync(resolve(projectRoot, 'tsconfig.json')).mtimeMs);
}

function upToDate(inputMtime) {
  try {
    // Entry point must exist: a wiped dist/ with a stale stamp is not up to date.
    statSync(resolve(distDir, 'index.js'));
    return Number(readFileSync(stampPath, 'utf8')) === inputMtime;
  } catch {
    return false;
  }
}

const inputMtime = newestInput();
if (upToDate(inputMtime)) {
  console.log('[ensure-build] dist is up to date; skipping tsc');
} else {
  execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.json'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  mkdirSync(distDir, { recursive: true });
  writeFileSync(stampPath, String(inputMtime), 'utf8');
}
