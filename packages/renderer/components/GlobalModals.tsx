import ConfirmReplaceSrtDialog from '../containers/GenerateSubtitles/components/ConfirmReplaceSrtDialog';
import { useModalStore, resolveUnsavedSrt } from '../state/modal-store';

export default function GlobalModals() {
  const open = useModalStore(s => s.unsavedSrtOpen);

  if (!open) return null;

  return (
    <ConfirmReplaceSrtDialog
      open={open}
      onCancel={() => resolveUnsavedSrt('cancel')}
      onDiscardAndTranscribe={() => resolveUnsavedSrt('discard')}
      onSaveAndTranscribe={() => resolveUnsavedSrt('save')}
    />
  );
}
