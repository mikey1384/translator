import { BrowserWindow, WebContents } from 'electron';

/**
 * Get the main application window.
 * Returns the first window in the list, or null if no windows exist.
 */
export function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

/**
 * Get the focused window, falling back to the main window.
 * Returns null if no windows exist.
 */
export function getFocusedOrMainWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? getMainWindow();
}

// ---------------------------------------------------------------------------
// App-tab routing. The main window hosts a tab strip (shell) plus one
// WebContentsView per tab, each running the full renderer app. App-facing
// events must go to tab webContents, not the shell. The tab manager registers
// providers here; before it does (or if it never does), we fall back to the
// main window's own webContents so single-webContents flows keep working.
// ---------------------------------------------------------------------------

let allTabsProvider: (() => WebContents[]) | null = null;
let activeTabProvider: (() => WebContents | null) | null = null;

export function registerAppTabProviders(providers: {
  getAll: () => WebContents[];
  getActive: () => WebContents | null;
}): void {
  allTabsProvider = providers.getAll;
  activeTabProvider = providers.getActive;
}

/** Every app-tab webContents (excludes the tab-strip shell). */
export function getAllAppWebContents(): WebContents[] {
  if (allTabsProvider) {
    return allTabsProvider().filter(wc => !wc.isDestroyed());
  }
  const win = getMainWindow();
  return win && !win.isDestroyed() ? [win.webContents] : [];
}

/** The webContents of the currently selected tab. */
export function getActiveAppWebContents(): WebContents | null {
  if (activeTabProvider) {
    const wc = activeTabProvider();
    return wc && !wc.isDestroyed() ? wc : null;
  }
  const win = getMainWindow();
  return win && !win.isDestroyed() ? win.webContents : null;
}

/** Send an app-wide event (credits, entitlements, updates…) to every tab. */
export function broadcastToApp(channel: string, ...args: unknown[]): void {
  for (const wc of getAllAppWebContents()) {
    try {
      wc.send(channel, ...args);
    } catch {
      // window/tab may be tearing down; ignore
    }
  }
}
