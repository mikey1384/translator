import { dialog } from 'electron';

export async function handlePing(): Promise<string> {
  return 'pong';
}

// Define a type for the return value for clarity
interface ShowMessageResult {
  success: boolean;
  error?: string;
}

// Add type for the message parameter
export async function handleShowMessage(
  _event: Electron.IpcMainInvokeEvent, // Add type for the unused event argument
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
    // Type the error
    console.error('[handleShowMessage] Error:', error);
    return { success: false, error: error.message || String(error) };
  }
}
