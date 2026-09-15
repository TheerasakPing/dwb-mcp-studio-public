import { createServer, type Socket } from 'node:net';
import { unlink } from 'node:fs/promises';
import {
  brokerEndpoint,
  BROKER_PROTOCOL_VERSION,
  type BrokerLogicalContext,
  type BrokerRequest,
  type BrokerResponse,
} from './broker-protocol.js';
import { brokerTools, textResult, NOT_A_CONTROL_TOOL } from './broker-tools.js';
import { EventLog } from './event-log.js';
import { SessionRegistry } from './session-registry.js';
import { CoreStore } from './core-store.js';
import { WorkspaceStore } from './workspace-store.js';

const endpoint = brokerEndpoint();
const log = new EventLog();
const coreDb = new CoreStore();
const workspaceStore = new WorkspaceStore(coreDb);
const registry = new SessionRegistry(log, workspaceStore);
const sockets = new Set<Socket>();
let markReady!: () => void;
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

type ConnectionContext = {
  sessionId: string | null;
  adapterPid: number | null;
  initializing: boolean;
  closed: boolean;
  routingChange: Promise<void> | null;
};

function response(socket: Socket, message: BrokerResponse): void {
  if (!socket.destroyed) socket.write(JSON.stringify(message) + '\n');
}

function errorResponse(id: string, error: unknown): BrokerResponse {
  const err = error instanceof Error ? error : new Error(String(error));
  return { id, ok: false, error: { code: err.name || 'BROKER_ERROR', message: err.message } };
}

function callParams(message: BrokerRequest) {
  const params = message.params ?? {};
  if (typeof params.name !== 'string') throw new Error('call_tool requires a tool name');
  return { name: params.name, arguments: (params.arguments ?? {}) as Record<string, unknown> };
}

function requestContext(message: BrokerRequest): BrokerLogicalContext | null {
  const raw = message.params?.context;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.key !== 'string' || !value.key.trim()) return null;
  return {
    key: value.key.trim(),
    source: typeof value.source === 'string' ? value.source : 'unknown',
    preview: typeof value.preview === 'string' ? value.preview : undefined,
    metaKeys: Array.isArray(value.metaKeys)
      ? value.metaKeys.filter((x): x is string => typeof x === 'string').slice(0, 40)
      : undefined,
  };
}

async function controlTool(
  ctx: ConnectionContext,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
  requestId?: string,
): Promise<unknown | typeof NOT_A_CONTROL_TOOL> {
  if (!ctx.sessionId) throw new Error('MCP session is not initialized');
  if (name === 'dwb_bridge_status') {
    const session = registry.sessionStatus(sessionId) as any;
    const worker = session.workerStatus ?? {};
    const logicalWorkspace = workspaceStore.current(sessionId);
    return textResult({
      ...worker,
      ...session,
      logicalWorkspace,
      broker: registry.status,
      session: { ...session, logicalWorkspace },
    });
  }
  if (name === 'dwb_broker_status') return textResult(registry.status);
  if (name === 'dwb_session_status') {
    return textResult({
      ...registry.sessionStatus(sessionId),
      logicalWorkspace: workspaceStore.current(sessionId),
    });
  }
  if (name === 'dwb_restart_worker') return textResult(await registry.restartWorker(sessionId));
  if (name === 'dwb_list_sessions')
    return textResult({
      sessions: registry.listSessions().map((session: any) => ({
        ...session,
        logicalWorkspace: workspaceStore.current(String(session.sessionId)),
      })),
    });
  if (name === 'dwb_list_detached_sessions') {
    return textResult({
      sessions: registry.listDetached().map((session: any) => ({
        ...session,
        logicalWorkspace: workspaceStore.current(String(session.sessionId)),
      })),
    });
  }
  if (name === 'workspace') return textResult(await registry.workspace(sessionId, args));
  if (name === 'dwb_resume_session') {
    const target = args.session_id;
    if (typeof target !== 'string' || !target) throw new Error('session_id is required');
    let resumedId: string;
    ctx.routingChange = registry.resume(sessionId, target, ctx.adapterPid).then(async (id) => {
      resumedId = id;
      if (sessionId === ctx.sessionId) ctx.sessionId = id;
      if (ctx.closed && ctx.sessionId) await registry.detach(ctx.sessionId);
    });
    try {
      await ctx.routingChange;
      return textResult({ resumed: true, session: registry.sessionStatus(resumedId!) });
    } finally {
      ctx.routingChange = null;
    }
  }
  return NOT_A_CONTROL_TOOL;
}

async function handle(ctx: ConnectionContext, message: BrokerRequest): Promise<unknown> {
  await ready;
  await ctx.routingChange?.catch(() => {});
  if (ctx.closed || shuttingDown) throw new Error('Broker connection is closing');
  if (message.method === 'hello') {
    if (ctx.sessionId || ctx.initializing) throw new Error('Connection already initialized');
    ctx.initializing = true;
    const cwd = typeof message.params?.cwd === 'string' ? message.params.cwd : process.cwd();
    const adapterPid =
      typeof message.params?.adapterPid === 'number' ? message.params.adapterPid : null;
    const preferredSessionId =
      typeof message.params?.sessionId === 'string' ? message.params.sessionId : null;
    ctx.adapterPid = adapterPid;
    try {
      ctx.sessionId = await registry.attach(cwd, adapterPid, preferredSessionId);
      if (ctx.closed) await registry.detach(ctx.sessionId);
    } finally {
      ctx.initializing = false;
    }
    return {
      protocolVersion: BROKER_PROTOCOL_VERSION,
      sessionId: ctx.sessionId,
      broker: registry.status,
    };
  }
  if (message.method === 'ping') return { pong: true, broker: registry.status };
  // Local monitoring must not attach a session, allocate a worker or refresh activity.
  if (message.method === 'inspect') {
    const sessions = registry.listSessions();
    return {
      broker: registry.status,
      totalSessions: sessions.length,
      sessions: sessions.slice(0, 200).map((session) => ({
        sessionId: session.sessionId,
        state: session.state,
        workingDirectory: session.workingDirectory,
        workspaceName: workspaceStore.current(session.sessionId)?.name ?? null,
        workerPid: session.workerPid,
        ready: session.workerStatus?.ready ?? false,
        inFlight: session.inFlight,
        queued: session.queued,
        queuePosition: session.queuePosition,
        lastActivityAt: session.lastActivityAt,
        restartCount: session.workerStatus?.restartCount ?? 0,
      })),
    };
  }
  if (!ctx.sessionId) throw new Error('hello must be sent before broker requests');
  const sessionId = await registry.resolveContext(ctx.sessionId, requestContext(message));
  if (message.method === 'list_tools') {
    const upstream = await registry.listTools(sessionId);
    return { ...upstream, tools: [...upstream.tools, ...brokerTools] };
  }
  if (message.method === 'call_tool') {
    const params = callParams(message);
    const controlled = await controlTool(ctx, sessionId, params.name, params.arguments, message.id);
    if (controlled !== NOT_A_CONTROL_TOOL) return controlled;
    return registry.callTool(sessionId, message.id, params);
  }
  if (message.method === 'list_resources') return registry.listResources(sessionId);
  if (message.method === 'list_resource_templates')
    return registry.listResourceTemplates(sessionId);
  if (message.method === 'read_resource') {
    const uri = message.params?.uri;
    if (typeof uri !== 'string' || !uri) throw new Error('read_resource requires uri');
    return registry.readResource(sessionId, uri);
  }
  if (message.method === 'shutdown') {
    if (process.env.DWB_BROKER_ALLOW_SHUTDOWN !== 'true')
      throw new Error('Broker shutdown is disabled');
    setTimeout(() => void shutdown(0), 25).unref();
    return { shuttingDown: true };
  }
  throw new Error(`Unsupported broker method: ${message.method}`);
}

function accept(socket: Socket): void {
  sockets.add(socket);
  const ctx: ConnectionContext = {
    sessionId: null,
    adapterPid: null,
    initializing: false,
    closed: false,
    routingChange: null,
  };
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: BrokerRequest;
      try {
        message = JSON.parse(line);
      } catch (error) {
        response(socket, errorResponse('invalid-json', error));
        continue;
      }
      if (!message?.id || !message?.method) {
        response(socket, {
          id: message?.id ?? 'invalid-request',
          ok: false,
          error: { code: 'INVALID_REQUEST', message: 'id and method are required' },
        });
        continue;
      }
      void handle(ctx, message)
        .then((result) =>
          response(socket, {
            id: message.id,
            ok: true,
            result,
            sessionId: ctx.sessionId ?? undefined,
          }),
        )
        .catch((error) => response(socket, errorResponse(message.id, error)));
    }
  });
  socket.on('close', () => {
    sockets.delete(socket);
    ctx.closed = true;
    if (ctx.sessionId) void registry.detach(ctx.sessionId).catch(() => {});
  });
  socket.on('error', () => {});
}

const server = createServer(accept);
let shuttingDown = false;
let heartbeat: NodeJS.Timeout | null = null;

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  for (const socket of sockets) socket.destroy();
  await registry.shutdown().catch(() => {});
  await log
    .write({ type: 'broker_stopped', details: { brokerPid: process.pid, endpoint } })
    .catch(() => {});
  await closed;
  try {
    coreDb.close();
  } catch {}
  if (process.platform !== 'win32') await unlink(endpoint).catch(() => {});
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

async function main(): Promise<void> {
  if (process.platform !== 'win32') await unlink(endpoint).catch(() => {});
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint);
  });
  // Only the process that owns the endpoint may restore and rewrite session state.
  await registry.restore();
  markReady();
  await log.write({
    type: 'broker_started',
    details: {
      endpoint,
      protocolVersion: BROKER_PROTOCOL_VERSION,
      ...registry.status,
      sessionList: registry.listSessions(),
    },
  });
  heartbeat = setInterval(() => {
    void (async () => {
      await registry.reclaimIdleWorkers();
      await log.write({
        type: 'broker_heartbeat',
        details: { endpoint, ...registry.status, sessionList: registry.listSessions() },
      });
    })().catch(() => {});
  }, 15_000);
  heartbeat.unref();
  console.error(`DWB_BROKER_READY ${endpoint} PID ${process.pid}`);
}

main().catch(async (error: any) => {
  if (error?.code === 'EADDRINUSE') process.exit(0);
  await log
    .write({
      type: 'broker_fatal',
      details: { brokerPid: process.pid, endpoint, error: String(error) },
    })
    .catch(() => {});
  console.error('[dwb-desktop-broker] fatal:', error);
  process.exit(1);
});
