import Anthropic from '@anthropic-ai/sdk';
import socket from '../../constants/socketClient';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export function adjustTimeString(hhmmssmmm: string, offsetSec: number): string {
  const [hms, ms] = hhmmssmmm.split(',');
  const [hh, mm, ss] = hms.split(':').map(Number);
  const totalOriginal = hh * 3600 + mm * 60 + ss;
  const totalNew = totalOriginal + offsetSec;

  const newH = Math.floor(totalNew / 3600);
  const newM = Math.floor((totalNew % 3600) / 60);
  const newS = Math.floor(totalNew % 60);

  return (
    `${String(newH).padStart(2, '0')}:` +
    `${String(newM).padStart(2, '0')}:` +
    `${String(newS).padStart(2, '0')},` +
    ms
  );
}

export function buildSrt(blocks: any[]) {
  return blocks
    .map((block) => {
      return `${block.index}\n${block.timingLine || `${block.startTime} --> ${block.endTime}`}\n${block.text}`;
    })
    .join('\n\n');
}

export function parseSrt(content: string) {
  const blocks = [];
  const lines = content.split('\n');
  let currentBlock: any = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (/^\d+$/.test(line)) {
      // This is a subtitle index
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = {
        index: parseInt(line),
        startTime: '',
        endTime: '',
        text: '',
        timingLine: ''
      };
    } else if (
      currentBlock &&
      !currentBlock.startTime &&
      line.includes('-->')
    ) {
      // This is a timing line
      currentBlock.timingLine = line;
      const [startTime, endTime] = line
        .split('-->')
        .map((t: string) => t.trim());
      currentBlock.startTime = startTime;
      currentBlock.endTime = endTime;
    } else if (currentBlock && currentBlock.startTime) {
      // This is subtitle text
      if (line) {
        currentBlock.text += (currentBlock.text ? '\n' : '') + line;
      }
    }
  }

  // Add the last block
  if (currentBlock && currentBlock.startTime) {
    blocks.push(currentBlock);
  }

  return blocks;
}

export async function reviewTranslationQuality(
  srtContent: string,
  userId: string
): Promise<string> {
  try {
    // Parse the SRT content
    const blocks = parseSrt(srtContent);

    // Group blocks into batches for efficient processing
    const BATCH_SIZE = 20; // Process 20 blocks at a time
    const batches = [];

    for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
      batches.push(blocks.slice(i, i + BATCH_SIZE));
    }

    const reviewedBlocks = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      // Extract original and translated text from each block
      const batchItems = batch.map((block: any) => {
        const [original, translation] = block.text.split(
          '###TRANSLATION_MARKER###'
        );
        return {
          index: block.index,
          original: original?.trim() || '',
          translation: (translation || original || '').trim()
        };
      });

      // Update progress for each batch
      if (userId) {
        const batchProgress = 45 + (batchIndex / batches.length) * 55; // Progress from 45% to 100%
        socket.emit('subtitle_translation_progress', {
          userId,
          progress: batchProgress,
          stage: 'Reviewing translation quality',
          current: batchIndex + 1,
          total: batches.length
        });
      }

      // Combine all original text and use sequential indices for translated text
      const originalTexts = batchItems
        .map((item) => item.original)
        .join('\n\n');

      // Assign temporary sequential indices (1, 2, 3...) for Claude's prompt
      const translatedTexts = batchItems
        .map((item, tempIndex) => {
          // Use 1-based indexing for readability
          const tempIdx = tempIndex + 1;
          // Return text with temporary index
          return `[${tempIdx}] ${item.translation}`;
        })
        .join('\n\n');

      // Create the prompt for Claude with the combined texts
      const prompt = `
Review and improve each translated subtitle block individually. Maintain the original order and do not merge or split the blocks. For each [index], provide the improved translation while preserving the sequence of information from the corresponding original English text.

ORIGINAL ENGLISH TEXT (DO NOT MODIFY):
${originalTexts}

TRANSLATION TO REVIEW AND IMPROVE:
${translatedTexts}

Fix any translation issues in each block, focusing on:
1. Accuracy
2. Completeness
3. Coherence
4. Context

Important: Ensure that the order of sentences and phrases within each block matches the original English text as closely as possible, even if it results in slightly less natural phrasing in the language of the translation. Also if the original line has already been translated in the previous line, simply leave the translation for that line blank to avoid sync issues.

Return ONLY the improved translation with the EXACT same format, i.e., [1] improved translation, [2] improve translation, etc.
`;

      try {
        // Call Claude to review the translations
        const MAX_RETRIES = 3;
        const TIMEOUT_MS = 45000; // 45 seconds timeout (longer since this is processing more content)

        let retryCount = 0;
        let lastError: any = null;
        let reviewedContent = '';

        while (retryCount < MAX_RETRIES) {
          try {
            // Create an AbortController for timeout handling
            const abortController = new AbortController();
            const timeoutId = setTimeout(() => {
              abortController.abort('Request timeout');
            }, TIMEOUT_MS);

            const completion = await anthropic.messages.create(
              {
                model: 'claude-3-7-sonnet-20250219',
                max_tokens: 4000,
                system:
                  'You are a professional subtitle translator and reviewer...',
                messages: [
                  {
                    role: 'user',
                    content: prompt
                  }
                ]
              },
              {
                signal: abortController.signal
              }
            );

            // Clear the timeout since the request completed successfully
            clearTimeout(timeoutId);

            // Extract the reviewed translation
            reviewedContent =
              completion.content[0]?.type === 'text'
                ? completion.content[0].text.trim()
                : '';

            // Exit the retry loop if successful
            break;
          } catch (err) {
            lastError = err;

            // Check if we should retry based on the error
            const isRetriableError =
              (err as any).name === 'AbortError' || // Timeout error
              ((err as any).status >= 500 && (err as any).status < 600) || // Server errors
              (err as Error).message?.includes('timeout') ||
              (err as Error).message?.includes('network') ||
              (err as Error).message?.includes('ECONNRESET');

            if (!isRetriableError) {
              // If not a retriable error, break out of the loop
              break;
            }

            retryCount++;

            // If we have retries left, wait with exponential backoff
            if (retryCount < MAX_RETRIES) {
              const backoffTime = Math.min(
                1000 * Math.pow(2, retryCount),
                8000
              );
              await new Promise((resolve) => setTimeout(resolve, backoffTime));
            }
          }
        }

        // Log if all retries failed
        if (retryCount === MAX_RETRIES) {
          console.error('All translation review retries failed:', lastError);
        }

        if (reviewedContent) {
          // Parse the improved translation back into individual blocks
          // The format should be "[index] translation text"
          const improvedTranslations: Record<number, string> = {};

          // Split by double newlines to get each subtitle block
          const translationBlocks = reviewedContent.split(/\n\s*\n/);

          // Process each translation block
          for (let i = 0; i < translationBlocks.length; i++) {
            const block = translationBlocks[i];

            // Extract the index and translation text using regex
            const match = block.match(/^\s*\[(\d+)\]\s*([\s\S]*?)$/);

            if (match) {
              // Standard case: block has [index] format
              const translationText = match[2].trim();

              // Store with batch-relative index (0-based internally, will be converted to 1-based in final output)
              improvedTranslations[i] = translationText;
            } else if (i === 0) {
              // Special case: first block might not have index
              improvedTranslations[0] = block.trim();
            }
          }

          // Update the blocks with the improved translations
          for (let i = 0; i < batch.length; i++) {
            const block = batch[i];
            const [originalText] = block.text.split('###TRANSLATION_MARKER###');

            if (improvedTranslations[i] !== undefined) {
              // Use the improved translation
              block.text = `${originalText}###TRANSLATION_MARKER###${improvedTranslations[i]}`;
            }
          }
        }
      } catch (claudeError) {
        console.error(
          'Error calling Claude for translation review:',
          claudeError
        );
        // Continue with original batch if Claude call fails
      }

      // Add the processed batch to the reviewed blocks
      reviewedBlocks.push(...batch);
    }

    let lastTranslation: string | null = null;
    for (const block of reviewedBlocks) {
      const parts = block.text.split('###TRANSLATION_MARKER###');
      const original = parts[0];
      const translation = parts[1] ? parts[1].trim() : '';

      if (translation) {
        // If there's a non-blank translation, update lastTranslation
        lastTranslation = translation;
      } else if (lastTranslation !== null) {
        // If translation is blank and we have a previous translation, carry it over
        block.text = `${original}###TRANSLATION_MARKER###${lastTranslation}`;
      }
      // If translation is blank and there's no previous translation, leave it as is
    }

    // Rebuild the SRT with the reviewed blocks and assign sequential indices
    const reassignedBlocks = reviewedBlocks.map((block, index) => ({
      ...block,
      index: index + 1 // Convert to 1-based indexing for final output
    }));

    return buildSrt(reassignedBlocks);
  } catch (error) {
    console.error('Error reviewing translation quality:', error);
    // Return the original SRT content if review fails
    return srtContent;
  }
}
