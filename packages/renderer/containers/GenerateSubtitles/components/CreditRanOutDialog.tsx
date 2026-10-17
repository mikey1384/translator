import { useTranslation } from 'react-i18next';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import MicroCreditCheckoutButton from '../../../components/MicroCreditCheckoutButton';
import { useCreditStore, useSubStore } from '../../../state';
import { useModalStore } from '../../../state/modal-store';
import {
  creditOfferBasis,
  describeCreditShortfall,
} from '../../../utils/creditShortfall';
import { formatCostInMinutes } from '../../../utils/formatCostInMinutes';

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
  // keeps the original wording for refusals with no known task.
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
  // Amounts in minutes of video, the unit users buy and see on the balance.
  const locale = i18n.language;

  const hasLines = useSubStore(s => s.order.length > 0);
  const hasTranslatedLines = useSubStore(s =>
    s.order.some(id => Boolean(s.segments[id]?.translation?.trim()))
  );

  // Worded for what the user started; a refusal is never "transcription"
  // when they asked for a translation or a dub.
  const task = refusal?.kind ?? 'other';
  const taskTitle = (): string => {
    switch (task) {
      case 'transcription':
        return t(
          'dialogs.creditRanOut.minutes.transcription.title',
          'Transcribing needs minutes'
        );
      case 'translation':
        return t(
          'dialogs.creditRanOut.minutes.translation.title',
          'Translating needs minutes'
        );
      case 'dubbing':
        return t(
          'dialogs.creditRanOut.minutes.dubbing.title',
          'Dubbing needs minutes'
        );
      case 'summary':
        return t(
          'dialogs.creditRanOut.minutes.summary.title',
          'The summary needs minutes'
        );
      case 'videoSearch':
        return t(
          'dialogs.creditRanOut.minutes.videoSearch.title',
          'AI video search needs minutes'
        );
      default:
        return neverHadCredits
          ? t('dialogs.creditRanOut.minutes.other.title', 'This needs minutes')
          : t('dialogs.creditRanOut.minutes.title', 'Out of minutes');
    }
  };
  const taskMessage = (): string => {
    switch (task) {
      case 'transcription':
        return neverHadCredits
          ? t(
              'dialogs.creditRanOut.minutes.neverHadMessage',
              'Transcription needs minutes or the API-key unlock. Get either in Settings. Translating with your own Claude or Codex through Agent Control is free.'
            )
          : hasLines
            ? t(
                'dialogs.creditRanOut.minutes.transcription.message',
                'Your minutes don’t cover transcribing this. Add minutes, then start again. Lines already transcribed are kept.'
              )
            : t(
                'dialogs.creditRanOut.minutes.transcription.messageNothingYet',
                'Your minutes don’t cover transcribing this. Add minutes, then start again.'
              );
      case 'translation':
        // Only promise kept lines when some exist.
        return hasTranslatedLines
          ? t(
              'dialogs.creditRanOut.minutes.translation.message',
              'Your minutes don’t cover translating this. Add minutes, then try again. Lines already translated are kept. Translating with your own Claude or Codex through Agent Control is free.'
            )
          : t(
              'dialogs.creditRanOut.minutes.translation.messageNothingYet',
              'Your minutes don’t cover translating this. Add minutes, then try again. Translating with your own Claude or Codex through Agent Control is free.'
            );
      case 'dubbing':
        return t(
          'dialogs.creditRanOut.minutes.dubbing.message',
          'Your minutes don’t cover dubbing this video. Add minutes, then try again.'
        );
      case 'summary':
        return t(
          'dialogs.creditRanOut.minutes.summary.message',
          'Your minutes don’t cover the summary and highlights. Add minutes, then try again.'
        );
      case 'videoSearch':
        return t(
          'dialogs.creditRanOut.minutes.videoSearch.message',
          'Your minutes don’t cover an AI video search. Add minutes, then search again.'
        );
      default:
        return t(
          'dialogs.creditRanOut.minutes.message',
          'You’ve used up your minutes. Add more in Settings, then pick up where you left off.'
        );
    }
  };

  const title =
    shortfall && task === 'transcription' && shortfall.requiredCredits !== null
      ? t(
          'dialogs.creditRanOut.minutes.notEnoughTitle',
          'Not enough minutes for this video'
        )
      : taskTitle();

  const available = shortfall
    ? formatCostInMinutes(shortfall.availableCredits, {
        kind: 'balance',
        locale,
      })
    : '';
  const message = shortfall
    ? shortfall.requiredCredits !== null
      ? t(
          'dialogs.creditRanOut.minutes.notEnoughTranscriptionMessage',
          'Transcribing this video needs {{required}}, and you have {{available}} left. Add minutes, then start again.',
          {
            required: formatCostInMinutes(shortfall.requiredCredits, {
              kind: 'estimate',
              locale,
            }),
            available,
          }
        )
      : t(
          'dialogs.creditRanOut.minutes.notEnoughMessage',
          'This needs more than the {{available}} you have left. Add minutes to continue.',
          { available }
        )
    : taskMessage();

  return (
    <Modal
      open={open}
      title={title}
      titleId="credit-ran-out-title"
      // Escape and the close button mean "OK", like every other dialog.
      onClose={onOk}
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
