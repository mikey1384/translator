# Windows releases from Omarchy

Windows CI builds and validates the native Windows payload. The release host
downloads it, signs it using the locally attached token, and packages the final
NSIS installer on Linux. The PIN and private key never go to GitHub Actions.
An unsigned CI artifact is **not** a public release and must never be uploaded
to GitHub Releases or the updater bucket.

## One-time requirements

- GitHub CLI authenticated for this repository.
- Node.js 22.16.0 (the workflow's version), with lockfile dependencies installed
  in the **automation checkout** using `npm ci --ignore-scripts`.
- Wine for electron-builder's NSIS uninstaller generation.
- PowerShell 7 and rclone for the existing publication scripts. Configure the
  existing `r2-upload` remote, or set `RCLONE_CONFIG` to a protected config file.
- The locally installed, protected `translator-sign` helper at
  `~/.local/bin/translator-sign`, or an absolute `TRANSLATOR_SIGN_COMMAND` path.
  Its `sign INPUT OUTPUT` command must prompt directly on the terminal, protect
  the PIN from core dumps, timestamp signatures, and verify the pinned Stage5
  certificate and trust chain before succeeding. `verify FILE` must fail on an
  invalid signature, unexpected signer, or failed trust verification.

Do not put a PIN in command arguments, environment variables, shell history,
logs, or a password file. Do not run signing through an agent's terminal input
tool. If a PIN attempt fails, stop; this workflow does not retry it.

## Build a tagged Windows candidate

Keep two separate checkouts:

- **Automation checkout:** contains these scripts and the updated workflow.
- **Release checkout:** clean, detached checkout of the existing annotated tag.
  No app changes, version bump, or retagging are needed to complete a Windows
  release for a version already published for macOS.

After the automation changes have been reviewed and explicitly approved for
commit/push, the existing workflow can run from the automation branch. A manual
dispatch runs only the Windows preflight; it cannot publish a new Mac release.

```bash
gh workflow run release-mac.yml --repo mikey1384/translator \
  --ref feat/omarchy-windows-release -f release_tag=v1.20.1
gh run list --repo mikey1384/translator --workflow release-mac.yml
```

Wait for the selected run to succeed. It retains a uniquely named unsigned
handoff for seven days, containing the prepackaged Windows app, installer icon,
and a manifest with release tag/commit, tag object, lockfile hash, CI identity,
and every payload file's size and SHA256. Both checkouts in the Windows job use
read-only permissions and do not persist GitHub credentials.

Create a fresh release worktree, outside the automation checkout. Substitute
the actual successful `RUN_ID` and absolute `RELEASE_ROOT` below:

```bash
git worktree add --detach /absolute/path/translator-windows-v1.20.1 v1.20.1
node scripts/windows-token-release.mjs download v1.20.1 RUN_ID RELEASE_ROOT
```

`download` validates the GitHub run, release identity, lockfile, file inventory,
and hashes. It refuses to overwrite an existing handoff. A failed/incomplete
download must not be used as a release candidate.

## Sign and package locally

In your own visible terminal, from the automation checkout:

```bash
node scripts/windows-token-release.mjs build v1.20.1 RUN_ID RELEASE_ROOT
```

The command signs disposable copies of all payload EXEs, restores the updater's
Stage5 publisher requirement, and uses electron-builder `--prepackaged` mode.
Windows native modules are not rebuilt on Linux. The only allowed payload
changes are EXE signatures and the external `app-update.yml` publisher setting.

NSIS recopies its elevation helper during packaging; the signing hook checks
that it matches the CI copy and signs it before app compression. The NSIS
uninstaller is signed **before** it is embedded in the installer; the
installer is signed last. Expect separate PIN prompts for the executables and
installer components. A signature failure stops the operation without retrying
or exposing an unverified replacement file.

Updater metadata is generated from the final signed installer, then receives
the exact annotation body from the release tag. Signed-file hashes and a copy
of the signed uninstaller are retained in `RELEASE_ROOT/dist/token-audit/`.
Signing and packaging alone never upload or publish anything.

```bash
node scripts/windows-token-release.mjs verify-signed v1.20.1 RUN_ID RELEASE_ROOT
```

This repeats the provenance, file-integrity, signature, publisher, release-note,
and final updater hash/size checks before publishing. It is not a Windows UI
smoke test; the CI preflight validates packaging without launching the app.

## Publish the verified candidate

This is the externally visible step:

```bash
pwsh -NoProfile -File scripts/publish-windows-token.ps1 \
  -ReleaseRoot RELEASE_ROOT -RunId RUN_ID
```

The existing R2 retention policy and immutable GitHub bridge remain in charge.
Before any upload, the bridge checks that this is still the latest canonical
GitHub release and that any existing Windows assets match the candidate.
The publication scripts verify uploaded bytes, promote the updater channel, and append matching
Windows assets to the already-published canonical GitHub release. They do not
create a new SemVer release or overwrite a conflicting immutable asset.

The cache-purge step needs Cloudflare zone/cache-purge credentials. On Linux,
the token prompt is hidden and the token is not saved using `Export-Clixml`
(which does not encrypt it there). Windows DPAPI-protected credentials cannot
be reused directly on Linux. Arrange credentials before publishing; use
`-SkipPurge` only deliberately and verify the public cached URLs before
announcing the release.

Confirm these public objects serve the final candidate:

- `https://downloads.stage5.tools/win/latest/latest.yml`
- `https://downloads.stage5.tools/win/latest/Translator-x64.exe`
- the Windows assets on the canonical GitHub release

If publication fails, preserve the signed candidate and retry the publication
step; do not rebuild/re-sign a version whose immutable assets already exist.
See [release-storage.md](release-storage.md) for retention and rollback rules.

## Test the tooling without using the token

```bash
npm run test:release
TRANSLATOR_TEST_NSIS=1 WINEPREFIX=/absolute/path/to/dedicated-wine-prefix \
  node scripts/tests/windows-token-packaging.test.mjs
```

The optional Linux integration test uses real NSIS packaging with a synthetic
app and a recording signing hook. It checks the elevation-helper, uninstaller,
and installer signing order without accessing the token or installing Translator.
