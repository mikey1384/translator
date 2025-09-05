= Inform Legacy Windows Users ===
This uploads latest.yml and the Windows installer to the correct GitHub release tag.
Requires GitHub CLI (gh) and login (gh auth login).


=== Preflight ===
Repo: mikey1384/translator
Tag:  v1.3.0-win

=== Uploading assets to GitHub release ===
gh release upload v1.3.0-win --repo mikey1384/translator C:\Users\mikey\Development\translator\dist\latest.yml C:\Users\mikey\Development\translator\dist\Translator Setup 1.3.0.exe --clobber
Successfully uploaded 2 assets to v1.3.0-win
gh release upload v1.3.0-win --repo mikey1384/translator C:\Users\mikey\AppData\Local\Temp\Translator-Setup-1.3.0.exe --clobber
Successfully uploaded 1 asset to v1.3.0-win
Done. Legacy Windows installs will fetch:
  https://github.com/mikey1384/translator/releases/download/v1.3.0-win/latest.yml
Press Enter to exit:


Windows Manual Deploy & Auto‑Update (Cloudflare)

Overview

- Build and EV‑sign the Windows installer locally.
- Host update artifacts on Cloudflare (Generic provider).
- For one bridging release, also upload assets to GitHub so existing users see the update.

Prerequisites

- DigiCert EV token inserted and logged in (SafeNet/eToken drivers installed).
- Cloudflare bucket/site with a public base URL, e.g. https://downloads.example.com/translator/win/
- Base URL is preconfigured:
  - `electron-builder.win.json` uses `https://downloads.stage5.tools/win/latest/`.
  - Change it there if you ever move hosting.

Build & Sign

Option A — One‑Click (Recommended)

- Double‑click `Release-Windows-OneClick.bat` in the repo root.
- The script will:
  - Build & sign (`npm run package:win`)
  - Upload to Cloudflare R2 (`scripts/upload-to-r2-win.ps1`)
  - Purge Cloudflare cache for latest URLs (`scripts/purge-cloudflare-cache.ps1`)
- You’ll be prompted once for Cloudflare Zone ID and API Token (or set env vars `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`).

Option B — Manual

1) From repo root, run:
   - `npm run package:win`
   - This uses `electron-builder.win.json` (generic provider to downloads.stage5.tools) and `signtool` with subject "Stage5 Tools LLC".

Artifacts to Upload (from `dist/`)

- `latest.yml` (required)
- `Translator Setup <version>.exe` (required)
- `Translator Setup <version>.exe.blockmap` (if present; recommended)

Upload to Cloudflare

- Place all of the above in the same folder that corresponds to `WINDOWS_UPDATE_BASE_URL`.
- Keep exact filenames (spaces included) — `latest.yml` references the installer by name.
- Purge/Invalidate cache for `latest.yml` and the `.exe` after upload to avoid stale clients.

Cloudflare Cache Purge

- Script: `scripts/purge-cloudflare-cache.ps1`
- Requirements: Cloudflare Zone ID and API Token (with Zone.Cache Purge permission).
- Provide via env vars (`CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`) or enter interactively when prompted.
- Convenience: On first run, the script securely stores your Zone ID and API Token for your user profile (Windows DPAPI). Next runs won’t prompt.
- Usage examples (PowerShell):
  - Auto-detect version from package.json and purge `latest/`:
    - `./scripts/purge-cloudflare-cache.ps1`
  - Explicit version and also purge versioned paths:
    - `./scripts/purge-cloudflare-cache.ps1 -Version 1.3.0 -IncludeVersioned`
  - Custom base URL (if hosting path changes):
    - `./scripts/purge-cloudflare-cache.ps1 -BaseUrl "https://downloads.stage5.tools/translator/win"`

Ensure Existing Users See the Update (Bridge Release)

- Older Windows builds likely point to GitHub Releases (base config used `provider: github`).
- For the next release only, also upload the same three files to the corresponding GitHub Release. Easiest path:
  - Double-click `Inform-Windows-Legacy-Users.bat` (one‑click).
  - Or run `./scripts/inform-windows-legacy.ps1` in PowerShell.
  - This auto-detects the tag (`v<version>-win`, `v<version>`, or `v<version>-windows`), creates it if missing, and uploads:
    - `dist/latest.yml`
    - `dist/Translator Setup <version>.exe`
    - `dist/Translator Setup <version>.exe.blockmap` (if present)
- This ensures current installs detect the new version and update to the build that now targets Cloudflare.
- After most users have upgraded, you can stop attaching Windows assets to GitHub Releases.

Verify Update Flow

- In the app, use the Update menu/button to "Check for updates".
- Watch logs (electron-log) to confirm the request to `latest.yml` succeeds and the installer downloads.
- If testing behind Cloudflare, confirm no 304 cache hits on an old `latest.yml`.

Notes

- Channel is `latest` by default. If you introduce `beta`, publish to a separate path (e.g. `/win/beta/`) and change the app channel accordingly.
- The build script already uses `--publish never`; you only host files manually.
