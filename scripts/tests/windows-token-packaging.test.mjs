import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build, Platform, Arch } from 'electron-builder';
import { localBuilderConfig } from '../windows-token-release.mjs';

// Optional integration test: exercises the real NSIS/Wine uninstaller path
// with synthetic files and a recording hook, NEVER the hardware token. The
// resulting unsigned fixture is not a usable/signed Translator release.
test(
  'prepackaged Linux NSIS calls uninstaller signing before installer signing',
  {
    skip:
      process.platform !== 'linux' || process.env.TRANSLATOR_TEST_NSIS !== '1',
    timeout: 180_000,
  },
  async t => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'translator-nsis-fixture-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'translator-nsis-fixture',
        version: '0.0.0',
        description: 'Disposable NSIS packaging test',
        author: 'Stage5 Tools LLC',
      })
    );
    const app = path.join(root, 'app');
    fs.mkdirSync(path.join(app, 'resources'), { recursive: true });
    const payload = 'This is a packaging fixture, not an executable.';
    fs.writeFileSync(path.join(app, 'Translator.exe'), payload);
    const signedNames = [];
    const config = localBuilderConfig(
      path.resolve(import.meta.dirname, '../..'),
      async options => {
        assert.equal(options.hash, 'sha256');
        assert.equal(options.isNest, false);
        assert.ok(fs.statSync(options.path).size > 0);
        signedNames.push(path.basename(options.path));
      }
    );
    config.appId = 'tools.stage5.translator.packaging-test';
    config.directories = {
      output: path.join(root, 'output'),
      buildResources: path.join(root, 'build'),
    };
    config.icon = null;
    config.win.fileAssociations = [];
    delete config.nsis.include;
    await build({
      projectDir: root,
      prepackaged: app,
      targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
      config,
      publish: 'never',
    });
    assert.deepEqual(signedNames, [
      'elevate.exe',
      'Translator-Setup-0.0.0.__uninstaller.exe',
      'Translator-Setup-0.0.0.exe',
    ]);
    assert.equal(
      fs.readFileSync(path.join(app, 'Translator.exe'), 'utf8'),
      payload
    );
    assert.ok(
      fs.statSync(path.join(root, 'output/Translator-Setup-0.0.0.exe')).size > 0
    );
  }
);
