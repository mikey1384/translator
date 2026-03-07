#!/usr/bin/env node
/**
 * Code Locale Coverage Audit
 *
 * Scans renderer source for i18n calls and reports translation keys that are
 * referenced in code but missing from en.json. This catches source-locale gaps
 * that the locale-file audit alone cannot see.
 *
 * Exit codes:
 *   0 - All discovered code-referenced keys exist in en.json
 *   1 - Missing source-locale keys found
 */

import { readFileSync, readdirSync } from 'fs';
import { dirname, extname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER_ROOT = dirname(__dirname);
const EN_FILE = join(__dirname, 'en.json');

function flattenObject(obj, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, fullKey, out);
    } else if (typeof value === 'string') {
      out.add(fullKey);
    }
  }
  return out;
}

function walk(dir, files = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function getScriptKind(file) {
  switch (extname(file)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.ts':
      return ts.ScriptKind.TS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    default:
      return ts.ScriptKind.JS;
  }
}

function getStringLiteralText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function getDefaultValue(node) {
  if (!ts.isObjectLiteralExpression(node)) return null;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name =
      ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : null;
    if (name !== 'defaultValue') continue;
    return getStringLiteralText(property.initializer);
  }
  return null;
}

function isTranslationCall(node) {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text === 't';
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text === 't';
  }
  return false;
}

function collectReferencedKeys(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(file)
  );
  const discovered = [];

  function visit(node) {
    if (isTranslationCall(node)) {
      const [keyArg, secondArg] = node.arguments;
      const key = keyArg ? getStringLiteralText(keyArg) : null;
      if (key) {
        let fallback = null;
        if (secondArg) {
          fallback =
            getStringLiteralText(secondArg) ?? getDefaultValue(secondArg);
        }
        discovered.push({ key, fallback });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return discovered;
}

function main() {
  const en = JSON.parse(readFileSync(EN_FILE, 'utf8'));
  const enKeys = flattenObject(en);
  const files = walk(RENDERER_ROOT);
  const missing = new Map();

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const { key, fallback } of collectReferencedKeys(file, source)) {
      if (enKeys.has(key)) continue;
      if (!missing.has(key)) {
        missing.set(key, { fallbacks: new Set(), files: new Set() });
      }
      const entry = missing.get(key);
      if (fallback) {
        entry.fallbacks.add(fallback);
      }
      entry.files.add(relative(RENDERER_ROOT, file));
    }
  }

  console.log(`Source of truth: en.json (${enKeys.size} keys)\n`);

  if (missing.size === 0) {
    console.log('All code-referenced locale keys exist in en.json!');
    return;
  }

  console.log(`Missing source-locale keys: ${missing.size}\n`);
  for (const [key, info] of [...missing.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    console.log(key);
    console.log(
      `  fallback: ${
        info.fallbacks.size > 0
          ? [...info.fallbacks].join(' | ')
          : '(no inline fallback)'
      }`
    );
    console.log(`  files: ${[...info.files].join(', ')}`);
  }

  process.exitCode = 1;
}

main();
