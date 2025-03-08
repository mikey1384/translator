import React, { ReactNode } from 'react';
import { css, cx } from '@emotion/css';

interface SectionProps {
  children: ReactNode;
  title?: string;
  className?: string;
  contentClassName?: string;
  noMargin?: boolean;
  noPadding?: boolean;
  noShadow?: boolean;
}

const sectionStyles = css`
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
  padding: 1.5rem;
  margin-bottom: 2rem;
  transition: box-shadow 0.3s ease, transform 0.3s ease;

  &:hover {
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.08);
  }
`;

const sectionTitleStyles = css`
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 1.25rem;
  color: #212529;
  border-bottom: 2px solid #dee2e6;
  padding-bottom: 0.75rem;
`;

const noMarginStyle = css`
  margin-bottom: 0;
`;

const noPaddingStyle = css`
  padding: 0;
`;

const noShadowStyle = css`
  box-shadow: none;

  &:hover {
    box-shadow: none;
  }
`;

export default function Section({
  children,
  title,
  className,
  contentClassName,
  noMargin = false,
  noPadding = false,
  noShadow = false
}: SectionProps) {
  return (
    <div
      className={cx(
        sectionStyles,
        noMargin && noMarginStyle,
        noPadding && noPaddingStyle,
        noShadow && noShadowStyle,
        className
      )}
    >
      {title && <h2 className={sectionTitleStyles}>{title}</h2>}
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
