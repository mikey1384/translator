import { useTranslation } from 'react-i18next';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import MicroCreditCheckoutButton from '../../../components/MicroCreditCheckoutButton';
import { useCreditStore } from '../../../state';

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
  // "Ran out" only makes sense to someone who had credits. Unknown history
  // keeps the original wording.
  const neverHadCredits = useCreditStore(
    s => s.history?.everHadCredits === false
  );

  return (
    <Modal
      open={open}
      title={
        neverHadCredits
          ? t(
              'dialogs.creditRanOut.neverHadTitle',
              'Transcription needs credits'
            )
          : t('dialogs.creditRanOut.title', 'Credits ran out')
      }
      titleId="credit-ran-out-title"
      actions={
        <>
          <Button variant="secondary" onClick={onOk}>
            {t('dialogs.creditRanOut.ok', 'OK')}
          </Button>
          <Button variant="secondary" onClick={onOpenSettings}>
            {t('dialogs.creditRanOut.openSettings', 'Open Settings')}
          </Button>
          <MicroCreditCheckoutButton
            placement="credit-ran-out-dialog"
            onCheckoutCreated={onOk}
          />
        </>
      }
    >
      <p style={{ margin: 0 }}>
        {neverHadCredits
          ? t(
              'dialogs.creditRanOut.neverHadMessage',
              'Transcription needs credits or the API-key unlock. Get either in Settings. Translating with your own Claude or Codex through Agent Control is free.'
            )
          : t(
              'dialogs.creditRanOut.message',
              'Your AI credits have run out. Recharge in Settings, then resume where you left off.'
            )}
      </p>
    </Modal>
  );
}
