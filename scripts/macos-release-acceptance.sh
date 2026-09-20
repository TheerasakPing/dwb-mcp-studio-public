#!/bin/bash
# End-to-end acceptance for the published macOS arm64 release.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Acceptance requires a native macOS arm64 runner." >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
REPO="${GITHUB_REPOSITORY:-TheerasakPing/dwb-mcp-studio-public}"
TMP="$(mktemp -d)"
MOUNT="$TMP/mount"
INSTALLED="$TMP/Applications"
DATA="$TMP/Library/Application Support/DWB-MCP-Studio"
WORKSPACE="$TMP/workspace"
ATTACHED=0

cleanup() {
  if [[ "$ATTACHED" == "1" ]]; then
    hdiutil detach "$MOUNT" -quiet || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$TMP/release" "$MOUNT" "$INSTALLED" "$DATA" "$WORKSPACE"

echo "==> Download published release $TAG"
gh release download "$TAG"   --repo "$REPO"   --pattern '*.dmg'   --pattern '*.zip'   --pattern 'SHA256SUMS.txt'   --dir "$TMP/release"

echo "==> Verify published checksums"
(
  cd "$TMP/release"
  shasum -a 256 -c SHA256SUMS.txt
)

DMG="$(find "$TMP/release" -maxdepth 1 -name '*.dmg' -print -quit)"
test -n "$DMG"

echo "==> Mount DMG and copy app like a user installation"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG" >/dev/null
ATTACHED=1
SOURCE_APP="$MOUNT/DWB MCP Studio.app"
test -d "$SOURCE_APP"
ditto "$SOURCE_APP" "$INSTALLED/DWB MCP Studio.app"
hdiutil detach "$MOUNT" -quiet
ATTACHED=0

APP="$INSTALLED/DWB MCP Studio.app"
EXEC="$APP/Contents/MacOS/DWB MCP Studio"
RUNTIME="$APP/Contents/Resources/runtime"
NODE="$RUNTIME/node/bin/node"

echo "==> Validate application bundle"
test -x "$EXEC"
test -x "$NODE"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" = "com.devwithbebz.dwb-mcp-studio"
test "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP/Contents/Info.plist")" = "13.0"
file "$EXEC" | grep -q 'arm64'
file "$NODE" | grep -q 'arm64'
codesign --verify --deep --strict --verbose=2 "$APP"
"$NODE" --version | grep -q '^v22\.16\.0$'
test -f "$RUNTIME/dist/index.js"
test -f "$RUNTIME/scripts/start.mjs"

echo "==> Launch packaged SwiftUI app"
"$EXEC" >"$TMP/gui.log" 2>&1 &
GUI_PID=$!
sleep 3
if ! kill -0 "$GUI_PID" 2>/dev/null; then
  cat "$TMP/gui.log" >&2 || true
  echo "Packaged SwiftUI app exited during launch smoke test." >&2
  exit 1
fi
kill "$GUI_PID" 2>/dev/null || true
wait "$GUI_PID" 2>/dev/null || true

echo "==> Install real managed Desktop Commander and OpenAI tunnel-client from packaged runtime"
export DWB_DATA_DIR="$DATA"
cd "$RUNTIME"
"$NODE" scripts/external.mjs install > "$TMP/install.json"
cat "$TMP/install.json"
WORKER_ENTRY="$("$NODE" -e "const x=require('fs').readFileSync(process.argv[1],'utf8'); const j=JSON.parse(x); if(!j.worker?.ready||!j.tunnel?.ready) process.exit(2); process.stdout.write(j.worker.entry);" "$TMP/install.json")"
test -f "$WORKER_ENTRY"

"$NODE" scripts/external.mjs status > "$TMP/external-status.json"
"$NODE" -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
if(!j.worker?.ready) throw new Error('Desktop Commander is not ready');
if(j.worker.version!=='0.2.50') throw new Error('Unexpected Desktop Commander version: '+j.worker.version);
if(!j.tunnel?.ready) throw new Error('tunnel-client is not ready');
if(!String(j.tunnel.version).startsWith('0.0.11')) throw new Error('Unexpected tunnel-client version: '+j.tunnel.version);
" "$TMP/external-status.json"

echo "==> Configure clean workspace and run Doctor from packaged runtime"
"$NODE" scripts/configure.mjs   --worker-entry "$WORKER_ENTRY"   --workspace "$WORKSPACE"   --worker-cap 2
"$NODE" scripts/doctor.mjs > "$TMP/doctor.json"
cat "$TMP/doctor.json"
"$NODE" -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
if(!j.ok) throw new Error('Doctor did not report ok');
if(j.platform!=='darwin') throw new Error('Doctor platform mismatch');
if(j.arch!=='arm64') throw new Error('Doctor architecture mismatch');
if(j.workerCap!==2) throw new Error('Worker cap mismatch');
" "$TMP/doctor.json"

echo "==> Exercise packaged MCP core against real Desktop Commander"
cat > "$RUNTIME/.acceptance-smoke.mjs" <<'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

const root = process.cwd();
const data = process.env.DWB_DATA_DIR;
const configFile = resolve(data, 'config.json');
const brokerPipe = resolve(data, 'acceptance-broker.sock');

const env = {
  ...process.env,
  DWB_DATA_DIR: data,
  DWB_CONFIG_FILE: configFile,
  DWB_BROKER_PIPE: brokerPipe,
  DWB_BROKER_ALLOW_SHUTDOWN: 'true',
  DWB_RUNTIME_DIR: resolve(data, 'runtime'),
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(root, 'scripts', 'start.mjs')],
  cwd: root,
  env,
  stderr: 'pipe',
});
transport.stderr?.on('data', (chunk) => process.stderr.write(String(chunk)));
const client = new Client({ name: 'dwb-release-acceptance', version: '1.0.0' });

try {
  await client.connect(transport);
  const tools = await client.listTools(undefined, { timeout: 20_000 });
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const required of ['dwb_bridge_status', 'get_config', 'read_file', 'write_file']) {
    if (!names.has(required)) throw new Error('Missing expected tool: ' + required);
  }

  const first = await client.callTool({ name: 'dwb_bridge_status', arguments: {} });
  const firstStatus = first.structuredContent;
  if (!firstStatus?.ready || firstStatus.desktopCommanderVersion !== '0.2.50')
    throw new Error('Bridge/worker not ready: ' + JSON.stringify(firstStatus));

  const getConfig = await client.callTool({ name: 'get_config', arguments: {} });
  if (getConfig.isError) throw new Error('Desktop Commander get_config failed');

  const probePath = resolve(process.env.DWB_ACCEPTANCE_WORKSPACE, 'acceptance.txt');
  const write = await client.callTool({
    name: 'write_file',
    arguments: { path: probePath, content: 'DWB macOS release acceptance\n', mode: 'rewrite' },
  });
  if (write.isError) throw new Error('write_file failed');

  const read = await client.callTool({
    name: 'read_file',
    arguments: { path: probePath },
  });
  if (read.isError || !JSON.stringify(read).includes('DWB macOS release acceptance'))
    throw new Error('read_file did not return written content');

  process.kill(firstStatus.workerPid);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));

  const toolsAfterCrash = await client.listTools(undefined, { timeout: 20_000 });
  if (!toolsAfterCrash.tools.some((tool) => tool.name === 'get_config'))
    throw new Error('Desktop Commander tools missing after worker recovery');

  const second = await client.callTool({ name: 'dwb_bridge_status', arguments: {} });
  const secondStatus = second.structuredContent;
  if (!secondStatus?.ready) throw new Error('Bridge not ready after worker recovery');
  if (secondStatus.workerPid === firstStatus.workerPid)
    throw new Error('Worker PID did not change after forced crash');
  if (secondStatus.restartCount <= firstStatus.restartCount)
    throw new Error('Restart counter did not increase');

  console.log('PACKAGED_MCP_SMOKE_PASS', JSON.stringify({
    toolCount: toolsAfterCrash.tools.length,
    firstPid: firstStatus.workerPid,
    secondPid: secondStatus.workerPid,
    restartCount: secondStatus.restartCount,
  }));

  try { process.kill(secondStatus.broker?.brokerPid); } catch {}
} finally {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
}
EOF
DWB_ACCEPTANCE_WORKSPACE="$WORKSPACE" "$NODE" .acceptance-smoke.mjs
rm -f "$RUNTIME/.acceptance-smoke.mjs"

echo "==> Exercise POSIX tunnel Start / Ready / Stop lifecycle with controlled local tunnel"
REAL_TUNNEL="$DATA/external/tunnel-client/tunnel-client"
BACKUP_TUNNEL="$DATA/external/tunnel-client/tunnel-client.real"
mv "$REAL_TUNNEL" "$BACKUP_TUNNEL"
cat > "$REAL_TUNNEL" <<'PY'
#!/usr/bin/env python3
import http.server
import json
import signal
import socketserver
import sys

if "--version" in sys.argv:
    print("0.0.11")
    raise SystemExit(0)

if len(sys.argv) < 4 or sys.argv[1] != "run" or sys.argv[2] != "--config":
    raise SystemExit(2)

with open(sys.argv[3], "r", encoding="utf-8") as handle:
    config = json.load(handle)

health_file = config["health"]["url_file"]

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/readyz":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ready")
        elif self.path == "/healthz":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, format, *args):
        pass

server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
with open(health_file, "w", encoding="utf-8") as handle:
    handle.write(f"http://127.0.0.1:{server.server_address[1]}\n")

def stop(*_):
    server.shutdown()

signal.signal(signal.SIGTERM, stop)
server.serve_forever()
PY
chmod 755 "$REAL_TUNNEL"

export DWB_TUNNEL_RUNTIME_KEY='acceptance-secret-never-write-plaintext'
"$NODE" scripts/tunnel-runtime-posix.mjs start   --tunnel-id tunnel_0123456789abcdef0123456789abcdef > "$TMP/tunnel-start.json"
unset DWB_TUNNEL_RUNTIME_KEY
sleep 1
"$NODE" scripts/tunnel-runtime-posix.mjs status > "$TMP/tunnel-status.json"
cat "$TMP/tunnel-status.json"
PROFILE="$("$NODE" -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(j.profileFile);" "$TMP/tunnel-start.json")"
grep -q 'env:DWB_TUNNEL_RUNTIME_KEY' "$PROFILE"
if grep -q 'acceptance-secret-never-write-plaintext' "$PROFILE"; then
  echo "Plaintext tunnel secret leaked into generated profile." >&2
  exit 1
fi
"$NODE" -e "
const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
if(j.state!=='ready'||j.ready!==true) throw new Error('Tunnel did not become ready');
" "$TMP/tunnel-status.json"
"$NODE" scripts/tunnel-runtime-posix.mjs stop > "$TMP/tunnel-stop.json"
"$NODE" scripts/tunnel-runtime-posix.mjs status > "$TMP/tunnel-final.json"
"$NODE" -e "
const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
if(j.state!=='stopped'||j.ready!==false) throw new Error('Tunnel did not stop cleanly');
" "$TMP/tunnel-final.json"
mv "$BACKUP_TUNNEL" "$REAL_TUNNEL"

echo "MACOS_RELEASE_ACCEPTANCE_PASS version=$VERSION"
