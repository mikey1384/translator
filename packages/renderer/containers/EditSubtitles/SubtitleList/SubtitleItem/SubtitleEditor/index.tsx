import { useState, useEffect, useRef } from 'react';
import { FoldVertical, Scissors } from 'lucide-react';
import { flushPendingEdits } from '../../../../../utils/pending-edits.js';
import {
  precheckTranscriptionCredits,
  precheckTranslationCredits,
} from '../../../../../utils/credit-precheck.js';
import Button from '../../../../../components/Button.js';
import SubtitleEditTextarea from './SubtitleEditTextarea.js';
import { useTranslation } from 'react-i18next';
import { useSubtitleRow } from '../../../../../state/subtitle-store.js';
import { secondsToSrtTime } from '../../../../../../shared/helpers/index.js';
import {
  validateCueTimeEdit,
  type TimecodeEditError,
} from '../../../../../utils/timecode-input.js';
import { useRowActions } from '../../../../../hooks/useRowActions.js';
import * as SubtitlesIPC from '../../../../../ipc/subtitles';
import {
  useUIStore,
  useTaskStore,
  useVideoStore,
  useHighlightWorkflowStore,
} from '../../../../../state';
import { transcribeOneLine } from '../../../../../ipc/subtitles';
import { useSubStore } from '../../../../../state/subtitle-store';
import { useUrlStore } from '../../../../../state/url-store';
import {
  flattenText,
  groupWhisperReviewRanges,
  shouldUseWhisperReviewHints,
  synthesizePlaceholdersWithinWindow,
} from '../../../../../utils/subtitle-heuristics.js';
import { getByoErrorMessage, isByoError } from '../../../../../utils/byoErrors';
import {
  getSourceVideoErrorMessage,
  getSourceVideoUnavailableMessage,
  isSourceVideoPathAccessible,
} from '../../../../../utils/sourceVideoErrors';
import {
  subtitleRowCardStyles,
  subtitleRowContentStyles,
  subtitleRowDividerStyles,
  subtitleRowFieldLabelStyles,
  subtitleRowFieldShellStyles,
  subtitleRowFieldStackStyles,
  subtitleRowFooterStyles,
  subtitleRowHeaderActionsStyles,
  subtitleRowHeaderStyles,
  subtitleRowIndexStyles,
  subtitleRowOldTextStyles,
  subtitleRowSideActionStyles,
  subtitleRowTimeErrorStyles,
  subtitleRowTimeGroupStyles,
  subtitleRowTimeInputInvalidStyles,
  subtitleRowTimeInputStyles,
} from '../../../edit-workspace-styles';
import { cx } from '@emotion/css';
// Language dropdown for transcription removed

const PARTIAL_RX = /^\d{0,2}(:\d{0,2}){0,2}[,.]?\d{0,3}$/;

interface SubtitleEditorProps {
  id: string;
  searchText?: string;
  temporaryAffectedText?: string;
}

export default function SubtitleEditor({
  id,
  searchText,
  temporaryAffectedText,
}: SubtitleEditorProps) {
  const { t } = useTranslation();
  const { subtitle, isPlaying } = useSubtitleRow(id);
  const actions = useRowActions(id);
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const setTranslationState = useTaskStore(s => s.setTranslation);
  const [shiftAmount, setShiftAmount] = useState('0');
  const [localStart, setLocalStart] = useState(
    subtitle ? secondsToSrtTime(subtitle.start) : '00:00:00,000'
  );
  const [localEnd, setLocalEnd] = useState(
    subtitle ? secondsToSrtTime(subtitle.end) : '00:00:00,000'
  );
  const [timeError, setTimeError] = useState<{
    field: 'start' | 'end';
    error: TimecodeEditError;
  } | null>(null);
  const [isTranslatingOne, setIsTranslatingOne] = useState(false);
  // Last caret position in either text field, for "Split at cursor".
  const caretRef = useRef<{
    field: 'original' | 'translation';
    caret: number;
  } | null>(null);
  // Line numbers follow list order, so a next line exists below `order.length`.
  const lineCount = useSubStore(s => s.order.length);
  const isTranscribing = useTaskStore(s => !!s.transcription.inProgress);
  const isTranslatingGlobal = useTaskStore(s => !!s.translation.inProgress);
  const isMerging = useTaskStore(s => !!s.merge.inProgress);
  const isHighlightWorkflowLocked = useHighlightWorkflowStore(
    s => s.running || s.isCancelling
  );
  const videoPath = useVideoStore(s => s.path);
  const sourceUrl = useVideoStore(s => s.sourceUrl);
  const [isTranscribingOne, setIsTranscribingOne] = useState(false);
  const editingLocked =
    isTranscribing ||
    isTranslatingGlobal ||
    isMerging ||
    isHighlightWorkflowLocked;
  // No manual language selection for transcription

  useEffect(() => {
    if (subtitle) {
      setLocalStart(secondsToSrtTime(subtitle.start));
      setLocalEnd(secondsToSrtTime(subtitle.end));
    }
  }, [subtitle]);

  if (!subtitle) {
    return null;
  }

  const splitLabel = t(
    'editSubtitles.item.splitTitle',
    'Split this line at the cursor'
  );
  const mergeLabel = t(
    'editSubtitles.item.mergeTitle',
    'Merge with the next line'
  );

  const commitTimeChange = (field: 'start' | 'end', value: string) => {
    if (editingLocked) return;
    const setLocal = field === 'start' ? setLocalStart : setLocalEnd;
    const stored = field === 'start' ? subtitle.start : subtitle.end;
    if (value.trim() === secondsToSrtTime(stored)) {
      setTimeError(null);
      return;
    }
    const result = validateCueTimeEdit({
      field,
      input: value,
      start: subtitle.start,
      end: subtitle.end,
    });
    if (!result.ok) {
      // Show the time the cue really has, and say why the edit didn't apply.
      setLocal(secondsToSrtTime(stored));
      setTimeError({ field, error: result.error });
      return;
    }
    setTimeError(null);
    actions.update({ [field]: result.seconds });
    setLocal(secondsToSrtTime(result.seconds));
  };

  const handleApplyShift = () => {
    if (editingLocked) return;
    const secs = Number(shiftAmount);
    if (Number.isFinite(secs) && secs !== 0) {
      actions.shift(secs);
      setShiftAmount('0');
    }
  };

  const handleRemove = () => {
    if (editingLocked) return;
    // No confirm: the editor offers Undo right after a delete.
    actions.remove();
  };

  const handleSplit = () => {
    if (editingLocked) return;
    // Typed text first, so the caret position matches the stored text.
    flushPendingEdits();
    useSubStore.getState().split(id, caretRef.current ?? undefined);
    caretRef.current = null;
  };

  const handleMergeWithNext = () => {
    if (editingLocked) return;
    flushPendingEdits();
    useSubStore.getState().mergeWithNext(id);
  };

  const handleInsertAfter = () => {
    if (editingLocked) return;
    actions.insertAfter();
  };

  async function handleTranscribeThisLine(
    gapThresholdSec: number = 3,
    range?: { start: number; end: number }
  ) {
    if (!videoPath || !subtitle || editingLocked || isMerging) return;
    // Out of minutes: the credits dialog now, not a progress window first.
    if (!precheckTranscriptionCredits()) return;
    try {
      setIsTranscribingOne(true);
      const operationId = `transcribe-${Date.now()}-${id}`;
      // Build context from up to 2 previous, unflagged (unseen LC) segments (no future text)
      const store = useSubStore.getState();
      const order = store.order;
      const idx = order.indexOf(id);

      // Determine unseen Whisper review ranges for this session (same logic as GapList)
      const seenLc = useUIStore.getState().seenLC;
      const unseenRanges = shouldUseWhisperReviewHints(
        store.transcriptionEngine
      )
        ? groupWhisperReviewRanges(order, store.segments).filter(
            r => !seenLc.has(`${r.start}-${r.end}`)
          )
        : [];

      const isInUnseenRange = (seg: any) =>
        unseenRanges.some(r => seg && seg.start >= r.start && seg.end <= r.end);

      // Collect up to 2 previous segments that are not flagged (i.e., not in unseen LC ranges)
      const prevContexts: any[] = [];
      for (let p = idx - 1; p >= 0 && prevContexts.length < 2; p--) {
        const s = store.segments[order[p]];
        if (!s) continue;
        if (!flattenText(s.original).length) continue;
        if (isInUnseenRange(s)) continue; // skip flagged
        prevContexts.push(s);
      }
      prevContexts.reverse(); // older → newer for readability

      const promptParts: string[] = [];
      for (const pc of prevContexts)
        promptParts.push(`${flattenText(pc.original)}`);
      const prompt = promptParts.join(' \n ');

      // Improve passes a wider window; the cue itself only changes once the
      // paid call succeeds, so a failure leaves the line as it was.
      const currentSeg = useSubStore.getState().segments[id];
      const segStart = range?.start ?? currentSeg?.start ?? subtitle.start;
      const segEnd = range?.end ?? currentSeg?.end ?? subtitle.end;

      if (!(await isSourceVideoPathAccessible(videoPath))) {
        useUrlStore
          .getState()
          .setOperationError(getSourceVideoUnavailableMessage());
        return;
      }

      const res = await transcribeOneLine({
        videoPath,
        sourceUrl,
        segment: { start: segStart, end: segEnd },
        promptContext: `${prompt}`,
        operationId,
      });
      const errorMsg = String(res.error || '').trim();
      const cancelled = Boolean(res.cancelled);
      const didFail = cancelled || res.success === false || errorMsg.length > 0;
      if (didFail) {
        if (!cancelled) {
          const sourceVideoError = getSourceVideoErrorMessage(errorMsg);
          const byoError = isByoError(errorMsg)
            ? getByoErrorMessage(errorMsg)
            : '';
          const friendlyError =
            sourceVideoError || byoError || errorMsg || 'Transcription failed';
          useUrlStore.getState().setOperationError(friendlyError);
        }
        return;
      }

      const segs = res.segments;
      if (Array.isArray(segs) && segs.length > 0) {
        // If improving with a tighter gap threshold, insert placeholders for any gaps >= threshold
        const withPlaceholders = synthesizePlaceholdersWithinWindow(
          segs.map(s => ({ start: s.start, end: s.end, original: s.original })),
          segStart,
          segEnd,
          gapThresholdSec
        );

        // Atomically replace current cue with segmented cues (including placeholders)
        useSubStore.getState().replaceWithSegments(id, withPlaceholders);
        // The old translation belonged to the old text.
        if (range) useSubStore.getState().update(id, { translation: '' });
        // Do not call bridgeGaps(3) here; it would remove sub-3s placeholders
        // that we intentionally added within the improve window.
      } else {
        const text = res.transcript?.trim();
        if (typeof text === 'string' && text.length > 0) {
          actions.update(
            range
              ? {
                  start: segStart,
                  end: segEnd,
                  original: text,
                  translation: '',
                }
              : { original: text }
          );
        }
        // Even if only text was updated, run a quick bridge to ensure placeholders exist
        try {
          useSubStore.getState().bridgeGaps(3);
        } catch {
          // no-op
        }
      }
    } catch (err) {
      console.error('[SubtitleEditor] single-line transcribe error:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      const friendlyError =
        getSourceVideoErrorMessage(errorMsg) ||
        (isByoError(errorMsg)
          ? getByoErrorMessage(errorMsg)
          : errorMsg || 'Transcription failed');
      useUrlStore.getState().setOperationError(friendlyError);
    } finally {
      setIsTranscribingOne(false);
    }
  }

  // Improve transcription by re-transcribing a window that bridges this cue's
  // neighbors, then running the same transcribe flow.
  async function handleImproveTranscription() {
    if (!videoPath || !subtitle || editingLocked || isMerging) return;
    // Determine neighbor-aware window
    const store = useSubStore.getState();
    const order = store.order;
    const idx = order.indexOf(id);
    const prev = idx > 0 ? store.segments[order[idx - 1]] : undefined;
    const next =
      idx + 1 < order.length ? store.segments[order[idx + 1]] : undefined;
    const newStart = Math.max(
      0,
      typeof prev?.end === 'number' ? prev.end : subtitle.start
    );
    const newEnd = typeof next?.start === 'number' ? next.start : subtitle.end;

    // If window is invalid or tiny, fall back to simple path
    if (!(newEnd - newStart > 0.05)) {
      await handleTranscribeThisLine(0.5);
      return;
    }

    // Transcribe the wider window; the current text and timing stay until a
    // result arrives.
    await handleTranscribeThisLine(0.5, { start: newStart, end: newEnd });
  }

  async function handleTranslateOneLine() {
    if (editingLocked || isMerging) return;
    if (!subtitle?.original?.trim()) return;
    if (useTaskStore.getState().transcription.inProgress) return;
    if (!precheckTranslationCredits()) return;
    try {
      setIsTranslatingOne(true);
      const operationId = `translate-missing-${Date.now()}-${id}`;
      setTranslationState({
        id: operationId,
        stage: t('generateSubtitles.status.starting', 'Starting...'),
        percent: 0,
        inProgress: true,
      });

      // Build context: take up to 2 previous and 2 next segments for context
      const store = useSubStore.getState();
      const order = store.order;
      const idx = order.indexOf(id);
      const pick = (k: number) => store.segments[order[k]];
      const ctxBefore = [] as any[];
      const ctxAfter = [] as any[];
      for (let k = Math.max(0, idx - 2); k < idx; k++) {
        const s = pick(k);
        if (!s) continue;
        ctxBefore.push({
          id: s.id,
          index: s.index,
          start: s.start,
          end: s.end,
          original: flattenText(s.original || ''),
          translation: flattenText(s.translation || ''),
        });
      }
      for (let k = idx + 1; k <= Math.min(order.length - 1, idx + 2); k++) {
        const s = pick(k);
        if (!s) continue;
        ctxAfter.push({
          id: s.id,
          index: s.index,
          start: s.start,
          end: s.end,
          original: flattenText(s.original || ''),
          translation: flattenText(s.translation || ''),
        });
      }

      const res = await SubtitlesIPC.translateOneLine({
        segment: {
          id: subtitle.id,
          index: subtitle.index,
          start: subtitle.start,
          end: subtitle.end,
          original: flattenText(subtitle.original),
        } as any,
        contextBefore: ctxBefore as any,
        contextAfter: ctxAfter as any,
        targetLanguage: targetLanguage || 'english',
        operationId,
      });

      if (res.cancelled) return;
      if (!res.success) {
        throw new Error(res.error || 'Subtitle cue translation failed.');
      }
      const translated = res.translation?.trim();
      if (!translated) {
        throw new Error('Subtitle cue translation returned no text.');
      }
      actions.update({ translation: translated });
      setTranslationState({
        stage: t('generateSubtitles.status.completed', 'Completed'),
        percent: 100,
        inProgress: false,
      });
    } catch (err) {
      console.error('[SubtitleEditor] single-line translate error:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      const friendlyError = isByoError(errorMsg)
        ? getByoErrorMessage(errorMsg)
        : t('generateSubtitles.status.error', 'Error');
      setTranslationState({
        stage: friendlyError,
        percent: 100,
        inProgress: false,
      });
    } finally {
      setIsTranslatingOne(false);
    }
  }

  async function handleImproveTranslation() {
    if (editingLocked || isMerging) return;
    if (!subtitle?.original?.trim()) return;
    if (useTaskStore.getState().transcription.inProgress) return;
    try {
      // The current translation stays until the new one arrives.
      await handleTranslateOneLine();
    } catch {
      // no-op, underlying handler logs
    }
  }

  return (
    <div className={subtitleRowCardStyles}>
      <div className={subtitleRowHeaderStyles}>
        <span className={subtitleRowIndexStyles}>#{subtitle.index}</span>
        <div className={subtitleRowHeaderActionsStyles}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => actions.seek()}
            title={t('editSubtitles.item.seekTitle')}
          >
            {t('editSubtitles.item.seek')}
          </Button>
          <Button
            variant={isPlaying ? 'danger' : 'secondary'}
            size="sm"
            onClick={() => (isPlaying ? actions.pause() : actions.play())}
            title={
              isPlaying
                ? t('editSubtitles.item.pauseSnippet')
                : t('editSubtitles.item.playSnippet')
            }
            aria-label={
              isPlaying
                ? t('editSubtitles.item.pauseSnippet')
                : t('editSubtitles.item.playSnippet')
            }
          >
            {isPlaying ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z" />
              </svg>
            )}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSplit}
            title={splitLabel}
            aria-label={splitLabel}
            disabled={editingLocked || subtitle.end - subtitle.start < 0.2}
            data-testid={`subtitle-split-${id}`}
          >
            <Scissors size={14} aria-hidden="true" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleMergeWithNext}
            title={mergeLabel}
            aria-label={mergeLabel}
            disabled={editingLocked || subtitle.index >= lineCount}
            data-testid={`subtitle-merge-${id}`}
          >
            <FoldVertical size={14} aria-hidden="true" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleInsertAfter}
            title={t('editSubtitles.item.insertTitle')}
            aria-label={t('editSubtitles.item.insertTitle')}
            disabled={editingLocked}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleRemove}
            title={t('editSubtitles.item.removeTitle')}
            aria-label={t('editSubtitles.item.removeTitle')}
            disabled={editingLocked}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
              <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
              <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
            </svg>
          </Button>
        </div>
      </div>

      <div className={subtitleRowContentStyles}>
        <div className={subtitleRowFieldShellStyles}>
          <div className={subtitleRowFieldStackStyles}>
            <div className={subtitleRowFieldLabelStyles}>
              {t('editSubtitles.workspace.originalLabel', 'Original')}
            </div>
            <SubtitleEditTextarea
              value={subtitle.original}
              searchTerm={searchText || ''}
              onChange={v => actions.update({ original: v })}
              onCaretChange={caret => {
                caretRef.current = { field: 'original', caret };
              }}
              rows={4}
              placeholder={t('editSubtitles.item.subtitlePlaceholder')}
              readOnly={editingLocked}
            />
          </div>
          {(!subtitle.original || !subtitle.original.trim()) && videoPath && (
            <div className={subtitleRowSideActionStyles}>
              <Button
                variant="success"
                size="lg"
                onClick={() => handleTranscribeThisLine()}
                disabled={
                  editingLocked ||
                  isTranslatingOne ||
                  isTranscribingOne ||
                  isMerging
                }
                isLoading={isTranscribingOne}
                title={t('input.transcribeOnly', 'Transcribe Audio')}
              >
                {t('input.transcribeOnly', 'Transcribe Audio')}
              </Button>

              {/* Language selection removed */}
            </div>
          )}

          {subtitle.original && subtitle.original.trim() && videoPath && (
            <div className={subtitleRowSideActionStyles}>
              <Button
                variant="secondary"
                size="md"
                onClick={handleImproveTranscription}
                disabled={
                  editingLocked ||
                  isTranslatingOne ||
                  isTranscribingOne ||
                  isMerging
                }
                isLoading={isTranscribingOne}
                title={t(
                  'subtitles.improveTranscription',
                  'Improve Transcription'
                )}
              >
                {t('subtitles.improveTranscription', 'Improve Transcription')}
              </Button>

              {/* Language selection removed */}
            </div>
          )}
        </div>

        {temporaryAffectedText && (
          <div className={subtitleRowOldTextStyles}>
            <span
              className="strike-fade"
              onAnimationEnd={() => {
                requestAnimationFrame(() =>
                  actions.update({ _oldText: undefined })
                );
              }}
            >
              {temporaryAffectedText}
            </span>
          </div>
        )}

        {subtitle.original && subtitle.original.trim() ? (
          <div className={subtitleRowFieldShellStyles}>
            <div className={subtitleRowFieldStackStyles}>
              <div className={subtitleRowFieldLabelStyles}>
                {t('editSubtitles.workspace.translationLabel', 'Translation')}
              </div>
              <SubtitleEditTextarea
                value={subtitle.translation ?? ''}
                searchTerm={searchText || ''}
                onChange={v => actions.update({ translation: v })}
                onCaretChange={caret => {
                  caretRef.current = { field: 'translation', caret };
                }}
                rows={4}
                placeholder={t('editSubtitles.item.subtitlePlaceholder')}
                readOnly={editingLocked}
              />
            </div>
            <div className={subtitleRowSideActionStyles}>
              <Button
                variant="secondary"
                size="md"
                onClick={handleImproveTranslation}
                disabled={editingLocked || isTranslatingOne || isMerging}
                isLoading={isTranslatingOne}
                title={
                  (subtitle.translation ?? '').trim()
                    ? t('subtitles.improveTranslation', 'Improve Translation')
                    : t('subtitles.translate', 'Translate')
                }
              >
                {(subtitle.translation ?? '').trim()
                  ? t('subtitles.improveTranslation', 'Improve Translation')
                  : t('subtitles.translate', 'Translate')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className={subtitleRowFooterStyles}>
          <div className={subtitleRowTimeGroupStyles} dir="ltr">
            <input
              type="text"
              value={localStart}
              onChange={e => {
                const val = e.target.value;
                if (PARTIAL_RX.test(val)) setLocalStart(val);
              }}
              onBlur={e => commitTimeChange('start', e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitTimeChange('start', localStart);
              }}
              className={cx(
                subtitleRowTimeInputStyles,
                timeError?.field === 'start' &&
                  subtitleRowTimeInputInvalidStyles
              )}
              aria-invalid={timeError?.field === 'start' || undefined}
              aria-describedby={
                timeError ? `subtitle-time-error-${id}` : undefined
              }
              aria-label={t(
                'editSubtitles.item.startTimeAria',
                'Start time of line {{index}}',
                { index: subtitle.index }
              )}
              data-testid={`subtitle-start-${id}`}
              disabled={editingLocked}
            />
            <span className={subtitleRowDividerStyles}>→</span>
            <input
              type="text"
              value={localEnd}
              onChange={e => {
                const val = e.target.value;
                if (PARTIAL_RX.test(val)) setLocalEnd(val);
              }}
              onBlur={e => commitTimeChange('end', e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitTimeChange('end', localEnd);
              }}
              className={cx(
                subtitleRowTimeInputStyles,
                timeError?.field === 'end' && subtitleRowTimeInputInvalidStyles
              )}
              aria-invalid={timeError?.field === 'end' || undefined}
              aria-describedby={
                timeError ? `subtitle-time-error-${id}` : undefined
              }
              aria-label={t(
                'editSubtitles.item.endTimeAria',
                'End time of line {{index}}',
                { index: subtitle.index }
              )}
              data-testid={`subtitle-end-${id}`}
              disabled={editingLocked}
            />
            <span className={subtitleRowDividerStyles}>|</span>
            <input
              type="number"
              step="0.1"
              value={shiftAmount}
              onChange={e => setShiftAmount(e.target.value)}
              className={subtitleRowTimeInputStyles}
              placeholder="0.5"
              title={t('editSubtitles.item.shiftTitle')}
              aria-label={t('editSubtitles.item.shiftTitle')}
              data-testid={`subtitle-shift-input-${id}`}
              disabled={editingLocked}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleApplyShift}
              disabled={editingLocked || Number(shiftAmount) === 0}
              data-testid={`subtitle-shift-button-${id}`}
            >
              {t('editSubtitles.item.applyShift')}
            </Button>
            {timeError && (
              <p
                id={`subtitle-time-error-${id}`}
                className={subtitleRowTimeErrorStyles}
                role="alert"
                dir="auto"
              >
                {timeError.error === 'endBeforeStart'
                  ? t(
                      'editSubtitles.item.timeEndBeforeStart',
                      'The end time must be after the start time. The line keeps its previous time.'
                    )
                  : t(
                      'editSubtitles.item.timeUnreadable',
                      'Type a time like 00:01:23,450 or 1:23.45. The line keeps its previous time.'
                    )}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
