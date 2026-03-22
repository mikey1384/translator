import { useTranslation } from 'react-i18next';
import Button from '../../../components/Button';
import Modal from '../../../components/Modal';

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

  return (
    <Modal
      open={open}
      title={t('dialogs.unsavedSrtOnTranscribe.title')}
      titleId="confirm-replace-srt-title"
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={onDiscardAndTranscribe}>
            {t('dialogs.unsavedSrtOnTranscribe.discardAndTranscribe')}
          </Button>
          <Button variant="primary" onClick={onSaveAndTranscribe}>
            {t('dialogs.unsavedSrtOnTranscribe.saveAndTranscribe')}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{t('dialogs.unsavedSrtOnTranscribe.message')}</p>
    </Modal>
  );
}
