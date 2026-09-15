import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectBroker, recentEvents, redact } from './dashboard-probe.mjs';

const root = await mkdtemp(fileURLToPath(new URL('../logs/dashboard-test-', import.meta.url)));
const log = resolve(root, 'events.jsonl');
await writeFile(
  log,
  [
    JSON.stringify({ ts: '2026-01-01T00:00:00Z', type: 'worker_heartbeat' }),
    JSON.stringify({
      ts: '2026-01-01T00:00:01Z',
      type: 'worker_start_failed',
      details: { error: 'Authorization: Bearer secret-123 api_key="hidden-value" sk-test-value' },
    }),
    '{partial',
  ].join('\n'),
);
const events = await recentEvents(log);
assert.equal(events.length, 1);
assert.equal(events[0].status, 'error');
assert.doesNotMatch(events[0].detail, /secret-123|hidden-value|sk-test-value/);
assert.doesNotMatch(redact('{"api_key":"hidden","token":"token-value"}'), /hidden|token-value/);
const server = createServer((socket) => {
  socket.once('data', (chunk) => {
    const request = JSON.parse(chunk.toString());
    assert.equal(request.method, 'inspect');
    socket.end(
      JSON.stringify({
        id: request.id,
        ok: false,
        error: { message: 'hello must be sent before broker requests' },
      }) + '\n',
    );
  });
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
try {
  const endpoint = { host: '127.0.0.1', port: server.address().port };
  assert.equal((await inspectBroker(endpoint)).state, 'upgrade-required');
  await new Promise((done) => server.close(done));
  assert.equal((await inspectBroker(endpoint)).state, 'stopped');
} finally {
  if (server.listening) server.close();
}
console.log('DASHBOARD_TEST_PASS: redacted errors, partial logs, old broker, disconnected broker');
