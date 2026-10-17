import { useTranslation } from 'react-i18next';
import Button from './Button';
import Modal from './Modal';
import { formatCostOfBalanceInMinutes } from '../utils/formatCostInMinutes';

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
  const { t, i18n } = useTranslation();
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
          'dialogs.dubCostConfirm.messageMinutes',
          'This dub uses {{cost}}. Generating voices costs much more than translating.',
          {
            // In minutes of video, the unit users buy: "~6m of your 4h 17m".
            cost: formatCostOfBalanceInMinutes(
              t,
              estimatedCredits,
              balance,
              i18n.language
            ),
          }
        )}
      </p>
    </Modal>
  );
}
