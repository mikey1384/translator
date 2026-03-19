import { useEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import IconButton from './IconButton.js';
import { useTranslation } from 'react-i18next';
import { useTaskStore, useUpdateStore } from '../state';
import { openLogs } from '../state/modal-store';
import { logButton } from '../utils/logger';
import subtitleRendererClient from '../clients/subtitle-renderer-client.js';
import { useUrlStore } from '../state/url-store';

interface FloatingActionButtonsProps {
  scrollThreshold?: number;
  onClick?: () => void;
}

const buttonContainerStyles = css`
  position: fixed;
  bottom: 30px;
  right: 30px;
  z-index: 1000;
  display: flex;
  gap: 10px;
`;

const spinKeyframes = css`
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`;

const iconContainerStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const updateAttentionKeyframes = css`
  @keyframes updateFabPulse {
    0% {
      transform: scale(1);
      box-shadow: 0 10px 24px rgba(5, 10, 19, 0.26);
    }
    50% {
      transform: scale(1.03);
      box-shadow: 0 16px 34px rgba(5, 10, 19, 0.34);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 10px 24px rgba(5, 10, 19, 0.26);
    }
  }

  @keyframes updateFabGlowAmber {
    0%,
    100% {
      box-shadow:
        0 10px 24px rgba(5, 10, 19, 0.26),
        0 0 0 0 rgba(240, 180, 75, 0.2);
    }
    50% {
      box-shadow:
        0 18px 36px rgba(217, 138, 22, 0.28),
        0 0 0 8px rgba(240, 180, 75, 0.12);
    }
  }

  @keyframes updateFabGlowGreen {
    0%,
    100% {
      box-shadow:
        0 10px 24px rgba(5, 10, 19, 0.26),
        0 0 0 0 rgba(57, 200, 135, 0.18);
    }
    50% {
      box-shadow:
        0 18px 36px rgba(28, 165, 106, 0.28),
        0 0 0 8px rgba(57, 200, 135, 0.12);
    }
  }
`;

const updatePillBaseStyles = css`
  ${updateAttentionKeyframes}
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  min-width: 164px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: 999px;
  box-sizing: border-box;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(5, 10, 19, 0.26);
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease,
    opacity 120ms ease,
    box-shadow 120ms ease;

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.74;
    cursor: wait;
  }
`;

const updatePillAvailableStyles = css`
  color: #fff7ea;
  background: linear-gradient(135deg, #f0b44b, #d98a16);
  border-color: rgba(255, 219, 154, 0.32);
  animation:
    updateFabPulse 1.8s ease-in-out infinite,
    updateFabGlowAmber 1.8s ease-in-out infinite;

  &:hover:not(:disabled) {
    box-shadow: 0 14px 28px rgba(217, 138, 22, 0.28);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const updatePillDownloadingStyles = css`
  color: #edf6ff;
  background: linear-gradient(135deg, #5a90ff, #376ce6);
  border-color: rgba(171, 200, 255, 0.28);
`;

const updatePillReadyStyles = css`
  color: #f3fff8;
  background: linear-gradient(135deg, #39c887, #1ca56a);
  border-color: rgba(136, 236, 188, 0.3);
  animation:
    updateFabPulse 1.8s ease-in-out infinite,
    updateFabGlowGreen 1.8s ease-in-out infinite;

  &:hover:not(:disabled) {
    box-shadow: 0 14px 28px rgba(28, 165, 106, 0.28);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const updatePillTextStyles = css`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  gap: 2px;
`;

const updatePillLabelStyles = css`
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  white-space: nowrap;
`;

const updatePillMetaStyles = css`
  font-size: 0.72rem;
  line-height: 1;
  letter-spacing: 0.01em;
  opacity: 0.9;
  white-space: nowrap;
`;

const updatePillProgressBadgeStyles = css`
  margin-left: auto;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(9, 13, 20, 0.18);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
`;

const downloadSpinnerStyles = css`
  ${spinKeyframes}
  animation: spin 1s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export default function FloatingActionButtons({
  scrollThreshold = 300,
  onClick,
}: FloatingActionButtonsProps) {
  const { t } = useTranslation();
  const [showScrollToTopButton, setShowScrollToTopButton] = useState(false);
  const showScrollToTopRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const available = useUpdateStore(s => s.available);
  const downloading = useUpdateStore(s => s.downloading);
  const percent = useUpdateStore(s => s.percent);
  const downloaded = useUpdateStore(s => s.downloaded);
  const install = useUpdateStore(s => s.install);
  const check = useUpdateStore(s => s.check);
  const doDownload = () => useUpdateStore.getState().download();

  useEffect(() => {
    const syncScrollButtons = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const shouldShowTop = scrollTop > scrollThreshold;

      if (showScrollToTopRef.current !== shouldShowTop) {
        showScrollToTopRef.current = shouldShowTop;
        setShowScrollToTopButton(shouldShowTop);
      }
    };

    const handleScroll = () => {
      if (scrollFrameRef.current != null) return;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        syncScrollButtons();
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    syncScrollButtons();
    return () => {
      if (scrollFrameRef.current != null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, [scrollThreshold]);

  // Check for updates on mount and periodically (only in production)
  useEffect(() => {
    if (!window.env.isPackaged) return;

    check(); // Initial check
    const interval = setInterval(check, 10 * 60 * 1000); // Every 10 minutes
    return () => clearInterval(interval);
  }, [check]);

  const handleBackToTopClick = () => {
    if (onClick) {
      onClick();
    } else {
      const topPadding = document.getElementById('top-padding');
      if (topPadding) {
        topPadding.scrollIntoView({ behavior: 'smooth' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  const handleReloadClick = async () => {
    const blockSavePhaseReload = () => {
      useUrlStore
        .getState()
        .setValidationError(
          t(
            'progress.mergeFinishSaveBeforeReload',
            'Finish saving the merged video before reloading.'
          )
        );
      return true;
    };

    const blockCancellingMergeReload = () => {
      useUrlStore
        .getState()
        .setValidationError(
          t(
            'progress.mergeWaitForCancelBeforeReload',
            'Wait for merge cancellation to finish before reloading.'
          )
        );
      return true;
    };

    const prepareForReload = async (): Promise<boolean> => {
      const opId = useTaskStore.getState().merge.id;
      if (!opId) return true;

      const result = await subtitleRendererClient.cancelMerge(opId);
      if (!result.accepted) {
        if (result.reason === 'save_phase') {
          blockSavePhaseReload();
          return false;
        }
        if (result.reason === 'cancel_pending') {
          const settled =
            await subtitleRendererClient.waitForMergeSettlement(opId);
          if (!settled) {
            blockCancellingMergeReload();
            return false;
          }
          return true;
        }
        return true;
      }

      const settled = await subtitleRendererClient.waitForMergeSettlement(opId);
      if (!settled) {
        blockCancellingMergeReload();
        return false;
      }
      return true;
    };

    // If update is downloaded, install it immediately
    if (downloaded) {
      if (
        !window.confirm(
          t('common.confirmInstallUpdate', 'Install update and restart?')
        )
      )
        return;
      if (!(await prepareForReload())) return;
      await install();
      return;
    }

    // If update is downloading, do nothing (let it finish in background)
    if (downloading) {
      return;
    }

    // If an update is available but not yet downloaded, kick off download
    if (available && !downloaded) {
      try {
        await doDownload();
      } catch {
        // ignore; error surface handled by store
      }
      return;
    }

    // Otherwise, regular reload
    if (!window.confirm(t('common.confirmReload'))) return;

    if (!(await prepareForReload())) return;

    window.location.reload();
  };

  // Determine button appearance based on update state
  const getButtonProps = () => {
    if (downloaded) {
      return {
        title: t(
          'common.installUpdate',
          'INSTALL UPDATE - Click to install and restart'
        ),
        'aria-label': t(
          'common.installUpdateAria',
          'Install update and restart application'
        ),
        kind: 'update' as const,
        className: updatePillReadyStyles,
        label: t('common.installUpdateNow', 'Install Update'),
        meta: t('common.installUpdate', 'Restart to Update'),
        icon: (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 3v10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="m7 10 5 5 5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 19h14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ),
      };
    }

    // Show different states for available/downloading
    if (available && !downloaded) {
      if (downloading) {
        const progressPercent = percent != null ? Math.round(percent) : 0;
        return {
          title: t('common.downloadingUpdate', 'Downloading update...'),
          'aria-label': t('common.downloadingUpdateProgress', {
            percent: progressPercent,
            defaultValue: 'Downloading update {{percent}} percent',
          }),
          'aria-live': 'polite' as const,
          'aria-busy': true,
          kind: 'update' as const,
          className: updatePillDownloadingStyles,
          label: t('common.downloadingUpdateShort', 'DOWNLOADING'),
          meta: t('common.downloadingUpdate', 'Downloading update...'),
          progressLabel: `${progressPercent}%`,
          icon: (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className={downloadSpinnerStyles}
            >
              <circle
                cx="12"
                cy="12"
                r="3"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
              />
              <path
                d="M12 2v4M12 18v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M2 12h4M18 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          ),
        };
      }

      return {
        title: t('common.downloadUpdate', 'Click to download update'),
        'aria-label': t('common.downloadUpdateNow', 'Download Update'),
        kind: 'update' as const,
        className: updatePillAvailableStyles,
        label: t('common.downloadUpdateNow', 'Download Update'),
        meta: t('common.checkForUpdateNow', 'Check for Update'),
        icon: (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 3v10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="m7 10 5 5 5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 19h14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ),
      };
    }

    // Default reload button
    return {
      title: t('common.reloadPage'),
      kind: 'reload' as const,
      variant: 'secondary' as const,
      'aria-label': t('common.reloadPageAria', 'Reload page'),
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M23 4v6h-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    };
  };

  const buttonProps = getButtonProps();
  return (
    <div className={buttonContainerStyles}>
      <IconButton
        onClick={() => {
          logButton('report_issue');
          openLogs();
        }}
        title={t('common.reportIssue', 'Report issue or feedback')}
        aria-label={t(
          'common.reportIssueAria',
          'Open the issue report and logs dialog'
        )}
        size="lg"
        variant="secondary"
        icon={
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M8 9h8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M9.5 14.5h5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M10 4.5 8.5 3M14 4.5 15.5 3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x="6"
              y="6"
              width="12"
              height="12"
              rx="5"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M6 11H4M20 11h-2M6.5 15.5 5 17M17.5 15.5 19 17"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="11" r="1" fill="currentColor" />
            <circle cx="14" cy="11" r="1" fill="currentColor" />
          </svg>
        }
      />
      {buttonProps &&
        (buttonProps.kind === 'update' ? (
          <button
            onClick={handleReloadClick}
            title={buttonProps.title}
            aria-label={buttonProps['aria-label'] ?? buttonProps.title}
            aria-live={buttonProps['aria-live'] ?? undefined}
            aria-busy={buttonProps['aria-busy'] ?? undefined}
            disabled={downloading}
            className={cx(updatePillBaseStyles, buttonProps.className)}
          >
            <div className={iconContainerStyles}>
              {buttonProps.icon}
              <div className={updatePillTextStyles}>
                <span className={updatePillLabelStyles}>
                  {buttonProps.label}
                </span>
                <span className={updatePillMetaStyles}>{buttonProps.meta}</span>
              </div>
              {buttonProps.progressLabel ? (
                <span className={updatePillProgressBadgeStyles}>
                  {buttonProps.progressLabel}
                </span>
              ) : null}
            </div>
          </button>
        ) : (
          <IconButton
            onClick={handleReloadClick}
            title={buttonProps.title}
            aria-label={buttonProps['aria-label'] ?? buttonProps.title}
            size="lg"
            variant={buttonProps.variant}
            disabled={downloading}
            icon={buttonProps.icon}
            className={buttonProps.className}
          />
        ))}
      {showScrollToTopButton && (
        <IconButton
          variant="secondary"
          onClick={() => {
            logButton('scroll_top');
            handleBackToTopClick();
          }}
          onKeyDown={e => {
            if (e.key === 'ArrowUp' || e.key === 'Home') {
              e.preventDefault();
              handleBackToTopClick();
            }
          }}
          title={t('common.backToTop', 'Back to Top')}
          aria-label={t('common.backToTopAria', 'Scroll back to top')}
          size="lg"
          icon={
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 19V5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="m5 12 7-7 7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        />
      )}
    </div>
  );
}
