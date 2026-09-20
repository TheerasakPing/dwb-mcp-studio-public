import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizedTunnelEnv, shellQuote } from './tunnel-runtime-posix.mjs';

test('POSIX tunnel command quoting handles spaces and single quotes', () => {
  assert.equal(shellQuote('/Applications/DWB MCP Studio/node'), "'/Applications/DWB MCP Studio/node'");
  assert.equal(shellQuote("a'b"), "'a'\"'\"'b'");
  assert.throws(() => shellQuote('bad\npath'), /NUL or newlines/);
});

test('tunnel environment removes inherited runtime and secret-bearing namespaces', () => {
  assert.deepEqual(
    sanitizedTunnelEnv({
      PATH: '/usr/bin',
      HOME: '/Users/test',
      OPENAI_API_KEY: 'secret',
      CONTROL_PLANE_API_KEY: 'secret',
      DWB_DATA_DIR: '/tmp/data',
      MCP_TOKEN: 'secret',
      LOG_LEVEL: 'debug',
    }),
    {
      PATH: '/usr/bin',
      HOME: '/Users/test',
    },
  );
});
