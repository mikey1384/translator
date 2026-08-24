import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

type JsonObject = Record<string, unknown>;

const localesDirectory = dirname(fileURLToPath(import.meta.url));
const localeFilePattern = /^(?:[a-z]{2}|zh-(?:CN|TW))\.json$/;

function readLocale(fileName: string): JsonObject {
  return JSON.parse(
    readFileSync(join(localesDirectory, fileName), 'utf8')
  ) as JsonObject;
}

function getAgentControl(locale: JsonObject): JsonObject | undefined {
  const settings = locale.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return undefined;
  }

  const agentControl = (settings as JsonObject).agentControl;
  if (
    !agentControl ||
    typeof agentControl !== 'object' ||
    Array.isArray(agentControl)
  ) {
    return undefined;
  }

  return agentControl as JsonObject;
}

function flattenStrings(
  value: JsonObject,
  prefix = '',
  result = new Map<string, string>()
): Map<string, string> {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      result.set(fullKey, child);
    } else if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenStrings(child as JsonObject, fullKey, result);
    }
  }
  return result;
}

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/\{\{[^{}]+\}\}/g)].map(match => match[0]).sort();
}

test('Agent Control is completely translated in every bundled locale', () => {
  const localeFiles = readdirSync(localesDirectory)
    .filter(fileName => localeFilePattern.test(fileName))
    .sort();

  assert.equal(localeFiles.length, 39, 'unexpected bundled locale count');

  const english = getAgentControl(readLocale('en.json'));
  assert.ok(english, 'en.json is missing settings.agentControl');
  const englishStrings = flattenStrings(english);
  assert.equal(englishStrings.size, 25, 'unexpected Agent Control key count');

  for (const fileName of localeFiles) {
    const agentControl = getAgentControl(readLocale(fileName));
    assert.ok(agentControl, `${fileName} is missing settings.agentControl`);

    const translatedStrings = flattenStrings(agentControl);
    assert.deepEqual(
      [...translatedStrings.keys()].sort(),
      [...englishStrings.keys()].sort(),
      `${fileName} does not match the English Agent Control key contract`
    );

    for (const [key, englishValue] of englishStrings) {
      const translatedValue = translatedStrings.get(key);
      if (typeof translatedValue !== 'string' || !translatedValue.trim()) {
        assert.fail(`${fileName}: settings.agentControl.${key} is empty`);
      }
      assert.deepEqual(
        interpolationTokens(translatedValue),
        interpolationTokens(englishValue),
        `${fileName}: settings.agentControl.${key} has mismatched interpolation tokens`
      );

      if (fileName !== 'en.json') {
        assert.notEqual(
          translatedValue,
          englishValue,
          `${fileName}: settings.agentControl.${key} still falls back to English`
        );
      }
    }
  }
});
