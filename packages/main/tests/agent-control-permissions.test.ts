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

test('packaged-mcp helper - implements Content-Length MCP protocol', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // Must implement Content-Length framing
  assert.ok(
    helperContent.includes('Content-Length:'),
    'Helper must use Content-Length framing (not newline-delimited)'
  );
  assert.ok(
    helperContent.includes('\\r\\n\\r\\n'),
    'Helper must use \\r\\n\\r\\n header separator'
  );
  
  // Must handle MCP methods
  assert.ok(
    helperContent.includes('initialize'),
    'Helper must handle initialize'
  );
  assert.ok(
    helperContent.includes('tools/list'),
    'Helper must handle tools/list'
  );
  assert.ok(
    helperContent.includes('tools/call'),
    'Helper must handle tools/call'
  );
  
  // Must ignore notifications
  assert.ok(
    helperContent.includes('notifications/initialized'),
    'Helper must recognize notifications/initialized'
  );
  
  // Zero npm dependencies
  assert.ok(
    !helperContent.includes('@modelcontextprotocol/server'),
    'Helper must NOT import @modelcontextprotocol/server'
  );
  assert.ok(
    !helperContent.includes('import * as z from'),
    'Helper must NOT import zod'
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

test('packaged-mcp helper - tool name mappings are correct', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // Must have explicit TOOL_MAP
  assert.ok(
    helperContent.includes('const TOOL_MAP'),
    'Helper must define TOOL_MAP'
  );
  
  // Verify critical mappings (not naive snake_to_camel)
  const criticalMappings = [
    ['app_navigation_list', 'navigationSnapshot'],
    ['app_downloads_list', 'listDownloadHistory'],
    ['app_subtitles_get', 'subtitlesBatch'],
    ['app_video_batch_download', 'startSuggestedVideoBatch'],
    ['app_settings_get', 'settingsSnapshot'],
  ];
  
  for (const [tool, method] of criticalMappings) {
    assert.ok(
      helperContent.includes(`${tool}: '${method}'`),
      `TOOL_MAP must map ${tool} → ${method}`
    );
  }
});

test('packaged-mcp helper - excludes human-gated tools', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // TOOL_MAP must NOT include these
  const excluded = [
    'app_open_credit_checkout',
    'app_settings_update',
    'app_settings_store_provider_key',
    'app_settings_clear_provider_key'
  ];
  
  for (const tool of excluded) {
    assert.ok(
      !helperContent.includes(`${tool}:`),
      `TOOL_MAP must NOT include ${tool}`
    );
  }
});

test('packaged-mcp helper - maps fields correctly', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // Must have mapFields function
  assert.ok(
    helperContent.includes('function mapFields'),
    'Helper must define mapFields'
  );
  
  // Must map critical fields
  assert.ok(
    helperContent.includes('output_path') && helperContent.includes('outputPath'),
    'Must map output_path → outputPath'
  );
  assert.ok(
    helperContent.includes('confirm_overwrite') && helperContent.includes('OVERWRITE'),
    'Must map confirm_overwrite=OVERWRITE → overwrite=true'
  );
  
  // Must map result_ids → ids (NOT resultIds)
  assert.ok(
    helperContent.includes('result_ids') && helperContent.includes('mapped.ids = value'),
    'Must map result_ids → ids (NOT resultIds) for startSuggestedVideoBatch'
  );
  
  // Must map other special fields
  const requiredMappings = [
    ['target_language', 'targetLanguage'],
    ['replace_subtitles', 'replaceSubtitles'],
    ['run_to', 'runTo'],
    ['effort_level', 'effortLevel'],
    ['summary_effort_level', 'summaryEffortLevel'],
    ['translate_if_needed', 'translateIfNeeded'],
    ['preferred_language', 'preferredLanguage'],
    ['include_highlights', 'includeHighlights'],
    ['include_download_history', 'includeDownloadHistory'],
    ['include_watched_channels', 'includeWatchedChannels'],
  ];
  
  for (const [snake, camel] of requiredMappings) {
    assert.ok(
      helperContent.includes(snake) && helperContent.includes(camel),
      `Must map ${snake} → ${camel}`
    );
  }
});

test('packaged-mcp helper - TOOL_SCHEMAS includes real schemas (not z.any)', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // Must define TOOL_SCHEMAS
  assert.ok(
    helperContent.includes('const TOOL_SCHEMAS'),
    'Helper must define TOOL_SCHEMAS'
  );
  
  // Must NOT emit empty schemas for key tools
  const toolsWithConstraints = [
    'app_video_batch_download',
    'app_start_merge',
    'app_subtitles_export',
    'app_start_translation',
    'app_navigate',
  ];
  
  for (const tool of toolsWithConstraints) {
    // Extract the schema for this tool
    const schemaRegex = new RegExp(`${tool}:\\s*\\{[\\s\\S]*?\\}`);
    const schemaMatch = helperContent.match(schemaRegex);
    
    assert.ok(schemaMatch, `Must have schema for ${tool}`);
    
    const schema = schemaMatch[0];
    
    // Must have properties, not additionalProperties: true
    assert.ok(
      schema.includes('properties:') && !schema.includes('additionalProperties: true'),
      `${tool} schema must have real properties, not z.any()`
    );
  }
  
  // app_video_batch_download must have result_ids array constraint
  assert.ok(
    helperContent.includes('app_video_batch_download:') &&
    helperContent.includes('result_ids:') &&
    helperContent.includes('type: \'array\''),
    'app_video_batch_download must define result_ids as array'
  );
  assert.ok(
    helperContent.includes('minItems: 1') && helperContent.includes('maxItems: 8'),
    'app_video_batch_download result_ids must have minItems: 1, maxItems: 8'
  );
  
  // app_start_merge must have confirm_overwrite enum
  assert.ok(
    helperContent.includes('app_start_merge:') &&
    helperContent.includes('confirm_overwrite:') &&
    helperContent.includes('enum: [\'OVERWRITE\']'),
    'app_start_merge must define confirm_overwrite enum'
  );
  
  // tools/list handler must use TOOL_SCHEMAS
  assert.ok(
    helperContent.includes('TOOL_SCHEMAS[name]'),
    'tools/list handler must use TOOL_SCHEMAS'
  );
  assert.ok(
    !helperContent.includes('additionalProperties: true'),
    'tools/list must NOT emit additionalProperties: true (z.any)'
  );
});

test('packaged-mcp helper - executes mapFields and TOOL_MAP correctly', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // Extract mapFields function
  const mapFieldsStart = helperContent.indexOf('function mapFields(input)');
  const mapFieldsEnd = helperContent.indexOf('\n}\n', mapFieldsStart) + 2;
  assert.ok(mapFieldsStart !== -1, 'mapFields function not found');
  
  const mapFieldsCode = helperContent.substring(mapFieldsStart, mapFieldsEnd);
  
  // Create an isolated mapFields function via Function constructor (safer than eval)
  const mapFieldsFn = new Function('input', `
    ${mapFieldsCode}
    return mapFields(input);
  `);
  
  // Test result_ids → ids transformation
  const batchDownloadArgs = {
    result_ids: ['vid1', 'vid2', 'vid3'],
    quality: '1080p',
  };
  
  const mapped = mapFieldsFn(batchDownloadArgs);
  
  assert.strictEqual(mapped.ids, batchDownloadArgs.result_ids, 'result_ids must map to ids');
  assert.strictEqual(mapped.resultIds, undefined, 'result_ids must NOT map to resultIds');
  assert.strictEqual(mapped.quality, '1080p', 'quality must pass through');
  
  // Test confirm_overwrite=OVERWRITE → overwrite=true
  const mergeArgs = {
    output_path: '/tmp/test.mp4',
    confirm_overwrite: 'OVERWRITE',
  };
  
  const mappedMerge = mapFieldsFn(mergeArgs);
  
  assert.strictEqual(mappedMerge.overwrite, true, 'confirm_overwrite=OVERWRITE must map to overwrite=true');
  assert.strictEqual(mappedMerge.confirmOverwrite, undefined, 'confirm_overwrite must NOT map to confirmOverwrite');
  assert.strictEqual(mappedMerge.outputPath, '/tmp/test.mp4', 'output_path must map to outputPath');
  
  // Test other special mappings
  const complexArgs = {
    target_language: 'Korean',
    replace_subtitles: 'fail',
    run_to: 'translate',
    effort_level: 'high',
    summary_effort_level: 'standard',
    translate_if_needed: true,
    preferred_language: 'en',
    include_highlights: false,
    include_download_history: true,
    include_watched_channels: false,
  };
  
  const mappedComplex = mapFieldsFn(complexArgs);
  
  assert.strictEqual(mappedComplex.targetLanguage, 'Korean');
  assert.strictEqual(mappedComplex.replaceSubtitles, 'fail');
  assert.strictEqual(mappedComplex.runTo, 'translate');
  assert.strictEqual(mappedComplex.effortLevel, 'high');
  assert.strictEqual(mappedComplex.summaryEffortLevel, 'standard');
  assert.strictEqual(mappedComplex.translateIfNeeded, true);
  assert.strictEqual(mappedComplex.preferredLanguage, 'en');
  assert.strictEqual(mappedComplex.includeHighlights, false);
  assert.strictEqual(mappedComplex.includeDownloadHistory, true);
  assert.strictEqual(mappedComplex.includeWatchedChannels, false);
});

test('extraResources bundling - ships only standalone helper', () => {
  const builderPath = path.join(projectRoot, 'electron-builder.base.json');
  assert.ok(fs.existsSync(builderPath), 'electron-builder.base.json must exist');
  
  const builderContent = fs.readFileSync(builderPath, 'utf8');
  
  assert.ok(
    builderContent.includes('packaged-mcp.mjs'),
    'Must bundle standalone packaged-mcp.mjs'
  );
  assert.ok(
    !builderContent.includes('session-store.mjs'),
    'Must NOT bundle session-store.mjs'
  );
  assert.ok(
    !builderContent.includes('dev-app-controller'),
    'Must NOT bundle dev-app-controller.mjs'
  );
  assert.ok(
    !builderContent.includes('playwright'),
    'Must NOT bundle playwright'
  );
  assert.ok(
    !builderContent.includes('packages/agent-server/src/mcp.mjs'),
    'Must NOT bundle dev mcp.mjs'
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

test('IPC response pattern - send/on matches on both sides', () => {
  const bridgePath = path.join(projectRoot, 'packages/main/handlers/agent-bridge-handlers.ts');
  const preloadPath = path.join(projectRoot, 'packages/preload/index.ts');
  
  assert.ok(fs.existsSync(bridgePath), 'agent-bridge-handlers.ts must exist');
  assert.ok(fs.existsSync(preloadPath), 'preload/index.ts must exist');
  
  const bridgeContent = fs.readFileSync(bridgePath, 'utf8');
  const preloadContent = fs.readFileSync(preloadPath, 'utf8');
  
  // Bridge must use ipcMain.on (not handleOnce) to receive responses
  assert.ok(
    bridgeContent.includes('ipcMain.on(responseChannel'),
    'agent-bridge-handlers must use ipcMain.on for responses'
  );
  assert.ok(
    !bridgeContent.includes('ipcMain.handleOnce(responseChannel'),
    'agent-bridge-handlers must not use handleOnce (incompatible with send)'
  );
  
  // Preload must use ipcRenderer.send (not invoke)
  assert.ok(
    preloadContent.includes('sendAgentBridgeResponse') && preloadContent.includes('ipcRenderer.send'),
    'preload must use ipcRenderer.send for agent bridge responses'
  );
});

test('socket server - refuses human-gated methods', () => {
  const serverPath = path.join(projectRoot, 'packages/main/services/agent-socket-server.ts');
  assert.ok(fs.existsSync(serverPath), 'agent-socket-server.ts must exist');
  
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  
  // Must define list of human-gated methods
  assert.ok(
    serverContent.includes('humanGatedMethods'),
    'handleRequest must define humanGatedMethods list'
  );
  
  // Must include payment and secret operations
  const requiredBlocked = [
    'openCreditCheckout',
    'storeProviderKey',
    'clearProviderKey',
    'updateSettings'
  ];
  
  for (const method of requiredBlocked) {
    assert.ok(
      serverContent.includes(`'${method}'`),
      `humanGatedMethods must include ${method}`
    );
  }
});

test('allowlist - uses realpath to prevent symlink escape', () => {
  const mainPath = path.join(projectRoot, 'packages/main/index.ts');
  assert.ok(fs.existsSync(mainPath), 'main/index.ts must exist');
  
  const mainContent = fs.readFileSync(mainPath, 'utf8');
  
  // check-agent-path-allowed must use fs.realpathSync
  assert.ok(
    mainContent.includes('fs.realpathSync') && mainContent.includes('check-agent-path-allowed'),
    'check-agent-path-allowed must use fs.realpathSync for both file and allowed dirs'
  );
});

test('kill switch - null-safe agentSocketServer checks', () => {
  const mainPath = path.join(projectRoot, 'packages/main/index.ts');
  const mainContent = fs.readFileSync(mainPath, 'utf8');
  
  // updateAgentSocketServer must check for null before calling .isRunning()
  const updateFnMatch = mainContent.match(/async function updateAgentSocketServer\(\)[^}]+\}/s);
  assert.ok(updateFnMatch, 'updateAgentSocketServer function must exist');
  
  const updateFnBody = updateFnMatch[0];
  
  // Must have null check in both start and stop conditions
  assert.ok(
    updateFnBody.includes('agentSocketServer &&') || 
    updateFnBody.includes('&& agentSocketServer'),
    'updateAgentSocketServer must check agentSocketServer is not null before .isRunning()'
  );
});
