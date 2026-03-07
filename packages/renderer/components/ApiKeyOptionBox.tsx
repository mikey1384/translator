import { css, cx } from '@emotion/css';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { colors } from '../styles';
import {
  borderRadius,
  fontSize,
  fontWeight,
  spacing,
} from './design-system/tokens.js';

interface ApiKeyOptionBoxProps {
  optionNumber: 1 | 2;
  title: string;
  satisfied: boolean;
  children: ReactNode;
}

const optionBoxStyles = css`
  min-width: 0;
  padding: ${spacing.lg};
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.xl};
  background: rgba(255, 255, 255, 0.015);
`;

const optionBoxSatisfiedStyles = css`
  border-color: ${colors.primary};
  background: rgba(125, 167, 255, 0.06);
`;

const optionHeaderStyles = css`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: ${spacing.sm};
  margin-bottom: ${spacing.md};
`;

const optionBadgeStyles = css`
  width: 24px;
  height: 24px;
  border-radius: ${borderRadius.full};
  background: ${colors.grayLight};
  color: ${colors.textDim};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: ${fontSize.sm};
  font-weight: ${fontWeight.semibold};
`;

const optionBadgeSatisfiedStyles = css`
  background: ${colors.primary};
  color: #fff;
`;

const optionTitleStyles = css`
  min-width: 0;
  color: ${colors.text};
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`;

const dividerStyles = css`
  text-align: center;
  color: ${colors.textDim};
  margin: ${spacing.lg} 0;
  font-size: ${fontSize.md};
`;

const inputWrapperStyles = css`
  padding: ${spacing.md};
  background: rgba(40, 40, 40, 0.1);
  border-radius: ${borderRadius.lg};
`;

const inputWrapperSatisfiedStyles = css`
  background: rgba(125, 167, 255, 0.06);
`;

export function ApiKeyOptionBox({
  optionNumber,
  title,
  satisfied,
  children,
}: ApiKeyOptionBoxProps) {
  return (
    <div
      className={cx(
        optionBoxStyles,
        satisfied && optionBoxSatisfiedStyles
      )}
    >
      <div className={optionHeaderStyles}>
        <span
          className={cx(
            optionBadgeStyles,
            satisfied && optionBadgeSatisfiedStyles
          )}
        >
          {satisfied ? '✓' : optionNumber}
        </span>
        <span className={optionTitleStyles}>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function OrDivider() {
  const { t } = useTranslation();
  return (
    <div className={dividerStyles}>— {t('common.or', 'OR')} —</div>
  );
}

interface ApiKeyOptionInputWrapperProps {
  satisfied: boolean;
  children: ReactNode;
}

export function ApiKeyInputWrapper({
  satisfied,
  children,
}: ApiKeyOptionInputWrapperProps) {
  return (
    <div
      className={cx(
        inputWrapperStyles,
        satisfied && inputWrapperSatisfiedStyles
      )}
    >
      {children}
    </div>
  );
}
