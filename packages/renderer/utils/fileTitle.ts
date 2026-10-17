/** "My Clip.final.mp4" → "My Clip.final". */
export function fileTitle(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() || filePath;
  const stem = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return stem || name;
}
