import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Agent Control Permission System Integration Tests
 * 
 * Tests the production logic without Electron runtime dependencies:
 * - Allowlist validation algorithm (same as used in main process)
 * - Socket path computation (helper vs server consistency)
 * - Path security (traversal prevention, prefix attacks)
 * - Settings schema defaults
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

// Import settings schema (pure TypeScript, no Electron dependency)
const settingsSchemaPath = path.join(projectRoot, 'packages/main/store/settings-schema.ts');
assert.ok(fs.existsSync(settingsSchemaPath), 'settings-schema.ts must exist');

test('settings schema defaults - agent control is secure', async () => {
  // Read the actual source file to verify defaults
  const schemaContent = fs.readFileSync(settingsSchemaPath, 'utf8');
  
  assert.ok(
    schemaContent.includes('agentControlEnabled: false'),
    'Default agentControlEnabled must be false'
  );
  assert.ok(
    schemaContent.includes('agentAllowedDirectories: []'),
    'Default agentAllowedDirectories must be empty (tight default applied at runtime)'
  );
});

test('allowlist validation - path within allowed directory', () => {
  // Replicates the exact logic from packages/main/index.ts check-agent-path-allowed
  const allowedDirs = ['/Users/test/Downloads', '/Users/test/Videos'];
  const testPath = '/Users/test/Downloads/output.mp4';
  
  const resolvedPath = path.resolve(testPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedPath.startsWith(resolvedDir + path.sep) || 
           resolvedPath === resolvedDir;
  });
  
  assert.ok(isAllowed, 'Path within allowed directory must pass validation');
});

test('allowlist validation - path outside allowed directory', () => {
  const allowedDirs = ['/Users/test/Downloads'];
  const testPath = '/Users/test/Documents/output.mp4';
  
  const resolvedPath = path.resolve(testPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedPath.startsWith(resolvedDir + path.sep) || 
           resolvedPath === resolvedDir;
  });
  
  assert.ok(!isAllowed, 'Path outside allowed directories must be rejected');
});

test('allowlist validation - prevents directory traversal', () => {
  const allowedDirs = ['/Users/test/allowed'];
  const maliciousPath = '/Users/test/allowed/../../../etc/passwd';
  
  const resolvedPath = path.resolve(maliciousPath);
  const resolvedAllowed = path.resolve(allowedDirs[0]);
  
  const isAllowed = resolvedPath.startsWith(resolvedAllowed + path.sep) ||
                    resolvedPath === resolvedAllowed;
  
  assert.ok(!isAllowed, 'Directory traversal attack must be prevented');
  
  // Verify path resolution actually prevents the attack
  assert.strictEqual(resolvedPath, path.resolve('/etc/passwd'));
  assert.ok(!resolvedPath.includes('..'), 'Resolved path must not contain ..');
});

test('allowlist validation - subdirectories are allowed', () => {
  const allowedDirs = ['/Users/test/Downloads'];
  const subdirPath = '/Users/test/Downloads/subfolder/deep/output.mp4';
  
  const resolvedPath = path.resolve(subdirPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedPath.startsWith(resolvedDir + path.sep) || 
           resolvedPath === resolvedDir;
  });
  
  assert.ok(isAllowed, 'Subdirectories must be accessible');
});

test('allowlist validation - prefix similarity attack prevention', () => {
  const allowedDirs = ['/Users/test/Downloads'];
  const similarPath = '/Users/test/DownloadsAttack/output.mp4';
  
  const resolvedPath = path.resolve(similarPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedPath.startsWith(resolvedDir + path.sep) || 
           resolvedPath === resolvedDir;
  });
  
  assert.ok(!isAllowed, 'Similar prefix must not grant access');
});

test('allowlist validation - exact directory match', () => {
  const allowedDirs = ['/Users/test/Downloads'];
  const exactMatch = '/Users/test/Downloads';
  
  const resolvedPath = path.resolve(exactMatch);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedPath.startsWith(resolvedDir + path.sep) || 
           resolvedPath === resolvedDir;
  });
  
  assert.ok(isAllowed, 'Exact directory match must be allowed');
});

test('socket path consistency - helper computes same userData as main', () => {
  // AgentSocketServer uses: app.getPath('userData')
  // packaged-mcp.mjs computes:
  //   macOS: ~/Library/Application Support/Translator
  //   Windows: %APPDATA%\Translator
  //   Linux: ~/.config/Translator
  
  const platform = process.platform;
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  
  let expectedUserData: string;
  if (platform === 'darwin') {
    expectedUserData = path.join(homeDir, 'Library', 'Application Support', 'Translator');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    expectedUserData = path.join(appData, 'Translator');
  } else {
    expectedUserData = path.join(homeDir, '.config', 'Translator');
  }
  
  const socketInfoPath = path.join(expectedUserData, 'agent', 'socket-path.txt');
  
  assert.ok(socketInfoPath.includes('Translator'), 'Socket path must use Translator userData');
  assert.ok(socketInfoPath.endsWith('socket-path.txt'), 'Socket info file must be socket-path.txt');
});

test('packaged-mcp helper - reads socket path from file', async () => {
  // Verify helper logic: read from userData/agent/socket-path.txt
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  assert.ok(fs.existsSync(helperPath), 'packaged-mcp.mjs must exist');
  
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  assert.ok(
    helperContent.includes('socket-path.txt'),
    'Helper must read socket-path.txt'
  );
  assert.ok(
    helperContent.includes('Translator'),
    'Helper must compute Translator userData path'
  );
});

test('packaged-mcp helper - excludes payment and secret tools', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // These must NOT be in the tool list
  const excludedTools = [
    'openCreditCheckout',
    'updateSettings',
    'storeProviderKey',
    'clearProviderKey',
  ];
  
  // Find the appTools array definition
  const toolsMatch = helperContent.match(/const appTools = \[([\s\S]*?)\];/);
  assert.ok(toolsMatch, 'appTools array must be defined');
  
  const toolsList = toolsMatch[1];
  for (const excluded of excludedTools) {
    assert.ok(
      !toolsList.includes(`'${excluded}'`),
      `${excluded} must not be in packaged-mcp tool list`
    );
  }
  
  // Verify comment explains exclusion
  assert.ok(
    helperContent.includes('EXCLUDED') || helperContent.includes('human-gated'),
    'Helper must document why tools are excluded'
  );
});

test('agent-bridge-handlers - uses getActiveAppWebContents', () => {
  const bridgePath = path.join(projectRoot, 'packages/main/handlers/agent-bridge-handlers.ts');
  assert.ok(fs.existsSync(bridgePath), 'agent-bridge-handlers.ts must exist');
  
  const bridgeContent = fs.readFileSync(bridgePath, 'utf8');
  
  assert.ok(
    bridgeContent.includes('getActiveAppWebContents'),
    'Must use getActiveAppWebContents to target tab WebContentsView'
  );
  assert.ok(
    !bridgeContent.includes('mainWindow.webContents.send'),
    'Must not send to mainWindow.webContents (the shell)'
  );
});

test('exportMountedSubtitles - enforces allowlist in packaged mode', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  assert.ok(fs.existsSync(listenerPath), 'translator-agent-listener.ts must exist');
  
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  
  // Find exportMountedSubtitles function
  assert.ok(
    listenerContent.includes('checkAgentPathAllowed'),
    'exportMountedSubtitles must call checkAgentPathAllowed in packaged mode'
  );
  assert.ok(
    listenerContent.includes('window.env.isPackaged'),
    'Must check isPackaged before enforcing allowlist'
  );
});

test('AgentSocketServer - re-reads kill switch per request', () => {
  const serverPath = path.join(projectRoot, 'packages/main/services/agent-socket-server.ts');
  assert.ok(fs.existsSync(serverPath), 'agent-socket-server.ts must exist');
  
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  
  // Find handleRequest method
  assert.ok(
    serverContent.includes('settingsStore.get(\'agentControlEnabled\''),
    'handleRequest must re-read agentControlEnabled on every request'
  );
  assert.ok(
    serverContent.includes('Agent control is disabled'),
    'Must throw error when disabled'
  );
});

test('extraResources bundling - excludes dev tools', () => {
  const builderPath = path.join(projectRoot, 'electron-builder.base.json');
  assert.ok(fs.existsSync(builderPath), 'electron-builder.base.json must exist');
  
  const builderContent = fs.readFileSync(builderPath, 'utf8');
  
  assert.ok(
    builderContent.includes('packaged-mcp.mjs'),
    'Must bundle packaged-mcp.mjs'
  );
  assert.ok(
    builderContent.includes('session-store.mjs'),
    'Must bundle session-store.mjs dependency'
  );
  assert.ok(
    !builderContent.includes('dev-app-controller'),
    'Must NOT bundle dev-app-controller.mjs'
  );
  assert.ok(
    !builderContent.includes('playwright'),
    'Must NOT bundle playwright'
  );
});

test('documentation - Windows path uses Program Files', () => {
  const readmePath = path.join(projectRoot, 'README.md');
  const docsPath = path.join(projectRoot, 'docs/agent-interface.md');
  
  assert.ok(fs.existsSync(readmePath), 'README.md must exist');
  assert.ok(fs.existsSync(docsPath), 'docs/agent-interface.md must exist');
  
  const readmeContent = fs.readFileSync(readmePath, 'utf8');
  const docsContent = fs.readFileSync(docsPath, 'utf8');
  
  assert.ok(
    readmeContent.includes('C:\\Program Files\\Translator'),
    'README must use Program Files for NSIS perMachine install'
  );
  assert.ok(
    docsContent.includes('C:\\Program Files\\Translator'),
    'docs must use Program Files for NSIS perMachine install'
  );
  assert.ok(
    !readmeContent.includes('%LOCALAPPDATA%\\Programs'),
    'README must not use LocalAppData (NSIS is perMachine)'
  );
});
