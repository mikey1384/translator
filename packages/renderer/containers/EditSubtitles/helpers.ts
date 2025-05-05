import { SrtSegment } from '@shared-types/app';
import { useSubStore } from '../../state/subtitle-store';

export const processSrtContent = (
  srtContent: string,
  parseSrtFn: (s: string) => SrtSegment[],
  onSetError: (error: string) => void
) => {
  try {
    if (!srtContent) {
      onSetError('Empty SRT file content');
      return;
    }
    const parsed = parseSrtFn(srtContent);
    if (parsed.length === 0) {
      onSetError('No subtitles found in SRT file');
      return;
    }
    useSubStore.getState().load(parsed);
  } catch {
    onSetError('Invalid SRT file');
  }
};

export const handleRemoveSubtitle = (id: string) =>
  useSubStore.getState().remove(id);
export const handleInsertSubtitle = (id: string) =>
  useSubStore.getState().insertAfter(id);
export const handleShiftSubtitle = (id: string, shiftSeconds: number) =>
  useSubStore.getState().shift(id, shiftSeconds);

export const handleSeekToSubtitle = (startTime: number) => {
  try {
    const nativePlayer = (window as any).nativePlayer;
    if (nativePlayer && nativePlayer.instance) {
      nativePlayer.instance.currentTime = startTime;
    }
  } catch (error) {
    console.error('Error seeking to subtitle:', error);
  }
};

export const handlePlaySubtitle = (startTime: number, endTime: number) => {
  console.log('Play subtitle from', startTime, 'to', endTime);
  // Implement playback logic as needed
};

export const handleSaveSrt = () => {
  console.log('handleSaveSrt called');
  // Implement save logic as needed
};
