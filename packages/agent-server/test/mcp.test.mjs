import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

function toolValue(response) {
  if (response.structuredContent) return response.structuredContent;
  const text = response.content?.find(item => item.type === 'text')?.text;
  return JSON.parse(text || '{}');
}

test('MCP server exposes and runs the subscription-powered translation loop', async t => {
  const fixtureRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-mcp-test-')
  );
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));
  const sourcePath = path.join(fixtureRoot, 'source.srt');
  await fs.writeFile(
    sourcePath,
    `1\n00:00:00,000 --> 00:00:02,000\nThe app is ready.\n`
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, 'src', 'mcp.mjs')],
    env: {
      ...process.env,
      TRANSLATOR_AGENT_SESSION_ROOT: path.join(fixtureRoot, 'sessions'),
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'translator-test', version: '1.0.0' });
  t.after(async () => client.close());
  await client.connect(transport);

  const listed = await client.listTools();
  const names = listed.tools.map(tool => tool.name);
  assert.ok(names.includes('create_translation_session'));
  assert.ok(names.includes('app_set_subtitle_display'));
  assert.ok(names.includes('app_navigation_list'));
  assert.ok(names.includes('app_navigate'));
  assert.ok(names.includes('app_open_web_page'));
  assert.ok(names.includes('app_open_credit_checkout'));
  assert.ok(names.includes('app_start_video_download'));
  assert.ok(names.includes('app_start_transcription'));
  assert.ok(names.includes('app_start_translation'));
  assert.ok(names.includes('app_start_dubbing'));
  assert.ok(names.includes('app_start_summary'));
  assert.ok(names.includes('app_start_cue_translation'));
  assert.ok(names.includes('app_start_cue_transcription'));
  assert.ok(names.includes('app_start_merge'));
  assert.ok(names.includes('app_start_media_workflow'));
  assert.ok(names.includes('app_processing_status'));
  assert.ok(names.includes('app_processing_cancel'));
  assert.ok(names.includes('app_subtitles_get'));
  assert.ok(names.includes('app_subtitles_update'));
  assert.ok(names.includes('app_subtitles_mutate'));
  assert.ok(names.includes('app_subtitles_export'));
  assert.ok(names.includes('app_downloads_list'));
  assert.ok(names.includes('app_downloads_open'));
  assert.ok(names.includes('app_downloads_redownload'));
  assert.ok(names.includes('app_video_search'));
  assert.ok(names.includes('app_video_search_more'));
  assert.ok(names.includes('app_video_search_status'));
  assert.ok(names.includes('app_video_search_cancel'));
  assert.ok(names.includes('app_video_batch_download'));
  assert.ok(names.includes('app_video_batch_cancel'));
  assert.ok(names.includes('app_video_batch_status'));
  assert.ok(names.includes('app_settings_get'));
  assert.ok(names.includes('app_settings_update'));
  assert.ok(names.includes('app_settings_store_provider_key'));
  assert.ok(names.includes('app_settings_clear_provider_key'));

  const invalidRemoval = await client.callTool({
    name: 'app_subtitles_mutate',
    arguments: { operation: 'remove', id: 'cue-1' },
  });
  assert.equal(invalidRemoval.isError, true);

  const invalidTranslatedWorkflow = await client.callTool({
    name: 'app_start_media_workflow',
    arguments: { run_to: 'translate' },
  });
  assert.equal(invalidTranslatedWorkflow.isError, true);

  const invalidMergeOverwrite = await client.callTool({
    name: 'app_start_merge',
    arguments: {
      output_path: '/tmp/merged.mp4',
      confirm_overwrite: 'yes',
    },
  });
  assert.equal(invalidMergeOverwrite.isError, true);

  const invalidExportOverwrite = await client.callTool({
    name: 'app_subtitles_export',
    arguments: {
      path: '/tmp/subtitles.srt',
      confirm_overwrite: 'yes',
    },
  });
  assert.equal(invalidExportOverwrite.isError, true);

  const created = await client.callTool({
    name: 'create_translation_session',
    arguments: {
      source_srt: sourcePath,
      target_language: 'Korean',
      source_language: 'English',
    },
  });
  const sessionId = toolValue(created).sessionId;
  assert.ok(sessionId);

  const batch = await client.callTool({
    name: 'get_translation_batch',
    arguments: { session_id: sessionId },
  });
  assert.equal(toolValue(batch).cues[0].source, 'The app is ready.');

  await client.callTool({
    name: 'submit_translation_batch',
    arguments: {
      session_id: sessionId,
      translations: [{ id: 'cue-1', text: '앱을 사용할 준비가 되었습니다.' }],
    },
  });
  const outputPath = path.join(fixtureRoot, 'dual.srt');
  const exported = await client.callTool({
    name: 'export_translation_srt',
    arguments: {
      session_id: sessionId,
      mode: 'dual',
      output_path: outputPath,
    },
  });
  assert.equal(toolValue(exported).outputPath, outputPath);
  assert.match(await fs.readFile(outputPath, 'utf8'), /앱을 사용할 준비/);
});
