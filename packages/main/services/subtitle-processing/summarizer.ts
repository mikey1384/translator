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
}: GenerateTranscriptSummaryOptions): Promise<GenerateTranscriptSummaryResult> {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('No transcript segments available for summary');
  }

  const cleanedSegments = sanitizeSegments(segments);

  if (cleanedSegments.length === 0) {
    throw new Error('Transcript is empty after filtering silent segments');
  }

  const languageName = formatLanguage(targetLanguage);

  progressCallback?.({ percent: 5, stage: 'Preparing transcript slices' });

  const chunks = buildChunks(cleanedSegments);

  if (signal.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  const chunkSummaries: string[] = [];
  const perChunkProgress = 70 / chunks.length;
  let runningSummary = '';
  const highlightTracker =
    includeHighlights && chunks.length > 0
      ? createHighlightTracker({
          segments: cleanedSegments,
          operationId,
        })
      : null;
  const highlightOutlineSource =
    highlightTracker !== null ? new Array(chunks.length).fill('') : null;
  let latestHighlights: TranscriptHighlight[] = [];

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
    if (highlightOutlineSource) {
      highlightOutlineSource[i] = trimmedSummary;
    }

    runningSummary = await mergeIntoRunningSummary({
      existingSummary: runningSummary,
      newSectionSummary: trimmedSummary,
      languageName,
      signal,
      operationId,
    });

    if (highlightTracker && highlightOutlineSource) {
      const globalOutline = buildGlobalOutline(highlightOutlineSource);
      try {
        latestHighlights = await processHighlightChunk({
          tracker: highlightTracker,
          chunkText,
          chunkIndex: i,
          chunkCount: chunks.length,
          chunkSummary: trimmedSummary,
          globalOutline,
          languageName,
          signal,
          operationId,
        });
      } catch (err) {
        console.warn(
          `[${operationId}] highlight selection failed for chunk ${i + 1}:`,
          err
        );
        const message =
          err instanceof Error ? err.message : 'Highlight selection failed';
        progressCallback?.({
          percent: startPercent,
          stage: 'highlight-selection-error',
          error: message,
        });
      }
    }

    const partialSections = createSectionSummaries(chunkSummaries);
    const completePercent = 20 + perChunkProgress * (i + 1);
    progressCallback?.({
      percent: completePercent,
      stage: `Section ${i + 1} of ${chunks.length} summarized`,
      partialSummary: runningSummary,
      partialSections,
      ...(highlightTracker ? { partialHighlights: latestHighlights } : {}),
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
    ...(highlightTracker ? { partialHighlights: latestHighlights } : {}),
  });

  let highlights: TranscriptHighlight[] = [];
  if (highlightTracker) {
    try {
      highlights = finalizeHighlightTracker(highlightTracker);
      progressCallback?.({
        percent: 96,
        stage:
          highlights.length > 0
            ? `Selected ${highlights.length} highlights`
            : 'No highlight candidates found',
        partialHighlights: highlights,
      });
    } catch (highlightError) {
      progressCallback?.({
        percent: 96,
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

  const tracker = createHighlightTracker({
    segments: cleanedSegments,
    operationId,
  });
  const outlineSource = chunkSummaries.slice();
  const total = chunks.length;
  const highlightStart = mapPercent(60);
  const highlightEnd = mapPercent(95);
  const highlightSpan = Math.max(0, highlightEnd - highlightStart);
  let latestHighlights: TranscriptHighlight[] = [];

  for (let i = 0; i < total; i++) {
    if (signal.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }

    const chunk = chunks[i];
    if (!chunk.trim()) continue;

    const sectionStart = highlightStart + (highlightSpan * i) / total;
    progressCallback?.({
      percent: sectionStart,
      stage: `Selecting highlights section ${i + 1} of ${total}`,
      current: i + 1,
      total,
    });

    try {
      const globalOutline = buildGlobalOutline(outlineSource);
      latestHighlights = await processHighlightChunk({
        tracker,
        chunkText: chunk,
        chunkIndex: i,
        chunkCount: total,
        chunkSummary: chunkSummaries[i] ?? '',
        globalOutline,
        languageName,
        signal,
        operationId,
      });
    } catch (err) {
      console.warn(
        `[${operationId}] highlight selection failed for chunk ${i + 1}:`,
        err
      );
      continue;
    }

    const sectionComplete = highlightStart + (highlightSpan * (i + 1)) / total;
    progressCallback?.({
      percent: sectionComplete,
      stage: `Section ${i + 1} highlights proposed`,
      current: i + 1,
      total,
      partialHighlights: latestHighlights,
    });
  }

  const finalHighlights = finalizeHighlightTracker(tracker);
  progressCallback?.({
    percent: mapPercent(100),
    stage:
      finalHighlights.length > 0
        ? `Selected ${finalHighlights.length} highlights`
        : 'No highlight candidates found',
    partialHighlights: finalHighlights,
    total: finalHighlights.length,
    current: finalHighlights.length,
  });

  return finalHighlights;
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

type HighlightTrackerState = {
  seen: Map<string, TranscriptHighlight>;
  highlightIds: Map<string, string>;
  nextId: number;
  segments: TranscriptSummarySegment[];
  latest: TranscriptHighlight[];
  operationId: string;
};

function createHighlightTracker({
  segments,
  operationId,
}: {
  segments: TranscriptSummarySegment[];
  operationId: string;
}): HighlightTrackerState {
  return {
    seen: new Map(),
    highlightIds: new Map(),
    nextId: 0,
    segments,
    latest: [],
    operationId,
  };
}

async function processHighlightChunk({
  tracker,
  chunkText,
  chunkIndex,
  chunkCount,
  chunkSummary,
  globalOutline,
  languageName,
  signal,
  operationId,
}: {
  tracker: HighlightTrackerState;
  chunkText: string;
  chunkIndex: number;
  chunkCount: number;
  chunkSummary: string;
  globalOutline: string;
  languageName: string;
  signal: AbortSignal;
  operationId: string;
}): Promise<TranscriptHighlight[]> {
  if (!chunkText.trim()) {
    return tracker.latest;
  }

  const chunkHighlights = await proposeHighlightsForChunk({
    chunkText,
    chunkIndex,
    chunkCount,
    chunkSummary,
    globalOutline,
    languageName,
    signal,
    operationId,
  });

  for (const h of chunkHighlights) {
    const start = Number(h.start);
    const end = Number(h.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end - start < 2) continue;
    const key = `${Math.round(start * 1000)}-${Math.round(end * 1000)}`;
    const highlightId = getHighlightTrackerId(tracker, key);
    const baseHighlight: TranscriptHighlight = {
      start: Math.max(0, start),
      end: Math.max(0, end),
      title: h.title,
      description: h.description,
      score: h.score,
      confidence: h.confidence,
      category: h.category,
      justification: h.justification,
      id: highlightId,
    };

    if (!tracker.seen.has(key)) {
      tracker.seen.set(key, baseHighlight);
    }
  }

  tracker.latest = Array.from(tracker.seen.values());

  return tracker.latest;
}

function finalizeHighlightTracker(
  tracker: HighlightTrackerState
): TranscriptHighlight[] {
  let final = Array.from(tracker.seen.values());

  if (final.length === 0) {
    final = buildFallbackHighlightsFromSegments({
      segments: tracker.segments,
    });
  }

  tracker.latest = final;
  return final;
}

function getHighlightTrackerId(
  tracker: HighlightTrackerState,
  key: string
): string {
  const existing = tracker.highlightIds.get(key);
  if (existing) return existing;
  const nextId = `${tracker.operationId}-hl-${++tracker.nextId}`;
  tracker.highlightIds.set(key, nextId);
  return nextId;
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
}: {
  chunkText: string;
  chunkIndex: number;
  chunkCount: number;
  chunkSummary: string;
  globalOutline: string;
  languageName: string;
  signal: AbortSignal;
  operationId: string;
}): Promise<TranscriptHighlight[]> {
  const system = `You are a senior editorial producer who selects short-form video moments that feel natural and gripping. Always respond in ${languageName}. Output strict JSON that matches the requested schema.`;

  const user = `Review section ${chunkIndex + 1} of ${chunkCount} from a larger recording. Recommend every short clip that will play smoothly as an isolated highlight. Follow these principles:
- Keep clips entirely within this section's timestamps and anchor them at natural sentence boundaries. Never borrow context from other sections.
- Favor runtimes between 15–40 seconds when possible. Runs outside 8–60 seconds should only be suggested if the storytelling payoff is unquestionably stronger. Never stretch a moment just to reach one minute.
- Prioritize beats that would perform well as YouTube-style shorts: hook the viewer within the opening seconds, stay tightly aligned with the promise implied by the title/description, and deliver an unmistakable payoff or quotable takeaway.
- Reject segments that feel tangential to the section's focus or that leave the final thought unresolved. Titles and descriptions must truthfully reflect what the viewer will see.
- Ensure the speaker completes their final clause before the clip ends. If the punchline or call-to-action continues into the next sentence, include it so the moment lands naturally.
- Add a short title and description in ${languageName} with plain text (no markdown, emojis, or formatting). Use the title for the hook and the description for context or a micro call-to-action.
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
}: {
  segments: TranscriptSummarySegment[];
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

  const estimatedCount = Math.max(1, Math.round(totalDuration / 90));
  const count = Math.min(segments.length, estimatedCount);
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
