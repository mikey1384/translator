import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('privacy controls cover all 39 bundled locales without missing or fallback text', () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(directory).filter(name =>
    /^(?:[a-z]{2}|zh-(?:CN|TW))\.json$/.test(name)
  );
  assert.equal(files.length, 39);
  const english = JSON.parse(readFileSync(join(directory, 'en.json'), 'utf8'))
    .settings.privacy;
  assert.equal(Object.keys(english).length, 11);
  for (const file of files) {
    const copy = JSON.parse(readFileSync(join(directory, file), 'utf8'))
      .settings.privacy;
    assert.deepEqual(
      Object.keys(copy).sort(),
      Object.keys(english).sort(),
      file
    );
    for (const key of Object.keys(english)) {
      assert.ok(
        typeof copy[key] === 'string' && copy[key].trim(),
        `${file}: ${key}`
      );
      // “Privacy” is also the normal term in Dutch and Italian.
      if (
        file !== 'en.json' &&
        !(['nl.json', 'it.json'].includes(file) && key === 'title')
      )
        assert.notEqual(copy[key], english[key], `${file}: ${key}`);
    }
    assert.ok(copy.description.includes('Google Analytics'), file);
    assert.match(copy.retention, /3|۳|৩/, file);
  }
});
