module.exports = async context => {
  const platform = context.packager.platform.nodeName;
  const arch = require('builder-util').Arch[context.arch];
  const appPath = platform === 'darwin'
    ? require('node:path').join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    : context.appOutDir;
  require('./verify-packaged-runtime.cjs').verifyPackagedRuntime(appPath, platform, arch);
  if (context.packager.platform.nodeName === 'win32') {
    // This also runs for unsigned CI builds, before creating an installer.
    require('./verify-windows-media.cjs').verifyWindowsMedia(context.appOutDir);
  }
  return require('./sign-chromium.cjs')(context);
};
