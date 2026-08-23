import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  getPackagedSocketDiscoveryCandidates,
  getPackagedSocketPath,
  getPackagedSocketPathCandidates,
} from '../src/packaged-socket-path.mjs';
import { PACKAGED_AGENT_PROTOCOL_VERSION } from '../src/packaged-agent-protocol.mjs';

test('packaged socket discovery accepts Electron package-name casing', () => {
  const lowercaseInfo = path.join(
    '/home/tester',
    '.config',
    'translator',
    'agent',
    'socket-path.txt'
  );
  const resolved = getPackagedSocketPath({
    platformName: 'linux',
    homeDirectory: '/home/tester',
    configDirectory: '',
    exists: candidate => candidate === lowercaseInfo,
    readFile: candidate => {
      assert.equal(candidate, lowercaseInfo);
      return '/run/user/1000/translator.sock\n';
    },
  });

  assert.equal(resolved, '/run/user/1000/translator.sock');
});

test('packaged socket discovery preserves the authenticated app generation', () => {
  const infoPath = path.join(
    '/home/tester',
    '.config',
    'Translator',
    'agent',
    'socket-path.txt'
  );
  const token = 'd'.repeat(64);
  const [discovery] = getPackagedSocketDiscoveryCandidates({
    platformName: 'linux',
    homeDirectory: '/home/tester',
    configDirectory: '',
    exists: candidate => candidate === infoPath,
    readFile: () =>
      JSON.stringify({
        socketPath: '/run/user/1000/translator.sock',
        protocolVersion: PACKAGED_AGENT_PROTOCOL_VERSION,
        instanceToken: token,
      }),
  });

  assert.deepEqual(discovery, {
    socketPath: '/run/user/1000/translator.sock',
    protocolVersion: PACKAGED_AGENT_PROTOCOL_VERSION,
    instanceToken: token,
  });
});

test('legacy path discovery is visible but cannot impersonate an authenticated generation', () => {
  const infoPath = path.join(
    '/home/tester',
    '.config',
    'Translator',
    'agent',
    'socket-path.txt'
  );
  const [discovery] = getPackagedSocketDiscoveryCandidates({
    platformName: 'linux',
    homeDirectory: '/home/tester',
    configDirectory: '',
    exists: candidate => candidate === infoPath,
    readFile: () => '/run/user/1000/legacy.sock',
  });

  assert.deepEqual(discovery, {
    socketPath: '/run/user/1000/legacy.sock',
    protocolVersion: 1,
    instanceToken: null,
  });
});

test('packaged socket discovery finds an existing lowercase fallback endpoint', () => {
  const lowercaseSocket = path.join(
    '/home/tester',
    '.config',
    'translator',
    'agent',
    'translator-agent.sock'
  );
  const resolved = getPackagedSocketPath({
    platformName: 'linux',
    homeDirectory: '/home/tester',
    configDirectory: '',
    exists: candidate => candidate === lowercaseSocket,
  });

  assert.equal(resolved, lowercaseSocket);
});

test('packaged socket discovery honors Linux XDG_CONFIG_HOME', () => {
  const infoPath = path.join(
    '/custom/config',
    'translator',
    'agent',
    'socket-path.txt'
  );
  assert.equal(
    getPackagedSocketPath({
      platformName: 'linux',
      homeDirectory: '/home/tester',
      configDirectory: '',
      configDirectory: '/custom/config',
      exists: candidate => candidate === infoPath,
      readFile: () => '/run/user/1000/custom-translator.sock',
    }),
    '/run/user/1000/custom-translator.sock'
  );
});

test('packaged socket discovery preserves the product-name fallback', () => {
  assert.equal(
    getPackagedSocketPath({
      platformName: 'linux',
      homeDirectory: '/home/tester',
      configDirectory: '',
      exists: () => false,
    }),
    path.join(
      '/home/tester',
      '.config',
      'Translator',
      'agent',
      'translator-agent.sock'
    )
  );
});

test('packaged socket discovery retains a live alternate after stale primary metadata', () => {
  const primaryInfo = path.join(
    '/home/tester',
    '.config',
    'Translator',
    'agent',
    'socket-path.txt'
  );
  const alternateInfo = path.join(
    '/home/tester',
    '.config',
    'translator',
    'agent',
    'socket-path.txt'
  );

  const candidates = getPackagedSocketPathCandidates({
    platformName: 'linux',
    homeDirectory: '/home/tester',
    configDirectory: '',
    exists: candidate =>
      candidate === primaryInfo || candidate === alternateInfo,
    readFile: candidate =>
      candidate === primaryInfo
        ? '/run/user/1000/stale.sock\n'
        : '/run/user/1000/live.sock\n',
  });

  assert.deepEqual(candidates.slice(0, 2), [
    '/run/user/1000/stale.sock',
    '/run/user/1000/live.sock',
  ]);
});
