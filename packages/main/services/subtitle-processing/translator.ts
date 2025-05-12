import { AI_MODELS } from '../../../shared/constants/index.js';
import log from 'electron-log';
import { TranslateBatchArgs, ReviewBatch } from './types.js';
import { callAIModel } from './openai-client.js';

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
      const translation = await callAIModel({
        messages: [{ role: 'user', content: combinedPrompt }],
        max_tokens: AI_MODELS.MAX_TOKENS,
        signal,
        operationId,
        retryAttempts: 3,
      });
      log.info(`[${operationId}] Received response for translation batch`);
      log.info(
        `[${operationId}] Received response for translation batch (Attempt ${retryCount + 1})`
      );

      const translationLines = translation
        .split('\n')
        .filter((line: string) => line.trim() !== '');
      const lineRegex = /^Line\s+(\d+):\s*(.*)$/;

      let lastNonEmptyTranslation = '';
      return batch.segments.map((segment, idx) => {
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
    } catch (err: any) {
      log.error(
        `[${operationId}] Error during translation batch (Attempt ${retryCount + 1}):`,
        err.name,
        err.message
      );

      if (err.name === 'AbortError' || signal?.aborted) {
        log.info(
          `[${operationId}] Translation batch detected cancellation signal/error.`
        );
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

  const batchItemsWithContext = batch.segments.map((seg, idx) => ({
    index: batch.startIndex + idx + 1,
    original: seg.original.trim(),
    translation: (seg.translation ?? seg.original).trim(),
    isPartOfBatch: true,
  }));

  const originalTexts = batchItemsWithContext
    .map(i => `[${i.index}] ${i.original}`)
    .join('\n');
  const translatedTexts = batchItemsWithContext
    .map(i => `[${i.index}] ${i.translation}`)
    .join('\n');

  const beforeContext = batch.contextBefore
    .map(seg => `[${seg.index}] ${seg.original}`)
    .join('\n');
  const afterContext = batch.contextAfter
    .map(seg => `[${seg.index}] ${seg.original}`)
    .join('\n');

  const prompt = `
You are an **assertive subtitle editor** working into ${batch.targetLang}.  
Your goal: every line must read like it was **originally written** in ${batch.targetLang} by a native speaker.

══════════ Context (may help with pronouns, jokes, carries) ══════════
${beforeContext}

══════════ Parallel batch to review (source ⇄ draft) ══════════
${originalTexts}

══════════ Following context ══════════
${afterContext}

══════════ Draft translations to edit ══════════
${translatedTexts}

******************** HOW TO EDIT ********************
1. **Line-by-line**: keep the *count* and *order* of lines exactly the same.
2. **Be bold**: You may change word choice, syntax, tone, register.
3. **Terminology & style** must stay consistent inside this batch.
4. **Quality bar**: every final line must be fluent at CEFR C1+ level.  
   If the draft already meets that bar, you may leave it unchanged.
5. **You may NOT merge, split, reorder, add, or delete lines.**

******************** OUTPUT ********************
• Output **one line per input line**.
• **Prefix every line** with \`@@SUB_LINE@@ <ABS_INDEX>:\` (even blank ones).
  For example: \`@@SUB_LINE@@ 123: 이것은 번역입니다\`
  (A blank line is: \`@@SUB_LINE@@ 124:  \`)
• No extra commentary, no blank lines except those required by rule 3.

Now provide the reviewed translations for the ${batch.segments.length} lines above:
`;

  try {
    const reviewedContent = await callAIModel({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: AI_MODELS.MAX_TOKENS,
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

    const lines = reviewedContent.split('@@SUB_LINE@@').slice(1);

    const map = new Map<number, string>();
    const lineRE = /^\s*(\d+)\s*:\s*([\s\S]*)$/;

    for (const raw of lines) {
      const m = raw.match(lineRE);
      if (!m) continue;
      const id = Number(m[1]);
      const txt = (m[2] ?? '').replace(/[\uFEFF\u200B]/g, '').trim();
      map.set(id, txt);
    }

    // Optional: reject batches that look fishy
    const ids = [...map.keys()];
    const hasDupes = ids.length !== new Set(ids).size;
    if (hasDupes || map.size / batch.segments.length < 0.9) {
      log.warn(
        `[Review] Duplicate or missing IDs in review batch – falling back.`
      );
      return batch.segments;
    }

    const reviewedSegments = batch.segments.map(seg => ({
      ...seg,
      translation: map.has(seg.index)
        ? map.get(seg.index)!
        : (seg.translation ?? seg.original),
    }));

    reviewedSegments.forEach((s, i, arr) => {
      if (!s.translation?.trim() && arr[i].original.trim().length > 0) {
        log.debug(`[SYNC-CHECK] Blank at #${s.index}: "${arr[i].original}"`);
      }
    });

    return reviewedSegments;
  } catch (error: any) {
    log.error(
      `[Review] Error during initial review batch (${operationId}):`, // Updated log message slightly
      error.name,
      error.message
    );
    if (error.name === 'AbortError' || signal?.aborted) {
      log.info(`[Review] Review batch (${operationId}) cancelled. Rethrowing.`);
      throw error;
    }
    log.error(
      `[Review] Unhandled error in reviewTranslationBatch (${operationId}). Falling back to original batch segments.`
    );
    return batch.segments;
  }
}
