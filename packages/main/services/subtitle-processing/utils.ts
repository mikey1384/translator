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
    log.warn(
      '[utils.ts] webrtcvad not available on this platform:',
      error instanceof Error ? error.message : String(error)
    );
  }
  return vadPkg;
}

export async function getVadCtor() {
  await loadVadPkg();
  if (!vadPkg) {
    log.warn(
      '[utils.ts] webrtcvad not available - voice activity detection will be disabled'
    );
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
  log.info(`[${operationId}] [sig] ${stage} → “${sig}”`);
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

export function cleanTranscriptBatch({ segments }: { segments: SrtSegment[] }) {
  const TERM_RE = /[.!?…]$/u;
  const cleanNoise = (txt: string): string => {
    let t = txt ?? '';
    // remove emojis
    t = t.replace(/\p{Extended_Pictographic}/gu, '');
    // collapse long runs of odd symbols (keep single)
    t = t.replace(/([^\p{L}\p{N}\s.,'"-–—(){}[\]%:;!?…])\1{2,}/gu, '$1');
    // normalize whitespace
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
  };
  const normalise = (txt: string): string =>
    (txt ?? '')
      .replace(/[\uFF0C\u066B\u066C\uFE50]/g, ',') // exotic comma variants
      .trim();

  const normForCompare = (s: string): string =>
    (s ?? '')
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[“”„‟"«»’‘‚‛'`´]/g, "'")
      .replace(/[‐-‒–—―]/g, '-') // dashes
      .replace(/[(){}]/g, ' ')
      .replace(/\$begin:math:display\$/g, ' ')
      .replace(/\$end:math:display\$/g, ' ')
      .replace(/[^ \p{L}\p{N}'-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const tokenize = (s: string) => normForCompare(s).split(' ').filter(Boolean);

  const jaccard = (a: string, b: string): number => {
    const A = new Set(tokenize(a));
    const B = new Set(tokenize(b));
    if (!A.size && !B.size) return 1;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    const union = Math.max(1, A.size + B.size - inter);
    return inter / union;
  };

  const safeJoin = (a: string, b: string) => {
    const left = a.trim();
    const right = b.trim();
    if (!left) return right;
    if (!right) return left;
    // Avoid doubling up essentially identical content
    const nl = normForCompare(left);
    const nr = normForCompare(right);
    if (
      nl === nr ||
      nr.startsWith(nl) ||
      nl.startsWith(nr) ||
      jaccard(left, right) >= 0.95
    ) {
      return left;
    }
    const needsSpace =
      /[\p{L}\p{N}]$/u.test(left) && /^[\p{L}\p{N}]/u.test(right);
    return needsSpace ? `${left} ${right}` : `${left}${right}`;
  };

  // longest suffix of prev that equals prefix of curr (by tokens), up to maxK
  const overlapTokens = (
    prev: string,
    curr: string,
    maxK = Number.POSITIVE_INFINITY
  ) => {
    const ta = tokenize(prev);
    const tb = tokenize(curr);
    const max = Math.min(maxK, ta.length, tb.length);
    for (let k = max; k >= 2; k--) {
      const suf = ta.slice(-k).join(' ');
      const pre = tb.slice(0, k).join(' ');
      if (suf === pre) return k;
    }
    return 0;
  };

  const cps = (text: string, start: number, end: number) => {
    const dur = Math.max(0.001, (end ?? 0) - (start ?? 0)); // seconds
    const chars = (text || '').replace(/\s*\n\s*/g, '').length;
    return chars / dur;
  };

  const PROGRAMMATIC = {
    MAX_GAP_TO_MERGE_SEC: 1.0,
    SHORT_TAIL_MAX_WORDS: 2,
    DUP_JACCARD: 0.9,
    CPS_MAX: 17,
    MIN_DUR_FOR_DENSE: 0.8,
  };

  function preCleanSoftMergePass(input: SrtSegment[]): string[] {
    // seed with noise-stripped, normalized text (no structural changes yet)
    const out = input.map(s => normalise(cleanNoise(s.original)));

    // 1) Boundary repetition trim (remove duplicate phrase at start of i)
    for (let i = 1; i < input.length; i++) {
      const prev = out[i - 1];
      const curr = out[i];
      if (!prev || !curr) continue;

      const tb = tokenize(curr);
      // allow 1-token overlap only if current is a tiny tail (<= SHORT_TAIL_MAX_WORDS)
      const minK = tb.length <= PROGRAMMATIC.SHORT_TAIL_MAX_WORDS ? 1 : 2;

      // compute longest token overlap between end of prev and start of curr, honoring minK
      const ta = tokenize(prev);
      const max = Math.min(ta.length, tb.length);
      let k = 0;
      for (let kk = max; kk >= minK; kk--) {
        const suf = ta.slice(-kk).join(' ');
        const pre = tb.slice(0, kk).join(' ');
        if (suf === pre) {
          k = kk;
          break;
        }
      }

      if (k > 0) {
        const trimmed = tb.slice(k).join(' ');
        out[i] = trimmed ? trimmed : '';
        // if nothing left, we’ll handle as near-duplicate in step 2
      }
    }

    // 2) Near-duplicate soft merge (keep earlier, blank later)
    for (let i = 1; i < input.length; i++) {
      const a = out[i - 1];
      const b = out[i];
      if (!a || !b) continue;
      const na = normForCompare(a);
      const nb = normForCompare(b);
      const dupish =
        na === nb ||
        na.includes(nb) ||
        nb.includes(na) ||
        jaccard(a, b) >= PROGRAMMATIC.DUP_JACCARD;

      if (dupish) {
        // remove full prefix overlap; keep only non-duplicate tail of later
        const k = overlapTokens(a, b, Number.POSITIVE_INFINITY);
        const remainder = tokenize(b).slice(k).join(' ');
        out[i] = remainder ? remainder : '';
      }
    }

    // 3) Tiny tail merge (one/two-word continuation into previous)
    for (let i = 1; i < input.length; i++) {
      const prev = out[i - 1];
      const curr = out[i];
      const prevSeg = input[i - 1];
      const currSeg = input[i];
      if (!prev || !curr) continue;

      const words = tokenize(curr).length;
      const gap = (currSeg.start ?? 0) - (prevSeg.end ?? prevSeg.start ?? 0);
      const prevEndsSentence = TERM_RE.test(prev);

      if (
        words <= PROGRAMMATIC.SHORT_TAIL_MAX_WORDS &&
        gap <= PROGRAMMATIC.MAX_GAP_TO_MERGE_SEC &&
        !prevEndsSentence
      ) {
        const merged = safeJoin(prev, curr);
        out[i - 1] = merged;
        out[i] = '';
      }
    }

    // 4) Dense short line: if curr is very dense, try merging into prev
    for (let i = 1; i < input.length; i++) {
      const prev = out[i - 1];
      const curr = out[i];
      const prevSeg = input[i - 1];
      const currSeg = input[i];
      if (!prev || !curr) continue;

      const currDur =
        (currSeg.end ?? currSeg.start ?? 0) - (currSeg.start ?? 0);
      const currCps = cps(curr, currSeg.start, currSeg.end);
      const gap = (currSeg.start ?? 0) - (prevSeg.end ?? prevSeg.start ?? 0);

      if (
        currDur > 0 &&
        currDur < PROGRAMMATIC.MIN_DUR_FOR_DENSE &&
        currCps > PROGRAMMATIC.CPS_MAX &&
        gap <= PROGRAMMATIC.MAX_GAP_TO_MERGE_SEC
      ) {
        const merged = safeJoin(prev, curr);
        out[i - 1] = merged;
        out[i] = '';
      }
    }

    // 5) Triple pattern: A, A (dup), short tail → merge all three to A+tail
    for (let i = 0; i + 2 < input.length; i++) {
      const a = out[i],
        b = out[i + 1],
        c = out[i + 2];
      if (!a || !b || !c) continue;
      const sameAB =
        normForCompare(a) === normForCompare(b) || jaccard(a, b) >= 0.95;
      const tailWords = tokenize(c).length;
      const gapBC =
        (input[i + 2].start ?? 0) -
        (input[i + 1].end ?? input[i + 1].start ?? 0);

      if (
        sameAB &&
        tailWords <= PROGRAMMATIC.SHORT_TAIL_MAX_WORDS &&
        gapBC <= PROGRAMMATIC.MAX_GAP_TO_MERGE_SEC
      ) {
        const merged = safeJoin(a, c);
        out[i] = merged;
        out[i + 1] = merged;
        out[i + 2] = merged;
      }
    }

    // 6) Final tidy: collapse consecutive duplicates by blanking later
    for (let i = 1; i < out.length; i++) {
      if (normForCompare(out[i]) === normForCompare(out[i - 1])) out[i] = '';
    }

    return out.map(t =>
      // final pass: normalize number groupings like "1 234" → "1,234"
      t.replace(/(\d)(?:[\s\u202F])(\d{3})(?=(?:\D|$))/g, '$1,$2')
    );
  }
  const cleaned = (() => {
    // preserve indices/durations; only change text
    const texts = preCleanSoftMergePass(segments);
    return segments.map((s, i) => ({ ...s, original: texts[i] }));
  })();

  return cleaned;
}

export async function cleanupTranslatedCaptions({
  segments,
  operationId,
  signal,
  mediaDuration = 0,
  onProgress,
  targetLang,
}: {
  segments: SrtSegment[];
  operationId: string;
  signal?: AbortSignal;
  mediaDuration?: number;
  onProgress?: (done: number, total: number) => void;
  targetLang: string;
}): Promise<SrtSegment[]> {
  const BATCH_SIZE = 20;
  const result: SrtSegment[] = [];

  const SYSTEM_PROMPT = `
You are a caption cleanup and de-duplication engine working into ${targetLang}.

You will receive a list of caption items. Each item includes:
  • index and duration
  • SRC: the ORIGINAL (source-language) text
  • TGT: the current TRANSLATION (target-language) text

GOAL
────
Decide, for each item, whether to:
  • keep TGT exactly as is,
  • lightly adjust TGT (e.g., remove obvious immediate duplication or dangling fragments),
  • remove the caption (output blank) if it is redundant with its neighbor(s) or is a low-value single-word item that does not flow.

IMPORTANT
─────────
1) Use **SRC** to judge semantics. If two adjacent captions convey essentially the same idea in SRC (even with different wording), keep the **earlier** one and delete the later one.
2) If TGTs look similar but SRCs are **not** semantically redundant, **keep both** (possibly trim overlap at boundaries).
3) If a later caption’s TGT is fully contained at the end of the previous caption’s TGT (classic carry-over), delete the later one.
4) Remove low-value **single-word** TGT captions only if they do not read naturally with neighbors (again, check SRC for intent like interjections).
5) Preserve standard punctuation in TGT; do not rewrite style beyond light trimming needed for de-duplication.

OUTPUT (exactly one line per input, same order)
  @@LINE@@ <index>: <final TGT>
Leave blank after the colon to delete the caption.
`;

  // Work in batches to keep token usage reasonable.
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);

    const videoLen =
      mediaDuration > 0
        ? Math.round(mediaDuration)
        : (segments.at(-1)?.end ?? 0);

    const sys = SYSTEM_PROMPT.replace('${VIDEO_LENGTH_SEC}', String(videoLen));

    const payload = batch
      .map(s => {
        const dur = Math.max(0, s.end - s.start).toFixed(2);
        const src = (s.original ?? '').trim();
        const tgt = (s.translation ?? '').trim();
        return `${s.index} @ ${dur}s\nSRC: ${src}\nTGT: ${tgt}`;
      })
      .join('\n\n');

    const raw = await callAIModel({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: payload },
      ],
      operationId,
      signal,
    });

    // Parse model output
    const lineRE = /^@@LINE@@\s+(\d+)\s*:\s*(.*)$/;
    const map = new Map<number, string>();
    raw.split('\n').forEach(row => {
      const m = row.match(lineRE);
      if (m) map.set(Number(m[1]), (m[2] ?? '').trim());
    });

    // Fallback safety: if output is obviously incomplete, keep originals for that batch
    const expected = batch.length;
    const have = [...map.keys()].filter(k => map.has(k)).length;
    const tooFew = have / Math.max(1, expected) < 0.8;

    batch.forEach(s => {
      const updated =
        !tooFew && map.has(s.index) ? map.get(s.index)! : (s.translation ?? '');
      result.push({ ...s, translation: updated });
    });

    try {
      onProgress?.(
        Math.min(i + batch.length, segments.length),
        segments.length
      );
    } catch {
      // ignore progress errors
    }
  }

  // Keep stable ordering & reindex
  return result
    .sort((a, b) => a.start - b.start)
    .map((s, i) => ({ ...s, index: i + 1 }));
}

export function mergeUnrealisticCpsTranslatedSegments(
  segments: SrtSegment[]
): SrtSegment[] {
  if (!segments?.length) return segments;
  const segs = segments.slice().sort((a, b) => a.start - b.start);

  const normalizeWord = (w: string): string =>
    w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  const longestSuffixPrefixMatch = (
    aWords: string[],
    bWords: string[],
    maxLook = 15
  ): number => {
    const maxK = Math.min(maxLook, aWords.length, bWords.length);
    for (let k = maxK; k >= 3; k--) {
      let ok = true;
      for (let i = 0; i < k; i++) {
        if (aWords[aWords.length - k + i] !== bWords[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return k;
    }
    return 0;
  };

  const cpsValues: number[] = [];
  const cpsPerIndex: number[] = new Array(segs.length).fill(0);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const dur = Math.max(0.001, s.end - s.start);
    const t = (s.translation ?? '').replace(/\s+/g, '');
    const cps = t.length / dur;
    cpsPerIndex[i] = cps;
    if (t.length > 0) cpsValues.push(cps);
  }
  if (cpsValues.length === 0)
    return segs.map((s, i) => ({ ...s, index: i + 1 }));
  cpsValues.sort((a, b) => a - b);
  const perc = (arr: number[], p: number) =>
    arr[
      Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))
    ];
  const threshold = perc(cpsValues, 0.95);

  const toRemove = new Set<number>();
  for (let i = 0; i < segs.length; i++) {
    if (toRemove.has(i)) continue;
    const s = segs[i];
    const t = (s.translation ?? '').trim();
    if (!t) continue;
    if (cpsPerIndex[i] <= threshold) continue;
    // Merge into previous if available; else next
    const targetIdx = i > 0 ? i - 1 : i + 1 < segs.length ? i + 1 : -1;
    if (targetIdx === -1) continue;
    const target = segs[targetIdx];
    const targetT = (target.translation ?? '').trim();

    // First, fast-path raw containment (handles Korean and space-delimited scripts)
    if (targetT && t) {
      const tgtNoWs = targetT.replace(/\s+/g, '');
      const newNoWs = t.replace(/\s+/g, '');
      if (targetT.includes(t) || tgtNoWs.includes(newNoWs)) {
        // Target already contains new text; keep target as-is
      } else if (t.includes(targetT) || newNoWs.includes(tgtNoWs)) {
        // New text fully contains target; replace
        target.translation = t;
      } else {
        // Deduplicate overlap by token suffix/prefix match
        const normA = targetT.split(/\s+/).map(normalizeWord).filter(Boolean);
        const normB = t.split(/\s+/).map(normalizeWord).filter(Boolean);
        const k = longestSuffixPrefixMatch(normA, normB, 15);
        const origBToks = t.split(/\s+/);
        const trimmedT = k > 0 ? origBToks.slice(k).join(' ').trim() : t;
        const sepNeeded = targetT.length > 0 && !/[\s\-–—]$/.test(targetT);
        const appended =
          trimmedT.length > 0
            ? `${targetT}${sepNeeded ? ' ' : ''}${trimmedT}`.trim()
            : targetT;
        target.translation = appended;
      }
    } else if (t) {
      // Only new text has content
      target.translation =
        targetT.length > 0
          ? `${targetT}${/[\s\-–—]$/.test(targetT) ? '' : ' '}${t}`.trim()
          : t;
    }
    target.end = Math.max(target.end, s.end);
    toRemove.add(i);
  }

  const merged: SrtSegment[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (toRemove.has(i)) continue;
    merged.push(segs[i]);
  }
  return merged.map((s, i) => ({ ...s, index: i + 1 }));
}

export function enforceReadableTranslatedCaptions(
  segments: SrtSegment[],
  opts: {
    minDur?: number;
    maxDur?: number;
    minGap?: number;
    latinMaxCps?: number;
    cjkMaxCps?: number;
    thaiMaxCps?: number;
  } = {}
): SrtSegment[] {
  if (!segments?.length) return segments;

  const MIN_DUR = opts.minDur ?? 1.0;
  const MAX_DUR = opts.maxDur ?? 7.0;
  const MIN_GAP = opts.minGap ?? 0.12;
  const LATIN_MAX = opts.latinMaxCps ?? 17;
  const CJK_MAX = opts.cjkMaxCps ?? 13;
  const THAI_MAX = opts.thaiMaxCps ?? 15;

  const segs = segments
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((s, i) => ({ ...s, index: i + 1 }));

  const normWord = (w: string) =>
    w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const isCJK = (t: string) =>
    /(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|[\u30A0-\u30FF\uFF65-\uFF9F])/u.test(
      t
    );
  const isThaiLike = (t: string) =>
    /[\u0E00-\u0E7F\u1780-\u17FF\u0E80-\u0EFF]/u.test(t);
  const textOf = (s: SrtSegment) => (s.translation ?? '').trim();
  const cpsOf = (s: SrtSegment) => {
    const t = textOf(s);
    const dur = Math.max(0.001, s.end - s.start);
    return t.replace(/\s+/g, '').length / dur;
  };
  const maxCpsFor = (t: string) =>
    isCJK(t) ? CJK_MAX : isThaiLike(t) ? THAI_MAX : LATIN_MAX;

  const longestSuffixPrefixMatch = (
    aWords: string[],
    bWords: string[],
    maxLook = 15
  ) => {
    const maxK = Math.min(maxLook, aWords.length, bWords.length);
    for (let k = maxK; k >= 3; k--) {
      let ok = true;
      for (let i = 0; i < k; i++) {
        if (aWords[aWords.length - k + i] !== bWords[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return k;
    }
    return 0;
  };

  const dedupeOverlapConcat = (left: string, right: string) => {
    if (!left) return right;
    if (!right) return left;
    const L = left.split(/\s+/);
    const R = right.split(/\s+/);
    const Ln = L.map(normWord).filter(Boolean);
    const Rn = R.map(normWord).filter(Boolean);
    const k = longestSuffixPrefixMatch(Ln, Rn, 15);
    const trimmedRight = k > 0 ? R.slice(k).join(' ').trim() : right;
    if (!trimmedRight) return left;
    const sep = /[\s\-–—]$/.test(left) ? '' : ' ';
    return `${left}${sep}${trimmedRight}`.trim();
  };

  const borrowTime = (i: number, need: number) => {
    if (need <= 0) return 0;
    const s = segs[i];
    const prev = segs[i - 1];
    const next = segs[i + 1];
    let added = 0;

    if (next) {
      const rightGap = Math.max(0, next.start - s.end);
      const canTakeR = Math.max(0, rightGap - MIN_GAP);
      const takeR = Math.max(
        0,
        Math.min(need - added, canTakeR, MAX_DUR - (s.end - s.start) - added)
      );
      if (takeR > 0) {
        s.end += takeR;
        added += takeR;
      }
    } else {
      const takeR = Math.max(
        0,
        Math.min(need - added, MAX_DUR - (s.end - s.start) - added)
      );
      if (takeR > 0) {
        s.end += takeR;
        added += takeR;
      }
    }

    if (added < need && prev) {
      const leftGap = Math.max(0, s.start - prev.end);
      const canTakeL = Math.max(0, leftGap - MIN_GAP);
      const takeL = Math.max(
        0,
        Math.min(need - added, canTakeL, MAX_DUR - (s.end - s.start) - added)
      );
      if (takeL > 0) {
        s.start -= takeL;
        added += takeL;
      }
    } else if (added < need && !prev) {
      const takeL = Math.min(need - added, s.start);
      if (takeL > 0) {
        s.start -= takeL;
        added += takeL;
      }
    }
    return added;
  };

  const splitCue = (i: number) => {
    const s = segs[i];
    const t = textOf(s);
    if (!t) return false;

    const mid = Math.floor(t.length / 2);
    let pos = -1;
    const punct = /[.!?;…,:]/g;
    let m: RegExpExecArray | null;
    let bestDist = Infinity;
    while ((m = punct.exec(t))) {
      const dist = Math.abs(m.index - mid);
      if (dist < bestDist) {
        bestDist = dist;
        pos = m.index + 1;
      }
    }
    if (pos === -1) {
      const leftSpace = t.lastIndexOf(' ', mid);
      const rightSpace = t.indexOf(' ', mid);
      const pick =
        leftSpace >= 10 ? leftSpace : rightSpace > -1 ? rightSpace : -1;
      pos = pick;
    }
    if (pos === -1 || pos <= 0 || pos >= t.length - 1) return false;

    const aText = t.slice(0, pos).trim();
    const bText = t.slice(pos).trim();
    if (!aText || !bText) return false;

    const totalLen =
      aText.replace(/\s+/g, '').length + bText.replace(/\s+/g, '').length;
    const aShare = aText.replace(/\s+/g, '').length / Math.max(1, totalLen);
    const aDur = Math.max(
      MIN_DUR,
      Math.min(MAX_DUR, aShare * (s.end - s.start))
    );
    const bDur = Math.max(
      MIN_DUR,
      Math.min(MAX_DUR, (1 - aShare) * (s.end - s.start))
    );

    const prev = segs[i - 1];
    const next = segs[i + 1];

    const aStart = prev ? Math.max(s.start, prev.end + MIN_GAP) : s.start;
    let aEnd = aStart + aDur;
    let bStart = aEnd + MIN_GAP;
    let bEnd = bStart + bDur;

    if (next && bEnd > next.start - MIN_GAP) {
      const overshoot = bEnd - (next.start - MIN_GAP);
      const pull = Math.min(overshoot, Math.max(0, aEnd - aStart - MIN_DUR));
      aEnd -= pull;
      bStart = aEnd + MIN_GAP;
      bEnd = bStart + bDur;
      if (next && bEnd > next.start - MIN_GAP) return false;
    }

    const bSeg: SrtSegment = {
      ...s,
      id: `split_${Math.random().toString(36).slice(2, 10)}`,
      start: bStart,
      end: bEnd,
      translation: bText,
    };

    s.start = aStart;
    s.end = aEnd;
    s.translation = aText;
    segs.splice(i + 1, 0, bSeg);
    return true;
  };

  const PASS_CAP = 3;
  for (let pass = 1; pass <= PASS_CAP; pass++) {
    let changed = false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const t = textOf(s);
      if (!t) continue;
      const maxCps = maxCpsFor(t);
      let cps = cpsOf(s);

      if (
        cps <= maxCps &&
        s.end - s.start >= MIN_DUR &&
        s.end - s.start <= MAX_DUR
      ) {
        continue;
      }

      if (s.end - s.start < MIN_DUR) {
        const need = MIN_DUR - (s.end - s.start);
        if (borrowTime(i, need) > 0) {
          changed = true;
          cps = cpsOf(s);
        }
      }

      if (cps > maxCps) {
        const needDur =
          t.replace(/\s+/g, '').length / maxCps - (s.end - s.start);
        if (needDur > 0) {
          const added = borrowTime(i, needDur);
          if (added > 0) {
            changed = true;
            cps = cpsOf(s);
          }
        }
      }

      if (cps > maxCps) {
        const prev = segs[i - 1];
        const next = segs[i + 1];
        const canMergePrev = !!prev && prev.end - prev.start < MAX_DUR * 0.95;
        const canMergeNext = !!next && next.end - next.start < MAX_DUR * 0.95;

        const tryMerge = (withPrev: boolean) => {
          const a = withPrev ? prev! : s;
          const b = withPrev ? s : next!;
          const mergedText = dedupeOverlapConcat(textOf(a), textOf(b));
          const dur = b.end - a.start;
          const mergedCps =
            mergedText.replace(/\s+/g, '').length / Math.max(0.001, dur);
          return { a, b, mergedText, mergedCps, dur };
        };

        let merged: ReturnType<typeof tryMerge> | null = null;
        if (canMergePrev && canMergeNext) {
          const mPrev = tryMerge(true);
          const mNext = tryMerge(false);
          merged = mPrev.mergedCps <= mNext.mergedCps ? mPrev : mNext;
        } else if (canMergePrev) {
          merged = tryMerge(true);
        } else if (canMergeNext) {
          merged = tryMerge(false);
        }

        if (merged && merged.dur <= MAX_DUR + 0.25) {
          merged.a.translation = merged.mergedText;
          merged.a.end = merged.b.end;
          const killIdx = merged.b === s ? i : i + 1;
          segs.splice(killIdx, 1);
          i = Math.max(0, merged.b === s ? i - 1 : i);
          changed = true;
          continue;
        }
      }

      if (cpsOf(s) > maxCps) {
        if (splitCue(i)) {
          changed = true;
          i++;
          continue;
        }
      }
    }

    for (let k = 0; k < segs.length; k++) segs[k].index = k + 1;
    if (!changed) break;
  }

  for (let i = 1; i < segs.length; i++) {
    if (segs[i].start - segs[i - 1].end < MIN_GAP) {
      const delta = MIN_GAP - (segs[i].start - segs[i - 1].end);
      segs[i].start += delta;
      if (segs[i].end < segs[i].start + 0.3) segs[i].end = segs[i].start + 0.3;
    }
  }

  return segs.map((s, i) => ({ ...s, index: i + 1 }));
}
