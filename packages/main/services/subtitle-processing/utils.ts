import { SrtSegment } from '@shared-types/app';
import log from 'electron-log';
import { callAIModel } from './ai-client.js';

let vadPkg: any = null;
let vadPkgLoadAttempted = false;

async function loadVadPkg() {
  if (vadPkgLoadAttempted) return vadPkg;
  vadPkgLoadAttempted = true;
  
  try {
    vadPkg = await import('webrtcvad');
  } catch (error) {
    log.warn('[utils.ts] webrtcvad not available on this platform:', error instanceof Error ? error.message : String(error));
  }
  return vadPkg;
}

export async function getVadCtor() {
  await loadVadPkg();
  if (!vadPkg) {
    log.warn('[utils.ts] webrtcvad not available - voice activity detection will be disabled');
    return null;
  }
  return (vadPkg as any).default?.default ?? (vadPkg as any).default ?? vadPkg;
}

export function sig({
  stage,
  segs,
  operationId,
}: {
  stage: string;
  segs: SrtSegment[];
  operationId: string;
}) {
  if (segs.length === 0) return;
  const tail = segs.at(-1)?.original ?? '';
  const sig = tail.split(/\s+/).slice(-4).join(' ');
  log.info(`[${operationId}] [sig] ${stage} → “…${sig}”`);
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }
}

export async function scrubHallucinationsBatch({
  segments,
  operationId,
  signal,
  mediaDuration = 0,
}: {
  segments: SrtSegment[];
  operationId: string;
  signal?: AbortSignal;
  mediaDuration?: number;
}): Promise<SrtSegment[]> {
  const BATCH_SIZE = 100;
  const cleanedSegments: SrtSegment[] = [];

  const SYSTEM_PROMPT_TEMPLATE = `
You are a subtitle noise-filter.

VIDEO_LENGTH_SEC = \${VIDEO_LENGTH_SEC}
An outro is only valid if caption.start_sec > 0.9 * VIDEO_LENGTH_SEC.
*** PRESERVING PUNCTUATION IS CRITICAL. DO NOT DELETE OR ALTER STANDARD PUNCTUATION unless it is part of a clear noise pattern (e.g., 'text...???!!!'). ***
The following characters are ALWAYS allowed and never count as noise:
. , ? ! … : ; " ' - – — ( ) [ ] { } %
NOTE: Commas inside digit-groups (e.g. 1,234) are standard punctuation and must be preserved.

TASK
────
For every caption, decide whether to:
  • clean  – Remove only clear noise such as emojis, repeated special characters (e.g., ★★★★, ░░░), or premature promotional phrases like "please subscribe", "see you in the next video" when they appear early in the video (start_sec < 0.9 * VIDEO_LENGTH_SEC).
  • delete – Remove the caption entirely if it contains no meaningful words (e.g., only noise or gibberish).
  • keep as is – If the caption is meaningful and does not contain noise, preserve it exactly, including all standard punctuation.

OUTPUT (exactly one line per input, same order)
  @@LINE@@ <index>: <clean text>
If the caption should be deleted, output nothing after the colon.

RULES (Strictly Follow)
────────────────────
1. **Preserve Standard Punctuation:** Do not remove or alter periods (.), commas (,), question marks (?), exclamation marks (!), or other standard sentence punctuation unless they are part of a noise pattern (e.g., excessive repetition like 'text...???!!!'). If cleaning would require rephrasing that removes punctuation, prioritize keeping the original text unchanged.
2. **Detecting Premature Outros:** If a caption contains phrases like "thanks for watching", "please subscribe", "see you next time", or similar closing remarks AND its start_sec is less than 0.9 * VIDEO_LENGTH_SEC, it is a hallucination and must be deleted.
3. **Spam or Gibberish Detection:** Delete captions that are meaningless, such as random character strings, repeated symbols (e.g., ★★★★★, #####), or nonsensical text with no clear message.
4. **Meaningful but Awkward Text:** If a caption has real words and conveys a message, even if slightly awkward or imperfect, keep it unless it contains clear noise elements to clean.
5. **Timestamp Parsing:** The start time of each caption is provided in the format '<index> @ <start_sec>: <text>'. Use this to evaluate against VIDEO_LENGTH_SEC for outro detection.
6. **Preserve Commas in Numbers:** Do not replace commas inside digit groups.

EXAMPLES
────────
input  → 17: ★★★★★★★★★★
output → @@LINE@@ 17:

input  → 18: Thanks for watching!!! 👍👍👍 @ 30.5
output → @@LINE@@ 18:

input  → 19: Thanks for watching! See you next time. @ 950.0
output → @@LINE@@ 19: Thanks for watching! See you next time.

input  → 20: Hello, how are you today? @ 50.2
output → @@LINE@@ 20: Hello, how are you today?

input  → 21: This is a test...???!!! @ 100.3
output → @@LINE@@ 21: This is a test.

input  → 22: Subscribe now for more videos! @ 45.7
output → @@LINE@@ 22:

input  → 23: I think this is fine. Don't you? @ 200.1
output → @@LINE@@ 23: I think this is fine. Don't you?

input  → 24: ##### VIDEO END ##### @ 80.4
output → @@LINE@@ 24:

input  → 25: The budget is 1,250,000 dollars. @ 950.0
output → @@LINE@@ 25: The budget is 1,250,000 dollars.
`;

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const batchResult = await scrubHallucinationsBatchInner({
      segments: batch,
      operationId,
      signal,
      mediaDuration,
    });
    cleanedSegments.push(...batchResult);
  }
  return cleanedSegments;

  async function scrubHallucinationsBatchInner({
    segments,
    operationId,
    signal,
    mediaDuration = 0,
  }: {
    segments: SrtSegment[];
    operationId: string;
    signal?: AbortSignal;
    mediaDuration?: number;
  }): Promise<SrtSegment[]> {
    const videoLen =
      mediaDuration > 0
        ? Math.round(mediaDuration)
        : (segments.at(-1)?.end ?? 0);
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace(
      '${VIDEO_LENGTH_SEC}',
      videoLen.toString()
    );

    const normalise = (txt: string): string =>
      txt.replace(/[\uFF0C\u066B\u066C\uFE50]/g, ',');

    const userPayload = segments
      .map(
        s =>
          `${s.index} @ ${s.start.toFixed(1)}: ${normalise(s.original.trim())}`
      )
      .join('\n');

    const raw = await callAIModel({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload },
      ],
      operationId,
      signal,
    });

    const lineRE = /^@@LINE@@\s+(\d+)\s*:\s*(.*)$/;
    const modelMap = new Map<number, string>();
    raw.split('\n').forEach(row => {
      const m = row.match(lineRE);
      if (m) modelMap.set(Number(m[1]), (m[2] ?? '').trim());
    });

    const stripNoise = (txt: string): string => {
      txt = txt.replace(/\p{Extended_Pictographic}/gu, '');

      txt = txt.replace(/([^\w\s.,'"])\1{2,}/gu, '$1');

      return txt.replace(/\s{2,}/g, ' ').trim();
    };

    const cleanedSegments: SrtSegment[] = [];

    segments.forEach(seg => {
      let out = modelMap.has(seg.index)
        ? modelMap.get(seg.index)!
        : seg.original;
      out = stripNoise(out);
      out = normalise(out);
      out = out.replace(/(\d)(?:[\s\u202F])(\d{3})(?=(?:\D|$))/g, '$1,$2');

      if (out !== '') {
        cleanedSegments.push({ ...seg, original: out });
      }
    });

    return cleanedSegments;
  }
}
