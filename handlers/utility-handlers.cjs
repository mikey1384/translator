async function handlePing() {
  return 'pong';
}

async function handleShowMessage(_, message) {
  try {
    // Dynamically require dialog here to avoid loading it unnecessarily
    const { dialog } = require('electron');
    await dialog.showMessageBox({
      type: 'info',
      title: 'Translator',
      message: message || 'Operation completed successfully',
      buttons: ['OK'],
    });
    return { success: true };
  } catch (error) {
    console.error('[handleShowMessage] Error:', error);
    return { success: false, error: error.message || String(error) };
  }
}

module.exports = {
  handlePing,
  handleShowMessage,
};
