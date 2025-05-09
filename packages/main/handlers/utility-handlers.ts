import { dialog } from 'electron';

export async function handlePing(): Promise<string> {
  return 'pong';
}

interface ShowMessageResult {
  success: boolean;
  error?: string;
}

export async function handleShowMessage(
  _event: Electron.IpcMainInvokeEvent,
  message: string
): Promise<ShowMessageResult> {
  try {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Translator',
      message: message || 'Operation completed successfully',
      buttons: ['OK'],
    });
    return { success: true };
  } catch (error: any) {
    console.error('[handleShowMessage] Error:', error);
    return { success: false, error: error.message || String(error) };
  }
}
