import fs from 'node:fs';

const lock = JSON.parse(
  fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
);
const packages = lock.packages ?? {};

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
    `@puppeteer/browsers ${browserPackage.version}, no extract-zip package`
);
