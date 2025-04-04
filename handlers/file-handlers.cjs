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

async function handleDeleteFile(_event, options) {
  const filePathToDelete = options?.filePathToDelete;
  if (!filePathToDelete) {
    return { success: false, error: 'File path to delete is required.' };
  }
  try {
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
