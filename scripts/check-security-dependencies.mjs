import fs from 'node:fs';

const lock = JSON.parse(
  fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
);
const packages = lock.packages ?? {};

const followRedirectsPackages = Object.entries(packages).filter(
  ([packagePath]) => /(^|\/)node_modules\/follow-redirects$/.test(packagePath)
);
const unsafeFollowRedirectsPaths = followRedirectsPackages
  .filter(([, entry]) => {
    const [major, minor, patch] = entry.version.split('.').map(Number);
    // GHSA-8r9p-f939-6h3c and GHSA-q3jh-wrc6-jgq8: credential stripping.
    return (
      !/^1\.\d+\.\d+$/.test(entry.version) ||
      major !== 1 ||
      minor < 16 ||
      (minor === 16 && patch < 1)
    );
  })
  .map(([packagePath]) => packagePath);

if (unsafeFollowRedirectsPaths.length > 0) {
  throw new Error(
    `follow-redirects requires 1.16.1 or newer within v1: ${unsafeFollowRedirectsPaths.join(', ')}`
  );
}

const jsYamlPackages = Object.entries(packages).filter(([packagePath]) =>
  /(^|\/)node_modules\/js-yaml$/.test(packagePath)
);
const unsafeJsYamlPaths = jsYamlPackages
  .filter(([, entry]) => {
    const [major, minor, patch] = entry.version.split('.').map(Number);
    // CVE-2026-84375: empty merge sources must count toward the CPU budget.
    return (
      !/^4\.\d+\.\d+$/.test(entry.version) ||
      major !== 4 ||
      minor < 3 ||
      (minor === 3 && patch < 2)
    );
  })
  .map(([packagePath]) => packagePath);

if (unsafeJsYamlPaths.length > 0) {
  throw new Error(
    `CVE-2026-84375: js-yaml requires 4.3.2 or newer within v4: ${unsafeJsYamlPaths.join(', ')}`
  );
}

const fastUriPackages = Object.entries(packages).filter(([packagePath]) =>
  /(^|\/)node_modules\/fast-uri$/.test(packagePath)
);
const unsafeFastUriPaths = fastUriPackages
  .filter(([, entry]) => {
    const [major, minor, patch] = entry.version.split('.').map(Number);
    // Keep the reviewed v3 release line and its latest security floor.
    return (
      !/^3\.\d+\.\d+$/.test(entry.version) ||
      major !== 3 ||
      minor < 1 ||
      (minor === 1 && patch < 9)
    );
  })
  .map(([packagePath]) => packagePath);

if (unsafeFastUriPaths.length > 0) {
  throw new Error(
    `fast-uri security fixes require 3.1.9 or newer within v3: ${unsafeFastUriPaths.join(', ')}`
  );
}

for (const [name, floor] of [
  ['zod', [4, 6, 6]],
  ['puppeteer-core', [25, 13, 0]],
]) {
  const matches = Object.entries(packages).filter(
    ([packagePath]) =>
      packagePath.endsWith(`/node_modules/${name}`) ||
      packagePath === `node_modules/${name}`
  );
  for (const [packagePath, entry] of matches) {
    const version = entry.version.split('.').map(Number);
    const difference = floor.map((n, i) => version[i] - n).find(n => n !== 0);
    if (!/^\d+\.\d+\.\d+$/.test(entry.version) || difference < 0) {
      throw new Error(
        `${name} requires ${floor.join('.')} or newer: ${packagePath}`
      );
    }
  }
}

const vulnerableExtractZipPaths = Object.keys(packages).filter(packagePath =>
  /(^|\/)node_modules\/extract-zip$/.test(packagePath)
);

if (vulnerableExtractZipPaths.length > 0) {
  throw new Error(
    `CVE-2026-56876: abandoned extract-zip package remains in the lockfile at: ${vulnerableExtractZipPaths.join(', ')}`
  );
}

const browserPackage = packages['node_modules/@puppeteer/browsers'];
if (!browserPackage || Number.parseInt(browserPackage.version, 10) < 3) {
  throw new Error(
    'Expected @puppeteer/browsers 3.x or newer, which no longer depends on extract-zip'
  );
}

const electronPackage = packages['node_modules/electron'];
if (!electronPackage?.dependencies?.['@electron-internal/extract-zip']) {
  throw new Error(
    'Expected Electron to use the maintained @electron-internal/extract-zip implementation'
  );
}

const ELECTRON_SECURITY_FLOOR = [41, 10, 6];
const electronVersion = (electronPackage.version ?? '')
  .split(/[.-]/)
  .slice(0, 3)
  .map(Number);
const electronComparison = ELECTRON_SECURITY_FLOOR.map(
  (floor, index) => (electronVersion[index] ?? Number.NaN) - floor
).find(difference => difference !== 0);
const electronBelowFloor = !(
  electronComparison === undefined || electronComparison > 0
);
if (electronBelowFloor) {
  throw new Error(
    // GHSA-j84w-jfhq-vhvj, GHSA-gr2m-v5gq-v685, GHSA-9qh4-3jw8-366w.
    `Electron ${electronPackage.version} is below the ${ELECTRON_SECURITY_FLOOR.join('.')} security floor`
  );
}

// adm-zip is only an install-time dependency of onnxruntime-node (Linux CUDA
// downloads). Keep it patched and out of the packaged app, where its
// symlink-following extraction (GHSA-vwc7-r8mq-g2x9, no fixed release) cannot run.
const unsafeAdmZipPaths = Object.entries(packages)
  .filter(([packagePath]) => /(^|\/)node_modules\/adm-zip$/.test(packagePath))
  .filter(([, entry]) => {
    const [major, minor, patch] = entry.version.split('.').map(Number);
    return major === 0 && (minor < 6 || (minor === 6 && patch < 1));
  })
  .map(([packagePath]) => packagePath);
if (unsafeAdmZipPaths.length > 0) {
  throw new Error(
    `adm-zip security fixes require 0.6.1 or newer: ${unsafeAdmZipPaths.join(', ')}`
  );
}
const builderConfig = JSON.parse(
  fs.readFileSync(
    new URL('../electron-builder.base.json', import.meta.url),
    'utf8'
  )
);
if (!builderConfig.files?.includes('!node_modules/adm-zip/**')) {
  throw new Error(
    'electron-builder.base.json must exclude node_modules/adm-zip from the packaged app'
  );
}

const sprintfPaths = Object.keys(packages).filter(packagePath =>
  /(^|\/)node_modules\/sprintf-js$/.test(packagePath)
);
if (sprintfPaths.length > 0) {
  throw new Error(
    `GHSA-hp3w-g68c-fv3c: sprintf-js (no fixed release) remains in the lockfile at: ${sprintfPaths.join(', ')}`
  );
}

console.log(
  `Security dependency check passed: Electron ${electronPackage.version}, ` +
    `@puppeteer/browsers ${browserPackage.version}, no extract-zip or sprintf-js package; ` +
    `${followRedirectsPackages.length} follow-redirects entries meet the v1 security floor; ` +
    `${fastUriPackages.length} fast-uri entries meet the v3 security floor; ` +
    `${jsYamlPackages.length} js-yaml entries meet the v4 security floor`
);
