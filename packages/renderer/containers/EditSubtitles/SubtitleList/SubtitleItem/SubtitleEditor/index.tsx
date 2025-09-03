import { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import Button from '../../../../../components/Button.js';
import { colors } from '../../../../../styles.js';
import SubtitleEditTextarea from './SubtitleEditTextarea.js';
import { useTranslation } from 'react-i18next';
import { useSubtitleRow } from '../../../../../state/subtitle-store.js';
import {
  secondsToSrtTime,
  srtStringToSeconds,
  buildSrt,
  parseSrt,
} from '../../../../../../shared/helpers/index.js';
import { useRowActions } from '../../../../../hooks/useRowActions.js';
import * as SubtitlesIPC from '../../../../../ipc/subtitles';
import { useUIStore, useTaskStore, useVideoStore } from '../../../../../state';
import { transcribeOneLine } from '../../../../../ipc/subtitles';
import * as SystemIPC from '../../../../../ipc/system';
import { useSubStore } from '../../../../../state/subtitle-store';

const timeInputStyles = css`
  width: 150px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid ${colors.border};
  background-color: ${colors.grayLight};
  color: ${colors.dark};
  font-family: monospace;
  transition: border-color 0.2s ease;
  &:focus {
    outline: none;
    border-color: ${colors.primary};
  }
`;

const actionButtonsStyles = css`
  display: flex;
  gap: 8px;
  align-items: center;
`;

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
  const videoPath = useVideoStore(s => s.path);
  const [isTranscribingOne, setIsTranscribingOne] = useState(false);
  const editingLocked = isTranscribing || isTranslatingGlobal;

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
    const secs = Number(shiftAmount);
    if (Number.isFinite(secs) && secs !== 0) {
      actions.shift(secs);
      setShiftAmount('0');
    }
  };

  const handleRemove = () => {
    const msg = t('editSubtitles.item.confirmRemove');
    if (window.confirm(msg)) {
      actions.remove();
    }
  };

  async function handleTranscribeThisLine() {
    if (!videoPath || !subtitle) return;
    try {
      setIsTranscribingOne(true);
      const operationId = `transcribe-${Date.now()}-${id}`;
      // Build simple prompt from neighbors
      const store = useSubStore.getState();
      const order = store.order;
      const idx = order.indexOf(id);
      const prev = idx > 0 ? store.segments[order[idx - 1]] : undefined;
      const next = idx + 1 < order.length ? store.segments[order[idx + 1]] : undefined;
      const flatten = (s: string) => (s || '').replace(/\s*\n+\s*/g, ' ').trim();
      const promptParts = [] as string[];
      if (prev?.original) promptParts.push(`Prev: ${flatten(prev.original)}`);
      if (next?.original) promptParts.push(`Next: ${flatten(next.original)}`);
      const prompt = promptParts.join(' \n ');

      const res = await transcribeOneLine({
        videoPath,
        segment: { start: subtitle.start, end: subtitle.end },
        promptContext: prompt,
        operationId,
      });

      const segs = (res as any)?.segments as any[] | undefined;
      if (Array.isArray(segs) && segs.length > 0) {
        // Atomically replace current cue with segmented cues using the store helper
        useSubStore.getState().replaceWithSegments(
          id,
          segs.map(s => ({ start: s.start, end: s.end, original: s.original }))
        );
      } else {
        const text = (res as any)?.transcript?.trim();
        if (typeof text === 'string' && text.length > 0) {
          actions.update({ original: text });
        }
      }
    } catch (err) {
      console.error('[SubtitleEditor] single-line transcribe error:', err);
    } finally {
      setIsTranscribingOne(false);
    }
  }

  async function handleTranslateOneLine() {
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
      const flatten = (s: string) => (s || '').replace(/\s*\n+\s*/g, ' ').trim();
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
          original: flatten(s.original || ''),
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
          original: flatten(s.original || ''),
        });
      }

      const res = await SubtitlesIPC.translateOneLine({
        segment: {
          id: subtitle.id,
          index: subtitle.index,
          start: subtitle.start,
          end: subtitle.end,
          original: flatten(subtitle.original),
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
      setTranslationState({
        stage: t('generateSubtitles.status.error', 'Error'),
        percent: 100,
        inProgress: false,
      });
    } finally {
      setIsTranslatingOne(false);
    }
  }

  return (
    <div
      className={css`
        background-color: ${colors.light};
        border: 1px solid ${colors.border};
        border-radius: 8px;
        padding: 15px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      `}
    >
      <div
        className={css`
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        `}
      >
        <span
          className={css`
            font-weight: bold;
            color: ${colors.grayDark};
            font-size: 1.1em;
          `}
        >
          #{subtitle.index}
        </span>
        <div className={actionButtonsStyles}>
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
                style={{ verticalAlign: 'middle' }}
              >
                <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                style={{ verticalAlign: 'middle' }}
              >
                <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z" />
              </svg>
            )}
          </Button>
          {!(subtitle.translation ?? '').trim() && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleTranslateOneLine}
              disabled={
                isTranscribing ||
                isTranslatingOne ||
                !(subtitle.original ?? '').trim()
              }
              isLoading={isTranslatingOne}
              title={t('subtitles.translate')}
            >
              {isTranslatingOne
                ? t('generateSubtitles.status.starting')
                : t('subtitles.translate')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => actions.insertAfter()}
            title={t('editSubtitles.item.insertTitle')}
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
              style={{ verticalAlign: 'middle' }}
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
              style={{ verticalAlign: 'middle' }}
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

      <SubtitleEditTextarea
        value={subtitle.original}
        searchTerm={searchText || ''}
        onChange={v => actions.update({ original: v })}
        rows={4}
        placeholder={t('editSubtitles.item.subtitlePlaceholder')}
        readOnly={editingLocked}
      />

      {temporaryAffectedText && (
        <div
          className={css`
            font-size: 0.95em;
            line-height: 1.5;
            margin-bottom: 5px;
            white-space: pre-wrap;
          `}
        >
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

      {(!subtitle.original || !subtitle.original.trim()) && videoPath ? (
        <div className={css`display: flex; justify-content: center;`}>
          <Button
            variant="primary"
            size="sm"
            onClick={handleTranscribeThisLine}
            disabled={isTranscribing || isTranslatingOne || isTranscribingOne}
            isLoading={isTranscribingOne}
            title={t('input.transcribeOnly', 'Transcribe Audio')}
          >
            {t('input.transcribeOnly', 'Transcribe Audio')}
          </Button>
        </div>
      ) : (
        <SubtitleEditTextarea
          value={subtitle.translation ?? ''}
          searchTerm={searchText || ''}
          onChange={v => actions.update({ translation: v })}
          rows={4}
          placeholder={t('editSubtitles.item.subtitlePlaceholder')}
          readOnly={editingLocked}
        />
      )}

      <div
        className={css`
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        `}
      >
        <div className={actionButtonsStyles}>
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
            className={timeInputStyles}
            aria-label={`Start time for subtitle ${id}`}
            data-testid={`subtitle-start-${id}`}
          />
          <span>→</span>
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
            className={timeInputStyles}
            aria-label={`End time for subtitle ${id}`}
            data-testid={`subtitle-end-${id}`}
          />
          <span style={{ marginLeft: '8px', color: colors.gray }}>|</span>
          <input
            type="number"
            step="0.1"
            value={shiftAmount}
            onChange={e => setShiftAmount(e.target.value)}
            className={timeInputStyles}
            placeholder="0.5"
            title={t('editSubtitles.item.shiftTitle')}
            data-testid={`subtitle-shift-input-${id}`}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleApplyShift}
            disabled={Number(shiftAmount) === 0}
            data-testid={`subtitle-shift-button-${id}`}
          >
            {t('editSubtitles.item.applyShift')}
          </Button>
        </div>
      </div>
    </div>
  );
  }
