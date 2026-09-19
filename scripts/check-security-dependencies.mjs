import fs from 'node:fs';

const lock = JSON.parse(
  fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
);
const packages = lock.packages ?? {};

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
      (minor === 1 && patch < 7)
    );
  })
  .map(([packagePath]) => packagePath);

if (unsafeFastUriPaths.length > 0) {
  throw new Error(
    `fast-uri security fixes require 3.1.7 or newer within v3: ${unsafeFastUriPaths.join(', ')}`
  );
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

console.log(
  `Security dependency check passed: Electron ${electronPackage.version}, ` +
    `@puppeteer/browsers ${browserPackage.version}, no extract-zip package; ` +
    `${fastUriPackages.length} fast-uri entries meet the v3 security floor; ` +
    `${jsYamlPackages.length} js-yaml entries meet the v4 security floor`
);
