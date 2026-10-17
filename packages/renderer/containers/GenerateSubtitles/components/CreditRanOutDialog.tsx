import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import MicroCreditCheckoutButton from '../../../components/MicroCreditCheckoutButton';
import { useCreditStore, useSubStore } from '../../../state';
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
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language]
  );
  const formatCredits = (value: number) => numberFormat.format(value);

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
          'dialogs.creditRanOut.task.transcription.title',
          'Transcribing needs credits'
        );
      case 'translation':
        return t(
          'dialogs.creditRanOut.task.translation.title',
          'Translating needs credits'
        );
      case 'dubbing':
        return t(
          'dialogs.creditRanOut.task.dubbing.title',
          'Dubbing needs credits'
        );
      case 'summary':
        return t(
          'dialogs.creditRanOut.task.summary.title',
          'The summary needs credits'
        );
      case 'videoSearch':
        return t(
          'dialogs.creditRanOut.task.videoSearch.title',
          'AI video search needs credits'
        );
      default:
        return neverHadCredits
          ? t('dialogs.creditRanOut.task.other.title', 'This needs credits')
          : t('dialogs.creditRanOut.title', 'Credits ran out');
    }
  };
  const taskMessage = (): string => {
    switch (task) {
      case 'transcription':
        return neverHadCredits
          ? t(
              'dialogs.creditRanOut.neverHadMessage',
              'Transcription needs credits or the API-key unlock. Get either in Settings. Translating with your own Claude or Codex through Agent Control is free.'
            )
          : hasLines
            ? t(
                'dialogs.creditRanOut.task.transcription.message',
                'Your balance doesn’t cover transcribing this. Add credits, then start again. Lines already transcribed are kept.'
              )
            : t(
                'dialogs.creditRanOut.task.transcription.messageNothingYet',
                'Your balance doesn’t cover transcribing this. Add credits, then start again.'
              );
      case 'translation':
        // Only promise kept lines when some exist.
        return hasTranslatedLines
          ? t(
              'dialogs.creditRanOut.task.translation.message',
              'Your balance doesn’t cover translating this. Add credits, then try again. Lines already translated are kept. Translating with your own Claude or Codex through Agent Control is free.'
            )
          : t(
              'dialogs.creditRanOut.task.translation.messageNothingYet',
              'Your balance doesn’t cover translating this. Add credits, then try again. Translating with your own Claude or Codex through Agent Control is free.'
            );
      case 'dubbing':
        return t(
          'dialogs.creditRanOut.task.dubbing.message',
          'Your balance doesn’t cover dubbing this video. Add credits, then try again.'
        );
      case 'summary':
        return t(
          'dialogs.creditRanOut.task.summary.message',
          'Your balance doesn’t cover the summary and highlights. Add credits, then try again.'
        );
      case 'videoSearch':
        return t(
          'dialogs.creditRanOut.task.videoSearch.message',
          'Your balance doesn’t cover an AI video search. Add credits, then search again.'
        );
      default:
        return t(
          'dialogs.creditRanOut.message',
          'Your AI credits have run out. Recharge in Settings, then resume where you left off.'
        );
    }
  };

  const title =
    shortfall && task === 'transcription' && shortfall.requiredCredits !== null
      ? t(
          'dialogs.creditRanOut.notEnoughTitle',
          'Not enough credits for this video'
        )
      : taskTitle();

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
