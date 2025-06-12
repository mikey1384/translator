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
    error,
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

  // Check for updates on component mount (only in production)
  useEffect(() => {
    if (window.env.isPackaged) {
      check();
    }
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
    // If update is downloaded, install it
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

    // If update is available but not downloaded, start download
    if (available && !downloading) {
      if (
        !window.confirm(t('common.confirmDownloadUpdate', 'Download update?'))
      )
        return;
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
        title: t('common.installUpdate', 'Restart to Update'),
        variant: 'primary' as const,
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
            <circle cx="12" cy="12" r="2" fill="currentColor" />
          </svg>
        ),
      };
    }

    if (available && !downloading) {
      return {
        title: t('common.downloadUpdate', 'Download Update'),
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
              d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="7,10 12,15 17,10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line
              x1="12"
              y1="15"
              x2="12"
              y2="3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      };
    }

    if (downloading) {
      return {
        title: t(
          'common.downloadingUpdate',
          `Downloading ${percent.toFixed(0)}%`
        ),
        variant: 'secondary' as const,
        icon: (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M12 6v6l4 2"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      };
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
      <IconButton
        onClick={handleReloadClick}
        title={buttonProps.title}
        aria-label={buttonProps.title}
        size="lg"
        variant={buttonProps.variant}
        disabled={downloading}
        icon={buttonProps.icon}
      />
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
