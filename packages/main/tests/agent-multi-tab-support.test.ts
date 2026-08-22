import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Agent History-ID Support Tests
 * 
 * Tests that MCP tools support operating on library items without remounting,
 * enabling multiple agents to work on different videos simultaneously.
 * 
 * Related Issue: Multiple agents sharing one Translator.app instance
 * would interfere when remounting videos/subtitles.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

test('packaged-mcp - app_status accepts optional history_id', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // Find app_status schema
  const schemaStart = helperContent.indexOf('app_status:');
  const schemaEnd = helperContent.indexOf('},', schemaStart) + 1;
  assert.ok(schemaStart !== -1, 'app_status schema not found');
  
  const schemaBlock = helperContent.substring(schemaStart, schemaEnd);
  
  assert.ok(
    schemaBlock.includes('history_id'),
    'app_status schema must include history_id parameter'
  );
  assert.ok(
    schemaBlock.includes("type: 'string'") && schemaBlock.includes('minLength: 1'),
    'history_id must be non-empty string'
  );
});

test('packaged-mcp - app_subtitles_get accepts optional history_id', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  const schemaMatch = helperContent.match(/app_subtitles_get:\s*\{[\s\S]*?additionalProperties: false\s*\}/);
  assert.ok(schemaMatch, 'app_subtitles_get schema not found');
  
  const schema = schemaMatch[0];
  
  assert.ok(
    schema.includes('history_id'),
    'app_subtitles_get schema must include history_id parameter'
  );
  assert.ok(
    schema.includes('offset') && schema.includes('limit'),
    'app_subtitles_get must retain offset and limit parameters'
  );
});

test('packaged-mcp - app_subtitles_export accepts optional history_id', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  const schemaMatch = helperContent.match(/app_subtitles_export:\s*\{[\s\S]*?additionalProperties: false\s*\}/);
  assert.ok(schemaMatch, 'app_subtitles_export schema not found');
  
  const schema = schemaMatch[0];
  
  assert.ok(
    schema.includes('history_id'),
    'app_subtitles_export schema must include history_id parameter'
  );
  assert.ok(
    schema.includes('output_path') && schema.includes("required: ['output_path']"),
    'app_subtitles_export must require output_path'
  );
});

test('packaged-mcp - app_start_transcription accepts optional history_id', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  const schemaMatch = helperContent.match(/app_start_transcription:\s*\{[\s\S]*?additionalProperties: false\s*\}/);
  assert.ok(schemaMatch, 'app_start_transcription schema not found');
  
  const schema = schemaMatch[0];
  
  assert.ok(
    schema.includes('history_id'),
    'app_start_transcription schema must include history_id parameter'
  );
  assert.ok(
    schema.includes('replace_subtitles'),
    'app_start_transcription must retain replace_subtitles parameter'
  );
});

test('packaged-mcp - app_start_translation accepts optional history_id', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  const schemaMatch = helperContent.match(/app_start_translation:\s*\{[\s\S]*?additionalProperties: false\s*\}/);
  assert.ok(schemaMatch, 'app_start_translation schema not found');
  
  const schema = schemaMatch[0];
  
  assert.ok(
    schema.includes('history_id'),
    'app_start_translation schema must include history_id parameter'
  );
  assert.ok(
    schema.includes('target_language') && schema.includes("required: ['target_language']"),
    'app_start_translation must require target_language'
  );
});

test('packaged-mcp - app_start_merge accepts optional history_id', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  const schemaMatch = helperContent.match(/app_start_merge:\s*\{[\s\S]*?additionalProperties: false\s*\}/);
  assert.ok(schemaMatch, 'app_start_merge schema not found');
  
  const schema = schemaMatch[0];
  
  assert.ok(
    schema.includes('history_id'),
    'app_start_merge schema must include history_id parameter'
  );
  assert.ok(
    schema.includes('output_path') && schema.includes("required: ['output_path']"),
    'app_start_merge must require output_path'
  );
});

test('packaged-mcp - app_processing_status accepts optional history_id', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  const schemaMatch = helperContent.match(/app_processing_status:\s*\{[\s\S]*?additionalProperties: false\s*\}/);
  assert.ok(schemaMatch, 'app_processing_status schema not found');
  
  const schema = schemaMatch[0];
  
  assert.ok(
    schema.includes('history_id'),
    'app_processing_status schema must include history_id parameter'
  );
  assert.ok(
    schema.includes("type: 'object'"),
    'app_processing_status must be an object schema'
  );
});

test('packaged-mcp - maps history_id to historyId', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // Find mapFields function
  const mapFieldsStart = helperContent.indexOf('function mapFields(input)');
  const mapFieldsEnd = helperContent.indexOf('\n}\n', mapFieldsStart) + 2;
  assert.ok(mapFieldsStart !== -1, 'mapFields function not found');
  
  const mapFieldsCode = helperContent.substring(mapFieldsStart, mapFieldsEnd);
  
  assert.ok(
    mapFieldsCode.includes('history_id') && mapFieldsCode.includes('historyId'),
    'mapFields must map history_id → historyId'
  );
  
  // Test the mapping
  const mapFieldsFn = new Function('input', `
    ${mapFieldsCode}
    return mapFields(input);
  `);
  
  const mapped = mapFieldsFn({ history_id: 'test-id-123' });
  assert.strictEqual(mapped.historyId, 'test-id-123', 'history_id must map to historyId');
});

test('translator-agent-listener - loadSubtitlesFromHistory function exists', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  
  assert.ok(
    listenerContent.includes('async function loadSubtitlesFromHistory'),
    'Must define loadSubtitlesFromHistory helper'
  );
  assert.ok(
    listenerContent.includes('requireDownloadHistoryItem'),
    'loadSubtitlesFromHistory must validate history item exists'
  );
  assert.ok(
    listenerContent.includes('parseSrt'),
    'loadSubtitlesFromHistory must parse stored subtitle file'
  );
});

test('translator-agent-listener - status accepts historyId parameter', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  
  // Find status method in agent bridge
  const statusMatch = listenerContent.match(/async status\(input\)[^}]+loadSubtitlesFromHistory/s);
  assert.ok(statusMatch, 'status method must check for input.historyId');
  
  assert.ok(
    listenerContent.includes('input?.historyId'),
    'status must accept optional historyId parameter'
  );
});

test('translator-agent-listener - subtitlesBatch is async and accepts historyId', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  
  assert.ok(
    listenerContent.includes('async function subtitleBatchSnapshot'),
    'subtitleBatchSnapshot must be async'
  );
  assert.ok(
    listenerContent.includes('input?.historyId'),
    'subtitleBatchSnapshot must check for historyId parameter'
  );
  assert.ok(
    listenerContent.includes('await subtitleBatchSnapshot(input)'),
    'Agent bridge must await subtitleBatchSnapshot call'
  );
});

test('translator-agent-listener - exportSubtitles accepts historyId', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  
  // Find exportMountedSubtitles function
  const exportMatch = listenerContent.match(/async function exportMountedSubtitles\(input[^{]+{[\s\S]*?historyId[\s\S]*?loadSubtitlesFromHistory/);
  assert.ok(exportMatch, 'exportMountedSubtitles must accept and use historyId');
  
  assert.ok(
    listenerContent.includes('await exportMountedSubtitles(input)'),
    'Agent bridge must await exportMountedSubtitles call'
  );
});

test('translator-agent-listener - job operations reject history_id with clear error', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  
  // startTranscription should check for history_id and throw error
  const transcriptionMatch = listenerContent.match(/async startTranscription\(input\)[\s\S]*?if \(input\?\.historyId\)[\s\S]*?throw new Error/);
  assert.ok(transcriptionMatch, 'startTranscription must reject history_id with clear error');
  
  // startTranslation should check for history_id and throw error
  const translationMatch = listenerContent.match(/async startTranslation\(input\)[\s\S]*?if \(input\?\.historyId\)[\s\S]*?throw new Error/);
  assert.ok(translationMatch, 'startTranslation must reject history_id with clear error');
  
  // startMerge should check for history_id and throw error
  const mergeMatch = listenerContent.match(/async startMerge\(input\)[\s\S]*?if \(input\?\.historyId\)[\s\S]*?throw new Error/);
  assert.ok(mergeMatch, 'startMerge must reject history_id with clear error');
  
  // processingStatus should check for history_id and throw error
  const statusMatch = listenerContent.match(/async processingStatus\(input\)[\s\S]*?if \(input\?\.historyId\)[\s\S]*?throw new Error/);
  assert.ok(statusMatch, 'processingStatus must reject history_id with clear error');
});

test('translator-agent-listener - history-based operations do not remount UI', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  
  // loadSubtitlesFromHistory should read from disk, not call useSubStore.getState().load
  const loadFnMatch = listenerContent.match(/async function loadSubtitlesFromHistory[\s\S]*?return \{[\s\S]*?\}/);
  assert.ok(loadFnMatch, 'loadSubtitlesFromHistory function not found');
  
  const loadFnBody = loadFnMatch[0];
  
  assert.ok(
    !loadFnBody.includes('useSubStore.getState().load'),
    'loadSubtitlesFromHistory must NOT call store.load (would remount UI)'
  );
  assert.ok(
    !loadFnBody.includes('setFile'),
    'loadSubtitlesFromHistory must NOT call setFile (would remount video)'
  );
  assert.ok(
    loadFnBody.includes('parseSrt'),
    'loadSubtitlesFromHistory must parse subtitle file directly'
  );
});

test('translator-agent-listener - history operations include sourceNote', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  
  // exportMountedSubtitles should return sourceNote when historyId is provided
  const exportFnMatch = listenerContent.match(/async function exportMountedSubtitles[\s\S]*?return \{[\s\S]*?\}/);
  assert.ok(exportFnMatch, 'exportMountedSubtitles not found');
  
  const exportFnBody = exportFnMatch[0];
  assert.ok(
    exportFnBody.includes('sourceNote'),
    'exportMountedSubtitles must return sourceNote field'
  );
  assert.ok(
    exportFnBody.includes('library item'),
    'sourceNote must indicate when exporting from library'
  );
  
  // subtitleBatchSnapshot should also return sourceNote
  const batchFnMatch = listenerContent.match(/async function subtitleBatchSnapshot[\s\S]*?return \{[\s\S]*?\}/);
  assert.ok(batchFnMatch, 'subtitleBatchSnapshot not found');
  
  const batchFnBody = batchFnMatch[0];
  assert.ok(
    batchFnBody.includes('sourceNote'),
    'subtitleBatchSnapshot must return sourceNote field'
  );
});

test('translator-agent-listener - loadSubtitlesFromHistory validates file exists', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  
  const loadFnMatch = listenerContent.match(/async function loadSubtitlesFromHistory[\s\S]*?return \{[\s\S]*?\}/);
  assert.ok(loadFnMatch, 'loadSubtitlesFromHistory function not found');
  
  const loadFnBody = loadFnMatch[0];
  
  // Must check video file exists
  assert.ok(
    loadFnBody.includes('fileExists'),
    'Must verify video file exists before loading'
  );
  
  // Must check stored subtitle file exists
  assert.ok(
    loadFnBody.includes('getStoredSubtitlePath') || loadFnBody.includes('storedSubtitlePath'),
    'Must locate stored subtitle file for video'
  );
  
  // Must throw error if subtitle file missing
  assert.ok(
    loadFnBody.includes('has no stored subtitles') || loadFnBody.includes('throw'),
    'Must throw error if stored subtitles missing'
  );
});

test('translator-agent-listener - loadSubtitlesFromHistory validates subtitle content', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  
  const loadFnMatch = listenerContent.match(/async function loadSubtitlesFromHistory[\s\S]*?return \{[\s\S]*?\}/);
  assert.ok(loadFnMatch, 'loadSubtitlesFromHistory function not found');
  
  const loadFnBody = loadFnMatch[0];
  
  // Must parse subtitle file
  assert.ok(
    loadFnBody.includes('parseSrt'),
    'Must parse SRT content'
  );
  
  // Must validate non-empty segments
  assert.ok(
    loadFnBody.includes('segments.length') || loadFnBody.includes('!segments.length'),
    'Must check segments array is not empty'
  );
  
  // Must throw error for empty subtitle file
  assert.ok(
    loadFnBody.includes('empty or unreadable'),
    'Must throw error for empty subtitle files'
  );
});

test('packaged-mcp - tool list excludes human-gated tools', () => {
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // TOOL_MAP must still exclude human-gated operations
  const excluded = [
    'openCreditCheckout',
    'storeProviderKey',
    'clearProviderKey',
  ];
  
  for (const method of excluded) {
    assert.ok(
      !helperContent.includes(`'${method}'`) || helperContent.includes('humanGatedMethods'),
      `${method} must remain human-gated`
    );
  }
});

test('documentation - no TRANSLATOR_AGENT_DEV references in production code', () => {
  const listenerPath = path.join(projectRoot, 'packages/renderer/listeners/translator-agent-listener.ts');
  const helperPath = path.join(projectRoot, 'packages/agent-server/src/packaged-mcp.mjs');
  
  const listenerContent = fs.readFileSync(listenerPath, 'utf8');
  const helperContent = fs.readFileSync(helperPath, 'utf8');
  
  // Filter out comment lines before checking
  const listenerLines = listenerContent.split('\n').filter(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith('//') && !trimmed.startsWith('*');
  });
  const helperLines = helperContent.split('\n').filter(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith('//') && !trimmed.startsWith('*');
  });
  
  const listenerCodeOnly = listenerLines.join('\n');
  const helperCodeOnly = helperLines.join('\n');
  
  assert.ok(
    !listenerCodeOnly.includes('TRANSLATOR_AGENT_DEV'),
    'translator-agent-listener must not reference TRANSLATOR_AGENT_DEV in code (comments OK)'
  );
  assert.ok(
    !helperCodeOnly.includes('TRANSLATOR_AGENT_DEV'),
    'packaged-mcp must not reference TRANSLATOR_AGENT_DEV in code (comments OK)'
  );
});
