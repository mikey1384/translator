import { callAIModel } from './ai-client.js';
import type {
  TranscriptSummarySegment,
  TranscriptSummaryProgress,
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

    return { summary: finalSummary };
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
  progressCallback?.({
    percent: 100,
    stage: 'Summary ready',
    partialSummary: finalSummary,
  });

  return { summary: finalSummary };
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
