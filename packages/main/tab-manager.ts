import {
  app,
  BrowserWindow,
  WebContentsView,
  WebContents,
  dialog,
  ipcMain,
  powerMonitor,
} from 'electron';
import log from 'electron-log';
import electronContextMenu from 'electron-context-menu';
import { registerAppTabProviders } from './utils/window.js';
import { shouldBlockFileNavigation } from './utils/file-navigation-guard.js';
import { newTabShortcutLabel } from './app-menu.js';
import { getUiLanguage, getUiT, isRtlLanguage } from './utils/ui-language.js';
import {
  buildCloseGuardPrompt,
  needsCloseGuard,
  type CloseGuardScope,
} from './close-guard.js';

export const TAB_BAR_HEIGHT = 40;

interface TabStatus {
  title: string;
  percent: number | null;
  running: boolean;
  badge: 'done' | 'error' | null;
  /** Subtitle edits no save has captured yet. */
  unsaved: boolean;
  /** What the running job is ('translation', 'export', …), for the prompt. */
  job: string | null;
}

interface Tab {
  id: number;
  view: WebContentsView;
  status: TabStatus;
  mediaPlaying: boolean;
  lastSurfaceRefreshAt: number;
  /** The page asked for full screen (the player): cover the tab strip. */
  htmlFullScreen?: boolean;
}

interface TabManagerOptions {
  window: BrowserWindow;
  rendererHtmlPath: string;
  preloadPath: string;
  isDev: boolean;
  /** Called for every new tab after its webContents is created (before load completes). */
  onTabCreated?: (wc: WebContents, info: { isFirst: boolean }) => void;
  /** Called after a tab is torn down (close button, Cmd+W, renderer crash). */
  onTabClosed?: (closedWebContentsId: number) => void;
  /** Called for a renderer termination before the failed tab is closed. */
  onCriticalFailure?: (reason: string) => void;
  /** True while the app is already quitting past the close guard (update install, confirmed quit). */
  bypassCloseGuard?: () => boolean;
}

let win: BrowserWindow | null = null;
let opts: TabManagerOptions | null = null;
let tabs: Tab[] = [];
let activeTabId: number | null = null;
let nextTabId = 1;
let firstTabCreated = false;
let windowsMediaSurfaceTimer: NodeJS.Timeout | null = null;

// Chromium's Windows compositor can occasionally stop presenting a long-lived
// WebContentsView even though its renderer and media keep running. Hiding and
// re-showing the view reattaches the surface (which is also why switching tabs
// clears the black frame). Keep this infrequent: it should be a recovery pulse,
// not a substitute for normal frame production.
const WINDOWS_MEDIA_SURFACE_REFRESH_MS = 5 * 60 * 1000;
const WINDOWS_MEDIA_SURFACE_POLL_MS = 30 * 1000;
const WINDOWS_SURFACE_REFRESH_COOLDOWN_MS = 1000;

function shellWebContents(): WebContents | null {
  return win && !win.isDestroyed() && !win.webContents.isDestroyed()
    ? win.webContents
    : null;
}

// Read by electron-context-menu each time a menu opens, so updating the
// object in place relabels every tab's right-click menu.
const contextMenuLabels: Record<string, string> = {};

export function setContextMenuLabels(labels: Record<string, string>): void {
  Object.assign(contextMenuLabels, labels);
}

interface ShellStrings {
  lang: string;
  dir: 'ltr' | 'rtl';
  newTab: string;
  newTabButton: string;
  closeTab: string;
  tabList: string;
}

let shellStrings: ShellStrings | null = null;

function pushStringsToShell(): void {
  const wc = shellWebContents();
  if (!wc || !shellStrings) return;
  wc.send('tabs:i18n', shellStrings);
}

/** Translate the tab strip (a separate page) into the current UI language. */
export async function refreshShellStrings(): Promise<void> {
  try {
    const lang = getUiLanguage();
    const t = await getUiT();
    shellStrings = {
      lang,
      dir: isRtlLanguage(lang) ? 'rtl' : 'ltr',
      newTab: t('tabs.newTab', undefined, 'New Tab'),
      newTabButton: t(
        'tabs.newTabWithShortcut',
        { shortcut: newTabShortcutLabel(process.platform) },
        'New tab ({{shortcut}})'
      ),
      closeTab: t('tabs.closeTab', undefined, 'Close tab'),
      tabList: t('tabs.tabList', undefined, 'Open tabs'),
    };
    pushStringsToShell();
  } catch (err) {
    log.warn('[tab-manager] Could not translate the tab strip:', err);
  }
}

function pushStateToShell(): void {
  const wc = shellWebContents();
  if (!wc) return;
  wc.send(
    'tabs:state',
    tabs.map(t => ({
      id: t.id,
      title: t.status.title,
      percent: t.status.percent,
      running: t.status.running,
      badge: t.status.badge,
      active: t.id === activeTabId,
    }))
  );
}

function layoutTabs(): void {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const bounds = {
    x: 0,
    y: TAB_BAR_HEIGHT,
    width,
    height: Math.max(0, height - TAB_BAR_HEIGHT),
  };
  for (const t of tabs) {
    t.view.setBounds(t.htmlFullScreen ? { x: 0, y: 0, width, height } : bounds);
  }
}

function refreshTabSurface(tab: Tab, reason: string): boolean {
  if (
    process.platform !== 'win32' ||
    !win ||
    win.isDestroyed() ||
    !win.isVisible() ||
    win.isMinimized() ||
    tab.id !== activeTabId ||
    tab.view.webContents.isDestroyed()
  ) {
    return false;
  }

  const now = Date.now();
  if (now - tab.lastSurfaceRefreshAt < WINDOWS_SURFACE_REFRESH_COOLDOWN_MS) {
    return false;
  }

  try {
    // Synchronous visibility toggles preserve the renderer and media element;
    // they only make Chromium recreate the view's presented surface.
    tab.view.setVisible(false);
    tab.view.setVisible(true);
    layoutTabs();
    tab.view.webContents.focus();
    tab.lastSurfaceRefreshAt = now;
    log.info(
      `[tab-manager] Refreshed Windows tab surface for tab ${tab.id} (${reason}).`
    );
    return true;
  } catch (err) {
    log.warn(
      `[tab-manager] Failed to refresh Windows tab surface for tab ${tab.id} (${reason}):`,
      err
    );
    return false;
  }
}

export function refreshActiveTabSurface(reason = 'requested'): boolean {
  const tab = tabs.find(t => t.id === activeTabId);
  return tab ? refreshTabSurface(tab, reason) : false;
}

function stopWindowsSurfaceRecovery(): void {
  if (windowsMediaSurfaceTimer) {
    clearInterval(windowsMediaSurfaceTimer);
    windowsMediaSurfaceTimer = null;
  }
  powerMonitor.removeListener('resume', handleSystemResume);
  powerMonitor.removeListener('unlock-screen', handleSystemUnlock);
}

function handleSystemResume(): void {
  refreshActiveTabSurface('system-resume');
}

function handleSystemUnlock(): void {
  refreshActiveTabSurface('screen-unlock');
}

function startWindowsSurfaceRecovery(): void {
  stopWindowsSurfaceRecovery();
  if (process.platform !== 'win32') return;

  windowsMediaSurfaceTimer = setInterval(() => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (
      !tab?.mediaPlaying ||
      Date.now() - tab.lastSurfaceRefreshAt < WINDOWS_MEDIA_SURFACE_REFRESH_MS
    ) {
      return;
    }
    refreshTabSurface(tab, 'long-running-media');
  }, WINDOWS_MEDIA_SURFACE_POLL_MS);
  windowsMediaSurfaceTimer.unref();

  powerMonitor.on('resume', handleSystemResume);
  powerMonitor.on('unlock-screen', handleSystemUnlock);
}

export function getTabForWebContents(wc: WebContents): { id: number } | null {
  const tab = tabs.find(t => t.view.webContents.id === wc.id);
  return tab ? { id: tab.id } : null;
}

export function getAllTabWebContents(): WebContents[] {
  return tabs.map(t => t.view.webContents).filter(wc => !wc.isDestroyed());
}

export function getActiveTabWebContents(): WebContents | null {
  const tab = tabs.find(t => t.id === activeTabId);
  const wc = tab?.view.webContents ?? null;
  return wc && !wc.isDestroyed() ? wc : null;
}

/**
 * Hidden idle tabs get OS timer throttling (big CPU saver); hidden tabs
 * with a running job stay unthrottled so progress keeps flowing to the
 * tab strip. The active tab is never throttled.
 */
function applyBackgroundPolicy(tab: Tab): void {
  const wc = tab.view.webContents;
  if (wc.isDestroyed()) return;
  const hidden = tab.id !== activeTabId;
  try {
    wc.setBackgroundThrottling(hidden && !tab.status.running);
  } catch {
    // webContents tearing down
  }
}

export function selectTab(id: number): void {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  const previousActive = tabs.find(t => t.id === activeTabId);
  activeTabId = id;
  tab.status.badge = null;
  for (const t of tabs) {
    t.view.setVisible(t.id === id);
    applyBackgroundPolicy(t);
  }
  tab.lastSurfaceRefreshAt = Date.now();
  // Let the renderers react (e.g. pause media in the hidden tab).
  if (previousActive && previousActive.id !== id) {
    const prevWc = previousActive.view.webContents;
    if (!prevWc.isDestroyed()) {
      prevWc.send('tab:visibility-changed', { visible: false });
    }
  }
  layoutTabs();
  if (!tab.view.webContents.isDestroyed()) {
    tab.view.webContents.focus();
    tab.view.webContents.send('tab:visibility-changed', { visible: true });
  }
  pushStateToShell();
}

export function selectRelativeTab(delta: number): void {
  if (tabs.length === 0) return;
  const idx = Math.max(
    0,
    tabs.findIndex(t => t.id === activeTabId)
  );
  const next = (idx + delta + tabs.length) % tabs.length;
  selectTab(tabs[next].id);
}

export function selectTabAtIndex(index: number): void {
  const tab = index === -1 ? tabs[tabs.length - 1] : tabs[index];
  if (tab) selectTab(tab.id);
}

export async function createTab({
  activate = true,
}: { activate?: boolean } = {}): Promise<void> {
  if (!win || win.isDestroyed() || !opts) return;

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !opts.isDev,
      allowRunningInsecureContent: false,
      sandbox: false,
      preload: opts.preloadPath,
      backgroundThrottling: false,
    },
  });

  const tab: Tab = {
    id: nextTabId++,
    view,
    // An empty title shows the shell's translated "New Tab".
    status: {
      title: '',
      percent: null,
      running: false,
      badge: null,
      unsaved: false,
      job: null,
    },
    mediaPlaying: false,
    lastSurfaceRefreshAt: Date.now(),
  };
  tabs.push(tab);

  const isFirst = !firstTabCreated;
  firstTabCreated = true;

  electronContextMenu({
    window: view.webContents,
    showInspectElement: opts.isDev,
    labels: contextMenuLabels,
  });

  // A file dropped outside the home drop zone must not replace the app with
  // a file:// page; the renderer handles drops itself. Reloading the app's
  // own document (Reload in the ⋯ menu) must still go through.
  view.webContents.on('will-navigate', (event, url) => {
    if (shouldBlockFileNavigation(url, view.webContents.getURL())) {
      event.preventDefault();
    }
  });
  view.webContents.on('render-process-gone', (_e, details) => {
    log.error(
      `[tab-manager] Tab ${tab.id} renderer gone (${details.reason}); closing tab.`
    );
    if (details.reason !== 'clean-exit') {
      opts?.onCriticalFailure?.(details.reason);
    }
    closeTab(tab.id);
  });

  view.webContents.on('media-started-playing', () => {
    tab.mediaPlaying = true;
    tab.lastSurfaceRefreshAt = Date.now();
  });
  view.webContents.on('media-paused', () => {
    tab.mediaPlaying = false;
  });
  // The player's full screen covers the whole window (the window itself goes
  // full screen too), not just the area under the tab strip.
  view.webContents.on('enter-html-full-screen', () => {
    tab.htmlFullScreen = true;
    layoutTabs();
  });
  view.webContents.on('leave-html-full-screen', () => {
    tab.htmlFullScreen = false;
    layoutTabs();
  });

  win.contentView.addChildView(view);
  layoutTabs();

  try {
    opts.onTabCreated?.(view.webContents, { isFirst });
  } catch (err) {
    log.error('[tab-manager] onTabCreated callback failed:', err);
  }

  if (activate) {
    selectTab(tab.id);
  } else {
    view.setVisible(false);
    pushStateToShell();
  }

  try {
    await view.webContents.loadFile(opts.rendererHtmlPath);
  } catch (err) {
    log.error(`[tab-manager] Failed to load renderer in tab ${tab.id}:`, err);
    if (isFirst) {
      // A broken first tab means a broken app — propagate so createWindow's
      // startup error dialog runs instead of leaving a blank shell.
      throw err;
    }
    // A later tab failing to load shouldn't take the app down; drop the tab.
    closeTab(tab.id);
  }
}

export function closeTab(id: number): void {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const [tab] = tabs.splice(idx, 1);
  const closedWebContentsId = tab.view.webContents.id;

  try {
    win?.contentView.removeChildView(tab.view);
  } catch {
    // window may already be tearing down
  }
  try {
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }
  } catch {
    // already destroyed
  }

  if (tabs.length === 0) {
    // Closing the last tab closes the window, like a browser.
    win?.close();
    return;
  }

  if (activeTabId === id) {
    const neighbor = tabs[Math.min(idx, tabs.length - 1)];
    selectTab(neighbor.id);
  } else {
    // Closing a background tab via its × leaves keyboard focus on the
    // shell; hand it back to the still-active app view.
    const activeWc = getActiveTabWebContents();
    if (activeWc) {
      activeWc.focus();
    }
    pushStateToShell();
  }

  try {
    opts?.onTabClosed?.(closedWebContentsId);
  } catch (err) {
    log.error('[tab-manager] onTabClosed callback failed:', err);
  }
}

export function closeActiveTab(): void {
  // Cmd/Ctrl+W while a tab in the strip has keyboard focus closes that tab,
  // which may not be the active one.
  const shell = shellWebContents();
  if (
    shellFocusedTabId != null &&
    shell?.isFocused() &&
    tabs.some(t => t.id === shellFocusedTabId)
  ) {
    void requestCloseTab(shellFocusedTabId);
    return;
  }
  if (activeTabId != null) void requestCloseTab(activeTabId);
}

// --- Keyboard access to the tab strip ---------------------------------------
// The strip is its own page, so Tab from the app never reaches it. F6 (menu)
// moves focus there and back; the strip reports which tab holds focus.

let shellFocusedTabId: number | null = null;

export function toggleTabStripFocus(): void {
  const shell = shellWebContents();
  if (!shell) return;
  if (shell.isFocused()) {
    getActiveTabWebContents()?.focus();
    return;
  }
  shell.focus();
  shell.send('tabs:focus-strip');
}

// --- Close guard -----------------------------------------------------------
// Closing a tab, the window or the app while a job runs or subtitle edits are
// unsaved asks first, in the user's language. "Save" asks the tab's renderer
// to save (like Cmd+S) and only closes once that worked.

const tabsWithOpenPrompt = new Set<number>();
let windowPromptOpen = false;
let closeGuardPassed = false;

function requestTabSave(tab: Tab): Promise<boolean> {
  const wc = tab.view.webContents;
  if (wc.isDestroyed()) return Promise.resolve(true);
  const requestId = `${tab.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return new Promise(resolve => {
    const cleanup = () => {
      clearTimeout(timer);
      ipcMain.removeListener('tab:save-before-close-result', listener);
      wc.removeListener('destroyed', onDestroyed);
    };
    const listener = (
      event: Electron.IpcMainEvent,
      id: unknown,
      ok: unknown
    ) => {
      if (event.sender.id !== wc.id || id !== requestId) return;
      cleanup();
      resolve(Boolean(ok));
    };
    const onDestroyed = () => {
      cleanup();
      resolve(false);
    };
    // Saving writes the linked .srt or the app library without a dialog, so a
    // minute without an answer means the renderer is stuck.
    const timer = setTimeout(() => {
      cleanup();
      log.warn(`[tab-manager] Tab ${tab.id} did not answer the save request.`);
      resolve(false);
    }, 60_000);
    ipcMain.on('tab:save-before-close-result', listener);
    wc.once('destroyed', onDestroyed);
    wc.send('tab:save-before-close', requestId);
  });
}

async function showMessage(
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  return win && !win.isDestroyed()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options);
}

async function confirmClose(
  scope: CloseGuardScope,
  targets: Tab[]
): Promise<boolean> {
  const pending = targets.filter(tab => needsCloseGuard(tab.status));
  if (pending.length === 0) return true;
  const t = await getUiT();
  const untitled = t('tabs.newTab', undefined, 'New Tab');
  const prompt = buildCloseGuardPrompt(
    scope,
    pending.map(tab => ({
      ...tab.status,
      title: tab.status.title || untitled,
    })),
    t,
    app.getName()
  );
  if (!prompt) return true;
  const { response } = await showMessage({
    type: 'warning',
    title: app.getName(),
    message: prompt.message,
    detail: prompt.detail,
    buttons: prompt.buttons,
    defaultId: prompt.defaultId,
    cancelId: prompt.cancelId,
    noLink: true,
  });
  const action = prompt.actions[response] ?? 'cancel';
  if (action === 'cancel') return false;
  if (action === 'close') return true;

  for (const tab of pending.filter(p => p.status.unsaved)) {
    if (await requestTabSave(tab)) continue;
    if (tabs.includes(tab)) selectTab(tab.id);
    await showMessage({
      type: 'error',
      title: app.getName(),
      message: t(
        'dialogs.closeGuard.saveFailed',
        { title: tab.status.title || untitled },
        "Couldn't save the subtitles in {{title}}, so nothing was closed. Save them from the editor, then try again."
      ),
      buttons: [t('dialogs.closeGuard.ok', undefined, 'OK')],
      noLink: true,
    });
    return false;
  }
  return true;
}

/** Closes a tab after asking, when it has a running job or unsaved edits. */
export async function requestCloseTab(id: number): Promise<void> {
  const tab = tabs.find(t => t.id === id);
  if (!tab || tabsWithOpenPrompt.has(id)) return;
  if (!needsCloseGuard(tab.status)) {
    closeTab(id);
    return;
  }
  tabsWithOpenPrompt.add(id);
  try {
    if (tab.id !== activeTabId) selectTab(tab.id);
    if (await confirmClose('tab', [tab])) closeTab(id);
  } catch (err) {
    log.error('[tab-manager] Close prompt failed; keeping the tab open:', err);
  } finally {
    tabsWithOpenPrompt.delete(id);
  }
}

/** True when some tab has a running job or unsaved subtitle edits. */
export function hasTabsNeedingCloseGuard(): boolean {
  return tabs.some(tab => needsCloseGuard(tab.status));
}

/**
 * Asks before the app quits or the window closes. Resolves true when it may
 * go ahead; after that, closing doesn't ask again.
 */
export async function confirmCloseAllTabs(
  scope: 'window' | 'quit'
): Promise<boolean> {
  if (closeGuardPassed) return true;
  if (windowPromptOpen) return false;
  windowPromptOpen = true;
  try {
    const ok = await confirmClose(scope, [...tabs]);
    if (ok) closeGuardPassed = true;
    return ok;
  } catch (err) {
    log.error('[tab-manager] Quit prompt failed; staying open:', err);
    return false;
  } finally {
    windowPromptOpen = false;
  }
}

/**
 * Move a tab to a new position in the strip. Array order is authoritative
 * for Ctrl+Tab cycling and Cmd+1-9, so those follow the new order for free.
 */
export function reorderTab(id: number, targetIndex: number): void {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1 || !Number.isFinite(targetIndex)) return;
  const clamped = Math.max(
    0,
    Math.min(Math.floor(targetIndex), tabs.length - 1)
  );
  if (clamped !== idx) {
    const [tab] = tabs.splice(idx, 1);
    tabs.splice(clamped, 0, tab);
  }
  pushStateToShell();
  // The drag interaction focused the shell; hand keyboard focus back to
  // the active app view (same as closing a background tab).
  const activeWc = getActiveTabWebContents();
  if (activeWc) {
    activeWc.focus();
  }
}

export function newTab(): void {
  void createTab({ activate: true });
}

function handleStatusReport(
  sender: WebContents,
  report: {
    title?: unknown;
    percent?: unknown;
    running?: unknown;
    error?: unknown;
    unsaved?: unknown;
    job?: unknown;
  }
): void {
  const tab = tabs.find(t => t.view.webContents.id === sender.id);
  if (!tab) return;

  const wasRunning = tab.status.running;
  const title =
    typeof report.title === 'string' && report.title.trim()
      ? report.title.trim().slice(0, 80)
      : '';
  const running = Boolean(report.running);
  const unsaved = Boolean(report.unsaved);
  const job =
    typeof report.job === 'string' && report.job.trim()
      ? report.job.trim().slice(0, 32)
      : null;
  const percent =
    running && typeof report.percent === 'number' && isFinite(report.percent)
      ? Math.max(0, Math.min(100, Math.round(report.percent)))
      : null;

  tab.status.title = title;
  tab.status.running = running;
  tab.status.unsaved = unsaved;
  tab.status.job = running ? job : null;
  tab.status.percent = percent;
  applyBackgroundPolicy(tab);

  // A job just finished in a background tab → badge until the tab is opened.
  if (wasRunning && !running && tab.id !== activeTabId) {
    tab.status.badge = report.error ? 'error' : 'done';
  }
  // A terminal error can be latched in the renderer slightly after the
  // completion report (IPC listener ordering); promote the badge when the
  // corrected status arrives.
  if (
    !running &&
    report.error &&
    tab.id !== activeTabId &&
    tab.status.badge === 'done'
  ) {
    tab.status.badge = 'error';
  }
  if (tab.id === activeTabId) {
    tab.status.badge = null;
  }

  pushStateToShell();
}

export function initTabManager(options: TabManagerOptions): void {
  win = options.window;
  opts = options;
  tabs = [];
  activeTabId = null;
  firstTabCreated = false;
  closeGuardPassed = false;
  startWindowsSurfaceRecovery();

  registerAppTabProviders({
    getAll: getAllTabWebContents,
    getActive: getActiveTabWebContents,
  });

  win.on('resize', layoutTabs);
  win.on('maximize', layoutTabs);
  win.on('unmaximize', layoutTabs);
  win.on('enter-full-screen', layoutTabs);
  win.on('leave-full-screen', layoutTabs);
  win.on('focus', () => refreshActiveTabSurface('window-focus'));
  win.on('restore', () => refreshActiveTabSurface('window-restore'));
  win.on('show', () => refreshActiveTabSurface('window-show'));
  win.on('close', event => {
    if (closeGuardPassed || options.bypassCloseGuard?.()) return;
    if (!hasTabsNeedingCloseGuard()) return;
    event.preventDefault();
    const closingWindow = win;
    void confirmCloseAllTabs('window').then(ok => {
      if (ok && closingWindow && !closingWindow.isDestroyed()) {
        closingWindow.close();
      }
    });
  });
  win.on('closed', () => {
    // Closing the window does NOT destroy child WebContentsView webContents —
    // without this, tab renderers (and their registered operations, whose
    // auto-cancel waits on 'destroyed') keep running invisibly.
    for (const t of tabs) {
      try {
        if (!t.view.webContents.isDestroyed()) {
          t.view.webContents.close();
        }
      } catch (err) {
        log.warn('[tab-manager] Failed to close tab webContents:', err);
      }
    }
    win = null;
    tabs = [];
    activeTabId = null;
    stopWindowsSurfaceRecovery();
  });
}

const shellOnly = (event: Electron.IpcMainEvent) =>
  shellWebContents() !== null && event.sender.id === shellWebContents()!.id;

ipcMain.on('tabs:create', event => {
  if (!shellOnly(event)) return;
  void createTab({ activate: true });
});

ipcMain.on('tabs:select', (event, id: number) => {
  if (!shellOnly(event)) return;
  selectTab(Number(id));
});

ipcMain.on('tabs:close', (event, id: number) => {
  if (!shellOnly(event)) return;
  void requestCloseTab(Number(id));
});

ipcMain.on('tabs:reorder', (event, id: number, index: number) => {
  if (!shellOnly(event)) return;
  reorderTab(Number(id), Number(index));
});

ipcMain.on('tabs:focused', (event, id: number | null) => {
  if (!shellOnly(event)) return;
  shellFocusedTabId = id == null ? null : Number(id);
});

ipcMain.on('tabs:focus-app', event => {
  if (!shellOnly(event)) return;
  shellFocusedTabId = null;
  getActiveTabWebContents()?.focus();
});

ipcMain.on('tabs:request-state', event => {
  if (!shellOnly(event)) return;
  if (shellStrings) pushStringsToShell();
  else void refreshShellStrings();
  pushStateToShell();
});

ipcMain.on('tab:status-report', (event, report) => {
  handleStatusReport(event.sender, report ?? {});
});
