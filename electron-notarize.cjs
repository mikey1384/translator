// Import dotenv to load environment variables from .env file
require('dotenv').config();

// const { notarize } = require('@electron/notarize'); // Removed require
// const { build } = require('./package.json'); // We don't seem to use 'build', remove this too

exports.default = async function notarizing(context) {
  // Dynamically import @electron/notarize
  const { notarize } = await import('@electron/notarize');

  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  console.log('Notarizing app...');

  // Environment variables should be defined in .env file:
  // APPLE_ID: Your Apple ID email
  // APPLE_APP_SPECIFIC_PASSWORD: App-specific password (not your Apple ID password)
  // APPLE_TEAM_ID: Your Apple Developer Team ID (can be found in your developer account)

  // Verify that required environment variables are set
  if (!process.env.APPLE_ID) {
    console.warn(
      'APPLE_ID not found in environment variables. Skipping notarization.'
    );
    return;
  }
  if (!process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.warn(
      'APPLE_APP_SPECIFIC_PASSWORD not found in environment variables. Skipping notarization.'
    );
    return;
  }
  if (!process.env.APPLE_TEAM_ID) {
    console.warn(
      'APPLE_TEAM_ID not found in environment variables. Skipping notarization.'
    );
    return;
  }

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
