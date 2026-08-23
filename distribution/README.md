# Package-manager distribution

This directory holds publisher-owned candidates for Homebrew Cask and WinGet.
They use immutable versioned release URLs and checksums from the public release
surfaces, never the mutable `latest` aliases used by the website and updater.

Refresh and verify the files after each release:

```bash
npm run distribution:update
npm run distribution:check
brew style --cask stage5-translator
```

Before submitting the WinGet manifests, install and uninstall the exact
versioned executable on a clean Windows x64 environment with `/S`, confirm the
installed publisher and version, verify that a second install upgrades cleanly,
and run `winget validate` or `wingetcreate validate`. The generator deliberately
reports this smoke test as outstanding; metadata validation is not evidence that
the installer behaves correctly.

Release packaging must also build the platform-native
`translator-owner-supervisor` and include it beside the packaged MCP helper.
For macOS, `scripts/verify-architectures.sh` verifies that the supervisor slice
matches each app architecture. Windows release CI must compile the `.exe` with
the Visual Studio C++ build tools before installer validation; a package
without the supervisor is incomplete and must not be published.

Catalog submission is a separate external action. Do not submit stale manifests
or silently switch the URLs to mutable aliases.

## Current catalog gates

- **Homebrew Cask:** the generated cask passes `brew style` and artifact
  verification, but `brew audit --cask --new stage5-translator` currently stops
  on Homebrew's repository-notability rule (the GitHub repository has not yet
  reached 30 forks, 30 watchers, or 75 stars). Re-run the audit only after that
  external threshold changes. Until then, the same cask can be distributed from
  a publisher-owned tap without representing it as an official Homebrew Cask.
- **WinGet:** generation and validation are intentionally gated on the immutable
  Windows artifact for the exact package version. At this checkout's `1.16.18`
  version, that artifact has not been published, so `npm run distribution:check`
  correctly fails instead of treating an older Windows release as current.
  After publication, external submission remains gated on the clean Windows x64
  `/S` install, reinstall, upgrade, and uninstall smoke test described above.
