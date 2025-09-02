import { css } from '@emotion/css';
import Button from '../../components/Button';
import { colors, selectStyles } from '../../styles';
import {
  useSubStore,
  useTaskStore,
  useUIStore,
  useVideoStore,
} from '../../state';
import { useTranslation } from 'react-i18next';
import {
  openSubtitleWithElectron,
  buildSrt,
  parseSrt,
  secondsToSrtTime,
} from '../../../shared/helpers';
import * as SubtitlesIPC from '../../ipc/subtitles';

export default function SideMenu() {
  const { t } = useTranslation();
  const hasSubs = useSubStore(s => s.order.length > 0);
  const { order, segments, originalPath, scrollToCurrent } = useSubStore(s => ({
    order: s.order,
    segments: s.segments,
    originalPath: s.originalPath,
    scrollToCurrent: s.scrollToCurrent,
  }));
  const setTranslation = useTaskStore(s => s.setTranslation);
  const targetLanguage = useUIStore(s => s.targetLanguage || 'english');
  const setTargetLanguage = useUIStore(s => s.setTargetLanguage);
  const openVideo = useVideoStore(s => s.openFileDialogPreserveSubs);

  const hasUntranslated = hasSubs
    ? order.some(id => {
        const seg = segments[id];
        return (seg.original || '').trim() && !(seg.translation || '').trim();
      })
    : false;

  async function handleTranslateMissing() {
    try {
      const missing = order
        .map(id => segments[id])
        .filter(
          s => (s.original || '').trim() && !(s.translation || '').trim()
        );
      if (!missing.length) return;

      const srtContent = buildSrt({ segments: missing, mode: 'original' });
      const operationId = `translate-missing-${Date.now()}`;

      setTranslation({
        id: operationId,
        stage: t('generateSubtitles.status.starting', 'Starting...'),
        percent: 0,
        inProgress: true,
      });

      const res = await SubtitlesIPC.translateSubtitles({
        subtitles: srtContent,
        targetLanguage,
        operationId,
      });

      if (res?.translatedSubtitles) {
        const translatedSegs = parseSrt(res.translatedSubtitles);
        const byTimeKey = new Map<string, string | undefined>();
        for (const seg of translatedSegs) {
          const key = `${secondsToSrtTime(seg.start)}-->${secondsToSrtTime(seg.end)}`;
          byTimeKey.set(key, seg.translation);
        }

        // Apply translations back to store for only missing ones
        const store = useSubStore.getState();
        for (const seg of missing) {
          const key = `${secondsToSrtTime(seg.start)}-->${secondsToSrtTime(seg.end)}`;
          const translated = byTimeKey.get(key);
          if (translated && translated.trim()) {
            store.update(seg.id, { translation: translated });
          }
        }

        setTranslation({
          stage: t('generateSubtitles.status.completed', 'Completed'),
          percent: 100,
          inProgress: false,
        });
      } else {
        setTranslation({ inProgress: false });
      }
    } catch (err) {
      console.error('[SideMenu] translate missing error:', err);
      setTranslation({
        stage: t('generateSubtitles.status.error', 'Error'),
        percent: 100,
        inProgress: false,
      });
    }
  }

  async function handleMountOrChangeSrt() {
    const res = await openSubtitleWithElectron();
    if (res?.segments) {
      useSubStore.getState().load(res.segments, res.filePath ?? null);
    }
  }

  if (!hasSubs) return null;

  return (
    <div
      className={css`
        position: absolute;
        right: 10px;
        top: 10px;
        z-index: 11;
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid ${colors.border};
        border-radius: 6px;
        padding: 8px;
        backdrop-filter: blur(4px);
      `}
      aria-label="Video side actions"
    >
      <Button
        size="sm"
        variant="secondary"
        onClick={() => openVideo()}
        title={t('videoPlayer.changeVideo', 'Change Video')}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginRight: 8 }}
        >
          <rect x="3" y="5" width="18" height="14" rx="2" ry="2" />
          <path d="M7 9l5 3-5 3z" />
        </svg>
        {t('videoPlayer.changeVideo', 'Change Video')}
      </Button>

      <Button
        size="sm"
        variant="secondary"
        onClick={handleMountOrChangeSrt}
        title={
          originalPath
            ? t('videoPlayer.changeSrt', 'Change SRT')
            : t('videoPlayer.mountSrt', 'Mount SRT')
        }
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginRight: 8 }}
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        {originalPath
          ? t('videoPlayer.changeSrt', 'Change SRT')
          : t('videoPlayer.mountSrt', 'Mount SRT')}
      </Button>

      <Button
        size="sm"
        variant="secondary"
        onClick={() => scrollToCurrent()}
        title={t(
          'videoPlayer.scrollToCurrentSubtitle',
          'Scroll to current subtitle'
        )}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginRight: 8 }}
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 1-7 7" />
          <path d="M12 5a7 7 0 0 1 7 7" />
          <path d="M5 12a7 7 0 0 1 7-7" />
          <path d="M12 19a7 7 0 0 1-7-7" />
        </svg>
        {t('videoPlayer.scrollToCurrentSubtitle', 'Scroll to current subtitle')}
      </Button>

      {hasUntranslated && (
        <div
          className={css`
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 4px;
          `}
        >
          <label
            className={css`
              color: ${colors.light};
              font-size: 0.9rem;
            `}
          >
            {t('subtitles.outputLanguage')}
          </label>
          <select
            className={selectStyles}
            value={targetLanguage}
            onChange={e => setTargetLanguage(e.target.value)}
          >
            <option value="english">{t('languages.english')}</option>
            <option value="korean">{t('languages.korean')}</option>
            <option value="japanese">{t('languages.japanese')}</option>
            <option value="chinese_simplified">
              {t('languages.chinese_simplified')}
            </option>
            <option value="chinese_traditional">
              {t('languages.chinese_traditional')}
            </option>
            <option value="spanish">{t('languages.spanish')}</option>
            <option value="french">{t('languages.french')}</option>
            <option value="german">{t('languages.german')}</option>
            <option value="portuguese">{t('languages.portuguese')}</option>
            <option value="russian">{t('languages.russian')}</option>
            <option value="vietnamese">{t('languages.vietnamese')}</option>
            <option value="turkish">{t('languages.turkish')}</option>
          </select>

          <Button
            size="sm"
            variant="primary"
            onClick={handleTranslateMissing}
            title={t('subtitles.translate', 'Translate')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: 8 }}
            >
              <path d="M4 7h16" />
              <path d="M9 7c0 7 6 7 6 14" />
              <path d="M12 20l4-4" />
              <path d="M20 20l-4-4" />
            </svg>
            {t('subtitles.translate', 'Translate')}
          </Button>
        </div>
      )}
    </div>
  );
}
