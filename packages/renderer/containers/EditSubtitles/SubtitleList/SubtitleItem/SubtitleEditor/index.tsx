import { useState, useEffect } from 'react';
import Button from '../../../../../components/Button.js';
import SubtitleEditTextarea from './SubtitleEditTextarea.js';
import { useTranslation } from 'react-i18next';
import { useSubtitleRow } from '../../../../../state/subtitle-store.js';
import {
  secondsToSrtTime,
  srtStringToSeconds,
} from '../../../../../../shared/helpers/index.js';
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
import {
  flattenText,
  groupWhisperReviewRanges,
  shouldUseWhisperReviewHints,
  synthesizePlaceholdersWithinWindow,
} from '../../../../../utils/subtitle-heuristics.js';
import { getByoErrorMessage, isByoError } from '../../../../../utils/byoErrors';
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
  subtitleRowTimeGroupStyles,
  subtitleRowTimeInputStyles,
} from '../../../edit-workspace-styles';
// Language dropdown for transcription removed

const TIMECODE_RX = /^\d{2}:\d{2}:\d{2},\d{3}$/;
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
  const [isTranslatingOne, setIsTranslatingOne] = useState(false);
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
    isTranscribing || isTranslatingGlobal || isHighlightWorkflowLocked;
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

  const commitTimeChange = (field: 'start' | 'end', value: string) => {
    if (editingLocked) return;
    const trimmedValue = value.trim();
    if (TIMECODE_RX.test(trimmedValue)) {
      const seconds = srtStringToSeconds(trimmedValue);
      actions.update({ [field]: seconds });
      if (field === 'start') {
        setLocalStart(secondsToSrtTime(seconds));
      } else {
        setLocalEnd(secondsToSrtTime(seconds));
      }
    }
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
    const msg = t('editSubtitles.item.confirmRemove');
    if (window.confirm(msg)) {
      actions.remove();
    }
  };

  const handleInsertAfter = () => {
    if (editingLocked) return;
    actions.insertAfter();
  };

  async function handleTranscribeThisLine(gapThresholdSec: number = 3) {
    if (!videoPath || !subtitle || editingLocked || isMerging) return;
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

      // Always fetch latest times from the store (e.g., improve flow just expanded the window)
      const currentSeg = useSubStore.getState().segments[id];
      const segStart = currentSeg?.start ?? subtitle.start;
      const segEnd = currentSeg?.end ?? subtitle.end;

      const res = await transcribeOneLine({
        videoPath,
        sourceUrl,
        segment: { start: segStart, end: segEnd },
        promptContext: `${prompt}`,
        operationId,
      });

      const segs = (res as any)?.segments as any[] | undefined;
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
        // Do not call bridgeGaps(3) here; it would remove sub-3s placeholders
        // that we intentionally added within the improve window.
      } else {
        const text = (res as any)?.transcript?.trim();
        if (typeof text === 'string' && text.length > 0) {
          actions.update({ original: text });
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
    } finally {
      setIsTranscribingOne(false);
    }
  }

  // Improve transcription by expanding this cue to bridge between its
  // neighbors, clearing existing text, then running the same transcribe flow.
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

    // Clear current text and expand the cue window to bridge neighbors
    actions.update({
      start: newStart,
      end: newEnd,
      original: '',
      translation: '',
    });

    // Reuse the same transcribe flow (now using expanded times and empty text)
    await handleTranscribeThisLine(0.5);
  }

  async function handleTranslateOneLine() {
    if (editingLocked || isMerging) return;
    if (!subtitle?.original?.trim()) return;
    if (useTaskStore.getState().transcription.inProgress) return;
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

      const translated = (res as any)?.translation?.trim();
      if (translated) actions.update({ translation: translated });
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
      // Clear current translation so user sees fresh result intent
      actions.update({ translation: '' });
      await handleTranslateOneLine();
    } catch {
      // no-op, underlying handler logs
    }
  }

  return (
    <div className={subtitleRowCardStyles}>
      <div className={subtitleRowHeaderStyles}>
        <span className={subtitleRowIndexStyles}>
          #{subtitle.index}
        </span>
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
            variant={isPlaying ? 'danger' : 'primary'}
            size="sm"
            onClick={() => (isPlaying ? actions.pause() : actions.play())}
            title={
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
          {/* Removed small translate button next to the seek button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleInsertAfter}
            title={t('editSubtitles.item.insertTitle')}
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
              variant="primary"
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
              rows={4}
              placeholder={t('editSubtitles.item.subtitlePlaceholder')}
              readOnly={editingLocked}
            />
          </div>
          <div className={subtitleRowSideActionStyles}>
            <Button
              variant="primary"
              size="md"
              onClick={handleImproveTranslation}
              disabled={
                editingLocked ||
                isTranslatingOne ||
                isMerging
              }
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
        <div className={subtitleRowTimeGroupStyles}>
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
            className={subtitleRowTimeInputStyles}
            aria-label={`Start time for subtitle ${id}`}
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
            className={subtitleRowTimeInputStyles}
            aria-label={`End time for subtitle ${id}`}
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
        </div>
      </div>
      </div>
    </div>
  );
}
