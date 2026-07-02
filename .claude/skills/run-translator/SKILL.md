---
name: run-translator
description: Build, launch, and drive the Stage5 translator Electron app on macOS for end-to-end verification — including the AI video search panel. Use when asked to run the desktop app, screenshot it, or verify a feature works in the real app.
---

The translator is an Electron app (workspace packages under `packages/`).
Drive it via the Playwright REPL at `.claude/skills/run-translator/driver.mjs`.
macOS with a real display — no xvfb needed.

All paths relative to `translator/`.

## Prerequisites (one-time per scratch dir)

`playwright-core` is NOT a project dependency. Install it in a scratch
directory and run the driver from there (the driver resolves it from cwd):

```bash
cd <scratch-dir>
npm install playwright-core --silent
```

## Build

```bash
npm run build   # builds main + preload + renderer into packages/*/dist
```

The app loads `packages/renderer/dist/index.html` and
`packages/main/dist/main/main.cjs` — a stale build means your change is
not in the running app.

## Run (agent path)

No tmux on this machine — use a FIFO to keep the REPL's stdin open:

```bash
cd <scratch-dir>   # where playwright-core is installed
rm -f cmd driver.log && mkfifo cmd
(node /path/to/translator/.claude/skills/run-translator/driver.mjs < cmd > driver.log 2>&1 &)
(sleep 3600 > cmd &)          # keepalive — WITHOUT this, the first echo closes stdin and the driver (and app) quit
echo launch > cmd && sleep 18 && tail -5 driver.log
```

Send commands with `printf '...\n' > cmd`, read output with `tail driver.log`.
Screenshots land in `./shots/` (override: `SCREENSHOT_DIR`).

### Commands

| command | what it does |
|---|---|
| `launch` | launch the app (~15s), find the UI window |
| `open-panel` | open the AI video suggestion panel + focus its input |
| `focus-search` | focus the video-search textarea (panel must be open) |
| `ss [name]` | screenshot → `./shots/<name>.png` |
| `click <css>` / `click-text <text>` | DOM click (not coordinates) |
| `type <text>` / `press <key>` | keyboard input (Enter submits the search) |
| `eval <js>` | evaluate in the page, print JSON |
| `text [css]` | print innerText |
| `buttons` | list clickable elements (Korean UI labels) |
| `quit` | close app, exit |

### Driving the AI video search end to end

```
open-panel
type 김치찌개 잘 가르쳐주는 요리 영상 찾아줘
press Enter
# wait ~20-30s, then:
eval (()=>{const s=document.body.innerText; const i=s.indexOf("영상을 선택한 뒤"); return s.slice(i, i+400)})()
```

## Gotchas (all hit for real)

- **UI is Korean.** Key labels: `AI로 영상 찾기` (open AI panel), `웹에서`
  (from web), `영상 찾기` (find videos), `설정` (settings). The search
  textarea is found by placeholder containing `길거리`.
- **The home screen is an overlay.** Panel components exist in the DOM
  (hidden, zero-rect) before the panel is opened — check `offsetParent`
  before typing, or typed text goes nowhere.
- **userData is `~/Library/Application Support/@app/main/`** (not
  "translator" — that dir belongs to an old checkout). Device id:
  `device-config.json`. Cached balance: `credit-balance.json`.
  Main-process log: `~/Library/Logs/@app/main/main.log`.
- **Credits:** the dev device needs a real backend balance. Grant via
  stage5-api admin route (admin secret = `ADMIN_DEVICE_ID` in `.env`):
  ```bash
  curl -X POST https://api.stage5.tools/admin/add-credits \
    -H "Content-Type: application/json" -H "X-Admin-Secret: $ADMIN" \
    -d '{"deviceId":"<from device-config.json>","pack":"STARTER"}'
  ```
  A single review-phase (GPT-5.5) model call **reserves ~34k credits**
  (16k max completion tokens × $30/1M × margin 2 ÷ USD_PER_CREDIT), so
  MICRO (15k) is not enough — use STARTER (150k). A 402 at the relay's
  reserve step surfaces in-app as "AI 크레딧이 소진되었습니다" with no
  relay log line after "Server model authority selected".
- **Relay-side visibility:** `cd ../openai-relay && flyctl logs --no-tail`
  shows authorize/reserve/model/token counts per translate-direct call.
- **Progress events race the IPC reply.** `finishOperation` clears
  `activeOperationId` when the invoke resolves; progress events arriving
  after that are dropped by the store guard. Any "final state" the
  renderer must reflect belongs in the resolved response, not only in a
  trailing progress event.
- **IME-safe Enter:** the search box guards against composition events;
  `press Enter` from Playwright submits fine.

## Run (human path)

```bash
npm run dev   # hot-reload dev mode, opens the window
```
