import type { VideoMetadataResult } from '@shared-types/app';

export function getMetadata(filePath: string): Promise<VideoMetadataResult> {
  return window.electron.getVideoMetadata(filePath);
}

export function hasVideoTrack(filePath: string): Promise<boolean> {
  return window.electron.hasVideoTrack(filePath);
}

export function savePlaybackPosition(
  filePath: string,
  position: number
): Promise<void> {
  return window.electron.saveVideoPlaybackPosition(filePath, position);
}

export function getPlaybackPosition(filePath: string): Promise<number | null> {
  return window.electron.getVideoPlaybackPosition(filePath);
}
