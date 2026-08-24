import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  PACKAGED_AGENT_METHODS,
  PACKAGED_TOOL_MAP,
} from '../../agent-server/src/packaged-tool-map.mjs';
import { getPackagedSocketPath } from '../../agent-server/src/packaged-socket-path.mjs';

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
const settingsSchemaPath = path.join(
  projectRoot,
  'packages/main/store/settings-schema.ts'
);
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

test('agent control setting fails closed on non-boolean persisted or IPC values', () => {
  const handlersPath = path.join(
    projectRoot,
    'packages/main/handlers/settings-handlers.ts'
  );
  const mainPath = path.join(projectRoot, 'packages/main/index.ts');
  const handlersContent = fs.readFileSync(handlersPath, 'utf8');
  const mainContent = fs.readFileSync(mainPath, 'utf8');

  assert.ok(
    handlersContent.includes(') === true') &&
      handlersContent.includes("typeof value !== 'boolean'") &&
      mainContent.includes(
        "error: 'Agent control enabled must be a boolean'"
      ) &&
      mainContent.includes(
        "settingsStore.get('agentControlEnabled', false) === true"
      ),
    'corrupt strings such as "false" must never coerce to enabled agent control'
  );
});

test('agent control publishes and returns authoritative latest state', () => {
  const mainPath = path.join(projectRoot, 'packages/main/index.ts');
  const settingsPath = path.join(
    projectRoot,
    'packages/renderer/containers/SettingsPage/AgentControlSection.tsx'
  );
  const mainContent = fs.readFileSync(mainPath, 'utf8');
  const settingsContent = fs.readFileSync(settingsPath, 'utf8');

  assert.ok(
    mainContent.includes(
      'const actualEnabled = settingsHandlers.getAgentControlEnabled()'
    ) &&
      mainContent.includes(
        "broadcastToApp('agent-control-changed', { enabled: actualEnabled })"
      ) &&
      mainContent.includes('return { ...result, enabled: actualEnabled }'),
    'queued toggles must not publish their stale request value'
  );
  assert.ok(
    settingsContent.includes('setEnabled(result.enabled)') &&
      settingsContent.includes('SystemIPC.onAgentControlChanged') &&
      settingsContent.includes('authoritativeRevisionRef.current') &&
      settingsContent.includes('disabled={updating}'),
    'settings UI must reconcile authoritative and fail-closed changes'
  );
});

test('allowlist validation - path within allowed directory', () => {
  // Replicates the exact logic from packages/main/index.ts check-agent-path-allowed
  const allowedDirs = ['/Users/test/Downloads', '/Users/test/Videos'];
  const testPath = '/Users/test/Downloads/output.mp4';

  const resolvedPath = path.resolve(testPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return (
      resolvedPath.startsWith(resolvedDir + path.sep) ||
      resolvedPath === resolvedDir
    );
  });

  assert.ok(isAllowed, 'Path within allowed directory must pass validation');
});

test('allowlist validation - path outside allowed directory', () => {
  const allowedDirs = ['/Users/test/Downloads'];
  const testPath = '/Users/test/Documents/output.mp4';

  const resolvedPath = path.resolve(testPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return (
      resolvedPath.startsWith(resolvedDir + path.sep) ||
      resolvedPath === resolvedDir
    );
  });

  assert.ok(!isAllowed, 'Path outside allowed directories must be rejected');
});

test('allowlist validation - prevents directory traversal', () => {
  const allowedDirs = ['/Users/test/allowed'];
  const maliciousPath = '/Users/test/allowed/../../../etc/passwd';

  const resolvedPath = path.resolve(maliciousPath);
  const resolvedAllowed = path.resolve(allowedDirs[0]);

  const isAllowed =
    resolvedPath.startsWith(resolvedAllowed + path.sep) ||
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
    return (
      resolvedPath.startsWith(resolvedDir + path.sep) ||
      resolvedPath === resolvedDir
    );
  });

  assert.ok(isAllowed, 'Subdirectories must be accessible');
});

test('allowlist validation - prefix similarity attack prevention', () => {
  const allowedDirs = ['/Users/test/Downloads'];
  const similarPath = '/Users/test/DownloadsAttack/output.mp4';

  const resolvedPath = path.resolve(similarPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return (
      resolvedPath.startsWith(resolvedDir + path.sep) ||
      resolvedPath === resolvedDir
    );
  });

  assert.ok(!isAllowed, 'Similar prefix must not grant access');
});

test('allowlist validation - exact directory match', () => {
  const allowedDirs = ['/Users/test/Downloads'];
  const exactMatch = '/Users/test/Downloads';

  const resolvedPath = path.resolve(exactMatch);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return (
      resolvedPath.startsWith(resolvedDir + path.sep) ||
      resolvedPath === resolvedDir
    );
  });

  assert.ok(isAllowed, 'Exact directory match must be allowed');
});

test('socket path discovery handles both Electron userData casings', () => {
  const publishedSocket = '/private/tmp/translator-agent.sock';
  const lowercaseInfo = path.join(
    '/Users/test',
    'Library',
    'Application Support',
    'translator',
    'agent',
    'socket-path.txt'
  );

  assert.equal(
    getPackagedSocketPath({
      platformName: 'darwin',
      homeDirectory: '/Users/test',
      exists: candidate => candidate === lowercaseInfo,
      readFile: candidate => {
        assert.equal(candidate, lowercaseInfo);
        return `${publishedSocket}\n`;
      },
    }),
    publishedSocket
  );
});

test('packaged-mcp helper delegates socket discovery to the shared module', () => {
  const helperPath = path.join(
    projectRoot,
    'packages/agent-server/src/packaged-mcp.mjs'
  );
  assert.ok(fs.existsSync(helperPath), 'packaged-mcp.mjs must exist');

  const helperContent = fs.readFileSync(helperPath, 'utf8');

  assert.ok(
    helperContent.includes("from './packaged-socket-path.mjs'"),
    'Helper must use shared packaged socket discovery'
  );
});

test('packaged-mcp helper - supports standard and legacy MCP stdio framing', () => {
  const helperPath = path.join(
    projectRoot,
    'packages/agent-server/src/packaged-mcp.mjs'
  );
  const helperContent = fs.readFileSync(helperPath, 'utf8');

  // Preserve legacy framing for installed clients while preferring SDK lines.
  assert.ok(
    helperContent.includes('Content-Length:'),
    'Helper must retain legacy Content-Length framing'
  );
  assert.ok(
    helperContent.includes('\\r\\n\\r\\n'),
    'Helper must use \\r\\n\\r\\n header separator'
  );
  assert.ok(
    helperContent.includes("stdinDecoder.framing === 'content-length'") &&
      helperContent.includes('`${json}\\n`'),
    'Helper must respond using the exact framing selected by its client'
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
  const bridgePath = path.join(
    projectRoot,
    'packages/main/handlers/agent-bridge-handlers.ts'
  );
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
  const listenerPath = path.join(
    projectRoot,
    'packages/renderer/listeners/translator-agent-listener.ts'
  );
  assert.ok(
    fs.existsSync(listenerPath),
    'translator-agent-listener.ts must exist'
  );

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

test('renderer revalidates packaged method contracts at the execution boundary', () => {
  const listenerPath = path.join(
    projectRoot,
    'packages/renderer/listeners/translator-agent-listener.ts'
  );
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');

  assert.ok(
    listenerContent.includes('MEDIA_WORKFLOW_TARGETS.has(runTo)'),
    'an unknown workflow target must not fall through into paid dubbing'
  );
  assert.ok(
    listenerContent.includes('updates.length > 100') &&
      listenerContent.includes('Object.keys(patch).length === 0'),
    'subtitle mutations must enforce their advertised batch and field contract'
  );
  assert.ok(
    listenerContent.includes('Array.isArray(input?.ids)') &&
      listenerContent.includes('VIDEO_SEARCH_RECENCIES.has(input.recency)'),
    'batch/search inputs must be checked even when the local socket is called directly'
  );
});

test('AgentSocketServer - re-reads kill switch per request', () => {
  const serverPath = path.join(
    projectRoot,
    'packages/main/services/agent-socket-server.ts'
  );
  assert.ok(fs.existsSync(serverPath), 'agent-socket-server.ts must exist');

  const serverContent = fs.readFileSync(serverPath, 'utf8');

  // Find handleRequest method
  assert.ok(
    serverContent.includes("settingsStore.get('agentControlEnabled'"),
    'handleRequest must re-read agentControlEnabled on every request'
  );
  assert.ok(
    serverContent.includes('Agent control is disabled'),
    'Must throw error when disabled'
  );
  assert.ok(
    serverContent.includes('isRequestObject(request)') &&
      serverContent.includes("message: 'Invalid Request'"),
    'Malformed JSON values must be rejected before async request destructuring'
  );
});

test('AgentSocketServer - requires a versioned per-start helper lease before methods', () => {
  const serverPath = path.join(
    projectRoot,
    'packages/main/services/agent-socket-server.ts'
  );
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  assert.ok(
    serverContent.includes('this.instanceToken = randomBytes(32)') &&
      serverContent.includes('getValidPackagedAgentHandshake') &&
      serverContent.includes('!this.authenticatedClients.has(socket)'),
    'every server start must rotate a lease and gate app methods on its exact handshake'
  );
  assert.ok(
    serverContent.includes('PACKAGED_AGENT_HANDSHAKE_TIMEOUT_MS') &&
      serverContent.includes('socket.setTimeout(0)'),
    'silent unauthenticated clients must be bounded without timing out an authenticated client'
  );
  assert.ok(
    serverContent.includes('AgentClientSessionRouteRegistry') &&
      serverContent.includes('this.clientSessionRoutes.resolve(routeToken)') &&
      serverContent.includes('sessionTarget'),
    'authenticated helper reconnects must retain one exact renderer workspace'
  );
});

test('agent socket status counts only authenticated controlling clients', () => {
  const mainPath = path.join(projectRoot, 'packages/main/index.ts');
  const mainContent = fs.readFileSync(mainPath, 'utf8');

  assert.ok(
    mainContent.includes(
      'connectedClients: agentSocketServer.getAuthenticatedClientCount()'
    ) &&
      !mainContent.includes(
        'connectedClients: agentSocketServer.getConnectedClientCount()'
      ),
    'an unauthenticated half-handshake must not appear as a connected agent'
  );
});

test('packaged-mcp helper - tool name mappings are correct', () => {
  const helperPath = path.join(
    projectRoot,
    'packages/agent-server/src/packaged-mcp.mjs'
  );
  const helperContent = fs.readFileSync(helperPath, 'utf8');

  // Must consume the one map shared with the app-side allowlist.
  assert.ok(
    helperContent.includes('PACKAGED_TOOL_MAP as TOOL_MAP'),
    'Helper must import the shared packaged tool map'
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
    assert.equal(
      PACKAGED_TOOL_MAP[tool],
      method,
      `PACKAGED_TOOL_MAP must map ${tool} → ${method}`
    );
  }
});

test('packaged-mcp helper - excludes human-gated tools', () => {
  const helperPath = path.join(
    projectRoot,
    'packages/agent-server/src/packaged-mcp.mjs'
  );
  assert.ok(fs.existsSync(helperPath));

  // TOOL_MAP must NOT include these
  const excluded = [
    'app_open_credit_checkout',
    'app_settings_update',
    'app_settings_store_provider_key',
    'app_settings_clear_provider_key',
  ];

  for (const tool of excluded) {
    assert.ok(
      !(tool in PACKAGED_TOOL_MAP),
      `PACKAGED_TOOL_MAP must NOT include ${tool}`
    );
  }
});

test('packaged-mcp helper - maps fields correctly', () => {
  const helperPath = path.join(
    projectRoot,
    'packages/agent-server/src/packaged-mcp.mjs'
  );
  const helperContent = fs.readFileSync(helperPath, 'utf8');

  // Must have mapFields function
  assert.ok(
    helperContent.includes('function mapFields'),
    'Helper must define mapFields'
  );

  // Must map critical fields
  assert.ok(
    helperContent.includes('output_path') &&
      helperContent.includes('outputPath'),
    'Must map output_path → outputPath'
  );
  assert.ok(
    helperContent.includes('confirm_overwrite') &&
      helperContent.includes('OVERWRITE'),
    'Must map confirm_overwrite=OVERWRITE → overwrite=true'
  );

  // Must map result_ids → ids (NOT resultIds)
  assert.ok(
    helperContent.includes('result_ids') &&
      helperContent.includes('mapped.ids = value'),
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
  const helperPath = path.join(
    projectRoot,
    'packages/agent-server/src/packaged-mcp.mjs'
  );
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
      schema.includes('properties:') &&
        !schema.includes('additionalProperties: true'),
      `${tool} schema must have real properties, not z.any()`
    );
  }

  // app_video_batch_download must have result_ids array constraint
  assert.ok(
    helperContent.includes('app_video_batch_download:') &&
      helperContent.includes('result_ids:') &&
      helperContent.includes("type: 'array'"),
    'app_video_batch_download must define result_ids as array'
  );
  assert.ok(
    helperContent.includes('minItems: 1') &&
      helperContent.includes('maxItems: 8'),
    'app_video_batch_download result_ids must have minItems: 1, maxItems: 8'
  );

  // app_start_merge must have confirm_overwrite enum
  assert.ok(
    helperContent.includes('app_start_merge:') &&
      helperContent.includes('confirm_overwrite:') &&
      helperContent.includes("enum: ['OVERWRITE']"),
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

test('packaged-mcp helper - every exposed tool has its current input contract', () => {
  const helperPath = path.join(
    projectRoot,
    'packages/agent-server/src/packaged-mcp.mjs'
  );
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  const readObject = (name: string): Record<string, any> => {
    const declaration = `const ${name} = {`;
    const declarationStart = helperContent.indexOf(declaration);
    assert.notEqual(declarationStart, -1, `${name} declaration must exist`);
    const objectStart = helperContent.indexOf('{', declarationStart);
    const objectEnd = helperContent.indexOf('\n};', objectStart);
    assert.notEqual(objectEnd, -1, `${name} declaration must end`);
    return new Function(
      `return (${helperContent.slice(objectStart, objectEnd + 2)});`
    )();
  };
  const schemas = readObject('TOOL_SCHEMAS');

  assert.deepEqual(
    Object.keys(schemas).sort(),
    Object.keys(PACKAGED_TOOL_MAP).sort(),
    'TOOL_MAP and TOOL_SCHEMAS must stay one-to-one'
  );
  assert.deepEqual(schemas.app_navigate.required, ['destination']);
  assert.deepEqual(schemas.app_open_video.required, ['path']);
  assert.deepEqual(schemas.app_subtitles_update.required, ['updates']);
  assert.deepEqual(schemas.app_subtitles_mutate.required, ['operation']);
  assert.deepEqual(schemas.app_subtitles_export.required, ['path']);
  assert.ok(
    !helperContent.includes('TOOL_SCHEMAS[name] ||'),
    'tools/list must not silently replace a missing schema with an empty one'
  );
});

test('packaged-mcp helper - executes mapFields and TOOL_MAP correctly', () => {
  const helperPath = path.join(
    projectRoot,
    'packages/agent-server/src/packaged-mcp.mjs'
  );
  const helperContent = fs.readFileSync(helperPath, 'utf8');

  // Extract mapFields function
  const mapFieldsStart = helperContent.indexOf('function mapFields(input)');
  const mapFieldsEnd = helperContent.indexOf('\n}\n', mapFieldsStart) + 2;
  assert.ok(mapFieldsStart !== -1, 'mapFields function not found');

  const mapFieldsCode = helperContent.substring(mapFieldsStart, mapFieldsEnd);

  // Create an isolated mapFields function via Function constructor (safer than eval)
  const mapFieldsFn = new Function(
    'input',
    `
    ${mapFieldsCode}
    return mapFields(input);
  `
  );

  // Test result_ids → ids transformation
  const batchDownloadArgs = {
    result_ids: ['vid1', 'vid2', 'vid3'],
    quality: '1080p',
  };

  const mapped = mapFieldsFn(batchDownloadArgs);

  assert.strictEqual(
    mapped.ids,
    batchDownloadArgs.result_ids,
    'result_ids must map to ids'
  );
  assert.strictEqual(
    mapped.resultIds,
    undefined,
    'result_ids must NOT map to resultIds'
  );
  assert.strictEqual(mapped.quality, '1080p', 'quality must pass through');

  // Test confirm_overwrite=OVERWRITE → overwrite=true
  const mergeArgs = {
    output_path: '/tmp/test.mp4',
    confirm_overwrite: 'OVERWRITE',
  };

  const mappedMerge = mapFieldsFn(mergeArgs);

  assert.strictEqual(
    mappedMerge.overwrite,
    true,
    'confirm_overwrite=OVERWRITE must map to overwrite=true'
  );
  assert.strictEqual(
    mappedMerge.confirmOverwrite,
    undefined,
    'confirm_overwrite must NOT map to confirmOverwrite'
  );
  assert.strictEqual(
    mappedMerge.outputPath,
    '/tmp/test.mp4',
    'output_path must map to outputPath'
  );

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

test('extraResources bundling - ships the standalone helper and its runtime modules', () => {
  const builderPath = path.join(projectRoot, 'electron-builder.base.json');
  assert.ok(
    fs.existsSync(builderPath),
    'electron-builder.base.json must exist'
  );

  const builderContent = fs.readFileSync(builderPath, 'utf8');
  const windowsBuilderContent = fs.readFileSync(
    path.join(projectRoot, 'electron-builder.win.json'),
    'utf8'
  );

  assert.ok(
    builderContent.includes('packaged-mcp.mjs'),
    'Must bundle standalone packaged-mcp.mjs'
  );
  assert.ok(
    builderContent.includes('translator-mcp') &&
      windowsBuilderContent.includes('translator-mcp.cmd'),
    'Each platform must bundle its launcher that uses Translator runtime without external Node'
  );
  assert.ok(
    builderContent.includes('native-owner-monitor.mjs') &&
      builderContent.includes('translator-owner-supervisor') &&
      builderContent.includes('packaged-agent-protocol.mjs') &&
      builderContent.includes('job-owner-lease.mjs') &&
      builderContent.includes('mcp-v2-service.mjs'),
    'Must bundle native ownership supervision, packaged generation fencing, and the persistent MCP v2 runtime'
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
    readmeContent.includes(
      'C:\\Program Files\\Translator\\resources\\translator-mcp.cmd'
    ),
    'README must use Program Files for NSIS perMachine install'
  );
  assert.ok(
    docsContent.includes(
      'C:\\Program Files\\Translator\\resources\\translator-mcp.cmd'
    ),
    'docs must use Program Files for NSIS perMachine install'
  );
  assert.ok(
    !readmeContent.includes('%LOCALAPPDATA%\\Programs'),
    'README must not use LocalAppData (NSIS is perMachine)'
  );
});

test('IPC response pattern - send/on matches on both sides', () => {
  const bridgePath = path.join(
    projectRoot,
    'packages/main/handlers/agent-bridge-handlers.ts'
  );
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
    preloadContent.includes('sendAgentBridgeResponse') &&
      preloadContent.includes('ipcRenderer.send'),
    'preload must use ipcRenderer.send for agent bridge responses'
  );
});

test('socket server - refuses human-gated methods', () => {
  const serverPath = path.join(
    projectRoot,
    'packages/main/services/agent-socket-server.ts'
  );
  assert.ok(fs.existsSync(serverPath), 'agent-socket-server.ts must exist');

  const serverContent = fs.readFileSync(serverPath, 'utf8');

  // The socket must allow only the exact methods exposed by packaged MCP.
  assert.ok(
    serverContent.includes('new Set(PACKAGED_AGENT_METHODS)') &&
      serverContent.includes('ALLOWED_AGENT_METHODS.has(method)'),
    'handleRequest must use the shared exact method allowlist'
  );

  // Must include payment and secret operations
  const requiredBlocked = [
    'openCreditCheckout',
    'storeProviderKey',
    'clearProviderKey',
    'updateSettings',
  ];

  for (const method of requiredBlocked) {
    assert.ok(
      !PACKAGED_AGENT_METHODS.includes(method),
      `packaged method allowlist must exclude ${method}`
    );
  }
});

test('allowlist - uses realpath to prevent symlink escape', () => {
  const mainPath = path.join(projectRoot, 'packages/main/index.ts');
  const containmentPath = path.join(
    projectRoot,
    'packages/main/utils/path-containment.ts'
  );
  assert.ok(fs.existsSync(mainPath), 'main/index.ts must exist');
  assert.ok(fs.existsSync(containmentPath), 'path-containment.ts must exist');

  const mainContent = fs.readFileSync(mainPath, 'utf8');
  const containmentContent = fs.readFileSync(containmentPath, 'utf8');

  assert.ok(
    mainContent.includes('isPathInsideAllowedDirectories(filePath, dirs)') &&
      containmentContent.includes('realpath(path.dirname(resolved))') &&
      !containmentContent.includes('return path.resolve(targetPath)'),
    'new output paths must canonicalize their existing parent and fail closed'
  );
});

test('explicit render output is re-authorized at the final write boundary', () => {
  const renderPath = path.join(
    projectRoot,
    'packages/main/handlers/render-window-handlers/index.ts'
  );
  const renderContent = fs.readFileSync(renderPath, 'utf8');
  const authorizationCalls = renderContent.match(
    /assertAgentOutputPathAuthorized\([\s\S]*?'Explicit merge output'[\s\S]*?\);/g
  );

  assert.equal(
    authorizationCalls?.length,
    2,
    'explicit output must be authorized both before rendering and immediately before saving'
  );
  assert.ok(
    fs
      .readFileSync(
        path.join(
          projectRoot,
          'packages/main/utils/agent-output-authorization.ts'
        ),
        'utf8'
      )
      .includes("settingsStore.get('agentControlEnabled', false) !== true") &&
      fs
        .readFileSync(
          path.join(
            projectRoot,
            'packages/main/utils/agent-output-authorization.ts'
          ),
          'utf8'
        )
        .includes('canonicalizeAgentOutputPath(outputPath)') &&
      fs
        .readFileSync(
          path.join(
            projectRoot,
            'packages/main/utils/agent-output-authorization.ts'
          ),
          'utf8'
        )
        .includes('isCanonicalPathInsideAllowedDirectories'),
    'final authorization must re-read both the kill switch and canonical allowlist containment'
  );
});

test('agent subtitle export is authorized inside the main-process save boundary', () => {
  const listenerContent = fs.readFileSync(
    path.join(
      projectRoot,
      'packages/renderer/listeners/translator-agent-listener.ts'
    ),
    'utf8'
  );
  const fileHandlerContent = fs.readFileSync(
    path.join(projectRoot, 'packages/main/handlers/file-handlers.ts'),
    'utf8'
  );
  const rendererSaveContent = fs.readFileSync(
    path.join(projectRoot, 'packages/renderer/utils/saveSubtitles.ts'),
    'utf8'
  );
  const saveFileContent = fs.readFileSync(
    path.join(projectRoot, 'packages/main/services/save-file.ts'),
    'utf8'
  );

  assert.ok(
    listenerContent.includes('requireAgentPathAuthorization: true') &&
      fileHandlerContent.includes(
        'authorizedAgentPath = assertAgentOutputPathAuthorized('
      ) &&
      fileHandlerContent.includes(
        'filePath: authorizedAgentPath ?? options.filePath'
      ) &&
      fileHandlerContent.includes('authorizeTargetPath:') &&
      fileHandlerContent.indexOf(
        'authorizedAgentPath = assertAgentOutputPathAuthorized('
      ) < fileHandlerContent.indexOf('saveFileService.saveFile({'),
    'agent subtitle exports must enter the main-process authorization boundary'
  );
  assert.ok(
    saveFileContent.indexOf('await authorizeTargetPath(targetPath)') >= 0 &&
      saveFileContent.indexOf('await authorizeTargetPath(targetPath)') <
        saveFileContent.indexOf('await fs.promises.writeFile(targetPath'),
    'agent subtitle exports must re-authorize immediately before filesystem I/O'
  );
  assert.match(
    fileHandlerContent,
    /options\.requireAgentPathAuthorization === true\s*\? filePath\s*:\s*\(options\.activeLinkedFilePath \?\? filePath\)/,
    'the subtitle document must persist the final canonical path returned by the write boundary'
  );
  assert.match(
    rendererSaveContent,
    /const savedFilePath = result\.filePath \?\? filePath;[\s\S]*?setActiveFileTarget\(\{[\s\S]*?filePath: savedFilePath/,
    'the renderer must retain the canonical path returned by main'
  );
});

test('persistent rendering reuses only an exact claimed subtitle master', () => {
  const listenerContent = fs.readFileSync(
    path.join(
      projectRoot,
      'packages/renderer/listeners/translator-agent-listener.ts'
    ),
    'utf8'
  );
  const handlerContent = fs.readFileSync(
    path.join(projectRoot, 'packages/main/handlers/agent-v2-handlers.ts'),
    'utf8'
  );

  assert.ok(
    listenerContent.includes("expectedReceiptKind: 'temporary_master'") &&
      listenerContent.includes(
        'inspectedMaster.operation_receipt_valid === true'
      ) &&
      listenerContent.includes('if (!reusedIntermediateMaster)') &&
      handlerContent.includes('kind: expectedReceiptKind'),
    'restart recovery must reuse only a media file bound to the exact render operation receipt'
  );
});

test('kill switch - serialized state is null-safe and terminal on shutdown', () => {
  const mainPath = path.join(projectRoot, 'packages/main/index.ts');
  const mainContent = fs.readFileSync(mainPath, 'utf8');

  assert.ok(
    mainContent.includes('const server = agentSocketServer;') &&
      mainContent.includes('if (!server) return;'),
    'socket transitions must snapshot and null-check the server'
  );
  assert.ok(
    mainContent.includes('agentSocketServerState.set(shouldRun)'),
    'setting changes must pass through the serialized state controller'
  );
  assert.ok(
    mainContent.includes('agentSocketServerState.shutdown(false)'),
    'app cleanup must make the stopped state terminal'
  );
});

test('agent bridge replies are unique, sender-bound, and cleaned up', () => {
  const bridgePath = path.join(
    projectRoot,
    'packages/main/handlers/agent-bridge-handlers.ts'
  );
  const bridgeContent = fs.readFileSync(bridgePath, 'utf8');
  const preloadContent = fs.readFileSync(
    path.join(projectRoot, 'packages/preload/index.ts'),
    'utf8'
  );

  assert.ok(
    bridgeContent.includes('randomUUID()'),
    'concurrent requests must not share timestamp-based reply channels'
  );
  assert.ok(
    bridgeContent.includes('event.sender !== webContents'),
    'only the request target may provide its reply'
  );
  assert.ok(
    bridgeContent.includes(
      'ipcMain.removeListener(responseChannel, onResponse)'
    ),
    'reply listeners must be removed on response, send failure, and timeout'
  );
  assert.ok(
    bridgeContent.includes("signal?.addEventListener('abort', onAbort") &&
      bridgeContent.includes("signal?.removeEventListener('abort', onAbort)"),
    'disconnecting a packaged socket must remove its pending reply listeners'
  );
  assert.ok(
    bridgeContent.includes("webContents.once('destroyed', onTargetGone)") &&
      bridgeContent.includes(
        "webContents.once('render-process-gone', onTargetGone)"
      ),
    'renderer destruction or crash must abort its pending packaged request'
  );
  assert.ok(
    bridgeContent.includes(
      "webContents.on('did-start-navigation', onTargetNavigation)"
    ) &&
      bridgeContent.includes(
        "webContents.removeListener('did-start-navigation', onTargetNavigation)"
      ),
    'main-frame renderer replacement must abort and clean up pending requests'
  );
  assert.ok(
    preloadContent.includes('AGENT_BRIDGE_RESPONSE_CHANNEL_PATTERN.test(') &&
      preloadContent.includes('Invalid agent bridge response channel.'),
    'preload must not expose a generic renderer-to-main IPC send primitive'
  );
  const rendererBridgeContent = fs.readFileSync(
    path.join(
      projectRoot,
      'packages/renderer/listeners/translator-agent-listener.ts'
    ),
    'utf8'
  );
  assert.match(
    rendererBridgeContent,
    /catch \(error: any\) \{\s*try \{\s*SystemIPC\.sendAgentBridgeResponse/
  );
});

test('agent-control startup failure rolls back the persisted kill switch', () => {
  const mainPath = path.join(projectRoot, 'packages/main/index.ts');
  const mainContent = fs.readFileSync(mainPath, 'utf8');

  assert.ok(
    mainContent.includes('async function failClosedAgentControl') &&
      mainContent.includes('requestRevision === agentControlRequestRevision') &&
      mainContent.includes("settingsStore.set('agentControlEnabled', false)") &&
      mainContent.includes('await agentSocketServerState.set(false)') &&
      mainContent.includes(
        "settingsStore.get('agentControlEnabled', false) === true"
      ) &&
      mainContent.includes(
        "broadcastToApp('agent-control-changed', { enabled })"
      ),
    'unsafe socket startup must persist disabled state, stop partial state, and reconcile a newer queued request'
  );
});

test('an unexpected agent socket failure rolls back the persisted kill switch', () => {
  const mainPath = path.join(projectRoot, 'packages/main/index.ts');
  const serverPath = path.join(
    projectRoot,
    'packages/main/services/agent-socket-server.ts'
  );
  const mainContent = fs.readFileSync(mainPath, 'utf8');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  assert.ok(
    mainContent.includes(
      'onUnexpectedFailure: error => failClosedAgentControl(error)'
    ) &&
      serverContent.includes('this.reportUnexpectedFailure(server, error)') &&
      serverContent.includes('if (this.unexpectedFailureServer === server)'),
    'a runtime socket failure must disable agent control exactly once per failed server'
  );
});

test('agent socket discovery publication fails closed', () => {
  const serverPath = path.join(
    projectRoot,
    'packages/main/services/agent-socket-server.ts'
  );
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  assert.ok(
    serverContent.includes(
      'Failed to publish the packaged agent socket discovery file.'
    ) &&
      serverContent.includes('this.removeSocketInfoFile();') &&
      /catch \(error\) \{[\s\S]*?this\.disconnectClients\(\);[\s\S]*?server\.close\(/.test(
        serverContent
      ),
    'an unusable or insecure discovery file must fail socket startup without retaining a partial-start client'
  );
});

test('subtitle save cancellation is typed and diagnostics omit subtitle content', () => {
  const handlerContent = fs.readFileSync(
    path.join(projectRoot, 'packages/main/handlers/file-handlers.ts'),
    'utf8'
  );
  const serviceContent = fs.readFileSync(
    path.join(projectRoot, 'packages/main/services/save-file.ts'),
    'utf8'
  );

  assert.match(handlerContent, /error instanceof SaveFileCancelledError/);
  assert.doesNotMatch(handlerContent, /cancell\?ed/);
  assert.match(serviceContent, /class SaveFileCancelledError/);
  assert.match(
    serviceContent,
    /const diagnosticOptions = \{ \.\.\.options \};[\s\S]*delete diagnosticOptions\.content;/
  );
  assert.doesNotMatch(
    serviceContent,
    /Received options:', \{\s*\.\.\.options,/
  );
});

test('render diagnostics report sizes without logging subtitle payloads', () => {
  const clientContent = fs.readFileSync(
    path.join(
      projectRoot,
      'packages/renderer/clients/subtitle-renderer-client.ts'
    ),
    'utf8'
  );
  const preloadContent = fs.readFileSync(
    path.join(projectRoot, 'packages/preload/index.ts'),
    'utf8'
  );

  assert.match(clientContent, /diagnosticOptions\.srtContentLength/);
  assert.match(clientContent, /delete diagnosticOptions\.srtContent;/);
  assert.match(clientContent, /delete diagnosticOptions\.subtitleSegments;/);
  assert.doesNotMatch(
    clientContent,
    /Starting overlay render process via bridge:',\s*options/
  );
  assert.match(preloadContent, /srtContentLength/);
  assert.match(preloadContent, /subtitleSegmentCount/);
  assert.doesNotMatch(preloadContent, /Sending PngRenderRequest:',\s*options/);
});

test('failure diagnostics omit subtitle text and raw yt-dlp metadata', () => {
  const parserContent = fs.readFileSync(
    path.join(
      projectRoot,
      'packages/main/handlers/render-window-handlers/srt-parser.ts'
    ),
    'utf8'
  );
  const downloadContent = fs.readFileSync(
    path.join(projectRoot, 'packages/main/services/url-processor/download.ts'),
    'utf8'
  );
  const urlHandlerContent = fs.readFileSync(
    path.join(projectRoot, 'packages/main/handlers/url-handlers.ts'),
    'utf8'
  );

  assert.doesNotMatch(parserContent, /JSON\.stringify\(segment\)/);
  assert.match(parserContent, /const segmentTiming/);
  assert.doesNotMatch(downloadContent, /Final buffer content:/);
  assert.doesNotMatch(downloadContent, /Final JSON attempted:/);
  assert.doesNotMatch(downloadContent, /yt-dlp STDERR:', error\.stderr/);
  assert.doesNotMatch(downloadContent, /yt-dlp STDOUT on error:/);
  assert.doesNotMatch(downloadContent, /yt-dlp ALL on error:/);
  assert.doesNotMatch(
    downloadContent,
    /Raw error message: \$\{rawErrorMessage\}/
  );
  assert.doesNotMatch(downloadContent, /Error stderr: \$\{error\.stderr\}/);
  assert.doesNotMatch(downloadContent, /Error stack: \$\{error\.stack\}/);
  assert.doesNotMatch(downloadContent, /Error ALL:/);
  assert.match(downloadContent, /content omitted/);
  assert.doesNotMatch(urlHandlerContent, /Error stderr: \$\{error\.stderr\}/);
  assert.doesNotMatch(urlHandlerContent, /Error stdout: \$\{error\.stdout\}/);
  assert.match(urlHandlerContent, /content omitted/);
});
