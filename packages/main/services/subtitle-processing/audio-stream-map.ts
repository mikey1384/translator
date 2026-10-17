/**
 * ffprobe's `stream=index` is the stream's absolute index in the file, so it
 * maps as `0:<index>`; `0:a:<n>` would mean the n-th audio track instead.
 */
export function audioStreamMapSpecifier(absoluteStreamIndex: string): string {
  return `0:${absoluteStreamIndex}`;
}
