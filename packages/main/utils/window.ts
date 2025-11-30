import { BrowserWindow } from 'electron';

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
