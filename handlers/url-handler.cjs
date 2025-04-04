const path = require('path');

async function handleProcessUrl(event, options) {
  const operationId = `process-url-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 9)}`;

  const sendProgress = (percent, stage, error = null) => {
    try {
      event.sender.send('process-url-progress', {
        percent,
        stage,
        error,
        operationId,
      });
    } catch (sendError) {
      console.error(`[${operationId}] Error sending progress:`, sendError);
    }
  };

  try {
    // Validation
    if (!options.url || typeof options.url !== 'string') {
      throw new Error('URL is required.');
    }

    // Dynamically import the required service function
    const { processVideoUrl } = require('../dist/services/url-processor');

    // Execute URL Processing
    sendProgress(0, 'Initializing URL processing...');
    const result = await processVideoUrl(options.url, progress => {
      sendProgress(progress.percent, progress.stage, progress.error);
    });

    return {
      success: true,
      videoPath: result.videoPath,
      filename: result.filename,
      size: result.size,
      fileUrl: result.fileUrl,
      originalVideoPath: result.originalVideoPath,
      operationId,
    };
  } catch (error) {
    console.error(`[${operationId}] Error handling process-url:`, error);
    sendProgress(0, `Error: ${error.message || 'Unknown URL error'}`, error);
    return {
      success: false,
      error: error.message || String(error),
      operationId,
    };
  }
}

module.exports = {
  handleProcessUrl,
};
