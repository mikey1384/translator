import { ReactNode } from 'react';
import { css, cx } from '@emotion/css';
import { breakpoints } from '../styles';

interface ButtonGroupProps {
  children: ReactNode;
  spacing?: 'sm' | 'md' | 'lg';
  align?: 'start' | 'center' | 'end' | 'space-between';
  vertical?: boolean;
  wrap?: boolean;
  className?: string;
  mobileStack?: boolean;
}

const buttonGroupStyles = css`
  display: flex;
  gap: 10px;
  margin-top: 16px;
  margin-bottom: 10px;
  flex-wrap: wrap;
  width: 100%;
  box-sizing: border-box;
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
  `,
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
  `,
};

const verticalStyle = css`
  flex-direction: column;
  align-items: flex-start;
`;

const noWrapStyle = css`
  flex-wrap: nowrap;
`;

const mobileStackStyle = css`
  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    flex-direction: column;
    width: 100%;
    gap: 12px;

    & > * {
      width: 100%;
      margin: 0;
    }
  }
`;

export default function ButtonGroup({
  children,
  spacing = 'md',
  align = 'start',
  vertical = false,
  wrap = true,
  mobileStack = false,
  className,
}: ButtonGroupProps) {
  return (
    <div
      className={cx(
        buttonGroupStyles,
        spacingVariants[spacing],
        alignmentVariants[align],
        vertical && verticalStyle,
        !wrap && noWrapStyle,
        mobileStack && mobileStackStyle,
        className
      )}
    >
      {children}
    </div>
  );
}
