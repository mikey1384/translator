import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm', // Build as ESM first, then we'll convert
  target: 'node18',
  outfile: 'dist/main/main.mjs',
  sourcemap: true,
  // Only keep truly native modules external
  external: [
    'electron',
    'webrtcvad', // native .node addon
    'keytar', // native .node addon
    'ffmpeg-ffprobe-static', // needs to reference unpacked binaries
  ],
});

// Now convert the ESM output to CJS with proper wrapping
const fs = await import('fs');
const esmContent = await fs.promises.readFile('dist/main/main.mjs', 'utf8');

// Replace import.meta.url with CommonJS equivalent
let cjsContent = esmContent.replace(
  /import\.meta\.url/g,
  'require("url").pathToFileURL(__filename).href'
);

// Convert all ESM imports to CommonJS requires - handle multi-line imports
// Only match imports at the start of a line (possibly with whitespace)
cjsContent = cjsContent.replace(
  /^(\s*)import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?$/gm,
  (_match, indent, imports, module) => {
    // Clean up the imports and handle multi-line
    const cleanImports = imports.replace(/\s+/g, ' ').trim();
    return `${indent}const { ${cleanImports} } = require("${module}");`;
  }
);

// Convert namespace imports (import * as name from 'module')
cjsContent = cjsContent.replace(
  /^(\s*)import\s+\*\s+as\s+([^,\s]+)\s+from\s+['"]([^'"]+)['"];?$/gm,
  '$1const $2 = require("$3");'
);

// Convert default imports
cjsContent = cjsContent.replace(
  /^(\s*)import\s+([^{,\s][^,]*?)\s+from\s+['"]([^'"]+)['"];?$/gm,
  '$1const $2 = require("$3");'
);

// Convert side-effect imports
cjsContent = cjsContent.replace(
  /^(\s*)import\s+['"]([^'"]+)['"];?$/gm,
  '$1require("$2");'
);

// Convert mixed imports (default + named)
cjsContent = cjsContent.replace(
  /^(\s*)import\s+([^{,\s][^,]*?),\s*\{([^}]*)\}\s*from\s+['"]([^'"]+)['"];?$/gm,
  (_match, indent, defaultImport, namedImports, module) => {
    const cleanNamedImports = namedImports.replace(/\s+/g, ' ').trim();
    return `${indent}const ${defaultImport} = require("${module}"); const { ${cleanNamedImports} } = require("${module}");`;
  }
);

// Convert dynamic imports for external modules to synchronous require
// This handles patterns like: await import("@ffmpeg-installer/ffmpeg")
cjsContent = cjsContent.replace(
  /await\s+import\s*\(\s*['"](@ffmpeg-installer\/ffmpeg|@ffprobe-installer\/ffprobe|ffmpeg-ffprobe-static)['"]\s*\)/g,
  'require("$1")'
);

// Fix any remaining namespace import patterns in the converted code
cjsContent = cjsContent.replace(
  /const\s+\*\s+as\s+([^=\s]+)\s*=\s*require\(/g,
  'const $1 = require('
);

// Fix destructuring aliases: convert 'as' to ':' in object destructuring
// Run this multiple times to catch all instances in nested destructuring
let prevContent = '';
while (prevContent !== cjsContent) {
  prevContent = cjsContent;
  cjsContent = cjsContent.replace(
    /(\{[^}]*?)(\w+)\s+as\s+(\w+)([^}]*?\})/g,
    '$1$2: $3$4'
  );
}

// Wrap in IIFE for top-level await
cjsContent = `
// Wrap everything in an async IIFE to handle top-level await
(async () => {
${cjsContent}
})().catch(err => {
  console.error('Error in main process:', err);
  process.exit(1);
});
`;

// Write the CJS version
await fs.promises.writeFile('dist/main/main.cjs', cjsContent);

// Remove the temporary ESM file
await fs.promises.unlink('dist/main/main.mjs');
