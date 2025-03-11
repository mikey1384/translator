import React, { ReactNode } from 'react';
import { css, cx } from '@emotion/css';
import { sectionStyles, sectionTitleStyles } from '../styles';

interface SectionProps {
  children: ReactNode;
  title?: string;
  className?: string;
  contentClassName?: string;
  noMargin?: boolean;
  noPadding?: boolean;
  noShadow?: boolean;
  overflowVisible?: boolean;
}

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

const overflowVisibleStyle = css`
  overflow: visible;
`;

export default function Section({
  children,
  title,
  className,
  contentClassName,
  noMargin = false,
  noPadding = false,
  noShadow = false,
  overflowVisible = false,
}: SectionProps) {
  return (
    <section
      className={cx(
        sectionStyles,
        noMargin && noMarginStyle,
        noPadding && noPaddingStyle,
        noShadow && noShadowStyle,
        overflowVisible && overflowVisibleStyle,
        className
      )}
      style={{ paddingTop: title ? undefined : '0.75rem' }}
    >
      {title && <h2 className={sectionTitleStyles}>{title}</h2>}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
