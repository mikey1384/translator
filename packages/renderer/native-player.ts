let instance: HTMLMediaElement | null = null;
let isReady: boolean = false;
let lastAccessed: number = Date.now();
let isInitialized: boolean = false;

export function setNativePlayerInstance(
  mediaElement: HTMLMediaElement | null
): void {
  instance = mediaElement;
  isReady = !!mediaElement;
  if (!isInitialized && mediaElement) {
    isInitialized = true;
  }
  lastAccessed = Date.now();
}

export function getNativePlayerInstance(): HTMLMediaElement | null {
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
      instance.currentTime = window._videoLastValidTime;
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    await instance.play();
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
        instance.currentTime = validTime; // First retry

        setTimeout(() => {
          if (!instance) return;

          const newTime = instance.currentTime;
          if (Math.abs(newTime - validTime) > 0.5) {
            instance.currentTime = validTime;

            if (isFileUrl && !instance.paused) {
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
