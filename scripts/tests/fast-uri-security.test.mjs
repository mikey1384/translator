import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Conf from 'conf';
import uri from 'fast-uri';

test('encoded schemes cannot introduce a host or raw header characters', () => {
  for (const input of [
    '%2f%2fexample.invalid:/check',
    '%u002f%u002fexample.invalid:/check',
    'https%0d%0aX-Test:/check',
  ]) {
    const normalized = uri.normalize(input);
    assert.equal(normalized, input);
    assert.equal(uri.parse(normalized).host, undefined);
    assert.equal(normalized.includes('\r') || normalized.includes('\n'), false);
    assert.match(uri.parse(normalized).error, /scheme.*malformed/i);
    assert.throws(
      () => uri.resolve('https://safe.example/path', input),
      /scheme.*malformed/i
    );
  }
  assert.equal(
    uri.resolve('https://safe.example/a/', '../b'),
    'https://safe.example/b'
  );
});

test('settings validation and persistence work with the patched URI resolver', () => {
  const cwd = fs.mkdtempSync(
    path.join(os.tmpdir(), 'translator-settings-test-')
  );
  try {
    // Conf is electron-store's persistence/validation layer. Use a disposable
    // store so no app process, credentials, or real user preferences are read.
    const options = {
      cwd,
      schema: {
        analyticsEnabled: { type: 'boolean', default: false },
        sourceUrl: { type: 'string', format: 'uri' },
      },
    };
    const store = new Conf(options);
    assert.equal(store.get('analyticsEnabled'), false);
    store.set('sourceUrl', 'https://example.invalid/video?id=123');
    store.set('analyticsEnabled', true);
    assert.throws(() => store.set('analyticsEnabled', 'yes'));
    assert.throws(() => store.set('sourceUrl', 'not a valid URI'));

    const reopened = new Conf(options);
    assert.equal(reopened.get('analyticsEnabled'), true);
    assert.equal(
      reopened.get('sourceUrl'),
      'https://example.invalid/video?id=123'
    );
    reopened.set('analyticsEnabled', false);
    assert.equal(new Conf(options).get('analyticsEnabled'), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
