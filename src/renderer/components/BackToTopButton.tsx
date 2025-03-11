import React, { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import IconButton from './IconButton';

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
`;

export default function BackToTopButton({
  scrollThreshold = 300,
  onClick,
}: BackToTopButtonProps) {
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > scrollThreshold) {
        setShowButton(true);
      } else {
        setShowButton(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [scrollThreshold]);

  if (!showButton) return null;

  const handleClick = () => {
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

  return (
    <div className={buttonContainerStyles}>
      <IconButton
        onClick={handleClick}
        title="Back to Top"
        aria-label="Scroll back to top"
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
    </div>
  );
}
