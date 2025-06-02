/* Injected at the very top of the main bundle (ESM) */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

/* CommonJS shims - make them global so every dep can see them */
globalThis.require = createRequire(import.meta.url);
globalThis.__filename = fileURLToPath(import.meta.url);
globalThis.__dirname = path.dirname(globalThis.__filename);
