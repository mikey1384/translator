// boot.mjs – stays ESM so you can keep top-level await if you need it
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { createStartupHealth } from './startup-health.mjs';

// Isolate agent-driven local UI checks from the user's installed app profile.
if (!app.isPackaged && process.env.TRANSLATOR_AGENT_DEV === '1' &&
    process.env.TRANSLATOR_DEV_USER_DATA && isAbsolute(process.env.TRANSLATOR_DEV_USER_DATA)) {
  app.setPath('userData', process.env.TRANSLATOR_DEV_USER_DATA);
}

const startupHealth = app.isPackaged
  ? createStartupHealth({
      stateFile: join(app.getPath('userData'), 'startup-health.json'),
      appVersion: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      reportingEnabled: () => {
        try { return JSON.parse(readFileSync(join(app.getPath('userData'), 'product-analytics-preference.json'), 'utf8')).enabled === true; }
        catch { return false; }
      },
    })
  : {
      setPhase() {},
      markSuccessful() {},
      recordFailure() {},
      listPendingFailures() {
        return [];
      },
      acknowledgeFailure() {},
    };
globalThis.__translatorStartupHealth = startupHealth;

// pass __dirname-like path to CJS bundle
const mainPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'dist',
  'main',
  'main.cjs'
);
try {
  await import(pathToFileURL(mainPath).href); // loads CJS bundle synchronously with proper URL
} catch (error) {
  startupHealth.recordFailure('main_module_load_failed', 'module_load');
  throw error;
}
