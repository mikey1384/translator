import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  createPackagedSocketDiscovery,
  PACKAGED_AGENT_HANDSHAKE_ID,
  PACKAGED_AGENT_HANDSHAKE_METHOD,
  PACKAGED_AGENT_PROTOCOL_VERSION,
} from '../src/packaged-agent-protocol.mjs';
import { PACKAGED_TOOL_MAP } from '../src/packaged-tool-map.mjs';
import {
  ContentLengthDecoder,
  Utf8LineDecoder,
} from '../src/stream-codecs.mjs';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const repoRoot = path.resolve(packageRoot, '../..');
const TEST_INSTANCE_TOKEN = 'a'.repeat(64);
const TEST_WORKSPACE_ROUTE_TOKEN = '00000000-0000-4000-8000-000000000001';
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publishFixtureDiscovery(agentDirectory, socketPath) {
  return fs.writeFile(
    path.join(agentDirectory, 'socket-path.txt'),
    `${JSON.stringify(
      createPackagedSocketDiscovery(socketPath, TEST_INSTANCE_TOKEN)
    )}\n`
  );
}

function respondToFixtureHandshake(candidate, request, observedHandshakes) {
  if (request.method !== PACKAGED_AGENT_HANDSHAKE_METHOD) return false;
  assert.equal(request.id, PACKAGED_AGENT_HANDSHAKE_ID);
  assert.equal(
    request.params?.protocolVersion,
    PACKAGED_AGENT_PROTOCOL_VERSION
  );
  assert.equal(request.params?.instanceToken, TEST_INSTANCE_TOKEN);
  assert.match(request.params?.clientSessionId, UUID_V4_PATTERN);
  if (request.params?.workspaceRouteToken !== undefined) {
    assert.equal(
      request.params.workspaceRouteToken,
      TEST_WORKSPACE_ROUTE_TOKEN
    );
  }
  observedHandshakes?.push({ ...request.params });
  candidate.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: PACKAGED_AGENT_HANDSHAKE_ID,
      result: {
        protocolVersion: PACKAGED_AGENT_PROTOCOL_VERSION,
        workspaceRouteToken: TEST_WORKSPACE_ROUTE_TOKEN,
      },
    })}\n`,
    () => {}
  );
  return true;
}

function installFixtureHandshake(candidate, observedHandshakes) {
  const decoder = new Utf8LineDecoder();
  candidate.on('error', () => {});
  candidate.on('data', data => {
    for (const line of decoder.write(data)) {
      if (!line.trim()) continue;
      respondToFixtureHandshake(
        candidate,
        JSON.parse(line),
        observedHandshakes
      );
    }
  });
}

function frame(message) {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

function withTimeout(promise, milliseconds, message) {
  let timeout;
  const timed = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timed]).finally(() => clearTimeout(timeout));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitForProcessExit(pid, message) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

function collectMessages(stream) {
  const decoder = new ContentLengthDecoder();
  const messages = [];
  const waiters = new Set();

  const dispatch = message => {
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      waiters.delete(waiter);
      waiter.resolve(message);
    }
  };
  stream.on('data', chunk => {
    const decoded = decoder.write(chunk);
    assert.deepEqual(decoded.errors, []);
    for (const body of decoded.messages) {
      dispatch(JSON.parse(body.toString('utf8')));
    }
  });

  return {
    messages,
    waitFor(predicate) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise(resolve => waiters.add({ predicate, resolve }));
    },
  };
}

test(
  'packaged MCP exits and releases its Translator socket when stdio ends',
  { skip: process.platform === 'win32' },
  async t => {
    const fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'translator-packaged-mcp-test-')
    );
    const socketPath = path.join(fixtureRoot, 'translator.sock');
    const fixtureUserData =
      process.platform === 'darwin'
        ? path.join(fixtureRoot, 'Library', 'Application Support', 'Translator')
        : path.join(fixtureRoot, '.config', 'Translator');
    const fixtureAgentDirectory = path.join(fixtureUserData, 'agent');
    await fs.mkdir(fixtureAgentDirectory, { recursive: true });
    await publishFixtureDiscovery(fixtureAgentDirectory, socketPath);
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    let connectedSocket;
    let resolveConnection;
    const connected = new Promise(resolve => {
      resolveConnection = resolve;
    });
    let resolveSocketClose;
    const socketClosed = new Promise(resolve => {
      resolveSocketClose = resolve;
    });
    server.on('connection', candidate => {
      connectedSocket = candidate;
      candidate.once('close', resolveSocketClose);
      installFixtureHandshake(candidate);
      resolveConnection(candidate);
    });

    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'src', 'packaged-mcp.mjs')],
      {
        env: {
          ...process.env,
          HOME: fixtureRoot,
          XDG_CONFIG_HOME: '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    child.stdout.resume();
    child.stderr.resume();

    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      connectedSocket?.destroy();
      await new Promise(resolve => server.close(resolve));
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    });

    child.stdin.write(
      frame({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'app_status', arguments: {} },
      })
    );
    await withTimeout(
      connected,
      2_000,
      'packaged MCP did not connect to the Translator fixture socket'
    );

    const exited = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end();

    const exitCode = await withTimeout(
      exited,
      2_000,
      'packaged MCP remained alive after its controlling stdio ended'
    );
    await withTimeout(
      socketClosed,
      2_000,
      'packaged MCP did not release the Translator socket'
    );

    assert.equal(exitCode, 0);
  }
);

test(
  'packaged MCP exits on exact owner death even while every stdio descriptor remains open',
  { skip: process.platform === 'win32' },
  async t => {
    const helperPath = path.join(packageRoot, 'src', 'packaged-mcp.mjs');
    const ownerSource = `
      const { spawn } = require('node:child_process');
      const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'inherit',
      });
      holder.unref();
      const helper = spawn(process.execPath, [process.argv[1]], {
        detached: true,
        stdio: 'inherit',
      });
      helper.unref();
      process.stdout.write(JSON.stringify({ holderPid: holder.pid, helperPid: helper.pid }) + '\\n');
      setInterval(() => {}, 1000);
    `;
    const owner = spawn(process.execPath, ['-e', ownerSource, helperPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    const descendants = new Promise((resolve, reject) => {
      owner.once('error', reject);
      owner.stdout.on('data', chunk => {
        output += chunk.toString('utf8');
        const newline = output.indexOf('\n');
        if (newline >= 0) resolve(JSON.parse(output.slice(0, newline)));
      });
    });
    let holderPid;
    let helperPid;
    t.after(() => {
      for (const pid of [owner.pid, helperPid, holderPid]) {
        if (pid && isProcessAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Exact fixture process already exited.
          }
        }
      }
    });

    ({ holderPid, helperPid } = await withTimeout(
      descendants,
      2_000,
      'fixture owner did not launch packaged helper'
    ));
    assert.ok(isProcessAlive(holderPid));
    assert.ok(isProcessAlive(helperPid));

    process.kill(owner.pid, 'SIGKILL');
    await waitForProcessExit(
      helperPid,
      'packaged helper survived exact owner death'
    );
    assert.ok(
      isProcessAlive(holderPid),
      'descriptor holder must remain alive to prove no EOF was available'
    );
  }
);

test(
  'packaged MCP releases idle app sockets and reconnects without ending its MCP transport',
  { skip: process.platform === 'win32' },
  async t => {
    const fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'translator-packaged-mcp-idle-test-')
    );
    const socketPath = path.join(fixtureRoot, 'translator.sock');
    const fixtureUserData =
      process.platform === 'darwin'
        ? path.join(fixtureRoot, 'Library', 'Application Support', 'Translator')
        : path.join(fixtureRoot, '.config', 'Translator');
    const fixtureAgentDirectory = path.join(fixtureUserData, 'agent');
    await fs.mkdir(fixtureAgentDirectory, { recursive: true });
    await publishFixtureDiscovery(fixtureAgentDirectory, socketPath);

    const receivedRequests = [];
    const observedHandshakes = [];
    const socketClosures = [];
    const server = net.createServer(candidate => {
      const decoder = new Utf8LineDecoder();
      let resolveClose;
      socketClosures.push(
        new Promise(resolve => {
          resolveClose = resolve;
        })
      );
      candidate.once('close', resolveClose);
      candidate.on('data', data => {
        for (const line of decoder.write(data)) {
          if (!line.trim()) continue;
          const request = JSON.parse(line);
          if (respondToFixtureHandshake(candidate, request, observedHandshakes))
            continue;
          receivedRequests.push(request);
          const response = Buffer.from(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: { message: '완료 🎬' },
            })}\n`,
            'utf8'
          );
          const emojiOffset = response.indexOf(Buffer.from('🎬'));
          candidate.write(response.subarray(0, emojiOffset + 1));
          candidate.write(response.subarray(emojiOffset + 1));
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'src', 'packaged-mcp.mjs')],
      {
        env: { ...process.env, HOME: fixtureRoot, XDG_CONFIG_HOME: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    child.stdout.resume();
    child.stderr.resume();

    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      await new Promise(resolve => server.close(resolve));
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    });

    const firstConnection = new Promise(resolve =>
      server.once('connection', resolve)
    );
    child.stdin.write(
      frame({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'app_video_search',
          arguments: { prompt: '한국어 🎬' },
        },
      })
    );
    await withTimeout(
      firstConnection,
      2_000,
      'packaged MCP did not open its first Translator socket'
    );
    await withTimeout(
      socketClosures[0],
      2_000,
      'packaged MCP retained its first idle Translator socket'
    );

    assert.equal(child.exitCode, null);
    assert.equal(receivedRequests[0].method, 'searchVideos');
    assert.equal(receivedRequests[0].params.prompt, '한국어 🎬');

    const secondConnection = new Promise(resolve =>
      server.once('connection', resolve)
    );
    child.stdin.write(
      frame({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'app_status', arguments: {} },
      })
    );
    await withTimeout(
      secondConnection,
      2_000,
      'packaged MCP did not reconnect to Translator'
    );
    await withTimeout(
      socketClosures[1],
      2_000,
      'packaged MCP did not release its reconnected Translator socket'
    );

    assert.equal(receivedRequests.length, 2);
    assert.equal(observedHandshakes.length, 2);
    assert.equal(
      observedHandshakes[1].clientSessionId,
      observedHandshakes[0].clientSessionId,
      'idle reconnects must retain the helper process identity'
    );
    assert.equal(
      observedHandshakes[0].workspaceRouteToken,
      undefined,
      'the first connection must request a new workspace lease'
    );
    assert.equal(
      observedHandshakes[1].workspaceRouteToken,
      TEST_WORKSPACE_ROUTE_TOKEN,
      'the reconnect must present the exact workspace lease'
    );
    assert.equal(child.exitCode, null);

    const exited = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end();
    assert.equal(
      await withTimeout(
        exited,
        2_000,
        'packaged MCP did not exit on stdin EOF'
      ),
      0
    );
  }
);

test(
  'packaged MCP bypasses stale discovery metadata when another authenticated endpoint is live',
  { skip: process.platform === 'win32' },
  async t => {
    // Keep the full fallback endpoint below Darwin's short sockaddr_un limit;
    // long temp prefixes can be silently truncated and collide in the kernel.
    const fixtureRoot = await fs.mkdtemp(path.join('/tmp', 'tmcp-'));
    const staleSocketPath = path.join(fixtureRoot, 'stale.sock');
    const appDataRoot =
      process.platform === 'darwin'
        ? path.join(fixtureRoot, 'Library', 'Application Support')
        : path.join(fixtureRoot, '.config');
    const primaryAgentDirectory = path.join(appDataRoot, 'Translator', 'agent');
    const alternateAgentDirectory = path.join(
      appDataRoot,
      'translator',
      'agent'
    );
    const liveSocketPath = path.join(
      alternateAgentDirectory,
      'translator-agent.sock'
    );
    await fs.mkdir(primaryAgentDirectory, { recursive: true });
    await fs.mkdir(alternateAgentDirectory, { recursive: true });
    await publishFixtureDiscovery(primaryAgentDirectory, staleSocketPath);
    await publishFixtureDiscovery(alternateAgentDirectory, liveSocketPath);

    const server = net.createServer(candidate => {
      const decoder = new Utf8LineDecoder();
      candidate.on('data', data => {
        for (const line of decoder.write(data)) {
          if (!line.trim()) continue;
          const request = JSON.parse(line);
          if (respondToFixtureHandshake(candidate, request)) continue;
          candidate.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: { path: 'fallback' },
            })}\n`
          );
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(liveSocketPath, resolve);
    });

    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'src', 'packaged-mcp.mjs')],
      {
        env: { ...process.env, HOME: fixtureRoot, XDG_CONFIG_HOME: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const output = collectMessages(child.stdout);
    let helperStderr = '';
    child.stderr.on('data', chunk => {
      helperStderr += chunk.toString('utf8');
    });

    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      await new Promise(resolve => server.close(resolve));
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    });

    child.stdin.write(
      frame({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'app_status', arguments: {} },
      })
    );
    const response = await withTimeout(
      output.waitFor(message => message?.id === 1),
      4_000,
      'stale discovery metadata masked the live authenticated endpoint'
    ).catch(error => {
      throw new Error(`${error.message}\nHelper stderr:\n${helperStderr}`);
    });
    assert.equal(JSON.parse(response.result.content[0].text).path, 'fallback');

    const exited = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end();
    assert.equal(
      await withTimeout(exited, 2_000, 'packaged MCP did not exit on EOF'),
      0
    );
  }
);

test('packaged MCP exits when its response output pipe is gone', async t => {
  const child = spawn(
    process.execPath,
    [path.join(packageRoot, 'src', 'packaged-mcp.mjs')],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  child.stderr.resume();

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  });

  child.stdout.destroy();
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.stdin.write(
    frame({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} })
  );

  await withTimeout(
    exited,
    2_000,
    'packaged MCP remained alive after writing to a closed response pipe'
  );
  assert.notEqual(child.exitCode, null);
});

test('packaged MCP interoperates with the repository MCP SDK stdio client', async t => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, 'src', 'packaged-mcp.mjs')],
    stderr: 'pipe',
  });
  transport.stderr?.resume();
  const client = new Client({ name: 'packaged-mcp-test', version: '1.0.0' });
  t.after(async () => client.close());

  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map(tool => tool.name).sort(),
    Object.keys(PACKAGED_TOOL_MAP).sort()
  );
  await client.close();
});

test('packaged MCP rejects a non-object request without an unhandled rejection', async t => {
  const child = spawn(
    process.execPath,
    [path.join(packageRoot, 'src', 'packaged-mcp.mjs')],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  child.stderr.resume();
  const output = collectMessages(child.stdout);

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  });

  child.stdin.write(frame(null));
  const invalid = await withTimeout(
    output.waitFor(message => message?.error?.code === -32600),
    2_000,
    'packaged MCP did not reject a non-object JSON-RPC request'
  );
  assert.equal(invalid.id, null);

  child.stdin.write(
    frame({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: '__proto__', arguments: {} },
    }) +
      frame({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'app_status', arguments: [] },
      }) +
      frame({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'app_navigate', arguments: { screen: 'home' } },
      }) +
      frame({ jsonrpc: '2.0', id: 5, method: 'unknown', params: {} })
  );
  const invalidCalls = await Promise.all([
    withTimeout(
      output.waitFor(message => message?.id === 3),
      2_000
    ),
    withTimeout(
      output.waitFor(message => message?.id === 4),
      2_000
    ),
    withTimeout(
      output.waitFor(message => message?.id === 6),
      2_000
    ),
    withTimeout(
      output.waitFor(message => message?.id === 5),
      2_000
    ),
  ]);
  assert.deepEqual(
    invalidCalls.map(message => message.error?.code),
    [-32602, -32602, -32602, -32601]
  );

  child.stdin.write(
    frame({ jsonrpc: '2.0', id: null, method: 'ping', params: {} })
  );
  const nullIdResponse = await withTimeout(
    output.waitFor(
      message => message?.id === null && message?.result !== undefined
    ),
    2_000,
    'packaged MCP incorrectly treated a null request id as a notification'
  );
  assert.deepEqual(nullIdResponse.result, {});

  child.stdin.write(
    frame({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} })
  );
  const ping = await withTimeout(
    output.waitFor(message => message?.id === 2),
    2_000,
    'packaged MCP stopped serving after a malformed request'
  );
  assert.deepEqual(ping.result, {});

  const exited = new Promise(resolve => child.once('exit', resolve));
  child.stdin.end();
  assert.equal(
    await withTimeout(exited, 2_000, 'packaged MCP did not exit on EOF'),
    0
  );
});

test('packaged MCP terminates on irrecoverably invalid Content-Length framing', async t => {
  const child = spawn(
    process.execPath,
    [path.join(packageRoot, 'src', 'packaged-mcp.mjs')],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  child.stdout.resume();
  child.stderr.resume();

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  });

  const exited = new Promise(resolve => child.once('exit', resolve));
  child.stdin.write('Content-Length: invalid\r\n\r\n');

  assert.equal(
    await withTimeout(
      exited,
      2_000,
      'packaged MCP remained alive on a desynchronized input transport'
    ),
    1
  );
});

test(
  'concurrent packaged requests share connection retry instead of using a failed candidate',
  { skip: process.platform === 'win32' },
  async t => {
    const fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'translator-packaged-mcp-retry-test-')
    );
    const socketPath = path.join(fixtureRoot, 'translator.sock');
    const fixtureUserData =
      process.platform === 'darwin'
        ? path.join(fixtureRoot, 'Library', 'Application Support', 'translator')
        : path.join(fixtureRoot, '.config', 'translator');
    const fixtureAgentDirectory = path.join(fixtureUserData, 'agent');
    await fs.mkdir(fixtureAgentDirectory, { recursive: true });

    const server = net.createServer(candidate => {
      const decoder = new Utf8LineDecoder();
      candidate.on('data', data => {
        for (const line of decoder.write(data)) {
          if (!line.trim()) continue;
          const request = JSON.parse(line);
          if (respondToFixtureHandshake(candidate, request)) continue;
          candidate.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: { requestId: request.id },
            })}\n`
          );
        }
      });
    });
    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'src', 'packaged-mcp.mjs')],
      {
        env: { ...process.env, HOME: fixtureRoot, XDG_CONFIG_HOME: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const output = collectMessages(child.stdout);
    let stderr = '';
    let resolveFirstFailure;
    const firstFailure = new Promise(resolve => {
      resolveFirstFailure = resolve;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
      if (stderr.includes('Connection attempt 1/3 failed')) {
        resolveFirstFailure();
      }
    });

    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      await new Promise(resolve => server.close(resolve));
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    });

    child.stdin.write(
      frame({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'app_status', arguments: {} },
      }) +
        frame({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'app_status', arguments: {} },
        })
    );
    await withTimeout(
      firstFailure,
      2_000,
      'packaged MCP did not exercise its failed first connection attempt'
    );
    await publishFixtureDiscovery(fixtureAgentDirectory, socketPath);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    const responses = await Promise.all([
      withTimeout(
        output.waitFor(message => message?.id === 1),
        4_000,
        'first request did not survive shared retry'
      ),
      withTimeout(
        output.waitFor(message => message?.id === 2),
        4_000,
        'second request did not survive shared retry'
      ),
    ]);
    assert.deepEqual(
      responses.map(response => response.result?.content?.[0]?.text),
      ['{\n  "requestId": 1\n}', '{\n  "requestId": 2\n}']
    );

    const exited = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end();
    assert.equal(
      await withTimeout(exited, 2_000, 'packaged MCP did not exit on EOF'),
      0
    );
  }
);

test('packaged builds ship every packaged-mcp runtime module beside it', async () => {
  for (const configName of [
    'electron-builder.base.json',
    'electron-builder.x64.json',
    'electron-builder.win.json',
  ]) {
    const config = JSON.parse(
      await fs.readFile(path.join(repoRoot, configName), 'utf8')
    );
    for (const moduleName of [
      'transport-bound-lifecycle.mjs',
      'native-owner-monitor.mjs',
      'packaged-agent-protocol.mjs',
      'stream-codecs.mjs',
      'packaged-tool-map.mjs',
      'tool-schema-validator.mjs',
      'packaged-socket-path.mjs',
    ]) {
      assert.ok(
        config.extraResources.some(
          resource =>
            resource.from === `packages/agent-server/src/${moduleName}` &&
            resource.to === moduleName
        ),
        `${configName} must ship ${moduleName}`
      );
    }

    for (const launcherName of ['translator-mcp', 'translator-mcp.cmd']) {
      assert.ok(
        config.extraResources.some(
          resource =>
            resource.from === `packages/agent-server/bin/${launcherName}` &&
            resource.to === launcherName
        ),
        `${configName} must ship ${launcherName}`
      );
    }
    const supervisorName =
      configName === 'electron-builder.win.json'
        ? 'translator-owner-supervisor.exe'
        : 'translator-owner-supervisor';
    assert.ok(
      config.extraResources.some(
        resource =>
          resource.from === `packages/agent-server/bin/${supervisorName}` &&
          resource.to === supervisorName
      ),
      `${configName} must ship ${supervisorName}`
    );
  }
});

test(
  'macOS packaged launcher uses the bundled runtime in Node mode',
  { skip: process.platform === 'win32' },
  async t => {
    const fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'translator-packaged-launcher-test-')
    );
    const resources = path.join(fixtureRoot, 'Contents', 'Resources');
    const executable = path.join(
      fixtureRoot,
      'Contents',
      'MacOS',
      'Translator'
    );
    const launcher = path.join(resources, 'translator-mcp');
    const supervisor = path.join(resources, 'translator-owner-supervisor');
    const helper = path.join(resources, 'packaged-mcp.mjs');
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.mkdir(resources, { recursive: true });
    await fs.copyFile(
      path.join(packageRoot, 'bin', 'translator-mcp'),
      launcher
    );
    await fs.copyFile(
      path.join(packageRoot, 'bin', 'translator-owner-supervisor'),
      supervisor
    );
    await fs.writeFile(helper, '');
    await fs.writeFile(
      executable,
      '#!/bin/sh\n[ "$ELECTRON_RUN_AS_NODE" = "1" ] || exit 9\nprintf "%s\\n" "$1"\n'
    );
    await fs.chmod(launcher, 0o755);
    await fs.chmod(supervisor, 0o755);
    await fs.chmod(executable, 0o755);
    t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));

    const child = spawn(launcher, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    const exitCode = await withTimeout(
      new Promise(resolve => child.once('exit', resolve)),
      2_000,
      'packaged launcher did not exit'
    );

    assert.equal(exitCode, 0);
    assert.equal(stdout.trim(), await fs.realpath(helper));
  }
);
