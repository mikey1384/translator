import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// One-click registration of the Translator MCP launcher with the agent apps
// people already pay for: Claude Code and Codex (through their own CLIs) and
// Claude Desktop (through its JSON config). No shell is involved anywhere.

export type AgentMcpClient = 'claude-code' | 'codex' | 'claude-desktop';

export type AgentMcpConnectResult =
  | {
      status: 'connected' | 'already-connected';
      client: AgentMcpClient;
      configPath?: string;
      backupPath?: string;
    }
  | {
      // The CLI is not installed where we can find it; the user can paste this.
      status: 'cli-not-found';
      client: AgentMcpClient;
      command: string;
    }
  | {
      status: 'failed';
      client: AgentMcpClient;
      message: string;
      command?: string;
    };

export const TRANSLATOR_MCP_SERVER_NAME = 'translator';

type CliName = 'claude' | 'codex';

const CLI_FOR_CLIENT: Record<'claude-code' | 'codex', CliName> = {
  'claude-code': 'claude',
  codex: 'codex',
};

export function isAgentMcpClient(value: unknown): value is AgentMcpClient {
  return (
    value === 'claude-code' || value === 'codex' || value === 'claude-desktop'
  );
}

export function buildMcpAddArgs(
  client: 'claude-code' | 'codex',
  launcherPath: string
): string[] {
  // Claude Code defaults to a per-project scope, which would bind the server to
  // whatever directory the app happens to run in; user scope works everywhere.
  const scope = client === 'claude-code' ? ['--scope', 'user'] : [];
  return [
    'mcp',
    'add',
    ...scope,
    TRANSLATOR_MCP_SERVER_NAME,
    '--',
    launcherPath,
  ];
}

function quoteForDisplay(arg: string, platform: NodeJS.Platform): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(arg)) return arg;
  if (platform === 'win32') return `"${arg.replace(/"/g, '""')}"`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function formatCommandForCopy(
  cli: string,
  args: string[],
  platform: NodeJS.Platform
): string {
  return [cli, ...args].map(part => quoteForDisplay(part, platform)).join(' ');
}

export type CliSearchEnv = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  isExecutable: (filePath: string) => boolean;
  listDir?: (dirPath: string) => string[];
};

// GUI apps on macOS start with a minimal PATH, so the usual install locations
// are searched as well as PATH itself.
export function getCliSearchDirs({
  platform,
  env,
  homeDir,
  listDir,
}: Omit<CliSearchEnv, 'isExecutable'>): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const fromPath = String(env.PATH || env.Path || '')
    .split(platform === 'win32' ? ';' : ':')
    .map(dir => dir.trim())
    .filter(Boolean);
  const common =
    platform === 'win32'
      ? [
          p.join(homeDir, '.local', 'bin'),
          env.APPDATA ? p.join(env.APPDATA, 'npm') : '',
          env.LOCALAPPDATA
            ? p.join(env.LOCALAPPDATA, 'Programs', 'claude')
            : '',
        ]
      : [
          p.join(homeDir, '.local', 'bin'),
          p.join(homeDir, '.claude', 'local'),
          '/opt/homebrew/bin',
          '/usr/local/bin',
          p.join(homeDir, '.npm-global', 'bin'),
          p.join(homeDir, '.npm-packages', 'bin'),
          p.join(homeDir, '.bun', 'bin'),
          p.join(homeDir, '.volta', 'bin'),
          p.join(homeDir, 'Library', 'pnpm'),
          '/usr/bin',
        ];
  const nvmDirs: string[] = [];
  if (platform !== 'win32' && listDir) {
    const nvmRoot = p.join(homeDir, '.nvm', 'versions', 'node');
    try {
      for (const version of listDir(nvmRoot).sort().reverse()) {
        nvmDirs.push(p.join(nvmRoot, version, 'bin'));
      }
    } catch {
      // No nvm install.
    }
  }
  return [...new Set([...fromPath, ...common, ...nvmDirs].filter(Boolean))];
}

export function findAgentCli(
  cli: CliName,
  search: CliSearchEnv
): string | null {
  const p = search.platform === 'win32' ? path.win32 : path.posix;
  // Windows only runs .exe directly without a shell; npm's .cmd shims would
  // need cmd.exe, so those fall back to the copyable command.
  const names = search.platform === 'win32' ? [`${cli}.exe`] : [cli];
  for (const dir of getCliSearchDirs(search)) {
    for (const name of names) {
      const candidate = p.join(dir, name);
      if (search.isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

export function defaultIsExecutable(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export type ExecFileLike = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean }
) => Promise<{ stdout: string; stderr: string }>;

export const defaultExecFile: ExecFileLike = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { ...options, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, {
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
          });
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      }
    );
  });

function isAlreadyExistsOutput(text: string): boolean {
  return /already exists|already configured|already added/i.test(text);
}

export async function connectAgentCli({
  client,
  launcherPath,
  search,
  exec = defaultExecFile,
}: {
  client: 'claude-code' | 'codex';
  launcherPath: string;
  search: CliSearchEnv;
  exec?: ExecFileLike;
}): Promise<AgentMcpConnectResult> {
  const cli = CLI_FOR_CLIENT[client];
  const args = buildMcpAddArgs(client, launcherPath);
  const command = formatCommandForCopy(cli, args, search.platform);
  const cliPath = findAgentCli(cli, search);
  if (!cliPath) {
    return { status: 'cli-not-found', client, command };
  }

  // npm-installed CLIs are `#!/usr/bin/env node` scripts; give them the same
  // search dirs so node resolves even from a GUI-launched app.
  const delimiter = search.platform === 'win32' ? ';' : ':';
  const env = {
    ...search.env,
    PATH: [
      (search.platform === 'win32' ? path.win32 : path.posix).dirname(cliPath),
      ...getCliSearchDirs(search),
    ].join(delimiter),
  };

  try {
    const { stdout, stderr } = await exec(cliPath, args, {
      env,
      timeout: 30_000,
      windowsHide: true,
    });
    if (isAlreadyExistsOutput(`${stdout}\n${stderr}`)) {
      return { status: 'already-connected', client };
    }
    return { status: 'connected', client };
  } catch (error: any) {
    const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
    if (isAlreadyExistsOutput(output)) {
      return { status: 'already-connected', client };
    }
    const detail =
      String(error?.stderr || '').trim() ||
      String(error?.stdout || '').trim() ||
      String(error?.message || error);
    return {
      status: 'failed',
      client,
      message: detail.slice(0, 600),
      command,
    };
  }
}

export function getClaudeDesktopConfigPath({
  platform,
  env,
  homeDir,
}: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homeDir: string;
}): string {
  if (platform === 'win32') {
    const appData =
      env.APPDATA || path.win32.join(homeDir, 'AppData', 'Roaming');
    return path.win32.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  if (platform === 'darwin') {
    return path.posix.join(
      homeDir,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    );
  }
  return path.posix.join(
    env.XDG_CONFIG_HOME || path.posix.join(homeDir, '.config'),
    'Claude',
    'claude_desktop_config.json'
  );
}

export class ClaudeDesktopConfigError extends Error {}

// Adds (or points) the translator server at the launcher, leaving everything
// else in the file untouched. Refuses to rewrite a file it cannot parse.
export function mergeClaudeDesktopConfig(
  existingText: string | null,
  launcherPath: string
): { text: string; changed: boolean } {
  let config: Record<string, unknown> = {};
  if (existingText !== null && existingText.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existingText.replace(/^\uFEFF/, ''));
    } catch {
      throw new ClaudeDesktopConfigError(
        'claude_desktop_config.json is not valid JSON, so it was left unchanged.'
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ClaudeDesktopConfigError(
        'claude_desktop_config.json does not contain a JSON object, so it was left unchanged.'
      );
    }
    config = parsed as Record<string, unknown>;
  }

  const rawServers = config.mcpServers;
  if (
    rawServers !== undefined &&
    (!rawServers || typeof rawServers !== 'object' || Array.isArray(rawServers))
  ) {
    throw new ClaudeDesktopConfigError(
      '"mcpServers" in claude_desktop_config.json is not an object, so it was left unchanged.'
    );
  }
  const servers = { ...((rawServers as Record<string, unknown>) ?? {}) };
  const current = servers[TRANSLATOR_MCP_SERVER_NAME] as
    | Record<string, unknown>
    | undefined;
  const alreadyCurrent =
    !!current &&
    typeof current === 'object' &&
    current.command === launcherPath &&
    (current.args === undefined ||
      (Array.isArray(current.args) && current.args.length === 0));
  if (alreadyCurrent) {
    return { text: existingText ?? '', changed: false };
  }

  servers[TRANSLATOR_MCP_SERVER_NAME] = { command: launcherPath };
  const next = { ...config, mcpServers: servers };
  return { text: `${JSON.stringify(next, null, 2)}\n`, changed: true };
}

export type ConfigFs = {
  readFile: (filePath: string) => string | null;
  writeFile: (filePath: string, text: string) => void;
  copyFile: (from: string, to: string) => void;
  mkdirp: (dirPath: string) => void;
};

export const defaultConfigFs: ConfigFs = {
  readFile: filePath => {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  },
  writeFile: (filePath, text) => {
    const tmp = `${filePath}.translator-tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, filePath);
  },
  copyFile: (from, to) => fs.copyFileSync(from, to),
  mkdirp: dirPath => fs.mkdirSync(dirPath, { recursive: true }),
};

export function connectClaudeDesktop({
  launcherPath,
  configPath,
  fsApi = defaultConfigFs,
}: {
  launcherPath: string;
  configPath: string;
  fsApi?: ConfigFs;
}): AgentMcpConnectResult {
  try {
    const existing = fsApi.readFile(configPath);
    const merged = mergeClaudeDesktopConfig(existing, launcherPath);
    if (!merged.changed) {
      return {
        status: 'already-connected',
        client: 'claude-desktop',
        configPath,
      };
    }
    let backupPath: string | undefined;
    if (existing !== null) {
      backupPath = `${configPath}.bak`;
      fsApi.copyFile(configPath, backupPath);
    } else {
      fsApi.mkdirp(path.dirname(configPath));
    }
    fsApi.writeFile(configPath, merged.text);
    return {
      status: 'connected',
      client: 'claude-desktop',
      configPath,
      backupPath,
    };
  } catch (error: any) {
    return {
      status: 'failed',
      client: 'claude-desktop',
      message: String(error?.message || error),
    };
  }
}

export async function connectAgentMcpClient({
  client,
  launcherPath,
}: {
  client: AgentMcpClient;
  launcherPath: string | null;
}): Promise<AgentMcpConnectResult> {
  if (!launcherPath) {
    return {
      status: 'failed',
      client,
      message:
        'The MCP launcher is only available in the installed Translator app.',
    };
  }
  const homeDir = os.homedir();
  if (client === 'claude-desktop') {
    return connectClaudeDesktop({
      launcherPath,
      configPath: getClaudeDesktopConfigPath({
        platform: process.platform,
        env: process.env,
        homeDir,
      }),
    });
  }
  return connectAgentCli({
    client,
    launcherPath,
    search: {
      platform: process.platform,
      env: process.env,
      homeDir,
      isExecutable: defaultIsExecutable,
      listDir: dirPath => fs.readdirSync(dirPath),
    },
  });
}
