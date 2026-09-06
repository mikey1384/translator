import type { SrtSegment, SummaryEffortLevel } from '@shared-types/app';

export type UsableTranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export function toUsableTranscriptSegments(
  segments: readonly SrtSegment[]
): UsableTranscriptSegment[] {
  return segments
    .map(segment => ({
      start: segment.start,
      end: segment.end,
      text: (segment.original ?? '').trim(),
    }))
    .filter(segment => segment.text.length > 0);
}

export function hasUsableTranscriptSegments(
  segments: readonly SrtSegment[]
): boolean {
  return segments.some(segment => (segment.original ?? '').trim().length > 0);
}

function normalizeSegmentTimestamp(value: number): string {
  if (!Number.isFinite(value)) return '0.000';
  return value.toFixed(3);
}

export function buildCanonicalTranscriptText(
  segments: readonly UsableTranscriptSegment[]
): string {
  return segments
    .map(
      segment =>
        `${normalizeSegmentTimestamp(segment.start)}\t${normalizeSegmentTimestamp(segment.end)}\t${segment.text}`
    )
    .join('\n');
}

export function buildSummaryInputSignature({
  segments,
  summaryLanguage,
  effortLevel,
}: {
  segments: readonly UsableTranscriptSegment[];
  summaryLanguage: string;
  effortLevel: SummaryEffortLevel;
}): string {
  const canonicalTranscript = buildCanonicalTranscriptText(segments);
  return `${summaryLanguage.toLowerCase()}|${effortLevel}|${canonicalTranscript}`;
}

export function normalizeSourcePathSignature(
  value: string | null | undefined
): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

export function normalizeSourceValueSignature(
  value: string | null | undefined
): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function buildSemanticSummarySourceIdentity({
  fallbackVideoAssetIdentity,
  fallbackVideoPath,
  originalVideoPath,
  sourceAssetIdentity,
  sourceUrl,
}: {
  fallbackVideoAssetIdentity: string | null;
  fallbackVideoPath: string | null;
  originalVideoPath: string | null;
  sourceAssetIdentity: string | null;
  sourceUrl: string | null;
}): string {
  const sourceAsset = normalizeSourceValueSignature(sourceAssetIdentity);
  if (sourceAsset) return `asset:${sourceAsset}`;
  const original = normalizeSourcePathSignature(originalVideoPath);
  if (original) return `original:${original}`;
  const normalizedUrl = normalizeSourceValueSignature(sourceUrl);
  if (normalizedUrl) return `url:${normalizedUrl}`;
  const fallbackAsset = normalizeSourceValueSignature(
    fallbackVideoAssetIdentity
  );
  if (fallbackAsset) return `fallback-asset:${fallbackAsset}`;
  const fallback = normalizeSourcePathSignature(fallbackVideoPath);
  if (fallback) return `fallback:${fallback}`;
  return 'none';
}

export function buildSummaryRequestOwnerKey({
  semanticSourceIdentity,
  segments,
  summaryLanguage,
  effortLevel,
}: {
  semanticSourceIdentity: string;
  segments: readonly SrtSegment[];
  summaryLanguage: string;
  effortLevel: SummaryEffortLevel;
}): string {
  const inputSignature = buildSummaryInputSignature({
    segments: toUsableTranscriptSegments(segments),
    summaryLanguage,
    effortLevel,
  });
  return `${inputSignature}|${semanticSourceIdentity}`;
}

export async function buildTranscriptHash(
  segments: ReturnType<typeof toUsableTranscriptSegments>
): Promise<string> {
  const canonical = buildCanonicalTranscriptText(segments);
  if (!window.crypto?.subtle) {
    throw new Error('Secure transcript hashing unavailable');
  }
  const encoded = new TextEncoder().encode(canonical);
  const digest = await window.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
