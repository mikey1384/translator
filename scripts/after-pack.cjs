module.exports = async context => {
  if (context.packager.platform.nodeName === 'win32') {
    // This also runs for unsigned CI builds, before creating an installer.
    require('./verify-windows-media.cjs').verifyWindowsMedia(context.appOutDir);
  }
  return require('./sign-chromium.cjs')(context);
};
