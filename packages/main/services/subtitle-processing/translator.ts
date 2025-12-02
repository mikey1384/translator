import log from 'electron-log';
import { ReviewBatch } from './types.js';
import { callAIModel } from './ai-client.js';
import { TranslateBatchArgs } from '@shared-types/app';
import { AI_MODELS, ERROR_CODES } from '@shared/constants';
import {
  getActiveProviderForModel,
  prefersClaudeTranslation,
  prefersClaudeReview,
} from '../ai-provider.js';

/**
 * Determines which model to use for the draft/initial translation phase.
 * Uses getActiveProviderForModel() to properly check entitlements, keys, and toggles.
 * - If user prefers Claude and Anthropic BYO is fully active: Use Claude Sonnet 4.5
 * - If OpenAI BYO is fully active: Use GPT
 * - If only Anthropic BYO is active (no OpenAI): Use Claude Sonnet 4.5
 * - Otherwise: Use GPT (Stage5 credits)
 */
function getDraftModel(): { model: string } {
  const prefersClaude = prefersClaudeTranslation();

  // Check if Anthropic BYO is fully active (entitlement + key + toggle + master)
  const canUseAnthropicByo =
    getActiveProviderForModel(AI_MODELS.CLAUDE_SONNET) === 'anthropic';
  // Check if OpenAI BYO is fully active (entitlement + key + toggle + master)
  const canUseOpenAiByo = getActiveProviderForModel(AI_MODELS.GPT) === 'openai';

  log.debug(
    `[Draft] getDraftModel: canUseAnthropicByo=${canUseAnthropicByo}, canUseOpenAiByo=${canUseOpenAiByo}, prefersClaude=${prefersClaude}`
  );

  // If user explicitly prefers Claude and Anthropic BYO is fully active
  if (prefersClaude && canUseAnthropicByo) {
    log.debug(
      '[Draft] User prefers Claude and Anthropic BYO active - using Claude Sonnet'
    );
    return { model: AI_MODELS.CLAUDE_SONNET };
  }

  // If OpenAI BYO is active, use GPT
  if (canUseOpenAiByo) {
    log.debug('[Draft] Using GPT (BYO OpenAI)');
    return { model: AI_MODELS.GPT };
  }

  // If only Anthropic BYO is active (no OpenAI BYO), use Claude
  if (canUseAnthropicByo) {
    log.debug(
      '[Draft] No OpenAI BYO, Anthropic BYO active - using Claude Sonnet'
    );
    return { model: AI_MODELS.CLAUDE_SONNET };
  }

  // Default: GPT via Stage5
  log.debug('[Draft] No BYO active, using GPT (Stage5 credits)');
  return { model: AI_MODELS.GPT };
}

/**
 * Determines which model to use for the review phase.
 * Uses getActiveProviderForModel() to properly check entitlements, keys, and toggles.
 * Respects user's preference for Claude vs GPT review model.
 */
export function getReviewModel(): {
  model: string;
  reasoning?: { effort: 'high' };
} {
  // Check if Anthropic BYO is fully active (entitlement + key + toggle + master)
  const canUseAnthropicByo =
    getActiveProviderForModel(AI_MODELS.CLAUDE_OPUS) === 'anthropic';
  // Check if OpenAI BYO is fully active (entitlement + key + toggle + master)
  const canUseOpenAiByo = getActiveProviderForModel(AI_MODELS.GPT) === 'openai';
  // User preference: true = Claude Opus, false = GPT with high reasoning
  const prefersClaude = prefersClaudeReview();

  log.debug(
    `[Review] getReviewModel: canUseAnthropicByo=${canUseAnthropicByo}, canUseOpenAiByo=${canUseOpenAiByo}, prefersClaude=${prefersClaude}`
  );

  // If user prefers Claude and Anthropic BYO is available
  if (prefersClaude && canUseAnthropicByo) {
    log.debug('[Review] Using Claude Opus (BYO Anthropic, user preference)');
    return { model: AI_MODELS.CLAUDE_OPUS };
  }

  // If user prefers GPT and OpenAI BYO is available
  if (!prefersClaude && canUseOpenAiByo) {
    log.debug(
      '[Review] Using GPT-5.1 with high reasoning (BYO OpenAI, user preference)'
    );
    return { model: AI_MODELS.GPT, reasoning: { effort: 'high' } };
  }

  // Fallback: If user's preferred provider is not available, use what's available
  if (canUseAnthropicByo) {
    log.debug('[Review] Using Claude Opus (BYO Anthropic, fallback)');
    return { model: AI_MODELS.CLAUDE_OPUS };
  }

  if (canUseOpenAiByo) {
    log.debug(
      '[Review] Using GPT-5.1 with high reasoning (BYO OpenAI, fallback)'
    );
    return { model: AI_MODELS.GPT, reasoning: { effort: 'high' } };
  }

  // No BYO available: Use Stage5 credits based on preference
  if (prefersClaude) {
    log.debug('[Review] Using Claude Opus (Stage5 credits, user preference)');
    return { model: AI_MODELS.CLAUDE_OPUS };
  } else {
    log.debug(
      '[Review] Using GPT-5.1 with high reasoning (Stage5 credits, user preference)'
    );
    return { model: AI_MODELS.GPT, reasoning: { effort: 'high' } };
  }
}

const NETWORK_RETRY_BASE_MS = 5_000;
const NETWORK_RETRY_MAX_MS = 60_000;
const NETWORK_RETRY_LIMIT = 8;
const NETWORK_ERROR_HINTS = [
  'network',
  'fetch failed',
  'socket hang up',
  'enotfound',
  'eai_again',
  'econnreset',
  'enetunreach',
  'offline',
  'dns',
  'network timeout',
  'temporarily unavailable',
  'failed to fetch',
  'getaddrinfo',
];

function normaliseErrorMessage(error: any): string {
  if (!error) return '';
  const parts = [
    typeof error?.message === 'string' ? error.message : '',
    typeof error?.name === 'string' ? error.name : '',
    typeof (error?.cause as any)?.message === 'string'
      ? (error.cause as any).message
      : '',
    typeof (error?.cause as any)?.name === 'string'
      ? (error.cause as any).name
      : '',
    typeof error?.stack === 'string' ? error.stack : '',
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function isLikelyNetworkError(error: any): boolean {
  const msg = normaliseErrorMessage(error);
  if (!msg) return false;
  if (
    msg.includes(ERROR_CODES.INSUFFICIENT_CREDITS) ||
    msg.includes('invalid api key')
  ) {
    return false;
  }
  if (typeof error?.code === 'string') {
    const code = error.code.toLowerCase();
    if (
      [
        'enotfound',
        'eai_again',
        'econnreset',
        'enetunreach',
        'ehostunreach',
      ].includes(code)
    ) {
      return true;
    }
  }
  return NETWORK_ERROR_HINTS.some(hint => msg.includes(hint));
}

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Operation cancelled', 'AbortError'));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function waitForNetworkRetry(
  attempt: number,
  signal?: AbortSignal
): Promise<void> {
  const backoff =
    NETWORK_RETRY_BASE_MS * Math.pow(1.5, Math.max(0, attempt - 1));
  const delay = Math.min(NETWORK_RETRY_MAX_MS, Math.round(backoff));
  log.warn(
    `[Review] Network appears unavailable (attempt ${attempt}). Waiting ${delay}ms before retrying…`
  );
  await delayWithAbort(delay, signal);
}

function parseTranslatedResponse(translation: string, batch: any): any[] {
  log.info(`[parseTranslatedResponse] Parsing translation response`);

  // Split into non-empty trimmed lines
  const lines = (translation || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  // Accept several common formats for safety
  const matchers: Array<(s: string) => { id: number; text: string } | null> = [
    // @@SUB_LINE@@ 123: text
    (s: string) => {
      const m = s.match(/^@@SUB_LINE@@\s*(\d+)\s*:\s*([\s\S]*)$/);
      return m ? { id: Number(m[1]), text: (m[2] || '').trim() } : null;
    },
    // Line 123: text
    (s: string) => {
      const m = s.match(/^Line\s*(\d+)\s*[:-]\s*([\s\S]*)$/i);
      return m ? { id: Number(m[1]), text: (m[2] || '').trim() } : null;
    },
    // 123: text
    (s: string) => {
      const m = s.match(/^(\d+)\s*[:-]\s*([\s\S]*)$/);
      return m ? { id: Number(m[1]), text: (m[2] || '').trim() } : null;
    },
  ];

  const ordered: string[] = [];
  const byId = new Map<number, string>();
  for (const raw of lines) {
    let hit: { id: number; text: string } | null = null;
    for (const fn of matchers) {
      hit = fn(raw);
      if (hit) break;
    }
    if (hit) {
      const clean = hit.text.replace(/[\uFEFF\u200B]/g, '').trim();
      if (!byId.has(hit.id)) byId.set(hit.id, clean);
      ordered.push(clean);
    } else {
      // Fallback: treat plain line as next ordered entry
      ordered.push(raw);
    }
  }

  // Map each incoming segment to the best-available text
  const out = batch.segments.map((segment: any, idx: number) => {
    const absoluteIndex = batch.startIndex + idx + 1; // 1-based absolute index
    let txt: string | undefined = undefined;

    if (byId.has(absoluteIndex)) {
      txt = byId.get(absoluteIndex)!;
    } else if (ordered.length >= batch.segments.length) {
      // If counts align, take the entry at the same relative position
      txt = ordered[idx];
    }

    // Do NOT substitute original when missing; keep blanks so we can repair/fill later
    const cleanTxt = (txt ?? '').replace(/[\uFEFF\u200B]/g, '').trim();
    const finalText = cleanTxt; // may be '' if missing

    return {
      ...segment,
      translation: finalText,
    };
  });

  return out;
}

// Helper: parse an LLM response into both an id->text map and an ordered list
function parseIdAndOrdered(translation: string): {
  byId: Map<number, string>;
  ordered: string[];
} {
  const lines = (translation || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const matchers: Array<(s: string) => { id: number; text: string } | null> = [
    (s: string) => {
      const m = s.match(/^@@SUB_LINE@@\s*(\d+)\s*:\s*([\s\S]*)$/);
      return m ? { id: Number(m[1]), text: (m[2] || '').trim() } : null;
    },
    (s: string) => {
      const m = s.match(/^Line\s*(\d+)\s*[:-]\s*([\s\S]*)$/i);
      return m ? { id: Number(m[1]), text: (m[2] || '').trim() } : null;
    },
    (s: string) => {
      const m = s.match(/^(\d+)\s*[:-]\s*([\s\S]*)$/);
      return m ? { id: Number(m[1]), text: (m[2] || '').trim() } : null;
    },
  ];

  const ordered: string[] = [];
  const byId = new Map<number, string>();
  for (const raw of lines) {
    let hit: { id: number; text: string } | null = null;
    for (const fn of matchers) {
      hit = fn(raw);
      if (hit) break;
    }
    if (hit) {
      const clean = hit.text.replace(/[\uFEFF\u200B]/g, '').trim();
      if (!byId.has(hit.id)) byId.set(hit.id, clean);
      ordered.push(clean);
    } else {
      ordered.push(raw);
    }
  }
  return { byId, ordered };
}

export async function translateBatch({
  batch,
  targetLang,
  operationId,
  signal,
}: TranslateBatchArgs): Promise<any[]> {
  log.info(
    `[${operationId}] Starting translation batch: ${batch.startIndex}-${batch.endIndex}`
  );

  const MAX_RETRIES = 3;
  let retryCount = 0;
  const formatLine = (absIndex: number, text: string) =>
    `Line ${absIndex}: ${text}`;

  const beforeList = batch.contextBefore || [];
  const afterList = batch.contextAfter || [];
  const beforeCtx = beforeList
    .map((segment, i) =>
      formatLine(
        batch.startIndex - (beforeList.length - i) + 1,
        segment.original ?? ''
      )
    )
    .join('\n');
  const afterCtx = afterList
    .map((segment, i) =>
      formatLine(batch.endIndex + i + 1, segment.original ?? '')
    )
    .join('\n');

  const toTranslate = batch.segments
    .map((segment, idx) =>
      formatLine(batch.startIndex + idx + 1, segment.original ?? '')
    )
    .join('\n');

  const SYSTEM_PROMPT = `You are a subtitle translator. Output exactly ${
    batch.segments.length
  } lines, each formatted as @@SUB_LINE@@ <ABS_NUMBER>: <text>. Do not add any commentary, headers, or extra lines. Do not translate or alter any CTX sections.`;

  const combinedPrompt = `
You are a professional subtitle translator. Translate the following subtitles into natural, fluent ${targetLang}.

CONTEXT BEFORE (do not translate):
${beforeCtx || '(none)'}

SUBTITLES TO TRANSLATE:
${toTranslate}

CONTEXT AFTER (do not translate):
${afterCtx || '(none)'}

Instructions:
- Translate EACH listed line individually, preserving the line order.
- Never skip, omit, or merge lines.
- Always finish translating the given line and do NOT defer to the next line.
- If unsure, prefer literal over creative.
- Use a polite/formal register unless clearly conversational.

Output format (exactly ${batch.segments.length} lines):
- Prefix every line with "@@SUB_LINE@@ <ABS_NUMBER>: ".
  Example: @@SUB_LINE@@ ${batch.startIndex + 1}: <your translation here>
  Use the exact ABS_NUMBER shown above. No extra commentary.
`;

  while (retryCount < MAX_RETRIES) {
    try {
      const draftConfig = getDraftModel();
      log.info(
        `[${operationId}] Sending translation batch via callChatModel (model: ${draftConfig.model})`
      );
      const res = await callAIModel({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: combinedPrompt },
        ],
        model: draftConfig.model,
        signal,
        operationId,
        retryAttempts: MAX_RETRIES,
      });
      let translatedBatch = parseTranslatedResponse(res, batch);

      // Repair pass: if any translations are missing (''), request only those IDs
      const missing = translatedBatch
        .map((s, i) => ({ idx: i, abs: batch.startIndex + i + 1, seg: s }))
        .filter(x => !x.seg.translation || x.seg.translation.trim() === '');

      if (missing.length > 0) {
        const repairSystem = `You are a subtitle translator. Output exactly ${missing.length} lines, each formatted as @@SUB_LINE@@ <ABS_NUMBER>: <text>. No commentary or extra text.`;
        const missingList = missing
          .map(m => formatLine(m.abs, batch.segments[m.idx].original ?? ''))
          .join('\n');
        const repairPrompt = `
Translate ONLY the following lines into natural, fluent ${targetLang}. Do not include any other lines.

LINES TO TRANSLATE:
${missingList}

Output format (exactly ${missing.length} lines):
@@SUB_LINE@@ <ABS_NUMBER>: <translation>
Example: @@SUB_LINE@@ ${missing[0].abs}: <your translation>
`;

        try {
          const repairRes = await callAIModel({
            messages: [
              { role: 'system', content: repairSystem },
              { role: 'user', content: repairPrompt },
            ],
            model: draftConfig.model,
            signal,
            operationId,
            retryAttempts: 2,
          });
          // Parse repair results by ABS ids with ordered fallback
          const { byId: repairMap, ordered: repairOrdered } =
            parseIdAndOrdered(repairRes);
          translatedBatch = translatedBatch.map((s, i) => {
            const abs = batch.startIndex + i + 1;
            if (!s.translation || s.translation.trim() === '') {
              let fix = repairMap.get(abs);
              if (!fix) {
                const missingPos = missing.findIndex(m => m.idx === i);
                if (missingPos >= 0 && missingPos < repairOrdered.length) {
                  fix = (repairOrdered[missingPos] || '').trim();
                }
              }
              if (fix && fix.trim()) return { ...s, translation: fix.trim() };
            }
            return s;
          });
        } catch {
          log.warn(`[${operationId}] Repair pass failed or skipped.`);
        }
      }

      // Validate batch has some successful translations
      const emptyCount = translatedBatch.filter(
        (s: any) => !s.translation || s.translation.trim() === ''
      ).length;
      if (emptyCount === translatedBatch.length && translatedBatch.length > 0) {
        log.error(
          `[${operationId}] Translation batch returned all empty translations (${emptyCount}/${translatedBatch.length})`
        );
        throw new Error('Translation batch failed: all translations empty');
      } else if (emptyCount > translatedBatch.length * 0.5) {
        log.warn(
          `[${operationId}] Translation batch has many empty translations: ${emptyCount}/${translatedBatch.length}`
        );
      }

      return translatedBatch;
    } catch (err: any) {
      log.error(
        `[${operationId}] Error during translation batch (Attempt ${retryCount + 1}):`,
        err.name,
        err.message
      );

      // Handle cancellation first - don't retry cancelled operations
      if (err.name === 'AbortError' || signal?.aborted) {
        log.info(
          `[${operationId}] Translation batch cancelled, throwing error.`
        );
        throw err; // Re-throw cancellation errors immediately
      }

      // If credits ran out, propagate this upward to cancel the whole pipeline
      if (
        typeof err?.message === 'string' &&
        err.message === ERROR_CODES.INSUFFICIENT_CREDITS
      ) {
        throw err;
      }

      if (
        err.message &&
        (err.message.includes('timeout') ||
          err.message.includes('rate') ||
          err.message.includes('ECONNRESET')) &&
        retryCount < MAX_RETRIES - 1
      ) {
        retryCount++;
        const delay = 1000 * Math.pow(2, retryCount);
        log.info(
          `[${operationId}] Retrying translation batch in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`
        );

        // Check for cancellation before delay
        if (signal?.aborted) {
          throw new DOMException('Operation cancelled', 'AbortError');
        }

        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      log.error(
        `[${operationId}] Unhandled error or retries exhausted in translateBatch. Falling back.`
      );
      return batch.segments.map(segment => ({
        ...segment,
        translation: segment.original,
      }));
    }
  }

  log.warn(
    `[${operationId}] Translation failed after ${MAX_RETRIES} retries, using original text`
  );

  return batch.segments.map(segment => ({
    ...segment,
    translation: segment.original,
  }));
}

export async function reviewTranslationBatch({
  batch,
  operationId,
  signal,
}: {
  batch: ReviewBatch;
  operationId: string;
  signal?: AbortSignal;
}): Promise<any[]> {
  log.info(
    `[${operationId}] Starting review batch: ${batch.startIndex}-${batch.endIndex}`
  );

  const clean = (s: string) => (s ?? '').replace(/[\uFEFF\u200B]/g, '').trim();

  const batchItemsWithContext = batch.segments.map((seg, idx) => {
    const index =
      typeof seg.index === 'number' ? seg.index : batch.startIndex + idx + 1;
    const start =
      typeof (seg as any).start === 'number' ? (seg as any).start : undefined; // seconds
    const end =
      typeof (seg as any).end === 'number' ? (seg as any).end : undefined; // seconds
    const duration =
      typeof start === 'number' && typeof end === 'number' && end > start
        ? end - start
        : undefined; // seconds

    const original = clean(seg.original ?? '');
    const translation = clean(seg.translation ?? seg.original ?? '');

    return {
      index,
      original,
      translation,
      start,
      end,
      duration, // seconds
      charsOriginal: original.length,
      charsTranslation: translation.length,
    };
  });

  const originalTexts = batchItemsWithContext
    .map(i => {
      const dur =
        typeof i.duration === 'number'
          ? ` (dur=${i.duration.toFixed(2)}s)`
          : '';
      return `[${i.index}]${dur} ${i.original}`;
    })
    .join('\n');

  const translatedTexts = batchItemsWithContext
    .map(i => {
      const dur =
        typeof i.duration === 'number' ? `dur=${i.duration.toFixed(2)}s, ` : '';
      return `[${i.index}] (${dur}chars=${i.charsTranslation}) ${i.translation}`;
    })
    .join('\n');

  // Build BEFORE/AFTER context including current translations when available
  const beforeContext = batch.contextBefore
    .map(seg => {
      const start = (seg as any).start,
        end = (seg as any).end;
      const dur =
        typeof start === 'number' && typeof end === 'number' && end > start
          ? ` (dur=${(end - start).toFixed(2)}s)`
          : '';
      const orig = `CTX(${seg.index})${dur}: ${clean(seg.original)}`;
      const tgt = (seg.translation ?? '').trim()
        ? `\nCTX_TGT(${seg.index}): ${clean(seg.translation ?? '')}`
        : '';
      return `${orig}${tgt}`;
    })
    .join('\n');

  const afterContext = batch.contextAfter
    .map(seg => {
      const start = (seg as any).start,
        end = (seg as any).end;
      const dur =
        typeof start === 'number' && typeof end === 'number' && end > start
          ? ` (dur=${(end - start).toFixed(2)}s)`
          : '';
      const orig = `CTX(${seg.index})${dur}: ${clean(seg.original)}`;
      const tgt = (seg.translation ?? '').trim()
        ? `\nCTX_TGT(${seg.index}): ${clean(seg.translation ?? '')}`
        : '';
      return `${orig}${tgt}`;
    })
    .join('\n');

  const SYSTEM_PROMPT = `You are a subtitle review engine. Output exactly ${
    batch.segments.length
  } lines, each formatted as @@SUB_LINE@@ <ABS_INDEX>: <text>. Do not add any commentary, headers, or extra lines. Do not translate or alter any CTX/CTX_TGT lines.`;

  const prompt = `
You are reviewing draft subtitle translations into ${
    batch.targetLang
  }. Improve clarity and naturalness while preserving meaning and respecting timing.

CONTEXT BEFORE (do not translate):
${beforeContext || '(none)'}

PARALLEL BATCH (source ⇄ draft):
${originalTexts}

CONTEXT AFTER (do not translate):
${afterContext || '(none)'}

DRAFT TRANSLATIONS (one-to-one with source):
${translatedTexts}

REQUIREMENTS
0) The initial translation draft may be incomplete or missing some lines. Please fill in any gaps accurately based on context.
1) Prioritize smooth flow: Ensure translated caption segments connect naturally and logically, even if the original source text feels disjointed.
2) Maintain structure: Output one line per input line, preserving the exact order and IDs without alterations.
3) Refine for fluency without adding, omitting, or altering information from the source.
4) Be mindful of the length of the original text. If the original text is long then the translation for that line should be long. If the original text is short, then the translation for that line should be short.
5) Align with source order: Match the original text's sequence as closely as possible to avoid disorienting viewers during video playback.
6) Leverage expertise: Draw on your knowledge and experience to enhance translation quality while staying faithful to the source.
7) Optimize readability: Target CPS (characters per second) limits — Latin ≤ 17, CJK ≤ 13, Thai ≤ 15. If exceeded, compress phrasing succinctly; avoid modifying timestamps or splitting/merging cues.
8) Handle duplicates softly: For adjacent lines with essentially identical content, use the same optimized text for both IDs instead of variations.

OUTPUT (exactly ${batch.segments.length} lines):
@@SUB_LINE@@ <ABS_INDEX>: <final translation>
Example: @@SUB_LINE@@ ${batch.startIndex + 1}: <your translation>
Blank allowed: @@SUB_LINE@@ ${batch.startIndex + 2}: 
`.trim();

  let attempt = 0;
  let networkRetries = 0;
  for (;;) {
    if (signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }
    attempt += 1;
    try {
      const reviewConfig = getReviewModel();
      const reviewedContent = await callAIModel({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        model: reviewConfig.model,
        reasoning: reviewConfig.reasoning,
        signal,
        operationId,
        retryAttempts: 3,
      });

      if (!reviewedContent) {
        log.warn(
          '[Review] Review response content was empty or null. Using original translations.'
        );
        return batch.segments;
      }

      const parts = reviewedContent.split('@@SUB_LINE@@').slice(1);
      const rawMap = new Map<number, string>();
      const lineRE = /^\s*(\d+)\s*:\s*([\s\S]*)$/;

      for (const raw of parts) {
        const m = raw.match(lineRE);
        if (!m) continue;
        const id = Number(m[1]);
        const txt = (m[2] ?? '').replace(/[\uFEFF\u200B]/g, '').trim();
        rawMap.set(id, txt);
      }

      const expectedIds = new Set(batchItemsWithContext.map(i => i.index));
      const map = new Map<number, string>();
      for (const id of expectedIds) {
        if (rawMap.has(id)) map.set(id, rawMap.get(id)!);
      }

      const hasDupes = map.size !== new Set(map.keys()).size; // unlikely now, but keep
      const coverageOk = map.size / batch.segments.length >= 0.9;

      if (hasDupes || !coverageOk) {
        log.warn(
          `[Review] Duplicate or missing IDs in review batch – falling back.`
        );
        return batch.segments;
      }

      const reviewedSegments = batch.segments.map((seg, idx) => {
        const id =
          typeof seg.index === 'number'
            ? seg.index
            : batch.startIndex + idx + 1;
        return {
          ...seg,
          translation: map.has(id)
            ? map.get(id)!
            : (seg.translation ?? seg.original ?? ''),
        };
      });

      return reviewedSegments;
    } catch (error: any) {
      log.error(
        `[Review] Error during review batch attempt ${attempt} (${operationId}):`,
        error?.name,
        error?.message || String(error)
      );
      if (error.name === 'AbortError' || signal?.aborted) {
        log.info(
          `[Review] Review batch (${operationId}) cancelled during attempt ${attempt}. Rethrowing.`
        );
        throw error;
      }
      if (
        typeof error?.message === 'string' &&
        error.message === ERROR_CODES.INSUFFICIENT_CREDITS
      ) {
        throw error;
      }
      if (isLikelyNetworkError(error)) {
        networkRetries += 1;
        if (networkRetries > NETWORK_RETRY_LIMIT) {
          log.error(
            `[Review] Network still unavailable after ${networkRetries} retries for batch ${batch.startIndex}-${batch.endIndex}. Falling back.`
          );
        } else {
          await waitForNetworkRetry(networkRetries, signal);
          continue;
        }
      }
      log.error(
        `[Review] Unhandled error in reviewTranslationBatch (${operationId}): ${
          error?.message || String(error)
        }. Falling back to original batch segments.`
      );
      return batch.segments;
    }
  }
}
