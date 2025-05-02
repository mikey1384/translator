import { SrtSegment } from '@shared-types/app';

export const processSrtContent = (
  srtContent: string,
  parseSrtFn: (s: string) => SrtSegment[],
  setSubtitlesState: (subs: SrtSegment[]) => void,
  setEditingTimesState: (times: Record<string, string>) => void,
  onSetError: (error: string) => void
) => {
  try {
    if (!srtContent) {
      onSetError('Empty SRT file content');
      return;
    }
    setSubtitlesState([]);
    setEditingTimesState({});
    const parsed = parseSrtFn(srtContent);
    if (parsed.length === 0) {
      onSetError('No subtitles found in SRT file');
      return;
    }
    setSubtitlesState(parsed);
  } catch {
    onSetError('Invalid SRT file');
  }
};

export const handleRemoveSubtitle = (
  index: number,
  subtitles: any[],
  setSubtitlesState: (subs: any[]) => void
) => {
  if (!window.confirm('Are you sure you want to remove this subtitle block?'))
    return;
  const updated = subtitles
    .filter((_, i) => i !== index)
    .map((sub, i) => ({ ...sub, index: i + 1 }));
  setSubtitlesState(updated);
};

export const handleInsertSubtitle = (
  index: number,
  subtitles: any[],
  setSubtitlesState: (subs: any[]) => void
) => {
  const currentSub = subtitles[index];
  const nextSub = index < subtitles.length - 1 ? subtitles[index + 1] : null;
  const newStart = currentSub.end;
  const newEnd = nextSub ? nextSub.start : currentSub.end + 2;
  const newSubtitle = {
    index: index + 2,
    start: newStart,
    end: newEnd,
    text: '',
  };
  const updated = [
    ...subtitles.slice(0, index + 1),
    newSubtitle,
    ...subtitles.slice(index + 1),
  ].map((sub, i) => ({ ...sub, index: i + 1 }));
  setSubtitlesState(updated);
};

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

export const handleShiftSubtitle = (
  index: number,
  shiftSeconds: number,
  subtitles: any[],
  setSubtitlesState: (subs: any[]) => void,
  setIsShiftingDisabled: (disabled: boolean) => void
) => {
  if (!subtitles[index]) return;
  const sub = subtitles[index];
  const newStart = Math.max(0, sub.start + shiftSeconds);
  const duration = sub.end - sub.start;
  const newEnd = newStart + duration;
  const updated = subtitles.map((s, i) =>
    i === index ? { ...s, start: newStart, end: newEnd } : s
  );
  setSubtitlesState(updated);
  setIsShiftingDisabled(true);
  setTimeout(() => setIsShiftingDisabled(false), 100);
};

export const handleSaveSrt = () => {
  console.log('handleSaveSrt called');
  // Implement save logic as needed
};
