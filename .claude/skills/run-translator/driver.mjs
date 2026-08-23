// REPL driver for the Stage5 translator Electron app (macOS, real display).
// Uses the repository's Playwright development-app controller.
// See SKILL.md for the full workflow.
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DevAppController } from '../../../packages/agent-server/src/dev-app-controller.mjs';
import { createNativeOwnerMonitor } from '../../../packages/agent-server/src/native-owner-monitor.mjs';
import {
  installTransportBoundLifecycle,
  shouldForceDevelopmentShutdown,
} from '../../../packages/agent-server/src/transport-bound-lifecycle.mjs';

const SHOT_DIR = process.env.SCREENSHOT_DIR || path.resolve('./shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

let lifecycle = null;
const ownerMonitor = createNativeOwnerMonitor({
  onOwnershipLost: reason => lifecycle?.requestShutdown(reason, 1),
});
const appController = new DevAppController({ ownerMonitor });
let app = null;
let page = null;
let launchPromise = null;
let driverClosePromise = null;
let driverClosing = false;
let requestDriverShutdown = null;

function closeAppOnce() {
  if (driverClosePromise) return driverClosePromise;

  driverClosing = true;
  driverClosePromise = appController.close().finally(() => {
    app = null;
    page = null;
  });
  return driverClosePromise;
}

function forceCloseAppOnce() {
  void closeAppOnce().catch(() => {});
  return appController.forceClose();
}

const COMMANDS = {
  async launch() {
    if (driverClosing) return console.log('driver is shutting down');
    if (app) return console.log('already launched');
    if (launchPromise) return launchPromise;

    const activeLaunch = (async () => {
      await appController.launch();
      if (driverClosing) return;
      app = appController.app;
      page = appController.page;
      if (!app || !page) {
        throw new Error('Development Electron closed before driver setup.');
      }
      const activeApp = app;
      activeApp?.once?.('close', () => {
        if (app === activeApp) {
          app = null;
          page = null;
        }
      });
      console.log('launched.', app.windows().length, 'windows:');
      for (const w of app.windows()) console.log(' ', w.url());
    })();
    launchPromise = activeLaunch;
    try {
      await activeLaunch;
    } finally {
      if (launchPromise === activeLaunch) launchPromise = null;
    }
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

  // Real Playwright input click for controls that open a native file dialog.
  // A DOM .click() is sufficient for ordinary React controls, but native
  // dialogs need the app window focused and a trusted pointer event.
  async 'pw-click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const target = page
      .locator(
        'button:visible, a:visible, [role="button"]:visible, [role="tab"]:visible'
      )
      .filter({ hasText: text })
      .first();
    await target.click({ timeout: 15_000 });
    console.log('pw-click-text', JSON.stringify(text), '→ OK');
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
        .map(e =>
          (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
        )
        .filter(Boolean)
    );
    console.log(JSON.stringify(list, null, 1));
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() {
    if (requestDriverShutdown) {
      await requestDriverShutdown('command:quit');
      return;
    }
    await closeAppOnce();
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
  if (cmd === 'quit') return;
  rl.prompt();
});
lifecycle = installTransportBoundLifecycle({
  close: async () => {
    await closeAppOnce();
    await ownerMonitor.close();
  },
  forceClose: async () => {
    await forceCloseAppOnce();
    void ownerMonitor.close().catch(() => {});
  },
  forceOnFirstShutdown: shouldForceDevelopmentShutdown,
  closeTransport: () => rl.close(),
  input: stdin,
  readline: rl,
});
requestDriverShutdown = lifecycle.requestShutdown;

try {
  await ownerMonitor.start();
  console.log('translator driver — "help" for commands, "launch" to start');
  rl.prompt();
} catch (error) {
  try {
    process.stderr.write(
      `translator driver ownership setup failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
  } catch {
    // The lifecycle owns failed output handling.
  }
  await lifecycle.requestShutdown('owner-monitor:exit', 1);
}
