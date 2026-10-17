import {
  SrtSegment,
  SubtitleDisplayMode,
  SubtitleDocumentLinkedFileRole,
} from '@shared-types/app';
import { autoSplitBilingualCues } from './bilingual';
import {
  getSubtitleSidecarPath,
  restoreSegmentsFromSubtitleSidecar,
} from './subtitle-sidecar';

export function srtStringToSeconds(raw: string): number {
  const m = raw.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!m) return 0;
  const [, hh, mm, ss, ms] = m.map(Number);
  return hh * 3600 + mm * 60 + ss + ms / 1000;
}

export class SubtitleProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubtitleProcessingError';
  }
}

/** Tidies a cue's spacing but keeps the line breaks its author chose. */
function normalizeCueLines(input?: string): string {
  if (!input) return '';
  return input
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function normalizeComparableSrtText(input: string): string {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

export function inferSubtitleDisplayModeFromSrtContent(args: {
  segments: SrtSegment[];
  srtContent: string;
}): SubtitleDisplayMode {
  const normalizedInput = normalizeComparableSrtText(args.srtContent);
  for (const mode of ['original', 'translation', 'dual'] as const) {
    const serialized = buildSrt({
      segments: args.segments,
      mode,
      noWrap: true,
    });
    if (normalizeComparableSrtText(serialized) === normalizedInput) {
      return mode;
    }
  }

  return args.segments.some(segment =>
    Boolean((segment.translation || '').trim())
  )
    ? 'dual'
    : 'original';
}

// A timing line: "00:01:02,345 --> 00:01:04,000". Hours may be any width,
// minutes/seconds one or two digits, "," or "." before the milliseconds, and
// the milliseconds any number of digits (see srtTimeToSeconds).
const SRT_TIME = String.raw`\d+:\d{1,2}:\d{1,2}(?:[,.]\d+)?`;
const SRT_TIMING_LINE_RE = new RegExp(
  String.raw`(?<![\d:])(${SRT_TIME})\s*-->\s*(${SRT_TIME})`
);
// Starts like a timing line but can't be read as one ("00:05:28 -> 1",
// "00:05:28,100 --> "). Never cue text: it would swallow the cue into the
// previous line.
const BROKEN_TIMING_LINE_RE = /^\s*[\d:,.]+\s*-+>/;
const INDEX_LINE_RE = /^\s*\d+\s*$/;

interface RawSrtCue {
  index: number;
  start: number;
  end: number;
  textLines: string[];
}

/**
 * Split SRT text into cues. A cue starts at each timing line (its number is
 * the line just above, when present) and runs until the next cue starts.
 * Cues whose timing can't be read are dropped and counted, never folded
 * into the previous cue's text.
 */
function splitSrtCues(srtString: string): {
  cues: RawSrtCue[];
  unreadable: number;
} {
  const cues: RawSrtCue[] = [];
  let unreadable = 0;
  if (!srtString?.trim()) return { cues, unreadable };

  const lines = srtString
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  type Mark = { line: number; kind: 'cue' | 'broken'; tm?: RegExpMatchArray };
  const marks: Mark[] = [];
  for (let i = 0; i < lines.length; i++) {
    const tm = lines[i].match(SRT_TIMING_LINE_RE);
    if (tm) marks.push({ line: i, kind: 'cue', tm });
    else if (BROKEN_TIMING_LINE_RE.test(lines[i]))
      marks.push({ line: i, kind: 'broken' });
  }

  // Where each cue's block begins: its number line, if it sits right above.
  const blockStart = (m: Mark, floor: number) =>
    m.line - 1 >= floor && INDEX_LINE_RE.test(lines[m.line - 1])
      ? m.line - 1
      : m.line;

  let fallbackIdx = 0;
  for (let k = 0; k < marks.length; k++) {
    const mark = marks[k];
    const floor = k > 0 ? marks[k - 1].line + 1 : 0;
    if (mark.kind === 'broken') {
      unreadable++;
      // Numbered blocks with no timing line that follow it are lost too.
      const next = marks[k + 1];
      const stop = next ? blockStart(next, mark.line + 1) : lines.length;
      for (let j = mark.line + 2; j < stop; j++) {
        if (lines[j - 1].trim() === '' && INDEX_LINE_RE.test(lines[j])) {
          unreadable++;
        }
      }
      continue;
    }
    const start = srtTimeToSeconds(mark.tm![1]);
    const end = srtTimeToSeconds(mark.tm![2]);
    const startLine = blockStart(mark, floor);
    const numbered = startLine < mark.line;
    const index = numbered
      ? Number(lines[startLine].trim()) || ++fallbackIdx
      : ++fallbackIdx;
    const next = marks[k + 1];
    const stop = next ? blockStart(next, mark.line + 1) : lines.length;
    let textLines = lines.slice(mark.line + 1, stop);
    // A numbered block with no timing line at all ("5" right after a blank,
    // then text): it is a lost cue, not more of this one.
    for (let j = 1; j < textLines.length; j++) {
      if (
        textLines[j - 1].trim() === '' &&
        INDEX_LINE_RE.test(textLines[j]) &&
        Number(textLines[j].trim()) === index + 1
      ) {
        textLines = textLines.slice(0, j - 1);
        unreadable++;
        break;
      }
    }
    // Drop the blank separator(s) before the next cue.
    while (textLines.length && textLines[textLines.length - 1].trim() === '') {
      textLines.pop();
    }
    if (isNaN(start) || isNaN(end)) {
      unreadable++;
      continue;
    }
    cues.push({ index, start, end, textLines });
  }
  return { cues, unreadable };
}

export function parseSrt(srtString: string): SrtSegment[] {
  return parseSrtWithReport(srtString).segments;
}

/** parseSrt plus how many cues were left out because their timing was unreadable. */
export function parseSrtWithReport(srtString: string): {
  segments: SrtSegment[];
  unreadableCues: number;
} {
  const { cues, unreadable } = splitSrtCues(srtString);
  const segments = cues.map(cue => {
    const textLines = cue.textLines.map(line =>
      line.replace(/\\n/g, '\n').trim()
    );
    const original = textLines[0] ?? '';
    const translation =
      textLines.length >= 2 ? textLines.slice(1).join('\n') : undefined;
    return {
      id: crypto.randomUUID(),
      index: cue.index,
      start: cue.start,
      end: cue.end,
      original,
      translation,
    };
  });
  return { segments, unreadableCues: unreadable };
}

// Parse SRT but place the entire cue text (all lines) in `original` and leave `translation` undefined.
// Use this when loading user-provided SRT files so we don't misinterpret line breaks as dual-language splits.
/**
 * How an external .srt with no app metadata becomes cues: bilingual cues are
 * split into original + translation. Opening a file and an agent mounting
 * one both go through here so they read cues the same way.
 */
export function shapeImportedSrtSegments(segments: SrtSegment[]): SrtSegment[] {
  return autoSplitBilingualCues(segments).map(seg => ({
    ...seg,
    original: normalizeCueLines(seg.original),
    translation:
      typeof seg.translation === 'string'
        ? normalizeCueLines(seg.translation)
        : seg.translation,
  }));
}

export function parseSrtOriginalOnly(srtString: string): SrtSegment[] {
  return parseSrtOriginalOnlyWithReport(srtString).segments;
}

export function parseSrtOriginalOnlyWithReport(srtString: string): {
  segments: SrtSegment[];
  unreadableCues: number;
} {
  const { cues, unreadable } = splitSrtCues(srtString);
  const segments = cues.map(
    cue =>
      ({
        id: crypto.randomUUID(),
        index: cue.index,
        start: cue.start,
        end: cue.end,
        original: cue.textLines
          .map(line => line.replace(/\\n/g, '\n'))
          .join('\n')
          .trim(),
      }) as SrtSegment
  );
  return { segments, unreadableCues: unreadable };
}

export function buildSrt({
  segments,
  mode = 'dual',
  noWrap = false,
}: {
  segments: SrtSegment[];
  mode?: 'original' | 'translation' | 'dual';
  noWrap?: boolean;
}): string {
  if (!segments?.length) return '';

  const wrapSingle = (text: string): string => {
    const MAX_LINE = 42;
    if (!text) return '';
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= MAX_LINE) return clean;
    // Try soft wrap at punctuation or space near midpoint
    const target = Math.min(clean.length, MAX_LINE * 2);
    const midpoint = Math.min(target, Math.floor(clean.length / 2));
    const candidates = [',', ';', ':', ' — ', ' - ', ' '];
    let splitIdx = -1;
    for (const c of candidates) {
      const left = clean.lastIndexOf(c, Math.max(0, midpoint + 10));
      const right = clean.indexOf(c, Math.max(0, midpoint - 10));
      const pick = Math.max(left, right);
      if (pick !== -1) {
        splitIdx = pick + (c.trim() ? c.length : 1);
        break;
      }
    }
    if (splitIdx <= 0 || splitIdx >= clean.length)
      splitIdx = Math.min(MAX_LINE, clean.length);
    // Two lines, never dropping words: a long cue keeps all its text.
    const left = clean.slice(0, splitIdx).trim();
    const right = clean.slice(splitIdx).trim();
    return right ? `${left}\n${right}` : left;
  };

  return segments
    .map((seg, i) => {
      const idx = seg.index ?? i + 1;
      const start = secondsToSrtTime(seg.start);
      const end = secondsToSrtTime(seg.end);
      let cue = cueText(seg, mode);
      if (mode !== 'dual' && !noWrap) {
        // Break single-language cues into two balanced lines
        cue = wrapSingle(cue);
      }

      return `${idx}\n${start} --> ${end}\n${cue}`;
    })
    .join('\n\n');
}

export function cueText(
  seg: SrtSegment,
  mode: 'original' | 'translation' | 'dual'
): string {
  if (!seg) return '';

  const hasTrans = !!seg.translation && seg.translation.trim() !== '';
  const original = seg.original || '';
  const translation = seg.translation || '';

  switch (mode) {
    case 'original':
      return original || translation;

    case 'translation':
      return hasTrans ? translation : original;

    case 'dual':
    default:
      return hasTrans ? `${original}\n${translation}` : original;
  }
}

/**
 * "hh:mm:ss,mmm" to seconds. Also reads "." before the milliseconds and
 * off-spec millisecond widths: 1-3 digits are a decimal fraction (",5" is
 * half a second, ",05" is 50 ms), 4+ digits are a millisecond count that
 * carries into the seconds (",1000" is one second, as some tools write).
 */
export function srtTimeToSeconds(timeString: string): number {
  if (!timeString) return 0;
  const m = String(timeString)
    .trim()
    .match(/^(\d+):(\d{1,2}):(\d{1,2})(?:[,.](\d+))?$/);
  if (!m) return 0;
  const hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const seconds = parseInt(m[3], 10);
  const msDigits = m[4] ?? '';
  const ms =
    msDigits.length === 0
      ? 0
      : msDigits.length <= 3
        ? parseInt(msDigits.padEnd(3, '0'), 10)
        : parseInt(msDigits, 10);
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

/**
 * Convert seconds to SRT time format (00:00:00,000)
 */
export function secondsToSrtTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00:00,000';
  // Round once before splitting fields: floating-point fractions such as
  // 970.156 otherwise lose a millisecond on every SRT export/reopen cycle.
  const totalMs = Math.round(totalSeconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor(totalMs / 60_000) % 60;
  const seconds = Math.floor(totalMs / 1000) % 60;
  const milliseconds = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

export function fixOverlappingSegments(segments: SrtSegment[]): SrtSegment[] {
  if (!segments || segments.length <= 1) return segments;

  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sortedSegments.length - 1; i++) {
    const current = sortedSegments[i];
    const next = sortedSegments[i + 1];
    if (current.end > next.start) {
      current.end = Math.max(current.start + 0.1, next.start - 0.05);
    }
  }

  return sortedSegments;
}

export function formatTimeForDisplay(seconds: number): string {
  if (isNaN(seconds)) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Opens an .srt: from the file dialog, or straight from `filePath` (a file
 * dropped on the window).
 */
export async function openSubtitleWithElectron(
  options: {
    filePath?: string;
    /** The open dialog's title and file-type name, already translated. */
    dialogTitle?: string;
    filterName?: string;
  } = {}
): Promise<{
  file?: File;
  content?: string;
  segments?: SrtSegment[];
  document?: import('@shared-types/app').SubtitleDocumentMeta;
  filePath?: string;
  fileMode?: SubtitleDisplayMode;
  fileRole?: SubtitleDocumentLinkedFileRole | null;
  /** Cues left out because their timing couldn't be read. */
  unreadableCues?: number;
  cancelled?: boolean;
  error?: string;
}> {
  try {
    const {
      findSubtitleDocumentForFileWithRetry,
      openFile: openFileIPC,
      readSavedSubtitleMetadataWithRetry,
      readTextFileWithRetry,
      saveSubtitleDocumentRecordWithRetry,
    } = await import('./electron-ipc.js');
    let filePath: string;
    let content: string;
    if (options.filePath) {
      const read = await readTextFileWithRetry(options.filePath);
      if (read.content == null) {
        throw new Error(read.error || 'Failed to read file content.');
      }
      filePath = options.filePath;
      content = read.content;
    } else {
      const result = await openFileIPC({
        filters: [
          { name: options.filterName ?? 'Subtitle Files', extensions: ['srt'] },
        ],
        title: options.dialogTitle ?? 'Open Subtitle File',
      });

      if (
        result.canceled ||
        !result.filePaths?.length ||
        !result.fileContents?.length
      ) {
        return { cancelled: true };
      }

      filePath = result.filePaths[0];
      content = result.fileContents[0];
    }
    const filename = filePath.split(/[\\/]/).pop() || 'subtitles.srt';
    const file = new File([content], filename, { type: 'text/plain' });

    localStorage.setItem('loadedSrtFileName', filename);
    localStorage.setItem('originalSrtPath', filePath);
    localStorage.setItem('originalLoadPath', filePath);

    const documentResult = await findSubtitleDocumentForFileWithRetry({
      filePath,
      srtContent: content,
    });

    const sidecarPath = getSubtitleSidecarPath(filePath);
    const sidecarResult = await readTextFileWithRetry(sidecarPath);
    const sidecarSegments = restoreSegmentsFromSubtitleSidecar({
      srtContent: content,
      sidecarContent: sidecarResult.content,
    });
    const cachedMetadataResult = sidecarSegments
      ? { segments: undefined as SrtSegment[] | undefined }
      : await readSavedSubtitleMetadataWithRetry({
          filePath,
          srtContent: content,
        });

    let unreadableCues = 0;
    const parsePlain = () => {
      const report = parseSrtOriginalOnlyWithReport(content);
      unreadableCues = report.unreadableCues;
      return report.segments;
    };
    // Prefer the canonical Stage5 document when it matches this file, then any
    // legacy adjacent sidecar, then the internal metadata cache, and only then
    // the plain heuristic parse for external SRTs that never had app metadata.
    const segments =
      documentResult.segments && documentResult.segments.length > 0
        ? documentResult.segments
        : sidecarSegments
          ? sidecarSegments
          : cachedMetadataResult.segments &&
              cachedMetadataResult.segments.length > 0
            ? cachedMetadataResult.segments
            : shapeImportedSrtSegments(parsePlain());
    const fileMode =
      documentResult.fileMode ??
      inferSubtitleDisplayModeFromSrtContent({
        segments,
        srtContent: content,
      });
    const fileRole = documentResult.fileRole ?? 'import';
    const document =
      documentResult.document ??
      (
        await saveSubtitleDocumentRecordWithRetry({
          title: filename,
          segments,
          importFilePath: filePath,
          importSrtContent: content,
          importMode: fileMode,
          activeLinkedFilePath: filePath,
          activeLinkedFileMode: fileMode,
          activeLinkedFileRole: fileRole,
        })
      ).document;

    return {
      file,
      content,
      document,
      segments,
      filePath,
      fileMode,
      fileRole,
      unreadableCues,
    };
  } catch (error: any) {
    const message = error.message || String(error);
    console.error('Error opening subtitle file:', message);
    return { error: `Failed to open subtitle file: ${message}` };
  }
}

export const validateSubtitleTimings = (
  subtitles: SrtSegment[]
): SrtSegment[] => {
  if (!subtitles || subtitles.length === 0) return [];
  return subtitles.map(subtitle => {
    const fixed = { ...subtitle };
    if (fixed.start < 0) fixed.start = 0;
    if (fixed.end <= fixed.start) fixed.end = fixed.start + 0.5;
    return fixed;
  });
};
