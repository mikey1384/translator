import { i18n } from '../i18n';
import { openNotice } from '../state/modal-store';

/**
 * A yes/no question in the app's own dialog. Native confirm() buttons follow
 * the OS language, not the UI language, and look nothing like the app.
 */
export async function confirmInApp({
  title,
  message,
  confirmLabel,
  danger = false,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  const choice = await openNotice({
    title,
    message,
    buttons: [
      {
        id: 'cancel',
        label: i18n.t('common.cancel', 'Cancel'),
        variant: 'secondary',
      },
      {
        id: 'confirm',
        label: confirmLabel,
        variant: danger ? 'danger' : 'primary',
      },
    ],
  });
  return choice === 'confirm';
}
