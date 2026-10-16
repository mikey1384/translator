import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createPackage } = require('@electron/asar');
const { doMergeConfigs } = require('app-builder-lib/out/util/config/config.js');
const { getMainFileMatchers, getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher.js');
const { verifyPackagedRuntime } = require('../verify-packaged-runtime.cjs');
const root = path.resolve(import.meta.dirname, '../..');

test('effective builder filters keep the app allow-list and only the native ONNX target', async () => {
  const base = JSON.parse(await fs.readFile(path.join(root, 'electron-builder.base.json'), 'utf8'));
  const win = JSON.parse(await fs.readFile(path.join(root, 'electron-builder.win.json'), 'utf8'));
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
    const config = doMergeConfigs([structuredClone(base), ...(platform === 'win32' ? [structuredClone(win)] : [])]);
    const platformConfig = config[platform === 'darwin' ? 'mac' : 'win'];
    // Releases build on their native OS; electron-builder's platform macro is the host OS.
    const expand = value => value.replaceAll('${platform}', platform).replaceAll('${arch}', arch);
    const info = { config, projectDir: root, buildResourcesDir: 'build', isPrepackedAppAsar: false, debugLogger: { isEnabled: false } };
    const matchers = getMainFileMatchers(root, path.join(root, '.local/test-package'), expand, platformConfig, {info}, path.join(root, '.local/test-package'), false);
    const included = relative => matchers.some(matcher => matcher.createFilter()(path.join(root, relative), {isDirectory: () => false}));
    assert.equal(included('packages/main/dist/main/main.cjs'), true);
    assert.equal(included('render-host-script.js'), true);
    for (const relative of ['.local/archive.zip', '.env', 'vendor/headless-arm64/chrome', 'packages/main/index.ts', 'packages/main/dist/main/main.mjs.map']) {
      assert.equal(included(relative), false, `${platform}/${arch} must exclude ${relative}`);
    }
    const nativeFilter = getNodeModuleFileMatcher(root, root, expand, platformConfig, info).createFilter();
    for (const osName of ['darwin', 'win32', 'linux']) {
      for (const cpu of ['arm64', 'x64']) {
        const candidate = path.join(root, 'node_modules/onnxruntime-node/bin/napi-v6', osName, cpu, 'onnxruntime_binding.node');
        assert.equal(nativeFilter(candidate, {isDirectory: () => false}), osName === platform && cpu === arch, candidate);
      }
    }
  }
});

async function fixture(t, platform, arch, files = {'node_modules/yauzl/index.js':'ZIP extractor'}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage5-package-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const resources = path.join(dir, ...(platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']));
  const native = path.join(resources, 'app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6');
  const binding = path.join(native, platform, arch, 'onnxruntime_binding.node');
  await fs.mkdir(path.dirname(binding), {recursive: true});
  await fs.writeFile(binding, 'native binding');
  const source = path.join(dir, 'source');
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(source, name)), {recursive: true});
    await fs.writeFile(path.join(source, name), content);
  }
  await createPackage(source, path.join(resources, 'app.asar'));
  return {dir, resources, native};
}

for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
  test(`packaged runtime accepts a complete ${platform}/${arch} payload`, async t => {
    const {dir} = await fixture(t, platform, arch);
    assert.doesNotThrow(() => verifyPackagedRuntime(dir, platform, arch));
  });
}

test('packaged runtime rejects another platform, architecture, or bundled browser', async t => {
  const {dir, resources, native} = await fixture(t, 'darwin', 'arm64');
  await fs.mkdir(path.join(native, 'win32'));
  assert.throws(() => verifyPackagedRuntime(dir, 'darwin', 'arm64'), /ONNX platforms/);
  await fs.rmdir(path.join(native, 'win32'));
  await fs.mkdir(path.join(native, 'darwin/x64'));
  assert.throws(() => verifyPackagedRuntime(dir, 'darwin', 'arm64'), /ONNX architectures/);
  await fs.rmdir(path.join(native, 'darwin/x64'));
  await fs.mkdir(path.join(resources, 'headless-arm64'));
  assert.throws(() => verifyPackagedRuntime(dir, 'darwin', 'arm64'), /bundled browser/);
});

for (const extra of ['.local/archive.zip', '.env', 'vendor/headless-arm64/chrome', 'node_modules/esbuild/bin/esbuild', 'packages/main/dist/main/main.mjs.map']) {
  test(`packaged runtime rejects accidental payload ${extra}`, async t => {
    const {dir} = await fixture(t, 'win32', 'x64', {'node_modules/yauzl/index.js':'ZIP extractor', [extra]:'unexpected'});
    assert.throws(() => verifyPackagedRuntime(dir, 'win32', 'x64'), /Unexpected/);
  });
}

test('packaged runtime rejects a missing ZIP extractor', async t => {
  const {dir} = await fixture(t, 'win32', 'x64', {'package.json':'{}'});
  assert.throws(() => verifyPackagedRuntime(dir, 'win32', 'x64'), /Missing runtime ZIP extractor/);
});
