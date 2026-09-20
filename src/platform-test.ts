import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { defaultDataDir, defaultShell, pathIdentity, samePath } from './platform.js';

test('platform defaults preserve Windows and add native macOS locations', () => {
  const home = resolve('fixture-home');
  assert.equal(
    defaultDataDir('win32', { LOCALAPPDATA: resolve(home, 'Local') }, home),
    resolve(home, 'Local', 'DWB-MCP-Studio'),
  );
  assert.equal(
    defaultDataDir('darwin', {}, home),
    resolve(home, 'Library', 'Application Support', 'DWB-MCP-Studio'),
  );
  assert.equal(
    defaultDataDir('linux', { XDG_DATA_HOME: resolve(home, 'xdg') }, home),
    resolve(home, 'xdg', 'DWB-MCP-Studio'),
  );
  assert.equal(defaultShell('win32'), 'powershell.exe');
  assert.equal(defaultShell('darwin'), '/bin/zsh');
  assert.equal(defaultShell('linux', { SHELL: '/bin/fish' }), '/bin/fish');
});

test('path identity is case-folded only for Windows', () => {
  const mixed = resolve('CaseSensitivePath', 'Child');
  assert.equal(pathIdentity(mixed, 'win32'), pathIdentity(mixed, 'win32').toLowerCase());
  assert.equal(pathIdentity(mixed, 'darwin'), resolve(mixed));
  assert.equal(samePath(mixed, mixed.toUpperCase(), 'win32'), true);
  if (resolve(mixed) !== resolve(mixed.toUpperCase()))
    assert.equal(samePath(mixed, mixed.toUpperCase(), 'darwin'), false);
});
