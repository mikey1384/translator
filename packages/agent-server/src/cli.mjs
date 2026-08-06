#!/usr/bin/env node
import { TranslationSessionStore } from './session-store.mjs';

const [command, ...rawArgs] = process.argv.slice(2);
const args = Object.fromEntries(
  rawArgs.map(argument => {
    const [key, ...value] = argument.replace(/^--/, '').split('=');
    return [key, value.join('=')];
  })
);
const store = new TranslationSessionStore({
  root: process.env.TRANSLATOR_AGENT_SESSION_ROOT || undefined,
});
const HELP =
  'Usage: translator-agent <create|batch|status|export> --key=value\n' +
  'Use MCP for structured batch submission and development-app control.\n';

function requireArg(name) {
  if (!args[name]) throw new Error(`Missing --${name}=...`);
  return args[name];
}

async function main() {
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return;
  }

  let output;
  switch (command) {
    case 'create':
      output = await store.create({
        sourceSrt: requireArg('source'),
        targetLanguage: requireArg('target'),
        sourceLanguage: args['source-language'] || 'auto',
        existingTranslationSrt: args.translation,
      });
      break;
    case 'batch':
      output = await store.getBatch(requireArg('session'), {
        mode: args.mode || 'translate',
        limit: Number(args.limit || 8),
      });
      break;
    case 'status':
      output = await store.status(requireArg('session'));
      break;
    case 'export':
      output = await store.export(requireArg('session'), {
        mode: args.mode || 'dual',
        outputPath: args.output,
      });
      break;
    default:
      throw new Error(`Unknown command: ${command}\n${HELP}`);
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`translator-agent: ${error.message}\n`);
  process.exitCode = 1;
});
