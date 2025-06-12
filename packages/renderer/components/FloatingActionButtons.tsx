import { useState, useEffect } from 'react';
import { css } from '@emotion/css';
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

// Eye-catching update button animation
const updateButtonStyles = css`
  animation: updatePulse 2s ease-in-out infinite;
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.5) !important;

  @keyframes updatePulse {
    0%,
    100% {
      transform: scale(1);
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.5);
    }
    50% {
      transform: scale(1.05);
      box-shadow: 0 0 30px rgba(59, 130, 246, 0.8);
    }
  }

  &:hover {
    animation-play-state: paused;
    transform: scale(1.05);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transform: none;
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
    // Only show update button when download is complete and ready to install
    if (downloaded) {
      return {
        title: '🚀 Restart to Update',
        variant: 'primary' as const,
        className: updateButtonStyles,
        icon: (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M23 4v6h-6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" />
          </svg>
        ),
      };
    }

    // Show different states for available/downloading
    if (available && !downloaded) {
      if (downloading) {
        return {
          title: `Downloading update... ${Math.round(percent ?? 0)}%`,
          variant: 'secondary' as const,
          icon: (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className={css`
                animation: spin 1s linear infinite;
                @keyframes spin {
                  from {
                    transform: rotate(0deg);
                  }
                  to {
                    transform: rotate(360deg);
                  }
                }
              `}
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
      } else {
        return {
          title: t('common.downloadUpdate', 'Click to download update'),
          variant: 'secondary' as const,
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
              <circle cx="12" cy="12" r="1" fill="orange" />
            </svg>
          ),
        };
      }
    }

    // Default reload button
    return {
      title: t('common.reloadPage'),
      variant: 'secondary' as const,
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
      {buttonProps && (
        <IconButton
          onClick={handleReloadClick}
          title={buttonProps.title}
          aria-label={buttonProps.title}
          size="lg"
          variant={buttonProps.variant}
          disabled={downloading}
          icon={buttonProps.icon}
          className={buttonProps.className}
        />
      )}
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
