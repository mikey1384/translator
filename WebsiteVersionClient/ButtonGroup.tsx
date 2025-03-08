import React, { ReactNode } from 'react';
import { css, cx } from '@emotion/css';

interface ButtonGroupProps {
  children: ReactNode;
  spacing?: 'sm' | 'md' | 'lg';
  align?: 'start' | 'center' | 'end' | 'space-between';
  vertical?: boolean;
  wrap?: boolean;
  className?: string;
}

const buttonGroupStyles = css`
  display: flex;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
`;

const spacingVariants = {
  sm: css`
    gap: 6px;
  `,
  md: css`
    gap: 10px;
  `,
  lg: css`
    gap: 16px;
  `
};

const alignmentVariants = {
  start: css`
    justify-content: flex-start;
  `,
  center: css`
    justify-content: center;
  `,
  end: css`
    justify-content: flex-end;
  `,
  'space-between': css`
    justify-content: space-between;
  `
};

const verticalStyle = css`
  flex-direction: column;
  align-items: flex-start;
`;

const noWrapStyle = css`
  flex-wrap: nowrap;
`;

export default function ButtonGroup({
  children,
  spacing = 'md',
  align = 'start',
  vertical = false,
  wrap = true,
  className
}: ButtonGroupProps) {
  return (
    <div
      className={cx(
        buttonGroupStyles,
        spacingVariants[spacing],
        alignmentVariants[align],
        vertical && verticalStyle,
        !wrap && noWrapStyle,
        className
      )}
    >
      {children}
    </div>
  );
}
