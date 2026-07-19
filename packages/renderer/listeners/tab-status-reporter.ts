// Reports this tab's title and job progress to the main process so the
// tab strip can show a progress ring on backgrounded tabs and a badge
// when a job finishes or errors.
import { useTaskStore } from '../state/task-store';
import { useVideoStore } from '../state/video-store';
import { useUrlStore } from '../state/url-store';
import { useVideoSuggestionStore } from '../state/video-suggestion-store';

const THROTTLE_MS = 250;

let lastSent = '';
let timer: ReturnType<typeof setTimeout> | null = null;

// Structured failure tracking: task stages are localized display strings,
// so failure is never inferred from text. Progress packets carry an `error`
// field; the url-store keeps a structured `error` value. Both are latched
// here and cleared when the next job starts.
let sawJobError = false;
let wasRunning = false;
let lastUrlError: string | null = null;
let lastSuggestionError: string | null = null;

const latchPacketError = (packet: any) => {
  if (packet && packet.error) {
    sawJobError = true;
    // The store update for a terminal error may already have produced a
    // running:false report before this listener ran (progress-buffer is
    // registered first); schedule a follow-up so the corrected error
    // status reaches the tab manager, which promotes the badge.
    scheduleSend();
  }
};
const api = (window as any).electron;
api?.onGenerateSubtitlesProgress?.(latchPacketError);
api?.onDubSubtitlesProgress?.(latchPacketError);
api?.onMergeSubtitlesProgress?.(latchPacketError);
api?.onTranscriptSummaryProgress?.(latchPacketError);

// Highlight exports report on their own channels and are held in component
// state (useTranscriptHighlightsFlow), not in a global store — track them
// here from the packets so a long FFmpeg export still shows a ring/badge
// on a backgrounded tab and keeps the background-throttle policy honest.
const HIGHLIGHT_STALE_MS = 10 * 60_000;
let highlight: { percent: number; lastAt: number; active: boolean } = {
  percent: 0,
  lastAt: 0,
  active: false,
};
let highlightKeepalive: ReturnType<typeof setInterval> | null = null;

function onHighlightPacket(packet: any): void {
  latchPacketError(packet);
  const percent =
    typeof packet?.percent === 'number' && isFinite(packet.percent)
      ? packet.percent
      : 0;
  const finished = percent >= 100 || Boolean(packet?.error);
  highlight = {
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    lastAt: Date.now(),
    active: !finished,
  };
  if (highlight.active && !highlightKeepalive) {
    // Re-evaluate periodically so a job whose final packet never arrives
    // can't pin the tab in "running" forever (staleness guard below).
    highlightKeepalive = setInterval(scheduleSend, 30_000);
  } else if (!highlight.active && highlightKeepalive) {
    clearInterval(highlightKeepalive);
    highlightKeepalive = null;
  }
  scheduleSend();
}
api?.onHighlightCutProgress?.(onHighlightPacket);
api?.onCombinedHighlightCutProgress?.(onHighlightPacket);

function highlightRunning(): boolean {
  if (!highlight.active) return false;
  if (Date.now() - highlight.lastAt > HIGHLIGHT_STALE_MS) {
    highlight.active = false;
    if (highlightKeepalive) {
      clearInterval(highlightKeepalive);
      highlightKeepalive = null;
    }
    return false;
  }
  return true;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function computeStatus(): {
  title: string;
  percent: number | null;
  running: boolean;
  error: boolean;
} {
  const tasks = useTaskStore.getState();
  const video = useVideoStore.getState();
  const url = useUrlStore.getState();

  const slots = [
    tasks.transcription,
    tasks.translation,
    tasks.dubbing,
    tasks.merge,
    tasks.summary,
  ];
  const activeTask = slots.find(t => t.inProgress);
  const activeDownload = url.download.inProgress ? url.download : null;
  const activeHighlight = highlightRunning() ? highlight : null;
  const suggesting = useVideoSuggestionStore.getState().loading;
  const running = Boolean(
    activeTask || activeDownload || activeHighlight || suggesting
  );

  // Latch URL failures on the transition into an error state.
  if (
    url.error &&
    url.error !== lastUrlError &&
    url.errorKind !== 'validation'
  ) {
    sawJobError = true;
  }
  lastUrlError = url.error;

  // Same for failed video-suggestion searches (store clears loading and
  // sets error; without this latch a failed search badges green).
  const suggestionError = useVideoSuggestionStore.getState().error;
  if (suggestionError && suggestionError !== lastSuggestionError) {
    sawJobError = true;
  }
  lastSuggestionError = suggestionError;

  // A new job starting clears the previous outcome.
  if (running && !wasRunning) {
    sawJobError = false;
  }
  wasRunning = running;

  const percentSource = activeTask ?? activeDownload ?? activeHighlight;
  const title = video.path
    ? basename(video.path)
    : video.file?.name || 'New Tab';

  return {
    title,
    percent: percentSource ? Math.round(percentSource.percent ?? 0) : null,
    running,
    error: sawJobError,
  };
}

let lastReportedRunning = false;

function send(): void {
  const status = computeStatus();
  lastReportedRunning = status.running;
  const key = JSON.stringify(status);
  if (key === lastSent) return;
  lastSent = key;
  try {
    api?.reportTabStatus?.(status);
  } catch {
    // preload API unavailable (e.g. tests); ignore
  }
}

// Running-state transitions are sent immediately (leading edge) so the tab
// manager always observes running:true before a completion — a job that
// starts and fails inside one throttle window must still produce a badge.
// Everything else (percent updates, titles) coalesces on a trailing timer.
function scheduleSend(): void {
  const tasks = useTaskStore.getState();
  const runningNow = Boolean(
    tasks.transcription.inProgress ||
    tasks.translation.inProgress ||
    tasks.dubbing.inProgress ||
    tasks.merge.inProgress ||
    tasks.summary.inProgress ||
    useUrlStore.getState().download.inProgress ||
    useVideoSuggestionStore.getState().loading ||
    highlightRunning()
  );
  if (runningNow !== lastReportedRunning) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    send();
    return;
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    send();
  }, THROTTLE_MS);
}

useTaskStore.subscribe(scheduleSend);
useVideoStore.subscribe(scheduleSend);
useUrlStore.subscribe(scheduleSend);
useVideoSuggestionStore.subscribe(scheduleSend);

// Initial report so the tab gets a title as soon as it loads.
send();
