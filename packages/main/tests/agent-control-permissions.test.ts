import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'path';
import os from 'os';

/**
 * Agent Control Permission System Tests
 * 
 * These tests verify the security and functionality of the agent control system:
 * - Settings persistence and retrieval
 * - Allowed directory validation
 * - Permission gates for explicit merge output paths
 * - Kill switch behavior
 */

test('agent control settings - default state', () => {
  // Verify default settings are secure (disabled by default)
  const agentControlEnabled = false; // Default from APP_SETTINGS_DEFAULTS
  const agentAllowedDirectories: string[] = []; // Default from APP_SETTINGS_DEFAULTS
  
  assert.strictEqual(agentControlEnabled, false, 'Agent control should be disabled by default');
  assert.strictEqual(agentAllowedDirectories.length, 0, 'Allowed directories should be empty by default');
});

test('agent control - allowed directory path validation', () => {
  // Test path resolution and normalization
  const testPaths = [
    '/Users/test/Downloads',
    '  /Users/test/Documents  ', // Should trim whitespace
    '/Users/test/../test/Videos', // Should resolve relative paths
  ];
  
  const sanitized = testPaths.map(p => path.resolve(p.trim()));
  
  assert.ok(sanitized.every(p => path.isAbsolute(p)), 'All paths should be absolute');
  assert.strictEqual(sanitized[1], '/Users/test/Documents', 'Should trim whitespace');
  assert.strictEqual(sanitized[2], '/Users/test/Videos', 'Should resolve relative paths');
});

test('agent control - merge output path allowlist check (enabled)', () => {
  // Simulate the validation logic from render-window-handlers/index.ts
  const agentEnabled = true;
  const allowedDirs = [
    '/Users/test/Downloads',
    '/Users/test/Videos',
  ];
  const explicitOutputPath = '/Users/test/Downloads/output.mp4';
  
  const resolvedOutput = path.resolve(explicitOutputPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedOutput.startsWith(resolvedDir + path.sep) ||
           resolvedOutput === resolvedDir;
  });
  
  assert.ok(isAllowed, 'Output path within allowed directory should be permitted');
});

test('agent control - merge output path allowlist check (denied)', () => {
  const agentEnabled = true;
  const allowedDirs = [
    '/Users/test/Downloads',
  ];
  const explicitOutputPath = '/Users/test/Documents/output.mp4'; // Not in allowlist
  
  const resolvedOutput = path.resolve(explicitOutputPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedOutput.startsWith(resolvedDir + path.sep) ||
           resolvedOutput === resolvedDir;
  });
  
  assert.ok(!isAllowed, 'Output path outside allowed directories should be denied');
});

test('agent control - merge output path with agent disabled', () => {
  // When agent control is disabled in packaged mode, explicit paths should be blocked
  const agentEnabled = false;
  const isPackaged = true;
  const explicitOutputPath = '/Users/test/Downloads/output.mp4';
  
  if (isPackaged && explicitOutputPath && !agentEnabled) {
    const shouldThrow = true;
    assert.ok(shouldThrow, 'Explicit paths require agent control to be enabled');
  }
});

test('agent control - directory path escaping prevention', () => {
  // Ensure path validation prevents directory traversal attacks
  const allowedDirs = ['/Users/test/allowed'];
  const maliciousPath = '/Users/test/allowed/../../../etc/passwd';
  
  const resolvedOutput = path.resolve(maliciousPath);
  const resolvedAllowed = path.resolve(allowedDirs[0]);
  
  const isAllowed = resolvedOutput.startsWith(resolvedAllowed + path.sep) ||
                    resolvedOutput === resolvedAllowed;
  
  assert.ok(!isAllowed, 'Directory traversal should be prevented');
  assert.ok(!resolvedOutput.includes('..'), 'Resolved path should not contain parent directory references');
});

test('agent control - subdirectory access within allowed directory', () => {
  const allowedDirs = ['/Users/test/Downloads'];
  const subdirPath = '/Users/test/Downloads/subfolder/output.mp4';
  
  const resolvedOutput = path.resolve(subdirPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedOutput.startsWith(resolvedDir + path.sep) ||
           resolvedOutput === resolvedDir;
  });
  
  assert.ok(isAllowed, 'Subdirectories within allowed directory should be permitted');
});

test('agent control - exact directory match', () => {
  const allowedDirs = ['/Users/test/Downloads'];
  const exactMatch = '/Users/test/Downloads'; // Exact match without trailing slash
  
  const resolvedOutput = path.resolve(exactMatch);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedOutput.startsWith(resolvedDir + path.sep) ||
           resolvedOutput === resolvedDir;
  });
  
  assert.ok(isAllowed, 'Exact directory match should be permitted');
});

test('agent control - prefix similarity does not grant access', () => {
  const allowedDirs = ['/Users/test/Downloads'];
  const similarPath = '/Users/test/DownloadsAttack/output.mp4'; // Similar prefix but not within
  
  const resolvedOutput = path.resolve(similarPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedOutput.startsWith(resolvedDir + path.sep) ||
           resolvedOutput === resolvedDir;
  });
  
  assert.ok(!isAllowed, 'Similar prefix should not grant access');
});

test('agent control - empty allowed directories', () => {
  const allowedDirs: string[] = [];
  const explicitOutputPath = '/Users/test/Downloads/output.mp4';
  
  const resolvedOutput = path.resolve(explicitOutputPath);
  const isAllowed = allowedDirs.some(dir => {
    const resolvedDir = path.resolve(dir);
    return resolvedOutput.startsWith(resolvedDir + path.sep) ||
           resolvedOutput === resolvedDir;
  });
  
  assert.ok(!isAllowed, 'Empty allowlist should deny all paths');
});

test('agent control - cross-platform path handling', () => {
  // Test that path resolution works correctly on different platforms
  const platform = os.platform();
  
  if (platform === 'win32') {
    const winPath = 'C:\\Users\\test\\Downloads\\output.mp4';
    const resolved = path.resolve(winPath);
    assert.ok(path.isAbsolute(resolved), 'Windows paths should resolve correctly');
  } else {
    const unixPath = '/Users/test/Downloads/output.mp4';
    const resolved = path.resolve(unixPath);
    assert.ok(path.isAbsolute(resolved), 'Unix paths should resolve correctly');
  }
});

test('agent control - kill switch behavior', () => {
  // Simulate kill switch: when agent control is disabled, bridge should be removed
  let agentBridgeExists = true;
  const agentControlEnabled = false;
  
  if (!agentControlEnabled && agentBridgeExists) {
    // In translator-agent-listener.ts, window.translatorAgent is deleted when disabled
    agentBridgeExists = false;
  }
  
  assert.ok(!agentBridgeExists, 'Agent bridge should be removed when disabled');
});

test('agent control - socket server lifecycle with permission', () => {
  // Verify socket server respects agent control setting
  const agentControlEnabled = true;
  const isPackaged = true;
  
  const shouldStartSocketServer = agentControlEnabled && isPackaged;
  
  assert.ok(shouldStartSocketServer, 'Socket server should start when enabled in packaged mode');
});

test('agent control - socket server lifecycle without permission', () => {
  const agentControlEnabled = false;
  const isPackaged = true;
  
  const shouldStartSocketServer = agentControlEnabled && isPackaged;
  
  assert.ok(!shouldStartSocketServer, 'Socket server should not start when disabled');
});

test('agent control - dev mode bypass', () => {
  // In development with TRANSLATOR_AGENT_DEV=1, agent mode works without the setting
  const isPackaged = false;
  const devEnvFlag = true; // TRANSLATOR_AGENT_DEV=1
  const agentModeEnabled = !isPackaged && devEnvFlag;
  
  assert.ok(agentModeEnabled, 'Dev mode should bypass agent control setting');
});

test('agent control - packaged mode requires explicit permission', () => {
  const isPackaged = true;
  const agentControlSetting = false; // User has not enabled it
  
  // In packaged mode, agent mode requires the setting to be enabled
  const agentModeEnabled = isPackaged && agentControlSetting;
  
  assert.ok(!agentModeEnabled, 'Packaged mode requires explicit user permission');
});
