import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPackagedSocketDiscovery,
  getPackagedAgentHandshakeResponseRouteToken,
  getValidPackagedAgentHandshake,
  isPackagedSocketDiscovery,
  isValidPackagedAgentHandshake,
  isValidPackagedAgentHandshakeResponse,
  PACKAGED_AGENT_HANDSHAKE_ID,
  PACKAGED_AGENT_HANDSHAKE_METHOD,
  PACKAGED_AGENT_PROTOCOL_VERSION,
} from '../src/packaged-agent-protocol.mjs';

const token = 'b'.repeat(64);
const clientSessionId = '00000000-0000-4000-8000-000000000001';
const workspaceRouteToken = '00000000-0000-4000-8000-000000000002';
const handshake = {
  jsonrpc: '2.0',
  id: PACKAGED_AGENT_HANDSHAKE_ID,
  method: PACKAGED_AGENT_HANDSHAKE_METHOD,
  params: {
    protocolVersion: PACKAGED_AGENT_PROTOCOL_VERSION,
    instanceToken: token,
    clientSessionId,
  },
};

test('packaged socket discovery carries one versioned per-instance lease', () => {
  const discovery = createPackagedSocketDiscovery(
    '/tmp/translator.sock',
    token
  );
  assert.equal(isPackagedSocketDiscovery(discovery), true);
  assert.equal(
    isPackagedSocketDiscovery({ ...discovery, instanceToken: 'stale' }),
    false
  );
  assert.equal(
    isPackagedSocketDiscovery({ ...discovery, protocolVersion: 1 }),
    false
  );
});

test('packaged agent handshake accepts only the exact generation and protocol', () => {
  assert.equal(isValidPackagedAgentHandshake(handshake, token), true);
  assert.deepEqual(getValidPackagedAgentHandshake(handshake, token), {
    clientSessionId,
    workspaceRouteToken: null,
  });
  assert.equal(
    isValidPackagedAgentHandshake(
      {
        ...handshake,
        params: { ...handshake.params, instanceToken: 'c'.repeat(64) },
      },
      token
    ),
    false
  );
  assert.equal(
    isValidPackagedAgentHandshake(
      {
        ...handshake,
        params: { ...handshake.params, clientSessionId: 'not-a-session' },
      },
      token
    ),
    false
  );
  assert.equal(
    isValidPackagedAgentHandshake(
      {
        ...handshake,
        params: {
          ...handshake.params,
          workspaceRouteToken: 'not-a-route',
        },
      },
      token
    ),
    false
  );
  assert.equal(
    isValidPackagedAgentHandshake(
      {
        ...handshake,
        params: { ...handshake.params, protocolVersion: 1 },
      },
      token
    ),
    false
  );
  assert.equal(
    isValidPackagedAgentHandshake(
      { ...handshake, method: 'app_status' },
      token
    ),
    false
  );
});

test('packaged helper accepts only an exact JSON-RPC handshake response', () => {
  const response = {
    jsonrpc: '2.0',
    id: PACKAGED_AGENT_HANDSHAKE_ID,
    result: {
      protocolVersion: PACKAGED_AGENT_PROTOCOL_VERSION,
      workspaceRouteToken,
    },
  };

  assert.equal(isValidPackagedAgentHandshakeResponse(response), true);
  assert.equal(
    getPackagedAgentHandshakeResponseRouteToken(response),
    workspaceRouteToken
  );
  assert.equal(
    isValidPackagedAgentHandshakeResponse({ ...response, jsonrpc: '1.0' }),
    false
  );
  assert.equal(
    isValidPackagedAgentHandshakeResponse({
      ...response,
      error: { code: -32001 },
    }),
    false
  );
  assert.equal(
    isValidPackagedAgentHandshakeResponse({
      ...response,
      result: { protocolVersion: PACKAGED_AGENT_PROTOCOL_VERSION },
    }),
    false
  );
});
