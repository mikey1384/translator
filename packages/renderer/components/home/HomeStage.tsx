import {
  intoLanguageName,
  sentenceLanguageName,
} from '../../utils/languageName';
import { css, cx } from '@emotion/css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { VideoQuality } from '@shared-types/app';
import { colors, fonts, selectStyles } from '../../styles';
import { useUIStore, useVideoStore } from '../../state';
import { useUrlStore } from '../../state/url-store';
import { useVideoSuggestionStore } from '../../state/video-suggestion-store';
import { mapUiLanguageToTargetLanguage } from '../../state/ui-store';
import useDownloadedVideoLibrary from '../../containers/GenerateSubtitles/hooks/useDownloadedVideoLibrary.js';
import {
  quickPickTargetLanguages,
  readRecentTargetLanguages,
  rememberRecentTargetLanguage,
} from '../../constants/translation-language-native-names';
import { logButton } from '../../utils/logger';
import { openSubtitleFileIntoStore } from '../../utils/open-subtitle-file';
import HomeLanguagePicker from './HomeLanguagePicker';
import HomeRecentRow from './HomeRecentRow';
import { pickDroppedFile } from '../../utils/droppedFiles';
import {
  dropBlockReason,
  dropBlockedMessage,
  handleWindowFileDrop,
} from '../../utils/mediaDrop';
import { isLocalRecentItem, mergeHomeRecentItems } from './home-recent';

const page = css`
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  /* The bottom room lets every row scroll clear of the floating
     scroll-to-top button (56px + 30px inset; 40px + 12px when narrow). */
  padding: 28px 0 96px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 26px;
  box-sizing: border-box;

  @media (max-width: 576px) {
    padding-bottom: 64px;
  }
`;

const headline = css`
  margin: 0;
  font-family: ${fonts.display};
  font-weight: 800;
  font-size: clamp(2.2rem, 4.6vw, 3.4rem);
  line-height: 1.04;
  letter-spacing: -0.035em;
  text-align: center;
  color: ${colors.text};
  text-wrap: balance;
`;

const headlineLanguage = css`
  color: ${colors.primary};
`;

const stage = (dragging: boolean) => css`
  width: 100%;
  box-sizing: border-box;
  padding: 24px;
  border-radius: 28px;
  border: 2px dashed ${dragging ? colors.primary : colors.borderStrong};
  background: ${dragging ? 'rgba(255, 216, 77, 0.06)' : colors.surfaceSoft};
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
`;

const linkRow = css`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`;

const linkInput = css`
  flex: 1 1 320px;
  min-width: 0;
  height: 56px;
  box-sizing: border-box;
  padding: 0 18px;
  border-radius: 16px;
  border: 1px solid ${colors.borderStrong};
  background: ${colors.bg};
  color: ${colors.text};
  font: inherit;
  font-size: 1.02rem;
  outline: none;

  &:focus {
    border-color: ${colors.primary};
  }

  &::placeholder {
    color: ${colors.gray};
  }
`;

const primaryButton = css`
  flex: 0 0 auto;
  height: 56px;
  padding: 0 24px;
  border-radius: 16px;
  border: 0;
  background: ${colors.primary};
  color: ${colors.onPrimary};
  font: inherit;
  font-size: 1.02rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    background 0.12s ease;

  &:hover:not(:disabled) {
    background: ${colors.primaryLight};
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid ${colors.primaryLight};
    outline-offset: 3px;
  }
`;

const linkActions = css`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  max-width: 100%;

  button {
    flex: 1 1 auto;
    min-width: 0;
    height: auto;
    min-height: 56px;
    padding-top: 12px;
    padding-bottom: 12px;
    overflow-wrap: anywhere;
  }
`;

const downloadButton = css`
  border: 1px solid ${colors.borderStrong};
  background: ${colors.surfaceRaised};
  color: ${colors.text};

  &:hover:not(:disabled) {
    border-color: ${colors.gray};
    background: ${colors.surfaceRaised};
  }
`;

const secondaryButton = css`
  height: 40px;
  padding: 0 16px;
  border-radius: 20px;
  border: 1px solid ${colors.borderStrong};
  background: ${colors.surfaceRaised};
  color: ${colors.text};
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: ${colors.gray};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const stageFooter = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.86rem;
  color: ${colors.textDim};
`;

const helperGroup = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
`;

const intoGroup = css`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const textLink = css`
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  background: none;
  border: 0;
  padding: 0 2px;
  font: inherit;
  font-size: 0.86rem;
  color: ${colors.textDim};
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: ${colors.borderStrong};
  text-underline-offset: 3px;

  &:hover:not(:disabled) {
    color: ${colors.text};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const optionsRow = css`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.86rem;
  color: ${colors.textDim};

  select {
    max-width: 220px;
  }
`;

const dropMessage = css`
  font-size: 0.86rem;
  color: ${colors.warning};
`;

const cancelNote = css`
  font-size: 0.86rem;
  color: ${colors.textDim};
`;

const quietLinks = css`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 22px;
`;

const findRow = css`
  width: 100%;
  display: flex;
  gap: 10px;
  align-items: center;
`;

const findInput = css`
  flex: 1;
  min-width: 0;
  height: 46px;
  box-sizing: border-box;
  padding: 0 14px 0 40px;
  border-radius: 12px;
  border: 1px solid ${colors.border};
  background: transparent
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23A39FAD' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M20 20l-3.5-3.5'/%3E%3C/svg%3E")
    no-repeat 14px center;
  color: ${colors.text};
  font: inherit;
  font-size: 0.95rem;
  outline: none;

  &:focus {
    border-color: ${colors.borderStrong};
  }

  &::placeholder {
    color: ${colors.gray};
  }
`;

const visuallyHidden = css`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
`;

export default function HomeStage() {
  const { t, i18n } = useTranslation();
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const urlInput = useUrlStore(s => s.urlInput);
  const setUrlInput = useUrlStore(s => s.setUrlInput);
  const downloadQuality = useUrlStore(s => s.downloadQuality);
  const setDownloadQuality = useUrlStore(s => s.setDownloadQuality);
  const downloadInProgress = useUrlStore(s => s.download.inProgress);
  const linkError = useUrlStore(s => s.error);
  const downloadCancelled = useUrlStore(
    s => s.download.stage === 'Cancelled' && Boolean(s.download.id)
  );
  const library = useDownloadedVideoLibrary(
    i18n.resolvedLanguage || i18n.language || 'en'
  );
  const recentLocalMedia = useVideoStore(s => s.recentLocalMedia);
  useEffect(() => {
    // Home is where Recent shows: re-read it (files opened in this session
    // included) and drop files that are gone.
    void useVideoStore.getState().refreshRecentLocalMedia();
  }, []);
  const recentItems = useMemo(
    () => mergeHomeRecentItems(library.downloadHistory, recentLocalMedia),
    [library.downloadHistory, recentLocalMedia]
  );
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [recentLanguages, setRecentLanguages] = useState(
    readRecentTargetLanguages
  );
  const dragDepth = useRef(0);
  const linkRef = useRef<HTMLInputElement>(null);

  const language =
    targetLanguage && targetLanguage !== 'original'
      ? targetLanguage
      : mapUiLanguageToTargetLanguage(i18n.language);
  const languageName = sentenceLanguageName(
    t(`languages.${language}`, { defaultValue: language }),
    i18n.language
  );
  const languageInto = intoLanguageName(language, languageName, i18n.language);
  const quickPicks = useMemo(
    () =>
      quickPickTargetLanguages({
        current: language,
        uiLanguageTarget: mapUiLanguageToTargetLanguage(
          i18n.resolvedLanguage || i18n.language
        ),
        recent: recentLanguages,
      }),
    [language, i18n.language, i18n.resolvedLanguage, recentLanguages]
  );

  const chooseLanguage = (value: string) => {
    useUIStore.getState().chooseTargetLanguage(value);
    rememberRecentTargetLanguage(value);
    setRecentLanguages(readRecentTargetLanguages());
  };

  const ensureLanguage = () => {
    if (targetLanguage !== language) chooseLanguage(language);
    else rememberRecentTargetLanguage(language);
  };

  const runUrl = (target: 'download' | 'translate' = 'translate') => {
    const url = urlInput.trim();
    if (!url) {
      linkRef.current?.focus();
      return;
    }
    logButton(
      target === 'download' ? 'home_download_only' : 'home_make_it_speak_url'
    );
    if (target === 'translate') ensureLanguage();
    useUIStore.getState().requestHomeRun({ kind: 'url', url, target });
  };

  const runMountedFile = () => {
    const path = useVideoStore.getState().path;
    if (!path) return;
    ensureLanguage();
    useUIStore.getState().requestHomeRun({ kind: 'mounted', path });
  };

  const chooseFile = async () => {
    logButton('home_choose_file');
    const result = await useVideoStore
      .getState()
      .openLocalMedia({ preserveSubtitles: false });
    if (result?.canceled) return;
    runMountedFile();
  };

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    setDropError(null);
    const picked = pickDroppedFile(Array.from(event.dataTransfer.files || []));
    if (!picked) return;
    const blocked = dropBlockReason();
    if (blocked) {
      setDropError(dropBlockedMessage(blocked));
      return;
    }
    // "Edit an existing .srt" by dropping it: open it in the editor.
    if (picked.kind === 'subtitle') {
      logButton('home_drop_srt');
      void handleWindowFileDrop([picked.file]);
      return;
    }
    const path = window.fileApi.getPathForFile(picked.file);
    if (!path || picked.kind !== 'media') {
      setDropError(
        t('home.dropNotMedia', 'Drop a video or audio file to translate it.')
      );
      return;
    }
    logButton('home_drop_file');
    const opened = await useVideoStore
      .getState()
      .openRecentLocalMedia(path, { preserveSubtitles: false });
    if (!opened.opened) {
      // Declined = the user kept their unsaved subtitle edits; not an error.
      if (!opened.declined) {
        setDropError(
          t('home.dropOpenFailed', 'That file could not be opened.')
        );
      }
      return;
    }
    runMountedFile();
  };

  const openEditor = () => {
    logButton('home_open_editor');
    // Opening an existing .srt is about editing it, so the editor starts on.
    useUIStore.getState().setSubtitleEditMode(true);
    useUIStore.getState().setEditPanelOpen(true);
  };

  // "Burn subtitles into a video": the video, then its .srt, then straight
  // to the export sheet.
  const burnSubtitles = async () => {
    logButton('home_burn_subtitles');
    const video = await useVideoStore.getState().openLocalMedia({
      preserveSubtitles: false,
      title: t('home.burnChooseVideo', 'Choose the video'),
    });
    if (video?.canceled) return;
    const subtitles = await openSubtitleFileIntoStore({
      dialogTitle: t(
        'home.burnChooseSubtitles',
        'Choose the subtitles to burn in'
      ),
    });
    if (subtitles.status === 'error') {
      useUrlStore
        .getState()
        .setValidationError(
          t('common.error.failedToLoadSRT', 'Failed to load SRT file')
        );
      return;
    }
    if (subtitles.status !== 'loaded') return;
    useUIStore.getState().setExportSheetOpen(true);
  };

  const findVideos = () => {
    logButton('home_find_videos');
    const ui = useUIStore.getState();
    ui.setGenerateSubtitlesWorkspaceTab('main');
    ui.setGeneratePanelOpen(true);
    // The panel opens itself, runs the free YouTube search for these words
    // and focuses its chat box (VideoSuggestionPanel).
    useVideoSuggestionStore.getState().requestHomeSearch(findQuery);
  };

  const openRecent = async (
    item: Parameters<typeof library.openDownloadedVideo>[0]
  ) => {
    if (isLocalRecentItem(item) && item.localPath) {
      logButton('home_open_recent_local');
      // Missing files drop out of the list; unsaved edits are asked about.
      await useVideoStore
        .getState()
        .openRecentLocalMedia(item.localPath, { preserveSubtitles: false });
      return;
    }
    // Opens any local copy of this video; downloads only when none is left.
    logButton('home_open_recent');
    await library.openOrDownloadHistoryItem(item);
  };

  const seeAll = () => {
    const ui = useUIStore.getState();
    ui.setGenerateSubtitlesWorkspaceTab('history');
    ui.setGeneratePanelOpen(true);
  };

  return (
    <div className={page}>
      <h1 className={headline}>
        <Trans
          i18nKey="home.headline"
          defaults="Translate videos to <lang>{{language}}</lang>."
          values={{ language: languageName, languageInto }}
          components={{ lang: <span className={headlineLanguage} /> }}
        />
      </h1>

      <section
        className={stage(dragging)}
        aria-label={t('home.stageLabel', 'Add a video')}
        onDragEnter={event => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={event => void onDrop(event)}
      >
        <form
          className={linkRow}
          onSubmit={event => {
            event.preventDefault();
            runUrl();
          }}
        >
          <label htmlFor="home-link" className={visuallyHidden}>
            {t('home.linkLabel', 'Video link')}
          </label>
          <input
            id="home-link"
            ref={linkRef}
            className={linkInput}
            value={urlInput}
            onChange={event => {
              setUrlInput(event.target.value);
              setDropError(null);
            }}
            placeholder={
              dragging
                ? t(
                    'home.dropHere',
                    'Drop a video here to translate it to {{language}}',
                    {
                      language: languageName,
                      languageInto,
                    }
                  )
                : t('home.linkPlaceholder', 'Paste a video link')
            }
            disabled={downloadInProgress}
          />
          <div className={linkActions}>
            <button
              type="submit"
              className={primaryButton}
              disabled={downloadInProgress}
            >
              {t('home.makeItSpeak', 'Translate to {{language}}', {
                language: languageName,
                languageInto,
              })}
            </button>
            <button
              type="button"
              className={cx(primaryButton, downloadButton)}
              onClick={() => runUrl('download')}
              disabled={downloadInProgress}
            >
              {t('home.downloadOnly', 'Download only')}
            </button>
          </div>
        </form>

        <div className={stageFooter}>
          <div className={helperGroup}>
            <span>
              {t(
                'home.helper',
                'Paste a link from YouTube, TikTok, Instagram or X — or drop a video file here'
              )}
            </span>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => void chooseFile()}
              disabled={downloadInProgress}
            >
              {t('home.chooseFile', 'Choose file')}
            </button>
          </div>
          <div className={intoGroup}>
            <span>{t('home.into', 'Into')}</span>
            <HomeLanguagePicker
              value={language}
              quickPicks={quickPicks}
              onChange={chooseLanguage}
              disabled={downloadInProgress}
            />
          </div>
        </div>

        {dropError || linkError ? (
          <span className={dropMessage} role="alert">
            {dropError || linkError}
          </span>
        ) : downloadCancelled ? (
          <span className={cancelNote} role="status">
            {t('home.downloadCancelled', 'Download cancelled.')}
          </span>
        ) : null}

        {showOptions ? (
          <div className={optionsRow}>
            <label htmlFor="home-quality">
              {t('home.downloadQuality', 'Download quality')}
            </label>
            <select
              id="home-quality"
              className={selectStyles}
              value={downloadQuality}
              onChange={event =>
                setDownloadQuality(event.target.value as VideoQuality)
              }
              disabled={downloadInProgress}
            >
              <optgroup label={t('input.qualityPresets', 'Presets')}>
                <option value="high">{t('input.qualityBest', 'Best')}</option>
                <option value="mid">{t('input.qualityMedium')}</option>
                <option value="low">{t('input.qualityLow')}</option>
              </optgroup>
              <optgroup label={t('input.qualityResolution', 'Resolution')}>
                <option value="4320p">{t('input.quality8k', 'UHD 8K')}</option>
                <option value="2160p">{t('input.quality4k', 'HD 4K')}</option>
                <option value="1440p">{t('input.quality2k', 'HQ 2K')}</option>
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
                <option value="480p">480p</option>
                <option value="360p">360p</option>
                <option value="240p">240p</option>
              </optgroup>
            </select>
            <button
              type="button"
              className={textLink}
              onClick={() => setShowOptions(false)}
            >
              {t('home.hideOptions', 'Hide options')}
            </button>
          </div>
        ) : (
          <div>
            <button
              type="button"
              className={textLink}
              onClick={() => setShowOptions(true)}
            >
              {t('home.options', 'Options')}
            </button>
          </div>
        )}
      </section>

      <div className={quietLinks}>
        <button type="button" className={textLink} onClick={openEditor}>
          {t('home.editSrt', 'Edit an existing .srt')}
        </button>
        <button
          type="button"
          className={textLink}
          onClick={() => void burnSubtitles()}
        >
          {t('home.burnSubtitles', 'Burn subtitles into a video')}
        </button>
      </div>

      <form
        className={findRow}
        onSubmit={event => {
          event.preventDefault();
          findVideos();
        }}
      >
        <label htmlFor="home-find" className={visuallyHidden}>
          {t('home.findLabel', 'Find a video')}
        </label>
        <input
          id="home-find"
          className={findInput}
          value={findQuery}
          onChange={event => setFindQuery(event.target.value)}
          placeholder={t(
            'home.findPlaceholder',
            'Not sure what to watch? Describe it — e.g. Korean street food vlogs'
          )}
        />
        <button type="submit" className={cx(secondaryButton)}>
          {t('home.findButton', 'Find videos')}
        </button>
      </form>

      <HomeRecentRow
        items={recentItems}
        onOpen={item => void openRecent(item)}
        onSeeAll={seeAll}
      />
      {library.error ? (
        <span className={dropMessage} role="alert">
          {library.error}
        </span>
      ) : null}
    </div>
  );
}
