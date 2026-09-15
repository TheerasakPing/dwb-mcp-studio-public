import { spawn } from 'node:child_process';
import { mkdtemp, open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const { values } = parseArgs({
  options: { 'tunnel-client': { type: 'string' }, 'install-dir': { type: 'string' } },
});
if (!values['tunnel-client'] || !process.env.DWB_DATA_DIR || !process.env.DWB_CONFIG_FILE)
  throw new Error('Provide --tunnel-client and isolated DWB_DATA_DIR/DWB_CONFIG_FILE.');
const install = resolve(values['install-dir'] ?? fileURLToPath(new URL('../', import.meta.url)));
const test = await mkdtemp(resolve(process.env.DWB_DATA_DIR, 'tunnel-acceptance-'));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata|programfiles|programfiles\(x86\))$/i.test(
      name,
    ),
  ),
);
Object.assign(env, {
  DWB_DATA_DIR: process.env.DWB_DATA_DIR,
  DWB_CONFIG_FILE: process.env.DWB_CONFIG_FILE,
});
// tunnel-client parses this string as shell-style arguments: forward slashes
// prevent Windows backslashes being consumed as escape characters.
const quote = (path) => '"' + path.replaceAll('\\', '/') + '"';
const command = `${quote(process.execPath)} ${quote(resolve(install, 'scripts/tunnel-mcp.mjs'))}`;
const urlFile = resolve(test, 'url.json');
const logFile = resolve(test, 'tunnel.log');
const log = await open(logFile, 'w');
const child = spawn(
  values['tunnel-client'],
  [
    'dev',
    'proxy',
    '--backend',
    'go',
    '--listen',
    '127.0.0.1:0',
    '--mcp-command',
    command,
    '--url-file',
    urlFile,
    '--readiness-timeout',
    '30s',
    '--duration',
    '150s',
  ],
  { env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] },
);
let launchError;
child.on('error', (error) => {
  launchError = error;
});
const closed = new Promise((done) => child.on('close', done));
try {
  let connection;
  for (let i = 0; i < 160; i++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error('Test tunnel exited before readiness');
    try {
      connection = JSON.parse(await readFile(urlFile, 'utf8'));
      break;
    } catch {}
    await delay(250);
  }
  if (!connection?.mcp_url) throw new Error('Test tunnel did not become ready');
  const runner = spawn(
    process.execPath,
    [resolve(install, 'scripts/acceptance-test.mjs'), '--url', connection.mcp_url],
    { env, windowsHide: true, stdio: 'inherit', timeout: 120000 },
  );
  const code = await new Promise((done, reject) => {
    runner.on('error', reject);
    runner.on('exit', done);
  });
  if (code !== 0) throw new Error(`Tunnel acceptance failed (${code}); log: ${logFile}`);
  console.log(
    'TUNNEL_ACCEPTANCE_PASS: loopback-only external tunnel-client, no hosted account or live profile used',
  );
} catch (error) {
  console.error((await readFile(logFile, 'utf8')).slice(-2500));
  throw error;
} finally {
  child.kill();
  await Promise.race([closed, delay(2000)]);
  await log.close();
}
