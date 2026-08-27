import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

type JsonObject = Record<string, unknown>;

const localesDirectory = dirname(fileURLToPath(import.meta.url));
const localeFilePattern = /^(?:[a-z]{2}|zh-(?:CN|TW))\.json$/;
const storageKeys = [
  'deleteLocalFile',
  'deleteLocalFileConfirm',
  'deleteLocalFileFailed',
  'deleteLocalFileUnavailable',
  'deleteLocalFileInUse',
  'deleteFileAndHistory',
  'deleteFileAndHistoryConfirm',
  'removeFromHistory',
  'removeFromHistoryConfirm',
] as const;

function readVideoSuggestion(fileName: string): JsonObject {
  const locale = JSON.parse(
    readFileSync(join(localesDirectory, fileName), 'utf8')
  ) as JsonObject;
  const input = locale.input as JsonObject | undefined;
  const videoSuggestion = input?.videoSuggestion;
  assert.ok(
    videoSuggestion &&
      typeof videoSuggestion === 'object' &&
      !Array.isArray(videoSuggestion),
    `${fileName} is missing input.videoSuggestion`
  );
  return videoSuggestion as JsonObject;
}

test('download-history storage actions are translated in every bundled locale', () => {
  const localeFiles = readdirSync(localesDirectory)
    .filter(fileName => localeFilePattern.test(fileName))
    .sort();
  assert.equal(localeFiles.length, 39, 'unexpected bundled locale count');

  const english = readVideoSuggestion('en.json');

  for (const fileName of localeFiles) {
    const videoSuggestion = readVideoSuggestion(fileName);
    for (const key of storageKeys) {
      const value = videoSuggestion[key];
      if (typeof value !== 'string') {
        assert.fail(`${fileName}: ${key} is missing`);
      }
      assert.ok(value.trim(), `${fileName}: ${key} is empty`);
      if (fileName !== 'en.json') {
        assert.notEqual(
          value,
          english[key],
          `${fileName}: ${key} still falls back to English`
        );
      }
    }
  }
});
