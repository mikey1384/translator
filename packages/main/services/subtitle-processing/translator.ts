import {
  completeTranslationCoverage,
  parseTranslationLines,
} from './translation-coverage.js';
import log from 'electron-log';
import { ReviewBatch } from './types.js';
import { callAIModel } from './ai-client.js';
import {
  isTranslationAdmissionLimitError,
  isProviderRateLimitError,
} from './errors.js';
import { TranslateBatchArgs, SrtSegment } from '@shared-types/app';
import {
  ERROR_CODES,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  normalizeAiModelId,
} from '@shared/constants';
import {
  resolveTranslationDraftModel,
  resolveTranslationReviewModel,
} from '../ai-provider.js';

function getDraftModel(): { model: string } {
  const model = resolveTranslationDraftModel();
  log.debug(`[Draft] resolved model: ${model}`);
  return { model };
}

export function getReviewModel(): {
  model: string;
  reasoning?: { effort: 'high' };
} {
  const resolved = resolveTranslationReviewModel();
  log.debug(
    `[Review] resolved model: ${resolved.model}, reasoning=${resolved.reasoning?.effort || 'none'}`
  );
  return resolved;
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

function isClaudeModelId(model: string | undefined): boolean {
  return Boolean(model && model.startsWith('claude-'));
}

function isAnthropicUnavailableError(error: any): boolean {
  const msg = normaliseErrorMessage(error);
  if (!msg) return false;
  return (
    msg.includes('anthropic not configured') ||
    msg.includes('missing anthropic key') ||
    msg.includes('no anthropic api key available') ||
    msg.includes('unauthorized - missing anthropic key')
  );
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

export async function translateBatch({
  batch,
  targetLang,
  qualityMode,
  operationId,
  signal,
}: TranslateBatchArgs & { qualityMode?: boolean }): Promise<any[]> {
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
        translationPhase: 'draft',
        qualityMode,
        signal,
        operationId,
        retryAttempts: MAX_RETRIES,
      });
      return await completeTranslationCoverage({
        segments: batch.segments,
        startIndex: batch.startIndex,
        draft: res,
        signal,
        repair: async missing => {
          log.info(
            `[${operationId}] Repairing ${missing.length} missing translation cues`
          );
          return callAIModel({
            messages: [
              {
                role: 'system',
                content: `You are a subtitle translator. Output exactly ${missing.length} lines in the format @@SUB_LINE@@ <ABS_NUMBER>: <translation>. Use every given number exactly once. No commentary.`,
              },
              {
                role: 'user',
                content: `Translate ONLY these lines into natural ${targetLang}. Do not omit or merge lines.\n${missing.map(m => formatLine(m.id, m.original)).join('\n')}`,
              },
            ],
            model: draftConfig.model,
            translationPhase: 'draft',
            qualityMode,
            signal,
            operationId,
            retryAttempts: 2,
          });
        },
      });
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

      // Do not pay for the completed draft again after a repair request fails.
      // The caller preserves it and retries only missing cues.
      if (err?.partialSegments?.some((s: SrtSegment) => s.translation?.trim()))
        throw err;

      const msg = String(err?.message || '');
      const lowerMsg = msg.toLowerCase();

      const isProviderAuthError =
        msg.includes(ERROR_CODES.OPENAI_KEY_INVALID) ||
        msg.includes(ERROR_CODES.ANTHROPIC_KEY_INVALID) ||
        msg.includes(ERROR_CODES.ELEVENLABS_KEY_INVALID);
      const isProviderRateLimit =
        msg.includes(ERROR_CODES.OPENAI_RATE_LIMIT) ||
        msg.includes(ERROR_CODES.ANTHROPIC_RATE_LIMIT) ||
        msg.includes(ERROR_CODES.ELEVENLABS_RATE_LIMIT);
      const isProviderQuotaError =
        msg.includes(ERROR_CODES.OPENAI_INSUFFICIENT_QUOTA) ||
        msg.includes(ERROR_CODES.ANTHROPIC_INSUFFICIENT_QUOTA) ||
        msg.includes(ERROR_CODES.ELEVENLABS_INSUFFICIENT_QUOTA) ||
        lowerMsg.includes('insufficient_quota');

      // BYO account/key failures should be surfaced to users, not silently
      // replaced with source text. Admission-limit 429s are deterministic-
      // retryable, so surface them too — the concurrency pool defers and
      // retries them once in-flight jobs release their slots.
      if (
        msg === ERROR_CODES.INSUFFICIENT_CREDITS ||
        isProviderAuthError ||
        isProviderQuotaError ||
        isTranslationAdmissionLimitError(err)
      ) {
        throw err;
      }

      if (isProviderRateLimit) {
        if (retryCount < MAX_RETRIES - 1) {
          retryCount++;
          const delay = 1000 * Math.pow(2, retryCount);
          log.info(
            `[${operationId}] Retrying translation batch after provider rate limit in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`
          );

          if (signal?.aborted) {
            throw new DOMException('Operation cancelled', 'AbortError');
          }

          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }

      if (
        msg &&
        (msg.includes('timeout') ||
          msg.includes('rate') ||
          msg.includes('ECONNRESET')) &&
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

      throw err;
    }
  }
  throw new Error('__i18n__:errors.translationIncomplete');
}

export async function reviewTranslationBatch({
  batch,
  operationId,
  signal,
  onModelFallback,
  initialReviewConfig,
}: {
  batch: ReviewBatch;
  operationId: string;
  signal?: AbortSignal;
  onModelFallback?: (model: string) => void;
  initialReviewConfig?: ReturnType<typeof getReviewModel>;
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

  const SYSTEM_PROMPT = `Subtitle reviewer. Output exactly ${batch.segments.length} lines: @@SUB_LINE@@ <ID>: <text>. No commentary.`;

  const prompt =
    `Review ${batch.targetLang} subtitle drafts. Fix errors, improve fluency, fill gaps.

CTX BEFORE:
${beforeContext || '(none)'}

SOURCE:
${originalTexts}

CTX AFTER:
${afterContext || '(none)'}

DRAFT:
${translatedTexts}

RULES:
- Fill missing translations from context
- Improve flow between segments
- Match source length (short→short, long→long)
- CPS limits: Latin≤17, CJK≤13, Thai≤15 — compress if exceeded
- Same text for adjacent duplicate content

OUTPUT ${batch.segments.length} lines:
@@SUB_LINE@@ ${batch.startIndex + 1}: <translation>
`.trim();

  let attempt = 0;
  let networkRetries = 0;
  let reviewConfig = initialReviewConfig ?? getReviewModel();
  let shouldRetry = true;
  while (shouldRetry) {
    shouldRetry = false;
    if (signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }
    attempt += 1;
    try {
      let observedModel: string | undefined;
      const reviewedContent = await callAIModel({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        model: reviewConfig.model,
        reasoning: reviewConfig.reasoning,
        translationPhase: 'review',
        qualityMode: true,
        signal,
        operationId,
        retryAttempts: 3,
        onResolvedModel: resolvedModel => {
          observedModel = normalizeAiModelId(resolvedModel);
        },
      });

      const normalizedRequestedModel = normalizeAiModelId(reviewConfig.model);
      if (observedModel && observedModel !== normalizedRequestedModel) {
        log.warn(
          `[Review] Effective review model switched from ${normalizedRequestedModel} to ${observedModel} (${operationId}).`
        );
        reviewConfig = { model: observedModel };
        onModelFallback?.(reviewConfig.model);
      }

      if (!reviewedContent) {
        log.warn(
          '[Review] Review response content was empty or null. Using original translations.'
        );
        return batch.segments;
      }

      const ids = batchItemsWithContext.map(item => item.index);
      const map = parseTranslationLines(reviewedContent, ids);
      // Review can improve a draft; an empty, omitted or duplicate review line
      // must never erase a valid translation or substitute untranslated source.
      return batch.segments.map((segment, index) => ({
        ...segment,
        translation: map.get(ids[index]) || segment.translation || '',
      }));
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
      if (
        isClaudeModelId(reviewConfig.model) &&
        isAnthropicUnavailableError(error)
      ) {
        log.warn(
          `[Review] Anthropic unavailable for review (${operationId}). Falling back to the OpenAI review path.`
        );
        reviewConfig = { model: STAGE5_REVIEW_TRANSLATION_MODEL };
        onModelFallback?.(reviewConfig.model);
        shouldRetry = true;
        continue;
      }
      if (isLikelyNetworkError(error)) {
        networkRetries += 1;
        if (networkRetries > NETWORK_RETRY_LIMIT) {
          log.error(
            `[Review] Network still unavailable after ${networkRetries} retries for batch ${batch.startIndex}-${batch.endIndex}. Falling back.`
          );
        } else {
          await waitForNetworkRetry(networkRetries, signal);
          shouldRetry = true;
          continue;
        }
      }
      if (
        isTranslationAdmissionLimitError(error) ||
        isProviderRateLimitError(error)
      ) {
        // Retryable backpressure: surface so the review pool can defer and
        // retry instead of silently shipping the unreviewed draft.
        throw error;
      }
      log.error(
        `[Review] Unhandled error in reviewTranslationBatch (${operationId}): ${
          error?.message || String(error)
        }. Falling back to original batch segments.`
      );
      return batch.segments;
    }
  }

  return batch.segments;
}
