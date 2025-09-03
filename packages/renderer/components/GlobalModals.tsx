import ConfirmReplaceSrtDialog from '../containers/GenerateSubtitles/components/ConfirmReplaceSrtDialog';
import CreditRanOutDialog from '../containers/GenerateSubtitles/components/CreditRanOutDialog';
import { useModalStore, resolveUnsavedSrt, resolveCreditRanOut } from '../state/modal-store';
import { useUIStore } from '../state/ui-store';

export default function GlobalModals() {
  const unsavedOpen = useModalStore(s => s.unsavedSrtOpen);
  const creditOpen = useModalStore(s => s.creditRanOutOpen);
  const toggleSettings = useUIStore(s => s.toggleSettings);

  return (
    <>
      <ConfirmReplaceSrtDialog
        open={unsavedOpen}
        onCancel={() => resolveUnsavedSrt('cancel')}
        onDiscardAndTranscribe={() => resolveUnsavedSrt('discard')}
        onSaveAndTranscribe={() => resolveUnsavedSrt('save')}
      />
      <CreditRanOutDialog
        open={creditOpen}
        onOk={() => resolveCreditRanOut('ok')}
        onOpenSettings={() => {
          resolveCreditRanOut('settings');
          toggleSettings(true);
        }}
      />
    </>
  );
}
