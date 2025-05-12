import { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import IconButton from './IconButton.js';
import { useTranslation } from 'react-i18next';
import { useTaskStore } from '../state';
import * as SubtitleIPC from '@ipc/subtitles';

interface BackToTopButtonProps {
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

export default function BackToTopButton({
  scrollThreshold = 300,
  onClick,
}: BackToTopButtonProps) {
  const { t } = useTranslation();
  const [showScrollToTopButton, setShowScrollToTopButton] = useState(false);

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
    if (!window.confirm(t('common.confirmReload'))) return;

    const opId = useTaskStore.getState().merge.id;
    if (opId) {
      SubtitleIPC.cancelPngRender(opId);
      await new Promise(r => setTimeout(r, 200));
    }

    window.location.reload();
  };

  return (
    <div className={buttonContainerStyles}>
      <IconButton
        onClick={handleReloadClick}
        title={t('common.reloadPage')}
        aria-label={t('common.reloadPageAria')}
        size="lg"
        variant="secondary"
        icon={
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={css`
              stroke: currentColor;
              stroke-width: 2;
              stroke-linecap: round;
              stroke-linejoin: round;
            `}
          >
            <path d="M23 4v6h-6"></path>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
        }
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
