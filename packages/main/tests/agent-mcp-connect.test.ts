import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMcpAddArgs,
  connectAgentCli,
  connectClaudeDesktop,
  findAgentCli,
  formatCommandForCopy,
  getClaudeDesktopConfigPath,
  mergeClaudeDesktopConfig,
  type ConfigFs,
  type ExecFileLike,
} from '../utils/agent-mcp-connect';

const LAUNCHER =
  '/Applications/Translator.app/Contents/Resources/translator-mcp';

test('mcp add arguments put the launcher after --', () => {
  assert.deepEqual(buildMcpAddArgs('codex', LAUNCHER), [
    'mcp',
    'add',
    'translator',
    '--',
    LAUNCHER,
  ]);
  assert.deepEqual(buildMcpAddArgs('claude-code', LAUNCHER), [
    'mcp',
    'add',
    '--scope',
    'user',
    'translator',
    '--',
    LAUNCHER,
  ]);
});

test('copyable command quotes paths with spaces', () => {
  assert.equal(
    formatCommandForCopy(
      'codex',
      buildMcpAddArgs('codex', '/Apps/My Translator/translator-mcp'),
      'darwin'
    ),
    "codex mcp add translator -- '/Apps/My Translator/translator-mcp'"
  );
  assert.equal(
    formatCommandForCopy(
      'claude',
      buildMcpAddArgs(
        'claude-code',
        'C:\\Program Files\\Translator\\resources\\translator-mcp.cmd'
      ),
      'win32'
    ),
    'claude mcp add --scope user translator -- "C:\\Program Files\\Translator\\resources\\translator-mcp.cmd"'
  );
});

test('CLI lookup checks PATH, then common install dirs', () => {
  const present = new Set(['/Users/me/.local/bin/claude']);
  const found = findAgentCli('claude', {
    platform: 'darwin',
    env: { PATH: '/usr/bin:/bin' },
    homeDir: '/Users/me',
    isExecutable: p => present.has(p),
  });
  assert.equal(found, '/Users/me/.local/bin/claude');

  const nvm = findAgentCli('codex', {
    platform: 'darwin',
    env: { PATH: '/usr/bin' },
    homeDir: '/Users/me',
    isExecutable: p => p === '/Users/me/.nvm/versions/node/v22.1.0/bin/codex',
    listDir: () => ['v20.0.0', 'v22.1.0'],
  });
  assert.equal(nvm, '/Users/me/.nvm/versions/node/v22.1.0/bin/codex');

  assert.equal(
    findAgentCli('codex', {
      platform: 'darwin',
      env: {},
      homeDir: '/Users/me',
      isExecutable: () => false,
    }),
    null
  );
});

test('Windows lookup only accepts .exe (no shell for .cmd shims)', () => {
  const found = findAgentCli('codex', {
    platform: 'win32',
    env: { PATH: 'C:\\Users\\me\\AppData\\Roaming\\npm', APPDATA: '' },
    homeDir: 'C:\\Users\\me',
    isExecutable: p => p.endsWith('codex.cmd'),
  });
  assert.equal(found, null);
});

const search = {
  platform: 'darwin' as const,
  env: { PATH: '/usr/bin' },
  homeDir: '/Users/me',
  isExecutable: (p: string) => p === '/usr/bin/codex',
};

test('connecting runs the CLI without a shell and reports success', async () => {
  const calls: Array<{ file: string; args: string[]; path?: string }> = [];
  const exec: ExecFileLike = async (file, args, options) => {
    calls.push({ file, args, path: options.env.PATH });
    return { stdout: 'Added stdio MCP server translator', stderr: '' };
  };
  const result = await connectAgentCli({
    client: 'codex',
    launcherPath: LAUNCHER,
    search,
    exec,
  });
  assert.equal(result.status, 'connected');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, '/usr/bin/codex');
  assert.deepEqual(calls[0].args, ['mcp', 'add', 'translator', '--', LAUNCHER]);
  assert.ok(calls[0].path?.includes('/opt/homebrew/bin'));
});

test('"already exists" counts as connected', async () => {
  const exec: ExecFileLike = async () => {
    throw Object.assign(new Error('exit 1'), {
      stdout: '',
      stderr: 'MCP server translator already exists in user config',
    });
  };
  const result = await connectAgentCli({
    client: 'codex',
    launcherPath: LAUNCHER,
    search,
    exec,
  });
  assert.equal(result.status, 'already-connected');
});

test('missing CLI falls back to the copyable command', async () => {
  const result = await connectAgentCli({
    client: 'claude-code',
    launcherPath: LAUNCHER,
    search: { ...search, isExecutable: () => false },
    exec: async () => {
      throw new Error('should not run');
    },
  });
  assert.deepEqual(result, {
    status: 'cli-not-found',
    client: 'claude-code',
    command: `claude mcp add --scope user translator -- ${LAUNCHER}`,
  });
});

test('other CLI failures return the output and the command', async () => {
  const result = await connectAgentCli({
    client: 'codex',
    launcherPath: LAUNCHER,
    search,
    exec: async () => {
      throw Object.assign(new Error('exit 2'), {
        stdout: '',
        stderr: 'error: not logged in',
      });
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(
    result.status === 'failed' && result.message,
    'error: not logged in'
  );
});

test('Claude Desktop config path per platform', () => {
  assert.equal(
    getClaudeDesktopConfigPath({
      platform: 'darwin',
      env: {},
      homeDir: '/Users/me',
    }),
    '/Users/me/Library/Application Support/Claude/claude_desktop_config.json'
  );
  assert.equal(
    getClaudeDesktopConfigPath({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
      homeDir: 'C:\\Users\\me',
    }),
    'C:\\Users\\me\\AppData\\Roaming\\Claude\\claude_desktop_config.json'
  );
});

test('merging keeps every other setting and server', () => {
  const existing = JSON.stringify({
    globalShortcut: 'Cmd+Space',
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', 'fs-server'] },
      translator: { command: '/old/translator-mcp' },
    },
  });
  const merged = mergeClaudeDesktopConfig(existing, LAUNCHER);
  assert.equal(merged.changed, true);
  assert.deepEqual(JSON.parse(merged.text), {
    globalShortcut: 'Cmd+Space',
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', 'fs-server'] },
      translator: { command: LAUNCHER },
    },
  });
});

test('merging into a missing or empty file creates the server entry', () => {
  for (const input of [null, '', '  \n']) {
    const merged = mergeClaudeDesktopConfig(input, LAUNCHER);
    assert.deepEqual(JSON.parse(merged.text), {
      mcpServers: { translator: { command: LAUNCHER } },
    });
  }
});

test('an up-to-date entry is left alone', () => {
  const existing = JSON.stringify({
    mcpServers: { translator: { command: LAUNCHER } },
  });
  assert.deepEqual(mergeClaudeDesktopConfig(existing, LAUNCHER), {
    text: existing,
    changed: false,
  });
});

test('unparseable configs are refused, not overwritten', () => {
  assert.throws(() => mergeClaudeDesktopConfig('{ "mcpServers": ', LAUNCHER));
  assert.throws(() => mergeClaudeDesktopConfig('[1,2]', LAUNCHER));
  assert.throws(() => mergeClaudeDesktopConfig('{"mcpServers": []}', LAUNCHER));
});

function memoryFs(initial: Record<string, string>) {
  const files = { ...initial };
  const ops: string[] = [];
  const api: ConfigFs = {
    readFile: p => (p in files ? files[p] : null),
    writeFile: (p, text) => {
      ops.push(`write ${p}`);
      files[p] = text;
    },
    copyFile: (from, to) => {
      ops.push(`copy ${from} -> ${to}`);
      files[to] = files[from];
    },
    mkdirp: p => {
      ops.push(`mkdir ${p}`);
    },
  };
  return { files, ops, api };
}

test('Claude Desktop connect backs up the existing file first', () => {
  const configPath = '/cfg/Claude/claude_desktop_config.json';
  const original = '{"mcpServers":{"other":{"command":"x"}}}';
  const mem = memoryFs({ [configPath]: original });
  const result = connectClaudeDesktop({
    launcherPath: LAUNCHER,
    configPath,
    fsApi: mem.api,
  });
  assert.equal(result.status, 'connected');
  assert.deepEqual(mem.ops, [
    `copy ${configPath} -> ${configPath}.bak`,
    `write ${configPath}`,
  ]);
  assert.equal(mem.files[`${configPath}.bak`], original);
  assert.deepEqual(JSON.parse(mem.files[configPath]).mcpServers, {
    other: { command: 'x' },
    translator: { command: LAUNCHER },
  });
});

test('Claude Desktop connect creates the folder when there is no config', () => {
  const configPath = '/cfg/Claude/claude_desktop_config.json';
  const mem = memoryFs({});
  const result = connectClaudeDesktop({
    launcherPath: LAUNCHER,
    configPath,
    fsApi: mem.api,
  });
  assert.equal(result.status, 'connected');
  assert.deepEqual(mem.ops, ['mkdir /cfg/Claude', `write ${configPath}`]);
});

test('Claude Desktop connect reports a broken config without writing', () => {
  const configPath = '/cfg/Claude/claude_desktop_config.json';
  const mem = memoryFs({ [configPath]: '{oops' });
  const result = connectClaudeDesktop({
    launcherPath: LAUNCHER,
    configPath,
    fsApi: mem.api,
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(mem.ops, []);
  assert.equal(mem.files[configPath], '{oops');
});
