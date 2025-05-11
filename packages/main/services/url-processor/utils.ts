export function defaultBrowserHint(): string {
  if (process.platform === 'darwin') return 'safari';
  if (process.platform === 'win32') return 'edge';
  return 'chrome';
}
