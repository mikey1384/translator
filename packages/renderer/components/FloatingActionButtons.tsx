import { useState, useEffect } from 'react';
import { css, cx } from '@emotion/css';
import IconButton from './IconButton.js';
import { useTranslation } from 'react-i18next';
import { useTaskStore, useUpdateStore } from '../state';
import * as SubtitleIPC from '@ipc/subtitles';

interface FloatingActionButtonsProps {
  scrollThreshold?: number;
  onClick?: () => void;
}

// Modern button styles with refined animation
const buttonContainerStyles = css`
  position: fixed;
  bottom: 30px;
  right: 30px;
  z-index: 1000;
  display: flex;
  gap: 10px;
`;

// Shared keyframes to avoid duplication
const greenPulseKeyframes = css`
  @keyframes greenPulse {
    0%,
    100% {
      transform: scale(1);
      box-shadow: 0 0 15px rgba(16, 185, 129, 0.6);
    }
    50% {
      transform: scale(1.05);
      box-shadow: 0 0 25px rgba(16, 185, 129, 0.9);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transform: none;
    box-shadow: none;
  }
`;

const orangePulseKeyframes = css`
  @keyframes orangePulse {
    0%,
    100% {
      transform: scale(1);
      box-shadow: 0 0 10px rgba(217, 119, 6, 0.5);
    }
    50% {
      transform: scale(1.05);
      box-shadow: 0 0 20px rgba(217, 119, 6, 0.8);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transform: none;
    box-shadow: none;
  }
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

// Icon styles using Emotion for consistency
const iconContainerStyles = css`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const iconTextStyles = css`
  font-size: 11px;
  font-weight: bold;
`;

const smallIconTextStyles = css`
  font-size: 10px;
  font-weight: bold;
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
  const {
    available,
    downloading,
    percent,
    downloaded,
    download,
    install,
    check,
  } = useUpdateStore();

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > scrollThreshold) {
        setShowScrollToTopButton(true);
      } else {
        setShowScrollToTopButton(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
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
    // If update is downloaded, install it immediately
    if (downloaded) {
      if (
        !window.confirm(
          t('common.confirmInstallUpdate', 'Install update and restart?')
        )
      )
        return;
      await install();
      return;
    }

    // If update is downloading, do nothing (let it finish in background)
    if (downloading) {
      return;
    }

    // If update is available but not downloaded, let user force download
    if (available && !downloaded && !downloading) {
      await download();
      return;
    }

    // Otherwise, regular reload
    if (!window.confirm(t('common.confirmReload'))) return;

    const opId = useTaskStore.getState().merge.id;
    if (opId) {
      SubtitleIPC.cancelPngRender(opId);
      await new Promise(r => setTimeout(r, 200));
    }

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
        variant: 'primary' as const,
        'aria-label': t(
          'common.installUpdateAria',
          'Install update and restart application'
        ),
        className: css`
          ${greenPulseKeyframes}
          background: #10b981 !important;
          color: white !important;
          animation: greenPulse 2s ease-in-out infinite;
          box-shadow: 0 0 15px rgba(16, 185, 129, 0.6);

          &:hover {
            animation-play-state: paused;
            transform: scale(1.05);
          }
        `,
        icon: (
          <div className={iconContainerStyles}>
            <span>📥</span>
            <span className={smallIconTextStyles}>
              {t('common.installUpdateShort', 'INSTALL UPDATE')}
            </span>
          </div>
        ),
      };
    }

    // Show different states for available/downloading
    if (available && !downloaded) {
      if (downloading) {
        const progressPercent = percent != null ? Math.round(percent) : 0;
        return {
          title: t('common.downloadingUpdate', 'Downloading update...'),
          variant: 'primary' as const,
          'aria-label': t(
            'common.downloadingUpdateProgress',
            `Downloading update ${progressPercent} percent`
          ),
          'aria-live': 'polite' as const,
          'aria-busy': true,
          className: css`
            background: #3b82f6 !important;
            color: white !important;
            opacity: 0.9;
          `,
          icon: (
            <div className={iconContainerStyles}>
              <svg
                width="12"
                height="12"
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
              <span className={smallIconTextStyles}>
                {t('common.downloadingUpdateShort', 'DOWNLOADING')}
              </span>
              {percent != null && (
                <span
                  className={css`
                    font-size: 9px;
                    margin-left: 4px;
                  `}
                >
                  {Math.round(percent)}%
                </span>
              )}
            </div>
          ),
        };
      } else {
        return {
          title: t(
            'common.downloadUpdate',
            'UPDATE AVAILABLE - Click to download'
          ),
          variant: 'primary' as const,
          'aria-label': t(
            'common.downloadUpdateAria',
            'Download available update'
          ),
          className: css`
            ${orangePulseKeyframes}
            background: #d97706 !important;
            color: white !important;
            animation: orangePulse 2s ease-in-out infinite;
            box-shadow: 0 0 10px rgba(217, 119, 6, 0.5);

            &:hover {
              animation-play-state: paused;
              transform: scale(1.05);
            }

            @media (prefers-reduced-motion: reduce) {
              animation: none;
              transform: none;
              box-shadow: 0 0 10px rgba(217, 119, 6, 0.5);
            }
          `,
          icon: (
            <div className={iconContainerStyles}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={iconTextStyles}>
                {t('common.downloadUpdateShort', 'DOWNLOAD')}
              </span>
            </div>
          ),
        };
      }
    }

    // Default reload button
    return {
      title: t('common.reloadPage'),
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
      {buttonProps &&
        (available || downloaded ? (
          <button
            onClick={handleReloadClick}
            title={buttonProps.title}
            aria-label={buttonProps['aria-label'] ?? buttonProps.title}
            aria-live={buttonProps['aria-live'] ?? undefined}
            aria-busy={buttonProps['aria-busy'] ?? undefined}
            disabled={downloading}
            className={cx(
              css`
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                padding: 12px 16px;
                font-size: 11px;
                font-weight: bold;
                color: white;
                transition: all 0.3s ease;
                min-width: 80px;
                height: 44px;

                &:focus {
                  outline: none;
                }

                &:disabled {
                  opacity: 0.6;
                  cursor: not-allowed;
                }
              `,
              buttonProps.className
            )}
          >
            {buttonProps.icon}
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
          onClick={handleBackToTopClick}
          title={t('common.backToTop')}
          aria-label={t('common.backToTopAria')}
          size="lg"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className={css`
                stroke: currentColor;
                stroke-width: 2;
                stroke-linecap: round;
                stroke-linejoin: round;
              `}
            >
              <path d="M8 12V4M8 4L4 8M8 4L12 8" />
            </svg>
          }
        />
      )}
    </div>
  );
}
