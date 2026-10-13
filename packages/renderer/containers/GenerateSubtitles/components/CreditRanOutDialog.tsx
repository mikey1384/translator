import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import MicroCreditCheckoutButton from '../../../components/MicroCreditCheckoutButton';
import { useCreditStore } from '../../../state';
import { useModalStore } from '../../../state/modal-store';
import {
  creditOfferBasis,
  describeCreditShortfall,
  transcriptionMinutesForCredits,
} from '../../../utils/creditShortfall';

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
  const { t, i18n } = useTranslation();
  // "Ran out" only makes sense to someone who had credits. Unknown history
  // keeps the original wording.
  const neverHadCredits = useCreditStore(
    s => s.history?.everHadCredits === false
  );
  // A refusal while credits remain means "not enough for this task", not
  // "ran out" - say how short the balance is when the app can tell.
  const refusal = useModalStore(s => s.creditRefusal);
  // Only an authoritative balance may be quoted; a cached one can be stale.
  const liveCredits = useCreditStore(s => (s.authoritative ? s.credits : null));
  const shortfall = refusal
    ? describeCreditShortfall({
        availableCredits: liveCredits,
        transcriptionSeconds: refusal.transcriptionSeconds,
      })
    : null;
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language]
  );
  const formatCredits = (value: number) => numberFormat.format(value);

  const title = shortfall
    ? t(
        'dialogs.creditRanOut.notEnoughTitle',
        'Not enough credits for this video'
      )
    : neverHadCredits
      ? t('dialogs.creditRanOut.neverHadTitle', 'Transcription needs credits')
      : t('dialogs.creditRanOut.title', 'Credits ran out');

  const message = shortfall
    ? shortfall.requiredCredits !== null
      ? t(
          'dialogs.creditRanOut.notEnoughTranscriptionMessage',
          'Transcribing this video takes about {{required}} credits. You have {{available}}, enough for about {{minutes}} minutes. Add credits, then start again.',
          {
            required: formatCredits(shortfall.requiredCredits),
            available: formatCredits(shortfall.availableCredits),
            minutes: transcriptionMinutesForCredits(shortfall.availableCredits),
          }
        )
      : t(
          'dialogs.creditRanOut.notEnoughMessage',
          'This task needs more credits than your balance of {{available}}. Add credits to continue.',
          { available: formatCredits(shortfall.availableCredits) }
        )
    : neverHadCredits
      ? t(
          'dialogs.creditRanOut.neverHadMessage',
          'Transcription needs credits or the API-key unlock. Get either in Settings. Translating with your own Claude or Codex through Agent Control is free.'
        )
      : t(
          'dialogs.creditRanOut.message',
          'Your AI credits have run out. Recharge in Settings, then resume where you left off.'
        );

  return (
    <Modal
      open={open}
      title={title}
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
            basis={creditOfferBasis(refusal)}
          />
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
}
