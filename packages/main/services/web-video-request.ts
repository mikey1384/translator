/** Electron net.fetch forwards headers literally, rather than deriving Referer
 * from RequestInit.referrer. Its default policy rejects full cross-site values.
 * Explicitly use the policy for this already observed playback request, while
 * continuing to omit the referrer on HTTPS -> HTTP downgrades.
 */
export function webVideoManifestRequest(
  media: string,
  referer: string,
  userAgent: string
): RequestInit {
  const target = new URL(media);
  const source = new URL(referer);
  source.hash = '';
  const downgrade = source.protocol === 'https:' && target.protocol === 'http:';
  return {
    headers: {
      ...(!downgrade ? { Referer: source.href } : {}),
      'User-Agent': userAgent,
    },
    referrerPolicy: 'no-referrer-when-downgrade',
    credentials: 'include',
    redirect: 'error',
  };
}
