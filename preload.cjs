const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  // Test methods
  ping: async () => {
    try {
      return await ipcRenderer.invoke('ping');
    } catch (error) {
      throw error;
    }
  },

  // Show a message from main process
  showMessage: message => ipcRenderer.invoke('show-message', message),

  // Simple test function that returns a value immediately
  test: () => 'Electron API is working',

  // Subtitle generation
  generateSubtitles: async options => {
    console.log('Generate subtitles called with options:', options);

    // Prepare options for sending to main process
    const processedOptions = { ...options };

    // If we have a videoFile (browser File object) but no videoPath,
    // we need to read the file data and send it to the main process
    if (options.videoFile && !options.videoPath) {
      console.log('File object detected without path - reading file data');

      try {
        // Read the File object as an ArrayBuffer
        const fileData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsArrayBuffer(options.videoFile);
        });

        console.log(`Read ${fileData.byteLength} bytes from file`);

        // Create properties for main process to use
        processedOptions.videoFileData = fileData;
        processedOptions.videoFileName = options.videoFile.name;
      } catch (error) {
        console.error('Error reading file data:', error);
        throw new Error('Failed to read video file data');
      }
    }

    // Remove the File object since it can't be serialized for IPC
    delete processedOptions.videoFile;

    console.log('Sending options to main process:', processedOptions);
    return ipcRenderer.invoke('generate-subtitles', processedOptions);
  },
  onGenerateSubtitlesProgress: callback => {
    try {
      if (typeof callback !== 'function') {
        console.warn(
          'Invalid callback provided to onGenerateSubtitlesProgress'
        );
        return;
      }
      ipcRenderer.on('generate-subtitles-progress', (event, progress) => {
        try {
          callback(progress);
        } catch (error) {
          console.error(
            'Error in generate-subtitles-progress callback:',
            error
          );
        }
      });
      return () => {
        try {
          ipcRenderer.removeListener('generate-subtitles-progress', callback);
        } catch (error) {
          console.error(
            'Error removing generate-subtitles-progress listener:',
            error
          );
        }
      };
    } catch (error) {
      console.error('Error in onGenerateSubtitlesProgress:', error);
    }
  },

  // Video merging
  mergeSubtitles: async options => {
    console.log('Merge subtitles called with options:', options);
    const processedOptions = { ...options };

    // If we have a videoFile, read its data
    if (options.videoFile) {
      console.log('File object detected in merge options - reading file data');
      try {
        const fileData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsArrayBuffer(options.videoFile);
        });
        console.log(
          `Read ${fileData.byteLength} bytes from video file for merge`
        );
        processedOptions.videoFileData = fileData;
        processedOptions.videoFileName = options.videoFile.name; // Include filename
      } catch (error) {
        console.error('Error reading video file data for merge:', error);
        throw new Error('Failed to read video file data for merge');
      }
    }

    // Remove the File object before sending
    delete processedOptions.videoFile;

    console.log('Sending merge options to main process:', processedOptions);
    return ipcRenderer.invoke('merge-subtitles', processedOptions);
  },

  onMergeSubtitlesProgress: callback => {
    try {
      if (typeof callback !== 'function') {
        console.warn('Invalid callback provided to onMergeSubtitlesProgress');
        return;
      }
      ipcRenderer.on('merge-subtitles-progress', callback);
      return () => {
        try {
          ipcRenderer.removeListener('merge-subtitles-progress', callback);
        } catch (error) {
          console.error(
            'Error removing merge-subtitles-progress listener:',
            error
          );
        }
      };
    } catch (error) {
      console.error('Error in onMergeSubtitlesProgress:', error);
    }
  },

  // File operations
  saveFile: options => ipcRenderer.invoke('save-file', options),
  openFile: options => ipcRenderer.invoke('open-file', options),

  // Merge cancellation
  cancelMerge: operationId => ipcRenderer.invoke('cancel-merge', operationId),
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electron', electronAPI);

console.log('Preload script initialized successfully');
