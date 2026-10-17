import { dialog } from 'electron';
import { getFocusedOrMainWindow } from '../utils/window.js';
import { getUiT } from '../utils/ui-language.js';

export async function handlePing(): Promise<string> {
  return 'pong';
}

interface ShowMessageResult {
  success: boolean;
  error?: string;
}

type MessageKind = 'info' | 'warning' | 'error';

export async function handleShowMessage(
  _event: Electron.IpcMainInvokeEvent,
  message: string,
  options?: { type?: MessageKind }
): Promise<ShowMessageResult> {
  try {
    const t = await getUiT();
    const type: MessageKind =
      options?.type === 'warning' || options?.type === 'error'
        ? options.type
        : 'info';
    const boxOptions: Electron.MessageBoxOptions = {
      type,
      title: 'Translator',
      message: message || t('common.done', undefined, 'Done'),
      buttons: [t('common.ok', undefined, 'OK')],
    };
    // Attach to the app window so the box can't open behind it (macOS).
    const parent = getFocusedOrMainWindow();
    if (parent && !parent.isDestroyed()) {
      await dialog.showMessageBox(parent, boxOptions);
    } else {
      await dialog.showMessageBox(boxOptions);
    }
    return { success: true };
  } catch (error: any) {
    console.error('[handleShowMessage] Error:', error);
    return { success: false, error: error.message || String(error) };
  }
}
