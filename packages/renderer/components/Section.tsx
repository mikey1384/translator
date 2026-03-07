import { ReactNode } from 'react';
import { css, cx } from '@emotion/css';
import { sectionStyles } from '../styles.js';
import { colors } from '../styles.js';
import {
  borderRadius,
  fontSize,
  fontWeight,
  spacing,
} from './design-system/tokens.js';

interface SectionProps {
  children: ReactNode;
  title?: string;
  headerRight?: ReactNode;
  className?: string;
  contentClassName?: string;
  noMargin?: boolean;
  noPadding?: boolean;
  noShadow?: boolean;
  overflowVisible?: boolean;
  isSubSection?: boolean;
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

const subSectionStyles = css`
  padding: ${spacing.lg} ${spacing.xl};
  margin-top: ${spacing.lg};
  margin-bottom: ${spacing.lg};
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.xl};
`;

const headerRowStyles = css`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: ${spacing.md};
  margin-bottom: ${spacing.xl};
  padding-bottom: ${spacing.md};
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
`;

const titleStyles = css`
  font-size: clamp(1.2rem, 1.4vw, 1.5rem);
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
  margin: 0;
  letter-spacing: -0.02em;
`;

const subTitleStyles = css`
  font-size: ${fontSize.lg};
  font-weight: ${fontWeight.medium};
  margin-bottom: ${spacing.md};
  padding-bottom: ${spacing.sm};
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
`;

export default function Section({
  children,
  title,
  headerRight,
  className,
  contentClassName,
  noMargin = false,
  noPadding = false,
  noShadow = false,
  overflowVisible = false,
  isSubSection = false,
}: SectionProps) {
  return (
    <section
      className={cx(
        sectionStyles,
        noMargin && noMarginStyle,
        noPadding && noPaddingStyle,
        noShadow && noShadowStyle,
        overflowVisible && overflowVisibleStyle,
        isSubSection && subSectionStyles,
        className
      )}
      style={{ paddingTop: title ? undefined : '0.75rem' }}
    >
      {title ? (
        <div className={headerRowStyles}>
          <h2 className={cx(titleStyles, isSubSection && subTitleStyles)}>
            {title}
          </h2>
          {headerRight}
        </div>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
