import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const runtimeIdentity = Object.freeze({
  version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    .version as string,
  appRoot: fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, ''),
  startedAt: new Date().toISOString(),
});
