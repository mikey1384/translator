export function defaultBrowserHint(): string {
  if (process.platform === 'darwin') return 'safari';
  if (process.platform === 'win32') return 'edge'; // yt-dlp understands "edge"
  return 'chrome';
}
