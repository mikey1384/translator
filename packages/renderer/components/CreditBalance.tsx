import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useCreditStore } from '../state';
import { colors } from '../styles';

const creditBalanceContainer = css`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid ${colors.primary}33;
  border-radius: 20px;
  font-size: 0.85rem;
  color: ${colors.primary};
  cursor: default;
`;

const creditIcon = css`
  width: 16px;
  height: 16px;
  opacity: 0.8;
`;

const creditText = css`
  font-weight: 500;
  white-space: nowrap;
`;

const loadingText = css`
  color: ${colors.textDim};
  font-style: italic;
`;

const errorText = css`
  color: ${colors.danger};
  font-size: 0.8rem;
`;

export default function CreditBalance() {
  const { t } = useTranslation();
  const { credits, hours, loading, error, checkoutPending } = useCreditStore();

  if (loading) {
    return (
      <div className={creditBalanceContainer}>
        <span className={loadingText}>⏳ {t('credits.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={creditBalanceContainer}>
        <span className={errorText}>⚠️ {t('common.error.unexpected')}</span>
      </div>
    );
  }

  if (checkoutPending) {
    return (
      <div className={creditBalanceContainer}>
        <span className={creditText}>🔄 Processing...</span>
      </div>
    );
  }

  if (credits !== null && hours !== null) {
    // Hide component completely when credits are 0
    if (credits === 0) {
      return null;
    }

    // Normal display for credits > 0
    return (
      <div className={creditBalanceContainer}>
        <svg
          className={creditIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span className={creditText}>
          {credits.toLocaleString()} ({hours.toFixed(1)}h)
        </span>
      </div>
    );
  }

  return null;
}
