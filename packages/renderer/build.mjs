// Bundles the renderer for the packaged app. Production React: without the
// NODE_ENV define esbuild ships React's development build, which made long
// subtitle lists stall the UI on every cue change.
import { build } from 'esbuild';

await build({
  entryPoints: ['./index.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['electron'],
  outfile: 'dist/index.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  minifySyntax: true,
  minifyWhitespace: true,
  logLevel: 'warning',
});
