import { useTranslation } from 'react-i18next';
import Button from '../../../components/Button';
import Modal from '../../../components/Modal';
import type { UnsavedSrtContext } from '../../../state/modal-store';

interface Props {
  open: boolean;
  context: UnsavedSrtContext;
  onSaveAndTranscribe: () => void;
  onDiscardAndTranscribe: () => void;
  onCancel: () => void;
}

export default function ConfirmReplaceSrtDialog({
  open,
  context,
  onSaveAndTranscribe,
  onDiscardAndTranscribe,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const isCaptionRecovery = context === 'caption_recovery';
  const isReplace = context === 'replace';

  return (
    <Modal
      open={open}
      title={
        isReplace
          ? t(
              'dialogs.unsavedSrtOnReplace.title',
              'Save your subtitle edits first?'
            )
          : isCaptionRecovery
            ? t(
                'dialogs.unsavedSrtOnCaptionRecovery.title',
                'Open recovered automatic captions?'
              )
            : t('dialogs.unsavedSrtOnTranscribe.title')
      }
      titleId="confirm-replace-srt-title"
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={onDiscardAndTranscribe}>
            {isReplace
              ? t(
                  'dialogs.unsavedSrtOnReplace.discardAndContinue',
                  'Discard edits and continue'
                )
              : isCaptionRecovery
                ? t(
                    'dialogs.unsavedSrtOnCaptionRecovery.discardAndOpen',
                    'Discard and open captions'
                  )
                : t('dialogs.unsavedSrtOnTranscribe.discardAndTranscribe')}
          </Button>
          <Button variant="primary" onClick={onSaveAndTranscribe}>
            {isReplace
              ? t(
                  'dialogs.unsavedSrtOnReplace.saveAndContinue',
                  'Save and continue'
                )
              : isCaptionRecovery
                ? t(
                    'dialogs.unsavedSrtOnCaptionRecovery.saveAndOpen',
                    'Save and open captions'
                  )
                : t('dialogs.unsavedSrtOnTranscribe.saveAndTranscribe')}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        {isReplace
          ? t(
              'dialogs.unsavedSrtOnReplace.message',
              'You changed these subtitles since they were last saved. Save your edits before replacing them?'
            )
          : isCaptionRecovery
            ? t(
                'dialogs.unsavedSrtOnCaptionRecovery.message',
                'You already have subtitles open. Save or discard them before replacing them with YouTube automatic captions.'
              )
            : t('dialogs.unsavedSrtOnTranscribe.message')}
      </p>
    </Modal>
  );
}
