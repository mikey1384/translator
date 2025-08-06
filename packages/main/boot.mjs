// boot.mjs – stays ESM so you can keep top-level await if you need it
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// pass __dirname-like path to CJS bundle
const mainPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'dist',
  'main',
  'main.cjs'
);
await import(pathToFileURL(mainPath).href); // loads CJS bundle synchronously with proper URL
