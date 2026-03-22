import type { SrtSegment } from '@shared-types/app';

export const SUBTITLE_SIDECAR_SUFFIX = '.stage5.json';

interface SubtitleSidecarV1 {
  version: 1;
  srtFingerprint: string;
  segments: Array<{
    index?: number;
    start: number;
    end: number;
    original: string;
    translation?: string;
  }>;
}

interface SubtitleSidecarV2 {
  version: 2;
  srtFingerprint: string;
  segments: Array<{
    index?: number;
    start: number;
    end: number;
    original: string;
    translation?: string;
    words?: Array<{
      start: number;
      end: number;
      word: string;
    }>;
  }>;
}

type SubtitleSidecarPayload = SubtitleSidecarV1 | SubtitleSidecarV2;
type SidecarSegmentPayload =
  | SubtitleSidecarV1['segments'][number]
  | SubtitleSidecarV2['segments'][number];

export function getSubtitleSidecarPath(srtPath: string): string {
  return `${srtPath}${SUBTITLE_SIDECAR_SUFFIX}`;
}

export function fingerprintSubtitleText(text: string): string {
  const normalizedText = String(text).replace(/\r\n?/g, '\n');
  const bytes = new TextEncoder().encode(normalizedText);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }

  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

export function buildSubtitleSidecarContent(args: {
  segments: SrtSegment[];
  srtContent: string;
}): string {
  const payload: SubtitleSidecarV2 = {
    version: 2,
    srtFingerprint: fingerprintSubtitleText(args.srtContent),
    segments: args.segments.map(segment => ({
      index: segment.index,
      start: segment.start,
      end: segment.end,
      original: String(segment.original || ''),
      translation:
        typeof segment.translation === 'string'
          ? segment.translation
          : undefined,
      words:
        Array.isArray(segment.words) && segment.words.length > 0
          ? segment.words.map(word => ({
              start: word.start,
              end: word.end,
              word: word.word,
            }))
          : undefined,
    })),
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function restoreSegmentWords(
  words: unknown
): { start: number; end: number; word: string }[] | undefined | null {
  if (words == null) {
    return undefined;
  }
  if (!Array.isArray(words)) {
    return null;
  }

  const restoredWords: { start: number; end: number; word: string }[] = [];
  for (const word of words) {
    if (
      typeof word?.start !== 'number' ||
      typeof word?.end !== 'number' ||
      typeof word?.word !== 'string'
    ) {
      return null;
    }
    restoredWords.push({
      start: word.start,
      end: word.end,
      word: word.word,
    });
  }

  return restoredWords.length > 0 ? restoredWords : undefined;
}

export function restoreSegmentsFromSubtitleSidecar(args: {
  srtContent: string;
  sidecarContent?: string | null;
}): SrtSegment[] | null {
  const raw = String(args.sidecarContent || '').trim();
  if (!raw) return null;

  let parsed: SubtitleSidecarPayload;
  try {
    parsed = JSON.parse(raw) as SubtitleSidecarPayload;
  } catch {
    return null;
  }

  if (
    !parsed ||
    (parsed.version !== 1 && parsed.version !== 2) ||
    parsed.srtFingerprint !== fingerprintSubtitleText(args.srtContent) ||
    !Array.isArray(parsed.segments)
  ) {
    return null;
  }

  const restored: SrtSegment[] = [];
  for (const segment of parsed.segments) {
    if (
      typeof segment?.start !== 'number' ||
      typeof segment?.end !== 'number' ||
      typeof segment?.original !== 'string'
    ) {
      return null;
    }

    const restoredWords =
      parsed.version === 2
        ? restoreSegmentWords(
            (
              segment as SidecarSegmentPayload & {
                words?: SubtitleSidecarV2['segments'][number]['words'];
              }
            ).words
          )
        : undefined;
    if (restoredWords === null) {
      return null;
    }

    restored.push({
      id: crypto.randomUUID(),
      index:
        typeof segment.index === 'number' ? segment.index : restored.length + 1,
      start: segment.start,
      end: segment.end,
      original: segment.original,
      translation:
        typeof segment.translation === 'string'
          ? segment.translation
          : undefined,
      words: restoredWords,
    });
  }

  return restored;
}
