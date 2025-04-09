const { notarize } = require('@electron/notarize');
const { build } = require('./package.json');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  console.log('Notarizing app...');

  // Environment variables must be set:
  // APPLE_ID: Your Apple ID email
  // APPLE_APP_SPECIFIC_PASSWORD: App-specific password (not your Apple ID password)
  // APPLE_TEAM_ID: Your Apple Developer Team ID (can be found in your developer account)

  const appName = context.packager.appInfo.productFilename;

  try {
    return await notarize({
      tool: 'notarytool',
      appPath: `${appOutDir}/${appName}.app`,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    });
  } catch (error) {
    console.error('Error during notarization:', error);
    throw error;
  }
};
