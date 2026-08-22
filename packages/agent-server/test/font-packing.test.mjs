import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

test('electron-builder includes assets/fonts in extraResources', () => {
  const builderConfigPath = path.join(repoRoot, 'electron-builder.base.json');
  assert.ok(existsSync(builderConfigPath), 'electron-builder.base.json exists');
  
  const config = JSON.parse(readFileSync(builderConfigPath, 'utf8'));
  assert.ok(config.extraResources, 'extraResources defined');
  assert.ok(Array.isArray(config.extraResources), 'extraResources is array');
  
  const fontsEntry = config.extraResources.find(
    entry => entry.from === 'assets/fonts'
  );
  assert.ok(fontsEntry, 'assets/fonts entry found in extraResources');
  assert.equal(
    fontsEntry.to,
    'assets/fonts',
    'fonts map to assets/fonts in resources'
  );
});

test('required font files exist in assets/fonts', () => {
  const fontsDir = path.join(repoRoot, 'assets', 'fonts');
  assert.ok(existsSync(fontsDir), 'assets/fonts directory exists');
  
  const notoSansRegular = path.join(fontsDir, 'NotoSans-Regular.ttf');
  assert.ok(
    existsSync(notoSansRegular),
    'NotoSans-Regular.ttf exists in assets/fonts'
  );
  
  const fontsConf = path.join(fontsDir, 'fonts.conf');
  assert.ok(existsSync(fontsConf), 'fonts.conf exists in assets/fonts');
});

test('render-window-handlers references NotoSans-Regular.ttf', () => {
  const renderHandlerPath = path.join(
    repoRoot,
    'packages',
    'main',
    'handlers',
    'render-window-handlers',
    'index.ts'
  );
  assert.ok(existsSync(renderHandlerPath), 'render-window-handlers/index.ts exists');
  
  const source = readFileSync(renderHandlerPath, 'utf8');
  assert.ok(
    source.includes('NotoSans-Regular.ttf'),
    'render handler references NotoSans-Regular.ttf'
  );
  assert.ok(
    source.includes('getAssetsPath'),
    'render handler uses getAssetsPath helper'
  );
});
