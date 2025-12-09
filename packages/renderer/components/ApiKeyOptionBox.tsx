import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { colors } from '../styles';

interface ApiKeyOptionBoxProps {
  optionNumber: 1 | 2;
  title: string;
  satisfied: boolean;
  children: ReactNode;
}

export function ApiKeyOptionBox({
  optionNumber,
  title,
  satisfied,
  children,
}: ApiKeyOptionBoxProps) {
  return (
    <div
      style={{
        padding: '14px',
        border: `1px solid ${satisfied ? colors.primary : colors.border}`,
        borderRadius: 8,
        background: satisfied ? 'rgba(67, 97, 238, 0.05)' : 'transparent',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: satisfied ? colors.primary : colors.grayLight,
            color: satisfied ? '#fff' : colors.textDim,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '.8rem',
            fontWeight: 600,
          }}
        >
          {satisfied ? '✓' : optionNumber}
        </span>
        <span style={{ fontWeight: 600, color: colors.text }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function OrDivider() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        textAlign: 'center',
        color: colors.textDim,
        margin: '16px 0',
        fontSize: '.9rem',
      }}
    >
      — {t('common.or', 'OR')} —
    </div>
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
      style={{
        padding: '12px',
        background: satisfied
          ? 'rgba(67, 97, 238, 0.05)'
          : 'rgba(40, 40, 40, 0.1)',
        borderRadius: 6,
      }}
    >
      {children}
    </div>
  );
}
