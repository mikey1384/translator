import log from 'electron-log';
import { ReviewBatch } from './types.js';
import { callAIModel } from './ai-client.js';
import { TranslateBatchArgs } from '@shared-types/app';

function parseTranslatedJSON(translation: string, batch: any): any[] {
  log.info(`[parseTranslatedJSON] Parsing translation response`);

  const translationLines = translation
    .split('\n')
    .filter((line: string) => line.trim() !== '');
  const lineRegex = /^Line\s+(\d+):\s*(.*)$/;

  let lastNonEmptyTranslation = '';
  return batch.segments.map((segment: any, idx: number) => {
    const absoluteIndex = batch.startIndex + idx;
    let translatedText = segment.translation ?? '';
    const originalSegmentText = segment.original;

    for (const line of translationLines) {
      const match = line.match(lineRegex);
      if (match && parseInt(match[1]) === absoluteIndex + 1) {
        const potentialTranslation = match[2].trim();
        if (potentialTranslation === originalSegmentText) {
          translatedText = lastNonEmptyTranslation;
        } else {
          translatedText = potentialTranslation || lastNonEmptyTranslation;
        }
        lastNonEmptyTranslation = translatedText;
        break;
      }
    }

    return {
      ...segment,
      translation: translatedText,
    };
  });
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
  const batchContextPrompt = batch.segments.map((segment, idx) => {
    const absoluteIndex = batch.startIndex + idx;
    return `Line ${absoluteIndex + 1}: ${segment.original}`;
  });

  const combinedPrompt = `
You are a professional subtitle translator. Translate the following subtitles
into natural, fluent ${targetLang}.

Here are the subtitles to translate:
${batchContextPrompt.join('\n')}

Translate EACH line individually, preserving the line order.
- Never skip, omit, or merge lines.
- Always finish translating the given line and do NOT defer to the next line.
- You may leave a line blank only if that entire thought (not just a few repeated words) is already in the previous line.
- Provide exactly one translation for every line, in the same order, 
  prefixed by "Line X:" where X is the line number.
- If you're unsure, err on the side of literal translations.
- For languages with different politeness levels, ALWAYS use polite/formal style for narrations.
`;

  while (retryCount < MAX_RETRIES) {
    try {
      log.info(`[${operationId}] Sending translation batch via callChatModel`);
      const res = await callAIModel({
        messages: [{ role: 'user', content: combinedPrompt }],
        signal,
        operationId,
        retryAttempts: MAX_RETRIES,
      });
      const translatedBatch = parseTranslatedJSON(res, batch);
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
        err.message === 'insufficient-credits'
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

  const beforeContext = batch.contextBefore
    .map(seg => {
      const start = (seg as any).start,
        end = (seg as any).end;
      const dur =
        typeof start === 'number' && typeof end === 'number' && end > start
          ? ` (dur=${(end - start).toFixed(2)}s)`
          : '';
      return `CTX(${seg.index})${dur}: ${clean(seg.original)}`;
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
      return `CTX(${seg.index})${dur}: ${clean(seg.original)}`;
    })
    .join('\n');

  const prompt = `
You are an **assertive subtitle reviewer** working into ${batch.targetLang}.
Your job: ensure every line reads like native ${batch.targetLang}, while respecting timing and readability.

══════════ Context (may help with pronouns, jokes, carries) ══════════
${beforeContext}

══════════ Parallel batch to review (source ⇄ draft) ══════════
${originalTexts}

══════════ Following context ══════════
${afterContext}

══════════ Draft translations to edit (one-to-one with source) ══════════
${translatedTexts}

******************** HOW TO EDIT ********************
1) **One line out per line in.** Keep the *count* and *order* of lines exactly the same.
2) **Be bold.** You may change word choice, syntax, tone, register to read naturally at CEFR C1+ level.
3) **Consistency.** Keep terminology/style consistent inside the batch.
4) **Soft merge - for translations only**
   • When a translated line exceeds constraints (length/CPS), or if the next translated line basically a repetition of the previous translated line (either identical or worded differently with the same meaning), you may perform a **SOFT MERGE** across those two lines - in case of duplication make sure to choose the better phrase of the two and drop the other.
   • **SOFT MERGE OUTPUT RULE:** write the **same merged text** for **both** IDs involved (duplicate), so the text persists across both cues.
     Example (translation duplication):
       [12] 아버지께서는 안녕하세요?
       [13] 아빠 안녕하셨어요?
     => output:
       @@SUB_LINE@@ 12: 아버지께서는 안녕하세요?
       @@SUB_LINE@@ 13: 아버지께서는 안녕하세요?
    
    Example (length/CPS):
       [12] 아버지께서는 
       [13] 안녕하세요?
     => output:
       @@SUB_LINE@@ 12: 아버지께서는 안녕하세요?
       @@SUB_LINE@@ 13: 아버지께서는 안녕하세요?

******************** OUTPUT ********************
• Output **one line per input line**.
• **Prefix every line** with \`@@SUB_LINE@@ <ABS_INDEX>:\`
  For example: \`@@SUB_LINE@@ 123: 이것은 번역입니다\`
  (A blank line is: \`@@SUB_LINE@@ 124:  \`)

Now provide the reviewed translations for the ${batch.segments.length} lines above:
`.trim();

  try {
    const reviewedContent = await callAIModel({
      messages: [{ role: 'user', content: prompt }],
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
        typeof seg.index === 'number' ? seg.index : batch.startIndex + idx + 1;
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
      `[Review] Error during initial review batch (${operationId}):`,
      error?.name,
      error?.message || String(error)
    );
    if (error.name === 'AbortError' || signal?.aborted) {
      log.info(`[Review] Review batch (${operationId}) cancelled. Rethrowing.`);
      throw error;
    }
    if (
      typeof error?.message === 'string' &&
      error.message === 'insufficient-credits'
    ) {
      // Propagate credit exhaustion to cancel the pipeline
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
