import { callAIModel } from './ai-client.js';
import type {
  TranscriptSummarySegment,
  TranscriptSummaryProgress,
  TranscriptHighlight,
} from '@shared-types/app';

interface GenerateTranscriptSummaryOptions {
  segments: TranscriptSummarySegment[];
  targetLanguage: string;
  signal: AbortSignal;
  operationId: string;
  progressCallback?: (progress: TranscriptSummaryProgress) => void;
}

interface GenerateTranscriptSummaryResult {
  summary: string;
  highlights: TranscriptHighlight[];
}

const MAX_CHARS_PER_CHUNK = 7_500;

export async function generateTranscriptSummary({
  segments,
  targetLanguage,
  signal,
  operationId,
  progressCallback,
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
    progressCallback?.({
      percent: 60,
      stage: 'Section 1 of 1 summarized',
      partialSummary: aggregatedDraft,
    });

    const highlights = await selectHighlightsFromChunks({
      chunks,
      languageName,
      signal,
      operationId,
      maxHighlights: 10,
      progressCallback,
      startPercent: 70,
      endPercent: 90,
    });

    progressCallback?.({
      percent: 90,
      stage: 'Synthesizing comprehensive summary',
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
    });

    return { summary: finalSummary, highlights };
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
    const completePercent = 20 + perChunkProgress * (i + 1);
    progressCallback?.({
      percent: completePercent,
      stage: `Section ${i + 1} of ${chunks.length} summarized`,
      partialSummary: aggregatedDraft,
    });
  }

  if (signal.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }

  progressCallback?.({
    percent: 90,
    stage: 'Synthesizing comprehensive summary',
  });

  const synthesis = await synthesizeFromChunkSummaries({
    chunkSummaries,
    languageName,
    signal,
    operationId,
  });

  const finalSummary = synthesis.trim();
  const highlights = await selectHighlightsFromChunks({
    chunks,
    languageName,
    signal,
    operationId,
    maxHighlights: 10,
    progressCallback,
    startPercent: 92,
    endPercent: 98,
  });
  progressCallback?.({
    percent: 100,
    stage: 'Summary ready',
    partialSummary: finalSummary,
    partialHighlights: highlights,
  });

  return { summary: finalSummary, highlights };
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
  const systemPrompt = `You are an expert note-taker shaping transcript slices into vibrant, social-media-ready story beats. Always respond in ${languageName}.`;

  const userPrompt = `This is section ${chunkIndex + 1} of ${chunkCount} from a long transcript. Produce punchy notes in ${languageName} that will later become a shareable thread. Follow these rules:

- Start with one short line that pairs an expressive emoji with a localized section title.
- Provide 3–6 Markdown bullets. Keep each bullet to at most two sentences and under roughly 30 words.
- Only use timestamps when needed and always place them at the END inside parentheses, e.g., (00:01:34–00:02:10) or (00:08:42). Never use square brackets and never lead with the timestamp.
- Bold key phrases to help skimmers, keep the tone energetic and factual, and translate every heading or connector into ${languageName}.
- Capture moments, motivations, emotional turns, data points, and notable quotes that matter in this slice.

Transcript section ${chunkIndex + 1}:
${chunkText}`;

  const content = await callAIModel({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    model: 'gpt-5',
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
  const systemPrompt = `You are an experienced analyst who assembles irresistible social-media-ready summaries. Always respond in ${languageName}.`;

  const notes = chunkSummaries
    .map((summary, idx) => `Section ${idx + 1} notes:\n${summary}`)
    .join('\n\n');

  const userPrompt = `Blend the section notes into a social-media-optimized summary in ${languageName}. Output Markdown the user can paste straight into a thread or post. Follow this structure:

1. <emoji + localized title for "Executive Overview">
   - Two or three short bullets that hook the reader. Insert timestamps only when needed and always at the end in parentheses.
2. <emoji + localized title for "Detailed Timeline">
   - Chronological bullets with bold lead words. Stay under ~30 words per bullet, place timestamps at the end in parentheses, never use square brackets, and never begin a line with a timestamp.
3. <emoji + localized title for "Insights & Analysis">
   - Bullets highlighting themes, motivations, tensions, or lessons. Use timestamps only when calling out a precise moment and keep them at the end in parentheses.
4. <emoji + localized title for "Action Items / Recommendations">
   - Actionable steps, safeguards, or best practices implied by the story. Adapt if explicit actions are absent.
5. <emoji + localized title for "Notable Quotes or Highlights">
   - Quote-style bullets with attribution when possible, each finishing with its timestamp in parentheses.

Final line: add 2–4 short hashtags (no punctuation) in ${languageName} or widely used transliterations, separated by spaces.

Extra guidance:
- Translate every heading, connector, and descriptive phrase into ${languageName}; avoid English unless globally standard.
- Keep the tone punchy and ready for social sharing; remove repetition.
- Absolutely avoid square brackets for timestamps; always use parentheses at the end.
- Aim for concise, high-impact sentences sized for social feeds.

Section notes:
${notes}`;

  const content = await callAIModel({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    model: 'gpt-5',
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

async function selectHighlightsFromChunks({
  chunks,
  languageName,
  signal,
  operationId,
  maxHighlights = 10,
  progressCallback,
  startPercent = 0,
  endPercent = 5,
}: {
  chunks: string[];
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

  const candidates: TranscriptHighlight[] = [];
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
        };
        seen.set(key, sanitized);
      }
    }

    candidates.splice(0, candidates.length, ...seen.values());
    progressCallback?.({
      percent: startPercent + (span * (i + 1)) / total,
      stage: `Section ${i + 1} highlights proposed`,
      current: i + 1,
      total,
      partialHighlights: rankHighlights(candidates, maxHighlights),
    });
  }

  const final = rankHighlights(Array.from(seen.values()), maxHighlights);
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
  languageName,
  signal,
  operationId,
  perChunkLimit,
}: {
  chunkText: string;
  chunkIndex: number;
  chunkCount: number;
  languageName: string;
  signal: AbortSignal;
  operationId: string;
  perChunkLimit: number;
}): Promise<TranscriptHighlight[]> {
  const limit = Math.max(1, Math.min(5, perChunkLimit));

  const system = `You are an expert content editor who pinpoints the most electrifying, emotional, or shareable short clips inside transcripts. Always respond in strict JSON matching the requested schema.`;

  const user = `This is section ${chunkIndex + 1} of ${chunkCount} from a longer transcript. Identify up to ${limit} short highlight clips within this section only. Each clip must:
- Stay entirely within this section's timestamps.
- Feel self-contained and compelling (punchline, reveal, powerful quote, emotional beat, etc.).
- Prefer length 10–60 seconds, minimum 2 seconds.
- Provide absolute start and end times in seconds.

Return STRICT JSON ONLY (no markdown) of the form:
{
  "highlights": [
    {"start": 123.0, "end": 141.5, "title": "...", "description": "...", "score": 0.0},
    ...
  ]
}

Transcript section (${languageName}):\n${chunkText}`;

  const content = await callAIModel({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    model: 'gpt-5',
    reasoning: { effort: 'medium' },
    signal,
    operationId,
  });

  const parsed = safeParseHighlights(content);
  return parsed.map(h => ({
    start: Number(h.start),
    end: Number(h.end),
    title: typeof h.title === 'string' ? h.title : undefined,
    description:
      typeof h.description === 'string' ? h.description : undefined,
    score: typeof h.score === 'number' ? h.score : undefined,
  }));
}

function pickBetterHighlight(
  a: TranscriptHighlight,
  b: TranscriptHighlight
): TranscriptHighlight {
  const scoreA = Number.isFinite(a.score ?? null) ? (a.score as number) : -Infinity;
  const scoreB = Number.isFinite(b.score ?? null) ? (b.score as number) : -Infinity;
  if (scoreB > scoreA) return { ...a, ...b };
  return a;
}

function rankHighlights(
  highlights: TranscriptHighlight[],
  maxHighlights: number
): TranscriptHighlight[] {
  const sorted = [...highlights].sort((lhs, rhs) => {
    const scoreA = Number.isFinite(lhs.score ?? null)
      ? (lhs.score as number)
      : 0;
    const scoreB = Number.isFinite(rhs.score ?? null)
      ? (rhs.score as number)
      : 0;
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    return lhs.start - rhs.start;
  });
  return sorted.slice(0, Math.max(1, maxHighlights));
}

function safeParseHighlights(text: string): Array<{
  start: number;
  end: number;
  title?: string;
  description?: string;
  score?: number;
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
