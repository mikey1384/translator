import { ReactNode } from 'react';
import { css, cx } from '@emotion/css';
import { sectionStyles } from '../styles.js';
import { colors } from '../styles.js';

interface SectionProps {
  children: ReactNode;
  title?: string;
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
  padding: 15px 20px;
  margin-top: 15px;
  margin-bottom: 15px;
  background-color: ${colors.light};
  border: 1px dashed ${colors.border};
  border-radius: 6px;
`;

const titleStyles = css`
  font-size: 1.4em;
  font-weight: 600;
  color: ${colors.dark};
  margin-top: 0;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid ${colors.border};
`;

const subTitleStyles = css`
  font-size: 1.1em;
  font-weight: 500;
  margin-bottom: 15px;
  padding-bottom: 8px;
  border-bottom: 1px solid ${colors.grayLight};
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
      <h2 className={cx(titleStyles, isSubSection && subTitleStyles)}>
        {title}
      </h2>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
