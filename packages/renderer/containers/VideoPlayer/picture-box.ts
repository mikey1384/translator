export interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the picture sits inside the player panel, in panel coordinates: the
 * frame (`intrinsicWidth` x `intrinsicHeight`) fitted "contain" into the
 * media element's box.
 *
 * An audio file has no picture and its <audio> element is not rendered at all
 * (Chromium hides <audio> without controls, so it measures 0x0). The export
 * burns its subtitles onto a black frame, so for audio, or whenever the media
 * element has no layout box, that frame is fitted into the visible panel
 * instead; measuring the 0x0 element would shrink the subtitles to nothing.
 */
export function fitPictureBox({
  mediaRect,
  panelRect,
  intrinsicWidth,
  intrinsicHeight,
  isAudioOnly,
}: {
  mediaRect: BoxRect;
  panelRect: BoxRect;
  intrinsicWidth: number;
  intrinsicHeight: number;
  isAudioOnly: boolean;
}): BoxRect {
  const mediaHasBox = mediaRect.width > 0 && mediaRect.height > 0;
  const box = isAudioOnly || !mediaHasBox ? panelRect : mediaRect;
  const cssWidth = Math.max(box.width, 1);
  const cssHeight = Math.max(box.height, 1);
  const frameWidth = intrinsicWidth > 0 ? intrinsicWidth : cssWidth;
  const frameHeight = intrinsicHeight > 0 ? intrinsicHeight : cssHeight;
  const scale = Math.min(cssWidth / frameWidth, cssHeight / frameHeight);
  const width = Math.max(1, frameWidth * scale);
  const height = Math.max(1, frameHeight * scale);
  return {
    left: box.left - panelRect.left + (cssWidth - width) / 2,
    top: box.top - panelRect.top + (cssHeight - height) / 2,
    width,
    height,
  };
}
