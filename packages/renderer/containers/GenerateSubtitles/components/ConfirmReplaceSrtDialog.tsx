import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import Button from '../../../components/Button';
import { colors } from '../../../styles';

interface Props {
  open: boolean;
  onSaveAndTranscribe: () => void;
  onDiscardAndTranscribe: () => void;
  onCancel: () => void;
}

export default function ConfirmReplaceSrtDialog({
  open,
  onSaveAndTranscribe,
  onDiscardAndTranscribe,
  onCancel,
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
      aria-labelledby="confirm-replace-srt-title"
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
        <h3 id="confirm-replace-srt-title"
          className={css`
            margin: 0 0 8px 0;
          `}
        >
          {t('dialogs.unsavedSrtOnTranscribe.title')}
        </h3>
        <p
          className={css`
            margin: 0 0 16px 0;
            color: ${colors.dark};
          `}
        >
          {t('dialogs.unsavedSrtOnTranscribe.message')}
        </p>

        <div
          className={css`
            display: flex;
            gap: 10px;
            justify-content: flex-end;
          `}
        >
          <Button variant="text" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={onDiscardAndTranscribe}>
            {t('dialogs.unsavedSrtOnTranscribe.discardAndTranscribe')}
          </Button>
          <Button variant="primary" onClick={onSaveAndTranscribe}>
            {t('dialogs.unsavedSrtOnTranscribe.saveAndTranscribe')}
          </Button>
        </div>
      </div>
    </div>
  );
}
