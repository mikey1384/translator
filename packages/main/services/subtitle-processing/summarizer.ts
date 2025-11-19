import { callAIModel } from './ai-client.js';
import type {
  TranscriptSummarySegment,
  TranscriptSummaryProgress,
  TranscriptHighlight,
  TranscriptSummarySection,
} from '@shared-types/app';
import { AI_MODELS } from '@shared/constants';

interface GenerateTranscriptSummaryOptions {
  segments: TranscriptSummarySegment[];
  targetLanguage: string;
  signal: AbortSignal;
  operationId: string;
  progressCallback?: (progress: TranscriptSummaryProgress) => void;
  includeHighlights?: boolean;
  maxHighlights?: number;
}

interface GenerateTranscriptSummaryResult {
  summary: string;
  sections: TranscriptSummarySection[];
  highlights: TranscriptHighlight[];
}

interface SelectTranscriptHighlightsOptions {
  segments: TranscriptSummarySegment[];
  targetLanguage: string;
  signal: AbortSignal;
  operationId: string;
  maxHighlights?: number;
  sections?: TranscriptSummarySection[];
  progressCallback?: (progress: TranscriptSummaryProgress) => void;
  startPercent?: number;
  endPercent?: number;
}

const MAX_CHARS_PER_CHUNK = 7_500;
const MAX_RUNNING_SUMMARY_CHARS = 20_000;
const MAX_SECTION_PROMPT_CHARS = 5_000;

function sanitizeSegments(
  segments: TranscriptSummarySegment[]
): TranscriptSummarySegment[] {
  if (!Array.isArray(segments)) return [];
  return segments
    .filter(seg => !!seg && typeof seg.text === 'string')
    .map(seg => ({
      start: typeof seg.start === 'number' ? seg.start : 0,
      end: typeof seg.end === 'number' ? seg.end : seg.start,
      text: seg.text.trim(),
    }))
    .filter(seg => seg.text.length > 0);
}

function sanitizeSectionContents(
  sections?: TranscriptSummarySection[] | null
): string[] | null {
  if (!Array.isArray(sections) || sections.length === 0) {
    return null;
  }
  const sanitized = sections.map(section =>
    typeof section?.content === 'string' ? section.content.trim() : ''
  );
  if (sanitized.every(content => !content)) {
    return null;
  }
  return sanitized;
}

function createSectionSummaries(
  summaries: string[]
): TranscriptSummarySection[] {
  return summaries.map((text, idx) => {
    const content = (text ?? '').trim();
    return {
      index: idx + 1,
      title: deriveSectionTitle(content, idx),
      content,
    };
  });
}

function deriveSectionTitle(content: string, idx: number): string {
  const fallback = `Section ${idx + 1}`;
  if (!content) return fallback;

  const firstParagraph = content
    .split(/\n+/)
    .find(part => part.trim())
    ?.trim();
  if (!firstParagraph) return fallback;

  const sentenceMatch = firstParagraph.match(/^(.{0,140}?[.!?])(?:\s|$)/);
  if (sentenceMatch && sentenceMatch[1]) {
    return sentenceMatch[1].trim();
  }

  const snippet = firstParagraph.slice(0, 120).trim();
  return snippet || fallback;
}

export async function generateTranscriptSummary({
  segments,
  targetLanguage,
  signal,
  operationId,
  progressCallback,
  includeHighlights = true,
  maxHighlights,
}: GenerateTranscriptSummaryOptions): Promise<GenerateTranscriptSummaryResult> {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('No transcript segments available for summary');
  }

  const cleanedSegments = sanitizeSegments(segments);

  if (cleanedSegments.length === 0) {
    throw new Error('Transcript is empty after filtering silent segments');
  }

  const languageName = formatLanguage(targetLanguage);
  const highlightLimit = resolveHighlightLimit(maxHighlights);

  progressCallback?.({ percent: 5, stage: 'Preparing transcript slices' });

  const chunks = buildChunks(cleanedSegments);

  if (signal.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  const chunkSummaries: string[] = [];
  const perChunkProgress = 70 / chunks.length;
  let runningSummary = '';

  for (let i = 0; i < chunks.length; i++) {
    if (signal.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    const chunkText = chunks[i];
    const startPercent = 20 + perChunkProgress * i;
    progressCallback?.({
      percent: startPercent,
      stage: `Summarizing section ${i + 1} of ${chunks.length}`,
    });

    const summary = await summarizeChunk({
      chunkText,
      chunkIndex: i,
      chunkCount: chunks.length,
      languageName,
      signal,
      operationId,
    });
    const trimmedSummary = summary.trim();
    chunkSummaries.push(trimmedSummary);

    runningSummary = await mergeIntoRunningSummary({
      existingSummary: runningSummary,
      newSectionSummary: trimmedSummary,
      languageName,
      signal,
      operationId,
    });

    const partialSections = createSectionSummaries(chunkSummaries);
    const completePercent = 20 + perChunkProgress * (i + 1);
    progressCallback?.({
      percent: completePercent,
      stage: `Section ${i + 1} of ${chunks.length} summarized`,
      partialSummary: runningSummary,
      partialSections,
    });
  }

  if (signal.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  const sectionSummaries = createSectionSummaries(chunkSummaries);
  const finalSummary = runningSummary.trim();

  if (!finalSummary) {
    throw new Error('Summary synthesis returned empty content');
  }

  progressCallback?.({
    percent: 92,
    stage: 'Synthesizing comprehensive summary',
    partialSummary: finalSummary,
    partialSections: sectionSummaries,
  });

  let highlights: TranscriptHighlight[] = [];
  if (includeHighlights && highlightLimit > 0) {
    try {
      highlights = await selectTranscriptHighlights({
        segments: cleanedSegments,
        targetLanguage,
        signal,
        operationId,
        maxHighlights: highlightLimit,
        sections: sectionSummaries,
        progressCallback,
        startPercent: 94,
        endPercent: 99,
      });
    } catch (highlightError) {
      progressCallback?.({
        percent: 99,
        stage: 'highlight-selection-error',
        error:
          highlightError instanceof Error
            ? highlightError.message
            : 'Highlight selection failed',
      });
    }
  }

  progressCallback?.({
    percent: 100,
    stage: 'Summary ready',
    partialSummary: finalSummary,
    partialSections: sectionSummaries,
    partialHighlights: highlights,
  });

  return { summary: finalSummary, sections: sectionSummaries, highlights };
}

export async function selectTranscriptHighlights({
  segments,
  targetLanguage,
  signal,
  operationId,
  maxHighlights,
  sections,
  progressCallback,
  startPercent,
  endPercent,
}: SelectTranscriptHighlightsOptions): Promise<TranscriptHighlight[]> {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('No transcript segments provided for highlight selection');
  }

  const cleanedSegments = sanitizeSegments(segments);
  if (cleanedSegments.length === 0) {
    throw new Error('Transcript is empty after filtering silent segments');
  }

  const highlightLimit = resolveHighlightLimit(maxHighlights);
  if (highlightLimit <= 0) {
    return [];
  }

  const chunks = buildChunks(cleanedSegments);
  if (chunks.length === 0) {
    throw new Error('Transcript is empty after chunking');
  }

  const selectionStart = Number.isFinite(startPercent ?? null)
    ? Number(startPercent)
    : 0;
  const selectionEnd = Number.isFinite(endPercent ?? null)
    ? Number(endPercent)
    : 100;
  const selectionSpan = Math.max(0, selectionEnd - selectionStart);
  const mapPercent = (value: number) => {
    const normalized = Math.min(100, Math.max(0, value));
    if (selectionSpan === 0) {
      return selectionEnd;
    }
    return selectionStart + (selectionSpan * normalized) / 100;
  };

  const languageName = formatLanguage(targetLanguage);
  progressCallback?.({
    percent: mapPercent(5),
    stage: 'Preparing highlight selection',
  });

  let chunkSummaries: string[];
  const sanitizedSections = sanitizeSectionContents(sections);
  if (sanitizedSections && sanitizedSections.length === chunks.length) {
    chunkSummaries = sanitizedSections;
    progressCallback?.({
      percent: mapPercent(15),
      stage: 'Reusing summary sections for highlight selection',
    });
  } else {
    chunkSummaries = await summarizeChunksForHighlights({
      chunks,
      languageName,
      signal,
      operationId,
      progressCallback,
      startPercent: mapPercent(10),
      endPercent: mapPercent(55),
    });
  }

  if (signal.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  const highlights = await selectHighlightsFromChunks({
    chunks,
    chunkSummaries,
    segments: cleanedSegments,
    languageName,
    signal,
    operationId,
    maxHighlights: highlightLimit,
    progressCallback,
    startPercent: mapPercent(60),
    endPercent: mapPercent(95),
  });

  progressCallback?.({
    percent: mapPercent(100),
    stage: 'Highlights ready',
    partialHighlights: highlights,
    total: highlights.length,
    current: highlights.length,
  });

  return highlights;
}

function buildChunks(segments: TranscriptSummarySegment[]): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const seg of segments) {
    const line = formatSegment(seg);
    if (!line) continue;

    if (current.length + line.length + 1 > MAX_CHARS_PER_CHUNK && current) {
      chunks.push(current.trim());
      current = '';
    }

    current += (current ? '\n' : '') + line;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

async function summarizeChunksForHighlights({
  chunks,
  languageName,
  signal,
  operationId,
  progressCallback,
  startPercent,
  endPercent,
}: {
  chunks: string[];
  languageName: string;
  signal: AbortSignal;
  operationId: string;
  progressCallback?: (progress: TranscriptSummaryProgress) => void;
  startPercent: number;
  endPercent: number;
}): Promise<string[]> {
  const summaries: string[] = [];
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return summaries;
  }

  const total = chunks.length;
  const span = Math.max(0, endPercent - startPercent);

  for (let i = 0; i < total; i++) {
    if (signal.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    const start = startPercent + (span * i) / total;
    progressCallback?.({
      percent: start,
      stage: `Analyzing section ${i + 1} of ${total} for highlights`,
      current: i + 1,
      total,
    });

    const summary = await summarizeChunk({
      chunkText: chunks[i],
      chunkIndex: i,
      chunkCount: total,
      languageName,
      signal,
      operationId,
    });
    summaries.push(summary.trim());

    progressCallback?.({
      percent: startPercent + (span * (i + 1)) / total,
      stage: `Section ${i + 1} analyzed`,
      current: i + 1,
      total,
    });
  }

  return summaries;
}

async function summarizeChunk({
  chunkText,
  chunkIndex,
  chunkCount,
  languageName,
  signal,
  operationId,
}: {
  chunkText: string;
  chunkIndex: number;
  chunkCount: number;
  languageName: string;
  signal: AbortSignal;
  operationId: string;
}): Promise<string> {
  const systemPrompt = `You are a meticulous academic researcher creating detailed source notes for university-level assignments. Always respond in ${languageName} using a formal, objective tone and plain-text formatting.`;

  const userPrompt = `This is section ${chunkIndex + 1} of ${chunkCount} from an extended transcript. Produce plain-text notes in ${languageName} that will later inform a formal introduction. Follow these instructions:

- Write in complete sentences with no headings, bullet markers, numbering, emojis, or decorative symbols. Separate ideas with standard paragraph breaks only.
- Open with 2–3 sentences that state who is speaking, the situational backdrop, and the intent of this portion of the recording.
- Continue with 3–5 sentences that explain the major arguments or developments in the order they occur, highlighting key terminology or shifts in emphasis.
- Conclude with 2–3 sentences that capture supporting evidence, illustrative examples, or quotations. Attribute speakers when possible.
- Present timestamps only when essential, phrasing them inline as "at 00:04:12" or "from 00:04:12 to 00:05:01". Do not use parentheses or square brackets for times, and never start a sentence with a timestamp.
- Maintain a scholarly, neutral tone throughout and avoid redundant phrasing.

Transcript section ${chunkIndex + 1}:
${chunkText}`;

  const content = await callAIModel({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    model: AI_MODELS.GPT,
    reasoning: { effort: 'high' },
    signal,
    operationId,
  });

  return content;
}

async function mergeIntoRunningSummary({
  existingSummary,
  newSectionSummary,
  languageName,
  signal,
  operationId,
}: {
  existingSummary: string;
  newSectionSummary: string;
  languageName: string;
  signal: AbortSignal;
  operationId: string;
}): Promise<string> {
  const sectionText = truncateForPrompt(
    newSectionSummary,
    MAX_SECTION_PROMPT_CHARS
  );
  if (!sectionText) {
    return existingSummary.trim();
  }

  const priorSummary = truncateForPrompt(
    existingSummary,
    MAX_RUNNING_SUMMARY_CHARS
  );
  const hasPriorSummary = priorSummary.trim().length > 0;

  const systemPrompt = `You are an experienced conference scribe maintaining a running outline for an extended recording. Always respond in ${languageName} using "- " bullet points (one bullet per line) while preserving chronological order.`;

  const introInstruction = hasPriorSummary
    ? `Do NOT delete existing bullets. Copy the current bullet list verbatim in the same order, then append new bullets summarizing the latest section. Only merge or rephrase earlier bullets if absolutely necessary for clarity, and even then ensure every original bullet still has a counterpart.`
    : `Create the first set of bullets for the recording using the section notes below.`;

  const existingBlock = hasPriorSummary
    ? `Existing bullet list (copy exactly before adding new bullets):\n${priorSummary || '(none yet)'}\n\n`
    : '';

  const userPrompt = `${introInstruction}

Guidelines:
- Begin every line with "- " and keep each bullet to at most two sentences.
- Mention speakers, timestamps, locations, or stakes when available to anchor the bullet.
- Maintain chronological order; new bullets must be appended after the existing list.
- Add at least three bullets that capture the most important ideas, decisions, or emotions from the latest section.
- Do not add prose paragraphs, concluding summaries, or keyword lists—bullets only.

${existingBlock}Latest section notes:
${sectionText}`;

  const content = await callAIModel({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    model: AI_MODELS.GPT,
    reasoning: { effort: 'high' },
    signal,
    operationId,
  });

  return clampSummaryLength(content, MAX_RUNNING_SUMMARY_CHARS).trim();
}

function truncateForPrompt(value: string, limit: number): string {
  if (!value) return '';
  if (value.length <= limit) return value;
  return value.slice(0, limit);
}

function clampSummaryLength(value: string, limit: number): string {
  if (!value) return '';
  if (value.length <= limit) return value;
  return value.slice(0, limit);
}

function formatSegment(seg: TranscriptSummarySegment): string {
  if (!seg.text.trim()) {
    return '';
  }

  const start = formatTimecode(seg.start);
  const end = formatTimecode(seg.end);
  const safeText = seg.text.replace(/\s+/g, ' ').trim();
  return `(${start} - ${end}) ${safeText}`;
}

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds)) seconds = 0;
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hrs, mins, secs].map(val => String(val).padStart(2, '0')).join(':');
}

function formatLanguage(value: string): string {
  if (!value) return 'English';
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function resolveHighlightLimit(value?: number | null): number {
  if (!Number.isFinite(value ?? null)) {
    return 10;
  }
  const numeric = Math.floor(value as number);
  return Math.max(0, numeric);
}

async function selectHighlightsFromChunks({
  chunks,
  chunkSummaries,
  segments,
  languageName,
  signal,
  operationId,
  maxHighlights = 10,
  progressCallback,
  startPercent = 0,
  endPercent = 5,
}: {
  chunks: string[];
  chunkSummaries: string[];
  segments: TranscriptSummarySegment[];
  languageName: string;
  signal: AbortSignal;
  operationId: string;
  maxHighlights?: number;
  progressCallback?: (progress: TranscriptSummaryProgress) => void;
  startPercent?: number;
  endPercent?: number;
}): Promise<TranscriptHighlight[]> {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }

  const total = chunks.length;
  const perChunkLimit = Math.max(1, Math.ceil(maxHighlights / total));
  const span = Math.max(0, endPercent - startPercent);
  const sanitizedSummaries = Array.isArray(chunkSummaries)
    ? chunkSummaries
    : new Array(total).fill('');
  const globalOutline = buildGlobalOutline(sanitizedSummaries);

  const highlightIds = new Map<string, string>();
  let highlightCounter = 0;
  const getHighlightId = (key: string): string => {
    const existing = highlightIds.get(key);
    if (existing) return existing;
    const nextId = `${operationId}-hl-${++highlightCounter}`;
    highlightIds.set(key, nextId);
    return nextId;
  };

  const seen = new Map<string, TranscriptHighlight>();

  for (let i = 0; i < total; i++) {
    if (signal.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    const chunk = chunks[i];
    if (!chunk.trim()) continue;

    const percent = startPercent + (span * i) / total;
    progressCallback?.({
      percent,
      stage: `Selecting highlights section ${i + 1} of ${total}`,
      current: i + 1,
      total,
    });

    let chunkHighlights: TranscriptHighlight[] = [];
    try {
      chunkHighlights = await proposeHighlightsForChunk({
        chunkText: chunk,
        chunkIndex: i,
        chunkCount: total,
        chunkSummary: sanitizedSummaries[i] ?? '',
        globalOutline,
        languageName,
        signal,
        operationId,
        perChunkLimit,
      });
    } catch (err) {
      // Log but continue; a single chunk failure shouldn't abort the entire summary
      console.warn(
        `[${operationId}] highlight selection failed for chunk ${i + 1}:`,
        err
      );
      continue;
    }

    for (const h of chunkHighlights) {
      const start = Number(h.start);
      const end = Number(h.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (end - start < 2) continue;
      const key = `${Math.round(start * 1000)}-${Math.round(end * 1000)}`;
      const baseHighlight: TranscriptHighlight = {
        start: Math.max(0, start),
        end: Math.max(0, end),
        title: h.title,
        description: h.description,
        score: h.score,
        confidence: h.confidence,
        category: h.category,
        justification: h.justification,
        id: getHighlightId(key),
      };

      if (seen.has(key)) {
        const existing = seen.get(key)!;
        if (getHighlightScore(baseHighlight) > getHighlightScore(existing)) {
          seen.set(key, { ...existing, ...baseHighlight, id: existing.id });
        }
      } else {
        seen.set(key, baseHighlight);
      }
    }

    const refinedCandidates = refineAndScoreHighlights({
      highlights: Array.from(seen.values()),
      segments,
    });
    const ranked = rankHighlights(refinedCandidates, maxHighlights);
    progressCallback?.({
      percent: startPercent + (span * (i + 1)) / total,
      stage: `Section ${i + 1} highlights proposed`,
      current: i + 1,
      total,
      partialHighlights: ranked,
    });
  }

  let final = rankHighlights(
    refineAndScoreHighlights({
      highlights: Array.from(seen.values()),
      segments,
    }),
    maxHighlights
  );

  if (final.length === 0) {
    final = buildFallbackHighlightsFromSegments({
      segments,
      maxHighlights,
    });
  }

  progressCallback?.({
    percent: endPercent,
    stage:
      final.length > 0
        ? `Selected ${final.length} highlights`
        : 'No highlight candidates found',
    partialHighlights: final,
  });

  return final;
}

async function proposeHighlightsForChunk({
  chunkText,
  chunkIndex,
  chunkCount,
  chunkSummary,
  globalOutline,
  languageName,
  signal,
  operationId,
  perChunkLimit,
}: {
  chunkText: string;
  chunkIndex: number;
  chunkCount: number;
  chunkSummary: string;
  globalOutline: string;
  languageName: string;
  signal: AbortSignal;
  operationId: string;
  perChunkLimit: number;
}): Promise<TranscriptHighlight[]> {
  const limit = Math.max(1, Math.min(5, perChunkLimit));

  const system = `You are a senior editorial producer who selects short-form video moments that feel natural and gripping. Always respond in ${languageName}. Output strict JSON that matches the requested schema.`;

  const user = `Review section ${chunkIndex + 1} of ${chunkCount} from a larger recording. Recommend up to ${limit} short clips only if they will play smoothly as isolated highlights. Follow these principles:
- Keep clips entirely within this section's timestamps and anchor them at natural sentence boundaries.
- Ideal runtime is 12–45 seconds. Never return under 6 seconds or over 75 seconds.
- Focus on singular, high-impact beats: turning points, memorable quotes, emotional reactions, or concrete advice.
- Add a short title and description in ${languageName} with plain text (no markdown, emojis, or formatting).
- Provide a confidence score between 0 and 1, a concise category label (e.g., "reveal", "advice", "humor"), and a one-sentence justification referencing transcript evidence.
- If this section lacks a strong candidate, respond with an empty highlights array.

Global outline of the recording:
${globalOutline}

Focused notes for this section:
${chunkSummary || '(no notes provided)'}

Transcript section (${languageName}):
${chunkText}

Return STRICT JSON ONLY (no markdown) using this shape:
{
  "highlights": [
    {
      "start": 123.0,
      "end": 141.5,
      "title": "...",
      "description": "...",
      "confidence": 0.82,
      "category": "...",
      "justification": "..."
    }
  ]
}`;

  const content = await callAIModel({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    model: AI_MODELS.GPT,
    reasoning: { effort: 'medium' },
    signal,
    operationId,
  });

  const parsed = safeParseHighlights(content);
  return parsed.map(h => ({
    start: normalizeTimestamp(h.start) ?? NaN,
    end: normalizeTimestamp(h.end) ?? NaN,
    title: typeof h.title === 'string' ? h.title : undefined,
    description: typeof h.description === 'string' ? h.description : undefined,
    score: typeof h.score === 'number' ? h.score : undefined,
    confidence: typeof h.confidence === 'number' ? h.confidence : undefined,
    category: typeof h.category === 'string' ? h.category : undefined,
    justification:
      typeof h.justification === 'string' ? h.justification : undefined,
  }));
}

function buildGlobalOutline(summaries: string[]): string {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return '(outline unavailable)';
  }
  return summaries
    .map((summary, idx) => {
      const clean =
        typeof summary === 'string' ? summary.replace(/\s+/g, ' ').trim() : '';
      if (!clean) {
        return `Section ${idx + 1}: (no summary available)`;
      }
      return `Section ${idx + 1}: ${clean}`;
    })
    .join('\n');
}

function refineAndScoreHighlights({
  highlights,
  segments,
  leadPadding = 0.6,
  tailPadding = 0.75,
}: {
  highlights: TranscriptHighlight[];
  segments: TranscriptSummarySegment[];
  leadPadding?: number;
  tailPadding?: number;
}): TranscriptHighlight[] {
  if (!Array.isArray(highlights) || highlights.length === 0) {
    return [];
  }

  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);
  const refined: TranscriptHighlight[] = [];
  const minDuration = 3;
  const maxDuration = 90;
  const minScoreThreshold = 0.2;
  let fallbackCandidate: TranscriptHighlight | null = null;

  for (const raw of highlights) {
    const rawStart = normalizeTimestamp(raw.start) ?? NaN;
    const rawEnd = normalizeTimestamp(raw.end) ?? NaN;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    if (rawEnd <= rawStart) continue;

    const overlapSegments = findOverlappingSegments(
      sortedSegments,
      rawStart,
      rawEnd
    );
    if (overlapSegments.length === 0) {
      continue;
    }

    const firstSeg = overlapSegments[0];
    const lastSeg = overlapSegments[overlapSegments.length - 1];
    const snappedStart = Math.max(0, firstSeg.start);
    const snappedEnd = Math.max(snappedStart + 0.5, lastSeg.end);

    const paddedStart = Math.max(0, snappedStart - leadPadding);
    let paddedEnd = Math.max(paddedStart + 2, snappedEnd + tailPadding);

    if (paddedEnd - paddedStart < minDuration) {
      paddedEnd = paddedStart + minDuration;
    }
    if (paddedEnd - paddedStart > maxDuration) {
      paddedEnd = paddedStart + maxDuration;
    }

    const duration = paddedEnd - paddedStart;

    const normalizedConfidence = normalizeConfidenceValue(
      Number.isFinite(raw.confidence ?? null)
        ? (raw.confidence as number)
        : Number.isFinite(raw.score ?? null)
          ? (raw.score as number)
          : undefined
    );

    const durationScore =
      duration <= 0
        ? 0
        : duration >= 12 && duration <= 45
          ? 1
          : duration < 12
            ? clamp(duration / 12, 0, 1)
            : clamp(1 - (duration - 45) / 35, 0, 1);

    const coverageScore = clamp(overlapSegments.length / 3, 0, 1);
    const combinedScore = clamp(
      normalizedConfidence * 0.5 + durationScore * 0.3 + coverageScore * 0.2,
      0,
      1
    );

    const scoredHighlight: TranscriptHighlight = {
      ...raw,
      start: Number(paddedStart.toFixed(3)),
      end: Number(paddedEnd.toFixed(3)),
      confidence: normalizedConfidence,
      score: Number((combinedScore * 100).toFixed(2)),
      title: raw.title?.trim() || raw.title,
      description: raw.description?.trim() || raw.description,
      justification: raw.justification?.trim() || raw.justification,
      category: raw.category?.trim() || raw.category,
      id: raw.id,
    };

    if (combinedScore < minScoreThreshold) {
      if (
        !fallbackCandidate ||
        getHighlightScore(scoredHighlight) >
          getHighlightScore(fallbackCandidate)
      ) {
        fallbackCandidate = scoredHighlight;
      }
      continue;
    }

    refined.push(scoredHighlight);
  }

  if (refined.length === 0 && fallbackCandidate) {
    refined.push(fallbackCandidate);
  }

  return dedupeHighlights(refined);
}

function findOverlappingSegments(
  segments: TranscriptSummarySegment[],
  start: number,
  end: number
): TranscriptSummarySegment[] {
  const overlaps: TranscriptSummarySegment[] = [];
  for (const seg of segments) {
    if (seg.end <= start) continue;
    if (seg.start >= end) break;
    overlaps.push(seg);
  }
  return overlaps;
}

function dedupeHighlights(
  highlights: TranscriptHighlight[]
): TranscriptHighlight[] {
  if (!Array.isArray(highlights) || highlights.length === 0) return [];
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const result: TranscriptHighlight[] = [];

  for (const current of sorted) {
    const last = result[result.length - 1];
    if (!last) {
      result.push(current);
      continue;
    }

    const overlap =
      Math.min(last.end, current.end) - Math.max(last.start, current.start);
    const shortest = Math.min(
      last.end - last.start,
      current.end - current.start
    );

    if (overlap > 0 && overlap / Math.max(shortest, 1) >= 0.6) {
      const lastScore = getHighlightScore(last);
      const currentScore = getHighlightScore(current);
      if (currentScore > lastScore) {
        result[result.length - 1] = current;
      }
    } else {
      result.push(current);
    }
  }

  return result;
}

function normalizeConfidenceValue(value?: number): number {
  if (!Number.isFinite(value ?? null)) return 0.5;
  const numeric = value as number;
  if (numeric > 1) {
    return clamp(numeric / 100, 0, 1);
  }
  return clamp(numeric, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rankHighlights(
  highlights: TranscriptHighlight[],
  maxHighlights: number
): TranscriptHighlight[] {
  const sorted = [...highlights].sort((lhs, rhs) => {
    const scoreA = getHighlightScore(lhs);
    const scoreB = getHighlightScore(rhs);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    const lengthA = lhs.end - lhs.start;
    const lengthB = rhs.end - rhs.start;
    if (lengthA !== lengthB) {
      return lengthB - lengthA;
    }
    return lhs.start - rhs.start;
  });
  if (maxHighlights <= 0) {
    return [];
  }
  return sorted.slice(0, Math.min(maxHighlights, sorted.length));
}

function getHighlightScore(highlight: TranscriptHighlight | undefined): number {
  if (!highlight) return 0;
  if (Number.isFinite(highlight.score ?? null)) {
    return highlight.score as number;
  }
  if (Number.isFinite(highlight.confidence ?? null)) {
    return (highlight.confidence as number) * 100;
  }
  return 0;
}

function safeParseHighlights(text: string): Array<{
  start?: number | string | null;
  end?: number | string | null;
  title?: string;
  description?: string;
  score?: number;
  confidence?: number;
  category?: string;
  justification?: string;
}> {
  try {
    // Try direct JSON parse
    const obj = JSON.parse(text);
    const arr = Array.isArray(obj?.highlights) ? obj.highlights : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    // Fallback: extract the first JSON object substring
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      try {
        const obj = JSON.parse(text.slice(first, last + 1));
        const arr = Array.isArray(obj?.highlights) ? obj.highlights : [];
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  let trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) {
    return direct;
  }
  if (trimmed.includes('-') || /(?:\sto\s)/i.test(trimmed)) {
    const match = trimmed.match(/([0-9:.]+)\s*(?:-|–|to)\s*[0-9:.]+/i);
    if (match && match[1]) {
      trimmed = match[1].trim();
    }
  }
  if (trimmed.includes(':')) {
    const colonMatch = trimmed.match(/(\d{1,3}:)?\d{1,2}:\d{1,2}(?:\.\d+)?/);
    if (colonMatch && colonMatch[0]) {
      trimmed = colonMatch[0];
    }
    const rawParts = trimmed.split(':');
    if (rawParts.length >= 2 && rawParts.length <= 3) {
      const parts = rawParts.map(part => {
        const numericPart = Number(part);
        return Number.isFinite(numericPart) ? numericPart : NaN;
      });
      if (parts.some(num => Number.isNaN(num))) {
        return null;
      }
      while (parts.length < 3) {
        parts.unshift(0);
      }
      const [hours, minutes, seconds] = parts;
      return hours * 3600 + minutes * 60 + seconds;
    }
  }
  return null;
}

function buildFallbackHighlightsFromSegments({
  segments,
  maxHighlights,
}: {
  segments: TranscriptSummarySegment[];
  maxHighlights: number;
}): TranscriptHighlight[] {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  const totalDuration = segments.reduce((max, seg) => {
    const end = Number(seg?.end);
    if (!Number.isFinite(end)) return max;
    return Math.max(max, end);
  }, 0);

  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    return [];
  }

  const desired = Number.isFinite(maxHighlights)
    ? Math.max(1, Math.min(Math.floor(maxHighlights), 5))
    : 3;
  const count = Math.min(desired, segments.length);
  const bucketSize = totalDuration / count;
  const results: TranscriptHighlight[] = [];

  for (let i = 0; i < count; i++) {
    const bucketStart = i * bucketSize;
    const bucketEnd =
      i === count - 1 ? totalDuration : bucketStart + bucketSize;
    const bucketSegments = segments.filter(
      seg => seg.end > bucketStart && seg.start < bucketEnd
    );
    if (bucketSegments.length === 0) continue;

    const pivot = bucketSegments.reduce((best, seg) => {
      const bestScore = best?.text?.length ?? 0;
      const segScore = seg?.text?.length ?? 0;
      if (!best) return seg;
      return segScore > bestScore ? seg : best;
    }, bucketSegments[0]);

    if (!pivot) continue;
    const clipStart = Math.max(0, pivot.start - 1.5);
    const clipEnd = Math.min(
      totalDuration,
      Math.max(pivot.end + 4, clipStart + 3)
    );

    results.push({
      id: `fallback-${i + 1}`,
      start: Number(clipStart.toFixed(3)),
      end: Number(clipEnd.toFixed(3)),
      title: `Key moment ${i + 1}`,
      description: pivot.text,
      confidence: 0.2,
      category: 'context',
      justification:
        'Auto-selected because highlight detection returned no confident candidates.',
    });
  }

  return results;
}
