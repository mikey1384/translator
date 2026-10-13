import { useTranslation } from 'react-i18next';
import Button from './Button';
import Modal from './Modal';
import { formatCreditBalance } from '../utils/creditEstimates';

interface Props {
  open: boolean;
  estimatedCredits: number;
  balance: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before a dub that would use a large share of the credit balance. */
export default function ConfirmDubCostDialog({
  open,
  estimatedCredits,
  balance,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={t('dialogs.dubCostConfirm.title', 'Start dubbing?')}
      titleId="confirm-dub-cost-title"
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {t('subtitles.dub', 'Dub Voice')}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        {t(
          'dialogs.dubCostConfirm.message',
          'This dub uses about {{cost}} of your {{balance}} credits. Generating voices costs much more than translating.',
          {
            cost: formatCreditBalance(estimatedCredits),
            balance: formatCreditBalance(balance),
          }
        )}
      </p>
    </Modal>
  );
}
