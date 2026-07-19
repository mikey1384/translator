import { BrowserWindow, WebContentsView, WebContents, ipcMain } from 'electron';
import log from 'electron-log';
import electronContextMenu from 'electron-context-menu';
import { registerAppTabProviders } from './utils/window.js';

export const TAB_BAR_HEIGHT = 40;

interface TabStatus {
  title: string;
  percent: number | null;
  running: boolean;
  badge: 'done' | 'error' | null;
}

interface Tab {
  id: number;
  view: WebContentsView;
  status: TabStatus;
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
}

let win: BrowserWindow | null = null;
let opts: TabManagerOptions | null = null;
let tabs: Tab[] = [];
let activeTabId: number | null = null;
let nextTabId = 1;
let firstTabCreated = false;

function shellWebContents(): WebContents | null {
  return win && !win.isDestroyed() && !win.webContents.isDestroyed()
    ? win.webContents
    : null;
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
    t.view.setBounds(bounds);
  }
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
    status: { title: 'New Tab', percent: null, running: false, badge: null },
  };
  tabs.push(tab);

  const isFirst = !firstTabCreated;
  firstTabCreated = true;

  electronContextMenu({
    window: view.webContents,
    showInspectElement: opts.isDev,
  });

  view.webContents.on('render-process-gone', (_e, details) => {
    log.error(
      `[tab-manager] Tab ${tab.id} renderer gone (${details.reason}); closing tab.`
    );
    closeTab(tab.id);
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
  if (activeTabId != null) closeTab(activeTabId);
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
  }
): void {
  const tab = tabs.find(t => t.view.webContents.id === sender.id);
  if (!tab) return;

  const wasRunning = tab.status.running;
  const title =
    typeof report.title === 'string' && report.title.trim()
      ? report.title.trim().slice(0, 80)
      : 'New Tab';
  const running = Boolean(report.running);
  const percent =
    running && typeof report.percent === 'number' && isFinite(report.percent)
      ? Math.max(0, Math.min(100, Math.round(report.percent)))
      : null;

  tab.status.title = title;
  tab.status.running = running;
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

  registerAppTabProviders({
    getAll: getAllTabWebContents,
    getActive: getActiveTabWebContents,
  });

  win.on('resize', layoutTabs);
  win.on('maximize', layoutTabs);
  win.on('unmaximize', layoutTabs);
  win.on('enter-full-screen', layoutTabs);
  win.on('leave-full-screen', layoutTabs);
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
  closeTab(Number(id));
});

ipcMain.on('tabs:reorder', (event, id: number, index: number) => {
  if (!shellOnly(event)) return;
  reorderTab(Number(id), Number(index));
});

ipcMain.on('tabs:request-state', event => {
  if (!shellOnly(event)) return;
  pushStateToShell();
});

ipcMain.on('tab:status-report', (event, report) => {
  handleStatusReport(event.sender, report ?? {});
});
