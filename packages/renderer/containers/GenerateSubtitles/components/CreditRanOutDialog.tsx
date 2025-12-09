import { useTranslation } from 'react-i18next';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';

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

  return (
    <Modal
      open={open}
      title={t('dialogs.creditRanOut.title', 'Credits ran out')}
      titleId="credit-ran-out-title"
      actions={
        <>
          <Button variant="secondary" onClick={onOk}>
            {t('dialogs.creditRanOut.ok', 'OK')}
          </Button>
          <Button variant="primary" onClick={onOpenSettings}>
            {t('dialogs.creditRanOut.openSettings', 'Open Settings')}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        {t(
          'dialogs.creditRanOut.message',
          'Your AI credits have run out. Recharge in Settings, then resume where you left off.'
        )}
      </p>
    </Modal>
  );
}
