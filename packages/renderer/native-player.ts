let instance: HTMLVideoElement | null = null;
let isReady: boolean = false;
let lastAccessed: number = Date.now(); // Initialize lastAccessed
let isInitialized: boolean = false;

export function setNativePlayerInstance(
  videoElement: HTMLVideoElement | null
): void {
  instance = videoElement;
  isReady = !!videoElement;
  if (!isInitialized && videoElement) {
    isInitialized = true; // Mark as initialized only once a valid element is set
  }
  lastAccessed = Date.now();
  if (instance) {
    console.log('Native player instance set/updated.');
  } else {
    console.log('Native player instance cleared.');
  }
}

export function getNativePlayerInstance(): HTMLVideoElement | null {
  lastAccessed = Date.now();
  return instance;
}

export function isNativePlayerReady(): boolean {
  lastAccessed = Date.now();
  return isReady && !!instance;
}

export function isNativePlayerInitialized(): boolean {
  return isInitialized;
}

export async function nativePlay(): Promise<void> {
  lastAccessed = Date.now();
  if (!instance) {
    console.warn('Play called but native player instance is null.');
    return;
  }
  try {
    const isFileUrl = instance.src.startsWith('file://');
    if (
      isFileUrl &&
      instance.currentTime === 0 &&
      window._videoLastValidTime &&
      window._videoLastValidTime > 0
    ) {
      console.log(
        `Restoring position to ${window._videoLastValidTime} before playing`
      );
      // Restore position directly
      instance.currentTime = window._videoLastValidTime;
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    await instance.play();
    console.log('Native player playing.');
  } catch (error) {
    console.error('Error playing video:', error);
    throw error;
  }
}

export function nativePause(): void {
  lastAccessed = Date.now();
  if (!instance) {
    console.warn('Pause called but native player instance is null.');
    return;
  }
  instance.pause();
  console.log('Native player paused.');
}

export function nativeSeek(time: number): void {
  lastAccessed = Date.now();
  if (!instance) {
    console.warn('Seek called but native player instance is null.');
    return;
  }

  const validTime =
    typeof time === 'number' && !isNaN(time) && time >= 0 ? time : 0;

  try {
    const isFileUrl = instance.src.startsWith('file://');

    console.log(`Seeking to ${validTime} (file URL: ${isFileUrl})`);

    if (window._videoLastValidTime === undefined) {
      window._videoLastValidTime = 0;
    }

    if (validTime > 0) {
      window._videoLastValidTime = validTime;
    }

    instance.currentTime = validTime;

    setTimeout(() => {
      if (!instance) return;

      const currentTime = instance.currentTime;
      const drift = Math.abs(currentTime - validTime);

      if (!instance.paused && drift < 1) return;

      if (drift > 0.5) {
        console.warn(
          `Seek correction needed: Current ${currentTime}, Target ${validTime}. Retrying.`
        );
        instance.currentTime = validTime; // First retry

        setTimeout(() => {
          if (!instance) return;

          const newTime = instance.currentTime;
          if (Math.abs(newTime - validTime) > 0.5) {
            console.error(
              `Second seek correction failed: Current ${newTime}, Target ${validTime}.`
            );
            instance.currentTime = validTime;

            if (isFileUrl && !instance.paused) {
              console.warn(
                'Pause-seek-play strategy activated for file:// URL.'
              );
              const wasPlaying = !instance.paused;
              nativePause();

              setTimeout(() => {
                if (!instance) return;
                instance.currentTime = validTime;

                if (wasPlaying) {
                  setTimeout(() => {
                    if (instance) {
                      nativePlay().catch(err => {
                        console.error(
                          'Error resuming playback after pause-seek-play:',
                          err
                        );
                      });
                    }
                  }, 50);
                }
              }, 50);
            }
          }
        }, 200);
      }
    }, 50);
  } catch (error) {
    console.error('Error during seek operation:', error);
  }
}

export function nativeGetCurrentTime(): number {
  lastAccessed = Date.now();
  if (!instance) {
    return 0;
  }
  return instance.currentTime || 0;
}

export function nativeIsPlaying(): boolean {
  lastAccessed = Date.now();
  if (!instance) {
    return false;
  }
  return !instance.paused && instance.readyState > 2;
}

export function getNativePlayerLastAccessed(): number {
  return lastAccessed;
}
