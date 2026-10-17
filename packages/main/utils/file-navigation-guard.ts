/**
 * Whether a tab must refuse a navigation. A file dropped outside the home
 * drop zone would otherwise replace the app with a file:// page, so file:
 * navigations are blocked, except a reload of the renderer's own document
 * (location.reload() fires will-navigate with the current URL).
 */
export function shouldBlockFileNavigation(
  targetUrl: string,
  currentUrl: string
): boolean {
  if (!targetUrl.startsWith('file:')) return false;
  return stripHashAndQuery(targetUrl) !== stripHashAndQuery(currentUrl);
}

function stripHashAndQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
