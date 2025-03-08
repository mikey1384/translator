export async function extractVideoThumbnail(
  videoUrl: string
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');

    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    video.onloadedmetadata = () => {
      video.currentTime = video.duration / 2;
    };

    video.onseeked = () => {
      try {
        canvas.height = video.videoHeight;
        canvas.width = video.videoWidth;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        const thumbnail = canvas.toDataURL('image/png');
        URL.revokeObjectURL(videoUrl); // Clean up
        resolve(thumbnail);
      } catch (error) {
        URL.revokeObjectURL(videoUrl);
        reject(error);
      }
    };

    video.onerror = (error) => {
      URL.revokeObjectURL(videoUrl);
      reject(error);
    };

    video.src = videoUrl;
  });
}
