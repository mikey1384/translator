const fs = require('node:fs');
const path = require('node:path');
const { listPackage } = require('@electron/asar');

function verifyPackagedRuntime(appPath, platform, arch) {
  const resources = path.join(appPath, ...(platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']));
  for (const entry of fs.readdirSync(resources)) {
    if (/^headless-/.test(entry)) throw new Error(`Unexpected bundled browser: ${entry}`);
  }
  const nativeRoot = path.join(resources, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
  const platforms = fs.readdirSync(nativeRoot).filter(name => fs.statSync(path.join(nativeRoot, name)).isDirectory());
  if (platforms.length !== 1 || platforms[0] !== platform) {
    throw new Error(`Unexpected ONNX platforms: ${platforms.join(', ')}`);
  }
  const architectures = fs.readdirSync(path.join(nativeRoot, platform));
  if (architectures.length !== 1 || architectures[0] !== arch) {
    throw new Error(`Unexpected ONNX architectures: ${architectures.join(', ')}`);
  }
  const binding = path.join(nativeRoot, platform, arch, 'onnxruntime_binding.node');
  if (!fs.statSync(binding).isFile() || fs.statSync(binding).size === 0) throw new Error('Missing ONNX binding');
  const files = listPackage(path.join(resources, 'app.asar')).map(file => file.replaceAll('\\', '/'));
  const accidentalPayload = files.find(file => /^\/(?:\.local(?:\/|$)|\.env(?:\.|$)|vendor\/headless-)/.test(file));
  if (accidentalPayload) throw new Error(`Unexpected local or browser payload: ${accidentalPayload}`);
  if (!files.includes('/node_modules/yauzl/index.js')) throw new Error('Missing runtime ZIP extractor');
  const forbidden = files.filter(file => /^\/node_modules\/(?:esbuild|@esbuild|@types\/(?:uuid|which|react-window))(?:\/|$)/.test(file) || file.endsWith('/main.mjs.map'));
  if (forbidden.length) throw new Error(`Unexpected development payload: ${forbidden[0]}`);
  console.log(`Packaged runtime verified: ${platform}/${arch}, on-demand browser, ZIP extractor available.`);
}

module.exports = { verifyPackagedRuntime };

if (require.main === module) {
  try { verifyPackagedRuntime(...process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
