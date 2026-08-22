import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { readFileSync } from 'fs';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const mcpPath = path.join(packageRoot, 'src', 'packaged-mcp.mjs');

test('packaged-mcp.mjs app_start_merge schema includes style and display_mode', () => {
  const source = readFileSync(mcpPath, 'utf8');
  
  // Extract TOOL_SCHEMAS from the source
  const toolSchemasMatch = source.match(
    /const TOOL_SCHEMAS = \{([\s\S]+?)\n\};/
  );
  assert.ok(toolSchemasMatch, 'TOOL_SCHEMAS found in packaged-mcp.mjs');
  
  // Check that app_start_merge schema includes the new parameters
  const appStartMergeMatch = source.match(
    /app_start_merge:\s*\{[\s\S]+?additionalProperties:\s*false\s*\}/
  );
  assert.ok(appStartMergeMatch, 'app_start_merge schema found');
  
  const mergeSchema = appStartMergeMatch[0];
  assert.ok(mergeSchema.includes('history_id'), 'schema includes history_id');
  assert.ok(mergeSchema.includes('style'), 'schema includes style');
  assert.ok(mergeSchema.includes('display_mode'), 'schema includes display_mode');
  assert.ok(
    mergeSchema.includes("'Default', 'Classic', 'Boxed', 'LineBox'"),
    'style enum includes all subtitle styles'
  );
  assert.ok(
    mergeSchema.includes("'original', 'translation', 'dual'"),
    'display_mode enum includes all display modes'
  );
});

test('packaged-mcp.mjs mapFields handles display_mode', () => {
  const source = readFileSync(mcpPath, 'utf8');
  
  // Check that mapFields includes display_mode mapping
  const mapFieldsMatch = source.match(/function mapFields\([\s\S]+?\n\}/);
  assert.ok(mapFieldsMatch, 'mapFields function found');
  
  const mapFields = mapFieldsMatch[0];
  assert.ok(
    mapFields.includes('display_mode'),
    'mapFields includes display_mode handling'
  );
  assert.ok(
    mapFields.includes('displayMode'),
    'mapFields maps to displayMode'
  );
});
