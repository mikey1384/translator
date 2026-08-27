import assert from 'node:assert/strict';
import test from 'node:test';
import { getAgentMcpOnboarding } from '../utils/agent-mcp-onboarding';

test('packaged MCP onboarding exposes the exact platform launcher', () => {
  assert.deepEqual(
    getAgentMcpOnboarding({
      isPackaged: true,
      resourcesPath: '/Applications/Translator.app/Contents/Resources',
      platform: 'darwin',
    }),
    {
      serverName: 'translator',
      transport: 'stdio',
      launcherPath:
        '/Applications/Translator.app/Contents/Resources/translator-mcp',
      restartRequired: true,
    }
  );
  assert.equal(
    getAgentMcpOnboarding({
      isPackaged: true,
      resourcesPath: 'C:\\Program Files\\Translator\\resources',
      platform: 'win32',
    }).launcherPath,
    'C:\\Program Files\\Translator\\resources\\translator-mcp.cmd'
  );
});

test('development status does not advertise a packaged launcher', () => {
  assert.equal(
    getAgentMcpOnboarding({
      isPackaged: false,
      resourcesPath: '/development',
      platform: 'darwin',
    }).launcherPath,
    null
  );
});
