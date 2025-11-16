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
  maxHighlights?: number;
}

interface GenerateTranscriptSummaryResult {
  summary: string;
  highlights: TranscriptHighlight[];
  sections: TranscriptSummarySection[];
}

const MAX_CHARS_PER_CHUNK = 7_500;

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
  maxHighlights,
}: GenerateTranscriptSummaryOptions): Promise<GenerateTranscriptSummaryResult> {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('No transcript segments available for summary');
  }

  const cleanedSegments = segments
    .filter(seg => !!seg && typeof seg.text === 'string')
    .map(seg => ({
      start: typeof seg.start === 'number' ? seg.start : 0,
      end: typeof seg.end === 'number' ? seg.end : seg.start,
      text: seg.text.trim(),
    }))
    .filter(seg => seg.text.length > 0);

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

  // Small transcripts reuse the multi-stage path with a single section
  if (chunks.length === 1) {
    progressCallback?.({ percent: 20, stage: 'Summarizing section 1 of 1' });
    const chunkNote = await summarizeChunk({
      chunkText: chunks[0],
      chunkIndex: 0,
      chunkCount: 1,
      languageName,
      signal,
      operationId,
    });

    const aggregatedDraft = formatChunkDrafts([chunkNote]);
    const sectionNotes = createSectionSummaries([chunkNote]);
    progressCallback?.({
      percent: 60,
      stage: 'Section 1 of 1 summarized',
      partialSummary: aggregatedDraft,
      partialSections: sectionNotes,
    });

    const highlights =
      highlightLimit > 0
        ? await selectHighlightsFromChunks({
            chunks,
            chunkSummaries: [chunkNote],
            segments: cleanedSegments,
            languageName,
            signal,
            operationId,
            maxHighlights: highlightLimit,
            progressCallback,
            startPercent: 70,
            endPercent: 90,
          })
        : [];

    progressCallback?.({
      percent: 90,
      stage: 'Synthesizing comprehensive summary',
      partialSections: sectionNotes,
    });

    const finalSummary = await synthesizeFromChunkSummaries({
      chunkSummaries: [chunkNote],
      languageName,
      signal,
      operationId,
    });

    progressCallback?.({
      percent: 100,
      stage: 'Summary ready',
      partialSummary: finalSummary,
      partialHighlights: highlights,
      partialSections: sectionNotes,
    });

    return { summary: finalSummary, highlights, sections: sectionNotes };
  }

  const chunkSummaries: string[] = [];
  const perChunkProgress = 70 / chunks.length;

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
    chunkSummaries.push(summary.trim());

    const aggregatedDraft = formatChunkDrafts(chunkSummaries);
    const partialSections = createSectionSummaries(chunkSummaries);
    const completePercent = 20 + perChunkProgress * (i + 1);
    progressCallback?.({
      percent: completePercent,
      stage: `Section ${i + 1} of ${chunks.length} summarized`,
      partialSummary: aggregatedDraft,
      partialSections,
    });
  }

  if (signal.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  const sectionSummaries = createSectionSummaries(chunkSummaries);

  progressCallback?.({
    percent: 90,
    stage: 'Synthesizing comprehensive summary',
    partialSections: sectionSummaries,
  });

  const synthesis = await synthesizeFromChunkSummaries({
    chunkSummaries,
    languageName,
    signal,
    operationId,
  });

  const finalSummary = synthesis.trim();
  const highlights =
    highlightLimit > 0
      ? await selectHighlightsFromChunks({
          chunks,
          chunkSummaries,
          segments: cleanedSegments,
          languageName,
          signal,
          operationId,
          maxHighlights: highlightLimit,
          progressCallback,
          startPercent: 92,
          endPercent: 98,
        })
      : [];
  progressCallback?.({
    percent: 100,
    stage: 'Summary ready',
    partialSummary: finalSummary,
    partialHighlights: highlights,
    partialSections: sectionSummaries,
  });

  return { summary: finalSummary, highlights, sections: sectionSummaries };
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

async function synthesizeFromChunkSummaries({
  chunkSummaries,
  languageName,
  signal,
  operationId,
}: {
  chunkSummaries: string[];
  languageName: string;
  signal: AbortSignal;
  operationId: string;
}): Promise<string> {
  const systemPrompt = `You are an experienced academic writer who crafts comprehensive introductions for audiovisual sources used in college assignments. Always respond in ${languageName} with a formal, well-structured tone and plain-text presentation.`;

  const notes = chunkSummaries
    .map((summary, idx) => `Section ${idx + 1} notes:\n${summary}`)
    .join('\n\n');

  const userPrompt = `Blend the section notes into a cohesive introductory overview in ${languageName} as though it were the opening section of a college assignment describing this video source. Adhere to the following requirements:

- Produce 2–3 paragraphs of continuous prose with plain-text formatting. Paragraph one should situate the video (topic, speakers, context, platform, production details). Paragraph two should outline the major themes, sequence of ideas, and analytical framing. Add a third paragraph only if necessary to discuss methodology, intended audience, or broader significance.
- Integrate timestamps sparingly for pivotal moments, phrasing them inline as "at 00:12:45" or "between 00:08:30 and 00:09:05". Do not wrap times in parentheses or brackets, and never open a sentence with a timestamp.
- Maintain a formal, third-person tone. Avoid emojis, exclamations, hashtags, rhetorical questions, or typographic decorations.
- Close with a single sentence that translates "Keywords" into ${languageName} and lists 4–6 thematically important terms separated by commas (e.g., "Palabras clave: término1, término2").
- Ensure the narrative removes redundancy from the notes, emphasizes continuity, and transitions smoothly between ideas.

Section notes:
${notes}`;

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

function formatChunkDrafts(drafts: string[]): string {
  return drafts.map((text, idx) => `Section ${idx + 1}\n${text}`).join('\n\n');
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
      if (seen.has(key)) {
        const existing = seen.get(key)!;
        const better = pickBetterHighlight(existing, h);
        seen.set(key, better);
      } else {
        const sanitized: TranscriptHighlight = {
          start: Math.max(0, start),
          end: Math.max(0, end),
          title: h.title,
          description: h.description,
          score: h.score,
          confidence: h.confidence,
          category: h.category,
          justification: h.justification,
        };
        seen.set(key, sanitized);
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

  const final = rankHighlights(
    refineAndScoreHighlights({
      highlights: Array.from(seen.values()),
      segments,
    }),
    maxHighlights
  );
  progressCallback?.({
    percent: endPercent,
    stage: `Selected ${final.length} highlights`,
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
    start: Number(h.start),
    end: Number(h.end),
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
  const minDuration = 6;
  const maxDuration = 90;

  for (const raw of highlights) {
    const rawStart = Number(raw.start ?? NaN);
    const rawEnd = Number(raw.end ?? NaN);
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
    const paddedEnd = snappedEnd + tailPadding;
    const duration = paddedEnd - paddedStart;

    if (duration < minDuration || duration > maxDuration) {
      continue;
    }

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

    if (combinedScore < 0.35) {
      continue;
    }

    refined.push({
      ...raw,
      start: Number(paddedStart.toFixed(3)),
      end: Number(paddedEnd.toFixed(3)),
      confidence: normalizedConfidence,
      score: Number((combinedScore * 100).toFixed(2)),
      title: raw.title?.trim() || raw.title,
      description: raw.description?.trim() || raw.description,
      justification: raw.justification?.trim() || raw.justification,
      category: raw.category?.trim() || raw.category,
    });
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

function pickBetterHighlight(
  a: TranscriptHighlight,
  b: TranscriptHighlight
): TranscriptHighlight {
  const scoreA = getHighlightScore(a);
  const scoreB = getHighlightScore(b);
  if (scoreB > scoreA) return { ...a, ...b };
  return a;
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
  start: number;
  end: number;
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
