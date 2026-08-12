// boot.mjs – stays ESM so you can keep top-level await if you need it
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { createStartupHealth } from './startup-health.mjs';

const startupHealth = app.isPackaged
  ? createStartupHealth({
      stateFile: join(app.getPath('userData'), 'startup-health.json'),
      appVersion: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
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
