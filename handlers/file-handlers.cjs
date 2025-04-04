const path = require('path');
const fs = require('fs');

let fileManager;
let saveFileService;

function initializeFileHandlers(services) {
  if (!services || !services.fileManager || !services.saveFileService) {
    throw new Error(
      '[file-handlers] Required services (fileManager, saveFileService) not provided.'
    );
  }
  fileManager = services.fileManager;
  saveFileService = services.saveFileService;
  console.info('[file-handlers] Initialized.');
}

// === Handlers ===

async function handleSaveFile(_event, options) {
  try {
    const filePath = await saveFileService.saveFile(options);
    return { success: true, filePath };
  } catch (error) {
    console.error('[handleSaveFile] Error:', error);
    return { success: false, error: error.message || String(error) };
  }
}

async function handleOpenFile(_event, options) {
  try {
    const result = await fileManager.openFile(options);
    return result;
  } catch (error) {
    console.error('[handleOpenFile] Error:', error);
    return {
      canceled: false,
      filePaths: [],
      error: error.message || String(error),
    };
  }
}

async function handleMoveFile(_event, sourcePath, destinationPath) {
  try {
    await fileManager.moveFile(sourcePath, destinationPath);
    return { success: true };
  } catch (error) {
    console.error('[handleMoveFile] Error:', error);
    return { success: false, error: error.message || String(error) };
  }
}

async function handleCopyFile(_event, sourcePath, destinationPath) {
  try {
    await fileManager.copyFile(sourcePath, destinationPath);
    return { success: true };
  } catch (error) {
    console.error('[handleCopyFile] Error:', error);
    return { success: false, error: error.message || String(error) };
  }
}

async function handleDeleteFile(event, { filePathToDelete }) {
  if (!filePathToDelete) {
    return { success: false, error: 'No file path provided for deletion' };
  }

  try {
    // Check if the file exists before attempting to delete
    if (!fs.existsSync(filePathToDelete)) {
      console.log(
        `[handleDeleteFile] File does not exist: ${filePathToDelete}`
      );
      return {
        success: true,
        message: 'File does not exist, no deletion needed',
      };
    }

    console.log(`[handleDeleteFile] Deleting file: ${filePathToDelete}`);
    await fileManager.deleteFile(filePathToDelete);
    return { success: true };
  } catch (error) {
    console.error(
      `[handleDeleteFile] Error deleting ${filePathToDelete}:`,
      error
    );
    return { success: false, error: error.message || String(error) };
  }
}

async function handleReadFileContent(_event, filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'Invalid file path provided.' };
  }
  try {
    const normalizedPath = path.normalize(filePath);
    await fs.promises.access(normalizedPath, fs.constants.R_OK);
    const buffer = await fs.promises.readFile(normalizedPath);
    return { success: true, data: buffer };
  } catch (error) {
    console.error(`[handleReadFileContent] Error reading ${filePath}:`, error);
    return {
      success: false,
      error: error.message || 'Failed to read file content.',
    };
  }
}

module.exports = {
  initializeFileHandlers,
  handleSaveFile,
  handleOpenFile,
  handleMoveFile,
  handleCopyFile,
  handleDeleteFile,
  handleReadFileContent,
};
