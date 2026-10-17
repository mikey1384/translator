import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import LogoDisplay from '../components/LogoDisplay';
import LanguageSwitcher from '../components/LanguageSwitcher';
import CreditMinutesPill from '../components/CreditMinutesPill';
import SettingsButton from '../components/SettingsButton';
import HeaderMenu from '../components/HeaderMenu';
import { useSubStore, useTaskStore, useUIStore, useVideoStore } from '../state';
import { useUrlStore } from '../state/url-store';
import {
  rememberLeftDocument,
  saveMountedSubtitleDocument,
} from '../utils/subtitle-documents';
import { logButton } from '../utils/logger';
import { openNotice } from '../state/modal-store';
import { didSaveSubtitleFile, saveSubtitlesAs } from '../utils/saveSubtitles';
import { i18n } from '../i18n';
import { spacing } from '../components/design-system/tokens.js';

const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: ${spacing.lg};
  padding: ${spacing.md} ${spacing.xs};
  margin-bottom: ${spacing.md};

  @media (max-width: 640px) {
    gap: ${spacing.sm};
    padding: ${spacing.sm} 0;
  }
`;

const homeButton = css`
  display: inline-flex;
  align-items: center;
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  cursor: pointer;
  border-radius: 8px;

  &:disabled {
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 216, 77, 0.6);
    outline-offset: 4px;
  }
`;

const rightGroup = css`
  display: flex;
  align-items: center;
  gap: ${spacing.md};
  justify-content: flex-end;
  min-width: 0;
  flex: 0 1 auto;

  & > * {
    flex: none;
  }
  & > :first-child {
    flex: 0 1 auto;
    min-width: 0;
  }

  @media (max-width: 640px) {
    gap: ${spacing.sm};
  }
`;

// Below this width Settings becomes a gear so the header stays one row.
const wideOnly = css`
  @media (max-width: 720px) {
    display: none;
  }
`;

const narrowOnly = css`
  display: none;

  @media (max-width: 720px) {
    display: inline-flex;
  }
`;

/**
 * The logo always leads home, except while a job is running (leaving would
 * cut it off). With a video open, its subtitles are saved to the library
 * first, so opening it again from Recent brings everything back.
 */
function useCanGoHome(): boolean {
  const hasVideo = useVideoStore(s => Boolean(s.url || s.path));
  const hasSubtitles = useSubStore(s => s.order.length > 0);
  const busy = useTaskStore(
    s =>
      s.transcription.inProgress ||
      s.translation.inProgress ||
      s.dubbing.inProgress ||
      s.merge.inProgress ||
      s.summary.inProgress
  );
  const downloading = useUrlStore(s => s.download.inProgress);
  const panelsOpen = useUIStore(s => s.showGeneratePanel || s.showEditPanel);
  if (busy || downloading) return false;
  return panelsOpen || hasVideo || hasSubtitles;
}

/** Same rule as the logo, read outside React (agent navigation). */
export function homeBlockedByRunningJob(): boolean {
  const task = useTaskStore.getState();
  return Boolean(
    task.transcription.inProgress ||
    task.translation.inProgress ||
    task.dubbing.inProgress ||
    task.merge.inProgress ||
    task.summary.inProgress ||
    useUrlStore.getState().download.inProgress
  );
}

/** The home hero is what's on screen: no video, subtitles or panel open. */
export function isHomeShowing(): boolean {
  const ui = useUIStore.getState();
  const video = useVideoStore.getState();
  return (
    !ui.showSettings &&
    !ui.showGeneratePanel &&
    !ui.showEditPanel &&
    !video.url &&
    !video.path &&
    useSubStore.getState().order.length === 0
  );
}

/**
 * The library save failed: say so, and let the user keep the subtitles as an
 * .srt, leave without them, or stay. Resolves true when it's fine to leave.
 */
async function confirmLeaveUnsaved(): Promise<boolean> {
  const t = i18n.t.bind(i18n);
  const choice = await openNotice({
    title: t('home.leaveSaveFailed.title', "Your subtitles couldn't be saved"),
    message: t(
      'home.leaveSaveFailed.message',
      "Translator couldn't save these subtitles to your library, so they won't come back when you open this video again. Save them as an .srt file first, or stay here."
    ),
    buttons: [
      {
        id: 'leave',
        label: t('home.leaveSaveFailed.leave', 'Leave without saving'),
        variant: 'danger',
      },
      { id: 'stay', label: t('home.leaveSaveFailed.stay', 'Stay') },
      {
        id: 'saveSrt',
        label: t('home.leaveSaveFailed.saveSrt', 'Save .srt and leave'),
        variant: 'primary',
      },
    ],
  });
  if (choice === 'leave') return true;
  if (choice !== 'saveSrt') return false;
  return didSaveSubtitleFile(await saveSubtitlesAs());
}

/**
 * Leave the video for the home screen, exactly like clicking the logo.
 * Resolves false when the user chose to stay (unsaved subtitles).
 */
export async function goHome(): Promise<boolean> {
  if (useSubStore.getState().order.length > 0) {
    const saved = await saveMountedSubtitleDocument();
    if (saved.success && saved.documentId) {
      const video = useVideoStore.getState();
      rememberLeftDocument(
        { path: video.originalPath ?? video.path, url: video.sourceUrl },
        saved.documentId
      );
    } else {
      // Never drop subtitles silently: the user decides.
      console.warn('[home] Library save failed:', saved.error);
      if (!(await confirmLeaveUnsaved())) return false;
    }
  }
  if (useVideoStore.getState().url || useVideoStore.getState().path) {
    await useVideoStore.getState().setFile(null);
  }
  if (useSubStore.getState().order.length > 0) {
    useSubStore.getState().load([], null, 'fresh', null);
  }
  const ui = useUIStore.getState();
  ui.setWorkspaceToolsOpen(false);
  ui.setGeneratePanelOpen(false);
  ui.setEditPanelOpen(false);
  return true;
}

export default function Header() {
  const { t } = useTranslation();
  const canGoHome = useCanGoHome();
  return (
    <div className={headerRow} data-translator-destination="home">
      <button
        type="button"
        className={homeButton}
        onClick={() => {
          if (!canGoHome) return;
          logButton('header_logo_home');
          void goHome();
        }}
        disabled={!canGoHome}
        aria-label={t('home.goHome', 'Home')}
      >
        <LogoDisplay />
      </button>

      <div className={rightGroup}>
        <CreditMinutesPill />
        <LanguageSwitcher />
        <span className={wideOnly}>
          <SettingsButton />
        </span>
        <span className={narrowOnly}>
          <SettingsButton variant="icon" />
        </span>
        <HeaderMenu />
      </div>
    </div>
  );
}
