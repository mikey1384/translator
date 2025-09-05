Windows Manual Deploy & Auto‑Update (Cloudflare)

Overview

- Build and EV‑sign the Windows installer locally.
- Host update artifacts on Cloudflare (Generic provider).
- For one bridging release, also upload assets to GitHub so existing users see the update.

Prerequisites

- DigiCert EV token inserted and logged in (SafeNet/eToken drivers installed).
- Cloudflare bucket/site with a public base URL, e.g. https://downloads.example.com/translator/win/
- Set an environment variable before building:
  - Windows PowerShell: `$env:WINDOWS_UPDATE_BASE_URL = "https://downloads.example.com/translator/win/"`

Build & Sign

1) From repo root, run:
   - `npm run package:win`
   - This uses `electron-builder.win.json` and `signtool` with subject "Stage5 Tools LLC".

Artifacts to Upload (from `dist/`)

- `latest.yml` (required)
- `Translator Setup <version>.exe` (required)
- `Translator Setup <version>.exe.blockmap` (if present; recommended)

Upload to Cloudflare

- Place all of the above in the same folder that corresponds to `WINDOWS_UPDATE_BASE_URL`.
- Keep exact filenames (spaces included) — `latest.yml` references the installer by name.
- Purge/Invalidate cache for `latest.yml` and the `.exe` after upload to avoid stale clients.

Ensure Existing Users See the Update (Bridge Release)

- Older Windows builds likely point to GitHub Releases (base config used `provider: github`).
- For the next release only, also upload the same three files to the corresponding GitHub Release:
  - Attach `latest.yml`
  - Attach the installer `.exe` (name must match what `latest.yml` lists)
  - Attach the `.blockmap` if present
- This ensures current installs detect the new version and update to the build that now targets Cloudflare.
- After most users have upgraded, you can stop attaching Windows assets to GitHub Releases.

Verify Update Flow

- In the app, use the Update menu/button to "Check for updates".
- Watch logs (electron-log) to confirm the request to `latest.yml` succeeds and the installer downloads.
- If testing behind Cloudflare, confirm no 304 cache hits on an old `latest.yml`.

Notes

- Channel is `latest` by default. If you introduce `beta`, publish to a separate path (e.g. `/win/beta/`) and change the app channel accordingly.
- The build script already uses `--publish never`; you only host files manually.
