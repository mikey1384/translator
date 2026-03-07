#!/usr/bin/env node

import fs from 'node:fs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = new Map();

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) {
      fail(`Unexpected argument: ${raw}`);
    }

    const key = raw.slice(2);
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) {
      fail(`Missing value for --${key}`);
    }

    args.set(key, value);
    i += 1;
  }

  return args;
}

function readUtf8Text(path) {
  const raw = fs.readFileSync(path, 'utf8');
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function resolveReleaseNotes(args) {
  const inlineNotes = args.get('release-notes');
  if (inlineNotes && inlineNotes.trim()) {
    return inlineNotes.trim().replace(/\r\n/g, '\n');
  }

  const notesFile = args.get('release-notes-file');
  if (notesFile) {
    return readUtf8Text(notesFile).trim().replace(/\r\n/g, '\n');
  }

  fail('Release notes are required. Pass --release-notes or --release-notes-file.');
}

function stripExistingReleaseMetadata(input) {
  let output = input.replace(/^releaseName:.*\r?\n/gm, '');
  output = output.replace(
    /^releaseNotes:\s*[|>][-+0-9]*\s*\r?\n(?:^[ \t][^\r\n]*\r?\n?)*/gm,
    ''
  );
  output = output.replace(/^releaseNotes:\s*(?![|>]).*\r?\n/gm, '');
  return output.trimEnd();
}

const args = parseArgs(process.argv.slice(2));
const yamlPath = args.get('yaml');
const version = (args.get('version') || '').trim();

if (!yamlPath) {
  fail('Missing required argument: --yaml');
}

if (!version) {
  fail('Missing required argument: --version');
}

if (!fs.existsSync(yamlPath)) {
  fail(`Update metadata file not found: ${yamlPath}`);
}

const notes = resolveReleaseNotes(args);
if (!notes) {
  fail('Release notes are empty after trimming.');
}

const rawYaml = readUtf8Text(yamlPath);
const normalizedYaml = stripExistingReleaseMetadata(rawYaml);
const indentedNotes = notes
  .split('\n')
  .map(line => `  ${line}`)
  .join('\n');

const output = `${normalizedYaml}
releaseName: v${version}
releaseNotes: |-
${indentedNotes}
`;

fs.writeFileSync(yamlPath, output, 'utf8');
console.log(`Injected release notes into ${yamlPath}`);
