import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import LogoDisplay from '../components/LogoDisplay';
import LanguageSwitcher from '../components/LanguageSwitcher';
import CreditMinutesPill from '../components/CreditMinutesPill';
import SettingsButton from '../components/SettingsButton';
import HeaderMenu from '../components/HeaderMenu';
import { useSubStore, useTaskStore, useUIStore, useVideoStore } from '../state';
import { useUrlStore } from '../state/url-store';
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

/** Home is the panels-closed state; only reachable when nothing is loaded. */
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
  return panelsOpen && !hasVideo && !hasSubtitles && !busy && !downloading;
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
          const ui = useUIStore.getState();
          ui.setGeneratePanelOpen(false);
          ui.setEditPanelOpen(false);
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
