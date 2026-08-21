export function ytDlpReleaseAssetName(
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp';
}

export function ytDlpStagedBinaryName(
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32' ? 'yt-dlp.next.exe' : 'yt-dlp.next';
}
