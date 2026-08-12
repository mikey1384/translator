import('./packages/main/boot.mjs').catch(error => {
  globalThis.__translatorStartupHealth?.recordFailure(
    'main_module_load_failed',
    'module_load'
  );
  console.error('Translator failed during bootstrap:', error);
  process.exit(1);
});
