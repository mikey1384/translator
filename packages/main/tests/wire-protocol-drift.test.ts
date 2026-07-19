// Guards the copied wire-protocol contract against drift. The canonical
// copy lives in stage5-api; this test compares exported name/value pairs
// (formatting- and quote-style-agnostic) whenever the sibling checkouts
// exist next to this repo, which is how this workspace is laid out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as wire from '../../shared/constants/wire-protocol.js';
import { ERROR_CODES } from '../../shared/constants/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OWN_COPY = path.resolve(
  __dirname,
  '../../shared/constants/wire-protocol.ts'
);
const CANONICAL = path.resolve(
  __dirname,
  '../../../../stage5-api/src/shared/wire-protocol.ts'
);
const RELAY_COPY = path.resolve(
  __dirname,
  '../../../../openai-relay/relay/wire-protocol.ts'
);

function parseWireExports(filePath: string): Record<string, string | number> {
  const source = fs.readFileSync(filePath, 'utf8');
  const out: Record<string, string | number> = {};
  const re =
    /export const (WIRE_\w+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?))\s*;/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const [, name, single, double, num] = m;
    out[name] = num !== undefined ? Number(num) : (single ?? double ?? '');
  }
  return out;
}

function diffMaps(
  a: Record<string, string | number>,
  b: Record<string, string | number>
): string[] {
  const problems: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(key in a)) problems.push(`missing here: ${key}`);
    else if (!(key in b)) problems.push(`missing there: ${key}`);
    else if (a[key] !== b[key])
      problems.push(`value mismatch for ${key}: ${a[key]} != ${b[key]}`);
  }
  return problems;
}

test('wire-protocol copy matches the canonical stage5-api file', t => {
  if (!fs.existsSync(CANONICAL)) {
    t.skip('stage5-api checkout not present next to this repo');
    return;
  }
  const problems = diffMaps(
    parseWireExports(OWN_COPY),
    parseWireExports(CANONICAL)
  );
  assert.deepEqual(problems, [], problems.join('; '));
});

test('wire-protocol copy matches the openai-relay copy', t => {
  if (!fs.existsSync(RELAY_COPY)) {
    t.skip('openai-relay checkout not present next to this repo');
    return;
  }
  const problems = diffMaps(
    parseWireExports(OWN_COPY),
    parseWireExports(RELAY_COPY)
  );
  assert.deepEqual(problems, [], problems.join('; '));
});

test('parser sees every export in our own copy', () => {
  const parsed = parseWireExports(OWN_COPY);
  const runtime = Object.fromEntries(
    Object.entries(wire).filter(([k]) => k.startsWith('WIRE_'))
  );
  assert.deepEqual(parsed, runtime);
  assert.ok(Object.keys(parsed).length >= 8, 'parser found too few exports');
});

test('legacy ERROR_CODES stay aligned with the wire protocol', () => {
  assert.equal(ERROR_CODES.UPDATE_REQUIRED, wire.WIRE_UPDATE_REQUIRED);
  assert.equal(
    ERROR_CODES.INSUFFICIENT_CREDITS,
    wire.WIRE_INSUFFICIENT_CREDITS
  );
});
