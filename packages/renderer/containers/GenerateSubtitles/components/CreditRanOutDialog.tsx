import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import Button from '../../../components/Button';
import { colors } from '../../../styles';

interface Props {
  open: boolean;
  onOpenSettings: () => void;
  onOk: () => void;
}

export default function CreditRanOutDialog({
  open,
  onOpenSettings,
  onOk,
}: Props) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div
      className={css`
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      `}
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-ran-out-title"
    >
      <div
        className={css`
          background: ${colors.light};
          border: 1px solid ${colors.border};
          border-radius: 8px;
          width: min(520px, 90vw);
          padding: 16px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.25);
        `}
      >
        <h3
          id="credit-ran-out-title"
          className={css`
            margin: 0 0 8px 0;
          `}
        >
          {t('dialogs.creditRanOut.title', 'Credits ran out')}
        </h3>
        <p
          className={css`
            margin: 0 0 16px 0;
            color: ${colors.dark};
          `}
        >
          {t(
            'dialogs.creditRanOut.message',
            'Your AI credits have run out. Recharge in Settings, then resume where you left off.'
          )}
        </p>

        <div
          className={css`
            display: flex;
            gap: 10px;
            justify-content: flex-end;
          `}
        >
          <Button variant="secondary" onClick={onOk}>
            {t('dialogs.creditRanOut.ok', 'OK')}
          </Button>
          <Button variant="primary" onClick={onOpenSettings}>
            {t('dialogs.creditRanOut.openSettings', 'Open Settings')}
          </Button>
        </div>
      </div>
    </div>
  );
}
