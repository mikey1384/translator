Windows Manual Deploy & Auto‑Update (Cloudflare)

Overview

- Build and EV‑sign the Windows installer locally.
- Host update artifacts on Cloudflare (Generic provider).
- For a one‑time bridge, upload assets to GitHub so existing users see the update.

Prerequisites

- DigiCert EV token inserted and logged in (SafeNet/eToken drivers installed).
- Cloudflare bucket/site with a public base URL; base is preconfigured:
  - `electron-builder.win.json` uses `https://downloads.stage5.tools/win/latest/`.
  - Change it there if you ever move hosting.

Build & Sign

- Option A — One‑Click (Recommended)
  - Double‑click `Release-Windows-OneClick.bat` in the repo root.
  - The script:
    - Builds & signs (`npm run package:win`)
    - Uploads to Cloudflare R2 (`scripts/upload-to-r2-win.ps1`)
    - Purges Cloudflare cache (`scripts/purge-cloudflare-cache.ps1`)
  - You’ll be prompted once for Cloudflare Zone ID and API Token (or set env vars `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`).

- Option B — Manual
  - From repo root: `npm run package:win`
  - This uses `electron-builder.win.json` (generic provider to downloads.stage5.tools) and `signtool` with subject "Stage5 Tools LLC".

Artifacts to Upload (from `dist/`)

- `latest.yml` (required)
- `Translator Setup <version>.exe` (required)
- `Translator Setup <version>.exe.blockmap` (if present; recommended)

Upload to Cloudflare

- Upload all three to `/win/latest/` on downloads.stage5.tools.
- `latest.yml` references a hyphenated filename (e.g., `Translator-Setup-<version>.exe`).
- The upload script uploads this canonical name once, then server‑side copies to:
  - Versioned path: `/win/<version>/Translator-Setup-<version>.exe`
  - Stable alias: `/win/latest/Translator-x64.exe` (plus checksum)
- Purge cache for `latest.yml` and the `.exe` under `/win/latest/` after upload.

Cloudflare Cache Purge

- Script: `scripts/purge-cloudflare-cache.ps1`
- Requirements: Cloudflare Zone ID and API Token (Zone.Cache Purge → Purge).
- Provide via env vars (`CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`) or enter interactively when prompted.
- Convenience: On first run, the script securely stores your Zone ID and API Token for your user profile (Windows DPAPI). Next runs won’t prompt.
- Usage (PowerShell):
  - Auto-detect version and purge `latest/`: `./scripts/purge-cloudflare-cache.ps1`
  - Explicit version and also purge versioned: `./scripts/purge-cloudflare-cache.ps1 -Version 1.3.0 -IncludeVersioned`
Ensure Existing Users See the Update (Bridge Release)

- Older Windows builds point to GitHub Releases (base config used `provider: github`).
- For the next release only, also upload to the GitHub Release (one‑click):
  - Double-click `Inform-Windows-Legacy-Users.bat`, or run `./scripts/inform-windows-legacy.ps1`.
  - The script creates/uses the `v<version>-win` tag and uploads:
    - `dist/latest.yml`
    - `dist/Translator Setup <version>.exe` and alias `Translator-Setup-<version>.exe`
    - `dist/Translator Setup <version>.exe.blockmap` (if present)
- After most users upgrade, you can stop attaching Windows assets to GitHub Releases.

Verify Update Flow

- In the app, use the Update menu/button to "Check for updates".
- Watch logs (electron-log) to confirm `latest.yml` fetch and installer download.
- If testing behind Cloudflare, confirm you’re not hitting cached `latest.yml`.

Notes

- Channel is `latest` by default. If you introduce `beta`, publish to a separate path (e.g., `/win/beta/`) and change the app channel accordingly.
- Windows builds now force the updater feed to Cloudflare at runtime; legacy GitHub step is one‑time per release.
