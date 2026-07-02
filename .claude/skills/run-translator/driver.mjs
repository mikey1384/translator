// REPL driver for the Stage5 translator Electron app (macOS, real display).
// Requires playwright-core resolvable from the directory you run it in:
//   npm install playwright-core   (in any scratch dir; run driver from there)
// See SKILL.md for the full workflow.
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_ROOT = path.resolve(import.meta.dirname, '../../..');
const APP_DIR = path.join(APP_ROOT, 'packages/main');
const ELECTRON_BIN = path.join(
  APP_ROOT,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
);
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.resolve('./shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const { _electron: electron } = await import(
  path.join(process.cwd(), 'node_modules/playwright-core/index.mjs')
);

let app = null;
let page = null;

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [APP_DIR],
      cwd: APP_DIR,
      timeout: 45_000,
    });
    for (let i = 0; i < 30; i++) {
      const w = app
        .windows()
        .find(
          w => !w.url().startsWith('devtools://') && w.url() !== 'about:blank'
        );
      if (w) {
        page = w;
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    page = page ?? (await app.firstWindow());
    await new Promise(r => setTimeout(r, 3000));
    console.log('launched.', app.windows().length, 'windows:');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  // DOM click, not coordinates — survives overlays/scroll.
  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, sel);
    console.log('click', sel, '→', r);
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(t => {
      const els = [
        ...document.querySelectorAll(
          'button, a, [role="button"], [role="tab"]'
        ),
      ];
      const el =
        els.find(e => e.textContent?.trim() === t) ??
        els.find(e => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK: ' + el.tagName + ' ' + (el.textContent || '').slice(0, 40);
    }, text);
    console.log('click-text', JSON.stringify(text), '→', r);
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 20 });
    console.log('typed');
  },
  async press(key) {
    if (page) await page.keyboard.press(key);
    console.log('pressed', key);
  },

  // Focus the AI video-search textarea (works from any screen once the
  // panel is open). The placeholder contains "길거리" in Korean UI.
  async 'focus-search'() {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(() => {
      const t = [...document.querySelectorAll('textarea')].find(
        e => e.placeholder && /길거리|street/i.test(e.placeholder)
      );
      if (!t) return 'NOT_FOUND';
      if (!t.offsetParent) return 'HIDDEN — open the panel first (open-panel)';
      t.scrollIntoView({ block: 'center' });
      t.focus();
      return 'FOCUSED';
    });
    console.log('focus-search →', r);
  },

  // Open the AI video suggestion panel from the home screen.
  async 'open-panel'() {
    await COMMANDS['click-text']('AI로 영상 찾기');
    await new Promise(r => setTimeout(r, 2000));
    await COMMANDS['focus-search']();
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try {
      await page.waitForSelector(sel, { timeout: 15_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(
      await page.evaluate(
        s =>
          (s ? document.querySelector(s) : document.body)?.innerText ??
          '(null)',
        sel || null
      )
    );
  },

  async buttons() {
    if (!page) return console.log('ERROR: launch first');
    const list = await page.evaluate(() =>
      [...document.querySelectorAll('button, [role="button"], [role="tab"]')]
        .map(e => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60))
        .filter(Boolean)
    );
    console.log(JSON.stringify(list, null, 1));
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() {
    if (app) await app.close().catch(() => {});
    app = null;
    page = null;
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '));
  },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({
  input: stdin,
  output: process.stdout,
  prompt: 'driver> ',
});

rl.on('line', async line => {
  const trimmed = line.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
  if (!cmd) return rl.prompt();
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log('unknown:', cmd, '— try: help');
    return rl.prompt();
  }
  try {
    await fn(rest);
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  if (cmd === 'quit') {
    rl.close();
    process.exit(0);
  }
  rl.prompt();
});
rl.on('close', async () => {
  await COMMANDS.quit();
  process.exit(0);
});

console.log('translator driver — "help" for commands, "launch" to start');
rl.prompt();
