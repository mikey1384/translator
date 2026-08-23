#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM_CONFIG = Object.freeze({
  mac: {
    manifestName: 'latest-mac.yml',
    retentionName: 'release-retention.json',
    stableNames: ['Translator-arm64.dmg', 'Translator-x64.dmg'],
    manifestPayloadPattern:
      /^Translator-(\d+\.\d+\.\d+)-darwin-(?:arm64|x64)\.(?:dmg|zip)$/,
    managedPayloadPattern:
      /^Translator-(\d+\.\d+\.\d+)-darwin-(?:arm64|x64)\.(?:dmg|zip)(?:\.blockmap)?$/,
  },
  win: {
    manifestName: 'latest.yml',
    retentionName: 'release-retention.json',
    stableNames: ['Translator-x64.exe', 'Translator-x64.exe.sha256'],
    manifestPayloadPattern: /^Translator-Setup-(\d+\.\d+\.\d+)\.exe$/,
    managedPayloadPattern:
      /^Translator-Setup-(\d+\.\d+\.\d+)\.exe(?:\.blockmap)?$/,
  },
});

function compareSemver(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function normalizeInventoryName(rawName, platform) {
  const trimmed = String(rawName || '').trim();
  const prefix = `${platform}/latest/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function parseManifestVersion(manifest) {
  const matches = [
    ...manifest.matchAll(/^version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/gm),
  ];
  if (matches.length !== 1) {
    throw new Error(
      'Update manifest must contain exactly one top-level strict SemVer version field'
    );
  }
  return matches[0][1];
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function extractManifestPayloadNames(manifest, platform) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) throw new Error(`Unsupported release platform: ${platform}`);

  const payloadNames = new Set();
  const rawValues = [];
  let inFiles = false;
  for (const line of manifest.split(/\r?\n/)) {
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (/^[^\s#]/.test(line)) inFiles = false;

    const filesMatch = inFiles ? /^ {2}- url:\s*(.+?)\s*$/.exec(line) : null;
    const pathMatch = /^path:\s*(.+?)\s*$/.exec(line);
    const value = filesMatch?.[1] ?? pathMatch?.[1];
    if (value !== undefined) rawValues.push(value);
  }

  for (const value of rawValues) {
    let rawValue = unquoteYamlScalar(value);
    try {
      if (/^https?:\/\//i.test(rawValue)) {
        rawValue = new URL(rawValue).pathname;
      } else {
        rawValue = rawValue.split(/[?#]/, 1)[0];
      }
      rawValue = decodeURIComponent(rawValue);
    } catch (error) {
      throw new Error(`Invalid updater payload URL: ${value}`, {
        cause: error,
      });
    }

    const name = path.posix.basename(rawValue.replaceAll('\\', '/'));
    if (!config.manifestPayloadPattern.test(name)) {
      throw new Error(`Unexpected ${platform} updater payload name: ${name}`);
    }
    payloadNames.add(name);
  }

  if (payloadNames.size === 0) {
    throw new Error(`Update manifest does not name any ${platform} payloads`);
  }
  return [...payloadNames].sort();
}

function manifestIdentity(manifest, platform) {
  const version = parseManifestVersion(manifest);
  const payloads = extractManifestPayloadNames(manifest, platform);
  const config = PLATFORM_CONFIG[platform];
  const mismatchedPayloads = payloads.filter(
    payload => config.manifestPayloadPattern.exec(payload)?.[1] !== version
  );
  if (mismatchedPayloads.length > 0) {
    throw new Error(
      `Manifest version ${version} does not match payloads: ${mismatchedPayloads.join(', ')}`
    );
  }
  return { version, payloads };
}

function parseRetentionState(retentionState, platform, currentVersion) {
  let state;
  try {
    state =
      typeof retentionState === 'string'
        ? JSON.parse(retentionState)
        : retentionState;
  } catch (error) {
    throw new Error('Release retention state is not valid JSON', {
      cause: error,
    });
  }
  if (
    !state ||
    state.schema !== 1 ||
    state.platform !== platform ||
    state.currentVersion !== currentVersion ||
    !/^\d+\.\d+\.\d+$/.test(state.previousVersion || '') ||
    state.previousVersion === currentVersion ||
    !Array.isArray(state.previousPayloads) ||
    state.previousPayloads.length === 0
  ) {
    throw new Error(
      `Release retention state does not match ${platform} ${currentVersion}`
    );
  }

  const config = PLATFORM_CONFIG[platform];
  const previousPayloads = [...new Set(state.previousPayloads)].sort();
  for (const payload of previousPayloads) {
    const match = config.manifestPayloadPattern.exec(payload);
    if (!match || match[1] !== state.previousVersion) {
      throw new Error(`Invalid previous payload in release retention: ${payload}`);
    }
  }
  return {
    schema: 1,
    platform,
    currentVersion,
    previousVersion: state.previousVersion,
    previousPayloads,
  };
}

export function createRetentionState({
  platform,
  currentManifest,
  publishedManifest,
  existingRetention,
}) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) throw new Error(`Unsupported release platform: ${platform}`);
  const current = manifestIdentity(currentManifest, platform);
  const published = manifestIdentity(publishedManifest, platform);

  if (published.version === current.version) {
    if (!existingRetention) {
      throw new Error(
        `Published ${platform} manifest already names ${current.version}, but no exact retention state exists`
      );
    }
    return parseRetentionState(
      existingRetention,
      platform,
      current.version
    );
  }

  return {
    schema: 1,
    platform,
    currentVersion: current.version,
    previousVersion: published.version,
    previousPayloads: published.payloads,
  };
}

export function planLatestPrefixPrune({
  platform,
  inventoryNames,
  currentManifest,
  retentionState,
}) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) throw new Error(`Unsupported release platform: ${platform}`);

  const inventory = new Set(
    inventoryNames
      .map(name => normalizeInventoryName(name, platform))
      .filter(Boolean)
  );
  const current = manifestIdentity(currentManifest, platform);
  const currentVersion = current.version;
  const currentPayloads = current.payloads;
  const retention = retentionState
    ? parseRetentionState(retentionState, platform, currentVersion)
    : null;
  const requiredCurrent = new Set([
    config.manifestName,
    ...config.stableNames,
    ...currentPayloads,
  ]);
  if (retention) requiredCurrent.add(config.retentionName);

  for (const payload of currentPayloads) {
    const blockmap = `${payload}.blockmap`;
    if (inventory.has(blockmap)) requiredCurrent.add(blockmap);
  }

  const missingCurrent = [...requiredCurrent].filter(name => !inventory.has(name));
  if (missingCurrent.length > 0) {
    throw new Error(
      `Refusing to prune ${platform}/latest; required current objects are missing: ${missingCurrent.join(', ')}`
    );
  }

  let previousVersion = retention?.previousVersion ?? null;
  if (!previousVersion) {
    const otherVersions = new Set();
    for (const name of inventory) {
      const version = config.managedPayloadPattern.exec(name)?.[1];
      if (version && version !== currentVersion) otherVersions.add(version);
    }
    previousVersion = [...otherVersions].sort(compareSemver).at(-1) ?? null;
  }

  const keep = new Set(requiredCurrent);
  if (retention) {
    const missingPrevious = retention.previousPayloads.filter(
      name => !inventory.has(name)
    );
    if (missingPrevious.length > 0) {
      throw new Error(
        `Refusing to prune ${platform}/latest; retained previous objects are missing: ${missingPrevious.join(', ')}`
      );
    }
    for (const payload of retention.previousPayloads) {
      keep.add(payload);
      const blockmap = `${payload}.blockmap`;
      if (inventory.has(blockmap)) keep.add(blockmap);
    }
  } else if (previousVersion) {
    for (const name of inventory) {
      if (config.managedPayloadPattern.exec(name)?.[1] === previousVersion) {
        keep.add(name);
      }
    }
  }

  // Automated cleanup is deliberately allowlisted to versioned updater
  // payloads. Unknown objects are reported but never deleted; changing the
  // delivery contract therefore requires an explicit policy update.
  const managed = [...inventory].filter(name =>
    config.managedPayloadPattern.test(name)
  );
  const remove = managed.filter(name => !keep.has(name)).sort();
  const ignored = [...inventory]
    .filter(name => !keep.has(name) && !managed.includes(name))
    .sort();
  return {
    platform,
    currentVersion,
    previousVersion,
    retentionMode: retention ? 'exact' : 'inferred',
    keep: [...keep].sort(),
    remove,
    ignored,
  };
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument sequence near ${key || '(end)'}`);
    }
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) {
      throw new Error(`Duplicate argument: --${name}`);
    }
    options[name] = value;
  }
  return options;
}

function runCli() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseCliArgs(rest);
  if (command === 'prepare-retention') {
    if (
      !options.platform ||
      !options['current-manifest'] ||
      !options['published-manifest'] ||
      !options.output
    ) {
      throw new Error(
        'prepare-retention requires --platform, --current-manifest, --published-manifest, and --output'
      );
    }
    const state = createRetentionState({
      platform: options.platform,
      currentManifest: fs.readFileSync(options['current-manifest'], 'utf8'),
      publishedManifest: fs.readFileSync(
        options['published-manifest'],
        'utf8'
      ),
      existingRetention: options['existing-retention']
        ? fs.readFileSync(options['existing-retention'], 'utf8')
        : undefined,
    });
    fs.writeFileSync(options.output, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `[release-storage] prepared ${state.platform} current=${state.currentVersion} previous=${state.previousVersion} payloads=${state.previousPayloads.length}\n`
    );
    return;
  }
  if (command !== 'plan-latest') {
    throw new Error(
      'Usage: release-storage-policy.mjs <prepare-retention|plan-latest> [options]'
    );
  }
  if (!options.platform || !options.inventory || !options['current-manifest']) {
    throw new Error('plan-latest requires --platform, --inventory, and --current-manifest');
  }
  const plan = planLatestPrefixPrune({
    platform: options.platform,
    inventoryNames: fs.readFileSync(options.inventory, 'utf8').split(/\r?\n/),
    currentManifest: fs.readFileSync(options['current-manifest'], 'utf8'),
    retentionState: options.retention
      ? fs.readFileSync(options.retention, 'utf8')
      : undefined,
  });
  const summary =
    `[release-storage] ${plan.platform}/latest current=${plan.currentVersion} ` +
    `previous=${plan.previousVersion ?? 'none'} keep=${plan.keep.length} ` +
    `remove=${plan.remove.length} ignored=${plan.ignored.length} ` +
    `retention=${plan.retentionMode}\n`;
  const output = plan.remove.length ? `${plan.remove.join('\n')}\n` : '';
  if (options.output) {
    fs.writeFileSync(options.output, output, 'utf8');
    process.stdout.write(summary);
  } else {
    process.stderr.write(summary);
    process.stdout.write(output);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
