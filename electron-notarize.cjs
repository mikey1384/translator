// Import dotenv to load environment variables from .env file
require('dotenv').config();

exports.default = async function notarizeApp(context) {
  const { notarize } = await import('@electron/notarize');

  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log('Notarizing app...');

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

  try {
    await notarize({
      tool: 'notarytool',
      appPath: `${appOutDir}/${appName}.app`,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    });

    console.log('App notarized successfully');
  } catch (error) {
    console.error('Error during notarization:', error);
    throw error;
  }
};
