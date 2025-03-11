// Export all helper functions for convenient imports
export * from './subtitle-utils';

/**
 * Throttle function to limit how often a function can be called
 * @param func The function to throttle
 * @param limit The time limit in milliseconds
 */
export function throttle(func: Function, limit: number): Function {
  let inThrottle: boolean;
  return function (this: any, ...args: any[]) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Debounce function to delay function execution until after a period of inactivity
 * @param func The function to debounce
 * @param wait The wait time in milliseconds
 */
export function debounce(func: Function, wait: number): Function {
  let timeout: ReturnType<typeof setTimeout>;
  return function (this: any, ...args: any[]) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Check if the current device is a mobile device
 */
export function isMobile(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

/**
 * Format a filesize in bytes to a human-readable string
 * @param bytes File size in bytes
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2);
}

/**
 * Check if a scroll element is at the bottom
 */
export function isScrolledToBottom(
  element: HTMLElement,
  threshold: number = 20
): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight < threshold
  );
}

/**
 * Scroll an element to the bottom
 */
export function scrollToBottom(element: HTMLElement): void {
  element.scrollTop = element.scrollHeight;
}

/**
 * Get the last element of an array
 */
export function last<T>(array: T[]): T | undefined {
  return array.length > 0 ? array[array.length - 1] : undefined;
}
